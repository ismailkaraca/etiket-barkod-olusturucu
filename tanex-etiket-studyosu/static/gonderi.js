'use strict';
const $=id=>document.getElementById(id), F=$('shipmentForm');
const required=['province','district','library','address','phone','material','total'];
const allFields=['province','district','library','address','phone','recipient','sender','material','total','unitsPerPack','packsPerBox','date','recipientTitle'];
const names={province:'İl',district:'İlçe',library:'Kütüphane adı',address:'Adres',phone:'Kütüphane telefonu',recipient:'Teslim alacak kişi',sender:'Teslim eden kişi',material:'Malzeme',total:'Toplam etiket',unitsPerPack:'Paket başına etiket',packsPerBox:'Koli başına paket',date:'Tarih',recipientTitle:'Unvan'};
const initial={material:'UHF RFID Kütüphane Etiketi (Şerit)',total:'',unitsPerPack:'1000',packsPerBox:'9'};
let records=[],editIndex=-1,sheets=[],sheet=null, previewUrl=null;
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function value(id){return ($(id)?.value||'').trim()}
function readForm(){const data={};F.querySelectorAll('[name]').forEach(el=>data[el.name]=el.value.trim());return data}
function writeForm(r){F.querySelectorAll('[name]').forEach(el=>{el.value=r[el.name]??initial[el.name]??''});compute();updateVisual()}
function emptyForm(){editIndex=-1;writeForm(initial);$('saveRecord').textContent='+ Gönderiyi listeye ekle';setStatus('Yeni kayıt formu açıldı.')}
function number(x){let n=Number(x);return Number.isInteger(n)&&n>0?n:null}
function calc(r){const total=number(r.total),per=number(r.unitsPerPack),box=number(r.packsPerBox);if(!total||!per||!box)return null;
 let packs=Math.ceil(total/per),boxes=Math.ceil(packs/box);
 const packOverride=number(r.packCountOverride),boxOverride=number(r.boxCountOverride);
 if(packOverride)packs=packOverride;
 if(boxOverride)boxes=boxOverride;
 if(packs*per<total)return {error:'Girilen paket sayısı toplam etiket için yeterli değil.'};
 if(packs>total)return {error:'Paket sayısı toplam etiket adedinden büyük olamaz.'};
 if(boxes*box<packs)return {error:'Girilen koli kapasitesi toplam paket sayısı için yeterli değil.'};
 if(boxes>packs)return {error:'Bir kolide en az bir paket olmalıdır; koli sayısını azaltın.'};
 let remainPacks=packs;const distribution=[];let packQuantities=[];
 if(packs===Math.ceil(total/per)){packQuantities=Array(packs-1).fill(per);packQuantities.push(total-per*(packs-1));}
 else{let q=Math.floor(total/packs),left=total%packs;packQuantities=Array.from({length:packs},(_,i)=>q+(i<left?1:0));}let pos=0;
 for(let i=0;i<boxes;i++){
  const n=Math.min(box,remainPacks-(boxes-i-1));const count=packQuantities.slice(pos,pos+n).reduce((a,b)=>a+b,0);
  distribution.push({box:i+1,packs:n,labels:count});pos+=n;remainPacks-=n;
 }
 if(pos!==packs||remainPacks)return {error:'Koli/paket dağıtımı tutarsız. Sayıları kontrol edin.'};
 return {total,packs,boxes,per,box,distribution};
}
function display(n){return Number(n||0).toLocaleString('tr-TR')}
function compute(){const r=readForm(),n=calc(r);const node=$('calcBox');
 if(!n){node.textContent='Toplam etiket ve paket/koli kapasitelerini yazın.'}
 else if(n.error){node.innerHTML='<b>Uyarı:</b> '+escapeHtml(n.error)}
 else node.innerHTML=`<strong>${display(n.total)} etiket → ${n.packs} paket / ${n.boxes} koli</strong><div>Bir pakette ${display(n.per)} etiket · Bir kolide en fazla ${n.box} paket</div><div>${n.distribution.map(x=>`${x.box}. koli: <b>${x.packs} paket / ${display(x.labels)} etiket</b>`).join(' &nbsp; | &nbsp; ')}</div>`;
}
function updateVisual(){const r=readForm(),n=calc(r);$('previewLibrary').textContent=r.library||'Kütüphane adı';$('previewLocation').textContent=(r.province||'İl')+' / '+(r.district||'İlçe');$('previewAddress').textContent=r.address||'Gönderi adresi';$('previewPhone').textContent=r.phone||'Kütüphane telefonu';$('previewQuantity').textContent=r.total?(display(r.total)+' ADET RFID ETİKETİ'):'ETİKET ADEDİ GİRİLMEDİ';$('previewBoxes').textContent=n&&!n.error?`${n.boxes} KOLİ · ${n.packs} PAKET`:'Koli/paket hesabı'}
function setStatus(message,error=false){$('result').textContent=message;$('result').classList.toggle('error',error)}
function checkedRows(){return records.filter(x=>x.checked).map(x=>({...x.data}));}
function getPayload(){const chosen=checkedRows();if(chosen.length)return chosen;
 const current=readForm();if(required.every(k=>current[k]))return [current];
 throw Error('Listeden en az bir gönderi seçin veya zorunlu alanları doldurun.');}
