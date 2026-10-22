param(
    [switch]$Check, [switch]$SkipDownloads, [switch]$SkipVoice,
    [switch]$SkipIntelligence, [switch]$SkipDocuments, [switch]$Json,
    [string]$Root = (Split-Path $PSScriptRoot -Parent)
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Root = [IO.Path]::GetFullPath($Root)
$checks = New-Object System.Collections.Generic.List[object]
$errors = New-Object System.Collections.Generic.List[string]
$node = $null; $python = $null; $documentsPython = $null; $ollama = $null
$cache = Join-Path $Root 'data/install-cache'
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'windows-dependencies.json') -Raw | ConvertFrom-Json
function Add-Check($name, [bool]$ready, $detail) {
    $checks.Add([pscustomobject]@{ name=$name; ready=$ready; detail=$(if($ready){'Listo'}else{$detail}) })
    if (-not $ready) { $errors.Add([string]$detail) }
}
function Get-Hash($path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Get-Asset($spec) {
    $path = Join-Path $cache $spec.file
    if (Test-Path -LiteralPath $path) {
        if ((Get-Hash $path) -ne $spec.sha256) { throw 'Archivo local con SHA256 incorrecto. Reemplazar el archivo de data/install-cache.' }
        return $path
    }
    if ($SkipDownloads) { throw ('Falta el archivo verificado en data/install-cache: ' + $spec.file) }
    [IO.Directory]::CreateDirectory($cache) | Out-Null
    $part = $path + '.partial-' + [Guid]::NewGuid().ToString('N')
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri $spec.url -OutFile $part
        if ((Get-Hash $part) -ne $spec.sha256) { throw 'La descarga no coincide con el SHA256 fijado.' }
        Move-Item -LiteralPath $part -Destination $path
    } finally { if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force } }
    return $path
}
function Expand-Safe($archive, $destination, $stripPrefix) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        $base = [IO.Path]::GetFullPath($destination).TrimEnd('\') + '\'
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('/', '\')
            if ($stripPrefix) {
                if (-not $name.StartsWith($stripPrefix + '\', [StringComparison]::Ordinal)) { throw 'Estructura ZIP inesperada.' }
                $name = $name.Substring($stripPrefix.Length + 1)
            }
            if (-not $name -or $name.EndsWith('\')) { continue }
            $target = [IO.Path]::GetFullPath([IO.Path]::Combine($destination, $name))
            if (-not $target.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { throw 'ZIP contiene una ruta fuera del destino.' }
            if ([IO.File]::Exists($target) -or [IO.Directory]::Exists($target)) { throw 'No se reemplazan archivos de un runtime existente.' }
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false)
        }
    } finally { $zip.Dispose() }
}
function Invoke-Quiet($exe, [string[]]$arguments) {
    # Never echo native stderr: third-party failures may contain proxy credentials.
    $previousPreference=$ErrorActionPreference
    try{$ErrorActionPreference='Continue';$output=& $exe @arguments 2>&1;$toolExit=$LASTEXITCODE}finally{$ErrorActionPreference=$previousPreference}
    if ($toolExit -ne 0) { throw 'La herramienta no pudo completar la operacion. Revisar conectividad y archivos locales.' }
    return ($output -join "`n")
}
function Test-Node($path) {
    if (-not $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { return $false }
    try { $v = Invoke-Quiet $path @('--version'); return ($v -match '^v24\.(\d+)\.(\d+)$' -and [version]$v.Substring(1) -ge [version]'24.16.0') } catch { return $false }
}
function Test-Python($path) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $false }
    try { $v = Invoke-Quiet $path @('-I','-B','-c',"import sys; assert sys.version_info[:2] == (3,11); assert sys.maxsize > 2**32; print('ok')"); return $v.Trim() -eq 'ok' } catch { return $false }
}
function Get-PortablePython {
    $basePython=Join-Path $Root 'data/python-runtime/python.exe'
    if (-not (Test-Python $basePython)) {
        if (Test-Path -LiteralPath (Split-Path $basePython -Parent)) { throw 'Runtime Python existente incompatible. Se conservo para revision.' }
        $archive=Get-Asset $manifest.python
        Expand-Safe $archive (Split-Path $basePython -Parent) ''
    }
    if (-not (Test-Python $basePython)) { throw 'Python local no paso su comprobacion.' }
    return $basePython
}
function Test-NativeRuntime($directory) {
    foreach ($name in @('msvcp140.dll','vcruntime140_1.dll')) {
        $path=Join-Path $directory $name
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $false }
        try {
            $info=[Diagnostics.FileVersionInfo]::GetVersionInfo($path)
            $version=[version]([string]$info.FileMajorPart+'.'+$info.FileMinorPart+'.'+$info.FileBuildPart+'.'+$info.FilePrivatePart)
            if ($version -lt [version]$manifest.msvc.version) { return $false }
        } catch { return $false }
    }
    return $true
}
function Read-Setting($key, $fallback) {
    # Read only the requested nonsecret key; never import or print .env.
    $envPath = Join-Path $Root '.env'
    if (Test-Path -LiteralPath $envPath) {
        foreach ($line in [IO.File]::ReadAllLines($envPath)) {
            if ($line -match ('^\s*' + [regex]::Escape($key) + '\s*=\s*(.*?)\s*$')) { return $Matches[1].Trim('"', "'") }
        }
    }
    return $fallback
}
function Pull-LocalModel($executable, $model) {
    if ($SkipDownloads) { throw 'Falta el modelo IA en data/llm-models y las descargas estan deshabilitadas.' }
    # Own an isolated process and port. Never attach to an existing Ollama server.
    $listener=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0)
    $listener.Start(); $port=$listener.LocalEndpoint.Port; $listener.Stop()
    $names=@('OLLAMA_HOST','OLLAMA_MODELS','OLLAMA_NO_CLOUD')
    $saved=@{}; foreach($name in $names){$saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
    $process=$null
    try {
        $env:OLLAMA_HOST='127.0.0.1:'+$port
        $env:OLLAMA_MODELS=Join-Path $Root 'data/llm-models'
        $env:OLLAMA_NO_CLOUD='1'
        [IO.Directory]::CreateDirectory($env:OLLAMA_MODELS) | Out-Null
        $process=Start-Process -FilePath $executable -ArgumentList 'serve' -WorkingDirectory $Root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $cache 'ollama-bootstrap.stdout.log') -RedirectStandardError (Join-Path $cache 'ollama-bootstrap.stderr.log')
        $started=$false
        for($attempt=0;$attempt -lt 40;$attempt++){
            if($process.HasExited){throw 'El motor temporal no pudo iniciar.'}
            try{ $version=Invoke-RestMethod ('http://127.0.0.1:'+$port+'/api/version') -TimeoutSec 2; if($version.version){$started=$true;break} }catch{}
            Start-Sleep -Milliseconds 250
        }
        if(-not $started){throw 'El motor temporal no inicio a tiempo.'}
        $null=Invoke-Quiet $executable @('pull',$model)
    } finally {
        if($process -and -not $process.HasExited){Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue; $process.WaitForExit(5000) | Out-Null}
        foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}
    }
}
try {
    if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'Se requiere Windows x64.' }
    if ([Environment]::OSVersion.Version -lt [version]'10.0') { throw 'Se requiere Windows 10 / Server 2016 o posterior.' }
    $nodeLocal = Join-Path $Root 'data/node-runtime/node.exe'
    if (Test-Node $nodeLocal) { $node=$nodeLocal }
    elseif (Test-Path -LiteralPath $nodeLocal) { throw 'Node local incompatible. Conservar el runtime activo y corregirlo durante mantenimiento.' }
    else {
        $command = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($command -and (Test-Node $command.Source)) { $node=$command.Source }
        elseif (-not $Check) {
            $archive = Get-Asset $manifest.node
            Expand-Safe $archive (Join-Path $Root 'data/node-runtime') ('node-v' + $manifest.node.version + '-win-x64')
            if (Test-Node $nodeLocal) { $node=$nodeLocal }
        }
    }
    Add-Check 'node' ([bool]$node) 'Se requiere Node >=24.16.0 <25 y Windows x64.'
    if ($node) {
        Push-Location $Root
        try {
            $dependencyProbe = "const r=require,p=r('node:path'),f=r('node:fs'),root=process.cwd();for(const n of Object.keys(r('./package.json').dependencies||{})){const file=r.resolve(n),rel=p.relative(p.join(root,'node_modules'),file);if(rel.startsWith('..')||p.isAbsolute(rel)||!f.existsSync(file))throw Error('Dependencia fuera de instalacion');}"
            $dependenciesReady=$false
            try { $null=Invoke-Quiet $node @('-e',$dependencyProbe); $dependenciesReady=$true } catch { }
            if (-not $dependenciesReady -and -not $Check) {
                # npm ci deletes node_modules: only use it when no previous install exists.
                if (Test-Path -LiteralPath (Join-Path $Root 'node_modules')) { throw 'Dependencias npm incompletas. Preservadas; reparar en mantenimiento con npm ci.' }
                $npm = Join-Path (Split-Path $node -Parent) 'node_modules/npm/bin/npm-cli.js'
                if (-not (Test-Path -LiteralPath $npm)) { throw 'Falta npm junto al runtime Node. Usar el ZIP oficial completo.' }
                $arguments=@($npm,'ci','--omit=dev','--no-audit','--no-fund','--ignore-scripts','--cache',(Join-Path $cache 'npm'))
                if ($SkipDownloads) { $arguments += '--offline' }
                $null=Invoke-Quiet $node $arguments
                $null=Invoke-Quiet $node @('-e',$dependencyProbe); $dependenciesReady=$true
            }
            Add-Check 'npm' $dependenciesReady 'Faltan dependencias npm. Proveer node_modules o cache npm completo.'
        } finally { Pop-Location }
    }
} catch { Add-Check 'runtime' $false $_.Exception.Message }

