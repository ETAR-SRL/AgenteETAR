import sql from 'mssql';
import {HttpError} from '../errors.js';
export async function connect(env = process.env,{writable=false}={}) {
  for (const key of ['DB_SERVER', 'DB_DATABASE', 'DB_USER', 'DB_PASSWORD']) {
    if (!env[key]) throw new Error(`Falta la variable ${key}`);
  }
  if (env.DB_PORT && (!/^\d+$/.test(env.DB_PORT) || Number(env.DB_PORT) < 1 || Number(env.DB_PORT) > 65535)) throw new Error('DB_PORT inválido');
  const options = {
    encrypt: env.DB_ENCRYPT !== 'false',
    trustServerCertificate: env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    readOnlyIntent: !writable,
    useUTC: true
  };
  if (!env.DB_PORT && env.DB_INSTANCE) options.instanceName = env.DB_INSTANCE;
  const pool = await new sql.ConnectionPool({
    server: env.DB_SERVER, database: env.DB_DATABASE,
    user: env.DB_USER, password: env.DB_PASSWORD,
    ...(env.DB_PORT ? { port: Number(env.DB_PORT) } : {}),
    options, connectionTimeout: 10000, requestTimeout: 15000,
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 }
  }).connect();
  function queries(owner){return {async query(text,params={}){
      const req = owner.request ? owner.request() : new sql.Request(owner);
      for (const [key, value] of Object.entries(params)) {
        req.input(key, typeof value === 'number' ? sql.Int : sql.VarChar(512), value);
      }
      const result=await req.query(text);return result.recordsets?.at(-1)||result.recordset||[];
  }};}
  return {
    ...queries(pool),
    async transaction(callback){
      if(!writable)throw new HttpError(503,'ESCRITURA_DESHABILITADA','La conexión no permite transacciones de escritura');
      return transact(new sql.Transaction(pool),callback,queries,sql.ISOLATION_LEVEL.SERIALIZABLE);
    },
    close: () => pool.close()
  };
}

// Separado del transporte para probar rollback y pérdida de confirmación sin tocar el ERP.
export async function transact(tx,callback,queries,isolation){
  let committing=false,aborted=false,begun=false;tx.on('rollback',()=>{aborted=true;});
  try{
    await tx.begin(isolation);begun=true;
    const session=queries(tx);await session.query('SET XACT_ABORT ON; SET LOCK_TIMEOUT 10000;');
    const result=await callback(session);committing=true;await tx.commit();return result;
  }catch(error){
    if(committing){try{if(!aborted)await tx.rollback();}catch{}const unknown=new HttpError(503,'RESULTADO_INCIERTO','Se perdió la confirmación del COMMIT; no reintentar automáticamente');unknown.outcomeUnknown=true;throw unknown;}
    try{if(begun&&!aborted)await tx.rollback();}catch{const unknown=new HttpError(503,'RESULTADO_INCIERTO','No se pudo confirmar el rollback');unknown.outcomeUnknown=true;throw unknown;}
    throw error;
  }
}
