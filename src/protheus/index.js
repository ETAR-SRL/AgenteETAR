import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { connect } from './database.js';
import { Catalog } from './catalog.js';
import { Service } from './service.js';

// No carga .env. El proceso anfitrión decide cómo inyectar secretos.
export async function createErp({ env = process.env, configPath } = {}) {
  const path = configPath || env.ERP_MAPPING_PATH || env.CONFIG_PATH || fileURLToPath(new URL('../../config/mapping.json', import.meta.url));
  const config = loadConfig(path);
  const db = await connect(env);
  try {
    const catalog = new Catalog(db, config);
    await catalog.init();
    const service = new Service(db, catalog, config);
    return {
      list: (name, params) => service.list(name, params),
      metadata: () => service.metadata(),
      close: () => db.close()
    };
  } catch (error) {
    await db.close();
    throw error;
  }
}
