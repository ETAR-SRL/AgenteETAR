// Render only supported Markdown as DOM nodes; model output is never HTML.
export function formatAnswer(text, documentRef=document) {
  const root=documentRef.createElement('div');root.className='answer-text';
  const normalized=String(text??'').replace(/\\([*`])/g,'$1');
  function inline(parent,value){
    const pattern=/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;let start=0;
    for(const match of value.matchAll(pattern)){
      parent.append(documentRef.createTextNode(value.slice(start,match.index)));
      const code=match[0].startsWith('`'),element=documentRef.createElement(code?'code':'strong');
      element.textContent=match[0].slice(code?1:2,code?-1:-2);parent.append(element);start=match.index+match[0].length;
    }
    parent.append(documentRef.createTextNode(value.slice(start)));
  }
  let paragraph=null,list=null;
  for(const line of normalized.split(/\r?\n/)){
    if(!line.trim()){paragraph=null;list=null;continue;}
    const item=line.match(/^\s*[-•]\s+(.+)$/);
    if(item){paragraph=null;if(!list){list=documentRef.createElement('ul');root.append(list);}const li=documentRef.createElement('li');inline(li,item[1]);list.append(li);continue;}
    list=null;if(!paragraph){paragraph=documentRef.createElement('p');root.append(paragraph);}else paragraph.append(documentRef.createElement('br'));
    inline(paragraph,line);
  }
  return root;
}
