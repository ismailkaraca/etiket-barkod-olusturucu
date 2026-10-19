'use strict';
const $=id=>document.getElementById(id);
let pdfCache=null;
async function run(){
 const hash=location.hash.replace(/^#/,'');const params=new URLSearchParams(hash);const token=params.get('d');
 if(!token){$('qrStatus').textContent='QR kaydı bulunamadı. Etiketin üzerindeki QR kodu tekrar okutun.';return}
 if(token.length>2300||!/^[A-Za-z0-9_-]+$/.test(token)){$('qrStatus').textContent='QR içeriği geçersiz.';return}
 try{
   const r=await fetch('/api/tutanak/qr-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),cache:'no-store'});
   if(!r.ok){const j=await r.json().catch(()=>({}));throw Error(j.detail||'Tutanak hazırlanamadı.')}
   pdfCache=await r.blob();$('qrDownload').disabled=false;
   $('qrStatus').textContent='Tutanak hazır. PDF indirme başladı. Otomatik indirme engellenirse aşağıdaki düğmeyi kullanabilirsiniz.';
   download();
 }catch(err){$('qrStatus').textContent='Hata: '+err.message}
}
function download(){if(!pdfCache)return;const u=URL.createObjectURL(pdfCache),a=document.createElement('a');a.href=u;a.download='RFID_Etiket_Teslim_Tutanagi.pdf';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),20000)}
$('qrDownload').onclick=download;window.addEventListener('DOMContentLoaded',run);
