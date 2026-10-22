using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.ServiceProcess;
using System.Threading;

// Compilado localmente con el .NET Framework incluido en Windows.
// El job se asigna antes de ejecutar Node: incluye todos sus descendientes.
public sealed class CentralEtarService : ServiceBase {
    const string NameValue = "CentralETAR";
    readonly string root;
    readonly string node;
    readonly object sync = new object();
    IntPtr job = IntPtr.Zero;
    IntPtr process = IntPtr.Zero;
    bool stopping;

    CentralEtarService(string rootPath, string nodePath) {
        root = Path.GetFullPath(rootPath);
        node = Path.GetFullPath(nodePath);
        ServiceName = NameValue;
        CanStop = true;
        CanShutdown = true;
        AutoLog = false;
    }

    static string Quote(string value) {
        if (value.IndexOf('"') >= 0 || value.EndsWith("\\"))
            throw new ArgumentException("Ruta no admitida.");
        return "\"" + value + "\"";
    }

    void Validate() {
        Quote(root); Quote(node);
        foreach (string path in new string[] {node, Path.Combine(root, ".env"), Path.Combine(root, "scripts", "auto-start.mjs")})
            if (!File.Exists(path)) throw new FileNotFoundException("Falta un archivo requerido.", path);
    }

    void Log(string message) {
        // Nunca registrar argumentos, variables de entorno ni credenciales.
        try { File.AppendAllText(Path.Combine(root, "data", "service-host.log"), DateTime.UtcNow.ToString("o") + " " + message + Environment.NewLine); }
        catch { }
    }

    protected override void OnStart(string[] args) {
        Validate();
        lock (sync) {
            stopping = false;
            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new Win32Exception();
            try {
                var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                limits.BasicLimitInformation.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE
                int size = Marshal.SizeOf(limits);
                IntPtr memory = Marshal.AllocHGlobal(size);
                try {
                    Marshal.StructureToPtr(limits, memory, false);
                    if (!SetInformationJobObject(job, 9, memory, (uint)size)) throw new Win32Exception();
                } finally { Marshal.FreeHGlobal(memory); }
                var startup = new STARTUPINFO();
                startup.cb = Marshal.SizeOf(startup);
                PROCESS_INFORMATION info;
                string command = Quote(node) + " " + Quote(Path.Combine(root, "scripts", "auto-start.mjs"));
                if (!CreateProcess(node, new System.Text.StringBuilder(command), IntPtr.Zero, IntPtr.Zero, false,
                    0x08000004, IntPtr.Zero, root, ref startup, out info)) throw new Win32Exception(); // NO_WINDOW | SUSPENDED
                process = info.hProcess;
                try {
                    if (!AssignProcessToJobObject(job, process)) {
                        TerminateProcess(process, 1);
                        throw new Win32Exception();
                    }
                    if (ResumeThread(info.hThread) == UInt32.MaxValue) throw new Win32Exception();
                } finally { CloseHandle(info.hThread); }
                IntPtr watched = process;
                var watcher = new Thread(delegate() {
                    WaitForSingleObject(watched, UInt32.MaxValue);
                    lock (sync) {
                        if (!stopping) {
                            Log("El supervisor termino; Windows aplicara la recuperacion del servicio.");
                            // Salida inesperada del proceso del servicio: SCM ve un fallo
                            // y aplica recovery. Cerrar el job elimina hijos abandonados.
                            if (job != IntPtr.Zero) { CloseHandle(job); job = IntPtr.Zero; }
                            Environment.Exit(1);
                        }
                    }
                });
                watcher.IsBackground = true;
                watcher.Start();
                Log("Servicio iniciado.");
            } catch {
                if (job != IntPtr.Zero) { CloseHandle(job); job = IntPtr.Zero; }
                if (process != IntPtr.Zero) { CloseHandle(process); process = IntPtr.Zero; }
                throw;
            }
        }
    }

    protected override void OnStop() {
        lock (sync) {
            stopping = true;
            // Stop es mantenimiento administrativo. El arbol termina completo;
            // esperar primero a que concluyan las operaciones ERP activas.
            if (job != IntPtr.Zero) { CloseHandle(job); job = IntPtr.Zero; }
            if (process != IntPtr.Zero) {
                WaitForSingleObject(process, 10000);
                CloseHandle(process); process = IntPtr.Zero;
            }
            Log("Servicio detenido.");
        }
    }
    protected override void OnShutdown() { OnStop(); }

    static void ConfigureRecovery() {
        IntPtr manager = OpenSCManager(null, null, 1); // CONNECT
        if (manager == IntPtr.Zero) throw new Win32Exception();
        try {
            IntPtr service = OpenService(manager, NameValue, 2); // CHANGE_CONFIG
            if (service == IntPtr.Zero) throw new Win32Exception();
            try {
                int size = Marshal.SizeOf(typeof(SC_ACTION));
                IntPtr actions = Marshal.AllocHGlobal(size * 4);
                try {
                    // SCM repite la ultima accion: un NONE final limita los
                    // reinicios a tres, en lugar de reiniciar indefinidamente.
                    for (int i = 0; i < 4; i++) {
                        var action = new SC_ACTION { Type = i == 3 ? 0u : 1u, Delay = i == 3 ? 0u : 60000u };
                        Marshal.StructureToPtr(action, IntPtr.Add(actions, size * i), false);
                    }
                    var config = new SERVICE_FAILURE_ACTIONS { ResetPeriod = 86400, Count = 4, Actions = actions };
                    if (!ChangeServiceConfig2(service, 2, ref config)) throw new Win32Exception();
                } finally { Marshal.FreeHGlobal(actions); }
            } finally { CloseServiceHandle(service); }
        } finally { CloseServiceHandle(manager); }
    }

    public static int Main(string[] args) {
        try {
            if (args.Length != 4 && args.Length != 5) return 2;
            if (args[0] != "--root" || args[2] != "--node" || (args.Length == 5 && args[4] != "--check" && args[4] != "--configure-recovery")) return 2;
            var service = new CentralEtarService(args[1], args[3]);
            service.Validate();
            if (args.Length == 5) {
                if (args[4] == "--configure-recovery") ConfigureRecovery();
                else Console.WriteLine("CentralETAR: configuracion valida; no se inicio ningun proceso.");
                return 0;
            }
            ServiceBase.Run(service);
            return 0;
        } catch { Console.Error.WriteLine("No se pudo iniciar CentralETAR. Revisar instalacion y permisos."); return 1; }
    }

    [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUPINFO {
        public int cb; public string lpReserved, lpDesktop, lpTitle;
        public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }
    [StructLayout(LayoutKind.Sequential)] struct SC_ACTION { public uint Type, Delay; }
    [StructLayout(LayoutKind.Sequential)] struct SERVICE_FAILURE_ACTIONS { public uint ResetPeriod; public IntPtr RebootMessage, Command; public uint Count; public IntPtr Actions; }
    [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr OpenSCManager(string machine, string database, uint access);
    [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr OpenService(IntPtr manager, string name, uint access);
    [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool ChangeServiceConfig2(IntPtr service, uint level, ref SERVICE_FAILURE_ACTIONS config);
    [DllImport("advapi32.dll")] static extern bool CloseServiceHandle(IntPtr service);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int info, IntPtr value, uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode, EntryPoint="CreateProcessW")] static extern bool CreateProcess(string app, System.Text.StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref STARTUPINFO startup, out PROCESS_INFORMATION process);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
}
