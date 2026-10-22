import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {offlineValidationAdapters,runIntegrationValidation,validateSample} from '../src/integration-validation.js';
const script=fileURLToPath(new URL('../scripts/validate-integration.js',import.meta.url));
test('offline runner labels fixture evidence, preserves millar and currency semantics and never executes',async()=>{const {erp,kaiqen}=offlineValidationAdapters();let executions=0;erp.writes.execute=()=>executions++;const report=await runIntegrationValidation({mode:'offline',branch:'TEST',erp,kaiqen,projectId:'fixture',prepare:true});assert.equal(report.realValidation,'not_performed');assert.equal(report.evidence,'controlled_fixtures_only');assert.equal(report.checksStatus,'bounded_checks_completed');assert.equal(executions,0);assert.equal(report.erpWrites,0);assert(report.relationships.some(r=>r.name==='SC6_SD2_pedido_item'&&r.status==='passed'));assert(report.relationships.some(r=>r.name==='remito_SD2_documento_serie'&&r.status==='passed'));assert.equal(report.proposals[0].status,'prepared_only');assert(!JSON.stringify(report).includes('ZTEST'));});
test('source errors omit error messages and sample rows; unavailable is not validation passed',async()=>{const {erp}=offlineValidationAdapters();erp.list=async()=>{throw Object.assign(Error('password SECRET host payroll'),{code:'DB_DOWN'});};const report=await runIntegrationValidation({mode:'live',branch:'0101',erp});assert.equal(report.checksStatus,'failed');assert.equal(report.availability.erp,true);assert.equal(report.realValidation,'partial_requires_review');assert(!JSON.stringify(report).includes('SECRET'));assert(report.results.some(r=>r.code==='DB_DOWN'));});
test('enabled writer is rejected before any read and wrong millar quantities are flagged',async()=>{let read=0;await assert.rejects(runIntegrationValidation({mode:'live',branch:'0101',erp:{writes:{enabled:true},metadata:()=>{read++;}}}),{code:'VALIDATION_WRITER_ENABLED'});assert.equal(read,0);assert.equal(validateSample('itemsVentas',[{unidadMedida:'UN',cantidadPedida:'2500',cantidadMillares:'2500'}]).find(c=>c.name==='millares:cantidadPedida').status,'failed');});
test('CLI offline creates only a sanitized ignored validation report and reports no live validation',async t=>{const cwd=await mkdtemp(resolve(tmpdir(),'central-validation-'));t.after(()=>rm(cwd,{recursive:true,force:true}));const result=spawnSync(process.execPath,[script,'--offline','--prepare'],{cwd,encoding:'utf8',env:{...process.env,DB_PASSWORD:'TEST_SECRET_NEVER_EXPOSE',ERP_WRITE_ENABLED:'true'}});assert.equal(result.status,0,result.stderr);const output=JSON.parse(result.stdout);assert.equal(output.realValidation,'not_performed');const files=await readdir(resolve(cwd,'data','validation'));assert.equal(files.length,1);const raw=await readFile(resolve(cwd,'data','validation',files[0]),'utf8');assert(!raw.includes('TEST_SECRET_NEVER_EXPOSE'));assert(!raw.includes('ZTEST'));assert.equal(JSON.parse(raw).readOnly,true);});
test('CLI invalid arguments and unauthorized live branch fail without contacting databases',async t=>{const cwd=await mkdtemp(resolve(tmpdir(),'central-validation-'));t.after(()=>rm(cwd,{recursive:true,force:true}));const args=spawnSync(process.execPath,[script,'--offline','--live'],{cwd,encoding:'utf8'});assert.equal(args.status,1);assert.equal(JSON.parse(args.stdout).code,'VALIDATION_ARGUMENTS');const live=spawnSync(process.execPath,[script,'--live'],{cwd,encoding:'utf8',env:{...process.env,VALIDATION_BRANCH:'9999',ERP_BRANCHES:'0101',DB_SERVER:'MUST_NOT_CONNECT'}});assert.equal(live.status,2,live.stderr);const output=JSON.parse(live.stdout),report=JSON.parse(await readFile(output.report,'utf8'));assert.equal(report.code,'VALIDATION_BRANCH_NOT_AUTHORIZED');assert.equal(report.realValidation,'not_completed');});
test('operational validation uses three real attention contracts plus one bounded SC7 exposure query',async()=>{const {erp}=offlineValidationAdapters(),calls=[],original=erp.list;erp.list=async(resource,params)=>{calls.push({resource,params:Object.fromEntries(params)});return original(resource,params);};const report=await runIntegrationValidation({mode:'offline',branch:'TEST',erp,clock:()=>new Date('2026-10-22T01:30:00Z')});assert.equal(report.todayLocal,'2026-10-21');assert.equal(report.operationalQueries.performed,4);assert.equal(report.operationalQueries.maxAdditionalReads,4);for(const resource of ['atencionVentas','atencionCompras','atencionRemitos']){const call=calls.find(c=>c.resource===resource);assert.deepEqual(Object.keys(call.params).sort(),['cursor','hoy','limit','sucursal']);assert.equal(call.params.hoy,'2026-10-21');assert.equal(call.params.cursor,'0');const result=report.results.find(r=>r.name===resource);assert(result.checks.some(c=>c.name==='document_snapshot_identity_and_pending'&&c.status==='passed'));assert(result.checks.some(c=>c.name==='millares_solo_UN'&&c.status==='passed'));}const exposure=report.results.find(r=>r.name==='pedidosCompraPendientes');assert(exposure.checks.some(c=>c.name==='exposicion_SC7_pendiente'&&c.status==='passed'));assert.equal(calls.filter(c=>['atencionVentas','atencionCompras','atencionRemitos','pedidosCompraPendientes'].includes(c.resource)).length,4);assert(!JSON.stringify(report).includes('ZTEST'));});
test('invalid overdue/saldo/identity evidence fails instead of marking the three circuits validated',async()=>{const {erp}=offlineValidationAdapters(),original=erp.list;erp.list=async(resource,params)=>{const result=await original(resource,params);if(resource==='atencionVentas')result.data[0].fecha='2026-10-22';if(resource==='atencionCompras')result.data[0].cantidad='0';if(resource==='atencionRemitos')result.data[0].sucursal='OTHER';return result;};const report=await runIntegrationValidation({mode:'offline',branch:'TEST',erp,clock:()=>new Date('2026-10-21T12:00:00Z')});assert.equal(report.checksStatus,'failed');for(const [resource,check] of [['atencionVentas','fecha_operativa'],['atencionCompras','saldo_pendiente_positivo'],['atencionRemitos','identidad_operativa']])assert.equal(report.results.find(r=>r.name===resource).checks.find(c=>c.name===check).status,'failed');assert.equal(report.erpWrites,0);});

