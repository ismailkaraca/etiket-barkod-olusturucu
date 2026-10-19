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
function formatPhone(value){
 const original=String(value??'').trim();
 const raw=/^[0-9]{10,14}\.0$/.test(original)?original.slice(0,-2):original;
 let digits=raw.replace(/\D/g,'');
 if(digits.length===14&&digits.startsWith('0090'))digits=digits.slice(4);
 if(digits.length===12&&digits.startsWith('90'))digits=digits.slice(2);
 if(digits.length===11&&digits.startsWith('0'))digits=digits.slice(1);
 if(digits.length!==10)return raw;
 return '+'+digits.slice(0,3)+') '+digits.slice(3,6)+'-'+digits.slice(6,8)+'-'+digits.slice(8);
}
function display(n){return Number(n||0).toLocaleString('tr-TR')}
function compute(){const r=readForm(),n=calc(r);const node=$('calcBox');
 if(!n){node.textContent='Toplam etiket ve paket/koli kapasitelerini yazın.'}
 else if(n.error){node.innerHTML='<b>Uyarı:</b> '+escapeHtml(n.error)}
 else node.innerHTML=`<strong>${display(n.total)} etiket → ${n.packs} paket / ${n.boxes} koli</strong><div>${n.distribution.map(x=>`${x.box}. koli: <b>${x.packs} paket / ${display(x.labels)} etiket</b>`).join(' &nbsp; | &nbsp; ')}</div>`;
}
function updateVisual(){const r=readForm(),n=calc(r);$('previewLibrary').textContent=r.library||'Kütüphane adı';$('previewLocation').textContent=(r.province||'İl')+' / '+(r.district||'İlçe');$('previewAddress').textContent=r.address||'Gönderi adresi';$('previewPhone').textContent=formatPhone(r.phone)||'Kütüphane telefonu';$('previewQuantity').textContent=r.total?(display(r.total)+' ADET RFID ETİKETİ'):'ETİKET ADEDİ GİRİLMEDİ';$('previewBoxes').textContent=n&&!n.error?`${n.boxes} KOLİ · ${n.packs} PAKET`:'Koli/paket hesabı'}
function setStatus(message,error=false){$('result').textContent=message;$('result').classList.toggle('error',error);const hint=$('formAlert');if(hint){hint.hidden=!error;hint.textContent=error?message:''}}
function checkedRows(){return records.filter(x=>x.checked).map(x=>({...x.data}));}
function getPayload(){const chosen=checkedRows();if(chosen.length)return chosen;
 const current=readForm();if(required.every(k=>current[k]))return [current];
 throw Error(records.length?'Listede baskıya seçili geçerli kayıt yok. Eksik satırları Gönderi listesindeki “Eksikleri tamamla” düğmesiyle düzeltip seçin.':'Listeden en az bir gönderi seçin veya zorunlu alanları doldurun.');}
function validation(rows){for(let i=0;i<rows.length;i++){
 const r=rows[i];const missing=required.filter(k=>!String(r[k]||'').trim());
 if(missing.length)throw Error(`${i+1}. kayıtta zorunlu alanlar eksik: ${missing.map(k=>names[k]).join(', ')}. Gönderi listesindeki Düzenle seçeneğinden tamamlayın.`);
 const n=calc(r);if(!n||n.error)throw Error(`${i+1}. kayıt: ${n?.error||'Koli/paket bilgileri hatalı.'}`);
 if(String(r.library||'').length>250||String(r.address||'').length>700)throw Error('Kütüphane adı/adres alanı çok uzun.');
 }return rows;}
function formValid(){const r=readForm(),miss=required.filter(k=>!String(r[k]||'').trim());
 if(miss.length){setStatus('Zorunlu: '+miss.map(k=>names[k]).join(', '),true);$(miss[0]).focus();return false}
 const c=calc(r);if(!c||c.error){setStatus(c?.error||'Geçersiz koli/paket bilgileri.',true);return false}return true}
