// Supervisa procesos, no transacciones: un proceso vivo nunca se mata por un healthcheck.
export class ServiceSupervisor {
  constructor({services, probe, start, now = Date.now, event = () => {}}) {
    this.probe = probe;
    this.start = start;
    this.now = now;
    this.event = event;
    this.services = services.map(config => ({
      config, child: null, state: 'waiting', failures: 0, retryAt: 0, startedAt: 0,
    }));
    this.ticking = false;
  }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const service of this.services) {
        try { await this.check(service); }
        catch {
          this.setState(service, 'check-failed');
          // Un error de diagnóstico tampoco autoriza terminar un proceso.
        }
      }
    } finally { this.ticking = false; }
  }

  setState(service, state) {
    if (service.state === state) return;
    service.state = state;
    this.event({service: service.config.name, state, pid: service.child?.pid ?? null});
  }

  async check(service) {
    const result = await this.probe(service.config);
    if (service.child) {
      this.setState(service, result.ready ? 'running' : 'starting-or-unavailable');
      if (result.ready && this.now() - service.startedAt > 300_000) service.failures = 0;
      return;
    }
    if (result.ready) {
      this.setState(service, 'external-running');
      return;
    }
    if (result.occupied) {
      this.setState(service, 'port-occupied');
      return;
    }
    if (this.now() < service.retryAt) return;
    try {
      const child = this.start(service.config);
      service.child = child;
      service.startedAt = this.now();
      this.setState(service, 'starting');
      const ended = () => {
        if (service.child !== child) return;
        service.child = null;
        this.failed(service);
      };
      child.once('exit', ended);
      child.once('error', ended);
    } catch { this.failed(service); }
  }

  failed(service) {
    service.failures++;
    const delay = Math.min(300_000, 30_000 * 2 ** Math.min(service.failures - 1, 4));
    service.retryAt = this.now() + delay;
    this.setState(service, 'retry-wait');
  }

  snapshot() {
    return this.services.map(s => ({
      name: s.config.name, state: s.state, pid: s.child?.pid ?? null,
      failures: s.failures, retryAt: s.retryAt ? new Date(s.retryAt).toISOString() : null,
    }));
  }
}