function validation(rows){for(let i=0;i<rows.length;i++){
 const r=rows[i];const missing=required.filter(k=>!String(r[k]||'').trim());
 if(missing.length)throw Error(`${i+1}. kayıtta zorunlu alanlar eksik: ${missing.map(k=>names[k]).join(', ')}`);
 const n=calc(r);if(!n||n.error)throw Error(`${i+1}. kayıt: ${n?.error||'Koli/paket bilgileri hatalı.'}`);
 if(String(r.library||'').length>250||String(r.address||'').length>700)throw Error('Kütüphane adı/adres alanı çok uzun.');
 }return rows;}
function formValid(){const r=readForm(),miss=required.filter(k=>!String(r[k]||'').trim());
 if(miss.length){setStatus('Zorunlu: '+miss.map(k=>names[k]).join(', '),true);$(miss[0]).focus();return false}
 const c=calc(r);if(!c||c.error){setStatus(c?.error||'Geçersiz koli/paket bilgileri.',true);return false}return true}
function saveRecord(){if(!formValid())return;const data=readForm();if(editIndex>=0)records[editIndex].data=data;else records.push({checked:true,data});
 const updated=editIndex>=0;editIndex=-1;renderRows();setStatus(updated?'Gönderi bilgileri güncellendi.':'Gönderi listeye eklendi.');$('saveRecord').textContent='+ Gönderiyi listeye ekle';}
function renderRows(){const box=$('recordList');if(!records.length){box.innerHTML='<div class="empty">Henüz kayıt yok. Üstteki formdan ekleyin veya Excel yükleyin.</div>';return}
 box.innerHTML=records.map((r,i)=>{const c=calc(r.data);return `<div class="listrow"><input type="checkbox" aria-label="${escapeHtml(r.data.library)} seç" data-check="${i}" ${r.checked?'checked':''}><div><div class="name">${i+1}. ${escapeHtml(r.data.library||'Eksik kütüphane adı')}</div><small>${escapeHtml(r.data.province||'-')} / ${escapeHtml(r.data.district||'-')} · ${display(r.data.total)} etiket · ${c?.error?'Kontrol gerekli':(c?c.boxes+' koli, '+c.packs+' paket':'Eksik miktar')}</small></div><div class="btnline"><button type="button" data-edit="${i}">Düzenle</button><button type="button" data-remove="${i}">Sil</button></div></div>`}).join('');
 box.querySelectorAll('[data-check]').forEach(el=>el.onchange=()=>{records[+el.dataset.check].checked=el.checked});
 box.querySelectorAll('[data-edit]').forEach(el=>el.onclick=()=>{editIndex=+el.dataset.edit;writeForm(records[editIndex].data);$('saveRecord').textContent='Değişiklikleri kaydet';window.scrollTo({top:0,behavior:'smooth'});setStatus('Düzenlenen kayıt: '+(editIndex+1));});
 box.querySelectorAll('[data-remove]').forEach(el=>el.onclick=()=>{records.splice(+el.dataset.remove,1);editIndex=-1;renderRows();setStatus('Kayıt silindi.')});}
async function jsonPost(endpoint,payload){let r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(!r.ok){let info=await r.json().catch(()=>({}));throw Error(info.detail||'Sunucu hatası: '+r.status)}return r}
function downloadBlob(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),20000)}
async function exportPDF(type,preview=false){let button=$(type==='shipping'?'downloadShipping':'downloadReceipt');button.disabled=true;
 try{
 const rows=validation(getPayload());const endpoint=type==='shipping'?'/api/gonderi/etiket-pdf':'/api/tutanak/pdf';
 setStatus('PDF hazırlanıyor…');const response=await jsonPost(endpoint,{records:rows,onePerBox:$('onePerBox').checked});const blob=await response.blob();
 if(preview){if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(blob);$('pdfFrame').src=previewUrl;$('previewDialog').showModal()}
 else downloadBlob(blob,type==='shipping'?'RFID_Gonderi_Etiketleri_A4_Yatay.pdf':'RFID_Etiket_Teslim_Tutanaklari.pdf');
 setStatus(`${rows.length} gönderi için ${type==='shipping'?'yatay A4 gönderi etiketi':'A4 tutanak'} ${preview?'önizlemesi':'PDF dosyası'} hazır.`);
 }catch(e){setStatus(e.message,true)}finally{button.disabled=false}}
