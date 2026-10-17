// OCR is a separate input route. Never silently omit an unreadable findings page.
export function pdfText(pages){
  const unreadable=pages.flatMap((text,i)=>(text.match(/\p{L}/gu)??[]).length<5?[i+1]:[]);
  if(unreadable.length)throw new Error(`This PDF needs OCR for page${unreadable.length===1?'':'s'} ${unreadable.join(', ')}. No report has been added. Upload a text-based report or a readable extract of the relevant findings pages.`);
  const text=pages.map((text,i)=>`[Page ${i+1}]\n${text}`).join('\n\n');
  if([...text].length>20000)throw new Error('Please use a relevant extract of up to 20,000 characters.');
  return text;
}
export function pdfReadingPlan(pages){
  const unreadablePages=pages.flatMap((text,i)=>(text.match(/\p{L}/gu)??[]).length<5?[i+1]:[]);
  if(unreadablePages.length)return {method:'ocr_fallback',unreadablePages};
  const text=pages.map((text,i)=>`[Page ${i+1}]\n${text}`).join('\n\n');
  if([...text].length>120000)throw new Error('Please use a relevant extract of up to 120,000 characters.');
  return {method:'pdf_text',text};
}
