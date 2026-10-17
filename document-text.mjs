// OCR is a separate input route. Never silently omit an unreadable findings page.
export function pdfText(pages){
  const unreadable=pages.flatMap((text,i)=>(text.match(/\p{L}/gu)??[]).length<5?[i+1]:[]);
  if(unreadable.length)throw new Error(`This PDF needs OCR for page${unreadable.length===1?'':'s'} ${unreadable.join(', ')}. No report has been added. Upload a text-based report or a readable extract of the relevant findings pages.`);
  const text=pages.map((text,i)=>`[Page ${i+1}]\n${text}`).join('\n\n');
  if([...text].length>20000)throw new Error('Please use a relevant extract of up to 20,000 characters.');
  return text;
}
export function pdfReadingPlan(pages){
  const inspected=pages.map((page,i)=>typeof page==='string'?{number:i+1,text:page,status:(page.match(/\p{L}/gu)??[]).length<5?'needs_ocr':'text'}:page);
  if(!inspected.length||inspected.length>100||inspected.some((p,i)=>p.number!==i+1||typeof p.text!=='string'||!['text','blank','needs_ocr'].includes(p.status)))throw Error('The PDF page inspection is incomplete. No document has been added.');
  const unreadablePages=inspected.filter(p=>p.status==='needs_ocr').map(p=>p.number),blankPages=inspected.filter(p=>p.status==='blank').map(p=>p.number);
  if(unreadablePages.length)return {method:'ocr_fallback',unreadablePages,blankPages,pages:inspected.map(({number,status})=>({number,status}))};
  if(inspected.every(p=>p.status==='blank'))throw Error('This PDF contains only blank pages and no readable evidence. No document has been added.');
  const text=inspected.map(p=>`[Page ${p.number}]\n${p.status==='blank'?'[Blank page: no visible content detected.]':p.text}${p.hasImages&&p.status==='text'?'\n[Extraction limitation: embedded images were not interpreted. Check the original page for image-only information.]':''}`).join('\n\n');
  if([...text].length>120000)throw new Error('Please use a relevant extract of up to 120,000 characters.');
  return {method:'pdf_text',text,blankPages,pages:inspected.map(({number,status})=>({number,status}))};
}
