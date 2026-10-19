'use strict';
const $=id=>document.getElementById(id);
const S={templates:[],template:null,sheets:[],sheet:null,fields:[],selected:new Set(),qty:{},page:0,previewPage:0,editRow:null,composition:null,requestSeq:0,timer:null,customTemplates:{},templateData:null};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast=(s,error=false)=>{let e=$('toast');e.textContent=s;e.className='show'+(error?' error':'');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>e.className='',4200)};
async function api(endpoint,opts={}){let response=await fetch(endpoint,opts);if(!response.ok){let msg;try{msg=(await response.json()).detail}catch{}throw new Error(msg||`Sunucu hatası: ${response.status}`)}return response}
async function send(endpoint,body){return (await api(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json()}
const DB_NAME='tanex-custom-templates', DB_STORE='templates';
function openTemplateDB(){return new Promise((resolve,reject)=>{let r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>r.result.createObjectStore(DB_STORE,{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function storedTemplates(){let db=await openTemplateDB();return new Promise((resolve,reject)=>{let t=db.transaction(DB_STORE,'readonly');let r=t.objectStore(DB_STORE).getAll();r.onsuccess=()=>{db.close();resolve(r.result)};r.onerror=()=>{db.close();reject(r.error)}})}
async function storeTemplate(item){let db=await openTemplateDB();return new Promise((resolve,reject)=>{let t=db.transaction(DB_STORE,'readwrite');t.objectStore(DB_STORE).put(item);t.oncomplete=()=>{db.close();resolve()};t.onerror=()=>{db.close();reject(t.error)}})}
function fileToBase64(file){return new Promise((resolve,reject)=>{let r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(r.error);r.readAsDataURL(file)})}
function chosenSheet(){return S.sheet}
function chosenRecords(){if(!S.sheet)return[];return S.sheet.rows.filter(r=>S.selected.has(r.id)).map(r=>({...r,qty:Math.max(0,Number(S.qty[r.id]??1))}));}
function options(){return {showNames:$('showNames').checked,fieldBlankLine:$('fieldBlankLine').checked,manual:!$('autoFont').checked,fontSize:Number($('fontSize').value||16),minFontSize:Number($('minFont').value||6),maxFontSize:26,padding:Number($('padding').value||0),font:$('fontFamily').value,align:$('align').value,vertical:$('vertical').value,bold:$('bold').checked}}
function payload(){return {templateId:S.template?.id||'',templateData:S.templateData,headers:S.sheet?.columns||[],fields:S.fields,records:chosenRecords(),start:Number($('startLabel').value||0),options:options()}}
async function refreshTemplates(chosen){const resp=await (await api('/api/templates')).json();let stored=[];try{stored=await storedTemplates()}catch(e){toast('Tarayıcı depolaması açılamadı: '+e.message,true)}S.customTemplates=Object.fromEntries(stored.map(x=>[x.id,x]));S.templates=[...resp.templates,...stored.map(x=>x.info)];
  $('templateSelect').innerHTML=S.templates.map(t=>`<option value="${esc(t.id)}">${esc(t.name.replace(/\.docx$/i,''))}</option>`).join('');
  S.template=S.templates.find(t=>t.id===chosen)||S.templates[0]||null;if(S.template){$('templateSelect').value=S.template.id;chooseTemplate(S.template.id)}
}
function chooseTemplate(id){S.template=S.templates.find(t=>t.id===id)||null;if(!S.template)return;const t=S.template;S.templateData=S.customTemplates[id]?.data||null;
 $('templateSummary').innerHTML=`<strong>${t.perPage} etiket / sayfa</strong> · ${t.cols} sütun × ${t.rows} satır<br>${t.page.width} × ${t.page.height} mm kağıt · yaklaşık ${t.cells[0]?.width} × ${t.cells[0]?.height} mm etiket`;
 $('startLabel').innerHTML=t.cells.map((c,i)=>`<option value="${i}">${i+1}. etiket${i?' (öncesini boş bırak)':''}</option>`).join('');$('startLabel').value='0';S.previewPage=0;queuePreview();
}
async function uploadTemplate(file){if(!file)return;let form=new FormData();form.append('file',file);try{
 $('templateSummary').textContent='Şablon analiz ediliyor…';
 if(file.size>2_000_000)throw new Error('En fazla 2 MB Word şablonu yüklenebilir.');
 let data=await fileToBase64(file);
 let j=await (await api('/api/templates',{method:'POST',body:form})).json();
 await storeTemplate({id:j.template.id,info:j.template,data});
 await refreshTemplates(j.template.id);
 toast('Word şablonu bu tarayıcıda kaydedildi.');
}catch(e){toast(e.message,true);await refreshTemplates()}finally{$('templateInput').value=''}}
async function uploadExcel(file){if(!file)return;let form=new FormData();form.append('file',file);$('excelStatus').textContent='Excel okunuyor…';try{let j=await (await api('/api/excel',{method:'POST',body:form})).json();S.sheets=j.sheets;S.sheet=S.sheets[0];$('sheetSelect').innerHTML=S.sheets.map((sh,i)=>`<option value="${i}">${esc(sh.name)} (${sh.count})</option>`).join('');$('sheetWrap').hidden=false;$('excelStatus').textContent=`✓ ${file.name}`;chooseSheet(0);toast('Excel verileri aktarıldı.')}catch(e){$('excelStatus').textContent='Excel yükleme başarısız';toast(e.message,true)}finally{$('excelInput').value=''}}
function chooseSheet(index){S.sheet=S.sheets[index];if(!S.sheet)return;S.selected=new Set();S.qty={};S.page=0;S.previewPage=0;
 const headers=S.sheet.columns;let idxs=headers.map((h,i)=>({i,h:h.toLocaleLowerCase('tr-TR')}));
 let name=idxs.find(x=>/kütüphane adı|ad soyad|kitap adı|ürün adı/.test(x.h));let addr=idxs.find(x=>/adres/.test(x.h));
 S.fields=[...(name?[name.i]:[0]),...(addr&&(!name||addr.i!==name.i)?[addr.i]:[])];
 if(S.sheet.rows[0]){S.selected.add(S.sheet.rows[0].id);S.qty[S.sheet.rows[0].id]=Number($('defaultQty').value)||1}
 $('rowSearch').value='';$('columnsEmpty').hidden=true;$('columnsWrap').hidden=false;$('dataEmpty').hidden=true;$('dataTableWrap').hidden=false;
 renderFields();renderRows();queuePreview();
}
function renderFields(){if(!S.sheet)return;let head=S.sheet.columns;
 let indices=[...S.fields,...head.map((_,i)=>i).filter(i=>!S.fields.includes(i))];
 $('fieldCount').textContent=S.fields.length+' sütun seçildi';
 $('fieldList').innerHTML=indices.map(idx=>`<div class="field-entry"><label title="${esc(head[idx])}"><input type="checkbox" data-field="${idx}" ${S.fields.includes(idx)?'checked':''}/><span class="field-name">${esc(head[idx])}</span></label>${S.fields.includes(idx)?`<div class="order-buttons"><button data-shift="${idx}" data-step="-1" ${S.fields.indexOf(idx)===0?'disabled':''} title="Yukarı">↑</button><button data-shift="${idx}" data-step="1" ${S.fields.indexOf(idx)===S.fields.length-1?'disabled':''} title="Aşağı">↓</button></div>`:''}</div>`).join('');
 $('fieldList').querySelectorAll('[data-field]').forEach(e=>e.addEventListener('change',()=>{let idx=Number(e.dataset.field);S.fields=e.checked?[...S.fields,idx]:S.fields.filter(x=>x!==idx);renderFields();queuePreview()}));
 $('fieldList').querySelectorAll('button[data-shift]').forEach(b=>b.onclick=()=>{let i=S.fields.indexOf(Number(b.dataset.shift)),j=i+Number(b.dataset.step);[S.fields[i],S.fields[j]]=[S.fields[j],S.fields[i]];renderFields();queuePreview()});
}
function filteredRows(){let q=$('rowSearch').value.trim().toLocaleLowerCase('tr-TR');return S.sheet?.rows.filter(r=>!q||r.values.some(v=>String(v).toLocaleLowerCase('tr-TR').includes(q)))||[]}
function renderRows(){if(!S.sheet)return;let items=filteredRows();let pages=Math.max(1,Math.ceil(items.length/25));S.page=Math.max(0,Math.min(S.page,pages-1));let entries=items.slice(S.page*25,(S.page+1)*25);
 const heads=S.sheet.columns;let important=heads.findIndex(h=>/kütüphane adı|ad soyad|kitap adı/i.test(h));if(important<0)important=0;
 $('dataRows').innerHTML=entries.map(r=>{let fields=r.values.filter((v,i)=>i!==important && v).slice(0,2).join(' · ');let select=S.selected.has(r.id);
 return `<tr class="${select?'active':''}"><td><input aria-label="${r.id}. kaydı seç" type="checkbox" data-select="${r.id}" ${select?'checked':''}/></td><td><span class="row-id">${r.id}</span></td><td><div class="row-primary" title="${esc(r.values[important])}">${esc(r.values[important]||'(Boş)')}</div><div class="row-secondary" title="${esc(fields)}">${esc(fields)}</div></td><td><input class="qty" type="number" min="0" max="200" value="${S.qty[r.id]??$('defaultQty').value}" data-qty="${r.id}" aria-label="Etiket adedi" /></td><td><button class="edit-btn" data-edit="${r.id}">Düzenle</button></td></tr>`}).join('');
 $('dataRows').querySelectorAll('[data-select]').forEach(x=>x.onchange=()=>{let id=Number(x.dataset.select);if(x.checked){S.selected.add(id);if(!S.qty[id])S.qty[id]=Number($('defaultQty').value)||1}else S.selected.delete(id);renderRows();queuePreview()});
 $('dataRows').querySelectorAll('[data-qty]').forEach(x=>x.oninput=()=>{let id=Number(x.dataset.qty);S.qty[id]=Math.min(200,Math.max(0,Number(x.value)||0));queuePreview()});
 $('dataRows').querySelectorAll('[data-edit]').forEach(x=>x.onclick=()=>openEdit(Number(x.dataset.edit)));
 $('tableRange').textContent=`${items.length?S.page*25+1:0}–${Math.min(items.length,(S.page+1)*25)} / ${items.length} kayıt`;
 $('pageText').textContent=`${S.page+1} / ${pages}`;$('prevPage').disabled=S.page===0;$('nextPage').disabled=S.page>=pages-1;refreshStats();
}
function refreshStats(){let records=chosenRecords();$('selectedCount').textContent=records.length;$('labelCount').textContent=records.reduce((sum,r)=>sum+r.qty,0)}
function openEdit(id){let row=S.sheet?.rows.find(r=>r.id===id);if(!row)return;S.editRow=row;
 $('editTitle').textContent=`${id}. Excel satırını düzenle`;
 $('editFields').innerHTML=S.sheet.columns.map((label,i)=>{let v=row.values[i]||'';let input=(v.length>90?`<textarea data-cell="${i}" rows="3">${esc(v)}</textarea>`:`<input type="text" data-cell="${i}" value="${esc(v)}"/>`);return `<div class="modal-input" ${v.length>100?'style="grid-column:1/-1"':''}><label title="${esc(label)}">${esc(label)}</label>${input}</div>`}).join('');
 $('editFields').querySelectorAll('[data-cell]').forEach(el=>el.addEventListener('input',()=>{row.values[Number(el.dataset.cell)]=el.value;queuePreview()}));$('editModal').hidden=false;
}
function closeEdit(){S.editRow=null;$('editModal').hidden=true;renderRows();queuePreview()}
function mmPercent(mm,size){return `${mm/size*100}%`}
function renderPreview(){if(!S.template)return;let t=S.template,comp=S.composition;let page=comp?.pages?.[S.previewPage]||[];
 const paper=$('paper');paper.style.aspectRatio=`${t.page.width} / ${t.page.height}`;
 let xPositions=[],xx=t.margins.left;for(let w of t.widths){xPositions.push(xx);xx+=w}
 let yPositions=[],yy=t.margins.top;for(let h of t.heights){yPositions.push(yy);yy+=h}
 let o=options(),scale=paper.clientWidth/t.page.width;
 $('pageGrid').innerHTML=t.cells.map((c,i)=>{let label=page[i];let x=xPositions[c.c],y=yPositions[c.r],w=c.width,h=c.height;
 const info=label?.text;let padding=(o.padding||0)*scale,align=o.align==='left'?'flex-start':o.align==='right'?'flex-end':'center',vertical=o.vertical==='top'?'flex-start':o.vertical==='bottom'?'flex-end':'center';
 let lines=info?.lines||[];let font=(info?.size||16)*25.4/72*scale;
 let css=`left:${mmPercent(x,t.page.width)};top:${mmPercent(y,t.page.height)};width:${mmPercent(w,t.page.width)};height:${mmPercent(h,t.page.height)};padding:${padding}px;justify-content:${vertical};`;
 let content=label?`<div class="line-group" style="align-items:${align};width:100%;font-size:${font.toFixed(2)}px;font-family:'${esc(o.font)}',Arial,sans-serif;font-weight:${o.bold?'700':'400'};text-align:${o.align}">${lines.map(l=>`<div class="line">${esc(l)||'&nbsp;'}</div>`).join('')}</div>`:'';
 return `<div class="print-label ${label?'filled':''} ${info?.overflow?'warn':''}" style="${css}"><span class="label-number">${i+1}</span>${content}</div>`}).join('');
 $('previewPage').textContent=`Sayfa ${S.previewPage+1} / ${comp?.pageCount||1}`;$('previewPrev').disabled=S.previewPage===0;$('previewNext').disabled=S.previewPage>=(comp?.pageCount||1)-1;
}
async function updatePreview(){refreshStats();let req=payload(),seq=++S.requestSeq;
 if(!S.template||!S.sheet||!req.fields.length||!req.records.length){S.composition=null;S.previewPage=0;renderPreview();$('previewInfo').textContent='Etiket oluşturmak için en az bir Excel kaydı ve bir sütun seç.';$('previewInfo').className='preview-info';$('downloadBtn').disabled=true;$('previewState').textContent='Bekliyor';return;}
 $('previewState').textContent='Hesaplanıyor…';try{let composition=await send('/api/preview',req);if(seq!==S.requestSeq)return;S.composition=composition;S.previewPage=Math.min(S.previewPage,composition.pageCount-1);renderPreview();$('downloadBtn').disabled=false;
 $('previewState').textContent=composition.overflowCount?'Taşma uyarısı':'Güncel';$('previewState').className='preview-badge'+(composition.overflowCount?' warn':'');
 $('previewInfo').textContent=composition.overflowCount?`${composition.total} etiket · ${composition.pageCount} sayfa · ${composition.overflowCount} etikette minimum puntoyla bile taşma olasılığı var. Alanı azalt veya şablonu değiştir.`:`${composition.total} etiket · ${composition.pageCount} sayfa. Özgün Word etiket yerleşimiyle çıktı hazırlanacak.`;
 $('previewInfo').className='preview-info'+(composition.overflowCount?' warning':'');
 }catch(e){if(seq!==S.requestSeq)return;S.composition=null;renderPreview();$('downloadBtn').disabled=true;$('previewState').textContent='Kontrol gerekli';$('previewState').className='preview-badge warn';$('previewInfo').textContent=e.message;$('previewInfo').className='preview-info warning';}
}
function queuePreview(){refreshStats();clearTimeout(S.timer);S.timer=setTimeout(updatePreview,190)}
async function download(){if(!S.composition)return;let btn=$('downloadBtn');btn.disabled=true;btn.textContent='Word hazırlanıyor…';try{let resp=await api('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload())});let blob=await resp.blob();let url=URL.createObjectURL(blob);let a=document.createElement('a');a.href=url;a.download='Tanex_Etiketler_'+new Date().toISOString().slice(0,10)+'.docx';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2500);toast('Word çıktısı hazır. Baskıda gerçek boyut (%100) seç.')}catch(e){toast(e.message,true)}finally{btn.disabled=false;btn.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0-5-5m5 5 5-5M4 16v4h16v-4"/></svg> Word dosyasını indir'}}
function wire(){
 $('templateSelect').onchange=e=>chooseTemplate(e.target.value);$('templateInput').onchange=e=>uploadTemplate(e.target.files[0]);$('excelInput').onchange=e=>uploadExcel(e.target.files[0]);$('sheetSelect').onchange=e=>chooseSheet(Number(e.target.value));
 let dz=$('dropzone');for(let evt of ['dragover','dragenter'])dz.addEventListener(evt,e=>{e.preventDefault();dz.classList.add('dragover')});for(let evt of ['dragleave','drop'])dz.addEventListener(evt,e=>{e.preventDefault();dz.classList.remove('dragover')});dz.addEventListener('drop',e=>{let f=e.dataTransfer.files[0];if(f)uploadExcel(f)});
 $('clearFields').onclick=()=>{S.fields=[];renderFields();queuePreview()};$('rowSearch').oninput=()=>{S.page=0;renderRows()};$('prevPage').onclick=()=>{S.page--;renderRows()};$('nextPage').onclick=()=>{S.page++;renderRows()};
 $('selectAll').onclick=()=>{let matching=filteredRows();for(let r of matching){S.selected.add(r.id);if(!S.qty[r.id])S.qty[r.id]=Number($('defaultQty').value)||1}renderRows();queuePreview()};
 $('selectNone').onclick=()=>{S.selected.clear();renderRows();queuePreview()};
 for(let id of ['startLabel','showNames','fieldBlankLine','fontSize','minFont','padding','fontFamily','align','vertical','bold'])$(id).addEventListener('input',()=>{if(id==='startLabel')S.previewPage=0;queuePreview()});
 $('autoFont').onchange=e=>{$('fontSize').disabled=e.target.checked;$('fontSizeLabel').textContent=e.target.checked?'Punto (otomatik)':'Punto (el ile)';queuePreview()};
 $('defaultQty').oninput=()=>{};
 $('previewPrev').onclick=()=>{S.previewPage=Math.max(0,S.previewPage-1);renderPreview()};$('previewNext').onclick=()=>{S.previewPage=Math.min((S.composition?.pageCount||1)-1,S.previewPage+1);renderPreview()};
 $('downloadBtn').onclick=download;
 $('closeEdit').onclick=closeEdit;$('cancelEdit').onclick=closeEdit;$('saveEdit').onclick=closeEdit;
 $('editModal').onclick=e=>{if(e.target===$('editModal'))closeEdit()};
 $('aboutBtn').onclick=()=>$('aboutModal').hidden=false;$('closeAbout').onclick=()=>$('aboutModal').hidden=true;$('aboutModal').onclick=e=>{if(e.target===$('aboutModal'))$('aboutModal').hidden=true};
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('editModal').hidden)closeEdit();$('aboutModal').hidden=true}});
 window.addEventListener('resize',()=>renderPreview());
}
wire();refreshTemplates().catch(e=>toast('Şablon listesi yüklenemedi: '+e.message,true));
