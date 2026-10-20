import {BlockList,isIP} from 'node:net';
import {assert} from './errors.js';

const address=value=>value?.startsWith('::ffff:')?value.slice(7):value;
export const isLoopback=value=>['127.0.0.1','::1'].includes(address(value));
const privateRanges=[['10.0.0.0',8],['172.16.0.0',12],['192.168.0.0',16],['100.64.0.0',10],['fc00::',7]];
export function createNetworkAccess({origins=[],cidrs=[]}={}){
 const allowedOrigins=new Set(),networks=new BlockList();
 assert(origins.length===0?cidrs.length===0:cidrs.length>0,500,'RED_CONFIG_INVALIDA','Configurar orígenes HTTPS y subredes juntos.');
 for(const origin of origins){
  let url;try{url=new URL(origin);}catch{}
  assert(url&&url.protocol==='https:'&&url.origin===origin&&url.username===''&&url.password===''&&!url.hostname.includes('*'),500,'RED_CONFIG_INVALIDA','Los orígenes deben ser HTTPS exactos, sin rutas ni comodines.');
  allowedOrigins.add(origin);
 }
 for(const cidr of cidrs){
  const [ip,bits,...extra]=cidr.split('/'),family=isIP(ip),prefix=Number(bits);
  assert(!extra.length&&/^\d+$/.test(bits||'')&&family&&prefix>=0&&prefix<=(family===4?32:128),500,'RED_CONFIG_INVALIDA','Subred CIDR inválida.');
  const privateRange=privateRanges.some(([base,min])=>{
   if(isIP(base)!==family||prefix<min)return false;
   const range=new BlockList();range.addSubnet(base,min,family===4?'ipv4':'ipv6');return range.check(ip,family===4?'ipv4':'ipv6');
  });
  assert(privateRange,500,'RED_CONFIG_INVALIDA','Habilitar sólo subredes privadas explícitas de LAN o VPN.');
  networks.addSubnet(ip,prefix,family===4?'ipv4':'ipv6');
 }
 function origin(req){
  const host=req.headers.host||'',local=isLoopback(req.socket.remoteAddress),tls=req.socket.encrypted===true;
  // Forwarded/X-Forwarded-* are intentionally not trusted.
  if(local&&!tls&&/^(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(host))return `http://${host}`;
  const candidate=`${tls?'https':'http'}://${host}`,ip=address(req.socket.remoteAddress),family=isIP(ip);
  assert(tls&&allowedOrigins.has(candidate)&&(local||(family&&networks.check(ip,family===4?'ipv4':'ipv6'))),403,'RED_NO_AUTORIZADA','Accedé desde la red y la dirección HTTPS habilitadas para Central.');
  return candidate;
 }
 return {origin,isLocal:req=>isLoopback(req.socket.remoteAddress),enabled:allowedOrigins.size>0};
}
