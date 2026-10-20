# Acceso a directorios padre sin propagar ACL por el perfil o el disco.
# SetFileSecurity se usa aquí específicamente porque no propaga ACL a hijos:
# https://learn.microsoft.com/windows/win32/api/securitybaseapi/nf-securitybaseapi-setfilesecurityw
if (-not ('CentralStartup.DirectoryAcl' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
namespace CentralStartup {
    public static class DirectoryAcl {
        [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        static extern bool SetFileSecurityW(string path, uint info, byte[] descriptor);
        public static void SetDacl(string path, byte[] descriptor) {
            if (!SetFileSecurityW(path, 4, descriptor))
                throw new Win32Exception(Marshal.GetLastWin32Error());
        }
    }
}
'@
}
function Grant-ServicePathTraversal([string]$Path) {
    $acl = Get-Acl -LiteralPath $Path
    $before = $acl.Sddl
    $sid = [Security.Principal.SecurityIdentifier]::new('S-1-5-19')
    $rights = [Security.AccessControl.FileSystemRights]'ReadAndExecute, Synchronize'
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, $rights, 'None', 'None', 'Allow')
    $acl.AddAccessRule($rule)
    if ($before -ne $acl.Sddl) { [CentralStartup.DirectoryAcl]::SetDacl($Path, $acl.GetSecurityDescriptorBinaryForm()) }
}
