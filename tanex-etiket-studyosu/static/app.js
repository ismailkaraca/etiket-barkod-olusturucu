'use strict';
const $=id=>document.getElementById(id);
const S={templates:[],template:null,sheets:[],sheet:null,fields:[],selected:new Set(),qty:{},page:0,previewPage:0,editRow:null,composition:null,requestSeq:0,timer:null,customTemplates:{},templateData:null,fieldOptions:{},sortBy:"original",sortDir:"asc",mode:"standard",shippingMap:{},shippingHidden:[],shippingOrder:["title","library","address","town","person","phone","count","package"],extraFields:[],groupField:"",groupNewPage:false,undo:[],currentFilename:"",demo:false};
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
function sortableNumber(value){
 const s=String(value??'').trim().replace(/\s/g,'');
 if(!s)return null;
 const cleaned=s.includes(',')?s.replace(/\./g,'').replace(',','.'):s;
 return /^[-+]?\d+(?:\.\d+)?$/.test(cleaned)?Number(cleaned):null;
}
const trCollator=new Intl.Collator('tr-TR',{numeric:true,sensitivity:'base'});
function sortedRows(){
 if(!S.sheet)return[];
 const rows=[...S.sheet.rows],key=S.sortBy,dir=S.sortDir==='desc'?-1:1;
 if(key==='original' && S.groupField==='')return dir===1?rows:rows.reverse();
 const val=(r)=>key==='quantity'?Number(S.qty[r.id]??$('defaultQty').value??1):key==='original'?r.id:r.values[Number(key.slice(4))]??'';
 rows.sort((a,b)=>{
   if(S.groupField!==''){const gi=Number(S.groupField);const g=trCollator.compare(String(a.values[gi]||''),String(b.values[gi]||''));if(g)return g;}
   const va=val(a),vb=val(b),emptyA=String(va).trim()==='',emptyB=String(vb).trim()==='';
   if(emptyA!==emptyB)return emptyA?1:-1;
   const numA=sortableNumber(va),numB=sortableNumber(vb);
   let cmp=numA!==null&&numB!==null?Math.sign(numA-numB):trCollator.compare(String(va),String(vb));
   return cmp?cmp*dir:a.id-b.id;
 });
 return rows;
}
function chosenRecords(){if(!S.sheet)return[];return sortedRows().filter(r=>S.selected.has(r.id)).map(r=>({...r,qty:Math.max(0,Number(S.qty[r.id]??$('defaultQty').value??1))}));}
function options(){return {mode:S.mode,shippingMap:S.shippingMap,shippingTitle:$('shippingTitle')?.value||'',shipmentPackage:$('shipmentPackage')?.value||'',shippingOrder:S.shippingOrder,shippingHidden:S.shippingHidden,extraFields:S.extraFields,groupField:S.groupField,groupNewPage:S.groupNewPage,offsetX:Number($('offsetX')?.value||0),offsetY:Number($('offsetY')?.value||0),fieldOptions:Object.fromEntries(S.fields.map(i=>[String(i),S.fieldOptions[i]||{}])),fieldBlankLine:$('fieldBlankLine').checked,manual:!$('autoFont').checked,fontSize:Number($('fontSize').value||16),minFontSize:Number($('minFont').value||6),maxFontSize:26,padding:Number($('padding').value||0),font:$('fontFamily').value,align:$('align').value,vertical:$('vertical').value,bold:$('bold').checked}}
function payload(){return {templateId:S.template?.id||'',templateData:S.templateData,headers:S.sheet?.columns||[],fields:S.fields,records:chosenRecords(),start:Number($('startLabel').value||0),options:options()}}
function renderTemplateOptions(){
 const term=String($('templateSearch')?.value||'').trim().toLocaleLowerCase('tr-TR').replace(/[,×\s]/g,'');
 const filtered=S.templates.filter(t=>!term || [t.id,t.name,t.measurement||'',t.category||''].join(' ').toLocaleLowerCase('tr-TR').replace(/[,×\s]/g,'').includes(term) || t.id===S.template?.id);
 $('templateSelect').innerHTML=filtered.map(t=>`<option value="${esc(t.id)}">${t.id===S.defaultTemplateId?'★ Varsayılan · ':''}${esc(t.name.replace(/\.docx$/i,''))}</option>`).join('');
 if(S.template)$('templateSelect').value=S.template.id;
 $('templateCount').textContent=`${S.templates.length} kullanılabilir şablon · ${filtered.length} sonuç${S.catalogStats?.unsupportedCount?' · '+S.catalogStats.unsupportedCount+' farklı düzen arşivde (otomatik baskı desteklenmiyor)':''}`;
}
async function refreshTemplates(chosen){const resp=await (await api('/api/templates')).json();let stored=[];try{stored=await storedTemplates()}catch(e){toast('Tarayıcı depolaması açılamadı: '+e.message,true)}S.customTemplates=Object.fromEntries(stored.map(x=>[x.id,x]));S.templates=[...resp.templates,...stored.map(x=>x.info)];
 S.defaultTemplateId=resp.defaultTemplateId;S.catalogStats=resp.catalogStats;
 S.template=S.templates.find(t=>t.id===chosen)||S.templates.find(t=>t.id===resp.defaultTemplateId)||S.templates[0]||null;
 renderTemplateOptions();if(S.template)chooseTemplate(S.template.id);
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
async function uploadExcel(file){if(!file)return;let form=new FormData();form.append('file',file);$('excelStatus').textContent='Excel okunuyor…';try{let j=await (await api('/api/excel',{method:'POST',body:form})).json();S.sheets=j.sheets;S.sheet=S.sheets[0];S.currentFilename=file.name;S.demo=false;$('sheetSelect').innerHTML=S.sheets.map((sh,i)=>`<option value="${i}">${esc(sh.name)} (${sh.count})</option>`).join('');$('sheetWrap').hidden=false;$('excelStatus').textContent=`✓ ${file.name}`;chooseSheet(0);toast('Excel verileri aktarıldı.')}catch(e){$('excelStatus').textContent='Excel yükleme başarısız';toast(e.message,true)}finally{$('excelInput').value=''}}
function chooseSheet(index){S.sheet=S.sheets[index];if(!S.sheet)return;S.selected=new Set();S.qty={};S.page=0;S.previewPage=0;S.undo=[];S.sortBy='original';S.sortDir='asc';S.fieldOptions={};
 const headers=S.sheet.columns;let idxs=headers.map((h,i)=>({i,h:h.toLocaleLowerCase('tr-TR')}));
 let name=idxs.find(x=>/kütüphane adı|ad soyad|kitap adı|ürün adı/.test(x.h));let addr=idxs.find(x=>/adres/.test(x.h));
 S.fields=[...(name?[name.i]:[0]),...(addr&&(!name||addr.i!==name.i)?[addr.i]:[])];
 headers.forEach((label,i)=>S.fieldOptions[i]={label,showHeading:false,boldHeading:false,boldValue:false,scale:1,align:'center',beforeMM:0,indentMM:0,color:'#192b3c',omitBlank:true});
 $('sortField').innerHTML='<option value="original">Excel satır sırası</option><option value="quantity">Etiket adedi</option>'+headers.map((label,i)=>`<option value="col:${i}">${esc(label)}</option>`).join('');
 $('sortField').value='original';$('sortDirection').value='asc';
 if(S.sheet.rows[0]){S.selected.add(S.sheet.rows[0].id);S.qty[S.sheet.rows[0].id]=Number($('defaultQty').value)||1}
 $('rowSearch').value='';$('columnsEmpty').hidden=true;$('columnsWrap').hidden=false;$('dataEmpty').hidden=true;$('dataTableWrap').hidden=false;
 initAdvanced();renderFields();renderRows();queuePreview();
}
function renderFields(){if(!S.sheet)return;let head=S.sheet.columns;
 let indices=[...S.fields,...head.map((_,i)=>i).filter(i=>!S.fields.includes(i))];
 $('fieldCount').textContent=S.fields.length+' sütun seçildi';
 $('fieldList').innerHTML=indices.map(idx=>{const active=S.fields.includes(idx),opt=S.fieldOptions[idx]||{label:head[idx],showHeading:false,boldHeading:false};
 return `<div class="field-entry ${active?'selected-field':''}"><div class="field-entry-main"><label title="${esc(head[idx])}"><input type="checkbox" data-field="${idx}" ${active?'checked':''}/><span class="field-name">${esc(head[idx])}</span></label>${active?`<div class="order-buttons"><button data-shift="${idx}" data-step="-1" ${S.fields.indexOf(idx)===0?'disabled':''} title="Yukarı taşı">↑</button><button data-shift="${idx}" data-step="1" ${S.fields.indexOf(idx)===S.fields.length-1?'disabled':''} title="Aşağı taşı">↓</button></div>`:''}</div>${active?`<div class="field-config"><label class="field-edit-label" for="display-${idx}">Yazdırılacak başlık (değiştirilebilir)</label><input type="text" id="display-${idx}" data-title="${idx}" value="${esc(opt.label)}" maxlength="160" aria-label="${esc(head[idx])} yazdırma başlığı"/><div class="field-switches"><label><input type="checkbox" data-head="${idx}" ${opt.showHeading?'checked':''}/> Başlığı yazdır</label><label><input type="checkbox" data-head-bold="${idx}" ${opt.boldHeading?'checked':''}/> Başlık kalın</label></div></div>`:''}</div>`}).join('');
 $('fieldList').querySelectorAll('[data-field]').forEach(e=>e.addEventListener('change',()=>{let idx=Number(e.dataset.field);S.fields=e.checked?[...S.fields,idx]:S.fields.filter(x=>x!==idx);renderFields();queuePreview()}));
 $('fieldList').querySelectorAll('button[data-shift]').forEach(b=>b.onclick=()=>{let i=S.fields.indexOf(Number(b.dataset.shift)),j=i+Number(b.dataset.step);[S.fields[i],S.fields[j]]=[S.fields[j],S.fields[i]];renderFields();queuePreview()});
 $('fieldList').querySelectorAll('[data-title]').forEach(x=>x.addEventListener('input',()=>{S.fieldOptions[Number(x.dataset.title)].label=x.value;queuePreview()}));
 $('fieldList').querySelectorAll('[data-head]').forEach(x=>x.addEventListener('change',()=>{S.fieldOptions[Number(x.dataset.head)].showHeading=x.checked;queuePreview()}));
 $('fieldList').querySelectorAll('[data-head-bold]').forEach(x=>x.addEventListener('change',()=>{S.fieldOptions[Number(x.dataset.headBold)].boldHeading=x.checked;queuePreview()}));
 renderDesigner();
}
function filteredRows(){let q=$('rowSearch').value.trim().toLocaleLowerCase('tr-TR');return sortedRows().filter(r=>!q||r.values.some(v=>String(v).toLocaleLowerCase('tr-TR').includes(q)))}
function renderRows(){if(!S.sheet)return;let items=filteredRows();let pages=Math.max(1,Math.ceil(items.length/25));S.page=Math.max(0,Math.min(S.page,pages-1));let entries=items.slice(S.page*25,(S.page+1)*25);
 const heads=S.sheet.columns;let important=heads.findIndex(h=>/kütüphane adı|ad soyad|kitap adı/i.test(h));if(important<0)important=0;
 $('dataRows').innerHTML=entries.map(r=>{let fields=r.values.filter((v,i)=>i!==important && v).slice(0,2).join(' · ');let select=S.selected.has(r.id);
 return `<tr class="${select?'active':''}"><td><input aria-label="${r.id}. kaydı seç" type="checkbox" data-select="${r.id}" ${select?'checked':''}/></td><td><span class="row-id">${r.id}</span></td><td><div class="row-primary" title="${esc(r.values[important])}">${esc(r.values[important]||'(Boş)')}</div><div class="row-secondary" title="${esc(fields)}">${esc(fields)}</div></td><td><input class="qty" type="number" min="0" max="200" value="${S.qty[r.id]??$('defaultQty').value}" data-qty="${r.id}" aria-label="Etiket adedi" /></td><td><button class="edit-btn" data-edit="${r.id}">Düzenle</button></td></tr>`}).join('');
 $('dataRows').querySelectorAll('[data-select]').forEach(x=>x.onchange=()=>{let id=Number(x.dataset.select);if(x.checked){S.selected.add(id);if(!S.qty[id])S.qty[id]=Number($('defaultQty').value)||1}else S.selected.delete(id);renderRows();queuePreview()});
 $('dataRows').querySelectorAll('[data-qty]').forEach(x=>x.oninput=()=>{let id=Number(x.dataset.qty);S.qty[id]=Math.min(200,Math.max(0,Number(x.value)||0));queuePreview()});
 $('dataRows').querySelectorAll('[data-qty]').forEach(x=>x.addEventListener('change',()=>{if(S.sortBy==='quantity'){S.page=0;renderRows()}}));
 $('dataRows').querySelectorAll('[data-edit]').forEach(x=>x.onclick=()=>openEdit(Number(x.dataset.edit)));
 $('tableRange').textContent=`${items.length?S.page*25+1:0}–${Math.min(items.length,(S.page+1)*25)} / ${items.length} kayıt`;
 $('sortSummary').textContent=`${items.length} kayıt · ${$('sortField').selectedOptions[0]?.textContent||'Excel sırası'} · ${S.sortDir==='asc'?'Artan ↑':'Azalan ↓'} (çıktı da bu sırada)`;
 $('pageText').textContent=`${S.page+1} / ${pages}`;$('prevPage').disabled=S.page===0;$('nextPage').disabled=S.page>=pages-1;refreshStats();
}
function refreshStats(){let records=chosenRecords();$('selectedCount').textContent=records.length;$('labelCount').textContent=records.reduce((sum,r)=>sum+r.qty,0)}
function openEdit(id){let row=S.sheet?.rows.find(r=>r.id===id);if(!row)return;S.editRow=row;pushUndo('row',id,[...row.values]);
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
 let lines=info?.richLines|| (info?.lines||[]).map(line=>({segments:[{text:line,bold:o.bold}],size:info?.size||16,align:o.align}));let font=(info?.size||16)*25.4/72*scale;
 let css=`left:${mmPercent(x,t.page.width)};top:${mmPercent(y,t.page.height)};width:${mmPercent(w,t.page.width)};height:${mmPercent(h,t.page.height)};padding:${padding}px;justify-content:${vertical};`;
 let content=label?`<div class="line-group" style="align-items:${align};width:100%;font-size:${font.toFixed(2)}px;font-family:'${esc(o.font)}',Arial,sans-serif;font-weight:400;text-align:${o.align}">${lines.map(line=>line.kind!=='text'?`<div class="line visual-code" ${line.fieldIndex!=null?`data-preview-field="${line.fieldIndex}" draggable="true"`:line.role?`data-preview-role="${esc(line.role)}" draggable="true"`:''} style="margin-top:${(line.beforeMM||0)*scale}px">${line.imageData?`<img style="width:${line.imageW*scale}px;height:${line.imageH*scale}px" src="data:image/png;base64,${line.imageData}"/>`:'[Kod oluşturulamadı]'}</div>`:`<div class="line" ${line.fieldIndex!=null?`data-preview-field="${line.fieldIndex}" draggable="true"`:line.role?`data-preview-role="${esc(line.role)}" draggable="true"`:''} style="text-align:${esc(line.align||o.align)};margin-top:${(line.beforeMM||0)*scale}px;font-size:${(line.size||info?.size||16)*25.4/72*scale}px;padding-left:${(line.indentMM||0)*scale}px">${(line.segments||[]).map(seg=>`<span style="font-weight:${seg.bold?'700':'400'};color:${esc(seg.color||'#192b3c')}">${esc(seg.text)}</span>`).join('')||'&nbsp;'}</div>`).join('')}</div>`:'';
 return `<div class="print-label ${label?'filled':''} ${info?.overflow?'warn':''}" style="${css}"><span class="label-number">${i+1}</span>${content}</div>`}).join('');
 let dragged=null;const slots=$('pageGrid').querySelectorAll('[data-preview-field],[data-preview-role]');
 slots.forEach(el=>{
  el.ondragstart=()=>dragged={field:el.dataset.previewField,role:el.dataset.previewRole};
  el.ondragover=e=>e.preventDefault();
  el.ondrop=e=>{e.preventDefault();if(!dragged)return;
   if(S.mode==='shipping'&&dragged.role&&el.dataset.previewRole){const src=dragged.role,dest=el.dataset.previewRole;if(src===dest)return;S.shippingOrder=S.shippingOrder.filter(r=>r!==src);S.shippingOrder.splice(S.shippingOrder.indexOf(dest),0,src);renderShipping();queuePreview();}
   else if(S.mode!=='shipping'&&dragged.field!=null&&el.dataset.previewField!=null){let src=Number(dragged.field),dest=Number(el.dataset.previewField);if(src===dest)return;pushUndo('fields',null,[...S.fields]);S.fields=S.fields.filter(f=>f!==src);S.fields.splice(S.fields.indexOf(dest),0,src);renderFields();queuePreview();}
  }
 });
 $('previewPage').textContent=`Sayfa ${S.previewPage+1} / ${comp?.pageCount||1}`;$('previewPrev').disabled=S.previewPage===0;$('previewNext').disabled=S.previewPage>=(comp?.pageCount||1)-1;
}
async function updatePreview(){refreshStats();let req=payload(),seq=++S.requestSeq;
 if(!S.template||!S.sheet||(!req.fields.length&&S.mode!=='shipping'&&!S.extraFields.length)||!req.records.length){S.composition=null;S.previewPage=0;renderPreview();$('previewInfo').textContent='Etiket oluşturmak için en az bir Excel kaydı ve bir sütun seç.';$('previewInfo').className='preview-info';$('downloadBtn').disabled=true;$('previewState').textContent='Bekliyor';return;}
 $('previewState').textContent='Hesaplanıyor…';try{let composition=await send('/api/preview',req);if(seq!==S.requestSeq)return;S.composition=composition;S.previewPage=Math.min(S.previewPage,composition.pageCount-1);renderPreview();$('downloadBtn').disabled=false;
 $('previewState').textContent=composition.overflowCount?'Taşma uyarısı':'Güncel';$('previewState').className='preview-badge'+(composition.overflowCount?' warn':'');
 $('previewInfo').textContent=composition.overflowCount?`${composition.total} etiket · ${composition.pageCount} sayfa · ${composition.overflowCount} etikette minimum puntoyla bile taşma olasılığı var. Alanı azalt veya şablonu değiştir.`:`${composition.total} etiket · ${composition.pageCount} sayfa. Özgün Word etiket yerleşimiyle çıktı hazırlanacak.`;
 $('previewInfo').className='preview-info'+(composition.overflowCount?' warning':'');
 }catch(e){if(seq!==S.requestSeq)return;S.composition=null;renderPreview();$('downloadBtn').disabled=true;$('previewState').textContent='Kontrol gerekli';$('previewState').className='preview-badge warn';$('previewInfo').textContent=e.message;$('previewInfo').className='preview-info warning';}
}
function queuePreview(){refreshStats();clearTimeout(S.timer);S.timer=setTimeout(updatePreview,190)}
async function download(){if(!S.composition)return;let btn=$('downloadBtn');btn.disabled=true;btn.textContent='Word hazırlanıyor…';try{let resp=await api('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload())});let blob=await resp.blob();let url=URL.createObjectURL(blob);let a=document.createElement('a');a.href=url;a.download='Tanex_Etiketler_'+new Date().toISOString().slice(0,10)+'.docx';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2500);toast('Word çıktısı hazır. Baskıda gerçek boyut (%100) seç.')}catch(e){toast(e.message,true)}finally{btn.disabled=false;btn.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0-5-5m5 5 5-5M4 16v4h16v-4"/></svg> Word dosyasını indir'}}
function wire(){
 $('templateSelect').onchange=e=>chooseTemplate(e.target.value);$('templateSearch').oninput=renderTemplateOptions;$('templateInput').onchange=e=>uploadTemplate(e.target.files[0]);$('excelInput').onchange=e=>uploadExcel(e.target.files[0]);$('sheetSelect').onchange=e=>chooseSheet(Number(e.target.value));
 let dz=$('dropzone');for(let evt of ['dragover','dragenter'])dz.addEventListener(evt,e=>{e.preventDefault();dz.classList.add('dragover')});for(let evt of ['dragleave','drop'])dz.addEventListener(evt,e=>{e.preventDefault();dz.classList.remove('dragover')});dz.addEventListener('drop',e=>{let f=e.dataTransfer.files[0];if(f)uploadExcel(f)});
 $('clearFields').onclick=()=>{S.fields=[];renderFields();queuePreview()};
 $('showAllHeadings').onclick=()=>{S.fields.forEach(i=>S.fieldOptions[i].showHeading=true);renderFields();queuePreview()};
 $('hideAllHeadings').onclick=()=>{S.fields.forEach(i=>S.fieldOptions[i].showHeading=false);renderFields();queuePreview()};
 $('sortField').onchange=e=>{S.sortBy=e.target.value;S.page=0;renderRows();queuePreview()};
 $('sortDirection').onchange=e=>{S.sortDir=e.target.value;S.page=0;renderRows();queuePreview()};$('rowSearch').oninput=()=>{S.page=0;renderRows()};$('prevPage').onclick=()=>{S.page--;renderRows()};$('nextPage').onclick=()=>{S.page++;renderRows()};
 $('selectAll').onclick=()=>{let matching=filteredRows();for(let r of matching){S.selected.add(r.id);if(!S.qty[r.id])S.qty[r.id]=Number($('defaultQty').value)||1}renderRows();queuePreview()};
 $('selectNone').onclick=()=>{S.selected.clear();renderRows();queuePreview()};
 for(let id of ['startLabel','fieldBlankLine','fontSize','minFont','padding','fontFamily','align','vertical','bold'])$(id).addEventListener('input',()=>{if(id==='startLabel')S.previewPage=0;queuePreview()});
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

// ===== Professional workflows =====
function pushUndo(type,id,prior){
 S.undo.push({type,id,prior});if(S.undo.length>30)S.undo.shift();
 const button=$('undoBtn');if(button)button.disabled=false;
}
function undoLast(){const action=S.undo.pop();if(!action)return;
 if(action.type==='row'){let row=S.sheet?.rows.find(r=>r.id===action.id);if(row)row.values=action.prior;}
 if(action.type==='fields'){S.fields=[...action.prior];renderFields();}
 $('undoBtn').disabled=S.undo.length===0;renderRows();queuePreview();toast('Son değişiklik geri alındı.');
}
const shippingSpecs=[['library','Kütüphane Adı',/kütüphane|kurum adı/i],['address','Açık Adres',/adres/i],['district','İlçe',/ilçe/i],['city','İl',/^il$|^il adı$|^şehir$|^il\s*bilgisi/i],['person','Teslim Alacak',/teslim alacak|yetkili personel|alıcı/i],['phone','Telefon',/cep telefon|telefon|gsm/i],['count','Etiket Adedi',/etiket.{0,25}(adet|miktar|sayı)|talep edilen.{0,20}etiket/i],['package','Paket Numarası',/paket|koli/i]];
function autoMapShipping(force=false){if(!S.sheet)return;let headers=S.sheet.columns;
 for(const [key,,re] of shippingSpecs){if(!force&&S.shippingMap[key]!=null)continue;let found=headers.findIndex(h=>re.test(h));S.shippingMap[key]=found>=0?String(found):'';}
 renderShipping();queuePreview();
}
function initAdvanced(){
 if(!S.sheet)return;
 autoMapShipping(true);
 for(const id of ['groupField','newCodeField']){$(id).innerHTML='<option value="">'+(id==='groupField'?'Gruplama yok':'Sütun seçin')+'</option>'+S.sheet.columns.map((h,i)=>`<option value="${i}">${esc(h)}</option>`).join('');}
 S.groupField='';$('groupField').value='';$('groupNewPage').checked=false;S.extraFields=[];renderExtras();renderDesigner();
}
function renderShipping(){
 if(!S.sheet)return;
 $('shippingFields').innerHTML=shippingSpecs.map(([key,label])=>`<label class="ship-map"><span>${esc(label)}</span><select data-shipping="${key}"><option value="">— Yazdırma / eşleştirme yok —</option>${S.sheet.columns.map((h,i)=>`<option value="${i}" ${String(S.shippingMap[key])===String(i)?'selected':''}>${esc(h)}</option>`).join('')}</select></label>`).join('');
 $('shippingFields').querySelectorAll('[data-shipping]').forEach(el=>el.onchange=()=>{S.shippingMap[el.dataset.shipping]=el.value;queuePreview()});
 $('shipElements').innerHTML=S.shippingOrder.map((key,i)=>{let o={title:'Üst başlık',library:'Kütüphane',address:'Adres',town:'İlçe / İl',person:'Teslim alacak',phone:'Telefon',count:'Etiket adedi',package:'Paket no'}[key];return `<div class="ship-order" draggable="true" data-ship-drag="${key}"><span class="drag-handle">⠿</span><label><input type="checkbox" data-ship-visible="${key}" ${S.shippingHidden.includes(key)?'':'checked'}/> ${o}</label></div>`}).join('');
 $('shipElements').querySelectorAll('[data-ship-visible]').forEach(el=>el.onchange=()=>{const k=el.dataset.shipVisible;S.shippingHidden=el.checked?S.shippingHidden.filter(x=>x!==k):[...new Set([...S.shippingHidden,k])];queuePreview()});
 let dragged=null;$('shipElements').querySelectorAll('[data-ship-drag]').forEach(el=>{el.ondragstart=()=>dragged=el.dataset.shipDrag;el.ondragover=e=>e.preventDefault();el.ondrop=e=>{e.preventDefault();let target=el.dataset.shipDrag;if(!dragged||target===dragged)return;S.shippingOrder=S.shippingOrder.filter(x=>x!==dragged);S.shippingOrder.splice(S.shippingOrder.indexOf(target),0,dragged);renderShipping();queuePreview()}})
}
function showMode(){let shipping=S.mode==='shipping';$('shippingBox').hidden=!shipping;$('standardFields').hidden=shipping;$('modeStandard').classList.toggle('active',!shipping);$('modeShipping').classList.toggle('active',shipping);$('modeInfo').textContent=shipping?'Gönderi etiketi alanlarını eşleştirin. Büyük etiket (ör. TW-2408) önerilir.':'Seçili Excel sütunlarını etiket üzerine yazdırın.';queuePreview()}
function shippingDemo(){
 S.demo=true;S.currentFilename='ÖRNEK VERİ — gerçek gönderide kontrol edin';
 S.sheets=[{name:'Örnek gönderi etiketleri',count:2,columns:['Kütüphane Adı','Açık Adres','İlçe','İl','Teslim Alacak Personel','Cep Telefonu','RFID Etiket Adedi','Paket Numarası'],rows:[
 {id:2,values:['ÖRNEK HALK KÜTÜPHANESİ','Örnek Mahallesi, 1. Sokak, No: 10','Sincan','Ankara','Örnek Personel','05XX XXX XX XX','2.000','1/2']},
 {id:3,values:['ÖRNEK ÇOCUK KÜTÜPHANESİ','Örnek Caddesi, No: 25','Çankaya','Ankara','Örnek Yetkili','05XX XXX XX XX','1.000','2/2']}
 ]}];
 $('sheetSelect').innerHTML='<option value="0">Örnek gönderi etiketleri (2)</option>';$('sheetWrap').hidden=false;$('excelStatus').textContent='Örnek veriler kullanılıyor; gerçek gönderide değiştirin.';
 chooseSheet(0);S.selected=new Set([2,3]);S.qty={2:1,3:1};S.mode='shipping';$('modeShipping').classList.add('active');
 let t=S.templates.find(t=>t.id.startsWith('TW-2408_'))||S.templates.find(t=>t.cells?.[0]?.width>=95&&t.cells?.[0]?.height>=60);
 if(t)chooseTemplate(t.id);showMode();renderRows();queuePreview();toast('Örnek gönderi etiketi hazır. Bilgiler temsili!');
}
function renderDesigner(){
 if(!S.sheet)return;
 $('designerFields').innerHTML=S.fields.map((col,i)=>{let x=S.fieldOptions[col]||{};return `<div class="designer-field" draggable="true" data-drag-field="${col}"><div class="designer-field-head"><strong>⠿ ${esc(x.label||S.sheet.columns[col])}</strong><span class="helper">${i+1}. satır</span></div><div class="designer-controls"><label>Yazı %<input type="number" min="45" max="200" step="5" data-field-prop="${col}:scale" value="${Math.round((x.scale||1)*100)}"/></label><label>Hizalama<select data-field-prop="${col}:align"><option value="left" ${x.align==='left'?'selected':''}>Sol</option><option value="center" ${x.align==='center'?'selected':''}>Orta</option><option value="right" ${x.align==='right'?'selected':''}>Sağ</option></select></label><label>Üst boşluk mm<input type="number" step="0.5" min="0" max="15" data-field-prop="${col}:beforeMM" value="${x.beforeMM||0}"/></label><label>Metin rengi<input type="color" data-field-prop="${col}:color" value="${esc(x.color||'#192b3c')}"/></label><label>Sol girinti (mm)<input type="number" min="0" max="10" step="0.5" data-field-prop="${col}:indentMM" value="${x.indentMM||0}"/></label><label>İçerik kalın<input type="checkbox" data-field-prop="${col}:boldValue" ${x.boldValue?'checked':''}/></label><label>Boşsa gizle<input type="checkbox" data-field-prop="${col}:omitBlank" ${x.omitBlank!==false?'checked':''}/></label></div></div>`}).join('')||'<p class="helper">Önce yazdırılacak sütunları seçin.</p>';
 $('designerFields').querySelectorAll('[data-field-prop]').forEach(el=>el.oninput=()=>{let [index,prop]=el.dataset.fieldProp.split(':');let x=S.fieldOptions[Number(index)];x[prop]=el.type==='checkbox'?el.checked:prop==='scale'?Math.max(.45,Math.min(2,Number(el.value||100)/100)):['beforeMM','indentMM'].includes(prop)?Number(el.value||0):el.value;queuePreview()});
 let dragged=null;$('designerFields').querySelectorAll('[data-drag-field]').forEach(el=>{el.ondragstart=()=>dragged=Number(el.dataset.dragField);el.ondragover=e=>e.preventDefault();el.ondrop=e=>{e.preventDefault();let target=Number(el.dataset.dragField);if(dragged===null||target===dragged)return;pushUndo('fields',null,[...S.fields]);S.fields=S.fields.filter(x=>x!==dragged);S.fields.splice(S.fields.indexOf(target),0,dragged);renderFields();queuePreview()}});
}
function renderExtras(){
 $('extraFields').innerHTML=S.extraFields.map((field,index)=>`<div class="designer-field"><div class="designer-field-head"><strong>Ek alan ${index+1}</strong><button class="soft-btn" data-extra-delete="${index}">Sil</button></div><div class="designer-controls"><label>Tür<select data-extra-kind="${index}"><option value="text" ${field.kind==='text'?'selected':''}>Metin</option><option value="qr" ${field.kind==='qr'?'selected':''}>QR kod</option><option value="code128" ${field.kind==='code128'?'selected':''}>Code128 barkod</option></select></label><label>Başlık<input type="text" data-extra-label="${index}" value="${esc(field.label||'')}"/></label></div><label class="helper">İçerik/şablon: <input type="text" data-extra-formula="${index}" value="${esc(field.formula||'')}" placeholder="{İlçe} / {İl} veya {Barkod}"/></label></div>`).join('');
 $('extraFields').querySelectorAll('[data-extra-kind]').forEach(e=>e.onchange=()=>{S.extraFields[Number(e.dataset.extraKind)].kind=e.value;queuePreview()});
 $('extraFields').querySelectorAll('[data-extra-label]').forEach(e=>e.oninput=()=>{S.extraFields[Number(e.dataset.extraLabel)].label=e.value;queuePreview()});
 $('extraFields').querySelectorAll('[data-extra-formula]').forEach(e=>e.oninput=()=>{S.extraFields[Number(e.dataset.extraFormula)].formula=e.value;queuePreview()});
 $('extraFields').querySelectorAll('[data-extra-delete]').forEach(e=>e.onclick=()=>{S.extraFields.splice(Number(e.dataset.extraDelete),1);renderExtras();queuePreview()});
}
function profileData(){return {version:2,templateId:S.template?.id,headers:S.sheet?.columns||[],fields:S.fields,fieldOptions:S.fieldOptions,mode:S.mode,shippingMap:S.shippingMap,shippingHidden:S.shippingHidden,shippingOrder:S.shippingOrder,shippingTitle:$('shippingTitle').value,shipmentPackage:$('shipmentPackage').value,extraFields:S.extraFields,groupField:S.groupField,groupNewPage:S.groupNewPage,calibration:{x:$('offsetX').value,y:$('offsetY').value},font:{auto:$('autoFont').checked,size:$('fontSize').value,padding:$('padding').value,align:$('align').value,vertical:$('vertical').value,bold:$('bold').checked}}}
function saveProfile(){let name=prompt('Bu tasarımı hangi adla kaydedelim?','Kütüphane gönderi etiketi');if(!name)return;
 const all=JSON.parse(localStorage.getItem('tanex-design-profiles')||'{}');all[name.trim().slice(0,80)]=profileData();localStorage.setItem('tanex-design-profiles',JSON.stringify(all));fillProfiles();$('profileSelect').value=name.trim().slice(0,80);toast('Tasarım bu tarayıcıda kaydedildi.');}
function fillProfiles(){$('profileSelect').innerHTML='<option value="">Kayıtlı tasarım seçin…</option>'+Object.keys(JSON.parse(localStorage.getItem('tanex-design-profiles')||'{}')).map(k=>`<option value="${esc(k)}">${esc(k)}</option>`).join('')}
function loadProfile(){const key=$('profileSelect').value;if(!key||!S.sheet)return;let p=JSON.parse(localStorage.getItem('tanex-design-profiles')||'{}')[key];if(!p)return;
 let mapping={};p.headers.forEach((h,i)=>{const idx=S.sheet.columns.indexOf(h);if(idx>=0)mapping[i]=idx});
 S.fields=p.fields.map(i=>mapping[i]).filter(i=>i!==undefined);S.fieldOptions={};for(let i=0;i<S.sheet.columns.length;i++)S.fieldOptions[i]={label:S.sheet.columns[i],scale:1};
 for(const [key,val] of Object.entries(p.fieldOptions||{})){if(mapping[key]!==undefined)S.fieldOptions[mapping[key]]=structuredClone(val)}
 S.mode=p.mode||'standard';S.shippingMap=Object.fromEntries(Object.entries(p.shippingMap||{}).map(([k,v])=>[k,v!==''&&mapping[v]!==undefined?String(mapping[v]):'']));
 S.shippingHidden=p.shippingHidden||[];S.shippingOrder=p.shippingOrder||S.shippingOrder;
 S.extraFields=p.extraFields||[];S.groupField=p.groupField!==''&&mapping[p.groupField]!==undefined?String(mapping[p.groupField]):'';S.groupNewPage=!!p.groupNewPage;
 $('groupField').value=S.groupField;$('groupNewPage').checked=S.groupNewPage;
 $('shippingTitle').value=p.shippingTitle||'';$('shipmentPackage').value=p.shipmentPackage||'';
 $('offsetX').value=p.calibration?.x||0;$('offsetY').value=p.calibration?.y||0;
 $('autoFont').checked=p.font?.auto!==false;$('fontSize').disabled=$('autoFont').checked;$('fontSize').value=p.font?.size||16;$('padding').value=p.font?.padding??3;
 $('align').value=p.font?.align||'center';$('vertical').value=p.font?.vertical||'center';$('bold').checked=!!p.font?.bold;
 if(p.templateId&&S.templates.some(t=>t.id===p.templateId))chooseTemplate(p.templateId);
 renderShipping();renderExtras();renderFields();renderRows();showMode();queuePreview();toast('Tasarım yüklendi; sütunlar Excel başlıklarıyla eşleştirildi.');}
async function exportFormat(route,fileName){if(!S.sheet)return toast('Önce Excel yükleyin.',true);const b=$('downloadBtn');
 try{let resp=await api(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload())});let blob=await resp.blob();saveBlob(blob,fileName);toast('Dosya indirildi. Yazdırırken %100 gerçek boyut seçin.');}catch(e){toast(e.message,true)}}