function saveRecord(){if(!formValid())return;const data=readForm();if(editIndex>=0){records[editIndex].data=data;records[editIndex].inferred=[];records[editIndex].checked=true;}else records.push({checked:true,data});
 const updated=editIndex>=0;editIndex=-1;renderRows();setStatus(updated?'Gönderi bilgileri güncellendi.':'Gönderi listeye eklendi.');$('saveRecord').textContent='+ Gönderiyi listeye ekle';}
function renderRows(){const box=$('recordList'),summary=$('recordSummary');
 if(!records.length){box.innerHTML='<div class="empty">Henüz kayıt yok. Üstteki formdan ekleyin veya Excel yükleyin.</div>';summary.textContent='';return}
 const bad=records.filter(x=>getMissing(x.data).length||!calc(x.data)||calc(x.data).error).length;
 const checked=records.filter(x=>x.checked).length;
 summary.className='record-summary'+(bad?' warning':'');
 summary.textContent=`${records.length} kayıt · ${checked} baskıya seçildi${bad?' · '+bad+' kayıtta eksik veya geçersiz bilgi var. Düzenle düğmesiyle tamamlayın.':''}`;
 box.innerHTML=records.map((r,i)=>{
  const c=calc(r.data),missing=getMissing(r.data),problem=missing.length||!c||c.error;
  const detail=missing.length?'Eksik: '+missing.map(k=>names[k]).join(', '):c?.error||(!c?'Paket/koli hesabını kontrol edin':'');
  return `<div class="listrow ${problem?'needs-fix':''}"><input type="checkbox" aria-label="${escapeHtml(r.data.library||'Kayıt '+(i+1))} seç" data-check="${i}" ${r.checked?'checked':''}><div><div class="name">${i+1}. ${escapeHtml(r.data.library||'Eksik kütüphane adı')}</div><small>${escapeHtml(r.data.province||'-')} / ${escapeHtml(r.data.district||'-')} · ${display(r.data.total)} etiket · ${c?.error?'Kontrol gerekli':(c?c.boxes+' koli, '+c.packs+' paket':'Eksik miktar')}</small>${detail?`<small class="issue">${escapeHtml(detail)}</small>`:''}${r.inferred?.length?`<div class="inference">ⓘ Otomatik önerilen: ${escapeHtml(r.inferred.join(', '))}. Kontrol edin.</div>`:''}</div><div class="btnline"><button type="button" data-edit="${i}">${problem?'Eksikleri tamamla':'Düzenle'}</button><button type="button" data-remove="${i}">Sil</button></div></div>`}).join('');
 box.querySelectorAll('[data-check]').forEach(el=>el.onchange=()=>{records[+el.dataset.check].checked=el.checked;renderRows()});
 box.querySelectorAll('[data-edit]').forEach(el=>el.onclick=()=>{editIndex=+el.dataset.edit;writeForm(records[editIndex].data);$('saveRecord').textContent='Değişiklikleri kaydet';$('shipmentForm').scrollIntoView({behavior:'smooth',block:'start'});setStatus('Düzenlenen kayıt: '+(editIndex+1));});
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
const aliases={
 province:['il','ili','sehir','şehir','il adi','il adı'],
 district:['ilce','ilçe','ilcesi','ilçesi','ilce adi','ilçe adı'],
 library:['kutuphane adi','kütüphane adı','kutuphane','kütüphane'],
 address:['kutuphane adresi','kütüphane adresi','acik adres','açık adres','adres'],
 phone:['kutuphane telefonu','kütüphane telefonu','kütüphane telefon','kutuphane telefon','telefon'],
 recipient:['teslim alacak personel','teslim alacak','ilgili formu dolduran kisi ad soyad','ilgili personel'],
 material:['malzeme','etiket tipi'],
 total:['talep edilen serit rfid etiket miktari','talep edilen şerit rfid etiket miktarı','talep edilen kare rfid etiket miktari','talep edilen kare rfid etiket miktarı','toplam etiket','toplam miktar','etiket adedi','talep edilen etiket adedi'],
 date:['tarih'],unitsPerPack:['paket basina etiket'],packsPerBox:['koli basina paket']};
const fold=x=>String(x||'').toLocaleLowerCase('tr').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[ıİ]/g,'i').replace(/[^a-z0-9]+/g,' ').trim();
function fieldMatch(field,headers){
 const hs=headers.map(fold),al=(aliases[field]||[]).map(fold);
 // A precise RFID quantity column must win over the similarly worded yes/no questions.
 if(field==='total'){
  const targets=['talep edilen serit rfid etiket miktari','talep edilen kare rfid etiket miktari'];
  for(const target of targets){const ix=hs.findIndex(h=>h===target || h.startsWith(target+' '));if(ix>=0)return ix;}
 }
 for(const alias of al){const ix=hs.findIndex(h=>h===alias);if(ix>=0)return ix;}
 for(const alias of al){
  if(alias.length<5)continue; // prevent `İl` matching `İlgili`, `İlçe` etc.
  const ix=hs.findIndex(h=>(' '+h+' ').includes(' '+alias+' '));if(ix>=0)return ix;
 }
 return -1;
}
const provinces='ADANA|ADIYAMAN|AFYONKARAHİSAR|AĞRI|AKSARAY|AMASYA|ANKARA|ANTALYA|ARDAHAN|ARTVİN|AYDIN|BALIKESİR|BARTIN|BATMAN|BAYBURT|BİLECİK|BİNGÖL|BİTLİS|BOLU|BURDUR|BURSA|ÇANAKKALE|ÇANKIRI|ÇORUM|DENİZLİ|DİYARBAKIR|DÜZCE|EDİRNE|ELAZIĞ|ERZİNCAN|ERZURUM|ESKİŞEHİR|GAZİANTEP|GİRESUN|GÜMÜŞHANE|HAKKARİ|HATAY|IĞDIR|ISPARTA|İSTANBUL|İZMİR|KAHRAMANMARAŞ|KARABÜK|KARAMAN|KARS|KASTAMONU|KAYSERİ|KIRIKKALE|KIRKLARELİ|KIRŞEHİR|KİLİS|KOCAELİ|KONYA|KÜTAHYA|MALATYA|MANİSA|MARDİN|MERSİN|MUĞLA|MUŞ|NEVŞEHİR|NİĞDE|ORDU|OSMANİYE|RİZE|SAKARYA|SAMSUN|SİİRT|SİNOP|SİVAS|ŞANLIURFA|ŞIRNAK|TEKİRDAĞ|TOKAT|TRABZON|TUNCELİ|UŞAK|VAN|YALOVA|YOZGAT|ZONGULDAK'.split('|');
const provinceSet=new Set(provinces.map(fold));
function recognizedProvince(value){const n=fold(value);return provinces.find(x=>fold(x)===n)||''}
function inferLocation(row){
 const inferred=[],address=String(row.address||'').trim(),lib=String(row.library||'').trim();
 // Address trailing segments: `... Edremit / BALIKESİR` or `... İslahiye/Gaziantep`.
 const sections=address.split('/').map(x=>x.trim()).filter(Boolean);
 let addressProvince='';
 for(let i=sections.length-1;i>=0;i--){
  const segment=sections[i].replace(/[.,;]+$/,'').trim();
  addressProvince=recognizedProvince(segment);
  if(addressProvince)break;
 }
 if(!row.province && addressProvince){row.province=addressProvince;inferred.push('İl (adres)')}
 if(!row.province){
  const foldedLibrary=fold(lib);
  const match=provinces.find(p=>foldedLibrary.startsWith(fold(p)+' '));
  if(match){row.province=match;inferred.push('İl (kütüphane adı)')}
 }
 if(!row.district && sections.length>=2 && addressProvince && recognizedProvince(sections.at(-1).replace(/[.,;]+$/,''))){
  // Last word just before /Province, never manufacture a district from a city name.
  const previous=sections.at(-2).replace(/[.,;]+$/,'');
  const match=previous.match(/(?:^|[\s,;])([A-Za-zÇĞİÖŞÜçğıöşü\-]{3,35})\s*$/u);
  if(match && !provinceSet.has(fold(match[1])) && !/^(mah|mahalle|cd|cad|sok|sk|no)$/i.test(match[1])){
   row.district=match[1].toLocaleUpperCase('tr');inferred.push('İlçe (adres)');
  }
 }
 // Only single-word, explicitly marked district library prefixes are safe to infer.
 if(!row.district && row.province){
  const part=lib.replace(new RegExp('^'+row.province+'\\s+','iu'),'');
  const match=part.match(/^([\p{L}-]{3,35})\s+İlçe\s+Halk\s+Kütüphanesi/iu);
  if(match){row.district=match[1].toLocaleUpperCase('tr');inferred.push('İlçe (kütüphane adı)')}
 }
 return inferred;
}
function normalizeCount(value){
 const raw=String(value??'').trim().replace(/\s/g,'');
 if(!raw)return '';
 const plain=/^\d{1,3}(?:\.\d{3})+$/.test(raw)?raw.replace(/\./g,''):raw;
 const n=Number(plain.includes(',')?plain.replace(/\./g,'').replace(',','.'):plain);
 return Number.isSafeInteger(n) && n>0?String(n):'';
}
function normalizePhone(value){const raw=String(value??'').trim();return /^\d{7,14}\.0$/.test(raw)?raw.slice(0,-2):raw;}
function getMissing(r){return required.filter(k=>!String(r[k]??'').trim())}
function renderMap(){if(!sheet)return;const heads=sheet.columns;
 $('mapGrid').innerHTML=allFields.map(f=>{const selected=fieldMatch(f,heads);return `<label class="${required.includes(f)&&selected<0?'unmapped-required':''}">${escapeHtml(names[f])} ${required.includes(f)?'<em>*</em>':''}<select data-map="${f}"><option value="">— Sütun seç —</option>${heads.map((h,i)=>`<option value="${i}" ${selected===i?'selected':''}>${escapeHtml(h)}</option>`).join('')}</select></label>`}).join('');
 const noDistrict=fieldMatch('district',heads)<0;
 $('importSummary').className='import-summary'+(noDistrict?' warning':'');
 $('importSummary').textContent=noDistrict?'Excel’de ayrı bir ilçe sütunu bulunamadı. İçe aktarırken açık adresin sonundaki İlçe/İl bilgisi varsa önerilecek; bulunamayan ilçeleri listeden Düzenle ile tamamlayın.':'Sütun eşleştirmelerini kontrol edin. Şerit veya kare RFID miktarı için uygun sütunu seçebilirsiniz.';
}
async function loadExcel(file){if(!file)return;try{setStatus('Excel okunuyor…');const form=new FormData();form.append('file',file);const response=await fetch('/api/excel',{method:'POST',body:form});if(!response.ok){const j=await response.json();throw Error(j.detail||'Excel okunamadı.')}
 const data=await response.json();sheets=data.sheets;$('sheetSelect').innerHTML=sheets.map((s,i)=>`<option value="${i}">${escapeHtml(s.name)} (${s.count} satır)</option>`).join('');sheet=sheets[0];$('excelMapping').hidden=false;renderMap();setStatus('Excel okundu. Eşleştirmeleri kontrol edip içe aktarın.');}catch(e){setStatus(e.message,true)}}