if (-not $SkipVoice -or -not $SkipDocuments) {
    try {
        # CTranslate2 links MSVCP140 and VCRUNTIME140_1; Python's ZIP only
        # includes its own CRT files and cannot supply the C++ standard library.
        $systemDirectory=Join-Path $env:WINDIR 'System32'
        if (-not [Environment]::Is64BitProcess) { $systemDirectory=Join-Path $env:WINDIR 'Sysnative' }
        $nativeReady=Test-NativeRuntime $systemDirectory
        if (-not $nativeReady -and -not $Check) {
            $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
            $principal=New-Object Security.Principal.WindowsPrincipal($identity)
            if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Falta Microsoft Visual C++ x64. Ejecutar Instalar-servicio.bat como administrador para preparar voz y documentos.' }
            $redist=Get-Asset $manifest.msvc
            $signature=Get-AuthenticodeSignature -LiteralPath $redist
            if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)' -or (Get-Item -LiteralPath $redist).VersionInfo.ProductVersion -ne $manifest.msvc.version) { throw 'El redistribuible Visual C++ no tiene la firma Microsoft y version fijadas. Se cancelo su ejecucion.' }
            $process=Start-Process -FilePath $redist -ArgumentList @('/install','/quiet','/norestart') -Wait -PassThru -WindowStyle Hidden
            if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) { throw 'No se pudo preparar Microsoft Visual C++ x64. Revisar la instalacion del redistribuible.' }
            $nativeReady=Test-NativeRuntime $systemDirectory
        }
        Add-Check 'python-native-runtime' $nativeReady 'Se requiere Microsoft Visual C++ x64 >=14.44.35211 (MSVCP140 / VCRUNTIME140_1). Ejecutar el BAT como administrador.'
    } catch { Add-Check 'python-native-runtime' $false $_.Exception.Message }
}
if (-not $SkipVoice) {
    try {
        if (-not $nativeReady) { throw 'Preparar primero Microsoft Visual C++ x64 antes de crear el entorno de voz.' }
        $venv=Join-Path $Root '.venv-voice'; $python=Join-Path $venv 'Scripts/python.exe'; $createdVoice=$false
        if (-not (Test-Python $python) -and -not $Check) {
            if (Test-Path -LiteralPath $venv) { throw 'El entorno .venv-voice existente no es portable o esta incompleto. Se conservo; moverlo durante mantenimiento antes de reinstalar.' }
            $basePython=Get-PortablePython
            $null=Invoke-Quiet $basePython @('-I','-m','venv',$venv)
            $createdVoice=$true
        }
        $voiceReady=$false
        $voiceProbe="import importlib.metadata as m; from faster_whisper import WhisperModel; import av; assert m.version('faster-whisper')=='1.2.1'; assert m.version('av')=='18.1.0'"
        if (Test-Python $python) {
            try { $null=Invoke-Quiet $python @('-I','-B','-c',$voiceProbe); $null=Invoke-Quiet $python @('-I','-B','-m','pip','check'); $voiceReady=$true } catch { }
            if (-not $voiceReady -and -not $Check) {
                if (-not $createdVoice) { throw 'El entorno de voz existente no cumple las versiones fijadas. Se conservo; repararlo durante mantenimiento.' }
                $arguments=@('-I','-m','pip','install','--disable-pip-version-check','--only-binary=:all:','--require-hashes','-r',(Join-Path $PSScriptRoot 'voice-requirements-lock.txt'))
                $wheels=Join-Path $cache 'wheels'
                if (Test-Path -LiteralPath $wheels) { $arguments += @('--no-index','--find-links',$wheels) }
                elseif ($SkipDownloads) { throw 'Faltan wheels de voz en data/install-cache/wheels. Preparar cache antes del traslado.' }
                $null=Invoke-Quiet $python $arguments
                $null=Invoke-Quiet $python @('-I','-B','-c',$voiceProbe); $null=Invoke-Quiet $python @('-I','-B','-m','pip','check'); $voiceReady=$true
            }
        }
        Add-Check 'voice-python' $voiceReady 'Falta Python 3.11 x64 con faster-whisper 1.2.1 y PyAV 18.1.0.'
        $modelReady=$true
        foreach ($property in $manifest.whisper.files.PSObject.Properties) {
            $path=Join-Path $Root ('data/models/whisper-base/'+$property.Name)
            $valid=(Test-Path -LiteralPath $path) -and (Get-Hash $path) -eq $property.Value
            if (-not $valid -and -not $Check) {
                if (Test-Path -LiteralPath $path) { throw 'Modelo de voz existente diferente del fijado. Se conservo para revision.' }
                $spec=[pscustomobject]@{file=('whisper-'+$property.Name);sha256=$property.Value;url=('https://huggingface.co/Systran/faster-whisper-base/resolve/'+$manifest.whisper.revision+'/'+$property.Name)}
                $download=Get-Asset $spec
                [IO.Directory]::CreateDirectory((Split-Path $path -Parent)) | Out-Null
                Copy-Item -LiteralPath $download -Destination $path
                $valid=$true
            }
            if (-not $valid) { $modelReady=$false }
        }
        Add-Check 'voice-model' $modelReady 'Falta modelo Whisper base completo con SHA256 verificado.'
    } catch { Add-Check 'voice' $false $_.Exception.Message }
}

