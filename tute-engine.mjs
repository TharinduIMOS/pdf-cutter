// Number-based tute segmentation. Operates on the PDF text layer, so Sinhala
// fonts and diagrams are rendered without retyping or OCR substitutions.
export function analyseTutePage(items,viewport,{footer=.07,image=null}={}) {
 const height=viewport.height,width=viewport.width;
 const text=items.filter(i=>i.str?.trim()).map(i=>{
  const [x,baseline]=viewport.convertToViewportPoint(i.transform[4],i.transform[5]);
  const h=Math.hypot(i.transform[2],i.transform[3])*viewport.scale;
  return {str:i.str.trim(),x:x/width,y:baseline/height,h:h/height,width:i.width*viewport.scale/width};
 });
 const header=text.filter(i=>i.y<.22).sort((a,b)=>Math.abs(a.y-b.y)<.01?a.x-b.x:a.y-b.y).map(i=>i.str).join(' ');
 const unit=detectUnit(text);
 const anchors=[];
 for(const t of text){
  const match=t.str.match(/^(\d{1,3})[.)](?:\s|$)/);
  if(!match||t.y<.025||t.y>=1-footer||!((t.x>.025&&t.x<.15)||(t.x>.45&&t.x<.65)))continue;
  const number=Number(match[1]);if(number===0)continue;
  if(anchors.some(a=>a.number===number&&Math.abs(a.x-t.x)<.005&&Math.abs(a.y-t.y)<.005))continue;
  anchors.push({...t,number,top:Math.max(.03,t.y-t.h-.25*viewport.scale/height)});
 }
 anchors.sort((a,b)=>Math.abs(a.y-b.y)<.012?a.x-b.x:a.y-b.y);
 const rows=[];
 for(const a of anchors){const row=rows.at(-1);if(row&&Math.abs(row.y-a.y)<.012)row.anchors.push(a);else rows.push({y:a.y,top:a.top,anchors:[a]});}
 const regions=[];
 for(let r=0;r<rows.length;r++){
  const row=rows[r],bottom=rows[r+1]?.top??1-footer;
  for(let i=0;i<row.anchors.length;i++){
   const a=row.anchors[i],next=row.anchors[i+1];
   const x=i?Math.max(.03,a.x-.01):Math.max(.03,a.x-.012);
   const right=next?next.x-.01:.954;
   if(bottom-row.top>.005)regions.push({number:a.number,x,y:row.top,right,bottom,column:row.anchors.length>1});
  }
 }
 const markers=image?layoutMarkers(text,image,anchors,footer):[];return {unit,anchors,regions,markers,firstTop:rows[0]?.top??null,textCount:text.length};
}
function hasInk(image,region){
 const {data,width,height}=image;const x0=Math.floor(region.x*width),x1=Math.ceil(region.right*width),y0=Math.floor(region.y*height),y1=Math.ceil(region.bottom*height);let count=0;
 for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){let i=(y*width+x)*4;if(data[i]+data[i+1]+data[i+2]<570&&++count>35)return true;}
 return false;
}
export function detectUnit(text){
 // Read short visual lines rather than flattening the whole header into a
 // sentence. This also handles split PDF text runs such as Unit / No / : / 20.
 const rows=[];for(const t of text.filter(t=>t.y<.30).sort((a,b)=>a.y-b.y||a.x-b.x)){let r=rows.find(r=>Math.abs(r.y-t.y)<.009);if(!r)rows.push(r={y:t.y,items:[]});r.items.push(t);}
 const matches=[];
 for(const r of rows){const line=r.items.sort((a,b)=>a.x-b.x).map(t=>t.str).join(' ').normalize('NFKC');const m=line.match(/(?:\bunit\s*(?:no\.?|number)?|\blesson|\bchapter|ඒකක(?:ය)?|පාඩම)\s*[:.#\-–]?\s*(\d{1,3})(?!\d)/i);if(m)matches.push(m[1]);}
 return new Set(matches).size===1?matches[0]:null;
}
function layoutMarkers(text,image,anchors,footer){
 const {width:w,height:h,data}=image,x0=Math.floor(w*.06),x1=Math.floor(w*.945),rows=[];
 for(let y=Math.floor(h*.03);y<h*(1-footer);y++){let dark=0;for(let x=x0;x<x1;x++){const i=(y*w+x)*4;if(data[i]+data[i+1]+data[i+2]<420)dark++;}rows[y]=dark/(x1-x0);}
 function bands(threshold){const out=[];for(let y=0;y<rows.length;y++)if(rows[y]>threshold){let b=out.at(-1);if(b&&y-b.end<=2)b.end=y;else out.push({start:y,end:y});}return out;}
 const markers=[];
 for(const b of bands(.72))if(b.end-b.start>=h*.006&&b.start/h>.2)markers.push({y:Math.max(.03,b.start/h-.002),bottom:b.end/h+.002,kind:'topic',reason:'Heading band'});
 // An isolated, single-line boxed definition is not a multi-row question table.
 const lines=bands(.40).filter(b=>b.end-b.start<h*.006);
 for(let i=0;i<lines.length-1;i++){
  const a=lines[i],b=lines[i+1],gap=(b.start-a.end)/h;
  if(gap<.014||gap>.038||a.start/h<.20)continue;
  if((lines[i-1]&&(a.start-lines[i-1].end)/h<gap*1.5)||(lines[i+2]&&(lines[i+2].start-b.end)/h<gap*1.5))continue;
  const inside=text.filter(t=>t.y>a.end/h&&t.y<b.start/h);
  if(inside.length<1||inside.some(t=>/^(?:\d+[.)]|[ivx]+[)])/.test(t.str))||!inside.some(t=>t.str.length>18))continue;
  markers.push({y:a.start/h-.002,bottom:b.end/h+.002,kind:'note',reason:'Boxed note - review'});
 }
 for(const t of text)if(/^[•●▪➢❖]$/.test(t.str)&&t.x<.18&&t.y>.2&&t.y<1-footer)markers.push({y:Math.max(.03,t.y-t.h-.0003),bottom:t.y+.004,kind:'note',reason:'Bullet note - review'});
 markers.sort((a,b)=>a.y-b.y);
 const output=[];
 for(const m of markers){if(anchors.some(a=>Math.abs(a.top-m.y)<.008))continue;const prev=output.at(-1);if(prev&&Math.abs(prev.y-m.y)<.012){if(m.kind==='topic')Object.assign(prev,m);continue;}if(prev&&m.kind==='note'&&!anchors.some(a=>a.top>prev.y&&a.top<m.y))continue;output.push(m);}
 return output;
}
export function assembleTutePages(pages,{joinContinuations=true,footer=.07,unitOverrides={}}={}) {
 const questions=[],notes=[],skipped=[],pageUnits=[];let unit=null,set=1,lastNumber=null,topic='',topicCount=0,noteCount=0,lastPageEndedQuestion=false;
 const addNote=(p,region,kind='note',reason='Notes before questions')=>{
  if(region.bottom-region.y<.006||!p.image||!hasInk(p.image,region))return;
  const part={...region,pageIndex:p.pageIndex};notes.push({...part,number:++noteCount,kind,unit:unit??'Unlabelled',set,topic,parts:[part],review:true,reviewReason:reason});
 };
 for(const p of pages){
  const info=p.analysis,hasOverride=Object.hasOwn(unitOverrides,p.pageIndex),detected=hasOverride?String(unitOverrides[p.pageIndex]):info.unit;
  const newUnit=detected!==null&&detected!==unit;
  if(newUnit){unit=detected;set=1;lastNumber=null;topic='';topicCount=0;}
  const first=info.regions[0];
  const restart=!newUnit&&lastNumber!==null&&first&&first.number<=lastNumber;
  if(restart){set++;topic='';}
  const uncertain=unit===null||(!hasOverride&&restart);
  pageUnits.push({pageIndex:p.pageIndex,unit:unit??'Unlabelled',source:hasOverride?'Manual':info.unit?'Heading':uncertain?'Review':'Previous page',review:uncertain});
  if(!first){skipped.push(p.pageIndex+1);lastPageEndedQuestion=false;continue;}
  const markers=(info.markers??[]).filter(m=>m.y<1-footer);
  const prefixStart=newUnit ? .188 : .035;
  const previous=questions.at(-1);
  const prefixMarkers=markers.filter(m=>m.y<first.y);
  const continuation=joinContinuations&&!newUnit&&!restart&&previous&&lastPageEndedQuestion&&!prefixMarkers.length&&first.number===Number(previous.number)+1&&previous.parts.at(-1).pageIndex===p.pageIndex-1&&info.firstTop>.075;
  if(continuation){const part={x:.048,y:.035,right:.954,bottom:info.firstTop,pageIndex:p.pageIndex};if(p.image&&hasInk(p.image,part)){previous.parts.push(part);previous.review=true;previous.reviewReason='Joined next-page content';}}
  else if(!restart&&first.y>prefixStart+.015){addNote(p,{x:.048,y:prefixStart,right:.954,bottom:first.y},'note','Intro / topic notes');}
  for(const m of prefixMarkers)if(m.kind==='topic')topic=`Topic ${++topicCount}`;
  const tails=[];
  for(const region of info.regions){
   if(lastNumber!==null&&region.number<=lastNumber&&region!==first)set++;
   const within=region.column?[]:markers.filter(m=>m.y>region.y+.008&&m.y<region.bottom-.002);
   const cut=within[0]?.y??region.bottom,part={...region,bottom:cut,pageIndex:p.pageIndex};
   questions.push({...part,kind:'question',unit:unit??'Unlabelled',set,topic,parts:[part],review:uncertain,reviewReason:uncertain?'Check unit at numbering restart':''});lastNumber=region.number;
   if(!region.column)for(let i=0;i<within.length;i++){const m=within[i];if(m.kind==='topic')topic=`Topic ${++topicCount}`;addNote(p,{x:.048,y:m.y,right:.954,bottom:within[i+1]?.y??region.bottom},m.kind,m.reason);}
   tails.push({bottom:region.bottom,kind:within.length?'note':'question'});
  }
  lastPageEndedQuestion=tails.at(-1)?.kind==='question';
 }
 return {questions,notes,pageUnits,skipped,units:[...new Set(questions.map(q=>q.unit))]};
}
