import sql from 'mssql';
export async function connect(env = process.env) {
  for (const key of ['DB_SERVER', 'DB_DATABASE', 'DB_USER', 'DB_PASSWORD']) {
    if (!env[key]) throw new Error(`Falta la variable ${key}`);
  }
  if (env.DB_PORT && (!/^\d+$/.test(env.DB_PORT) || Number(env.DB_PORT) < 1 || Number(env.DB_PORT) > 65535)) throw new Error('DB_PORT inválido');
  const options = {
    encrypt: env.DB_ENCRYPT !== 'false',
    trustServerCertificate: env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    readOnlyIntent: true,
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
  return {
    async query(text, params = {}) {
      const req = pool.request();
      for (const [key, value] of Object.entries(params)) {
        req.input(key, typeof value === 'number' ? sql.Int : sql.VarChar(512), value);
      }
      return (await req.query(text)).recordset;
    },
    close: () => pool.close()
  };
}
