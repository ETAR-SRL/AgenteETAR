#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Address,
    [Parameter(Mandatory)][string]$Subnet,
    [string]$DnsName = $env:COMPUTERNAME.ToLowerInvariant(),
    [ValidateRange(1,65535)][int]$Port = 4311,
    [switch]$Renew
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$ip = [Net.IPAddress]::Parse($Address)
if ($ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw 'Indicar la IPv4 privada del servidor.' }
if ($DnsName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$') { throw 'Nombre DNS inválido.' }
$origins = @("https://${Address}:$Port", "https://${DnsName}:$Port")
# Validate the same network contract used by the server before writing any file.
Push-Location $root
try {
    @{ origins=$origins; cidrs=@($Subnet) } | ConvertTo-Json -Compress |
        & node --input-type=module -e "import fs from 'node:fs';import {createNetworkAccess} from './src/network-access.js';createNetworkAccess(JSON.parse(fs.readFileSync(0,'utf8')));"
    if ($LASTEXITCODE -ne 0) { throw 'Configuración de red inválida.' }
} finally { Pop-Location }
$envPath = Join-Path $root '.env'
if (-not (Test-Path -LiteralPath $envPath)) { throw 'Configurar primero .env.' }
$tlsDir = Join-Path $root 'data/tls'
$clientDir = Join-Path $root 'data/lan-client'
if ((Test-Path -LiteralPath (Join-Path $tlsDir 'server.pfx')) -and -not $Renew) {
    throw 'Ya existe un certificado. Usar -Renew sólo para renovarlo y redistribuir el certificado público.'
}
[IO.Directory]::CreateDirectory($tlsDir) | Out-Null
[IO.Directory]::CreateDirectory($clientDir) | Out-Null
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $tlsDir /inheritance:r /grant:r "*${sid}:(OI)(CI)(F)" '*S-1-5-18:(OI)(CI)(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron proteger las claves privadas.' }
$caKey = [Security.Cryptography.RSA]::Create(3072)
$serverKey = [Security.Cryptography.RSA]::Create(3072)
try {
    $hash = [Security.Cryptography.HashAlgorithmName]::SHA256
    $padding = [Security.Cryptography.RSASignaturePadding]::Pkcs1
    $caRequest = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=Central ETAR LAN', $caKey, $hash, $padding)
    $caRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true,$true,0,$true))
    $caRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign,$true))
    $ca = $caRequest.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5),[DateTimeOffset]::UtcNow.AddYears(3))
    $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new("CN=$DnsName",$serverKey,$hash,$padding)
    $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false,$false,0,$true))
    $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
        [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment,$true))
    $eku = [Security.Cryptography.OidCollection]::new()
    $eku.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1')) | Out-Null
    $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($eku,$true))
    $san = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $san.AddIpAddress($ip)
    $san.AddIpAddress([Net.IPAddress]::Parse('127.0.0.1'))
    $san.AddDnsName($DnsName)
    if ($DnsName -ne 'localhost') { $san.AddDnsName('localhost') }
    $request.CertificateExtensions.Add($san.Build())
    $serial = [Security.Cryptography.RandomNumberGenerator]::GetBytes(16)
    $publicLeaf = $request.Create($ca,[DateTimeOffset]::UtcNow.AddMinutes(-5),[DateTimeOffset]::UtcNow.AddDays(365),$serial)
    $leaf = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::CopyWithPrivateKey($publicLeaf,$serverKey)
    $password = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    [IO.File]::WriteAllBytes((Join-Path $tlsDir 'server.pfx'),$leaf.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx,$password))
    [IO.File]::WriteAllText((Join-Path $tlsDir 'server-password.txt'),$password)
    [IO.File]::WriteAllBytes((Join-Path $clientDir 'central-ca.cer'),$ca.RawData)
    $fingerprint = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($ca.RawData))
    # Only the public CA leaves this directory; its signing private key is never persisted.
    $leaf.Dispose(); $publicLeaf.Dispose(); $ca.Dispose()
} finally { $caKey.Dispose(); $serverKey.Dispose() }
$install = @'
$ErrorActionPreference = 'Stop'
$certificate = Join-Path $PSScriptRoot 'central-ca.cer'
if ((Get-FileHash -LiteralPath $certificate -Algorithm SHA256).Hash -ne '__FINGERPRINT__') {
    throw 'El certificado no coincide con el paquete emitido por Central.'
}
Import-Certificate -FilePath $certificate -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
Write-Output 'Certificado instalado para este usuario de Windows. Ya podés abrir __URL__.'
'@
[IO.File]::WriteAllText((Join-Path $clientDir 'instalar-certificado.ps1'),$install.Replace('__FINGERPRINT__',$fingerprint).Replace('__URL__',$origins[0]))
[IO.File]::WriteAllText((Join-Path $clientDir 'LEEME.txt'),@"
Central ETAR: $($origins[0])
Alternativa por nombre: $($origins[1]) (si la red resuelve el nombre)
En cada PC, el usuario ejecuta instalar-certificado.ps1 una vez. El certificado es público.
Verificá esta huella SHA256 con el responsable del servidor: $fingerprint
Después ingresá con tu usuario y contraseña de Central. No hay claves API en este paquete.
No copiar data/tls ni .env a otras PC. El certificado del servidor vence dentro de un año.
"@)
$settings = [ordered]@{
    LAN_HTTPS_ENABLED='true'; LAN_HOST='0.0.0.0'; LAN_PORT=[string]$Port
    LAN_ORIGINS=($origins -join ','); LAN_CIDRS=$Subnet
    LAN_TLS_PFX='data/tls/server.pfx'; LAN_TLS_PASSWORD_FILE='data/tls/server-password.txt'
}
$content = [IO.File]::ReadAllText($envPath)
foreach ($key in $settings.Keys) {
    $line = "$key=$($settings[$key])"
    if ($content -match "(?m)^$key=") { $content = [regex]::Replace($content,"(?m)^$key=[^\r\n]*",$line) }
    else { $content = $content.TrimEnd() + [Environment]::NewLine + $line + [Environment]::NewLine }
}
[IO.File]::WriteAllText($envPath,$content)
Write-Output "HTTPS configurado: $($origins[0]). Reiniciar Central para activarlo."
Write-Output "Paquete público para las PC: $clientDir"
Write-Output "Falta habilitar el puerto en Windows con scripts/habilitar-firewall-lan.ps1 -Subnet $Subnet -Port $Port (administrador)."
