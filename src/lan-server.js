import https from 'node:https';
import {readFileSync} from 'node:fs';
import {createSecureContext} from 'node:tls';
import {createNetworkAccess} from './network-access.js';
import {assert} from './errors.js';

export function loadLanConfig(env=process.env){
 if(env.LAN_HTTPS_ENABLED!=='true')return {network:createNetworkAccess(),lan:null};
 const origins=(env.LAN_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
 const cidrs=(env.LAN_CIDRS||'').split(',').map(s=>s.trim()).filter(Boolean);
 assert(origins.length&&cidrs.length,500,'RED_CONFIG_INVALIDA','Indicar LAN_ORIGINS y LAN_CIDRS.');
 const port=Number(env.LAN_PORT||4311),host=env.LAN_HOST||'0.0.0.0';
 assert(Number.isInteger(port)&&port>0&&port<=65535,500,'RED_CONFIG_INVALIDA','Puerto HTTPS inválido.');
 const network=createNetworkAccess({origins,cidrs});
 assert(origins.every(o=>Number(new URL(o).port||443)===port),500,'RED_CONFIG_INVALIDA','Los orígenes deben usar el puerto HTTPS configurado.');
 assert(env.LAN_TLS_PFX&&env.LAN_TLS_PASSWORD_FILE,500,'RED_TLS_REQUERIDO','Configurar certificado PFX y archivo de contraseña para HTTPS.');
 const tls={pfx:readFileSync(env.LAN_TLS_PFX),passphrase:readFileSync(env.LAN_TLS_PASSWORD_FILE,'utf8').trim(),minVersion:'TLSv1.2'};
 createSecureContext(tls); // Fail startup before connecting to ERP if the certificate is invalid.
 return {network,lan:{host,port,origins,tls}};
}
export function createLanServer(httpServer,lan){
 const listener=httpServer.listeners('request')[0];
 const server=https.createServer(lan.tls,listener);
 server.requestTimeout=httpServer.requestTimeout;server.headersTimeout=httpServer.headersTimeout;
 return server;
}
