param([string]$Root = (Split-Path $PSScriptRoot -Parent), [switch]$Installed)
$ErrorActionPreference = 'Stop'

# Integrity check only. An unsigned manifest does not authenticate its publisher.
# Runs in Windows PowerShell 5.1 before Node/Python installation.
function Assert-RegularPath([string]$Base, [string]$Relative) {
    if ([string]::IsNullOrWhiteSpace($Relative) -or $Relative -match '[\\:<>"|?*]' -or $Relative.StartsWith('/')) {
        throw 'Ruta no permitida en el manifiesto.'
    }
    $parts = $Relative.Split('/')
    foreach ($part in $parts) {
        if ($part -eq '' -or $part -eq '.' -or $part -eq '..' -or $part -match '[.\s]$') {
            throw 'Ruta no permitida en el manifiesto.'
        }
    }
    $path = [IO.Path]::GetFullPath((Join-Path $Base ($Relative.Replace('/', [IO.Path]::DirectorySeparatorChar))))
    if (-not $path.StartsWith($Base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'La ruta sale de la carpeta del paquete.'
    }
    $current = $Base
    foreach ($part in $parts) {
        $current = Join-Path $current $part
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'El paquete no admite enlaces ni puntos de reanalisis.'
        }
    }
    if (-not [IO.File]::Exists($path)) { throw ('Falta un archivo del paquete: ' + $Relative) }
    return $path
}

function Assert-NoDuplicateJsonKeys([string]$Json) {
    # Tokenize strings before braces so braces inside strings never alter depth.
    # ConvertFrom-Json alone silently discards identical duplicate object keys.
    $frames = New-Object 'System.Collections.Generic.Stack[object]'
    $tokens = [regex]::Matches($Json, '"(?:[^"\\]|\\.)*"|[{}\[\]]')
    foreach ($token in $tokens) {
        switch ($token.Value) {
            '{' { $frames.Push((New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase))); break }
            '[' { $frames.Push($null); break }
            '}' { if ($frames.Count -eq 0) { throw 'JSON no valido.' }; $null = $frames.Pop(); break }
            ']' { if ($frames.Count -eq 0) { throw 'JSON no valido.' }; $null = $frames.Pop(); break }
            default {
                $tail = $Json.Substring($token.Index + $token.Length).TrimStart()
                if ($tail.StartsWith(':')) {
                    if ($frames.Count -eq 0 -or $null -eq $frames.Peek()) { throw 'JSON no valido.' }
                    $key = (ConvertFrom-Json -InputObject ('{"value":' + $token.Value + '}')).value
                    if (-not $frames.Peek().Add($key)) { throw 'Claves duplicadas en el manifiesto.' }
                }
            }
        }
    }
    if ($frames.Count -ne 0) { throw 'JSON no valido.' }
}

try {
    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $rootItem = Get-Item -LiteralPath $rootPath -Force -ErrorAction Stop
    if (-not $rootItem.PSIsContainer -or ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Carpeta del paquete no permitida.'
    }
    $manifestPath = Assert-RegularPath $rootPath 'PACKAGE-MANIFEST.json'
    $raw = [IO.File]::ReadAllText($manifestPath, [Text.Encoding]::UTF8)
    Assert-NoDuplicateJsonKeys $raw
    $manifest = ConvertFrom-Json -InputObject $raw
    if ($manifest.schema -ne 1 -or $manifest.files -isnot [pscustomobject]) { throw 'Manifiesto no compatible.' }
    $records = @($manifest.files.PSObject.Properties)
    if ($records.Count -eq 0) { throw 'El manifiesto no contiene archivos.' }
    $names = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $verified = 0
    $skipped = 0
    foreach ($record in $records) {
        $relative = [string]$record.Name
        if (-not $names.Add($relative) -or $relative -eq 'PACKAGE-MANIFEST.json') { throw 'Archivos duplicados en el manifiesto.' }
        # Validate paths even for mutable state omitted in installed mode.
        $path = Assert-RegularPath $rootPath $relative
        $metadata = $record.Value
        if ($null -eq $metadata.size -or [string]$metadata.size -notmatch '^\d+$' -or [string]$metadata.sha256 -notmatch '^[a-fA-F0-9]{64}$') {
            throw ('Registro de archivo no valido: ' + $relative)
        }
        if ($Installed -and ($relative -eq '.env' -or $relative -eq 'data/agent.sqlite' -or $relative.StartsWith('data/tls/', [StringComparison]::OrdinalIgnoreCase))) {
            $skipped++
            continue
        }
        $info = Get-Item -LiteralPath $path -Force
        if ($info.Length -ne [long]$metadata.size) { throw ('Tamano distinto al manifiesto: ' + $relative) }
        $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
        if (-not $actual.Equals([string]$metadata.sha256, [StringComparison]::OrdinalIgnoreCase)) { throw ('Contenido distinto al manifiesto: ' + $relative) }
        $verified++
    }
    if ($verified + $skipped -ne $records.Count) { throw 'Recuento de archivos incompleto.' }
    Write-Host ('Integridad del paquete verificada: ' + $verified + ' archivos; estado instalado omitido: ' + $skipped + '.')
} catch {
    Write-Error ('Verificacion del paquete incompleta: ' + $_.Exception.Message) -ErrorAction Continue
    exit 1
}
