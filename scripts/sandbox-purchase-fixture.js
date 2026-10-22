// Synthetic catalogs derived from adapter unit fixtures; never reads ERP configuration.
import assert from 'node:assert/strict';
import {createWriter} from '../src/protheus/writer.js';
export function sandboxFixture(alias='SC1',options={}){
 const p=alias==='SC1'?'C1':'C7',action=alias==='SC1'?'crearSolicitudCompra':'crearPedidoCompra',dictionary=new Map(),tables=new Map();
 const chars={FILIAL:4,NUM:6,ITEM:4,PRODUTO:15,DESCRI:50,UM:2,LOCAL:2,EMISSAO:8,DATPRF:8,FILENT:4,CC:9,OBS:120,SEGUM:2,...(alias==='SC1'?{SOLICIT:25,APROV:1,IMPORT:1,COTACAO:6,CLASS:1}:{FORNECE:6,LOJA:2,COND:3,CONTATO:20,CONAPRO:1,COMPRA:3,APROV:6})};
 const numbers={QUANT:[12,2],TOTAL:[14,2],QUJE:[12,2],MOEDA:[2,0],TIPO:[1,0],QTSEGUM:[12,2],...(alias==='SC1'?{VUNIT:[12,2],PRECO:[14,4],QTDORIG:[12,2]}:{PRECO:[14,4],TXMOEDA:[11,4]})};
 const columns=[{field:'R_E_C_N_O_',type:'bigint',identityColumn:false,definition:'((0))'},{field:'D_E_L_E_T_',type:'varchar',definition:"(' ')"},{field:'R_E_C_D_E_L_',type:'bigint',definition:'((0))'}];
 for(const [suffix,width] of Object.entries(chars)){const field=p+'_'+suffix;dictionary.set(field,{X3_ARQUIVO:alias,X3_CAMPO:field,X3_TIPO:['EMISSAO','DATPRF'].includes(suffix)?'D':'C',X3_TAMANHO:String(width),X3_DECIMAL:'0',X3_OBRIGAT:''});columns.push({field,type:'varchar',width,definition:"(' ')"});}
 for(const [suffix,[width,scale]] of Object.entries(numbers)){const field=p+'_'+suffix;dictionary.set(field,{X3_ARQUIVO:alias,X3_CAMPO:field,X3_TIPO:'N',X3_TAMANHO:String(width),X3_DECIMAL:String(scale),X3_OBRIGAT:''});columns.push({field,type:'float',definition:'((0))'});}
 columns.push({field:p+'_RESIDUO',type:'varchar',definition:"(' ')"},{field:'S_T_A_M_P_',type:'datetime',definition:'(getutcdate())'});
 tables.set(alias,{schema:'dbo',name:alias+'010',columns:new Map(columns.map(c=>[c.field,{type:c.type,identity:c.identityColumn||false}]))});tables.set('SX3',{schema:'dbo',name:'SX3010',columns:new Map()});
 for(const [a,fields] of Object.entries({SX6:['X6_FIL','X6_VAR','X6_TIPO','X6_CONTEUD','D_E_L_E_T_'],SY1:['Y1_FILIAL','Y1_COD','Y1_GRAPROV','Y1_PEDIDO','D_E_L_E_T_','R_E_C_N_O_']}))tables.set(a,{schema:'dbo',name:a+'010',columns:new Map(fields.map(k=>[k,{type:'varchar'}]))});
 const refs={SX5:{R_E_C_N_O_:'1',D_E_L_E_T_:' ',X5_FILIAL:'',X5_TABELA:'Y1',X5_CHAVE:'1'},SB1:{R_E_C_N_O_:'1',D_E_L_E_T_:' ',B1_FILIAL:'0101',B1_COD:'ZTEST',B1_DESC:'Prueba',B1_UM:'UN',B1_SEGUM:'MI',B1_CONV:'1000',B1_TIPCONV:'D',B1_CC:'',B1_GRADE:'N',B1_MSBLQL:'2',B1_GRUPO:'0001',B1_SOLICIT:'N',B1_IMPORT:'S'},SA2:{R_E_C_N_O_:'1',D_E_L_E_T_:' ',A2_FILIAL:'01',A2_COD:'000001',A2_LOJA:'01',A2_MSBLQL:'2'},NNR:{R_E_C_N_O_:'1',D_E_L_E_T_:' ',NNR_FILIAL:'0101',NNR_CODIGO:'01'},SE4:{R_E_C_N_O_:'1',D_E_L_E_T_:' ',E4_FILIAL:'0101',E4_CODIGO:'001'},CTT:{R_E_C_N_O_:'1',D_E_L_E_T_:' ',CTT_FILIAL:'0101',CTT_CUSTO:'001'}};
 for(const [a,row] of Object.entries(refs))tables.set(a,{schema:'dbo',name:a+'010',columns:new Map(Object.keys(row).map(k=>[k,{type:'varchar'}]))});
 const catalog={tables,dictionary,table:a=>{assert.ok(tables.has(a),a);return tables.get(a);},branch:(a,b)=>{assert.equal(b,'0101');return ['SM2','SX5'].includes(a)?'':['SA2','SY1'].includes(a)?'01':b;}};
 const parameters=Object.entries({MV_APROVSC:['L','.F.'],MV_APRSCEC:['L','F'],MV_RESTSOL:['C','N'],MV_APRPCEC:['L','F'],MV_PCAPROV:['C',''],MV_ALTPDOC:['L','T']}).map(([X6_VAR,[X6_TIPO,X6_CONTEUD]])=>({X6_FIL:' ',X6_VAR,X6_TIPO,X6_CONTEUD}));
 tables.set('SM2',{schema:'dbo',name:'SM2010',columns:new Map(['M2_DATA','M2_MOEDA2','D_E_L_E_T_','R_E_C_N_O_'].map(f=>[f,{}]))});
 const currencyParameters=[{X6_FIL:' ',X6_VAR:'MV_MOEDA1',X6_TIPO:'C',X6_CONTEUD:'PESO'},{X6_FIL:' ',X6_VAR:'MV_MOEDA2',X6_TIPO:'C',X6_CONTEUD:'DOLAR'}];
 tables.set('SX7',{schema:'dbo',name:'SX7010',columns:new Map(['X7_CAMPO','X7_REGRA','X7_CDOMIN','X7_CONDIC','D_E_L_E_T_'].map(f=>[f,{}]))});
 const state={importParameters:[{X6_FIL:' ',X6_VAR:'MV_COMPINT',X6_TIPO:'L',X6_CONTEUD:'T'},{X6_FIL:' ',X6_VAR:'MV_EASY',X6_TIPO:'C',X6_CONTEUD:'N'},{X6_FIL:' ',X6_VAR:'MV_APROVSI',X6_TIPO:'L',X6_CONTEUD:'F'}],rules:[{X7_CAMPO:'C1_PRECO',X7_CDOMIN:'C1_TOTAL',X7_CONDIC:'',X7_REGRA:'M->C1_TOTAL := NoRound(M->C1_PRECO*M->C1_QUANT,TamSX3("C1_TOTAL")[2])'}],currencyParameters,rates:[{registro:'1',fecha:'20261019',tasa:'1518'}],parameters,catalogs:{SAL:[],SAK:[],DHL:[],DHM:[],DBL:[],SAI:[]},circuits:{SCR:[],DBM:[]},buyers:[],rows:[{R_E_C_N_O_:'9007199254740993',D_E_L_E_T_:'*',[p+'_NUM']:'000099',[p+'_FILIAL']:'9999'}],calls:[],inserts:0,commits:0,rollbacks:0};let queue=Promise.resolve();
 const circuitColumns={};
 for(const [a,chars,nums] of [
  ['SCR',{CR_FILIAL:4,CR_NUM:50,CR_TIPO:2,CR_USER:6,CR_APROV:6,CR_GRUPO:6,CR_ITGRP:2,CR_NIVEL:2,CR_STATUS:2,CR_EMISSAO:8,CR_USERLIB:6,CR_LIBAPRO:6,CR_DATALIB:8,CR_USERORI:6,CR_APRORI:6,CR_TPTRAN:1},{CR_TOTAL:[14,2],CR_MOEDA:[2,0],CR_TXMOEDA:[11,2],CR_VALLIB:[14,2]}],
  ['DBM',{DBM_FILIAL:4,DBM_NUM:50,DBM_TIPO:2,DBM_ITEM:4,DBM_ITEMRA:2,DBM_GRUPO:6,DBM_ITGRP:2,DBM_USER:6,DBM_APROV:1,DBM_USAPRO:6,DBM_USEROR:6},{DBM_VALOR:[14,2]}]
 ]){
  const cols=structuredClone(columns.slice(0,3));
  for(const [field,width] of Object.entries(chars)){dictionary.set(field,{X3_ARQUIVO:a,X3_CAMPO:field,X3_TIPO:'C',X3_TAMANHO:String(width),X3_DECIMAL:'0',X3_OBRIGAT:''});cols.push({field,type:'varchar',definition:"(' ')"});}
  for(const [field,[width,scale]] of Object.entries(nums)){dictionary.set(field,{X3_ARQUIVO:a,X3_CAMPO:field,X3_TIPO:'N',X3_TAMANHO:String(width),X3_DECIMAL:String(scale),X3_OBRIGAT:''});cols.push({field,type:'float',definition:'((0))'});}
  circuitColumns[a]=cols;tables.set(a,{schema:'dbo',name:a+'010',columns:new Map(cols.map(c=>[c.field,{type:c.type,identity:false}]))});
 }
 const referenceFields={SAL:'AL_COD AL_ITEM AL_APROV AL_PERFIL AL_USER AL_NIVEL AL_APROSUP AL_USERSUP AL_LIBAPR AL_AUTOLIM AL_TPLIBER AL_DOCPC AL_DOCIP AL_DOCSC',SAK:'AK_COD AK_USER AK_MOEDA AK_LIMITE AK_TIPO AK_APROSUP',DHL:'DHL_COD DHL_LIMMIN DHL_LIMMAX DHL_MOEDA',DBL:'DBL_GRUPO DBL_ITEM DBL_CC DBL_CONTA DBL_ITEMCT DBL_CLVL',DHM:'DHM_GRUPO DHM_APROV DHM_TIPCOM',SAI:'AI_USER AI_GRUSER AI_ITEM AI_GRUPO AI_PRODUTO AI_DOMINIO AI_QUANT'};
 for(const [a,fields] of Object.entries(referenceFields))tables.set(a,{schema:'dbo',name:a+'010',columns:new Map((fields+' '+({SAL:'AL',SAK:'AK',SAI:'AI'}[a]||a)+'_FILIAL D_E_L_E_T_ R_E_C_N_O_').split(' ').map(f=>[f,{type:'varchar'}]))});
 const db=options.sqlDb;
 const writes=createWriter({db,catalog,getWriteDb:async()=>db,enabled:true}),erp={writes,metadata:()=>({entities:{productos:{},depositos:{},proveedores:{},condicionesPago:{}}})};
 const input={action,target:{sucursal:'0101'},header:{fechaEmision:'2026-10-19',moneda:'1',...(alias==='SC1'?{solicitante:'Operador'}:{proveedor:'000001',tienda:'01',condicionPago:'001'})},items:[{producto:'ZTEST',deposito:'01',fechaNecesidad:'2026-10-20',cantidad:'2.5',precio:'80',baseCantidad:'millares',basePrecio:'millar'}]};
 const proposal=async()=>({action,input,target:input.target,writePlan:await writes.prepare(action,input)});
 return {action,p,columns,circuitColumns,dictionary,refs,state,catalog,db,writes,erp,input,proposal};
}
