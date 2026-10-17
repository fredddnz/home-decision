// Conservative page inspection. Empty extracted text alone never means blank.
const LIMIT=200000,IMAGE_FRACTION=.15,MIN_BODY=80;
const count=text=>(text.match(/[\p{L}\p{N}]/gu)??[]).length;
const identity=[1,0,0,1,0,0];
function multiply(a,b){return[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
function unionArea(rectangles){
 const xs=[...new Set(rectangles.flatMap(r=>[r[0],r[2]]))].sort((a,b)=>a-b);let area=0;
 for(let i=1;i<xs.length;i++){
  const left=xs[i-1],right=xs[i],ys=rectangles.filter(r=>r[0]<right&&r[2]>left).map(r=>[r[1],r[3]]).sort((a,b)=>a[0]-b[0]);let bottom=0,top=0,height=0;
  for(const y of ys){if(y[0]>top){height+=top-bottom;[bottom,top]=y;}else top=Math.max(top,y[1]);}
  area+=(right-left)*(height+top-bottom);
 }return area;
}
function white(args){const a=Array.from(args??[]);return typeof a[0]==='string'?['#ffffff','#fff','white'].includes(a[0].toLowerCase()):a.length>0&&(a.every(n=>n===1)||a.every(n=>n===255));}
function graphics(list,ops,viewport){
 if(list.fnArray.length>LIMIT)throw Error('This PDF page is too complex to read safely. Use a readable extract; no file has been uploaded.');
 const names=new Map(Object.entries(ops).map(([name,id])=>[id,name])),stack=[];
 const area=viewport.width*viewport.height,regions=[];
 let state={matrix:identity,fillWhite:false,strokeWhite:false},paint=false,hasImages=false,maxImageFraction=0,unknownImage=false,unknownContent=false;
 const painted=name=>{
  if(['fill','eoFill','rawFillPath'].includes(name)){if(!state.fillWhite)paint=true;}
  else if(['stroke','closeStroke'].includes(name)){if(!state.strokeWhite)paint=true;}
  else if(/FillStroke$|fillStroke$/.test(name)){if(!state.fillWhite||!state.strokeWhite)paint=true;}
  else if(name!=='endPath')paint=true;
 };
 for(let i=0;i<list.fnArray.length;i++){
  const name=names.get(list.fnArray[i]),args=list.argsArray[i]??[];
  if(name==null)unknownContent=true;
  if(name==='save'||name==='paintFormXObjectBegin'){stack.push({...state,matrix:[...state.matrix]});if(name==='paintFormXObjectBegin'&&args[0])state.matrix=multiply(state.matrix,args[0]);}
  else if(name==='restore'||name==='paintFormXObjectEnd'){state=stack.pop()??{matrix:identity,fillWhite:false,strokeWhite:false};}
  else if(name==='transform')state.matrix=multiply(state.matrix,args);
  else if(['setFillRGBColor','setFillGray'].includes(name))state.fillWhite=white(args);
  else if(['setStrokeRGBColor','setStrokeGray'].includes(name))state.strokeWhite=white(args);
  else if(/^setFillColor/.test(name))state.fillWhite=false;
  else if(/^setStrokeColor/.test(name))state.strokeWhite=false;
  else if(/^paint(?:Image|InlineImage|SolidColorImage)/.test(name??'')){
   hasImages=true;paint=true;
   if(/Group|Repeat|SolidColor/.test(name))unknownImage=true;
   else{
    // All areas share viewport units, including rotation and PDF /UserUnit.
    // Page-clipped bounding boxes conservatively cover transformed image pixels.
    const m=multiply(viewport.transform??identity,state.matrix),points=[[0,0],[1,0],[0,1],[1,1]].map(([x,y])=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]);
    if(points.flat().some(n=>!Number.isFinite(n)))unknownImage=true;
    else{
     const r=[Math.max(0,Math.min(...points.map(p=>p[0]))),Math.max(0,Math.min(...points.map(p=>p[1]))),Math.min(viewport.width,Math.max(...points.map(p=>p[0]))),Math.min(viewport.height,Math.max(...points.map(p=>p[1])))];
     if(r[2]>r[0]&&r[3]>r[1]){maxImageFraction=Math.max(maxImageFraction,(r[2]-r[0])*(r[3]-r[1])/area);if(regions.length<512)regions.push(r);else unknownImage=true;}
    }
   }
  }else if(name==='constructPath')painted(names.get(args[0]));
  else if(['fill','eoFill','stroke','closeStroke','fillStroke','eoFillStroke','closeFillStroke','closeEOFillStroke','rawFillPath'].includes(name))painted(name);
  else if(['showText','showSpacedText','nextLineShowText','nextLineSetSpacingShowText','shadingFill','setGState','paintXObject','beginAnnotation','beginGroup'].includes(name)||name==null)paint=true;
 }
 return{paint,hasImages,maxImageFraction,imageCoverage:Math.min(1,unionArea(regions)/area),unknownImage,unknownContent};
}
export async function inspectPDFPages(pdf,{ops}={}){
 if(!ops||!Number.isInteger(pdf?.numPages)||pdf.numPages<1||pdf.numPages>100)throw Error('Use a PDF of 1–100 pages.');
 const pages=[];
 for(let number=1;number<=pdf.numPages;number++){
  const page=await pdf.getPage(number);
  try{
   const content=await page.getTextContent(),viewport=page.getViewport({scale:1}),list=await page.getOperatorList(),annotations=await page.getAnnotations({intent:'display'});
   const text=content.items.map(item=>`${item.str??''}${item.hasEOL?'\n':' '}`).join('').trim(),area=viewport.width*viewport.height;
   if(!Number.isFinite(area)||area<=0)throw Error('This PDF page has invalid dimensions. No file has been uploaded.');
   const visual=graphics(list,ops,viewport),transform=viewport.transform??identity;
   const bodyCharacters=content.items.reduce((n,item)=>{const m=item.transform;if(!m)return n;const y=transform[1]*m[4]+transform[3]*m[5]+transform[5];return y>=.15*viewport.height&&y<=.85*viewport.height?n+count(item.str??''):n;},0);
   let status='needs_ocr';
   if(!text&&!visual.paint&&!annotations.length)status='blank';
   else if(!visual.unknownContent&&count(text)>=5&&!(visual.hasImages&&(visual.unknownImage||visual.imageCoverage>=IMAGE_FRACTION)&&bodyCharacters<MIN_BODY))status='text';
   pages.push({number,text,status,hasImages:visual.hasImages,maxImageFraction:visual.maxImageFraction,imageCoverage:visual.imageCoverage,bodyCharacters});
  }finally{page.cleanup?.();}
 }
 return pages;
}
