$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node.exe).Source
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ('Central actualizacion ' + [char]0x00f1 + ' ' + [guid]::NewGuid().ToString('N'))
function Assert-True($Value, [string]$Message) { if (-not $Value) { throw $Message } }
function Write-FixtureFile([string]$Root, [string]$Name, [string]$Content) {
    $path = Join-Path $Root $Name
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path)) | Out-Null
    [IO.File]::WriteAllText($path, $Content, [Text.UTF8Encoding]::new($false))
}
function Get-FixtureHash([string]$Root, [string]$Name) { (Get-FileHash -LiteralPath (Join-Path $Root $Name) -Algorithm SHA256).Hash }
function New-SourceArchive([string]$Name, [hashtable]$Extra = @{}, [int]$Protocol = 1, [bool]$Dirty = $false) {
    $source = Join-Path $temporaryRoot ($Name + '-source')
    $files = @{
        'package.json' = '{"name":"update-fixture","version":"2.0.0","type":"module","dependencies":{}}'
        'package-lock.json' = '{"name":"update-fixture","version":"2.0.0","lockfileVersion":3,"packages":{"":{"name":"update-fixture","version":"2.0.0"}}}'
        'src/server.js' = '// Fixture de version nueva: nunca abre puertos.'
        'config/mapping.json' = '{"packageDefault":"must-not-replace-local"}'
    }
    foreach ($asset in @('src/maintenance.js','scripts/update-maintenance.mjs','scripts/verificar-instalacion.mjs','scripts/update-release.mjs')) { $files[$asset] = [IO.File]::ReadAllText((Join-Path $repo $asset)) }
    foreach ($key in $Extra.Keys) { $files[$key] = $Extra[$key] }
    $records = [ordered]@{}
    foreach ($key in $files.Keys) {
        Write-FixtureFile $source $key $files[$key]
        $path = Join-Path $source $key
        $records[$key] = @{size = (Get-Item -LiteralPath $path).Length; sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}
    }
    Write-FixtureFile $source 'PACKAGE-MANIFEST.json' (@{schema = 1; kind = 'source'; sensitive = $false; working_tree_dirty = $Dirty; commit = ('1' * 40); updateProtocol = $Protocol; version = '2.0.0'; files = $records} | ConvertTo-Json -Depth 12)
    $zip = Join-Path $temporaryRoot ($Name + '.zip')
    $archive = [IO.Compression.ZipFile]::Open($zip, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($archiveName in @($files.Keys) + @('PACKAGE-MANIFEST.json')) {
            $entry = $archive.CreateEntry($archiveName)
            $input = [IO.File]::OpenRead((Join-Path $source $archiveName)); $output = $entry.Open()
            try { $input.CopyTo($output) } finally { $input.Dispose(); $output.Dispose() }
        }
    } finally { $archive.Dispose() }
    return $zip
}
function New-InstalledFixture([string]$Name) {
    $path = Join-Path $temporaryRoot $Name
    Write-FixtureFile $path 'package.json' '{"name":"update-fixture","version":"1.0.0","type":"module","dependencies":{}}'
    Write-FixtureFile $path 'package-lock.json' '{"lockfileVersion":3}'
    Write-FixtureFile $path 'src/server.js' '// Version anterior: nunca abre puertos.'
    Write-FixtureFile $path 'src/obsolete.js' '// Debe volver con rollback.'
    Write-FixtureFile $path '.env' "API_READ_KEY=secreto-fixture-no-imprimir`r`nDATA_DIR=data`r`n"
    Write-FixtureFile $path 'config/mapping.json' '{"branches":["0101"],"local":true}'
    Write-FixtureFile $path 'config/roles.json' '{"administrador":["compras"],"persona":"fixture"}'
    Write-FixtureFile $path 'data/tls/private.pfx' 'TLS-PRIVADO-FIXTURE'
    Write-FixtureFile $path 'node_modules/local-fixture/index.js' '// Dependencias anteriores.'
    [IO.Directory]::CreateDirectory((Join-Path $path 'scripts')) | Out-Null
    foreach ($file in @('update-release.mjs', 'update-maintenance.mjs')) {
        Copy-Item -LiteralPath (Join-Path $repo ('scripts/' + $file)) -Destination (Join-Path $path ('scripts/' + $file)) -Force
    }
    Copy-Item -LiteralPath (Join-Path $repo 'src/maintenance.js') -Destination (Join-Path $path 'src/maintenance.js')
    $database = Join-Path $path 'data/agent.sqlite'
    $createDatabase = @'
import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(process.argv[2]);
db.exec("CREATE TABLE users(id TEXT,role TEXT); INSERT INTO users VALUES ('persona','administrador'); CREATE TABLE executions(status TEXT); CREATE TABLE migration_marker(version INTEGER); INSERT INTO migration_marker VALUES(1);");db.close();
'@
    $createDatabase | & $node --input-type=module - $database
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear SQLite de prueba.' }
    return $path
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$updater = Join-Path $repo 'scripts/actualizar-app-windows.ps1'
$tokens = $null; $parseErrors = $null
[Management.Automation.Language.Parser]::ParseFile($updater, [ref]$tokens, [ref]$parseErrors) | Out-Null
Assert-True ($parseErrors.Count -eq 0) 'El actualizador no tiene sintaxis valida para PowerShell 5.1.'
. $updater -Library
$script:productionStopUpdateService = (Get-Command Stop-UpdateService).ScriptBlock
$script:fixtureEvents = [Collections.Generic.List[string]]::new()
$script:fixtureBlocked = $false
$script:fixtureVerifyFailures = 0
$script:fixtureStartFailures = 0
function Assert-FixtureRoot([string]$Root) {
    $full = [IO.Path]::GetFullPath($Root)
    Assert-True ($full.StartsWith($temporaryRoot + '\', [StringComparison]::OrdinalIgnoreCase)) 'El doble recibio una instalacion fuera de TEMP.'
}
function Get-UpdateService([string]$Root, [string]$NodePath) {
    Assert-FixtureRoot $Root
    $script:fixtureEvents.Add('get-service')
    [pscustomobject]@{Name='CentralETAR';State='Running';PathName='fixture';ProcessId=999999;StartName='NT AUTHORITY\LocalService'}
}
function Stop-UpdateService([string]$Root, $Service) { Assert-FixtureRoot $Root; $script:fixtureEvents.Add('stop') }
function Start-UpdateService([string]$Root, $Service) {
    Assert-FixtureRoot $Root; $script:fixtureEvents.Add('start')
    if ($script:fixtureStartFailures -gt 0) { $script:fixtureStartFailures--; throw 'Fallo simulado al iniciar la version nueva.' }
}
function Restore-UpdateReadAccess([string]$Root) { Assert-FixtureRoot $Root; $script:fixtureEvents.Add('acl') }
function Invoke-UpdateMaintenance([string]$Root, [string]$NodePath, [string]$Action, [string]$Id) {
    Assert-FixtureRoot $Root
    $script:fixtureEvents.Add('gate:' + $Action)
    if ($script:fixtureBlocked -and $Action -in @('Drain','Status')) { throw 'Hay una ejecucion activa: rechazo simulado antes de detener servicio.' }
    [pscustomobject]@{safe=$true;status='quiescent';id=$Id;pid=999999;durable=@{executions=0}}
}
function Prepare-UpdateDependencies([string]$Release, [string]$Root, [string]$NodePath, [string]$Work) {
    Assert-FixtureRoot $Root
    $modules = Join-Path $Work 'fixture-node_modules'
    Write-FixtureFile $modules 'local-fixture/index.js' '// Dependencias nuevas.'
    return $modules
}
function Confirm-UpdateService([string]$Root, [string]$NodePath) {
    Assert-FixtureRoot $Root
    $script:fixtureEvents.Add('verify')
    if ($script:fixtureVerifyFailures -gt 0) {
        $script:fixtureVerifyFailures--
        $migration = @'
import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(process.argv[2]);db.exec("UPDATE migration_marker SET version=2; DELETE FROM users; CREATE TABLE new_migration_table(value TEXT);");db.close();
'@
        $migration | & $node --input-type=module - (Join-Path $Root 'data/agent.sqlite')
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo simular una migracion de SQLite.' }
        throw 'La version nueva no supero la verificacion simulada.'
    }
    [pscustomobject]@{ok=$true;pid=999999}
}
function Invoke-FixtureUpdate([string]$Root, [string]$Zip, [switch]$Check) {
    Invoke-CentralUpdate -Root $Root -PackagePath $Zip -NodePath $node -Check:$Check
}
function Get-LocalHashes([string]$Root) {
    $hashes = @{}
    foreach ($name in @('.env','config/mapping.json','config/roles.json','data/tls/private.pfx')) { $hashes[$name] = Get-FixtureHash $Root $name }
    $hashes['sqlite-state'] = Get-FixtureDatabaseState $Root
    return $hashes
}
function Get-FixtureDatabaseState([string]$Root) {
    $inspect = @'
import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(process.argv[2],{readOnly:true});console.log(JSON.stringify({integrity:db.prepare('PRAGMA integrity_check').get(),schema:db.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all(),users:db.prepare('SELECT * FROM users ORDER BY id').all(),migration:db.prepare('SELECT * FROM migration_marker').all()}));db.close();
'@
    $result = $inspect | & $node --input-type=module - (Join-Path $Root 'data/agent.sqlite')
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo verificar SQLite.' }
    return ($result -join "`n")
}
function Assert-LocalHashes([string]$Root, [hashtable]$Before) {
    foreach ($name in $Before.Keys) {
        if ($name -eq 'sqlite-state') { Assert-True ((Get-FixtureDatabaseState $Root) -eq $Before[$name]) 'Se modificaron usuarios, permisos, esquema o migraciones SQLite.' }
        else { Assert-True ((Get-FixtureHash $Root $name) -eq $Before[$name]) ('Se modificaron bytes locales: ' + $name) }
    }
}
try {
    [IO.Directory]::CreateDirectory($temporaryRoot) | Out-Null
    # Exercise the production stopping helper in a child scope. Every CIM call
    # is intercepted; a stopped SCM with PID zero must never enumerate PID 0.
    & {
        $stopRoot = Join-Path $temporaryRoot 'servicio ya detenido'
        [IO.Directory]::CreateDirectory($stopRoot) | Out-Null
        $script:stopFixtureCimCalls = 0
        function Get-UpdateService { param($Root,$NodePath) [pscustomobject]@{State='Stopped';ProcessId=0} }
        function Get-CimInstance {
            param($ClassName,$Filter)
            $script:stopFixtureCimCalls++
            Assert-True ($ClassName -eq 'Win32_Process' -and $Filter -eq 'ProcessId=999998') 'SCM detenido intento enumerar procesos del sistema.'
            [pscustomobject]@{Name='node.exe';CommandLine='node src/server.js'}
        }
        & $script:productionStopUpdateService -Root $stopRoot -Service $null
        Assert-True ($script:stopFixtureCimCalls -eq 0) 'SCM detenido con PID cero consulto procesos sin un PID registrado.'
        Write-FixtureFile $stopRoot 'data/server.pid' '999998'
        $refused = $false
        try { & $script:productionStopUpdateService -Root $stopRoot -Service $null } catch { $refused = $true }
        Assert-True ($refused -and $script:stopFixtureCimCalls -eq 1) 'SCM detenido no rechazo al servidor registrado que seguia vivo.'
    }
    $consoleEncoding = [Console]::OutputEncoding.CodePage
    $originalLocation = (Get-Location).Path
    $unicode = Invoke-UpdateNode $node @('-e',"console.log(JSON.stringify({value:String.fromCharCode(241)}))") $temporaryRoot
    Assert-True ($unicode.value -eq [string][char]241 -and [Console]::OutputEncoding.CodePage -eq $consoleEncoding) 'La decodificacion UTF8 no conservo Unicode o cambio la consola.'
    $failed = $false
    try { $null = Invoke-UpdateNode $node @('-e','process.exit(3)') $temporaryRoot } catch { $failed = $true }
    Assert-True ($failed -and [Console]::OutputEncoding.CodePage -eq $consoleEncoding -and (Get-Location).Path -eq $originalLocation) 'El fallo Node no restauro la codificacion o carpeta actual.'
    $zip = New-SourceArchive 'fuentes'
    $success = New-InstalledFixture 'instalacion correcta'
    $before = Get-LocalHashes $success
    $preview = Invoke-FixtureUpdate $success $zip -Check
    Assert-LocalHashes $success $before
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $success 'data/maintenance'))) 'Check creo controles o bloqueos en la instalacion.'
    Assert-True ($script:fixtureEvents -notcontains 'stop' -and $script:fixtureEvents -notcontains 'start') 'Check detuvo o inicio un servicio.'
    $script:fixtureEvents.Clear()
    $output = Invoke-FixtureUpdate $success $zip
    Assert-LocalHashes $success $before
    Assert-True (([IO.File]::ReadAllText((Join-Path $success 'package.json')) | ConvertFrom-Json).version -eq '2.0.0') 'No se aplico la version nueva.'
    Assert-True ((Get-Content -LiteralPath (Join-Path $success 'node_modules/local-fixture/index.js') -Raw) -match 'nuevas') 'No se instalaron dependencias preparadas.'
    Assert-True ($script:fixtureEvents -contains 'stop' -and $script:fixtureEvents -contains 'start' -and $script:fixtureEvents -contains 'verify') 'El flujo no detuvo/inicio/verifico su servicio simulado.'

    $rollback = New-InstalledFixture 'instalacion rollback'
    $before = Get-LocalHashes $rollback
    $sourceHash = Get-FixtureHash $rollback 'src/server.js'
    $modulesHash = Get-FixtureHash $rollback 'node_modules/local-fixture/index.js'
    $script:fixtureEvents.Clear(); $script:fixtureVerifyFailures = 1
    $failed = $false
    try { $null = Invoke-FixtureUpdate $rollback $zip } catch { $failed = $true }
    Assert-True $failed 'El fallo de verificacion no se informo al operador.'
    Assert-LocalHashes $rollback $before
    Assert-True ((Get-FixtureHash $rollback 'src/server.js') -eq $sourceHash) 'Rollback no restauro las fuentes anteriores.'
    Assert-True ((Get-FixtureHash $rollback 'node_modules/local-fixture/index.js') -eq $modulesHash) 'Rollback no restauro dependencias anteriores.'
    Assert-True (Test-Path -LiteralPath (Join-Path $rollback 'src/obsolete.js')) 'Rollback perdio una fuente eliminada por la version nueva.'
    Assert-True (@($script:fixtureEvents | Where-Object { $_ -eq 'stop' }).Count -ge 2) 'Rollback restauro archivos sin detener primero la version fallida.'
    Assert-True (@($script:fixtureEvents | Where-Object { $_ -eq 'verify' }).Count -eq 2) 'Rollback no verifico la version anterior.'

    $startFailure = New-InstalledFixture 'instalacion fallo arranque'
    $before = Get-LocalHashes $startFailure
    $sourceHash = Get-FixtureHash $startFailure 'src/server.js'
    $modulesHash = Get-FixtureHash $startFailure 'node_modules/local-fixture/index.js'
    $script:fixtureEvents.Clear(); $script:fixtureStartFailures = 1; $failed = $false
    try { $null = Invoke-FixtureUpdate $startFailure $zip } catch { $failed = $true }
    Assert-True $failed 'No se informo el fallo de arranque.'
    Assert-LocalHashes $startFailure $before
    Assert-True ((Get-FixtureHash $startFailure 'src/server.js') -eq $sourceHash -and (Get-FixtureHash $startFailure 'node_modules/local-fixture/index.js') -eq $modulesHash) 'El fallo de arranque no restauro fuentes y dependencias.'
    Assert-True (@($script:fixtureEvents | Where-Object { $_ -eq 'start' }).Count -eq 2 -and @($script:fixtureEvents | Where-Object { $_ -eq 'verify' }).Count -eq 1) 'No se reinicio y verifico la version anterior tras el fallo de arranque.'

    $blocked = New-InstalledFixture 'instalacion ocupada'
    $before = Get-LocalHashes $blocked
    $script:fixtureEvents.Clear(); $script:fixtureBlocked = $true
    $failed = $false
    try { $null = Invoke-FixtureUpdate $blocked $zip } catch { $failed = $true }
    $script:fixtureBlocked = $false
    Assert-True $failed 'Se acepto mantenimiento con una ejecucion activa.'
    Assert-True ($script:fixtureEvents -notcontains 'stop') 'Se detuvo un servicio con ejecuciones activas.'
    Assert-LocalHashes $blocked $before

    $legacy = New-InstalledFixture 'instalacion anterior sin mantenimiento'
    Remove-Item -LiteralPath (Join-Path $legacy 'scripts/update-maintenance.mjs') -Force
    $script:fixtureEvents.Clear(); $failed = $false
    try { $null = Invoke-FixtureUpdate $legacy $zip } catch { $failed = $true }
    Assert-True $failed 'Se acepto actualizar un servidor activo sin protocolo de mantenimiento.'
    Assert-True ($script:fixtureEvents -notcontains 'stop') 'Se detuvo la instalacion antigua antes de comprobar mantenimiento.'

    foreach ($journal in @('{"state":"applying","id":"interrupted"}', '{broken json')) {
        $interrupted = New-InstalledFixture ('interrumpida-' + [guid]::NewGuid().ToString('N'))
        Write-FixtureFile $interrupted 'data/maintenance/active-update.json' $journal
        $script:fixtureEvents.Clear(); $failed = $false
        try { $null = Invoke-FixtureUpdate $interrupted $zip } catch { $failed = $true }
        Assert-True $failed 'Se acepto un journal interrumpido o ilegible.'
        Assert-True ($script:fixtureEvents -notcontains 'get-service' -and $script:fixtureEvents -notcontains 'stop') 'Un journal pendiente permitio consultar o detener el servicio.'
        Assert-True ([IO.File]::ReadAllText((Join-Path $interrupted 'data/maintenance/active-update.json')) -eq $journal) 'Se borro evidencia de la actualizacion interrumpida.'
    }

    $unsafeZip = Join-Path $temporaryRoot 'zip-inseguro.zip'
    $archive = [IO.Compression.ZipFile]::Open($unsafeZip, [IO.Compression.ZipArchiveMode]::Create)
    try {
        $entry = $archive.CreateEntry('../outside.txt')
        $writer = [IO.StreamWriter]::new($entry.Open())
        try { $writer.Write('no debe salir del ZIP') } finally { $writer.Dispose() }
    } finally { $archive.Dispose() }
    $script:fixtureEvents.Clear(); $failed = $false
    try { $null = Invoke-FixtureUpdate $success $unsafeZip -Check } catch { $failed = $true }
    Assert-True $failed 'Se acepto una ruta ZIP que sale del paquete.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $temporaryRoot 'outside.txt'))) 'La extraccion escribio fuera de su carpeta.'
    foreach ($invalid in @((New-SourceArchive 'sin-protocolo' -Protocol 0), (New-SourceArchive 'fuentes-sucias' -Dirty $true))) {
        $script:fixtureEvents.Clear(); $failed = $false
        try { $null = Invoke-FixtureUpdate $success $invalid -Check } catch { $failed = $true }
        Assert-True $failed 'Se acepto un paquete sin protocolo o con fuentes no publicadas.'
        Assert-True ($script:fixtureEvents -notcontains 'stop') 'Se detuvo el servicio al rechazar fuentes inseguras.'
    }
    Write-Output 'Actualizacion y rollback verificados; configuracion y TLS byte por byte; usuarios, roles, esquema y migraciones SQLite preservados. SCM simulado; solo carpetas temporales.'
} finally {
    $resolvedTemp = [IO.Path]::GetFullPath($temporaryRoot)
    $tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolvedTemp.StartsWith($tempParent, [StringComparison]::OrdinalIgnoreCase)) { throw 'Ruta temporal fuera del directorio esperado.' }
    if (Test-Path -LiteralPath $resolvedTemp) { Remove-Item -LiteralPath $resolvedTemp -Recurse -Force }
}
