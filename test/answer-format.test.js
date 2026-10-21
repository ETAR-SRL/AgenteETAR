import test from 'node:test';
import assert from 'node:assert/strict';
import {formatAnswer} from '../public/import-batch-ui.js';
const doc={createElement:tag=>({tag,children:[],append(...children){this.children.push(...children);}}),createTextNode:text=>({text})};
test('answers render escaped and ordinary bold, lists and code without interpreting HTML',()=>{
 const result=formatAnswer('**Ventas**\n\n- \\*\\*Total\\*\\*: `125`\n- <img src=x onerror=alert(1)>',doc);
 assert.equal(result.children[0].children[1].tag,'strong');
 const list=result.children[1];assert.equal(list.tag,'ul');
 assert.equal(list.children[0].children[1].tag,'strong');
 assert.equal(list.children[0].children[3].tag,'code');
 assert.equal(list.children[1].children.at(-1).text,'<img src=x onerror=alert(1)>');
});
test('unclosed emphasis and user content stay literal',()=>{
 const result=formatAnswer('**sin cerrar\n\ntexto <script>mal()</script>',doc);
 assert.equal(result.children[0].children.at(-1).text,'**sin cerrar');
 assert.equal(result.children[1].children.at(-1).text,'texto <script>mal()</script>');
});
