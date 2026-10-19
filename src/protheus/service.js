import { ApiError, identifier as q } from './config.js';
import { normalize, clean } from './normalize.js';
export function pagination(params) {
  const parse = (name, fallback, max) => {
    const value = params.get(name) ?? String(fallback);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > max) throw new ApiError(400, 'PAGINACION_INVALIDA', `${name} debe ser un entero entre 1 y ${max}`);
    return Number(value);
  };
  return { page: parse('page',1,100000), limit: parse('limit',100,500) };
}
export function buildQuery(catalog, entity, params) {
  const searchFields=Object.entries(entity.fields).filter(([,s])=>['codigo','nombre','nombreFantasia'].includes(typeof s==='string'?s:s.output)).map(([f])=>f).filter(f=>catalog.table(entity.alias).columns.has(f));
  const allowed = new Set(['page','limit','sucursal','registro', ...(searchFields.length?['q']:[]),...(entity.dateField ? ['desde','hasta','orden'] : []), ...(entity.pending ? ['pendiente'] : []), ...Object.keys(entity.filters || {})]);
  for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length !== 1) throw new ApiError(400,'FILTRO_INVALIDO',`Parámetro inválido o duplicado: ${key}`);
  if (!params.has('sucursal')) throw new ApiError(400,'SUCURSAL_REQUERIDA','Indicar sucursal, incluso sucursal= para tablas compartidas');
  const table = catalog.table(entity.alias);
  for (const f of ['R_E_C_N_O_','D_E_L_E_T_',entity.branch, ...(entity.required || [])]) if (!table.columns.has(f)) throw new ApiError(503,'ESQUEMA_INCOMPATIBLE',`Falta ${f} en ${entity.alias}`);
  const paging = pagination(params);
  const bindings = { branch: catalog.branch(entity.alias, params.get('sucursal')), offset: (paging.page-1)*paging.limit, take: paging.limit+1 };
  if (String(bindings.branch).length > 32) throw new ApiError(400,'SUCURSAL_INVALIDA','Sucursal demasiado larga');
  const conditions = [`${q(entity.branch)} = @branch`, `[D_E_L_E_T_] = ' '`];
  if(params.has('q')){
    const query=params.get('q').trim();if(query.length<2||query.length>120)throw new ApiError(400,'BUSQUEDA_INVALIDA','Buscar entre 2 y 120 caracteres');
    const words=query.split(/\s+/);if(words.length>10)throw new ApiError(400,'BUSQUEDA_INVALIDA','Máximo 10 palabras');
    words.forEach((word,i)=>{bindings['search'+i]='%'+word.replace(/[~%_\[]/g,'~$&')+'%';conditions.push('('+searchFields.map(f=>`${q(f)} COLLATE Latin1_General_CI_AI LIKE @search${i} ESCAPE '~'`).join(' OR ')+')');});
  }
  if (params.has('registro')) {
    const registro = params.get('registro');
    if (!/^[1-9]\d{0,18}$/.test(registro) || BigInt(registro) > 9223372036854775807n) throw new ApiError(400,'REGISTRO_INVALIDO','registro debe ser un identificador positivo');
    bindings.registro = registro;
    conditions.push('[R_E_C_N_O_] = CONVERT(bigint,@registro)');
  }
  for (const [key,operator] of [['desde','>='],['hasta','<=']]) {
    if (!params.has(key)) continue;
    const value = params.get(key);
    const parsed = new Date(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value) throw new ApiError(400,'FECHA_INVALIDA',`${key} debe ser una fecha válida YYYY-MM-DD`);
    if (!table.columns.has(entity.dateField)) throw new ApiError(503,'FILTRO_NO_DISPONIBLE',`No existe ${entity.dateField}`);
    bindings[key] = value.replaceAll('-','');
    const physicalType = table.columns.get(entity.dateField).type.toLowerCase();
    if (!['char','varchar','nchar','nvarchar','date','datetime','datetime2','smalldatetime'].includes(physicalType)) throw new ApiError(503,'FILTRO_NO_DISPONIBLE','Tipo físico incompatible con una fecha');
    conditions.push(key === 'hasta' && ['datetime','datetime2','smalldatetime'].includes(physicalType)
      ? `${q(entity.dateField)} < DATEADD(day,1,CONVERT(date,@hasta,112))`
      : `${q(entity.dateField)} ${operator} @${key}`);
  }
  if (params.has('desde') && params.has('hasta') && params.get('desde') > params.get('hasta')) throw new ApiError(400,'FECHA_INVALIDA','desde no puede ser posterior a hasta');
  let pendingExpression;
  if (entity.pending) {
    const {ordered,applied} = entity.pending;
    const numericTypes = new Set(['decimal','numeric','money','smallmoney','int','bigint','smallint','tinyint','float','real']);
    const compatible = [ordered,applied].every(f => table.columns.has(f) && numericTypes.has(table.columns.get(f).type.toLowerCase()));
    if (compatible) pendingExpression = `(${q(ordered)} - ${q(applied)})`;
    if (params.has('pendiente')) {
      if (!['true','false'].includes(params.get('pendiente'))) throw new ApiError(400,'FILTRO_INVALIDO','pendiente debe ser true o false');
      if (!compatible) throw new ApiError(503,'FILTRO_NO_DISPONIBLE','Faltan cantidades numéricas para calcular el saldo técnico');
      conditions.push(`${pendingExpression} ${params.get('pendiente') === 'true' ? '>' : '<='} 0`);
    }
  }
  for (const [key,field] of Object.entries(entity.filters || {})) {
    if (!params.has(key)) continue;
    if (!table.columns.has(field)) throw new ApiError(503,'FILTRO_NO_DISPONIBLE',`No existe ${field}`);
    const value = params.get(key);
    if (!value || value.length > 256) throw new ApiError(400,'FILTRO_INVALIDO',`${key}: longitud inválida`);
    const parameter = `f${Object.keys(bindings).length}`;
    bindings[parameter] = value;
    conditions.push(`${q(field)} = @${parameter}`);
  }
  const fields = [...new Set(['R_E_C_N_O_',entity.branch,...Object.keys(entity.fields), ...(entity.references || []).flatMap(r => Object.keys(r.keys))])].filter(f=>table.columns.has(f));
  const selection = fields.map(f => {
    const spec = entity.fields[f];
    if (spec?.type === 'decimal') {
      const type=table.columns.get(f).type.toLowerCase();
      // float/real requieren style 3 (17 dígitos); money requiere style 2 (4 decimales).
      // La conversión por defecto de SQL Server perdería precisión antes de Node.
      const style=type==='float'||type==='real' ? ',3' : type==='money'||type==='smallmoney' ? ',2' : '';
      return `CONVERT(varchar(80),${q(f)}${style}) AS ${q(f)}`;
    }
    return f === 'R_E_C_N_O_' ? `CONVERT(varchar(80),${q(f)}) AS ${q(f)}` : q(f);
  });
  if (pendingExpression) {
    const types=[entity.pending.ordered,entity.pending.applied].map(f=>table.columns.get(f).type.toLowerCase());
    const style=types.some(t=>t==='float'||t==='real') ? ',3' : types.some(t=>t==='money'||t==='smallmoney') ? ',2' : '';
    selection.push(`CONVERT(varchar(80),${pendingExpression}${style}) AS [__saldoTecnico]`);
  }
  let order='[R_E_C_N_O_]';
  if(params.has('orden')){if(params.get('orden')!=='reciente'||!catalog.table(entity.alias).columns.has(entity.dateField))throw new ApiError(400,'ORDEN_INVALIDO','Orden no disponible');order=`${q(entity.dateField)} DESC,[R_E_C_N_O_] DESC`;}
  return { text: `SELECT ${selection.join(',')} FROM ${catalog.name(entity.alias)} WHERE ${conditions.join(' AND ')} ORDER BY ${order} OFFSET @offset ROWS FETCH NEXT @take ROWS ONLY`, bindings, ...paging };
}
export class Service {
  constructor(db,catalog,config) { this.db=db; this.catalog=catalog; this.config=config; }
  entity(name) {
    const entity = Object.hasOwn(this.config.entities,name) ? this.config.entities[name] : null;
    if (!entity) throw new ApiError(404,'RECURSO_NO_EXISTE','Recurso inexistente');
    return entity;
  }
  async lookups(entity, branch) {
    const result = {};
    for (const [field,spec] of Object.entries(entity.fields)) {
      if (!this.catalog.table(entity.alias).columns.has(field)) continue;
      if (spec.currencyParameters) {
        if (!this.catalog.tables.has('SX6')) continue;
        if (!['X6_VAR','X6_CONTEUD','X6_FIL','D_E_L_E_T_'].every(f=>this.catalog.table('SX6').columns.has(f))) continue;
        const rows=await this.db.query(`SELECT [X6_VAR],[X6_CONTEUD] FROM ${this.catalog.name('SX6')} WHERE [X6_FIL]=@branch AND [X6_VAR] IN ('MV_MOEDA1','MV_MOEDA2','MV_MOEDA3','MV_MOEDA4','MV_MOEDA5')${this.catalog.deleted('SX6',true)}`,{branch:this.catalog.branch('SX6',branch)});
        result[field]={};
        for(const row of rows) {
          const key=clean(row.X6_VAR).slice(-1);
          if(Object.hasOwn(result[field],key)) throw new ApiError(503,'TRADUCCION_AMBIGUA',`Moneda duplicada: ${key}`);
          result[field][key]=clean(row.X6_CONTEUD);
        }
        continue;
      }
      // Solo reconoce un patrón literal conocido; nunca ejecuta expresiones ADVPL.
      const validation = this.catalog.dictionary.get(field)?.X3_VALID || '';
      const inferred = /ExistCpo\(\s*["']SX5["']\s*,\s*["']([A-Za-z0-9]{2})["']\s*\+/i.exec(validation)?.[1];
      const lookup = spec.lookup || (inferred ? {table:inferred} : null);
      if (!lookup || !this.catalog.tables.has('SX5')) continue;
      const table = this.catalog.table('SX5');
      if (!['X5_CHAVE','X5_TABELA','X5_FILIAL','D_E_L_E_T_'].every(f=>table.columns.has(f))) continue;
      const description = table.columns.has('X5_DESCSPA') ? 'X5_DESCSPA' : null;
      if (!description) continue;
      const rows = await this.db.query(`SELECT [X5_CHAVE], ${q(description)} FROM ${this.catalog.name('SX5')} WHERE [X5_TABELA]=@table AND [X5_FILIAL]=@branch${this.catalog.deleted('SX5',true)}`, { table: lookup.table, branch: this.catalog.branch('SX5', branch) });
      result[field] = {};
      for (const row of rows) {
        const key = clean(row.X5_CHAVE);
        if (Object.hasOwn(result[field],key)) throw new ApiError(503,'TRADUCCION_AMBIGUA',`SX5 duplicado: ${key}`);
        result[field][key] = clean(row[description]);
      }
    }
    return result;
  }
  async list(name, params) {
    const entity = this.entity(name);
    const query = buildQuery(this.catalog,entity,params);
    const rows = await this.db.query(query.text,query.bindings);
    const lookups = await this.lookups(entity,params.get('sucursal'));
    const selected = rows.slice(0,query.limit);
    const data = selected.map(row=>normalize(row,entity,this.catalog.dictionary,lookups));
    await this.enrich(entity, selected, data, params.get('sucursal'));
    return { data, meta: {
      recurso: name, tabla: entity.alias, sucursalEfectiva: query.bindings.branch,
      page: query.page, limit: query.limit, hasMore: rows.length > query.limit,
      fechaFiltro: entity.dateField || null,
      advertencias: [...this.catalog.warnings, ...(entity.warnings || []), ...(entity.pending ? ['saldo_tecnico:comparacion_de_cantidades_no_acredita_entrega_fisica_ni_estado_comercial'] : [])]
    } };
  }
  async enrich(entity, rows, data, branch) {
    for (const reference of entity.references || []) {
      const target = this.entity(reference.entity);
      const keys = Object.entries(reference.keys);
      const table = this.catalog.tables.get(target.alias);
      if (!table || keys.some(([local,remote])=>!this.catalog.tables.get(entity.alias)?.columns.has(local) || !table.columns.has(remote))) {
        for (const row of data) { row[reference.output]=null; (row.advertencias ||= []).push(`referencia_no_disponible:${reference.output}`); }
        continue;
      }
      for(const field of ['D_E_L_E_T_',target.branch]) if(!table.columns.has(field)) throw new ApiError(503,'ESQUEMA_INCOMPATIBLE',`Falta ${field}`);
      const tuples = [...new Map(rows.map(r=>[JSON.stringify(keys.map(([local])=>clean(r[local]))),keys.map(([local])=>clean(r[local]))])).values()].filter(v=>v.every(x=>x!=null && x!==''));
      if(!tuples.length) { for(const row of data) row[reference.output]=null; continue; }
      const bindings={branch:this.catalog.branch(target.alias,branch)};
      const clauses=tuples.map((values,i)=>`(${keys.map(([,remote],j)=>{ const parameter=`k${i}_${j}`;bindings[parameter]=values[j]; return `${q(remote)}=@${parameter}`; }).join(' AND ')})`);
      const fields=[...new Set([...keys.map(([,remote])=>remote),...Object.keys(reference.fields)])].filter(f=>table.columns.has(f));
      const found=await this.db.query(`SELECT ${fields.map(q).join(',')} FROM ${this.catalog.name(target.alias)} WHERE ${q(target.branch)}=@branch AND [D_E_L_E_T_]=' ' AND (${clauses.join(' OR ')})`,bindings);
      const index=new Map();
      for(const row of found) { const key=JSON.stringify(keys.map(([,remote])=>clean(row[remote]))); if(index.has(key)) index.set(key,null);else index.set(key,row); }
      rows.forEach((row,i)=>{
        const key=JSON.stringify(keys.map(([local])=>clean(row[local])));
        const related=index.get(key);
        data[i][reference.output]=related ? Object.fromEntries(Object.entries(reference.fields).map(([field,output])=>[output,clean(related[field]) ?? null])) : null;
        if(!related) (data[i].advertencias ||= []).push(`${index.has(key)?'referencia_ambigua':'referencia_no_encontrada'}:${reference.output}`);
      });
    }
  }
  async customerPrices(code, store, params) {
    pagination(params);
    const clientParams = new URLSearchParams({ sucursal: params.get('sucursal') ?? '', codigo: code, tienda: store, limit: '2' });
    if (!params.has('sucursal')) throw new ApiError(400,'SUCURSAL_REQUERIDA','Indicar sucursal');
    for (const key of params.keys()) if (!['sucursal','page','limit'].includes(key) || params.getAll(key).length !== 1) throw new ApiError(400,'FILTRO_INVALIDO',`Parámetro inválido: ${key}`);
    const clients = await this.list('clientes',clientParams);
    if (!clients.data.length) throw new ApiError(404,'CLIENTE_NO_EXISTE','Cliente inexistente');
    if (clients.data.length !== 1) throw new ApiError(409,'CLIENTE_AMBIGUO','Cliente duplicado');
    // Se usa el campo físico: cambiar el nombre de salida en JSON no rompe la relación.
    const cq = buildQuery(this.catalog,this.entity('clientes'),clientParams);
    const client = (await this.db.query(cq.text,cq.bindings))[0];
    const priceCode = clean(client.A1_TABELA);
    if (!priceCode) return { data: [], meta: { cliente: code, tienda: store, advertencias: ['cliente_sin_lista_de_precios'] } };
    const itemParams = new URLSearchParams(params); itemParams.set('lista',priceCode);
    const headerParams = new URLSearchParams({ sucursal: params.get('sucursal'), codigo: priceCode, limit:'2' });
    const header = await this.list('listasPreciosClientes',headerParams);
    if (header.data.length !== 1) throw new ApiError(409,'LISTA_AMBIGUA_O_AUSENTE','DA0 debe contener una cabecera única para A1_TABELA');
    const items = await this.list('preciosClientes',itemParams);
    return { ...items, lista: header.data[0], meta: { ...items.meta, cliente: code, tienda: store, lista: priceCode, advertencias: [...items.meta.advertencias,'precios_de_lista_no_cotizacion_final:ver_moneda_vigencia_impuestos_descuentos'] } };
  }
  metadata() {
    return {
      advertencias: this.catalog.warnings,
      tables: Object.fromEntries([...this.catalog.tables].map(([a,t])=>[a,{ fisica:`${t.schema}.${t.name}`, diccionario: this.catalog.sx2.get(a) || null }])),
      entities: Object.fromEntries(Object.entries(this.config.entities).map(([name,e])=> {
        const table = this.catalog.tables.get(e.alias);
        const missing = ['R_E_C_N_O_','D_E_L_E_T_',e.branch,...(e.required || [])].filter(f=>!table?.columns.has(f));
        const branches = this.config.branches?.[e.alias];
        return [name, {
          alias:e.alias, disponible:!!table && !missing.length,
          columnasRequeridasAusentes:missing, sucursalesConfiguradas:branches ?? null,
          requiereConfigurarSucursal:!branches || (typeof branches === 'object' && !Object.keys(branches).length),
          filters:{registro:'R_E_C_N_O_',...e.filters,...(Object.values(e.fields).some(s=>['codigo','nombre','nombreFantasia'].includes(typeof s==='string'?s:s.output))?{q:'búsqueda por código o nombre'}:{})}, fechaFiltro:e.dateField || null,
          pendiente:e.pending ? { ...e.pending, significado:'saldo técnico; no prueba entrega física ni estado comercial' } : null,
          advertencias:e.warnings || [],
          fields:Object.entries(e.fields).map(([field,spec])=>({ origen:field, salida:typeof spec==='string'?spec:spec.output, tipo:typeof spec==='string'?'text':spec.type || 'text', tipoFisico:table?.columns.get(field)?.type || null, disponible:table?.columns.has(field) || false, diccionario:this.catalog.dictionary.get(field) || null }))
        }];
      }))
    };
  }
}
