import { readFileSync } from 'node:fs';
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export function identifier(s) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw new Error(`Identificador inválido: ${s}`);
  return `[${s}]`;
}
export function loadConfig(path = process.env.CONFIG_PATH || 'config/mapping.json') {
  const config = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  if (!config.entities || typeof config.entities !== 'object') throw new Error('Configurar entities');
  if (config.schema) identifier(config.schema);
  for (const [alias, physical] of Object.entries(config.tables || {})) {
    identifier(alias);
    if (typeof physical !== 'string' || physical.split('.').length !== 2) throw new Error(`Tabla física inválida: ${alias}`);
    physical.split('.').forEach(identifier);
  }
  for (const [alias, rule] of Object.entries(config.branches || {})) {
    identifier(alias);
    const values = typeof rule === 'string' ? [rule] : rule && typeof rule === 'object' && !Array.isArray(rule) ? Object.values(rule) : null;
    if (!values || values.some(value => typeof value !== 'string' || value.length > 32)) throw new Error(`Regla de filial inválida: ${alias}`);
  }
  for (const [name, e] of Object.entries(config.entities)) {
    identifier(name); identifier(e.alias); identifier(e.branch);
    const names = new Set(['registro', 'sucursal', 'advertencias']);
    for (const [field, spec] of Object.entries(e.fields)) {
      identifier(field);
      const out = typeof spec === 'string' ? spec : spec.output;
      if (!out || names.has(out) || ['__proto__', 'constructor', 'prototype'].includes(out)) throw new Error(`Salida inválida/duplicada: ${out}`);
      names.add(out);
      if (spec.type === 'cuit') {
        if (names.has(`${out}Valido`)) throw new Error('Salida CUIT duplicada');
        names.add(`${out}Valido`);
      }
    }
    for (const field of Object.values(e.filters || {})) identifier(field);
    for (const field of e.required || []) identifier(field);
    if (e.dateField) identifier(e.dateField);
    if(e.nonZeroField)identifier(e.nonZeroField);
    for(const [field,value]of Object.entries(e.fixedFilters||{})){identifier(field);if(typeof value!=='string'||!value||value.length>256)throw new Error('Condición fija inválida');}
    if (e.pending) {
      identifier(e.pending.ordered); identifier(e.pending.applied);
      if (names.has('saldoTecnico')) throw new Error('Salida saldoTecnico reservada');
    }
    for (const ref of e.references || []) {
      if (!config.entities[ref.entity] || !ref.output || names.has(ref.output) || ['__proto__','prototype','constructor'].includes(ref.output)) throw new Error('Referencia inválida');
      names.add(ref.output);
      for(const [local,remote] of Object.entries(ref.keys)) { identifier(local); identifier(remote); }
      for(const field of Object.keys(ref.fields)) identifier(field);
    }
  }
  return config;
}
