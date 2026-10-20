#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Subnet,
    [ValidateRange(1,65535)][int]$Port = 4311
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location $root
try {
    @{ origins=@("https://localhost:$Port"); cidrs=@($Subnet) } | ConvertTo-Json -Compress |
        & node --input-type=module -e "import fs from 'node:fs';import {createNetworkAccess} from './src/network-access.js';createNetworkAccess(JSON.parse(fs.readFileSync(0,'utf8')));"
    if ($LASTEXITCODE -ne 0) { throw 'Subred privada inválida.' }
    $node = (Get-Command node -ErrorAction Stop).Source
    $name = "Central-ETAR-HTTPS-$Port"
    $existing = Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue
    if ($existing) { Remove-NetFirewallRule -Name $name }
    # Exact port, executable and subnet, including Wi-Fi currently marked Public.
    New-NetFirewallRule -Name $name -DisplayName "Central ETAR HTTPS $Port (LAN)" -Direction Inbound `
        -Action Allow -Protocol TCP -LocalPort $Port -RemoteAddress $Subnet -Program $node `
        -Profile Any -EdgeTraversalPolicy Block | Out-Null
    [IO.File]::WriteAllText((Join-Path $root 'data/lan-firewall-status.txt'),"OK TCP $Port desde $Subnet")
    Write-Output "Habilitado HTTPS TCP $Port sólo desde $Subnet."
} finally { Pop-Location }
