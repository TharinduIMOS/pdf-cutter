import {setupImagesBoard} from './images-board.mjs?v=size1';
import * as pdfjs from './vendor/pdf.mjs';
import {createTyDocument,imagePlacement,boardBackground,BOARD} from './ty-export.mjs?v=size1';
import { zipSync } from './vendor/fflate.js';
import {findDividers,findAnchors,makeRegions,convertInk,renderQuestion,withPngDpi} from './engine.mjs?v=size1';
import {setupOwnCutter} from './own-cutter.mjs?v=size1';
import {analyseTutePage,assembleTutePages} from './tute-engine.mjs?v=size1';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.mjs',import.meta.url).href;
const $=id=>document.getElementById(id);
let pdf=null,pages=[],questions=[],ink='white',busy=false,fileName='',editing=null,run=0,mode='paper',unitFilter='all',editingPart=0,unitOverrides={},kindFilter='question';
const setStatus=(s,error=false)=>{$('status').textContent=s;$('status').classList.toggle('error',error)};
function setBusy(v){busy=v;$('detect').disabled=v||!pdf;$('downloadAll').disabled=v||!questions.length||questions.some(q=>!q.blob);$('file').disabled=v;$('sample').disabled=v;document.querySelectorAll('.ink,#resolution,#clean,#trim,#footer,#startPage,#joinContinuations,.cut-modes button,.unit-filters button,.card-actions button,.own-toolbar button,.own-toolbar input,.own-toolbar select,.own-coordinates input,#ownCut,#ownLastDownload,#kindFilter,#applyUnit,.unit-correction input').forEach(e=>e.disabled=v);document.querySelectorAll('[data-download]').forEach(e=>e.disabled=v||!questions.find(q=>q.id===e.dataset.download)?.blob);$('progress').hidden=!v;updateBoardAvailability();}
function release(){questions.forEach(q=>q.url&&URL.revokeObjectURL(q.url));questions=[];pages=[];$('questions').replaceChildren();$('count').textContent='0';$('unitFilters').replaceChildren();$('unitFilters').hidden=true;unitFilter='all';$('tuteReview').hidden=true;ownCutter.reset();}
function canvas(w,h){const c=document.createElement('canvas');c.width=Math.ceil(w);c.height=Math.ceil(h);return c;}
async function renderPage(page,scale){const viewport=page.getViewport({scale});const c=canvas(viewport.width,viewport.height);await page.render({canvasContext:c.getContext('2d'),viewport,background:'rgb(255,255,255)'}).promise;return {canvas:c,viewport};}
async function loadPdf(data,name){
 if(busy)return;setBusy(true);setStatus('Opening your paper…');$('progress').value=0;
 try{
  if(data.byteLength>50*1024*1024)throw Error('Please choose a PDF smaller than 50 MB.');
  const task=pdfjs.getDocument({data,wasmUrl:new URL('./vendor/wasm/',import.meta.url).href,standardFontDataUrl:new URL('./vendor/standard_fonts/',import.meta.url).href,cMapUrl:new URL('./vendor/cmaps/',import.meta.url).href,cMapPacked:true});
  task.onPassword=()=>{task.destroy();setStatus('This PDF is password protected. Upload an unlocked copy.',true);setBusy(false);};
  const next=await task.promise;
  if(next.numPages>60){await task.destroy();throw Error('This paper has more than 60 pages. Split it into smaller PDFs first.');}
  if(pdf)await pdf.loadingTask.destroy();pdf=next;release();unitOverrides={};fileName=name;
  $('fileInfo').hidden=false;$('fileInfo').textContent=`${name} · ${pdf.numPages} pages`;
  $('summary').textContent=`${pdf.numPages} pages · Ready to detect questions`;
  $('empty').hidden=true;
  if(mode==='own')await ownCutter.showPage(1);else await detectQuestions();
 }catch(e){console.error(e);setStatus(e.message.includes('password')?e.message:'Could not open the PDF. '+e.message,true)}finally{setBusy(false)}
}
async function detectQuestions(){
 if(!pdf)return;if(mode==='own')return ownCutter.showPage(Number($('ownPage').value));if(mode==='tute')return detectTute();setBusy(true);const thisRun=++run;release();let numbered=0;
 try{
  for(let n=1;n<=pdf.numPages;n++){
   setStatus(`Finding question dividers · page ${n} of ${pdf.numPages}`);
   const page=await pdf.getPage(n);const rendered=await renderPage(page,Math.min(1.55,1100/page.getViewport({scale:1}).width));
   const text=await page.getTextContent();const anchors=findAnchors(text.items,rendered.viewport);
   const lines=findDividers(rendered.canvas.getContext('2d').getImageData(0,0,rendered.canvas.width,rendered.canvas.height));
   const regions=makeRegions(lines,anchors,Number($('footer').value)/100);
   pages.push({page,preview:rendered.canvas,lines});
   if(anchors.length)numbered++;
   for(const r of regions)questions.push({...r,pageIndex:n-1,id:crypto.randomUUID(),number:r.number??questions.length+1});
   $('progress').value=n/pdf.numPages*45;
   await new Promise(requestAnimationFrame);
  }
  if(thisRun!==run)return;
  await buildPreviews();
  setStatus(questions.length?`${questions.length} question crops ready. ${numbered===pdf.numPages?'Check the previews, then download.':'Some pages have no readable question numbers. Review crops and remove headers before downloading.'}`:'No questions found. Try reducing the footer exclusion.');
 }catch(e){console.error(e);setStatus('Processing stopped: '+e.message,true)}finally{setBusy(false);updateCounts()}
}
async function makePng(q){
 const scale=Number($('resolution').value),dpi=Math.round(scale*72),parts=q.parts??[q],pieces=[];
 try {
 for(const part of parts){
  const c=await renderQuestion(pages[part.pageIndex].page,part,scale,canvas);
  const ctx=c.getContext('2d',{willReadFrequently:true});
  const im=ctx.getImageData(0,0,c.width,c.height),box=convertInk(im,ink,Number($('clean').value),$('trim').checked);ctx.putImageData(im,0,0);
  const out=canvas(box.width,box.height);out.getContext('2d').drawImage(c,box.x,box.y,box.width,box.height,0,0,box.width,box.height);c.width=c.height=1;pieces.push(out);
 }
 const gap=Math.round(12*scale),width=Math.max(...pieces.map(c=>c.width)),height=pieces.reduce((n,c)=>n+c.height,0)+gap*(pieces.length-1);
 if(width*height>55000000||height>30000)throw Error('This joined question is too large at this quality. Choose 600 or 300 DPI.');
 const out=canvas(width,height),ctx=out.getContext('2d');let y=0;
 for(const c of pieces){ctx.drawImage(c,0,y);y+=c.height+gap;c.width=c.height=1;}
 const thumbScale=Math.min(1,1100/width),thumb=canvas(width*thumbScale,height*thumbScale);thumb.getContext('2d').drawImage(out,0,0,thumb.width,thumb.height);
 const encode=c=>new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('PNG could not be created. Try a lower DPI.')),'image/png'));
 const previewBlob=await encode(thumb);thumb.width=thumb.height=1;
 const raw=await encode(out);out.width=out.height=1;
 const blob=new Blob([withPngDpi(new Uint8Array(await raw.arrayBuffer()),dpi)],{type:'image/png'});
 return {blob,previewBlob,width,height,dpi};
 }finally{for(const c of pieces)c.width=c.height=1;}
}
async function detectTute(){
 const start=Number($('startPage').value);
 if(!Number.isInteger(start)||start<1||start>pdf.numPages){setStatus(`Choose a start page between 1 and ${pdf.numPages}.`,true);return;}
 setBusy(true);release();const scans=[];
 try{
 for(let n=start;n<=pdf.numPages;n++){
  setStatus(`Reading question numbers and units · page ${n} of ${pdf.numPages}`);
  const page=await pdf.getPage(n),rendered=await renderPage(page,1.4),text=await page.getTextContent();
  const image=rendered.canvas.getContext('2d').getImageData(0,0,rendered.canvas.width,rendered.canvas.height);
  const analysis=analyseTutePage(text.items,rendered.viewport,{footer:Number($('footer').value)/100,image});
  pages[n-1]={page,preview:rendered.canvas};scans.push({pageIndex:n-1,analysis,image});
  $('progress').value=(n-start+1)/(pdf.numPages-start+1)*40;await new Promise(requestAnimationFrame);
 }
 const result=assembleTutePages(scans,{joinContinuations:$('joinContinuations').checked,footer:Number($('footer').value)/100,unitOverrides});
 questions=[...result.questions,...result.notes].sort((a,b)=>a.pageIndex-b.pageIndex||a.y-b.y||a.x-b.x).map(q=>({...q,id:crypto.randomUUID()}));scans.length=0;
 if(!questions.length){setStatus('No readable question numbers found. This mode needs a PDF text layer; scanned-only pages need OCR first. Check the start page.',true);return;}
 $('tuteReview').hidden=false;$('tuteCounts').textContent=`${result.questions.length} questions · ${result.notes.length} notes / topics`;$('unitMap').textContent=result.pageUnits.map(p=>`Page ${p.pageIndex+1}: ${p.unit} (${p.source})`).join(' · ');$('unitFrom').max=$('unitTo').max=pdf.numPages;drawUnitFilters();await buildPreviews();
 const joined=questions.filter(q=>q.parts.length>1).length;
 setStatus(`${result.questions.length} questions · ${result.notes.length} notes / topics kept separately · ${result.units.length} units · ${joined} joined across pages. ${result.skipped.length?`No numbered questions on page(s) ${result.skipped.join(', ')}; skipped. `:''}Review the crops, especially joined content and unit changes.`);
 }catch(e){console.error(e);setStatus('Tute processing stopped: '+e.message,true)}finally{setBusy(false);updateCounts();}
}
function drawUnitFilters(){
 const bar=$('unitFilters');bar.replaceChildren();bar.hidden=mode!=='tute'||!questions.length;if(bar.hidden)return;
 for(const value of ['all',...new Set(questions.map(q=>q.unit))]){const b=document.createElement('button');b.textContent=value==='all'?'All units':`Unit ${value}`;b.className=value===unitFilter?'active':'';b.setAttribute('aria-pressed',value===unitFilter);b.onclick=()=>{unitFilter=value;drawUnitFilters();drawCards();};bar.append(b);}
}
async function buildPreviews(){
 let completed=0;for(const q of questions)q.blob=null;
 for(const q of questions){
  setStatus(`Rendering question ${q.number} at ${Math.round(Number($('resolution').value)*72)} DPI · ${completed+1} of ${questions.length}`);
  await new Promise(requestAnimationFrame);
  const result=await makePng(q);if(q.url)URL.revokeObjectURL(q.url);Object.assign(q,result,{url:URL.createObjectURL(result.previewBlob)});completed++;$('progress').value=45+55*completed/questions.length;
  if(completed%4===0||completed===questions.length)drawCards();
 }
}
function updateCounts(){if(mode==='tute')$('tuteCounts').textContent=`${questions.filter(q=>q.kind==='question').length} questions · ${questions.filter(q=>q.kind!=='question').length} notes / topics`;$('count').textContent=questions.length;$('summary').textContent=pdf?`${pdf.numPages} pages · ${questions.length} individual PNGs · ${ink} ink`:'Upload a paper to begin.';$('downloadAll').disabled=busy||!questions.length||questions.some(q=>!q.blob);$('empty').hidden=!!pdf;updateBoardAvailability();}
function visibleQuestions(){return questions.filter(q=>(unitFilter==='all'||q.unit===unitFilter)&&(mode!=='tute'||kindFilter==='all'||kindFilter==='review'&&q.review||kindFilter==='question'&&q.kind==='question'||kindFilter==='notes'&&q.kind!=='question'));}
function drawCards(){
 $('questions').replaceChildren();
 visibleQuestions().forEach((q,index)=>{
  const article=document.createElement('article');article.className='question-card';
  const top=document.createElement('div');top.className='card-top';const heading=document.createElement('strong');heading.textContent=mode==='own'?`Crop ${q.number}`:q.kind==='note'?`Note ${q.number}`:q.kind==='topic'?`Topic / note ${q.number}`:`Question ${q.number}`;const pageLabel=document.createElement('small');pageLabel.textContent=`PAGE ${q.parts?q.parts.map(p=>p.pageIndex+1).join(' + '):q.pageIndex+1}`;top.append(heading,pageLabel);
  const preview=document.createElement('div');preview.className='question-preview';if(q.url){const img=document.createElement('img');img.loading='lazy';img.src=q.url;img.alt=`Question ${q.number}, transparent ${ink} text`;preview.append(img)}
  const actions=document.createElement('div');actions.className='card-actions';
  for(const [label,action,cls] of [['Adjust crop',()=>openEditor(q),''],['×',()=>removeQuestion(q),'remove'],['↓ PNG',()=>download(q),'']]){const b=document.createElement('button');b.textContent=label;b.className=cls;b.disabled=busy||(label==='↓ PNG'&&!q.blob);if(label==='↓ PNG')b.dataset.download=q.id;b.addEventListener('click',action);if(label==='×')b.setAttribute('aria-label',`Remove question ${q.number}`);actions.append(b)}
  const dim=document.createElement('div');dim.className='dimensions';dim.textContent=q.width?`${q.width} × ${q.height} px · ${q.dpi} DPI · Transparent PNG`:'Preparing preview…';article.append(top);if(q.unit){const meta=document.createElement('div');meta.className='question-unit';meta.textContent=`Unit ${q.unit} · Set ${q.set}${q.topic?' · '+q.topic:''}${q.review?' · Review':''}`;if(q.review)meta.title=q.reviewReason||'Check this crop';article.append(meta);}article.append(preview,actions,dim);$('questions').append(article);
 });updateCounts();
}
function removeQuestion(q){if(busy)return;questions=questions.filter(a=>a.id!==q.id);URL.revokeObjectURL(q.url);drawCards();setStatus('Crop removed. Detect questions again to restore all crops.');}
const baseName=()=>fileName.replace(/\.pdf$/i,'').replace(/[^a-zA-Z0-9_-]/g,'-').replace(/-+/g,'-').slice(0,70)||'questions';
const safeName=s=>String(s).replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,70)||'Unknown';
function pngName(q){const index=questions.indexOf(q)+1;return `${baseName()}-${q.unit?`Unit-${safeName(q.unit)}-Set-${q.set}-`:''}${String(index).padStart(3,'0')}-${q.kind==='note'?'Note':q.kind==='topic'?'Topic':'Q'}${q.number}-${ink}.png`;}
function save(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
function download(q){if(!q.blob)return;save(q.blob,pngName(q));setStatus(`Question ${q.number} PNG download started.`)}
$('downloadAll').onclick=async()=>{if(busy)return;setBusy(true);setStatus('Packing your transparent PNGs…');try{const files={};for(let i=0;i<questions.length;i++){const q=questions[i];files[(q.unit?`Unit-${safeName(q.unit)}/${q.kind==='question'?'Questions':'Notes-and-topics'}/Set-${q.set}/`:'')+pngName(q)]=new Uint8Array(await q.blob.arrayBuffer());$('progress').value=(i+1)/questions.length*90;}const zip=zipSync(files,{level:0});save(new Blob([zip],{type:'application/zip'}),`${baseName()}-${ink}-PNGs.zip`);setStatus(`${questions.length} PNGs packed. ZIP download started.`)}catch(e){setStatus('Download failed: '+e.message,true)}finally{setBusy(false)}};
$('file').onchange=e=>{const f=e.target.files[0];if(f)f.arrayBuffer().then(b=>loadPdf(b,f.name));e.target.value=''};
$('dropzone').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!busy)$('file').click()}};
for(const event of ['dragover','dragenter'])$('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.add('drag')});
for(const event of ['dragleave','drop'])$('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.remove('drag')});
$('dropzone').addEventListener('drop',async e=>{if(busy)return;const f=e.dataTransfer.files[0];if(!f)return;if(!/\.pdf$/i.test(f.name)){setStatus('Please choose a PDF file.',true);return}await loadPdf(await f.arrayBuffer(),f.name)});
$('sample').onclick=async()=>{if(busy)return;$('sample').disabled=true;setStatus('Loading your sample paper…');try{const response=await fetch(new URL(mode==='tute'?'./sample-tute.pdf':'./sample-paper.pdf',import.meta.url).href);if(!response.ok)throw Error('Sample is unavailable.');await loadPdf(await response.arrayBuffer(),mode==='tute'?'Grade 6 Unit 20 - 21 - 22 SM.pdf':'MCQ 1001 - Paper 40 - SM.pdf')}catch(e){setStatus(e.message,true)}finally{$('sample').disabled=false}};
$('detect').onclick=()=>!busy&&detectQuestions();
async function refresh(){if(!questions.length||busy)return;setBusy(true);setStatus('Updating transparent PNGs…');try{await buildPreviews();setStatus('PNGs updated. Check fine lines in the previews.')}catch(e){setStatus(e.message,true)}finally{setBusy(false);drawCards()}}
document.querySelectorAll('.ink').forEach(b=>b.onclick=()=>{ink=b.dataset.ink;document.querySelectorAll('.ink').forEach(e=>{e.classList.toggle('active',e===b);e.setAttribute('aria-pressed',e===b)});document.querySelector('.tag').textContent=`${ink.toUpperCase()} INK · TRANSPARENT`;document.querySelector('.transparent-note small').textContent=ink==='white'?'සුදු අකුරු සහ රේඛා පමණයි.':'කළු අකුරු සහ රේඛා පමණයි.';if(ink==='black')setPreview('grid');else setPreview('dark');refresh()});
$('resolution').onchange=refresh;$('trim').onchange=refresh;$('clean').oninput=()=>{$('cleanValue').textContent=$('clean').value+'%'};$('clean').onchange=refresh;
$('footer').oninput=()=>{$('footerValue').textContent=$('footer').value+'%'};$('footer').onchange=()=>{if(pdf)setStatus('Footer margin changed. Click Detect questions to apply it.');};
function setPreview(mode){$('questions').classList.toggle('grid-bg',mode==='grid');$('darkPreview').classList.toggle('selected',mode==='dark');$('lightPreview').classList.toggle('selected',mode==='grid')}
$('darkPreview').onclick=()=>setPreview('dark');$('lightPreview').onclick=()=>setPreview('grid');
function openEditor(q){if(busy)return;editing=q;editingPart=0;$('cropMeta').hidden=mode!=='tute';$('cropKind').value=q.kind??'question';$('cropUnit').value=q.unit??'';$('cropTopic').value=q.topic??'';$('cropPart').replaceChildren();const parts=q.parts??[q];parts.forEach((part,i)=>{const option=document.createElement('option');option.value=i;option.textContent=`Part ${i+1} · PDF page ${part.pageIndex+1}`;$('cropPart').append(option);});$('cropPartLabel').hidden=parts.length<2;$('splitCrop').disabled=parts.length>1;showCropPart();$('editor').showModal()}
function showCropPart(){const part=editing.parts?.[editingPart]??editing;const src=pages[part.pageIndex].preview,c=$('cropCanvas');c.width=src.width;c.height=src.height;c.getContext('2d').drawImage(src,0,0);setCropFields(part);}
$('cropPart').onchange=()=>{editingPart=Number($('cropPart').value);showCropPart();};
function setCropFields(q){$('cropLeft').value=(q.x*100).toFixed(1);$('cropTop').value=(q.y*100).toFixed(1);$('cropRight').value=(q.right*100).toFixed(1);$('cropBottom').value=(q.bottom*100).toFixed(1);updateCropBox()}
function cropValues(){return {x:Number($('cropLeft').value)/100,y:Number($('cropTop').value)/100,right:Number($('cropRight').value)/100,bottom:Number($('cropBottom').value)/100}}
function updateCropBox(){const c=cropValues();Object.assign($('cropBox').style,{left:c.x*100+'%',top:c.y*100+'%',width:(c.right-c.x)*100+'%',height:(c.bottom-c.y)*100+'%'});}
['cropLeft','cropTop','cropRight','cropBottom'].forEach(id=>$(id).oninput=updateCropBox);
let start=null;const point=e=>{const r=$('cropStage').getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}};
$('cropStage').onpointerdown=e=>{start=point(e);$('cropStage').setPointerCapture(e.pointerId)};$('cropStage').onpointermove=e=>{if(!start)return;const p=point(e);setCropFields({x:Math.min(start.x,p.x),y:Math.min(start.y,p.y),right:Math.max(start.x,p.x),bottom:Math.max(start.y,p.y)})};$('cropStage').onpointerup=()=>{start=null};$('cropStage').onpointercancel=()=>{start=null};
$('closeEditor').onclick=()=>$('editor').close();
async function applyCrop(split=false){const c=cropValues();if(!Object.values(c).every(Number.isFinite)||c.x<0||c.y<0||c.right>1||c.bottom>1||c.right-c.x<.015||c.bottom-c.y<.008){setStatus('Choose a larger crop within the page.',true);return}
 if(mode==='tute'){editing.kind=$('cropKind').value;editing.unit=$('cropUnit').value.trim()||'Unlabelled';editing.topic=$('cropTopic').value.trim();editing.review=false;editing.reviewReason='';}
 const target=editing.parts?.[editingPart]??editing;Object.assign(target,c);if(editingPart===0)Object.assign(editing,c);
 if(split){if(editing.parts?.length>1)return;const mid=(c.y+c.bottom)/2;target.bottom=mid;editing.bottom=mid;const next={...editing,y:mid,bottom:c.bottom,id:crypto.randomUUID(),number:editing.number+'.2',url:null,blob:null};if(editing.parts){editing.parts=[{...target}];next.parts=[{...target,y:mid,bottom:c.bottom}];}questions.splice(questions.indexOf(editing)+1,0,next);}
 $('editor').close();setBusy(true);setStatus('Updating this crop…');try{for(const q of split?questions.filter(q=>q===editing||q.number===editing.number+'.2'&&q.pageIndex===editing.pageIndex):[editing]){const result=await makePng(q);if(q.url)URL.revokeObjectURL(q.url);Object.assign(q,result,{url:URL.createObjectURL(result.previewBlob)});}setStatus('Crop updated.');}catch(e){setStatus(e.message,true);}finally{setBusy(false);drawUnitFilters();drawCards();}}
$('saveCrop').onclick=()=>applyCrop();$('splitCrop').onclick=()=>applyCrop(true);

async function changeMode(next){if(busy||mode===next)return;setBusy(true);mode=next;release();unitOverrides={};kindFilter='question';$('kindFilter').value=kindFilter;if(pdf){await pdf.loadingTask.destroy();pdf=null;}fileName='';$('fileInfo').hidden=true;$('empty').hidden=false;$('tuteOptions').hidden=mode!=='tute';$('detect').hidden=mode==='own';$('footer').closest('.panel').classList.toggle('own-export',mode==='own');$('uploadTitle').textContent=mode==='own'?'Your PDF':mode==='tute'?'Your tute PDF':'Your question paper';$('footer').value=mode==='tute'?7:8;$('footerValue').textContent=$('footer').value+'%';$('summary').textContent=mode==='tute'?'Upload a tute. Number detection starts at PDF page 3.':'Upload a paper to begin.';document.querySelector('.titlebar p').textContent=mode==='tute'?'ඉරි නැති tute එකේ ප්‍රශ්න අංක අනුව PNG වෙන් කරගන්න.':'PDF එකේ ප්‍රශ්න වෙන් කර transparent PNG ලෙස ගන්න.';document.querySelector('#empty p').textContent=mode==='tute'?'Questions, notes and topics are kept separately. Review unit assignments and any uncertain crops.':'Questions are separated along the paper’s horizontal lines. Text and diagrams stay together, with no background.';for(const [id,value] of [['paperMode','paper'],['tuteMode','tute'],['ownMode','own']]){$(id).classList.toggle('active',mode===value);$(id).setAttribute('aria-pressed',mode===value);}if(mode==='own'){$('summary').textContent='Upload a PDF, then select any area. No automatic cuts.';document.querySelector('.titlebar p').textContent='ඔබට අවශ්‍ය කොටස select කර PNG එකක් ලෙස ගන්න.';document.querySelector('#empty p').textContent='Your PDF opens as a page preview. Drag a rectangle to create each transparent PNG yourself.';}setStatus('');setBusy(false);}
$('paperMode').onclick=()=>changeMode('paper');$('tuteMode').onclick=()=>changeMode('tute');
$('startPage').onchange=$('joinContinuations').onchange=()=>{if(pdf)setStatus('Settings changed. Click Detect questions to apply.');};

async function ensurePage(pageIndex){if(!pages[pageIndex]){const page=await pdf.getPage(pageIndex+1),rendered=await renderPage(page,1.6);pages[pageIndex]={page,preview:rendered.canvas};}return pages[pageIndex];}
const ownCutter=setupOwnCutter({getPdf:()=>pdf,getBusy:()=>busy,setBusy,setStatus,ensurePage,onCut:async region=>{
 setBusy(true);setStatus('Creating your selected PNG…');const q={...region,number:Math.max(0,...questions.map(q=>Number(q.number)||0))+1,id:crypto.randomUUID(),kind:'manual'};
 try{const result=await makePng(q);Object.assign(q,result,{url:URL.createObjectURL(result.previewBlob)});questions.push(q);$('ownLast').style.background=ink==='black'?'#ccd8cf':'#19332a';$('ownLast').style.color=ink==='black'?'#183b2a':'white';$('ownLastImage').src=q.url;$('ownLast').hidden=false;$('ownLastDownload').onclick=()=>download(q);drawCards();setStatus(`Crop ${q.number} ready · ${q.width} × ${q.height} px · ${q.dpi} DPI. Select another area or download.`);}catch(e){setStatus(e.message,true);}finally{setBusy(false);}
}});
$('ownMode').onclick=()=>changeMode('own');

$('kindFilter').onchange=()=>{kindFilter=$('kindFilter').value;drawCards();};
$('applyUnit').onclick=()=>{if(busy||!pdf)return;const from=Number($('unitFrom').value),to=Number($('unitTo').value),unit=$('unitValue').value.trim();if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from||to>pdf.numPages||!unit){setStatus('Enter a valid PDF page range and a unit.',true);return;}for(let page=from;page<=to;page++)unitOverrides[page-1]=unit;detectTute();};

