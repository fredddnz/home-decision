/** Original-file OCR is local-only. Unknown configuration defaults to denial. */
export function createScannedPDFSubmitter({apiOrigin,fetchImpl}={}){
 return async function submit(file,projectId,plan={}){
  if(apiOrigin!==''){
   const pages=(plan.unreadablePages??[]).filter(n=>Number.isInteger(n)&&n>0&&n<=100);
   throw Object.assign(new Error(`This PDF needs OCR or manual review${pages.length?` for page${pages.length===1?'':'s'} ${pages.join(', ')}`:''}. Scanned PDF OCR is unavailable online. The original PDF was not uploaded and no evidence was added. Upload a readable PDF or a UTF-8 text extract.`),{code:'online_ocr_unavailable'});
  }
  const response=await fetchImpl(`/api/projects/${projectId}/documents`,{method:'POST',headers:{'Content-Type':'application/pdf','X-Document-Name':encodeURIComponent(file.name)},body:file});
  const result=await response.json();if(!response.ok)throw Error(result.error??'The local PDF could not be read.');return result;
 };
}
