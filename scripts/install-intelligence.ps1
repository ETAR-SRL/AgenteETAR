$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$runtime=Join-Path $root 'data/llm-runtime'
[IO.Directory]::CreateDirectory($runtime) | Out-Null
$archive=Join-Path $runtime 'ollama.zip'
$url='https://github.com/ollama/ollama/releases/download/v0.40.6/ollama-windows-amd64.zip'
$sha='e359637575302f288d76c0007c408a4be9c7376d59c4f28684d63b232a44b427'
if (-not(Test-Path -LiteralPath $archive)){curl.exe -L --fail --silent --show-error $url -o $archive;if($LASTEXITCODE){throw 'Falló la descarga'}}
if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha){throw 'La descarga no coincide con el SHA256 publicado por Ollama'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($archive)
try{
 foreach($entry in $zip.Entries){
  if($entry.FullName.EndsWith('/') -or $entry.FullName -match '(?i)cuda|rocm'){continue}
  $target=[IO.Path]::GetFullPath((Join-Path $runtime $entry.FullName))
  if(-not $target.StartsWith(([IO.Path]::GetFullPath($runtime)+[IO.Path]::DirectorySeparatorChar),[StringComparison]::OrdinalIgnoreCase)){throw 'Ruta de archivo fuera del runtime'}
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
  [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$true)
 }
}finally{$zip.Dispose()}
& (Join-Path $PSScriptRoot 'start-intelligence.ps1')
$env:OLLAMA_HOST='127.0.0.1:11434'
& (Join-Path $runtime 'ollama.exe') pull qwen3:4b
if($LASTEXITCODE){throw 'No se pudo descargar el modelo'}
Write-Output 'Inteligencia local instalada. Reiniciá Central para usarla.'
