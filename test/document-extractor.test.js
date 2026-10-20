import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createDocumentReader} from '../src/intelligence/document-reader.js';
const reader=createDocumentReader();
test('installed local engine reads generated Excel, photograph and scanned PDF without remote services',{skip:!reader.status().available,timeout:120000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'central-extraction-'));
 try{
  await promisify(execFile)(resolve('.venv-documents/Scripts/python.exe'),['-c',`
import sys,openpyxl
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
p=Path(sys.argv[1]);w=openpyxl.Workbook();s=w.active
rows=[['Codigo','Precio','Moneda','Unidad'],['EXT-1',60,'USD','millar']]
for r in rows:s.append(r)
w.save(p/'list.xlsx')
im=Image.new('RGB',(1400,400),'white');d=ImageDraw.Draw(im);font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',32)
for i,r in enumerate(rows):
 for x,v in zip([50,450,750,1050],r):d.text((x,70+i*100),str(v),font=font,fill='black')
im.save(p/'list.png');im.save(p/'list.pdf','PDF',resolution=150)
rows=[['Producto','Cantidad','Unidad'],['ZTEST1',2.5,'millares']]
w=openpyxl.Workbook();s=w.active
for r in rows:s.append(r)
w.save(p/'quantity.xlsx')
im=Image.new('RGB',(1400,400),'white');d=ImageDraw.Draw(im)
for i,r in enumerate(rows):
 for x,v in zip([50,500,950],r):d.text((x,70+i*100),str(v),font=font,fill='black')
im.save(p/'quantity.png');im.save(p/'quantity.pdf','PDF',resolution=150)
`,dir],{windowsHide:true});
  for(const file of ['list.xlsx','list.png','list.pdf']){
   const req=createReadStream(join(dir,file));req.headers={'x-file-name':file};
   const result=await reader.extract(req);assert.equal(result.rows.length,1,file);
   assert.equal(result.rows[0].product,'EXT-1',file);assert.equal(result.rows[0].price,'60',file);assert.equal(result.rows[0].currency,'USD',file);assert.equal(result.rows[0].unit,'millar',file);
  }
  for(const file of ['quantity.xlsx','quantity.png','quantity.pdf']){
   const req=createReadStream(join(dir,file));req.headers={'x-file-name':file};
   const result=await reader.extract(req);assert.equal(result.rows.length,1,file);
   assert.equal(result.rows[0].product,'ZTEST1',file);assert.equal(result.rows[0].quantity,'2.5',file);
   assert.equal(result.rows[0].quantityUnit,'millares',file);assert.equal(result.rows[0].price,'',file);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
