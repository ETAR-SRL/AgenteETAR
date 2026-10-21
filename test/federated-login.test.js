import test from 'node:test';
import assert from 'node:assert/strict';
import {createFederatedLogin} from '../src/federated-login.js';
function fixture(){
 const sessions=[],headers={};let active=true,claimSubject='subject-1',received;
 const access={hasUsers:()=>true,db:{prepare:()=>({get:()=>({id:'u1'})})},principal:()=>active?{actor:'user:u1:r1',permissions:['read:catalogo']}:null,session:id=>{sessions.push(id);return 'session-token';},store:{audit:()=>{}}};
 const ui={local:()=> 'https://central.example.com',sameOrigin:()=>{},authCookie:token=>'session='+token};
 const client={discovery:async()=>({}),randomState:()=> 'state',randomNonce:()=> 'nonce',randomPKCECodeVerifier:()=> 'verifier',calculatePKCECodeChallenge:async()=> 'challenge',buildAuthorizationUrl:(c,p)=>new URL('https://accounts.google.com/auth?'+new URLSearchParams(p)),authorizationCodeGrant:async(c,u,checks)=>{received=checks;return {claims:()=>({iss:'https://accounts.google.com',sub:claimSubject})};}};
 const env={OIDC_ORIGIN:'https://central.example.com',OIDC_GOOGLE_CLIENT_ID:'test',OIDC_GOOGLE_CLIENT_SECRET:'secret',OIDC_ACCOUNT_LINKS:JSON.stringify([{provider:'google',issuer:'https://accounts.google.com',subject:'subject-1',username:'ana'}])};
 const login=createFederatedLogin({access,ui,env,client}),req={socket:{encrypted:true},headers:{},url:'/api/auth/oidc/google/callback?state=state&code=test'},res={setHeader:(k,v)=>headers[k]=v};
 return {login,req,res,headers,sessions,get checks(){return received;},set active(v){active=v;},set subject(v){claimSubject=v;}};
}
test('federated login defaults disabled and does not advertise credentials',()=>{
 const f=createFederatedLogin({access:{},ui:{},env:{}});assert.ok(f.status('http://127.0.0.1').every(x=>!x.enabled));
 assert.throws(()=>createFederatedLogin({access:{},ui:{},env:{OIDC_ORIGIN:'http://public.example.com'}}));
});
test('OIDC requires browser state and PKCE, links only existing users and consumes state once',async()=>{
 const f=fixture();const r=await f.login.start('google',f.req,f.res);assert.match(r.url,/code_challenge=challenge/);f.req.headers.cookie=f.headers['set-cookie'].split(';')[0];
 await f.login.callback('google',f.req,f.res);assert.deepEqual(f.sessions,['u1']);assert.equal(f.checks.expectedNonce,'nonce');assert.equal(f.checks.pkceCodeVerifier,'verifier');assert.equal(f.checks.idTokenExpected,true);
 await assert.rejects(f.login.callback('google',f.req,f.res),{code:'OIDC_ESTADO'});
});
test('foreign browser, unlinked identity and disabled local user never obtain a session',async()=>{
 for(const kind of ['browser','unlinked','inactive']){const f=fixture();await f.login.start('google',f.req,f.res);if(kind!=='browser')f.req.headers.cookie=f.headers['set-cookie'].split(';')[0];if(kind==='unlinked')f.subject='other';if(kind==='inactive')f.active=false;await assert.rejects(f.login.callback('google',f.req,f.res));assert.equal(f.sessions.length,0);}
});
