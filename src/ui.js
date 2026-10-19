import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { assert } from './errors.js';

const files=new Map([
  ['/','index.html'],['/app.js','app.js'],['/style.css','style.css'],
  ['/manifest.webmanifest','manifest.webmanifest'],['/sw.js','sw.js'],
  ['/icon.svg','icon.svg'],['/icon-192.png','icon-192.png'],['/icon-512.png','icon-512.png']
]);
const mime={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',webmanifest:'application/manifest+json',svg:'image/svg+xml',png:'image/png'};
export function createUi(){
  const sessions=new Map();
  function local(req){
    const host=req.headers.host||'';
    assert(/^(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(host) && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress),403,'SOLO_LOCAL','La PWA requiere acceso local');
    return `http://${host}`;
  }
  function sameOrigin(req){
    const origin=local(req);
    assert(req.headers.origin===origin && (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site']==='same-origin'),403,'ORIGEN_INVALIDO','Abrí la aplicación desde este equipo');
  }
  return {
    principal(req){
      const id=/(?:^|;\s*)central_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1];
      if(!id)return null;
      local(req);
      assert(!req.headers['sec-fetch-site'] || ['same-origin','none'].includes(req.headers['sec-fetch-site']),403,'ORIGEN_INVALIDO','Origen no permitido');
      if(!['GET','HEAD'].includes(req.method))sameOrigin(req);
      const until=sessions.get(id);if(!until || until<Date.now()){sessions.delete(id);return null;}
      return {role:'reader',actor:'ui:'+id.slice(0,12)};
    },
    handle(req,res,path){
      if(path==='/api/ui/session' && req.method==='POST'){
        sameOrigin(req);
        for(const [id,until] of sessions)if(until<Date.now())sessions.delete(id);
        assert(sessions.size<500,429,'SESIONES_AGOTADAS','Demasiadas sesiones locales');
        const id=randomBytes(32).toString('hex');sessions.set(id,Date.now()+12*3600_000);
        res.writeHead(200,{'content-type':'application/json','cache-control':'no-store','set-cookie':`central_session=${id}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=43200`});res.end('{"role":"reader"}');return true;
      }
      if(req.method!=='GET' || !files.has(path))return false;
      local(req);
      const name=files.get(path),content=readFileSync(new URL('../public/'+name,import.meta.url));
      res.writeHead(200,{'content-type':mime[name.split('.').pop()],'cache-control':'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer','permissions-policy':'microphone=(self)','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});res.end(content);return true;
    }
  };
}