test('millar validation respects original UM, metadata precision and stored legacy anomalies',()=>{
 const fields=[{salida:'cantidadMillares',diccionario:{X3_DECIMAL:4}}];
 const check=row=>validateSample('itemsDocumentosSalida',[row],{fields}).find(c=>c.name==='millares:cantidadDocumentada');
 assert.equal(check({unidadMedida:'KG',cantidadDocumentada:'100',cantidadMillares:'0'}).status,'observed');
 assert.equal(check({cantidadDocumentada:'100',cantidadMillares:'0'}).status,'pending');
 const rounded=check({producto:{unidadMedida:'UN'},cantidadDocumentada:'1234.56',cantidadMillares:'1.2346'});
 assert.equal(rounded.status,'passed');assert.equal(rounded.precisionMatches,1);
 const legacy=check({producto:{unidadMedida:'UN'},cantidadDocumentada:'1000',cantidadMillares:'0'});
 assert.equal(legacy.status,'failed');assert.equal(legacy.differences,1);
});

test('blank A1_TABELA is optional and fixture preserves the real customer alias',()=>{
 const checks=validateSample('clientes',[{codigo:'C',tienda:'01',listaPreciosCodigo:''}]);
 assert(!checks.some(c=>c.name==='field:listaPreciosCodigo'));
 assert.equal(checks.find(c=>c.name==='A1_TABELA_opcional').observedRows,0);
});

