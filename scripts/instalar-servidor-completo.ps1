param([switch]$PrepareOnly,[switch]$InstallOnly,[switch]$Offline,[switch]$LocalOnly,[string]$LanAddress,[string]$LanSubnet,[string]$LanDnsName=$env:COMPUTERNAME.ToLowerInvariant())
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$powershell=Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
$installerResult=Join-Path $root 'data/install-last-result.json'
function Save-InstallResult([bool]$Ok,[string]$Message){
 [IO.Directory]::CreateDirectory((Join-Path $root 'data'))|Out-Null
 [ordered]@{ok=$Ok;checkedAt=[DateTime]::UtcNow.ToString('o');message=$Message}|ConvertTo-Json|Set-Content -LiteralPath $installerResult -Encoding utf8
}
if($PSVersionTable.PSEdition -eq 'Desktop'){$env:PSModulePath=@((Join-Path $env:ProgramFiles 'WindowsPowerShell/Modules'),(Join-Path $PSHOME 'Modules')) -join ';'}
function Run-Script([string]$Name,[string[]]$Arguments=@()){
 & $powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot $Name) @Arguments
 if($LASTEXITCODE -ne 0){throw ('No se completo '+$Name+'. Revisar el mensaje anterior; no se confirma una instalacion correcta.')}
}
function Protect-Private([string]$Path,[switch]$Directory){
 if(-not(Test-Path -LiteralPath $Path)){return}
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 $rights=if($Directory){'(OI)(CI)(F)'}else{'(F)'}
 & icacls.exe $Path /inheritance:r /grant:r "*${sid}:$rights" "*S-1-5-18:$rights" "*S-1-5-32-544:$rights" | Out-Null
 if($LASTEXITCODE -ne 0){throw 'No se pudieron proteger los archivos privados.'}
}
try{
 if(($LanAddress -and -not $LanSubnet) -or ($LanSubnet -and -not $LanAddress)){throw 'Indicar juntos -LanAddress y -LanSubnet para elegir una red explicitamente.'}
 if(-not(Test-Path -LiteralPath (Join-Path $root '.env'))){throw 'Falta .env. Usar el paquete PRIVADO de traslado, o completar .env.example localmente. No se inventan credenciales.'}
 $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
 $admin=([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
 if(-not $PrepareOnly -and -not $admin){
  foreach($value in @($PSCommandPath,$LanAddress,$LanSubnet,$LanDnsName)){if($value -and ($value.Contains('"') -or $value.Contains("`n") -or $value.Contains("`r"))){throw 'Argumento de instalacion invalido.'}}
  $arguments='-NoProfile -ExecutionPolicy Bypass -File "'+$PSCommandPath+'"'
  foreach($entry in @(@('InstallOnly',$InstallOnly),@('Offline',$Offline),@('LocalOnly',$LocalOnly))){if($entry[1]){$arguments+=' -'+$entry[0]}}
  foreach($entry in @(@('LanAddress',$LanAddress),@('LanSubnet',$LanSubnet),@('LanDnsName',$LanDnsName))){if($entry[1]){$arguments+=' -'+$entry[0]+' "'+$entry[1]+'"'}}
  Write-Output 'Acepta el aviso de Windows. Se prepararan los componentes y se verificara el servicio; puede demorar varios minutos.'
  $attemptStarted=[DateTime]::UtcNow
  $elevated=Start-Process -FilePath $powershell -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
  if((Test-Path -LiteralPath $installerResult) -and (Get-Item -LiteralPath $installerResult).LastWriteTimeUtc -ge $attemptStarted){$lastResult=Get-Content -LiteralPath $installerResult -Raw|ConvertFrom-Json;Write-Output $lastResult.message}
  elseif($elevated.ExitCode -ne 0){Write-Output 'Windows no completo la instalacion administrativa. Revisar la autorizacion del sistema y volver a ejecutar el BAT.'}
  exit $elevated.ExitCode
 }
 # Ninguna dependencia se instala ni se cambia .env de una app en servicio.
 $existing=Get-CimInstance Win32_Service -Filter "Name='CentralETAR'"
 if($existing -and $existing.State -eq 'Running' -and (-not $PrepareOnly -or $existing.PathName.Contains($root))){throw 'CentralETAR ya esta activo. Para actualizar, usar una ventana de mantenimiento y detenerlo primero. No se interrumpio el servicio.'}
 $legacy=Get-ScheduledTask -TaskName 'Central ETAR - Inicio automatico' -ErrorAction SilentlyContinue
 if($legacy -and $legacy.State -eq 'Running' -and (-not $PrepareOnly -or @($legacy.Actions|Where-Object{$_.WorkingDirectory -eq $root -or ($_.Arguments -and $_.Arguments.Contains($root))}).Count)){throw 'La tarea anterior sigue activa. No se cambian dependencias ni configuracion durante su ejecucion.'}
 $active=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'"|Where-Object{$_.CommandLine -and $_.CommandLine.Contains($root) -and ($_.CommandLine -match 'auto-start\.mjs|src[\\/]server\.js')})
 if($active.Count){throw 'Hay procesos de esta instalacion activos. Detenerlos durante mantenimiento antes de preparar el servidor.'}
 $serverPidPath=Join-Path $root 'data/server.pid'
 if(Test-Path -LiteralPath $serverPidPath){$serverIdText=([IO.File]::ReadAllText($serverPidPath)).Trim();if($serverIdText -match '^\d+$'){$priorServer=Get-CimInstance Win32_Process -Filter "ProcessId=$serverIdText";if($priorServer -and $priorServer.Name -eq 'node.exe' -and $priorServer.CommandLine -match 'src[\\/]server\.js'){throw 'El servidor de esta carpeta sigue activo. No se modifico la instalacion.'}}}
 $statusPath=Join-Path $root 'data/autostart.status.json'
 if(Test-Path -LiteralPath $statusPath){
  $status=Get-Content -LiteralPath $statusPath -Raw|ConvertFrom-Json
  if($status.pid){$prior=Get-Process -Id ([int]$status.pid) -ErrorAction SilentlyContinue;if($prior){throw 'Hay un supervisor activo en esta carpeta. No se cambian dependencias ni configuracion mientras esta en uso.'}}
 }
 if(Test-Path -LiteralPath (Join-Path $root 'PACKAGE-MANIFEST.json')){
  $packageArgs=@();if(Test-Path -LiteralPath (Join-Path $root 'data/install-target.json')){$packageArgs+='-Installed'}
  Run-Script 'verificar-paquete.ps1' $packageArgs
 }
 Protect-Private (Join-Path $root '.env')
 Write-Output '1/4 Preparando Node, dependencias, IA local y voz. Puede demorar en la primera instalacion.'
 $dependencyArgs=@('-Json');if($Offline){$dependencyArgs+='-SkipDownloads'}
 $dependencyOutput=& $powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'preparar-dependencias-windows.ps1') @dependencyArgs
 if($LASTEXITCODE -ne 0){Write-Output $dependencyOutput;throw 'Faltan dependencias. Se conservo la configuracion; corregir el problema y volver a ejecutar el BAT.'}
 try{$dependencies=($dependencyOutput -join "`n")|ConvertFrom-Json}catch{throw 'No se pudo leer el resultado de dependencias.'}
 if(-not $dependencies.ready -or -not $dependencies.nodePath){throw 'La preparacion de dependencias no confirmo Node, IA y voz.'}
 $node=$dependencies.nodePath
 Write-Output '2/4 Adaptando rutas y protegiendo la configuracion del traslado.'
 & $node (Join-Path $PSScriptRoot 'prepare-server-config.mjs') --root $root
 if($LASTEXITCODE -ne 0){throw 'No se pudo adaptar la configuracion al nuevo servidor.'}
 Protect-Private (Join-Path $root 'data/install-backups') -Directory
 Protect-Private (Join-Path $root '.env')
 # Revalidar tras normalizar la configuracion: el paquete usa siempre IA local.
 $dependencyOutput=& $powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'preparar-dependencias-windows.ps1') @dependencyArgs
 if($LASTEXITCODE -ne 0){Write-Output $dependencyOutput;throw 'La configuracion trasladada no tiene disponibles todas las dependencias locales.'}
 if($PrepareOnly){Write-Output 'Dependencias y configuracion preparadas. No se registro, inicio ni detuvo ningun servicio. Ejecutar el BAT sin --prepare-only para completar.';exit 0}
 $settingsCode="import{parseEnv}from'node:util';import{readFileSync}from'node:fs';const e=parseEnv(readFileSync(process.argv[1],'utf8'));console.log(JSON.stringify({lan:e.LAN_HTTPS_ENABLED==='true',port:Number(e.LAN_PORT||4311)}));"
 $network=(& $node --input-type=module -e $settingsCode (Join-Path $root '.env'))|ConvertFrom-Json
 if($LocalOnly -and $network.lan){$envFile=Join-Path $root '.env';$content=[regex]::Replace([IO.File]::ReadAllText($envFile),'(?m)^LAN_HTTPS_ENABLED=[^\r\n]*','LAN_HTTPS_ENABLED=false');[IO.File]::WriteAllText($envFile,$content);$network.lan=$false}
 if(-not $network.lan -and -not $LocalOnly){
  if(-not $LanAddress -or -not $LanSubnet){
   $candidates=@(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' -and $_.AddressState -eq 'Preferred' -and $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL'})
   if($candidates.Count -ne 1){throw 'Hay varias redes o ninguna IPv4 privada. Ejecutar scripts/instalar-servidor-completo.ps1 con -LanAddress IP -LanSubnet RED/PREFIJO; -LocalOnly instala solo para este servidor.'}
   $selected=$candidates[0];if(-not $LanAddress){$LanAddress=$selected.IPAddress}
   if(-not $LanSubnet){$bytes=[Net.IPAddress]::Parse($selected.IPAddress).GetAddressBytes();$prefix=[int]$selected.PrefixLength;for($i=0;$i -lt 4;$i++){$bits=[Math]::Min(8,[Math]::Max(0,$prefix-8*$i));$bytes[$i]=$bytes[$i] -band (256-[Math]::Pow(2,8-$bits))};$LanSubnet=([Net.IPAddress]::new($bytes)).ToString()+'/'+$prefix}
  }
  Run-Script 'configurar-red-servidor.ps1' @('-Address',$LanAddress,'-Subnet',$LanSubnet,'-DnsName',$LanDnsName,'-Port',[string]$network.port,'-NodePath',$node)
 }
 Write-Output '3/4 Configurando el servicio Windows con inicio automatico.'
 $serviceArgs=@('-NodePath',$node,'-RequireLocalAI','-RequireVoice');if($InstallOnly){$serviceArgs+='-InstallOnly'}
 Run-Script 'instalar-servicio-windows.ps1' $serviceArgs
 if($InstallOnly){Save-InstallResult $true 'Servicio preparado y detenido, sin prueba de arranque. Ejecutar el BAT sin --install-only durante el traslado definitivo.';Write-Output 'Servicio preparado y detenido, sin prueba de arranque. Ejecutar el BAT sin --install-only durante el traslado definitivo.';exit 0}
 Write-Output '4/4 Servicio verificado: version, proceso, IA local y voz respondieron. Estado en data/installation-verification.json.'
 Write-Output 'Para acceder desde otras PC, distribuir solo data/lan-client e ingresar con usuario personal. El paquete PRIVADO contiene secretos: no compartirlo con usuarios.'
 Write-Output 'El traslado inicia en modo consultivo. Desactivar el servidor anterior antes de reactivar escrituras, escalamiento y avisos push segun docs/instalacion-otro-servidor.md.'
 Save-InstallResult $true 'Servicio instalado y verificado con IA local y voz. Ver data/installation-verification.json y data/lan-client/LEEME.txt. El traslado inicia en modo consultivo.'
}catch{$failure='Instalacion incompleta: '+$_.Exception.Message;if(-not $PrepareOnly -and $admin){try{Save-InstallResult $false $failure}catch{}};Write-Host $failure -ForegroundColor Red;exit 1}