function saveBlob(blob,filename){let url=URL.createObjectURL(blob);let a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000)}
async function exportEditedExcel(){if(!S.sheet)return toast('Excel verisi yok.',true);
 let p={headers:S.sheet.columns,records:sortedRows()};try{let resp=await api('/api/export-excel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});saveBlob(await resp.blob(),'Tanex_Duzenlenmis_Veriler.xlsx');toast('Düzenlenen Excel indirildi.')}catch(e){toast(e.message,true)}}
async function checkData(){if(!S.sheet)return toast('Excel verisi yok.',true);
 try{let p=payload();p.records=sortedRows().map(r=>({...r,qty:Number((S.qty[r.id]??$('defaultQty').value)||1)}));let check=await send('/api/check',p);
 $('checkSummary').textContent=`${check.checked} kayıt kontrol edildi · ${check.issues.length} kayıt için uyarı`;
 $('checkResults').innerHTML=check.issues.slice(0,160).map(x=>`<div class="check-line"><strong>${x.id}. satır</strong><span>${esc(x.issues.join(' · '))}</span><button class="mini-link" data-exclude="${x.id}">Baskı dışı</button></div>`).join('')||'<p class="helper">Kontrol edilen kayıtlarda uyarı bulunmadı.</p>';
 $('checkResults').querySelectorAll('[data-exclude]').forEach(b=>b.onclick=()=>{S.selected.delete(Number(b.dataset.exclude));b.disabled=true;b.textContent='Çıkarıldı';renderRows();queuePreview()});$('checkModal').hidden=false;
 }catch(e){toast(e.message,true)}}
function enableAdvanced(){
 $('modeStandard').onclick=()=>{S.mode='standard';showMode()};$('modeShipping').onclick=()=>{S.mode='shipping';showMode()};$('shippingDemo').onclick=shippingDemo;
 $('shippingTitle').oninput=queuePreview;$('shipmentPackage').oninput=queuePreview;$('autoShipping').onclick=()=>autoMapShipping(true);
 $('addExtra').onclick=()=>{if(S.extraFields.length>=12)return toast('En fazla 12 ek alan.',true);S.extraFields.push({kind:'text',label:'',formula:'',scale:1,align:'center',enabled:true});renderExtras();queuePreview()};
 $('addCode').onclick=()=>{let col=$('newCodeField').value;if(!col)return toast('Önce barkod/QR için sütun seçin.',true);S.extraFields.push({kind:$('codeType').value,label:'',formula:'{'+S.sheet.columns[Number(col)]+'}',enabled:true,align:'center'});renderExtras();queuePreview()};
 $('groupField').onchange=e=>{S.groupField=e.target.value;S.page=0;renderRows();queuePreview()};$('groupNewPage').onchange=e=>{S.groupNewPage=e.target.checked;queuePreview()};
 for(const id of ['offsetX','offsetY'])$(id).oninput=queuePreview;
 $('saveProfile').onclick=saveProfile;$('loadProfile').onclick=loadProfile;$('deleteProfile').onclick=()=>{const k=$('profileSelect').value;if(!k)return;let o=JSON.parse(localStorage.getItem('tanex-design-profiles')||'{}');delete o[k];localStorage.setItem('tanex-design-profiles',JSON.stringify(o));fillProfiles();toast('Tasarım silindi.')};
 $('undoBtn').onclick=undoLast;$('pdfBtn').onclick=()=>exportFormat('/api/export-pdf','Tanex_Etiketler.pdf');$('exportExcelBtn').onclick=exportEditedExcel;
 $('dataCheckBtn').onclick=checkData;$('checkClose').onclick=()=>$('checkModal').hidden=true;$('checkModal').onclick=e=>{if(e.target===$('checkModal'))$('checkModal').hidden=true};
 $('calibrationTest').onclick=()=>{toast('Test sayfasındaki sınırları boş A4 ile %100 ölçekte kontrol edin.');exportFormat('/api/calibration','Tanex_Kalibrasyon.pdf')};
 fillProfiles();showMode();
}

wire();enableAdvanced();refreshTemplates().catch(e=>toast('Şablon listesi yüklenemedi: '+e.message,true));
