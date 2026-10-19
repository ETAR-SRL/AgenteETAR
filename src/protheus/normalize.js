export const clean = value => typeof value === 'string' ? value.trim() : value ?? null;
export function options(text) {
  return Object.fromEntries(String(text || '').split(';').flatMap(part => {
    const at = part.indexOf('=');
    return at > 0 ? [[part.slice(0, at).trim(), part.slice(at + 1).trim()]] : [];
  }));
}
export function date(value) {
  const s = clean(value);
  if (!s) return null;
  if (s instanceof Date) return s.toISOString().slice(0, 10);
  if (!/^\d{8}$/.test(s)) return null;
  const iso = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === iso ? iso : null;
}
export function cuit(value) {
  const original = clean(value);
  const digits = String(original || '').replace(/\D/g, '');
  if (!/^\d{11}$/.test(digits)) return { valor: original || null, valido: false };
  const sum = [5,4,3,2,7,6,5,4,3,2].reduce((n,w,i) => n + w * Number(digits[i]), 0);
  const mod = 11 - sum % 11;
  const check = mod === 11 ? 0 : mod === 10 ? 9 : mod;
  return { valor: `${digits.slice(0,2)}-${digits.slice(2,10)}-${digits[10]}`, valido: check === Number(digits[10]) };
}
export function normalize(row, entity, dictionary, lookups = {}) {
  const result = { registro: String(row.R_E_C_N_O_), sucursal: clean(row[entity.branch]) };
  const warnings = [];
  for (const [field, spec0] of Object.entries(entity.fields)) {
    const spec = typeof spec0 === 'string' ? { output: spec0 } : spec0;
    const value = clean(row[field]);
    if (!(field in row)) warnings.push(`campo_no_disponible:${field}`);
    const meta = dictionary.get(field) || {};
    let out = value === '' ? null : value;
    if (spec.type === 'date' || meta.X3_TIPO === 'D') {
      out = date(value);
      if (value && !out) warnings.push(`fecha_invalida:${field}`);
    }
    if (spec.type === 'decimal') out = value == null || value === '' ? null : String(value);
    if (spec.type === 'cuit') {
      const checked = cuit(value);
      out = checked.valor;
      result[`${spec.output}Valido`] = checked.valido;
      if (value && !checked.valido) warnings.push(`cuit_no_valido:${field}`);
    }
    if (spec.enum || spec.lookup || spec.currencyParameters || meta.X3_CBOXSPA || meta.X3_CBOX) {
      const spanish = options(meta.X3_CBOXSPA);
      const fallback = options(meta.X3_CBOX);
      const explicit = spec.enum || {};
      const lookup = lookups[field] || {};
      const label = explicit[value] ?? spanish[value] ?? lookup[value];
      out = value == null || value === '' ? null : { codigo: String(value), descripcion: label || fallback[value] || null, idioma: label ? 'es' : fallback[value] ? 'pt' : null };
      if (value && !label) warnings.push(`sin_traduccion_es:${field}:${value}`);
    }
    result[spec.output] = out;
  }
  if (entity.pending) {
    result.saldoTecnico = row.__saldoTecnico == null ? null : String(row.__saldoTecnico);
    if (row.__saldoTecnico == null) warnings.push('saldo_tecnico_no_disponible');
  }
  if (warnings.length) result.advertencias = warnings;
  return result;
}