if (-not $SkipDocuments) {
    try {
        if (-not $nativeReady) { throw 'Preparar primero Microsoft Visual C++ x64 antes de crear el lector de documentos.' }
        $documentsVenv=Join-Path $Root '.venv-documents'
        $documentsPython=Join-Path $documentsVenv 'Scripts/python.exe'
        $createdDocuments=$false
        if (-not (Test-Python $documentsPython) -and -not $Check) {
            if (Test-Path -LiteralPath $documentsVenv) { throw 'El entorno .venv-documents existente no es portable o esta incompleto. Se conservo; moverlo durante mantenimiento antes de reinstalar.' }
            $basePython=Get-PortablePython
            $null=Invoke-Quiet $basePython @('-I','-m','venv',$documentsVenv)
            $createdDocuments=$true
        }
        $documentsReady=$false
        $documentsRequirements=Join-Path $PSScriptRoot 'requirements-documents.txt'
        $documentsProbe="import sys,importlib.metadata as m; from pathlib import Path; import openpyxl,xlrd,pdfplumber,pypdfium2; from rapidocr_onnxruntime import RapidOCR; RapidOCR(intra_op_num_threads=2,inter_op_num_threads=1); pins=[line.strip().split('==') for line in Path(sys.argv[1]).read_text().splitlines() if line.strip()]; assert all(m.version(name)==version for name,version in pins)"
        if (Test-Python $documentsPython) {
            try { $null=Invoke-Quiet $documentsPython @('-I','-B','-c',$documentsProbe,$documentsRequirements); $null=Invoke-Quiet $documentsPython @('-I','-B','-m','pip','check'); $documentsReady=$true } catch { }
            if (-not $documentsReady -and -not $Check) {
                if (-not $createdDocuments) { throw 'El lector de documentos existente no cumple las versiones fijadas o no carga OCR. Se conservo; repararlo durante mantenimiento.' }
                $arguments=@('-I','-m','pip','install','--disable-pip-version-check','--only-binary=:all:','--require-hashes','-r',(Join-Path $PSScriptRoot 'requirements-documents-lock.txt'))
                $wheels=Join-Path $cache 'wheels'
                if (Test-Path -LiteralPath $wheels) { $arguments += @('--no-index','--find-links',$wheels) }
                elseif ($SkipDownloads) { throw 'Faltan wheels del lector en data/install-cache/wheels. Preparar cache antes del traslado.' }
                $null=Invoke-Quiet $documentsPython $arguments
                $null=Invoke-Quiet $documentsPython @('-I','-B','-c',$documentsProbe,$documentsRequirements)
                $null=Invoke-Quiet $documentsPython @('-I','-B','-m','pip','check')
                $documentsReady=$true
            }
        }
        $marker=Join-Path $documentsVenv '.ready'
        if ($documentsReady -and -not $Check -and -not (Test-Path -LiteralPath $marker)) { [IO.File]::WriteAllText($marker,'local-documents-v1') }
        $markerReady=(Test-Path -LiteralPath $marker) -and ([IO.File]::ReadAllText($marker).Trim() -eq 'local-documents-v1')
        Add-Check 'documents' ($documentsReady -and $markerReady) 'Falta lector local de Excel, PDF e imagenes con OCR verificado y marca local-documents-v1.'
    } catch { Add-Check 'documents' $false $_.Exception.Message }
}

