$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts/service-path-access.ps1')
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$probe = Join-Path $tempRoot ('central-acl-' + [guid]::NewGuid().ToString())
$child = Join-Path $probe 'child'
try {
    [IO.Directory]::CreateDirectory($child) | Out-Null
    $beforeChild = (Get-Acl $child).Sddl
    $beforeProtected = (Get-Acl $probe).AreAccessRulesProtected
    Grant-ServicePathTraversal $probe
    $after = Get-Acl $probe
    if ($after.AreAccessRulesProtected -ne $beforeProtected) { throw 'Cambió la política de herencia' }
    if ((Get-Acl $child).Sddl -ne $beforeChild) { throw 'El cambio se propagó al hijo' }
    $rules = @($after.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq 'S-1-5-19' })
    if ($rules.Count -ne 1 -or $rules[0].InheritanceFlags -ne 'None') { throw 'Regla de servicio incorrecta' }
    $required = [Security.AccessControl.FileSystemRights]::ReadAndExecute
    if (($rules[0].FileSystemRights -band $required) -ne $required) { throw 'Falta acceso para resolver la ruta' }
    Grant-ServicePathTraversal $probe
    if ((Get-Acl $probe).Sddl -ne $after.Sddl) { throw 'La segunda ejecución no fue idempotente' }
    # Verificar también un directorio cuya herencia ya está protegida.
    $protected = Get-Acl $probe
    $protected.SetAccessRuleProtection($true, $true)
    Set-Acl -LiteralPath $probe -AclObject $protected
    Grant-ServicePathTraversal $probe
    if (-not (Get-Acl $probe).AreAccessRulesProtected) { throw 'Se perdió la protección de herencia' }
    Write-Output 'ACL: sin propagación, herencia preservada e idempotente'
} finally {
    $absolute = [IO.Path]::GetFullPath($probe)
    if ($absolute.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($absolute) -match '^central-acl-[0-9a-f-]{36}$') {
        Remove-Item -LiteralPath $absolute -Recurse -Force -ErrorAction SilentlyContinue
    }
}
