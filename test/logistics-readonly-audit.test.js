import test from 'node:test';
import assert from 'node:assert/strict';
import {selectOnly,auditLogistics} from '../scripts/check-logistics-updates-readonly.js';

test('real audit transport rejects write SQL, locks, batches and transaction access',async()=>{
 const queries=[],db=selectOnly({query:async(sql,parameters)=>{queries.push({sql,parameters});return []},transaction:()=>{throw new Error('write');}});
 await db.query('SELECT TOP (2) [C6_NUM] FROM [SC6010] WHERE [C6_NUM]=@number',{number:'UPDATE;'});
 assert.equal(queries.length,1);assert.equal(db.transaction,undefined);
 for(const sql of ['UPDATE SC6010 SET C6_LOCAL=1','SELECT * INTO copy FROM SC6010','SELECT 1; DELETE SC6010','SELECT * FROM SC6010 WITH (UPDLOCK,HOLDLOCK)','EXEC sp_executesql @sql','/* comment */ SELECT 1'])assert.throws(()=>db.query(sql),/READ_ONLY_SELECT_REQUIRED/);
});

test('empty ERP documents produce explicit absence and never claim a successful preview',async()=>{
 const catalog={dictionary:new Map(),name:a=>'['+a+']',branch:()=>''};
 const db={query:async sql=>sql.includes('COUNT(*)')?[{count:0}]:[]};
 const writer={prepare:()=>{throw new Error('No rows must mean no preparation');}};
 const report=await auditLogistics({db,catalog,preview:true,writer});
 assert.equal(report.businessWrites,0);assert.equal(report.storeInitialized,false);
 assert.equal(report.proposalsPersisted,0);
 assert.equal(report.documents.every(doc=>doc.activeRows===0&&!doc.existingDocumentsAvailable&&doc.previewedRows===0),true);
 assert.equal(report.catalogs.NNR.activeRows,0);
});

test('preparation audit checks proposals without executing or retaining document identifiers',async()=>{
 const secret='COMMERCIAL_DOCUMENT_DO_NOT_REPORT',columns=new Map([['R_E_C_N_O_',{type:'bigint'}]]);
 const catalog={dictionary:new Map(),name:a=>'['+a+']',branch:()=>'',table:()=>({columns})};
 const row={R_E_C_N_O_:'9007199254740993',C6_NUM:secret,C6_LOCAL:'01',C6_ENTREG:'20261022'};
 const db={query:async sql=>sql.includes('[NNR]')?[{NNR_CODIGO:'02'}]:sql.includes('[SE4]')?[{E4_CODIGO:'001'}]:sql.includes('[SX6]')?[]:sql.includes('COUNT(*)')?[{count:sql.includes('[SC6]')?1:0}]:[row]};
 let prepared=0,checked=0;
 const writer={prepare:async(action,input)=>{prepared++;assert.equal(input.target.registro,row.R_E_C_N_O_);return {diff:[{before:secret,after:'value'}]};},check:async()=>{checked++;return {executionEnabled:true};},execute:()=>{throw new Error('Must never execute');}};
 const report=await auditLogistics({db,catalog,preview:true,writer});
 assert.equal(prepared,4);assert.equal(checked,4);
 assert.equal(report.documents[2].complete,true);
 assert.equal(report.documents[2].results.fechaEntrega.checked,1);
 assert.equal(JSON.stringify(report).includes(secret),false);
 assert.equal(JSON.stringify(report).includes(row.R_E_C_N_O_),false);
});
