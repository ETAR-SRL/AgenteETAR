import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {ServiceSupervisor} from '../src/service-supervisor.js';

function fixture(options = {}) {
  let time = 0, result = {ready: false, occupied: false};
  const children = [];
  const supervisor = new ServiceSupervisor({
    services: [{name: 'server'}], now: () => time, probe: async () => result,
    start: () => { const child = new EventEmitter(); child.pid = 100 + children.length; children.push(child); return child; },
    ...options,
  });
  return {supervisor, children, clock: value => { time = value; }, probe: value => { result = value; }};
}
test('arranca una sola instancia y no mata un proceso vivo aunque no responda', async () => {
  const f = fixture();
  await f.supervisor.tick();
  f.clock(600_000);
  await f.supervisor.tick();
  assert.equal(f.children.length, 1);
  assert.equal(f.supervisor.snapshot()[0].state, 'starting-or-unavailable');
  f.probe({ready: true, occupied: true});
  await f.supervisor.tick();
  assert.equal(f.supervisor.snapshot()[0].state, 'running');
});
test('espera procesos manuales y puertos ajenos sin duplicar ni terminar procesos', async () => {
  const f = fixture();
  f.probe({ready: true, occupied: true});
  await f.supervisor.tick();
  assert.equal(f.supervisor.snapshot()[0].state, 'external-running');
  f.probe({ready: false, occupied: true});
  await f.supervisor.tick();
  assert.equal(f.supervisor.snapshot()[0].state, 'port-occupied');
  assert.equal(f.children.length, 0);
  f.probe({ready: false, occupied: false});
  await f.supervisor.tick();
  assert.equal(f.children.length, 1);
});
test('reintenta después de salir, con espera creciente acotada y sin contar dos veces error/exit', async () => {
  const f = fixture();
  await f.supervisor.tick();
  f.children[0].emit('error', new Error('startup failure'));
  f.children[0].emit('exit', 1);
  assert.equal(f.supervisor.snapshot()[0].failures, 1);
  f.clock(29_999);
  await f.supervisor.tick();
  assert.equal(f.children.length, 1);
  f.clock(30_000);
  await f.supervisor.tick();
  assert.equal(f.children.length, 2);
  for (let i = 0; i < 10; i++) {
    f.children.at(-1).emit('exit', 1);
    const retry = Date.parse(f.supervisor.snapshot()[0].retryAt);
    f.clock(retry);
    await f.supervisor.tick();
  }
  const before = Date.parse(f.supervisor.snapshot()[0].retryAt);
  f.children.at(-1).emit('exit', 1);
  assert.equal(Date.parse(f.supervisor.snapshot()[0].retryAt) - before, 300_000);
});
test('un motor fallido no impide iniciar el otro y los ticks no se superponen', async () => {
  let release, started = [];
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({
    services: [{name: 'ollama'}, {name: 'server'}],
    probe: async () => { await gate; return {ready: false, occupied: false}; },
    start: config => { started.push(config.name); if (config.name === 'ollama') throw new Error('absent'); return new EventEmitter(); },
  });
  const first = f.supervisor.tick();
  await f.supervisor.tick();
  release();
  await first;
  assert.deepEqual(started, ['ollama', 'server']);
  assert.equal(f.supervisor.snapshot()[0].state, 'retry-wait');
  assert.equal(f.supervisor.snapshot()[1].state, 'starting');
});
test('una falla de diagnóstico no lanza otro proceso', async () => {
  const f = fixture({probe: async () => { throw new Error('probe failed'); }});
  await f.supervisor.tick();
  assert.equal(f.children.length, 0);
  assert.equal(f.supervisor.snapshot()[0].state, 'check-failed');
});
