import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {createApp} from '../src/app.js';
import {Store} from '../src/store.js';
import {Access} from '../src/access.js';
import {createDemoKaiqen} from '../src/demo.js';

// Loopback-only ephemeral app, managed personal identities, isolated in-memory Store.
export async function sandboxHttpConfirmation(f,db,alias){
 const store=new Store(':memory:'),access=new Access(store,['0101']);
 const permissions=['read:compras','read:proveedores','read:preciosCompra','read:catalogo','plan:'+f.action,'write:'+f.action];
 for(const [id,perms]of [['sandbox-writer',permissions],['sandbox-reader',permissions.filter(p=>p.startsWith('read:'))]])store.db.prepare('INSERT INTO access_roles VALUES(?,?,?,?,1)').run(id,id,JSON.stringify(perms),JSON.stringify(['0101']));
 for(const [id,role]of [['writer','sandbox-writer'],['other','sandbox-writer'],['reader','sandbox-reader']])store.db.prepare('INSERT INTO access_users VALUES(?,?,?,?,?,1,1)').run(id,id,id,'no-password-login-for-synthetic-session',role);
 const tokens=Object.fromEntries(['writer','other','reader'].map(id=>[id,access.session(id)]));
 const server=createApp({erp:f.erp,kaiqen:createDemoKaiqen(),store,localWrites:true,readKey:randomBytes(32).toString('hex'),planKey:randomBytes(32).toString('hex')});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`;
 const post=async(path,actor,body)=>{const response=await fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+tokens[actor],'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 const count=async()=>(await db.query(`SELECT COUNT(*) count FROM dbo.${alias}010`))[0].count;
 const before=await count(),cases=[];
 const preview=async()=>{const result=await post('/api/changes/preview','writer',f.input);assert.equal(result.status,201,JSON.stringify(result.body));assert.equal(result.body.operation,'insert');assert.equal(result.body.executionEnabled,true);assert.equal(result.body.items.length,2);assert.equal(result.body.calculation.total,'280.00');return result.body;};
 const execute=(proposal,actor,confirmation={confirm:true,fingerprint:proposal.fingerprint})=>post(`/api/changes/${proposal.id}/execute`,actor,confirmation);
 const unchanged=async()=>assert.equal(await count(),before);
 try{
  assert.equal((await post('/api/changes/preview','reader',f.input)).status,403);await unchanged();
  let p=await preview();await unchanged();
  assert.equal((await execute(p,'writer',{confirm:false,fingerprint:p.fingerprint})).status,400);
  assert.equal((await execute(p,'writer',{confirm:true,fingerprint:'0'.repeat(64)})).status,400);
  assert.equal((await execute(p,'other')).status,404);
  assert.equal((await execute(p,'reader')).status,403);await unchanged();
  cases.push({alias,case:'HTTP rejects false confirmation, wrong fingerprint, other actor and reader',before,after:before});
  store.db.prepare('UPDATE access_roles SET permissions=?,revision=revision+1 WHERE id=?').run(JSON.stringify(permissions.filter(x=>!x.startsWith('write:'))),'sandbox-writer');
  assert.equal((await execute(p,'writer')).status,403);await unchanged();
  store.db.prepare('UPDATE access_roles SET permissions=?,revision=revision+1 WHERE id=?').run(JSON.stringify(permissions),'sandbox-writer');
  assert.equal((await execute(p,'writer')).status,404);await unchanged();
  cases.push({alias,case:'HTTP revoked writer cannot execute; restored role does not revive old actor proposal',before,after:before});
  p=await preview();await db.query("UPDATE dbo.SB1010 SET B1_DESC='HTTP stale fixture'");
  const stale=await execute(p,'writer');assert.equal(stale.status,409,JSON.stringify(stale.body));await unchanged();
  await db.query("UPDATE dbo.SB1010 SET B1_DESC='Prueba'");
  cases.push({alias,case:'HTTP revalidates SQL catalog after summary before insert',before,after:before});
  p=await preview();const result=await execute(p,'writer');assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.status,'executed');assert.equal(await count(),before+2);
  const records=result.body.result.records;assert.equal(records.length,2);
  const prefix=alias==='SC1'?'C1':'C7';
  for(const [index,record]of records.entries()){
   const [row]=await db.query(`SELECT CONVERT(varchar(100),${prefix}_QUANT) quantity,CONVERT(varchar(100),${prefix}_${alias==='SC1'?'VUNIT':'PRECO'}) price,CONVERT(varchar(100),${prefix}_TOTAL) total FROM dbo.${alias}010 WHERE R_E_C_N_O_=CONVERT(bigint,@record)`,{record});
   assert.equal(Number(row.quantity),index===0?2500:1000);assert.equal(Number(row.price),0.08);assert.equal(Number(row.total),index===0?200:80);
  }
  assert.deepEqual((await execute(p,'writer')).body,result.body);assert.equal(await count(),before+2);
  cases.push({alias,case:'HTTP exact confirmation commits two verified items; retry returns same receipt without duplicates',before,after:before+2,records});
  return cases;
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();}
}
