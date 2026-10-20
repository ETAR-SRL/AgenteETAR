import { identifier as q, ApiError } from './config.js';
import { clean } from './normalize.js';
export class Catalog {
  constructor(db, config) { this.db = db; this.config = config; this.tables = new Map(); this.dictionary = new Map(); this.sx2 = new Map(); this.warnings = []; }
  async init() {
    const rows = await this.db.query(`SELECT s.name AS schemaName, t.name AS tableName, c.name AS columnName, ty.name AS typeName, c.precision, c.scale, c.is_computed AS computed, c.is_identity AS identityColumn
      FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
      JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id`);
    const all = new Map();
    for (const r of rows) {
      const key = `${r.schemaName}.${r.tableName}`;
      if (!all.has(key)) all.set(key, { schema: r.schemaName, name: r.tableName, columns: new Map() });
      all.get(key).columns.set(r.columnName.toUpperCase(), { name: r.columnName, type: r.typeName, precision: r.precision, scale: r.scale, computed: r.computed, identity:r.identityColumn===undefined?null:Boolean(r.identityColumn) });
    }
    const aliases = new Set(['SX2','SX3','SX5','SX6','SF1','SC9','SY1','SAL','SAK','DHL','DHM','DBL','DBM','SCR','SAI', ...Object.values(this.config.entities).map(e => e.alias)]);
    for (const alias of aliases) {
      const override = this.config.tables?.[alias];
      const candidates = [...all.values()].filter(t => override ? `${t.schema}.${t.name}` === override : t.schema === (this.config.schema || 'dbo') && new RegExp(`^${alias}(?:[0-9]+)?$`, 'i').test(t.name));
      if (candidates.length === 1) this.tables.set(alias, candidates[0]);
      else this.warnings.push(`${alias}:${candidates.length ? 'tabla_ambigua_configurar_tables' : 'tabla_no_disponible'}`);
    }
    if (this.tables.has('SX2')) {
      const table = this.table('SX2');
      if (table.columns.has('X2_CHAVE')) {
        const fields = ['X2_CHAVE','X2_ARQUIVO','X2_NOME','X2_NOMESPA','X2_MODO','X2_MODOEMP','X2_MODOUN'].filter(f=>table.columns.has(f));
        const rows = await this.db.query(`SELECT ${fields.map(q).join(',')} FROM ${this.name('SX2')}${this.deleted('SX2', false)}`);
        for (const row of rows) {
          const alias = clean(row.X2_CHAVE);
          if (!aliases.has(alias)) continue;
          if (this.sx2.has(alias)) throw new ApiError(503, 'DICCIONARIO_AMBIGUO', `SX2 contiene claves repetidas: ${alias}`);
          this.sx2.set(alias, Object.fromEntries(Object.entries(row).map(([k,v])=>[k,clean(v)])));
        }
      }
    }
    if (this.tables.has('SX3')) {
      const table = this.table('SX3');
      if (table.columns.has('X3_CAMPO') && table.columns.has('X3_ARQUIVO')) {
        const fields = ['X3_CAMPO','X3_ARQUIVO','X3_TIPO','X3_TAMANHO','X3_DECIMAL','X3_TITSPA','X3_DESCSPA','X3_CBOXSPA','X3_TITULO','X3_DESCRIC','X3_CBOX','X3_VALID','X3_F3'].filter(f=>table.columns.has(f));
        const wanted = [...aliases];
        const params = Object.fromEntries(wanted.map((a,i)=>[`a${i}`,a]));
        const rows = await this.db.query(`SELECT ${fields.map(q).join(',')} FROM ${this.name('SX3')} WHERE X3_ARQUIVO IN (${wanted.map((_,i)=>`@a${i}`).join(',')})${this.deleted('SX3', true)}`, params);
        for (const row of rows) {
          const key = clean(row.X3_CAMPO);
          if (this.dictionary.has(key)) throw new ApiError(503, 'DICCIONARIO_AMBIGUO', `SX3 contiene campos repetidos: ${key}`);
          this.dictionary.set(key, Object.fromEntries(Object.entries(row).map(([k,v])=>[k,clean(v)])));
        }
      }
    }
    if (!this.dictionary.size) this.warnings.push('SX3_no_disponible:usar_mapeo_explicito_sin_inventar_traducciones');
  }
  table(alias) {
    const t = this.tables.get(alias);
    if (!t) throw new ApiError(503, 'TABLA_NO_DISPONIBLE', `Configurar tabla física inequívoca para ${alias}`);
    return t;
  }
  name(alias) { const t = this.table(alias); return `${q(t.schema)}.${q(t.name)}`; }
  deleted(alias, hasWhere) {
    return this.table(alias).columns.has('D_E_L_E_T_') ? `${hasWhere ? ' AND' : ' WHERE'} [D_E_L_E_T_] = ' '` : '';
  }
  branch(alias, requested) {
    if (Object.hasOwn(this.config.branches || {}, alias)) {
      const rule=this.config.branches[alias];
      if (typeof rule === 'string') return rule;
      if (Object.hasOwn(rule,requested)) return rule[requested];
      throw new ApiError(400,'SUCURSAL_NO_CONFIGURADA',`No está configurada la sucursal ${requested} para ${alias}`);
    }
    // SX2 informa compartición, pero no resuelve por sí solo la filial física.
    // Ningún alias nuevo hereda ni trunca una sucursal solicitada.
    throw new ApiError(503, 'SUCURSAL_CONFIGURACION', `Configurar branches.${alias} según xFilial verificado en este ambiente`);
  }
}
