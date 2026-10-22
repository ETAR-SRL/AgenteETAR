param([string]$PackagePath,[switch]$Check,[switch]$Offline,[switch]$Library)
$ErrorActionPreference='Stop'
if($PSVersionTable.PSEdition -eq 'Desktop'){$env:PSModulePath=@((Join-Path $env:ProgramFiles 'WindowsPowerShell/Modules'),(Join-Path $PSHOME 'Modules')) -join ';'}

function Assert-UpdatePath([string]$Path){
 $full=[IO.Path]::GetFullPath($Path)
 $current=$full
 while($current){if(Test-Path -LiteralPath $current){$item=Get-Item -LiteralPath $current -Force;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'No se admiten enlaces ni puntos de reanalisis en el traslado.'}};$parent=[IO.Directory]::GetParent($current);if($null -eq $parent){break};$current=$parent.FullName}
 return $full
}
function Protect-UpdateDirectory([string]$Path,[switch]$ServiceRead){
 [IO.Directory]::CreateDirectory($Path)|Out-Null
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 $grants=@("*${sid}:(OI)(CI)(F)",'*S-1-5-18:(OI)(CI)(F)','*S-1-5-32-544:(OI)(CI)(F)')
 if($ServiceRead){$grants+='*S-1-5-19:(OI)(CI)(RX)'}
 & icacls.exe $Path /inheritance:r /grant:r @grants /Q|Out-Null
 if($LASTEXITCODE -ne 0){throw 'No se pudo proteger el directorio de actualizacion.'}
}
function Write-UpdateJson([string]$Path,$Value){
 $temp=$Path+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
 $previous=$Path+'.previous-'+[guid]::NewGuid().ToString('N')
 try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 8));$stream=[IO.File]::Open($temp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()};if(Test-Path -LiteralPath $Path){[IO.File]::Replace($temp,$Path,$previous)}else{[IO.File]::Move($temp,$Path)}}finally{foreach($file in @($temp,$previous)){if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force}}}
}
function Invoke-UpdateNode([string]$NodePath,[string[]]$Arguments,[string]$WorkingDirectory){
 Push-Location -LiteralPath $WorkingDirectory
 $priorEncoding=[Console]::OutputEncoding
 try{[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$previous=$ErrorActionPreference;try{$ErrorActionPreference='Continue';$output=& $NodePath --no-warnings @Arguments 2>&1;$code=$LASTEXITCODE}finally{$ErrorActionPreference=$previous}
  if($code -ne 0){throw 'No se completo una comprobacion o fase de la actualizacion. Se conservo su registro y respaldo.'}
  if($output){try{return (($output|ForEach-Object{[string]$_}) -join "`n")|ConvertFrom-Json}catch{throw 'La comprobacion no devolvio un resultado valido.'}}
 }finally{[Console]::OutputEncoding=$priorEncoding;Pop-Location}
}
function Get-UpdateService([string]$Root,[string]$NodePath){
 $service=Get-CimInstance Win32_Service -Filter "Name='CentralETAR'"
 if(-not $service -or $service.StartName -ne 'NT AUTHORITY\LocalService' -or $service.PathName.IndexOf('"'+$Root+'"',[StringComparison]::OrdinalIgnoreCase) -lt 0){throw 'No se encontro CentralETAR bajo LOCAL SERVICE para esta carpeta. Este BAT actualiza el servicio nativo, no migra tareas programadas.'}
 return $service
}
function Stop-UpdateService([string]$Root,$Service){
 $fresh=Get-UpdateService $Root ''
 if($fresh.State -eq 'Stopped' -and -not $fresh.ProcessId){
  $pidPath=Join-Path $Root 'data/server.pid'
  if(Test-Path -LiteralPath $pidPath){$text=([IO.File]::ReadAllText($pidPath)).Trim();if($text -match '^\d+$'){$candidate=Get-CimInstance Win32_Process -Filter ('ProcessId='+$text);if($candidate -and $candidate.Name -eq 'node.exe' -and $candidate.CommandLine -match 'src[\\/]server\.js'){throw 'SCM esta detenido pero todavia hay un servidor registrado vivo. No se restauran datos mientras este activo.'}}}
  return
 }
 $owned=@();$all=@(Get-CimInstance Win32_Process);$ids=@([uint32]$fresh.ProcessId)
 for($level=0;$level -lt 6;$level++){$children=@($all|Where-Object{$ids -contains $_.ProcessId -or $ids -contains $_.ParentProcessId});$owned+=@($children);$next=@($children|Select-Object -ExpandProperty ProcessId);if(-not $next.Count){break};$ids=$next}
 if($fresh.State -ne 'Stopped'){Stop-Service -Name 'CentralETAR' -ErrorAction Stop;(Get-Service CentralETAR).WaitForStatus([ServiceProcess.ServiceControllerStatus]::Stopped,[TimeSpan]::FromSeconds(45))}
 $deadline=(Get-Date).AddSeconds(30)
 do{$alive=@();foreach($p in @($owned|Sort-Object ProcessId -Unique)){if(-not $p.ProcessId){continue};$now=Get-CimInstance Win32_Process -Filter ('ProcessId='+$p.ProcessId);if($now -and $now.CreationDate -eq $p.CreationDate){$alive+=$now}};if($alive.Count){Start-Sleep -Milliseconds 500}}while($alive.Count -and (Get-Date) -lt $deadline)
 if($alive.Count){throw 'El servicio no termino todos sus procesos. No se reemplazaron archivos ni la base local.'}
}
function Start-UpdateService([string]$Root,$Service){
 $null=Get-UpdateService $Root ''
 Start-Service -Name CentralETAR -ErrorAction Stop
 (Get-Service CentralETAR).WaitForStatus([ServiceProcess.ServiceControllerStatus]::Running,[TimeSpan]::FromSeconds(45))
}
function Restore-UpdateReadAccess([string]$Root){
 foreach($name in @('.env','package.json','package-lock.json')){& icacls.exe (Join-Path $Root $name) /grant '*S-1-5-19:(R)' /Q|Out-Null;if($LASTEXITCODE -ne 0){throw 'No se pudieron restaurar permisos de lectura del servicio.'}}
 foreach($name in @('src','public','scripts','config','node_modules')){$path=Join-Path $Root $name;if(Test-Path -LiteralPath $path){& icacls.exe $path /grant '*S-1-5-19:(OI)(CI)(RX)' /Q|Out-Null;if($LASTEXITCODE -ne 0){throw 'No se pudieron restaurar permisos de los archivos de la app.'}}}
}
function Confirm-UpdateService([string]$Root,[string]$NodePath){
 $owned=$null;$deadline=(Get-Date).AddSeconds(75)
 do{$service=Get-UpdateService $Root $NodePath;$pidPath=Join-Path $Root 'data/server.pid'
  if($service.State -eq 'Running' -and (Test-Path -LiteralPath $pidPath)){$text=([IO.File]::ReadAllText($pidPath)).Trim();if($text -match '^\d+$'){$candidate=[uint32]$text;for($i=0;$i -lt 6 -and $candidate;$i++){$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$candidate);if(-not $p){break};if($candidate -eq $service.ProcessId){$owned=$text;break};$candidate=$p.ParentProcessId}}}
  if(-not $owned){Start-Sleep -Seconds 1}
 }while(-not $owned -and (Get-Date) -lt $deadline)
 if(-not $owned){throw 'No se pudo verificar el proceso perteneciente al servicio.'}
 $dataDir=Get-UpdateDataDirectory $Root $NodePath
 $control=Get-Content -LiteralPath (Join-Path $dataDir 'maintenance/update.json') -Raw|ConvertFrom-Json
 $runtime=Invoke-UpdateMaintenance $Root $NodePath 'Status' $control.id
 if($runtime.mode -ne 'probe' -or [string]$runtime.pid -ne [string]$owned){throw 'El proceso de prueba no confirmo que las operaciones estan bloqueadas.'}
 $result=Invoke-UpdateNode $NodePath @((Join-Path $Root 'scripts/verificar-instalacion.mjs'),'--root',$Root,'--expected-pid',$owned,'--require-local-ai','--require-voice','--require-maintenance') $Root
 if(-not $result.ok){throw 'La version nueva no supero la verificacion del arranque.'}
 return $result
}
function Get-UpdateDataDirectory([string]$Root,[string]$NodePath){
 $code="const{parseEnv}=require('node:util'),f=require('node:fs'),p=require('node:path');const e=parseEnv(f.readFileSync('.env','utf8'));console.log(JSON.stringify({dataDir:p.resolve(e.DATA_DIR||'data')}));"
 $settings=Invoke-UpdateNode $NodePath @('-e',$code) $Root
 $dir=Assert-UpdatePath $settings.dataDir
 if(-not $dir.StartsWith($Root.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'DATA_DIR debe estar dentro de esta instalacion para poder respaldarlo y restaurarlo automaticamente.'}
 return $dir
}
function Invoke-UpdateMaintenance([string]$Root,[string]$NodePath,[string]$Action,[string]$Id){
 $dir=Get-UpdateDataDirectory $Root $NodePath;$controlDir=Join-Path $dir 'maintenance';$control=Join-Path $controlDir 'update.json'
 if($Action -in @('Drain','Probe','Release')){Protect-UpdateDirectory $controlDir -ServiceRead;Write-UpdateJson $control ([ordered]@{id=$Id;mode=$Action.ToLowerInvariant();requestedAt=[DateTime]::UtcNow.ToString('o')})}
 if($Action -eq 'Probe'){return}
 if($Action -eq 'Offline'){$result=Invoke-UpdateNode $NodePath @('--env-file=.env',(Join-Path $Root 'scripts/update-maintenance.mjs'),'offline-check') $Root;if(-not $result.safe){throw 'Hay operaciones locales pendientes o inciertas. No se puede actualizar.'};return}
 if($Action -eq 'Remove'){if(Test-Path -LiteralPath $control){Remove-Item -LiteralPath $control -Force};return}
 $deadline=(Get-Date).AddSeconds(90)
 do{try{$result=Invoke-UpdateNode $NodePath @('--env-file=.env',(Join-Path $Root 'scripts/update-maintenance.mjs'),'status') $Root;if($result.safe -and $result.id -eq $Id){return $result}}catch{};Start-Sleep -Seconds 1}while((Get-Date) -lt $deadline)
 throw 'No se confirmo el mantenimiento seguro. Se mantiene el bloqueo y no se interrumpen operaciones activas.'
}
function Import-UpdatePackage([string]$PackagePath,[string]$Destination){
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 $zip=[IO.Compression.ZipFile]::OpenRead((Assert-UpdatePath $PackagePath))
 try{
  $names=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase);$total=[long]0
  foreach($entry in $zip.Entries){$name=$entry.FullName;if($name.EndsWith('/')){continue};if(-not $names.Add($name) -or $name -match '[\\:<>"|?*\x00-\x1f]' -or $name.StartsWith('/') -or @($name.Split('/')|Where-Object{$_ -eq '' -or $_ -eq '.' -or $_ -eq '..' -or $_ -match '[.\s]$|^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)'}).Count -or (($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960){throw 'El ZIP contiene rutas o entradas inseguras.'};$total+=$entry.Length;if($names.Count -gt 10000 -or $total -gt 536870912){throw 'El ZIP excede el limite de un paquete de fuentes.'}}
  $manifestEntry=$zip.GetEntry('PACKAGE-MANIFEST.json');if(-not $manifestEntry -or $manifestEntry.Length -gt 4000000){throw 'Falta un manifiesto de actualizacion valido.'}
  $reader=[IO.StreamReader]::new($manifestEntry.Open());try{$raw=$reader.ReadToEnd()}finally{$reader.Dispose()}
  $manifest=$raw|ConvertFrom-Json
  if($manifest.schema -ne 1 -or $manifest.kind -ne 'source' -or $manifest.sensitive -ne $false -or $manifest.working_tree_dirty -ne $false -or $manifest.commit -notmatch '^[a-f0-9]{40}$' -or $manifest.updateProtocol -ne 1){throw 'Elegir un paquete limpio de fuentes con protocolo de actualizacion 1. No se aceptan paquetes privados de traslado.'}
  $records=@($manifest.files.PSObject.Properties);if($names.Count -ne $records.Count+1){throw 'El ZIP contiene archivos adicionales o faltantes.'}
  $rootFiles=@('README.md','AGENTS.md','package.json','package-lock.json','.env.example','.gitignore','iniciar.ps1','abrir-central.ps1','Instalar-servicio.bat','Actualizar-app.bat')
  foreach($record in $records){if(-not $names.Contains($record.Name)){throw 'Falta un archivo del manifiesto.'};$parts=$record.Name.Split('/');if(($parts[0] -notin @('src','public','scripts','docs','test','config') -and $record.Name -notin $rootFiles) -or ($parts[0].StartsWith('.env') -and $record.Name -ne '.env.example') -or $record.Name -match '\.(?:sqlite|db|key|pem|pfx|p12|log|zip)$'){throw 'El paquete intenta reemplazar datos privados o archivos ajenos a la aplicacion.'}}
  foreach($required in @('package.json','package-lock.json','src/server.js','src/maintenance.js','scripts/update-maintenance.mjs','scripts/verificar-instalacion.mjs','scripts/update-release.mjs')){if(-not $names.Contains($required)){throw ('El paquete no es compatible con el arranque protegido: '+$required)}}
  [IO.Directory]::CreateDirectory($Destination)|Out-Null
  foreach($entry in $zip.Entries){if($entry.FullName.EndsWith('/')){continue};$target=[IO.Path]::GetFullPath((Join-Path $Destination $entry.FullName.Replace('/','\')));if(-not $target.StartsWith($Destination.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Ruta fuera de staging.'};[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))|Out-Null;[IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$false)}
 }finally{$zip.Dispose()}
 $checker=Join-Path $PSScriptRoot 'verificar-paquete.ps1'
 & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $checker -Root $Destination|Out-Host
 if($LASTEXITCODE -ne 0){throw 'La integridad del paquete no pudo verificarse.'}
 return $manifest
}
function Prepare-UpdateDependencies([string]$Release,[string]$Root,[string]$NodePath,[string]$Work,[bool]$Offline=$false){
 $npm=Join-Path (Split-Path $NodePath -Parent) 'node_modules/npm/bin/npm-cli.js'
 if(-not(Test-Path -LiteralPath $npm)){throw 'Falta npm junto al runtime Node. El servicio actual no se modifico.'}
 $before=Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw|ConvertFrom-Json
 $after=Get-Content -LiteralPath (Join-Path $Release 'package.json') -Raw|ConvertFrom-Json
 if($before.engines.node -ne $after.engines.node){throw 'La version requiere otro runtime Node. Preparar ese cambio con el instalador antes de actualizar.'}
 foreach($hostFile in @('scripts/windows-service-host.cs','scripts/service-path-access.ps1')){$old=Join-Path $Root $hostFile;$new=Join-Path $Release $hostFile;if((Test-Path -LiteralPath $old) -and (-not(Test-Path -LiteralPath $new) -or (Get-FileHash -LiteralPath $old -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $new -Algorithm SHA256).Hash)){throw 'El paquete cambia el host o permisos del servicio Windows. Usar el instalador durante mantenimiento; no se cambia la app actual.'}}
 Push-Location -LiteralPath $Release
 try{$previous=$ErrorActionPreference;try{$ErrorActionPreference='Continue';$argsNpm=@($npm,'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund','--cache',(Join-Path $Root 'data/install-cache/npm'));if($Offline){$argsNpm+='--offline'}else{$argsNpm+='--prefer-offline'};$null=& $NodePath @argsNpm 2>&1;$exit=$LASTEXITCODE}finally{$ErrorActionPreference=$previous};if($exit -ne 0){throw 'No se pudieron preparar las dependencias. Revisar cache o conectividad; la app actual sigue intacta.'}}finally{Pop-Location}
 return (Join-Path $Release 'node_modules')
}
function Invoke-CentralUpdate([string]$Root,[string]$PackagePath,[string]$NodePath,[switch]$Check,[switch]$Offline){
 $Root=(Assert-UpdatePath $Root).TrimEnd('\');$PackagePath=Assert-UpdatePath $PackagePath
 if(-not(Test-Path -LiteralPath (Join-Path $Root 'scripts/update-maintenance.mjs'))){throw 'La instalacion anterior no tiene mantenimiento protegido. Usar primero el paquete de instalacion actualizado durante mantenimiento.'}
 $dataDir=Get-UpdateDataDirectory $Root $NodePath;$maintenance=Join-Path $dataDir 'maintenance'
 if($Check){
  $priorPath=Join-Path $maintenance 'active-update.json'
  if(Test-Path -LiteralPath $priorPath){try{$prior=Get-Content -LiteralPath $priorPath -Raw|ConvertFrom-Json}catch{throw 'Registro anterior incompleto.'};if($prior.state -notin @('completed','rolled_back','rejected')){throw 'Hay una actualizacion interrumpida. Conservar respaldo y mantenimiento.'}}
  $tempParent=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  $checkWork=Join-Path $tempParent ('ETAR-update-check-'+[guid]::NewGuid().ToString('N'))
  try{$manifest=Import-UpdatePackage $PackagePath $checkWork;$null=Get-UpdateService $Root $NodePath;return [pscustomobject]@{checkOnly=$true;commit=$manifest.commit;service='CentralETAR';changesApplied=$false}}
  finally{if($checkWork.StartsWith($tempParent+'\',[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $checkWork -Leaf).StartsWith('ETAR-update-check-') -and (Test-Path -LiteralPath $checkWork)){Remove-Item -LiteralPath $checkWork -Recurse -Force}}
 }
 Protect-UpdateDirectory $maintenance -ServiceRead
 $lock=[IO.File]::Open((Join-Path $maintenance 'update.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 $journalPath=Join-Path $maintenance 'active-update.json';$stopped=$false;$changed=$false;$committed=$false;$journal=$null;$service=$null
 try{
  if(Test-Path -LiteralPath $journalPath){try{$prior=Get-Content -LiteralPath $journalPath -Raw|ConvertFrom-Json}catch{throw 'El registro de actualizacion anterior esta incompleto. Conservar respaldo y mantenimiento; revisar antes de reintentar.'};if($prior.state -notin @('completed','rolled_back','rejected')){throw 'Hay una actualizacion interrumpida. Se conservan respaldo y bloqueo; revisar el registro antes de iniciar otra.'}}
  $id=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N')
  $parent=Split-Path $Root -Parent;$base=Join-Path $parent '.AgenteETAR-update';$backupBase=Join-Path $parent '.AgenteETAR-backups'
  Protect-UpdateDirectory $base;Protect-UpdateDirectory $backupBase
  $work=Join-Path $base $id;[IO.Directory]::CreateDirectory($work)|Out-Null
  $release=Join-Path $work 'release';$backup=Join-Path $backupBase $id
  $manifest=Import-UpdatePackage $PackagePath $release
  $service=Get-UpdateService $Root $NodePath
  if($service.State -ne 'Running'){throw 'El servicio debe estar iniciado y verificable antes de actualizar.'}
  $modules=Prepare-UpdateDependencies $release $Root $NodePath $work ([bool]$Offline)
  $engine=Join-Path $work 'update-release.mjs';Copy-Item -LiteralPath (Join-Path $Root 'scripts/update-release.mjs') -Destination $engine
  $journal=[ordered]@{id=$id;root=$Root;backup=$backup;work=$work;commit=$manifest.commit;state='draining';at=[DateTime]::UtcNow.ToString('o')}
  Write-UpdateJson $journalPath $journal
  Write-Output 'Poniendo la app en mantenimiento y esperando el fin de operaciones.'|Out-Host
  $null=Invoke-UpdateMaintenance $Root $NodePath 'Drain' $id
  Stop-UpdateService $Root $service;$stopped=$true
  $null=Invoke-UpdateMaintenance $Root $NodePath 'Offline' $id
  $journal.state='backing_up';Write-UpdateJson $journalPath $journal
  $null=Invoke-UpdateNode $NodePath @($engine,'snapshot','--root',$Root,'--backup',$backup,'--data-dir',$dataDir) $Root
  $journal.state='applying';Write-UpdateJson $journalPath $journal;$changed=$true
  $null=Invoke-UpdateNode $NodePath @($engine,'apply','--root',$Root,'--backup',$backup,'--release',$release,'--modules',$modules) $Root
  Restore-UpdateReadAccess $Root
  $null=Invoke-UpdateMaintenance $Root $NodePath 'Probe' $id
  Start-UpdateService $Root $service
  $journal.state='verifying';Write-UpdateJson $journalPath $journal
  $proof=Confirm-UpdateService $Root $NodePath
  $null=Invoke-UpdateNode $NodePath @($engine,'commit','--root',$Root,'--backup',$backup) $Root
  $committed=$true;$journal.state='committed';Write-UpdateJson $journalPath $journal
  $null=Invoke-UpdateMaintenance $Root $NodePath 'Release' $id
  $journal.state='completed';Write-UpdateJson $journalPath $journal
  return [pscustomobject]@{ok=$true;state='completed';commit=$manifest.commit;backup=$backup;verification=$proof}
 }catch{
  $failure=$_.Exception.Message
  if($stopped -and -not $committed){
   try{
    Stop-UpdateService $Root $service
    if($changed){$null=Invoke-UpdateNode $NodePath @($engine,'rollback','--root',$Root,'--backup',$backup) $Root;Restore-UpdateReadAccess $Root}
    $null=Invoke-UpdateMaintenance $Root $NodePath 'Probe' $id
    Start-UpdateService $Root $service
    $null=Confirm-UpdateService $Root $NodePath
    $null=Invoke-UpdateMaintenance $Root $NodePath 'Release' $id
    $journal.state='rolled_back';$journal.failure=$failure;Write-UpdateJson $journalPath $journal
    throw ('La actualizacion fallo. Se restauro y verifico la version anterior. Respaldo: '+$backup)
   }catch{if($journal.state -eq 'rolled_back'){throw};$journal.state='rollback_failed';Write-UpdateJson $journalPath $journal;throw ('No pudo completarse la restauracion. Se conserva el mantenimiento y el respaldo en '+$backup+'. No volver a ejecutar operaciones hasta revisar el registro.')}
  }
  if($journal -and $committed){$journal.state='activation_pending';Write-UpdateJson $journalPath $journal;throw 'La version arranco y se confirmo, pero no se verifico la activacion final. Se conserva el registro; no se retrocede la base tras permitir operaciones.'}
  throw $failure
 }finally{$lock.Dispose()}
}

if(-not $Library){
 try{
  $root=Split-Path $PSScriptRoot -Parent
  if(-not $PackagePath){Add-Type -AssemblyName System.Windows.Forms;$picker=New-Object Windows.Forms.OpenFileDialog;$picker.Title='Elegir paquete de fuentes de AgenteETAR';$picker.Filter='Paquete de fuentes (*.zip)|*.zip';if($picker.ShowDialog() -ne 'OK'){throw 'No se eligio un paquete. No se cambio la app.'};$PackagePath=$picker.FileName}
  $PackagePath=[IO.Path]::GetFullPath($PackagePath)
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent();$admin=([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if(-not $Check -and -not $admin){
   if($PackagePath.Contains('"') -or $PackagePath.Contains("`n") -or $PackagePath.Contains("`r")){throw 'Ruta de paquete invalida.'}
   $arguments='-NoProfile -STA -ExecutionPolicy Bypass -File "'+$PSCommandPath+'" -PackagePath "'+$PackagePath+'"'
   if($Offline){$arguments+=' -Offline'}
   $attemptStarted=[DateTime]::UtcNow
   $process=Start-Process -FilePath powershell.exe -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
   $resultPath=Join-Path $root 'data/update-last-result.json';if((Test-Path -LiteralPath $resultPath) -and (Get-Item -LiteralPath $resultPath).LastWriteTimeUtc -ge $attemptStarted){$last=Get-Content -LiteralPath $resultPath -Raw|ConvertFrom-Json;Write-Output $last.message}else{Write-Output 'Windows no devolvio el resultado de esta actualizacion. Revisar maintenance/active-update.json antes de reintentar.';exit 1};exit $process.ExitCode
  }
  $node=Join-Path $root 'data/node-runtime/node.exe';if(-not(Test-Path -LiteralPath $node)){$command=Get-Command node.exe -ErrorAction Stop;$node=$command.Source}
  $result=Invoke-CentralUpdate $root $PackagePath $node -Check:$Check -Offline:$Offline
  $message=if($Check){'Paquete verificado. No se detuvo ni actualizo la app.'}else{'Actualizacion completada y verificada. Respaldo: '+$result.backup}
  if(-not $Check){Write-UpdateJson (Join-Path $root 'data/update-last-result.json') ([ordered]@{ok=$true;at=[DateTime]::UtcNow.ToString('o');message=$message;backup=$result.backup;commit=$result.commit})}
  Write-Output $message
 }catch{$message=$_.Exception.Message;if(-not $Check -and $admin){try{Write-UpdateJson (Join-Path $root 'data/update-last-result.json') ([ordered]@{ok=$false;at=[DateTime]::UtcNow.ToString('o');message=$message})}catch{}};Write-Host $message -ForegroundColor Red;exit 1}
}
