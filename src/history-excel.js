import ExcelJS from 'exceljs';
import {assert} from './errors.js';
export async function historyExcel({dashboards,principal,id,filters}){
 const report=dashboards.history(principal,id,{filters});assert(report.total<=20000,413,'HISTORIAL_EXTENSO','Acotá los filtros: Excel admite hasta 20.000 eventos por descarga.');
 const events=[...report.data];for(let page=2;events.length<report.total;page++)events.push(...dashboards.history(principal,id,{page,filters}).data);
 const workbook=new ExcelJS.Workbook();workbook.creator='Central ETAR';const sheet=workbook.addWorksheet('Historial');
 sheet.columns=[{width:24},{width:32},{width:25},{width:15},{width:40},{width:24},{width:30}];
 sheet.addRow(['Historial de '+report.name]);sheet.mergeCells('A1:G1');sheet.getRow(1).font={bold:true,size:16,color:{argb:'FF17324D'}};
 sheet.addRow(['Generado (Argentina)',new Date().toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'})]);sheet.addRow(['Filtros',JSON.stringify(report.filters)]);sheet.addRow(['Alcance',report.total+' eventos · todas las páginas del filtro']);sheet.addRow(['Usuario: autor o destinatario. Rol: destinatario, sin inferir pertenencias históricas.']);sheet.mergeCells('A5:G5');sheet.addRow([]);
 sheet.addRow(['Fecha Argentina','Autor','Acción','Tipo','Destinatario','ID del evento','Detalle']);
 const date=ts=>new Date(ts).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'});
 for(const e of events){const rows=e.legacy?[[date(e.at),e.who.name,'Auditoría incompleta','','',e.key,'Destinatarios y resultado no verificables']]:[...e.added.map(t=>[date(e.at),e.who.name,'Compartió',t.kind==='user'?'Usuario':'Rol',t.name,e.key,'Cambio confirmado']),...e.removed.map(t=>[date(e.at),e.who.name,'Quitó acceso',t.kind==='user'?'Usuario':'Rol',t.name,e.key,'Cambio confirmado'])];if(!rows.length)rows.push([date(e.at),e.who.name,'Sin cambios','','',e.key,'Sin altas ni bajas de asignaciones']);assert(sheet.rowCount+rows.length<=100000,413,'HISTORIAL_EXTENSO','Acotá los filtros: demasiados cambios para un único Excel.');for(const row of rows)sheet.addRow(row.map(v=>String(v??'')));}
 sheet.getRow(7).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(7).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17324D'}};sheet.autoFilter={from:'A7',to:'G'+Math.max(7,sheet.rowCount)};sheet.views=[{state:'frozen',ySplit:7}];sheet.eachRow((row,n)=>{if(n>=7){row.alignment={vertical:'top',wrapText:true};if(n>7&&n%2===0)row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF0F5FA'}};}});sheet.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'7:7'};
 const notes=workbook.addWorksheet('Alcance');notes.getColumn(1).width=120;notes.addRow(['Alcance y límites']);notes.getRow(1).font={bold:true,size:14};for(const note of report.limitations)notes.addRow([note]);notes.addRow(['Se exportan eventos completos que cumplen los filtros; un evento puede incluir otros destinatarios en la misma operación.']);notes.eachRow(row=>{row.alignment={wrapText:true,vertical:'top'};row.height=42;});
 return workbook.xlsx.writeBuffer();
}