const aliases={province:['il','ili','sehir','şehir'],district:['ilce','ilçe','ilçesi'],library:['kutuphane adi','kütüphane adı','kutuphane','kütüphane'],address:['acik adres','açık adres','adres'],phone:['kutuphane telefonu','kütüphane telefonu','telefon','cep telefonu'],recipient:['teslim alacak personel','teslim alacak','ilgili personel'],material:['malzeme','etiket tipi'],total:['etiket adedi','toplam miktar','toplam etiket','talep edilen etiket adedi'],date:['tarih'],unitsPerPack:['paket basina etiket'],packsPerBox:['koli basina paket']};
const fold=x=>String(x||'').toLocaleLowerCase('tr').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[ıİ]/g,'i').replace(/[^a-z0-9]+/g,' ').trim();
function fieldMatch(field,headers){let words=(aliases[field]||[]).map(fold);const normalized=headers.map(fold);let idx=normalized.findIndex(h=>words.includes(h));if(idx>=0)return idx;idx=normalized.findIndex(h=>words.some(w=>h.includes(w)));return idx}
function renderMap(){if(!sheet)return;const heads=sheet.columns;
 $('mapGrid').innerHTML=allFields.map(f=>`<label>${escapeHtml(names[f])} ${required.includes(f)?'<em>*</em>':''}<select data-map="${f}"><option value="">— Sütun seç —</option>${heads.map((h,i)=>`<option value="${i}" ${fieldMatch(f,heads)===i?'selected':''}>${escapeHtml(h)}</option>`).join('')}</select></label>`).join('')}
async function loadExcel(file){if(!file)return;try{setStatus('Excel okunuyor…');const form=new FormData();form.append('file',file);const response=await fetch('/api/excel',{method:'POST',body:form});if(!response.ok){const j=await response.json();throw Error(j.detail||'Excel okunamadı.')}
 const data=await response.json();sheets=data.sheets;$('sheetSelect').innerHTML=sheets.map((s,i)=>`<option value="${i}">${escapeHtml(s.name)} (${s.count} satır)</option>`).join('');sheet=sheets[0];$('excelMapping').hidden=false;renderMap();setStatus('Excel okundu. Eşleştirmeleri kontrol edip içe aktarın.');}catch(e){setStatus(e.message,true)}}
function importExcel(){if(!sheet)return;const mapping={};$('mapGrid').querySelectorAll('[data-map]').forEach(el=>{mapping[el.dataset.map]=el.value===''?-1:Number(el.value)});let added=0;
 for(const row of sheet.rows.slice(0,400)){
  const r={...initial,total:''};for(const [field,idx] of Object.entries(mapping))if(idx>=0)r[field]=String(row.values[idx]??'').trim();
  if(!r.unitsPerPack)r.unitsPerPack=initial.unitsPerPack;if(!r.packsPerBox)r.packsPerBox=initial.packsPerBox;
  records.push({checked:true,data:r});added++;
 }
 renderRows();setStatus(`${added} Excel satırı eklendi. Eksik verileri düzenleyin; kayıtlardaki miktarları mutlaka kontrol edin.`);
}
function setTab(which){document.querySelectorAll('[data-tab]').forEach(el=>el.classList.toggle('active',el.dataset.tab===which));document.querySelector('.shipPaper').style.display=which==='label'?'flex':'none';$('downloadShipping').style.display=which==='label'?'flex':'none';$('downloadReceipt').style.display='flex';$('previewPdf').textContent=which==='label'?'Gönderi PDF önizle':'Tutanak PDF önizle';document.querySelector('.tag').textContent=which==='label'?'Gönderi etiketi':'Teslim tutanağı';try{if(which==='receipt')window.history.replaceState({},'','/gonderi?tab=receipt');else window.history.replaceState({},'','/gonderi');}catch(_){}}
F.addEventListener('input',()=>{compute();updateVisual()});$('saveRecord').onclick=saveRecord;$('newRecord').onclick=emptyForm;$('demo').onclick=()=>{writeForm({province:'ANKARA',district:'SİNCAN',library:'Sincan İlçe Halk Kütüphanesi Müdürlüğü',address:'Atatürk Mahallesi, Cumhuriyet Caddesi No: 25 Sincan / ANKARA',phone:'0312 000 00 00',recipient:'Örnek Yetkili',material:'UHF RFID Kütüphane Etiketi (Şerit)',total:'15000',unitsPerPack:'1000',packsPerBox:'9'});setStatus('Örnek veriler dolduruldu. Gerçek bilgilerle değiştirin.');};
$('downloadShipping').onclick=()=>exportPDF('shipping');$('downloadReceipt').onclick=()=>exportPDF('receipt');$('previewPdf').onclick=()=>exportPDF(document.querySelector('[data-tab="label"]').classList.contains('active')?'shipping':'receipt',true);
$('closePreview').onclick=()=>$('previewDialog').close();$('excelInput').onchange=e=>loadExcel(e.target.files[0]);$('sheetSelect').onchange=e=>{sheet=sheets[Number(e.target.value)];renderMap()};$('importExcel').onclick=importExcel;$('selectAll').onclick=()=>{const select=!records.every(r=>r.checked);records.forEach(r=>r.checked=select);renderRows();};document.querySelectorAll('[data-tab]').forEach(el=>el.onclick=()=>setTab(el.dataset.tab));
compute();updateVisual();if(new URLSearchParams(location.search).get('tab')==='receipt')setTab('receipt');