function importExcel(){if(!sheet)return;
 const mapping={};$('mapGrid').querySelectorAll('[data-map]').forEach(el=>{mapping[el.dataset.map]=el.value===''?-1:Number(el.value)});
 let added=0,needsReview=0,inferred=0,skipped=0;
 for(const row of sheet.rows.slice(0,400)){
  const r={...initial,total:''};
  for(const [field,idx] of Object.entries(mapping))if(idx>=0)r[field]=String(row.values[idx]??'').trim();
  if(!r.library?.trim() && !r.address?.trim()){skipped++;continue;} // skip empty Excel lines
  r.total=normalizeCount(r.total);
  r.phone=normalizePhone(r.phone);
  if(!r.material)r.material=initial.material;
  if(!r.unitsPerPack)r.unitsPerPack=initial.unitsPerPack;
  if(!r.packsPerBox)r.packsPerBox=initial.packsPerBox;
  const sourceNotes=inferLocation(r);
  const valid=getMissing(r).length===0&&!!calc(r)&&!calc(r).error;
  records.push({checked:valid,data:r,inferred:sourceNotes});added++;
  if(!valid)needsReview++;
  if(sourceNotes.length)inferred++;
 }
 renderRows();
 const report=`${added} kayıt aktarıldı. ${added-needsReview} kayıt baskıya seçildi. ${needsReview} kayıt eksik/geçersiz bilgi nedeniyle seçilmedi.${inferred?' '+inferred+' kayıtta il/ilçe adres veya kütüphane adından önerildi (kontrol edin).':''}${skipped?' '+skipped+' boş satır atlandı.':''}`;
 $('importSummary').textContent=report;
 $('importSummary').className='import-summary'+(needsReview||inferred?' warning':'');
 setStatus(needsReview?`${needsReview} kayıt için düzeltme gerekiyor. Listeyi aşağıdan kontrol edin.`:'Excel verileri alındı. Gönderiler baskıya hazır.',!!needsReview);
}
function setTab(which){document.querySelectorAll('[data-tab]').forEach(el=>el.classList.toggle('active',el.dataset.tab===which));document.querySelector('.shipPaper').style.display=which==='label'?'flex':'none';$('downloadShipping').style.display=which==='label'?'flex':'none';$('downloadReceipt').style.display='flex';$('previewPdf').textContent=which==='label'?'Gönderi PDF önizle':'Tutanak PDF önizle';document.querySelector('.tag').textContent=which==='label'?'Gönderi etiketi':'Teslim tutanağı';try{if(which==='receipt')window.history.replaceState({},'','/gonderi?tab=receipt');else window.history.replaceState({},'','/gonderi');}catch(_){}}
F.addEventListener('input',()=>{compute();updateVisual()});$('saveRecord').onclick=saveRecord;$('newRecord').onclick=emptyForm;$('demo').onclick=()=>{writeForm({province:'ANKARA',district:'SİNCAN',library:'Sincan İlçe Halk Kütüphanesi Müdürlüğü',address:'Atatürk Mahallesi, Cumhuriyet Caddesi No: 25 Sincan / ANKARA',phone:'0312 000 00 00',recipient:'Örnek Yetkili',material:'UHF RFID Kütüphane Etiketi (Şerit)',total:'15000',unitsPerPack:'1000',packsPerBox:'9'});setStatus('Örnek veriler dolduruldu. Gerçek bilgilerle değiştirin.');};
$('downloadShipping').onclick=()=>exportPDF('shipping');$('downloadReceipt').onclick=()=>exportPDF('receipt');$('previewPdf').onclick=()=>exportPDF(document.querySelector('[data-tab="label"]').classList.contains('active')?'shipping':'receipt',true);
$('closePreview').onclick=()=>$('previewDialog').close();$('excelInput').onchange=e=>loadExcel(e.target.files[0]);$('sheetSelect').onchange=e=>{sheet=sheets[Number(e.target.value)];renderMap()};$('importExcel').onclick=importExcel;$('selectAll').onclick=()=>{const select=!records.every(r=>r.checked);records.forEach(r=>r.checked=select);renderRows();};document.querySelectorAll('[data-tab]').forEach(el=>el.onclick=()=>setTab(el.dataset.tab));
compute();updateVisual();if(new URLSearchParams(location.search).get('tab')==='receipt')setTab('receipt');