test('bounded overdue order journey uses exact existing identity and document contracts in six reads',async()=>{
 const {erp}=offlineValidationAdapters(),calls=[],original=erp.list;
 erp.list=async(resource,params)=>{calls.push({resource,params:Object.fromEntries(params)});return original(resource,params);};
 const report=await runIntegrationValidation({mode:'offline',branch:'TEST',erp});
 assert.equal(report.orderQueries.maxAdditionalReads,6);assert.equal(report.orderQueries.performed,6);
 for(const name of ['vencido_SC6_SC5_identidad_unica','vencido_SC5_SA1_identidad_unica','vencido_SC6_identidad_unica','vencido_SC6_SC9_identidad','vencido_documentosPedidoVenta_remitos','vencido_documentosPedidoVenta_facturas'])assert.equal(report.relationships.find(r=>r.name===name)?.status,'passed',name);
 const releases=calls.find(c=>c.resource==='liberacionesVentas');
 assert.deepEqual(releases.params,{sucursal:'TEST',page:'1',limit:'1',numero:'TEST',item:'01',producto:'ZTEST',cliente:'C',tienda:'01'});
 assert.deepEqual(calls.filter(c=>c.resource==='documentosPedidoVenta').map(c=>c.params),['remitos','facturas'].map(documentos=>({sucursal:'TEST',page:'1',limit:'1',pedido:'TEST',cliente:'C',tienda:'01',documentos})));
 assert(!JSON.stringify(report).includes('ZTEST'));
});

test('ambiguous SC5 prevents further journey reads and missing document pages remain pending',async()=>{
 const a=offlineValidationAdapters().erp,original=a.list;
 a.list=async(resource,params)=>{const result=await original(resource,params);if(resource==='ventas'&&params.get('numero'))result.meta.hasMore=true;return result;};
 const ambiguous=await runIntegrationValidation({mode:'offline',branch:'TEST',erp:a});
 assert.equal(ambiguous.orderQueries.performed,1);assert.equal(ambiguous.relationships.find(r=>r.name==='vencido_SC6_SC5_identidad_unica').status,'pending');
 const b=offlineValidationAdapters().erp,base=b.list;
 b.list=async(resource,params)=>resource==='documentosPedidoVenta'?{data:[],meta:{hasMore:true}}:base(resource,params);
 const missing=await runIntegrationValidation({mode:'offline',branch:'TEST',erp:b});
 for(const group of ['remitos','facturas']){const result=missing.relationships.find(r=>r.name==='vencido_documentosPedidoVenta_'+group);assert.equal(result.status,'pending');assert.equal(result.hasMore,true);}
});

test('cross-customer or branch evidence fails before reading related commercial documents',async()=>{
 const {erp}=offlineValidationAdapters(),base=erp.list;
 erp.list=async(resource,params)=>{const result=await base(resource,params);if(resource==='itemsVentas'&&params.get('numero'))result.data[0].clienteTienda='OTHER';return result;};
 const report=await runIntegrationValidation({mode:'offline',branch:'TEST',erp});
 assert.equal(report.checksStatus,'failed');assert.equal(report.orderQueries.performed,3);
 assert.equal(report.relationships.find(r=>r.name==='vencido_SC6_identidad_unica').status,'failed');
 assert(!report.relationships.some(r=>r.name==='vencido_documentosPedidoVenta_remitos'));
});

test('shared SA1 physical branch follows explicit adapter metadata and retains exact customer/store',async()=>{
 const {erp}=offlineValidationAdapters(),base=erp.list,metadata=erp.metadata;
 erp.metadata=()=>{const result=metadata();result.entities.clientes.sucursalesConfiguradas={TEST:''};return result;};
 erp.list=async(resource,params)=>{const result=await base(resource,params);if(resource==='clientes')result.data[0].sucursal='';return result;};
 const report=await runIntegrationValidation({mode:'offline',branch:'TEST',erp});
 assert.equal(report.relationships.find(r=>r.name==='vencido_SC5_SA1_identidad_unica').status,'passed');
});
