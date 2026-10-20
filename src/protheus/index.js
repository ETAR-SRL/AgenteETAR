import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { connect } from './database.js';
import { Catalog } from './catalog.js';
import { Service } from './service.js';
import {Commercial,commercialResources} from './commercial.js';
import {createWriter} from './writer.js';

// No carga .env. El proceso anfitrión decide cómo inyectar secretos.
export async function createErp({ env = process.env, configPath } = {}) {
  const path = configPath || env.ERP_MAPPING_PATH || env.CONFIG_PATH || fileURLToPath(new URL('../../config/mapping.json', import.meta.url));
  const config = loadConfig(path);
  const db = await connect(env);
  try {
    const catalog = new Catalog(db, config);
    await catalog.init();
    const service = new Service(db, catalog, config);
    const commercial = new Commercial(db,catalog);
    let writeDbPromise;
    const writes=createWriter({db,catalog,enabled:env.ERP_WRITE_ENABLED==='true',allowedBranches:(env.ERP_BRANCHES||'0101').split(','),triggerHashes:config.writeTriggerHashes||{},getWriteDb:()=>writeDbPromise??=connect(env,{writable:true}).catch(error=>{writeDbPromise=undefined;throw error;})});
    return {
      writes,
      list: (name, params) => Object.hasOwn(commercialResources,name)?commercial.list(name,params):service.list(name, params),
      metadata: () => {const meta=service.metadata();return {...meta,entities:{...meta.entities,...commercial.metadata()}};},
      close: async()=>{await db.close();if(writeDbPromise)await (await writeDbPromise).close();}
    };
  } catch (error) {
    await db.close();
    throw error;
  }
}