// Each exported page embeds one full-resolution crop, in workspace order.
let boardIndex=0;
const boardCrops=()=>$('boardScope').value==='visible'?visibleQuestions():questions;
function updateBoardAvailability(){
 $('openBoard').disabled=busy||!questions.length||questions.some(q=>!q.blob);
}
function drawBoardPreview(){
 const crops=boardCrops();boardIndex=Math.max(0,Math.min(boardIndex,crops.length-1));
 $('boardSummary').textContent=`${crops.length} crops → ${crops.length} pages · ${ink} ink · 16:9 board`;
 $('boardPreview').style.background=boardBackground(ink);
 $('boardPrev').disabled=busy||boardIndex===0;$('boardNext').disabled=busy||boardIndex>=crops.length-1;
 $('downloadBoard').disabled=busy||!crops.length||crops.some(q=>!q.blob);
 $('boardPage').textContent=crops.length?`Page ${boardIndex+1} of ${crops.length}`:'No crops in this view';
 const img=$('boardImage');img.hidden=!crops.length;
 if(!crops.length){img.removeAttribute('src');return;}
 const q=crops[boardIndex],p=imagePlacement(q.width,q.height,$('boardAlign').value,Number($('boardSize').value));
 img.src=q.url;img.alt=`Page ${boardIndex+1}: ${q.kind==='note'?'note':q.kind==='topic'?'topic':'crop'} ${q.number}`;
 Object.assign(img.style,{left:p.x/BOARD.width*100+'%',top:p.y/BOARD.height*100+'%',width:p.width/BOARD.width*100+'%',height:p.height/BOARD.height*100+'%'});
}
$('openBoard').onclick=()=>{if(busy)return;boardIndex=0;$('boardStatus').textContent='';$('boardStatus').classList.remove('error');drawBoardPreview();$('boardDialog').showModal();};
$('closeBoard').onclick=()=>{if(!busy)$('boardDialog').close();};
$('boardDialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
$('boardScope').onchange=$('boardAlign').onchange=()=>{boardIndex=0;drawBoardPreview();};
$('boardSize').oninput=()=>{$('boardSizeValue').textContent=$('boardSize').value+'%';drawBoardPreview();};
$('boardPrev').onclick=()=>{boardIndex--;drawBoardPreview();};$('boardNext').onclick=()=>{boardIndex++;drawBoardPreview();};
$('downloadBoard').onclick=async()=>{
 if(busy)return;const crops=[...boardCrops()];if(!crops.length)return;
 setBusy(true);drawBoardPreview();['boardScope','boardAlign','boardSize','closeBoard'].forEach(id=>$(id).disabled=true);$('boardStatus').classList.remove('error');
 try{
  const blob=await createTyDocument(crops,{ink,align:$('boardAlign').value,sizePercent:Number($('boardSize').value),onProgress:async(done,total)=>{$('boardStatus').textContent=`Creating page ${done} of ${total}…`;$('progress').value=done/total*100;await new Promise(requestAnimationFrame);}});
  save(blob,`${baseName()}-${crops.length}-pages.ty`);
  $('boardStatus').textContent=`${crops.length}-page smart board file downloaded. Open it in the app that created your .ty sample.`;
  setStatus(`Smart Board download started · ${crops.length} pages · one PNG per page.`);
 }catch(e){$('boardStatus').textContent=e.message;$('boardStatus').classList.add('error');}
 finally{setBusy(false);['boardScope','boardAlign','boardSize','closeBoard'].forEach(id=>$(id).disabled=false);drawBoardPreview();}
};

const imagesBoard=setupImagesBoard();
function showImageSection(active){
 document.querySelector('.workspace').hidden=active;
 document.querySelector('.titlebar').hidden=active;
 $('imageBoardPanel').hidden=!active;
 document.querySelector('main>footer').hidden=active;
 for(const [id,value] of [['paperMode','paper'],['tuteMode','tute'],['ownMode','own'],['imageBoardMode','images']]){
  const selected=active?value==='images':value===mode;$(id).classList.toggle('active',selected);$(id).setAttribute('aria-pressed',selected);
 }
}
$('imageBoardMode').onclick=()=>{if(!busy&&!imagesBoard.isBusy())showImageSection(true);};
for(const [id,value] of [['paperMode','paper'],['tuteMode','tute'],['ownMode','own']]){
 $(id).onclick=async()=>{if(busy||imagesBoard.isBusy())return;await changeMode(value);showImageSection(false);};
}
