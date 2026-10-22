$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node.exe).Source
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ('Central prueba ' + [char]0x00f1 + ' ' + [guid]::NewGuid().ToString('N'))
try {
    [IO.Directory]::CreateDirectory((Join-Path $temporaryRoot 'scripts')) | Out-Null
    [IO.Directory]::CreateDirectory((Join-Path $temporaryRoot 'src')) | Out-Null
    [IO.Directory]::CreateDirectory((Join-Path $temporaryRoot 'public')) | Out-Null
    [IO.Directory]::CreateDirectory((Join-Path $temporaryRoot 'config')) | Out-Null
    foreach ($file in @('instalar-servicio-windows.ps1', 'windows-service-host.cs', 'service-path-access.ps1')) {
        Copy-Item -LiteralPath (Join-Path $root "scripts/$file") -Destination (Join-Path $temporaryRoot "scripts/$file")
    }
    Copy-Item -LiteralPath (Join-Path $root 'Instalar-servicio.bat') -Destination $temporaryRoot
    foreach ($file in @('scripts/auto-start.mjs', 'src/server.js', 'src/service-supervisor.js')) {
        '// Fixture: no ejecutar.' | Set-Content -LiteralPath (Join-Path $temporaryRoot $file)
    }
    "import './nested.js';" | Set-Content -LiteralPath (Join-Path $temporaryRoot 'src/server.js')
    '// Fixture: no ejecutar.' | Set-Content -LiteralPath (Join-Path $temporaryRoot 'src/nested.js')
    '# Fixture: no ejecutar.' | Set-Content -LiteralPath (Join-Path $temporaryRoot 'scripts/transcribe.py')
    '<script type="module" src="/app.js"></script>' | Set-Content -LiteralPath (Join-Path $temporaryRoot 'public/index.html')
    "import './voice-controls.js';" | Set-Content -LiteralPath (Join-Path $temporaryRoot 'public/app.js')
    '// Fixture: no ejecutar.' | Set-Content -LiteralPath (Join-Path $temporaryRoot 'public/voice-controls.js')
    "const CACHE='central-shell-test'; const SHELL=['/','/app.js','/voice-controls.js'];" | Set-Content -LiteralPath (Join-Path $temporaryRoot 'public/sw.js')
    '{}' | Set-Content -LiteralPath (Join-Path $temporaryRoot 'public/manifest.webmanifest')
    '{}' | Set-Content -LiteralPath (Join-Path $temporaryRoot 'config/mapping.json')
    '{"version":"1.2.3","dependencies":{}}' | Set-Content -LiteralPath (Join-Path $temporaryRoot 'package.json')
    '{}' | Set-Content -LiteralPath (Join-Path $temporaryRoot 'package-lock.json')
    'SERVICE_TEST_SECRET=valor-privado-no-imprimir' | Set-Content -LiteralPath (Join-Path $temporaryRoot '.env')
    $script = Join-Path $temporaryRoot 'scripts/instalar-servicio-windows.ps1'
    $tokens = $null; $errors = $null
    [Management.Automation.Language.Parser]::ParseFile($script, [ref]$tokens, [ref]$errors) | Out-Null
    if ($errors.Count -ne 0) { throw 'El instalador tiene errores de sintaxis.' }
    $preview = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Check -NodePath $node
    if ($LASTEXITCODE -ne 0) { throw ('Fallo la vista previa en una ruta con espacios y Unicode: ' + ($preview -join "`n")) }
    if (($preview -join "`n").Contains('valor-privado-no-imprimir')) { throw 'La vista previa revelo un secreto.' }
    $plan = ($preview -join "`n") | ConvertFrom-Json
    if ($plan.changesApplied -ne $false -or $plan.root -ne $temporaryRoot -or $plan.mechanism -ne 'Windows SCM') { throw 'Plan SCM incorrecto.' }
    if ($plan.readiness.applicationVersion -ne '1.2.3' -or $plan.readiness.pwaVersion -ne 'central-shell-test' -or $plan.readiness.publicAssets -notcontains 'public/voice-controls.js') { throw 'Manifiesto de version/voz incorrecto.' }
    if ($plan.voice.ready -ne $false -or $plan.voice.optional -ne $true -or $plan.voice.warning -notmatch 'Dictado local no disponible') { throw 'No se informo que falta la voz opcional.' }
    if (Test-Path -LiteralPath (Join-Path $temporaryRoot 'data')) { throw 'La vista previa modifico la instalacion.' }
    $batInfo = [Diagnostics.ProcessStartInfo]::new()
    $batInfo.FileName = $env:ComSpec
    $batInfo.Arguments = '/d /s /c ""' + (Join-Path $temporaryRoot 'Instalar-servicio.bat') + '" --preview"'
    $batInfo.WorkingDirectory = [IO.Path]::GetTempPath()
    $batInfo.UseShellExecute = $false
    $batInfo.CreateNoWindow = $true
    $batInfo.RedirectStandardOutput = $true
    $batInfo.RedirectStandardError = $true
    $batInfo.EnvironmentVariables['PSModulePath'] = 'C:\ModulosPowerShellIncompatibles'
    $batProcess = [Diagnostics.Process]::Start($batInfo)
    $batOutput = $batProcess.StandardOutput.ReadToEnd()
    $batErrors = $batProcess.StandardError.ReadToEnd()
    $batProcess.WaitForExit()
    if ($batProcess.ExitCode -ne 0) { throw ('Fallo el BAT con espacios/Unicode y modulos heredados: ' + $batErrors + $batOutput) }
    $batPlan = $batOutput | ConvertFrom-Json
    if ($batPlan.changesApplied -ne $false -or $batPlan.mechanism -ne 'Windows SCM') { throw 'El BAT no invoco la vista previa correcta.' }
    if (Test-Path -LiteralPath (Join-Path $temporaryRoot 'data')) { throw 'El BAT preview modifico la instalacion.' }

    $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    if (-not (Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework/v4.0.30319/csc.exe' }
    $exe = Join-Path $temporaryRoot ('Host prueba ' + [char]0x00f1 + '.exe')
    & $compiler /nologo /target:exe /optimize+ /reference:System.ServiceProcess.dll "/out:$exe" (Join-Path $temporaryRoot 'scripts/windows-service-host.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Fallo la compilacion local del wrapper.' }
    $validation = & $exe --root $temporaryRoot --node $node --check
    if ($LASTEXITCODE -ne 0 -or $validation -notmatch 'configuracion valida') { throw 'Fallo la validacion del wrapper compilado.' }
    $ErrorActionPreference = 'Continue'
    & $exe --root (Join-Path $temporaryRoot 'inexistente') --node $node --check 2>$null
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -eq 0) { throw 'El wrapper acepto una instalacion inexistente.' }
    foreach ($relative in @('src/nested.js', 'public/voice-controls.js', 'config/mapping.json')) {
        $requiredFile = Join-Path $temporaryRoot $relative
        $savedFile = $requiredFile + '.saved'
        Move-Item -LiteralPath $requiredFile -Destination $savedFile
        try {
            $incomplete = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Check -NodePath $node
            if ($LASTEXITCODE -eq 0 -or ($incomplete -join "`n") -notmatch 'Falta un archivo necesario:') { throw ('No se detecto archivo faltante: ' + $relative) }
            if (($incomplete -join "`n").Contains('valor-privado-no-imprimir')) { throw 'La validacion de archivos revelo un secreto.' }
        } finally { Move-Item -LiteralPath $savedFile -Destination $requiredFile }
    }
    '{"dependencies":{"dependencia-no-instalada-etar":"1.0.0"}}' | Set-Content -LiteralPath (Join-Path $temporaryRoot 'package.json')
    $missingDependency = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Check -NodePath $node
    if ($LASTEXITCODE -eq 0 -or ($missingDependency -join "`n") -notmatch 'No se pudieron validar .env y dependencias') { throw 'No se detectaron dependencias ausentes.' }
    if (($missingDependency -join "`n").Contains('valor-privado-no-imprimir')) { throw 'El error revelo un secreto.' }
    Remove-Item -LiteralPath (Join-Path $temporaryRoot '.env')
    $missing = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Check -NodePath $node
    if ($LASTEXITCODE -eq 0 -or ($missing -join "`n") -notmatch 'Falta un archivo necesario: .env') { throw 'No se detecto .env ausente.' }
    Write-Output 'Servicio SCM: compila y valida rutas con espacios/Unicode; preview sin cambios ni secretos; falta .env rechazada. No se registro ni inicio ningun servicio.'
} finally {
    $resolvedTemp = [IO.Path]::GetFullPath($temporaryRoot)
    $tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolvedTemp.StartsWith($tempParent, [StringComparison]::OrdinalIgnoreCase)) { throw 'Ruta temporal fuera del directorio esperado.' }
    if (Test-Path -LiteralPath $resolvedTemp) { Remove-Item -LiteralPath $resolvedTemp -Recurse -Force }
}
