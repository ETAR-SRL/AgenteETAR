$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$node=(Get-Command node.exe).Source
$temporaryRoot=Join-Path ([IO.Path]::GetTempPath()) ('Central red prueba '+[char]0x00f1+' '+[guid]::NewGuid().ToString('N'))
$global:networkFixturecertCalls=0;$global:networkFixturecleanupCalls=0;$global:networkFixturefirewallCalls=0;$global:networkFixtureaclCalls=0;$global:networkFixturefailExport=$false;$global:networkFixtureassigned=$true;$global:networkFixtureconflictingRule=$false
function Assert-True($Value,[string]$Message){if(-not $Value){throw $Message}}
function Get-NetIPAddress { [CmdletBinding()]param($AddressFamily,$IPAddress) if($global:networkFixtureassigned){[pscustomobject]@{IPAddress=$IPAddress}} }
function Get-NetFirewallRule { [CmdletBinding()]param($Name) if($global:networkFixtureconflictingRule){[pscustomobject]@{Name=$Name}} }
function Get-NetFirewallPortFilter { [CmdletBinding()]param([Parameter(ValueFromPipeline)]$InputObject)process{[pscustomobject]@{LocalPort='9999'}} }
function Get-NetFirewallAddressFilter { [CmdletBinding()]param([Parameter(ValueFromPipeline)]$InputObject)process{[pscustomobject]@{RemoteAddress='192.168.50.0/24'}} }
function icacls.exe { $global:networkFixtureaclCalls++;$global:LASTEXITCODE=0 }
function New-SelfSignedCertificate {
 param($Type,$Subject,$KeyAlgorithm,$KeyLength,$HashAlgorithm,$KeyExportPolicy,$CertStoreLocation,$NotAfter,[string[]]$TextExtension)
 $global:networkFixturecertCalls++
 Assert-True ($TextExtension.Count -eq 2) 'SAN y EKU deben ser dos extensiones separadas.'
 Assert-True ($TextExtension[0] -eq '2.5.29.17={text}DNS=central-prueba&DNS=localhost&IPAddress=192.168.50.10&IPAddress=127.0.0.1') 'SAN incompleto o concatenado con EKU.'
 Assert-True ($TextExtension[1] -eq '2.5.29.37={text}1.3.6.1.5.5.7.3.1') 'EKU de servidor ausente.'
 Assert-True ($KeyLength -ge 3072 -and $HashAlgorithm -eq 'SHA256' -and $CertStoreLocation -eq 'Cert:\LocalMachine\My') 'Parametros criptograficos inesperados.'
 [pscustomobject]@{Thumbprint='CERTIFICADO-FICTICIO-NUNCA-CREADO'}
}
function Export-PfxCertificate {param($Cert,$FilePath,$Password,[switch]$Force) if($global:networkFixturefailExport){throw 'Fallo de exportacion simulado'};Assert-True ($Password -is [Security.SecureString]) 'Contrasena PFX debe viajar como SecureString.';[IO.File]::WriteAllText($FilePath,'PRIVATE-FIXTURE')}
function Export-Certificate {param($Cert,$FilePath,[switch]$Force) [IO.File]::WriteAllText($FilePath,'PUBLIC-FIXTURE')}
function Remove-Item {param($LiteralPath,[switch]$Force) Assert-True ($LiteralPath -eq 'Cert:\LocalMachine\My\CERTIFICADO-FICTICIO-NUNCA-CREADO') 'Solo se permite limpiar el certificado ficticio.';$global:networkFixturecleanupCalls++}
function New-NetFirewallRule {
 param($Name,$DisplayName,$Direction,$Action,$Protocol,$LocalPort,$RemoteAddress,[string[]]$Profile)
 $global:networkFixturefirewallCalls++
 Assert-True ($Direction -eq 'Inbound' -and $Action -eq 'Allow' -and $Protocol -eq 'TCP' -and $LocalPort -eq 4311 -and $RemoteAddress -eq '192.168.50.0/24') 'Firewall fuera del puerto/subred solicitados.'
 Assert-True (($Profile -join ',') -eq 'Domain,Private') 'No habilitar perfil publico.'
}
function New-Fixture([string]$Name){
 $path=Join-Path $temporaryRoot $Name
 foreach($dir in @('scripts','src')){[IO.Directory]::CreateDirectory((Join-Path $path $dir))|Out-Null}
 Copy-Item -LiteralPath (Join-Path $repo 'scripts/configurar-red-servidor.ps1') -Destination (Join-Path $path 'scripts')
 foreach($name in @('network-access.js','errors.js')){Copy-Item -LiteralPath (Join-Path $repo ('src/'+$name)) -Destination (Join-Path $path 'src')}
 [IO.File]::WriteAllText((Join-Path $path 'package.json'),'{"type":"module"}')
 [IO.File]::WriteAllText((Join-Path $path '.env'),"API_READ_KEY=secreto-no-publicar-987654321`r`nLAN_HTTPS_ENABLED=false`r`nLAN_PORT=9876`r`n")
 return $path
}
function Invoke-Network([string]$Path,[string]$Address='192.168.50.10',[string]$Subnet='192.168.50.0/24'){
 & (Join-Path $Path 'scripts/configurar-red-servidor.ps1') -Address $Address -Subnet $Subnet -DnsName 'central-prueba' -Port 4311 -NodePath $node
}
try{
 $valid=New-Fixture 'valida'
 $output=Invoke-Network $valid
 Assert-True (-not (($output -join "`n").Contains('secreto-no-publicar-987654321'))) 'Se revelo un secreto en la salida.'
 $text=[IO.File]::ReadAllText((Join-Path $valid '.env'))
 Assert-True ($text.Contains('API_READ_KEY=secreto-no-publicar-987654321')) 'Se altero la clave preexistente.'
 Assert-True ($text.Contains('LAN_HTTPS_ENABLED=true') -and $text.Contains('LAN_PORT=4311') -and $text.Contains('LAN_CIDRS=192.168.50.0/24')) 'Configuracion LAN incompleta.'
 $client=Join-Path $valid 'data/lan-client'
 $files=@(Get-ChildItem -LiteralPath $client -File|ForEach-Object{$_.Name}|Sort-Object)
 Assert-True (($files -join ',') -eq 'central-servidor.cer,instalar-certificado.ps1,LEEME.txt') 'El paquete cliente debe contener solo certificado publico e instrucciones.'
 foreach($file in Get-ChildItem -LiteralPath $client -File){Assert-True (-not ([IO.File]::ReadAllText($file.FullName).Contains('PRIVATE-FIXTURE'))) 'Se distribuyo una clave privada.'}
 Assert-True ($global:networkFixturecertCalls -eq 1 -and $global:networkFixturecleanupCalls -eq 1 -and $global:networkFixturefirewallCalls -eq 1 -and $global:networkFixtureaclCalls -eq 1) 'No se completo el circuito protegido.'
 foreach($case in @(@('publica','8.8.8.8','192.168.50.0/24'),@('subred-ajena','192.168.50.10','192.168.60.0/24'),@('no-local','192.168.50.10','192.168.50.0/24'),@('firewall-ajeno','192.168.50.10','192.168.50.0/24'))){
  $path=New-Fixture $case[0];$before=[IO.File]::ReadAllText((Join-Path $path '.env'))
  $global:networkFixtureassigned=$case[0] -ne 'no-local';$global:networkFixtureconflictingRule=$case[0] -eq 'firewall-ajeno'
  $failed=$false
  try{Invoke-Network $path $case[1] $case[2] 2>$null|Out-Null}catch{$failed=$true}
  Assert-True $failed ('No se rechazo '+$case[0])
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $path 'data'))) ('Se escribieron archivos antes de rechazar '+$case[0])
  Assert-True ([IO.File]::ReadAllText((Join-Path $path '.env')) -eq $before) 'Un rechazo cambio .env.'
 }
 Assert-True ($global:networkFixturecertCalls -eq 1 -and $global:networkFixturecleanupCalls -eq 1 -and $global:networkFixturefirewallCalls -eq 1 -and $global:networkFixtureaclCalls -eq 1) 'Un rechazo alcanzo operaciones Windows.'
 $global:networkFixtureassigned=$true;$global:networkFixtureconflictingRule=$false;$global:networkFixturefailExport=$true
 $failedExport=New-Fixture 'exportacion-fallida';$failed=$false
 try{Invoke-Network $failedExport|Out-Null}catch{$failed=$true}
 Assert-True ($failed -and $global:networkFixturecertCalls -eq 2 -and $global:networkFixturecleanupCalls -eq 2 -and $global:networkFixturefirewallCalls -eq 1) 'No se limpio el certificado tras fallar la exportacion.'
 Write-Output 'LAN Windows PS5: SAN y EKU separados; rechazos antes de escribir; secretos conservados; cliente publico; limpieza en exito y fallo. Sin cambios reales de certificados, ACL ni firewall.'
}finally{
 $resolved=[IO.Path]::GetFullPath($temporaryRoot);$prefix=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
 if(-not $resolved.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Directorio temporal fuera del limite esperado.'}
 if(Test-Path -LiteralPath $resolved){Microsoft.PowerShell.Management\Remove-Item -LiteralPath $resolved -Recurse -Force}
}
