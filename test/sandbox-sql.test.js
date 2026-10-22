import test from 'node:test';
import assert from 'node:assert/strict';
import {sandboxConnection} from '../scripts/sandbox-sql-transport.js';
test('sandbox refuses production, remote, malformed and missing identities before opening a connection',()=>{
 for(const database of ['TFDCYW_P2510_PRD','TFDCYW_P2510_DEV','master','AgenteSqlSandbox_1234',undefined,'AgenteSqlSandbox_1234567890abcdef;DROP DATABASE master']){
  assert.throws(()=>sandboxConnection({database,token:'a'.repeat(64)}),/SANDBOX_IDENTITY_INVALID/);
 }
 for(const token of ['',undefined,"' OR 1=1",'a'.repeat(63)])assert.throws(()=>sandboxConnection({database:'AgenteSqlSandbox_1234567890abcdef',token}),/SANDBOX_IDENTITY_INVALID/);
});