if (-not $SkipIntelligence) {
    try {
        $provider=Read-Setting 'AI_PROVIDER' 'local'
        $settings=Join-Path $Root 'data/ai-settings.json'
        if (Test-Path -LiteralPath $settings) { $provider=(Get-Content -LiteralPath $settings -Raw | ConvertFrom-Json).provider }
        if ($provider -eq 'local') {
            $ollama=Join-Path $Root 'data/llm-runtime/ollama.exe'
            if (-not (Test-Path -LiteralPath $ollama) -and -not $Check) {
                $archive=Get-Asset $manifest.ollama
                Expand-Safe $archive (Split-Path $ollama -Parent) ''
            }
            $ollamaReady=Test-Path -LiteralPath $ollama -PathType Leaf
            if ($ollamaReady) { $null=Invoke-Quiet $ollama @('--version') }
            Add-Check 'ollama' $ollamaReady 'Falta motor local Ollama en data/llm-runtime.'
            $model=Read-Setting 'AI_MODEL' 'qwen3:4b'
            if ($model -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._/-]*(?::[a-zA-Z0-9._-]+)?$' -or $model.Contains('..')) { throw 'AI_MODEL requiere un nombre valido de modelo Ollama.' }
            $modelParts=$model.Split(':'); $modelName=$modelParts[0]; $tag='latest'; if ($modelParts.Count -gt 1) { $tag=$modelParts[1] }
            $modelPath=Join-Path $Root ('data/llm-models/manifests/registry.ollama.ai/' + $(if($modelName.Contains('/')){$modelName}else{'library/'+$modelName}) + '/' + $tag)
            if (-not (Test-Path -LiteralPath $modelPath) -and -not $Check -and $ollamaReady) {
                [IO.Directory]::CreateDirectory($cache) | Out-Null
                Pull-LocalModel $ollama $model
            }
            $modelReady=Test-Path -LiteralPath $modelPath -PathType Leaf
            if ($modelReady) {
                $modelManifest=Get-Content -LiteralPath $modelPath -Raw | ConvertFrom-Json
                foreach ($layer in @($modelManifest.config)+@($modelManifest.layers)) {
                    if ($layer.digest -notmatch '^sha256:[a-f0-9]{64}$') { $modelReady=$false; break }
                    $blob=Join-Path $Root ('data/llm-models/blobs/'+$layer.digest.Replace(':','-'))
                    if (-not (Test-Path -LiteralPath $blob) -or (Get-Hash $blob) -ne $layer.digest.Substring(7)) { $modelReady=$false; break }
                }
            }
            Add-Check 'local-model' $modelReady 'Falta el modelo AI_MODEL completo. Copiar data/llm-models desde el paquete privado o descargarlo con Ollama antes de instalar el servicio.'
        } elseif ($provider -notin @('external','openai','anthropic')) { throw 'Proveedor IA desconocido. Revisar la configuracion local.' }
        else { Add-Check 'ai-provider' $true 'Proveedor externo configurado; se conserva.' }
    } catch { Add-Check 'intelligence' $false 'No se pudo comprobar la IA local. Revisar modelo, runtime y configuracion local.' }
}
$result=[pscustomobject]@{ ready=($errors.Count -eq 0); checkOnly=[bool]$Check; nodePath=$node; pythonPath=$python; documentsPythonPath=$documentsPython; ollamaPath=$ollama; checks=@($checks.ToArray()); errors=@($errors.ToArray()) }
if ($Json) { $result | ConvertTo-Json -Depth 7 -Compress }
else { foreach($item in $checks) { if($item.ready){Write-Host ($item.name+': listo')}else{Write-Host ($item.name+': '+$item.detail)} } }
if ($result.ready) { exit 0 } else { exit 1 }
