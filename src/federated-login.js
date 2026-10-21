import * as oidc from 'openid-client';
import {randomBytes} from 'node:crypto';
import {assert} from './errors.js';
export function createFederatedLogin({access,ui,env=process.env,client=oidc}){
 const origin=env.OIDC_ORIGIN||'',pending=new Map(),configs=new Map();
 if(origin){const u=new URL(origin);assert(u.origin===origin&&(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)),500,'OIDC_CONFIG','OIDC_ORIGIN debe ser un origen HTTPS (HTTP sólo loopback).');}
 const tenant=env.OIDC_MICROSOFT_TENANT_ID;
 const providers={google:{name:'Google',issuer:'https://accounts.google.com',id:env.OIDC_GOOGLE_CLIENT_ID,secret:env.OIDC_GOOGLE_CLIENT_SECRET},microsoft:{name:'Microsoft 365',issuer:tenant&&/^[a-f0-9-]{36}$/i.test(tenant)?`https://login.microsoftonline.com/${tenant}/v2.0`:null,id:env.OIDC_MICROSOFT_CLIENT_ID,secret:env.OIDC_MICROSOFT_CLIENT_SECRET}};
 const links=JSON.parse(env.OIDC_ACCOUNT_LINKS||'[]');assert(Array.isArray(links),500,'OIDC_CONFIG','OIDC_ACCOUNT_LINKS debe ser una lista.');
 const enabled=p=>!!(origin&&p.issuer&&p.id&&p.secret);
 const cookie=(value,secure)=>`central_oidc=${value}; HttpOnly; SameSite=Lax; Path=/api/auth/oidc; Max-Age=${value?300:0}${secure?'; Secure':''}`;
 async function configuration(key){if(!configs.has(key)){const p=providers[key];const promise=client.discovery(new URL(p.issuer),p.id,p.secret).catch(error=>{configs.delete(key);throw error;});configs.set(key,promise);}return configs.get(key);}
 return {
  status(requestOrigin){return Object.entries(providers).map(([id,p])=>({id,name:p.name,enabled:enabled(p)&&requestOrigin===origin}));},
  async start(key,req,res){
   const p=providers[key];assert(p&&enabled(p),503,'OIDC_NO_CONFIGURADO','Este proveedor todavía no está configurado. Usá tu usuario y contraseña.');
   assert(ui.local(req)===origin,403,'OIDC_ORIGEN','Ingresá desde la dirección configurada para el acceso corporativo.');ui.sameOrigin(req);
   assert(access.hasUsers(),403,'OIDC_ALTA_LOCAL','Primero configurá el administrador local.');
   for(const [k,v] of pending)if(v.expires<Date.now())pending.delete(k);
   assert(pending.size<1000,429,'OIDC_OCUPADO','Hay demasiados ingresos pendientes.');
   const config=await configuration(key),state=client.randomState(),nonce=client.randomNonce(),verifier=client.randomPKCECodeVerifier(),browser=randomBytes(32).toString('hex');
   const url=client.buildAuthorizationUrl(config,{redirect_uri:origin+`/api/auth/oidc/${key}/callback`,scope:'openid email profile',state,nonce,code_challenge:await client.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',response_mode:'query'});
   pending.set(state,{key,nonce,verifier,browser,expires:Date.now()+300000});res.setHeader('set-cookie',cookie(browser,req.socket.encrypted));
   return {url:url.href};
  },
  async callback(key,req,res){
   assert(ui.local(req)===origin,403,'OIDC_ORIGEN','Origen de acceso incorrecto.');
   const url=new URL(req.url,origin),state=url.searchParams.get('state'),tx=pending.get(state);pending.delete(state);
   const browser=/(?:^|;\s*)central_oidc=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1];
   res.setHeader('set-cookie',cookie('',req.socket.encrypted));
   assert(tx&&tx.key===key&&tx.expires>Date.now()&&browser===tx.browser,403,'OIDC_ESTADO','El ingreso venció o no corresponde a este navegador.');
   const config=await configuration(key),tokens=await client.authorizationCodeGrant(config,url,{pkceCodeVerifier:tx.verifier,expectedState:state,expectedNonce:tx.nonce,idTokenExpected:true});
   const claims=tokens.claims();assert(claims?.sub&&claims.iss===providers[key].issuer,403,'OIDC_IDENTIDAD','Identidad no verificable.');
   const matches=links.filter(link=>link.provider===key&&link.issuer===claims.iss&&link.subject===claims.sub&&typeof link.username==='string');
   assert(matches.length===1,403,'OIDC_SIN_VINCULO','La identidad externa no está vinculada a un usuario de Central.');
   const user=access.db.prepare('SELECT id FROM access_users WHERE username=?').get(matches[0].username.toLowerCase());
   const principal=user&&access.principal(user.id);assert(principal,403,'OIDC_USUARIO_INACTIVO','Usuario no habilitado.');
   const token=access.session(user.id);res.setHeader('set-cookie',[cookie('',req.socket.encrypted),ui.authCookie(token,req)]);
   access.store.audit(principal.actor,'access.oidc.login',key);
  }
 };
}
