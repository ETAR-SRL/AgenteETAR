import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createConnection, createServer} from 'node:net';
import {appendFileSync, closeSync, existsSync, mkdirSync, openSync, renameSync, statSync, writeFileSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ServiceSupervisor} from '../src/service-supervisor.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
loadEnvFile(resolve(root, '.env'));
const data = resolve(root, 'data');
mkdirSync(data, {recursive: true});
const logPath = resolve(data, 'autostart.log');
function rotate(path) {
  if (existsSync(path) && statSync(path).size > 5 * 1024 * 1024) renameSync(path, path + '.previous');
}
function log(event) {
  rotate(logPath);
  appendFileSync(logPath, JSON.stringify({at: new Date().toISOString(), ...event}) + '\n');
}

// El kernel libera el pipe incluso ante cierre inesperado. No hay lockfile obsoleto.
const id = createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 16);
const lock = createServer(socket => socket.destroy());
lock.on('error', error => {
  if (error.code === 'EADDRINUSE') process.exit(0);
  console.error('No se pudo obtener el bloqueo del supervisor:', error.code);
  process.exit(1);
});
await new Promise(done => lock.listen(`\\\\.\\pipe\\CentralETAR-${id}`, done));

function portBusy(port, host = '127.0.0.1') {
  return new Promise(done => {
    const socket = createConnection({port, host});
    const finish = busy => { socket.destroy(); done(busy); };
    socket.once('connect', () => finish(true));
    socket.once('error', error => finish(error.code !== 'ECONNREFUSED'));
    socket.setTimeout(1500, () => finish(true));
  });
}
async function jsonHealth(url, validate) {
  try {
    const response = await fetch(url, {signal: AbortSignal.timeout(2500)});
    return response.ok && validate(await response.json());
  } catch { return false; }
}
const port = Number(process.env.PORT || 4310);
const host = process.env.HOST || '127.0.0.1';
const lanEnabled = process.env.LAN_HTTPS_ENABLED === 'true';
const lanPort = Number(process.env.LAN_PORT || 4311);
const lanHost = process.env.LAN_HOST || '0.0.0.0';
const lanProbeHost = lanHost === '0.0.0.0' ? '127.0.0.1' : lanHost === '::' ? '::1' : lanHost;
const ollama = resolve(data, 'llm-runtime', 'ollama.exe');
const services = [];
if (existsSync(ollama)) services.push({name: 'ollama', executable: ollama, args: ['serve']});
services.push({name: 'server', executable: process.execPath, args: ['--env-file=.env', 'src/server.js']});

const supervisor = new ServiceSupervisor({
  services,
  event: log,
  async probe(service) {
    if (service.name === 'ollama') {
      const ready = await jsonHealth('http://127.0.0.1:11434/api/version', value => typeof value.version === 'string');
      return {ready, occupied: ready || await portBusy(11434)};
    }
    const [httpBusy, lanBusy] = await Promise.all([
      portBusy(port, host), lanEnabled ? portBusy(lanPort, lanProbeHost) : false,
    ]);
    const url = `http://${host === '::1' ? '[::1]' : host}:${port}/health`;
    const ready = httpBusy && (!lanEnabled || lanBusy) && await jsonHealth(url, value => value.status === 'up');
    return {ready, occupied: httpBusy || lanBusy};
  },
  start(service) {
    const env = {...process.env};
    if (service.name === 'ollama') Object.assign(env, {
      OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_MODELS: resolve(data, 'llm-models'),
      OLLAMA_NO_CLOUD: '1', OLLAMA_NUM_PARALLEL: '1', OLLAMA_IGPU_ENABLE: '1',
      OLLAMA_VULKAN: '1', OLLAMA_CONTEXT_LENGTH: '8192',
    });
    const fds = [];
    try {
      for (const stream of ['stdout', 'stderr']) {
        const path = resolve(data, `${service.name}.${stream}.log`);
        rotate(path);
        fds.push(openSync(path, 'a'));
      }
      const child = spawn(service.executable, service.args, {
        cwd: root, env, windowsHide: true, stdio: ['ignore', ...fds],
      });
      if (child.pid) writeFileSync(resolve(data, `${service.name}.pid`), String(child.pid));
      return child;
    } finally { for (const fd of fds) closeSync(fd); }
  },
});
log({event: 'supervisor-started', pid: process.pid});
async function tick() {
  await supervisor.tick();
  writeFileSync(resolve(data, 'autostart.status.json'), JSON.stringify({
    pid: process.pid, updatedAt: new Date().toISOString(), services: supervisor.snapshot(),
  }, null, 2));
}
await tick();
setInterval(() => tick().catch(() => log({event: 'status-write-failed'})), 10_000);
// No reiniciamos procesos vivos ni exponemos una API de control. Detener la tarea
// es mantenimiento administrativo: antes deben finalizar las operaciones activas.
