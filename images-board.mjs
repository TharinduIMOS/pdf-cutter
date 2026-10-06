import {createTyDocument,imagePlacement,boardBackground,BOARD,pngSize} from './ty-export.mjs?v=size1';
const MAX_BYTES=512*1024*1024;
export const sortImageFiles=files=>[...files].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));
export async function prepareBoardImage(file){
 if(!/\.(png|jpe?g|webp)$/i.test(file.name))throw Error('Use PNG, JPG or WebP images.');
 if(file.size>50*1024*1024)throw Error('Image is larger than 50 MB.');
 let png=false;
 const signature=new Uint8Array(await file.slice(0,33).arrayBuffer());
 try{const d=pngSize(signature);png=true;if(d.width*d.height>55000000)throw Error('Image exceeds 55 megapixels.');}catch(e){if(signature[0]===137)throw e;}
 const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
 let c;
 try{
  const {width,height}=bitmap;
  if(!width||!height||width>30000||height>30000||width*height>55000000)throw Error('Image is too large. Use an image below 55 megapixels and 30,000 pixels per side.');
  const encode=canvas=>new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Could not convert this image.')),'image/png'));
  c=document.createElement('canvas');let blob=file;
  if(!png){c.width=width;c.height=height;c.getContext('2d').drawImage(bitmap,0,0);blob=await encode(c);}
  const ratio=Math.min(1,1000/width,800/height);c.width=Math.max(1,Math.round(width*ratio));c.height=Math.max(1,Math.round(height*ratio));c.getContext('2d').drawImage(bitmap,0,0,c.width,c.height);
  const preview=await encode(c);
  return {id:crypto.randomUUID(),name:file.name,width,height,blob,url:URL.createObjectURL(preview)};
 }finally{bitmap.close();if(c)c.width=c.height=1;}
}
export function setupImagesBoard(){
 const $=id=>document.getElementById(id);let images=[],index=0,busy=false;
 const status=(text,error=false)=>{$('imagesStatus').textContent=text;$('imagesStatus').classList.toggle('error',error);};
 const setBusy=value=>{busy=value;document.querySelectorAll('#imageBoardPanel button,#imageBoardPanel input,#imageBoardPanel select,.cut-modes button').forEach(e=>e.disabled=value);$('imagesProgress').hidden=!value;drawPreview();};
 function drawPreview(){
  index=Math.max(0,Math.min(index,images.length-1));const q=images[index];
  $('imagesCount').textContent=`${images.length} images · ${images.length} board pages`;
  $('imagesEmpty').hidden=!!q;$('imagesStage').hidden=!q;$('imagesNavigation').hidden=!q;
  $('imagesDownload').disabled=busy||!q;$('imagesClear').disabled=busy||!q;$('imagesSort').disabled=busy||!q;
  $('imagesPrev').disabled=busy||index===0;$('imagesNext').disabled=busy||index>=images.length-1;
  $('imagesPage').textContent=q?`Page ${index+1} of ${images.length}`:'';
  $('imagesStage').style.background=boardBackground($('imagesBackground').value);
  $('imagesList').style.setProperty('--image-board-bg',boardBackground($('imagesBackground').value));
  if(!q){$('imagesPreview').removeAttribute('src');$('imagesCaption').textContent='';return;}
  const p=imagePlacement(q.width,q.height,$('imagesAlign').value,Number($('imagesSize').value)),img=$('imagesPreview');img.src=q.url;img.alt=`Page ${index+1}: ${q.name}`;
  Object.assign(img.style,{left:p.x/BOARD.width*100+'%',top:p.y/BOARD.height*100+'%',width:p.width/BOARD.width*100+'%',height:p.height/BOARD.height*100+'%'});
  $('imagesCaption').textContent=`${q.name} · ${q.width} × ${q.height} px`;
  document.querySelectorAll('#imagesList article').forEach((a,i)=>a.classList.toggle('selected',i===index));
 }
 function drawList(){
  $('imagesList').replaceChildren();
  images.forEach((q,i)=>{
   const row=document.createElement('article');row.className='board-image-row';
   const choose=document.createElement('button');choose.className='board-image-select';choose.title=q.name;choose.setAttribute('aria-label',`Preview page ${i+1}: ${q.name}`);
   const img=document.createElement('img');img.src=q.url;img.alt='';img.loading='lazy';
   const name=document.createElement('span');name.textContent=`${i+1}. ${q.name}`;choose.append(img,name);choose.onclick=()=>{if(!busy){index=i;drawPreview();}};row.append(choose);
   for(const [label,aria,action,disabled] of [['↑','Move page up',()=>move(i,-1),i===0],['↓','Move page down',()=>move(i,1),i===images.length-1],['×','Remove image',()=>{URL.revokeObjectURL(q.url);images.splice(i,1);drawList();},false]]){
    const b=document.createElement('button');b.textContent=label;b.setAttribute('aria-label',`${aria}: ${q.name}`);b.title=aria;b.disabled=busy||disabled;b.onclick=()=>{if(!busy)action();};row.append(b);
   }
   choose.disabled=busy;$('imagesList').append(row);
  });drawPreview();
 }
 function move(i,delta){const j=i+delta;if(j<0||j>=images.length)return;[images[i],images[j]]=[images[j],images[i]];index=j;drawList();}
 async function addFiles(files){
  if(busy||!files.length)return;setBusy(true);const errors=[];let added=0,totalBytes=images.reduce((n,q)=>n+q.blob.size,0);const sorted=sortImageFiles(files);
  try{
   for(let i=0;i<sorted.length;i++){
    status(`Preparing image ${i+1} of ${sorted.length}…`);$('imagesProgress').value=i/sorted.length*100;
    if(images.length>=200){errors.push('Maximum 200 images per board file.');break;}
    try{const q=await prepareBoardImage(sorted[i]);if(totalBytes+q.blob.size>MAX_BYTES){URL.revokeObjectURL(q.url);throw Error('Total images exceed 512 MB.');}images.push(q);totalBytes+=q.blob.size;added++;}
    catch(e){errors.push(`${sorted[i].name}: ${e.message||'Could not read this image.'}`);}
    await new Promise(requestAnimationFrame);
   }
   status(`${added} images added. ${images.length} pages ready.${errors.length?' Skipped: '+errors.slice(0,5).join(' · '):' Review the order, then download your .ty file.'}`,errors.length>0);
  }finally{setBusy(false);drawList();}
 }
 $('imagesFile').onchange=e=>{const files=[...e.target.files];e.target.value='';addFiles(files);};
 $('imagesDrop').onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&!busy){e.preventDefault();$('imagesFile').click();}};
 for(const name of ['dragenter','dragover'])$('imagesDrop').addEventListener(name,e=>{e.preventDefault();if(!busy)$('imagesDrop').classList.add('drag');});
 for(const name of ['dragleave','drop'])$('imagesDrop').addEventListener(name,e=>{e.preventDefault();$('imagesDrop').classList.remove('drag');if(name==='drop'&&!busy)addFiles([...e.dataTransfer.files]);});
 $('imagesClear').onclick=()=>{if(busy)return;images.forEach(q=>URL.revokeObjectURL(q.url));images=[];index=0;status('Images cleared. Upload a new set to begin.');drawList();};
 $('imagesSort').onclick=()=>{if(busy)return;images=sortImageFiles(images);index=0;drawList();};
 $('imagesPrev').onclick=()=>{if(!busy){index--;drawPreview();}};$('imagesNext').onclick=()=>{if(!busy){index++;drawPreview();}};
 $('imagesSize').oninput=()=>{$('imagesSizeValue').textContent=$('imagesSize').value+'%';drawPreview();};
 $('imagesAlign').onchange=$('imagesBackground').onchange=drawPreview;
 $('imagesDownload').onclick=async()=>{
  if(busy||!images.length)return;setBusy(true);
  try{
   const blob=await createTyDocument(images,{ink:$('imagesBackground').value,align:$('imagesAlign').value,sizePercent:Number($('imagesSize').value),onProgress:async(done,total)=>{status(`Creating board page ${done} of ${total}…`);$('imagesProgress').value=done/total*100;await new Promise(requestAnimationFrame);}});
   const name=$('imagesName').value.trim().replace(/\.ty$/i,'').replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,70)||'IMOS-Smart-Board';
   const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${name}.ty`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
   status(`Download started · ${images.length} pages · one image per page.`);
  }catch(e){status('Export failed: '+e.message,true);}finally{setBusy(false);drawList();}
 };
 drawList();return {isBusy:()=>busy};
}
