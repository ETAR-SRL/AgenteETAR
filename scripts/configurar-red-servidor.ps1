param([Parameter(Mandatory)][string]$Address,[Parameter(Mandatory)][string]$Subnet,[string]$DnsName=$env:COMPUTERNAME.ToLowerInvariant(),[ValidateRange(1,65535)][int]$Port=4311,[Parameter(Mandatory)][string]$NodePath)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$ip=[Net.IPAddress]::Parse($Address)
if($ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $DnsName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$'){throw 'Indicar IPv4 privada y nombre DNS validos.'}
if($Address -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)'){throw 'La direccion del servidor debe ser una IPv4 privada.'}
if(-not(Get-NetIPAddress -AddressFamily IPv4 -IPAddress $Address -ErrorAction SilentlyContinue)){throw 'La direccion indicada no pertenece a este servidor.'}
$origins=@("https://${Address}:$Port","https://${DnsName}:$Port")
Push-Location -LiteralPath $root
try{
 @{origins=$origins;cidrs=@($Subnet);address=$Address} | ConvertTo-Json -Compress | & $NodePath --input-type=module -e "import fs from 'node:fs';import{BlockList,isIP}from'node:net';import {createNetworkAccess} from './src/network-access.js';const c=JSON.parse(fs.readFileSync(0,'utf8'));createNetworkAccess(c);const[ip,bits]=c.cidrs[0].split('/');if(isIP(ip)!==4)throw Error('Subred IPv4 requerida');const b=new BlockList();b.addSubnet(ip,Number(bits),'ipv4');if(!b.check(c.address,'ipv4'))throw Error('IP fuera de subred');"
 if($LASTEXITCODE -ne 0){throw 'Direccion o subred privada invalida.'}
}finally{Pop-Location}
$ruleName='CentralETAR-LAN-HTTPS'
$prior=Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
if($prior){
 $portFilter=$prior|Get-NetFirewallPortFilter
 $addressFilter=$prior|Get-NetFirewallAddressFilter
 if($portFilter.LocalPort -ne [string]$Port -or (@($addressFilter.RemoteAddress) -join ',') -ne $Subnet){throw 'Ya existe una regla de firewall con otro puerto/subred. Revisar antes de reemplazarla.'}
}
$tls=Join-Path $root 'data/tls';$client=Join-Path $root 'data/lan-client'
[IO.Directory]::CreateDirectory($tls)|Out-Null
[IO.Directory]::CreateDirectory($client)|Out-Null
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $tls /inheritance:r /grant:r "*${identity}:(OI)(CI)(F)" '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)' | Out-Null
if($LASTEXITCODE -ne 0){throw 'No se pudieron proteger los archivos TLS.'}
$pfx=Join-Path $tls 'server.pfx';$passwordPath=Join-Path $tls 'server-password.txt'
if((Test-Path -LiteralPath $pfx) -or (Test-Path -LiteralPath $passwordPath)){
 $backup=Join-Path $tls ('backup-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))
 [IO.Directory]::CreateDirectory($backup)|Out-Null
 foreach($path in @($pfx,$passwordPath)){if(Test-Path -LiteralPath $path){Copy-Item -LiteralPath $path -Destination $backup}}
}
$certificate=$null
try{
 # Certificado propio de ESTE servidor. Solo se distribuye la parte publica.
 $certificate=New-SelfSignedCertificate -Type Custom -Subject ('CN='+$DnsName) -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -CertStoreLocation 'Cert:\LocalMachine\My' -NotAfter (Get-Date).AddYears(1) -TextExtension @(('2.5.29.17={text}DNS='+$DnsName+'&DNS=localhost&IPAddress='+$Address+'&IPAddress=127.0.0.1'),'2.5.29.37={text}1.3.6.1.5.5.7.3.1')
 $bytes=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create();try{$rng.GetBytes($bytes)}finally{$rng.Dispose()}
 $password=[BitConverter]::ToString($bytes).Replace('-','')
 Export-PfxCertificate -Cert $certificate -FilePath $pfx -Password (ConvertTo-SecureString $password -AsPlainText -Force) -Force | Out-Null
 [IO.File]::WriteAllText($passwordPath,$password)
 Export-Certificate -Cert $certificate -FilePath (Join-Path $client 'central-servidor.cer') -Force | Out-Null
}finally{if($certificate){Remove-Item -LiteralPath ('Cert:\LocalMachine\My\'+$certificate.Thumbprint) -Force}}
$fingerprint=(Get-FileHash -LiteralPath (Join-Path $client 'central-servidor.cer') -Algorithm SHA256).Hash
$clientScript=@'
$ErrorActionPreference='Stop'
$certificate=Join-Path $PSScriptRoot 'central-servidor.cer'
if((Get-FileHash -LiteralPath $certificate -Algorithm SHA256).Hash -ne '__HASH__'){throw 'El certificado no coincide con el emitido por el servidor.'}
Import-Certificate -FilePath $certificate -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
Write-Output 'Certificado publico instalado. Ingresar en __URL__ con usuario y contrasena.'
'@
[IO.File]::WriteAllText((Join-Path $client 'instalar-certificado.ps1'),$clientScript.Replace('__HASH__',$fingerprint).Replace('__URL__',$origins[0]))
[IO.File]::WriteAllText((Join-Path $client 'LEEME.txt'),"Central ETAR: $($origins[0])`r`nInstalar solo este certificado PUBLICO en cada PC. No distribuir .env, data/tls ni el paquete privado.`r`nHuella SHA256: $fingerprint`r`n")
$settings=[ordered]@{LAN_HTTPS_ENABLED='true';LAN_HOST='0.0.0.0';LAN_PORT=[string]$Port;LAN_ORIGINS=($origins -join ',');LAN_CIDRS=$Subnet;LAN_TLS_PFX='data/tls/server.pfx';LAN_TLS_PASSWORD_FILE='data/tls/server-password.txt'}
$envPath=Join-Path $root '.env';$content=[IO.File]::ReadAllText($envPath)
foreach($key in $settings.Keys){$line=$key+'='+$settings[$key];if($content -match "(?m)^$key="){$content=[regex]::Replace($content,"(?m)^$key=[^\r\n]*",[Text.RegularExpressions.MatchEvaluator]{param($match)$line})}else{$content=$content.TrimEnd()+[Environment]::NewLine+$line+[Environment]::NewLine}}
[IO.File]::WriteAllText($envPath,$content)
if(-not $prior){New-NetFirewallRule -Name $ruleName -DisplayName 'Central ETAR HTTPS - subred autorizada' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -RemoteAddress $Subnet -Profile Domain,Private|Out-Null}
Write-Output ('Acceso LAN: '+$origins[0]+'. Certificado publico para las PC en data/lan-client.')
