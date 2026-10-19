"""Public, stateless shipping label and unsigned RFID delivery receipt PDFs.

Original form reference: 2025 UHF RFID Etiket Alımı, 42-page user-provided PDF.
QR payload contains only user-supplied record data, compressed into an HTTPS URL.
Do not treat generated documents as evidence of physical handover before signing.
"""
from __future__ import annotations

import base64
from io import BytesIO
import json
import math
import re
import zlib
from pathlib import Path
from urllib.parse import quote

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.pdfgen import canvas
import reportlab
import qrcode
from qrcode.image.svg import SvgImage
from PIL import Image
from xml.sax.saxutils import escape

TR_LABELS = {
    'province':'İLİ','district':'İLÇESİ','library':'KÜTÜPHANE ADI',
    'address':'ADRES','phone':'KÜTÜPHANE TELEFONU','material':'TESLİM EDİLEN MALZEME',
    'total':'TOPLAM MİKTAR','packaging':'AMBALAJ DETAYI',
}
_REQUIRED = ('province','district','library','address','phone','material')
MAX_RECORDS=400
MAX_TEXT=750
FONT_REG='RFIDFormVera'
FONT_BOLD='RFIDFormVeraBold'

def _fonts():
    base=Path(reportlab.__file__).parent/'fonts'
    if FONT_REG not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont(FONT_REG,str(base/'Vera.ttf')))
        pdfmetrics.registerFont(TTFont(FONT_BOLD,str(base/'VeraBd.ttf')))
    pdfmetrics.registerFontFamily(FONT_REG,normal=FONT_REG,bold=FONT_BOLD,italic=FONT_REG,boldItalic=FONT_BOLD)


def _text(value,limit=MAX_TEXT):
    return str(value if value is not None else '').strip()[:limit]


def _positive_int(x,name,min_value=1,max_value=3_000_000):
    try:
        n=int(str(x).strip().replace('.','').replace(' ','').replace(',',''))
    except (ValueError,TypeError):
        raise ValueError(f'{name} pozitif tam sayı olmalıdır.') from None
    if n < min_value or n > max_value:raise ValueError(f'{name} {min_value} ile {max_value} arasında olmalıdır.')
    return n


def calculate_boxes(total,units_per_pack=1000,packs_per_box=9,override_pack_count=None,override_box_count=None):
    total=_positive_int(total,'Etiket adedi')
    unit=_positive_int(units_per_pack,'Paket başına etiket',max_value=1_000_000)
    per_box=_positive_int(packs_per_box,'Koli başına paket',max_value=10000)
    pack_count=math.ceil(total/unit)
    if override_pack_count not in (None,''):
        pack_count=_positive_int(override_pack_count,'Paket adedi',max_value=1_000_000)
        if pack_count*unit<total:raise ValueError('Girilen paket sayısının kapasitesi toplam etiket adedini karşılamıyor.')
        if pack_count>total:raise ValueError('Paket sayısı etiket adedinden fazla olamaz.')
    box_count=math.ceil(pack_count/per_box)
    if override_box_count not in (None,''):
        box_count=_positive_int(override_box_count,'Koli adedi',max_value=100_000)
        if box_count*per_box<pack_count:raise ValueError('Girilen koli sayısının kapasitesi paket adedini karşılamıyor.')
    full_boxes,partial_packs=divmod(pack_count,per_box)
    remainder=total%unit
    words=[f'{box_count} koli', f'{pack_count} paket',f'{total:,}'.replace(',','.')+' etiket']
    details=f'{box_count} Koli / {pack_count} Paket (1 Paket: {unit:,} Etiket; 1 Koli: {per_box} Paket)'.replace(',', '.')
    if remainder:details+=f'; Son pakette {remainder:,} etiket'.replace(',','.')
    if override_box_count not in (None,'') or override_pack_count not in (None,''):
        details+=' [Adetler elle düzenlendi]'
    return {'total':total,'unitsPerPack':unit,'packsPerBox':per_box,'packCount':pack_count,'boxCount':box_count,
            'fullBoxCount':full_boxes,'lastBoxPacks':partial_packs,'partialPackLabels':remainder,'packaging':details,'short':' · '.join(words)}


def normalize_receipt(obj):
    if not isinstance(obj,dict):raise ValueError('Gönderi kaydı geçersiz.')
    x={k:_text(obj.get(k)) for k in _REQUIRED}
    missing=[{'province':'İl','district':'İlçe','library':'Kütüphane adı','address':'Adres','phone':'Telefon','material':'Malzeme'}[k] for k in _REQUIRED if not x[k]]
    if missing:raise ValueError('Zorunlu alanları doldurun: '+', '.join(missing))
    p=calculate_boxes(obj.get('total'),obj.get('unitsPerPack') or 1000,obj.get('packsPerBox') or 9,
                      obj.get('packCountOverride'),obj.get('boxCountOverride'))
    x.update(p)
    x['packCountOverride']=_text(obj.get('packCountOverride'),20)
    x['boxCountOverride']=_text(obj.get('boxCountOverride'),20)
    x['recipient']=_text(obj.get('recipient'),150)
    x['sender']=_text(obj.get('sender'),150)
    x['recipientTitle']=_text(obj.get('recipientTitle'),150)
    x['date']=_text(obj.get('date'),30)
    x['boxNumber']=_text(obj.get('boxNumber'),30)
    # Canonical QR record explicitly omits personal names: those can be written by hand on receipt.
    return x


def compact_receipt(data):
    keys=['province','district','library','address','phone','material','total','unitsPerPack','packsPerBox','packCount','boxCount','packaging','date','packCountOverride','boxCountOverride']
    info={'v':1, **{k:data[k] for k in keys if k in data}}
    packed=zlib.compress(json.dumps(info,ensure_ascii=False,separators=(',',':')).encode('utf-8'),9)
    token=base64.urlsafe_b64encode(packed).decode('ascii').rstrip('=')
    if len(token)>1800:raise ValueError('QR verisi çok uzun. Adresi kısaltın.')
    return token


def decode_receipt(token):
    if not isinstance(token,str) or len(token)>2300 or not re.fullmatch('[A-Za-z0-9_-]+',token):raise ValueError('QR bağlantısı geçersiz.')
    try:
        decompressor=zlib.decompressobj()
        raw=decompressor.decompress(base64.urlsafe_b64decode(token+'='*(-len(token)%4)),6001)
        if not decompressor.eof or len(raw)>6000:raise ValueError('QR verisi fazla uzun veya eksik.')
        x=json.loads(raw)
    except Exception:raise ValueError('QR verisi okunamadı.') from None
    if x.get('v')!=1:raise ValueError('QR sürümü desteklenmiyor.')
    return normalize_receipt(x)


def _p(value,style):return Paragraph(escape(str(value)).replace('\n','<br/>'),style)


def _styles():
    _fonts()
    return {
       'cell':ParagraphStyle('rfcell',fontName=FONT_REG,fontSize=9.1,leading=12.5,spaceAfter=0,wordWrap='CJK'),
       'cellbold':ParagraphStyle('rfcellb',fontName=FONT_BOLD,fontSize=9.1,leading=12.5,spaceAfter=0,wordWrap='CJK'),
       'small':ParagraphStyle('rfsmall',fontName=FONT_REG,fontSize=8.7,leading=12.5),
       'sign':ParagraphStyle('rfsign',fontName=FONT_REG,fontSize=9.0,leading=22),
       'signb':ParagraphStyle('rfsignb',fontName=FONT_BOLD,fontSize=9.0,leading=19),
       'shipval':ParagraphStyle('rfshipv',fontName=FONT_BOLD,fontSize=17.5,leading=23,wordWrap='CJK'),
       'shipaddr':ParagraphStyle('rfshipaddr',fontName=FONT_REG,fontSize=13.2,leading=18.5,wordWrap='CJK'),
       'shipmeta':ParagraphStyle('rfshipmeta',fontName=FONT_BOLD,fontSize=15.0,leading=21),
    }


def _title(canvas,width,height,subtitle='RFID ETİKET TESLİM TUTANAĞI',y=None):
    _fonts()
    if y is None:y=height-25*mm
    canvas.setFont(FONT_BOLD,11.0)
    for line in ('T.C.','KÜLTÜR VE TURİZM BAKANLIĞI','KÜTÜPHANELER VE YAYIMLAR GENEL MÜDÜRLÜĞÜ',subtitle):
        canvas.drawCentredString(width/2,y,line);y-=5.3*mm
    return y


def receipt_pdf(records):
    if len(records)>MAX_RECORDS:raise ValueError(f'En fazla {MAX_RECORDS} tutanak hazırlanabilir.')
    if not records:raise ValueError('En az bir kayıt gerekli.')
    normalized=[normalize_receipt(r) for r in records]
    style=_styles();buf=BytesIO();c=canvas.Canvas(buf,pagesize=A4,pageCompression=1)
    w,h=A4
    for i,r in enumerate(normalized):
        _title(c,w,h)
        rows=[[_p('Bilgi',style['cellbold']),_p('Detay',style['cellbold'])]]
        for k,label in TR_LABELS.items():
            if k=='total':v=f"{r['total']:,}".replace(',','.')+' Adet'
            elif k=='packaging':v=r['packaging']
            else:v=r.get(k,'')
            rows.append([_p(label,style['cellbold']),_p(v,style['cell'])])
        table=Table(rows,colWidths=[66*mm,125*mm],hAlign='CENTER')
        table.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'MIDDLE'),('GRID',(0,0),(-1,-1),0.65,colors.black),
                      ('LEFTPADDING',(0,0),(-1,-1),5),('RIGHTPADDING',(0,0),(-1,-1),5),
                      ('TOPPADDING',(0,0),(-1,-1),4.2),('BOTTOMPADDING',(0,0),(-1,-1),4.2)]))
        tw,th=table.wrapOn(c,w-18*mm,h)
        top=h-57*mm
        if th>135*mm:raise ValueError('Tutanak alanları sayfaya sığmayacak kadar uzun.')
        table.drawOn(c,(w-tw)/2,top-th)
        y=top-th-14*mm
        c.setFont(FONT_REG,8.8)
        c.drawString(9*mm,y,'"Yukarıda cins ve miktarı belirtilen RFID etiketleri eksiksiz ve hasarsız olarak teslim alınmıştır."')
        y-=15*mm
        c.setFont(FONT_BOLD,9)
        c.drawString(9*mm,y,'TARİH:')
        c.setFont(FONT_REG,9);c.drawString(26*mm,y,r.get('date') or '..... / ..... / 20.....')
        y-=9*mm
        sign=[[_p('Teslim Eden (Kargo/Görevli)',style['signb']),_p('Teslim Alan (Kütüphane Yetkilisi)',style['signb'])],
              [_p(f"Adı Soyadı: {r.get('sender') or '..........................'}\nİmza: ..........................",style['sign']),
               _p(f"Adı Soyadı: {r.get('recipient') or '..........................'}\nUnvanı: {r.get('recipientTitle') or '..........................'}\nİmza: ..........................",style['sign'])]]
        sg=Table(sign,colWidths=[95.5*mm,95.5*mm],rowHeights=[12*mm,31*mm],hAlign='CENTER')
        sg.setStyle(TableStyle([('GRID',(0,0),(-1,-1),0.6,colors.black),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),6)]))
        sh=sg.wrapOn(c,w,h)[1]
        if y-sh<24*mm:raise ValueError('Tutanak imza alanına yeterli alan kalmadı.')
        sg.drawOn(c,(w-191*mm)/2,y-sh)
        c.setStrokeColor(colors.Color(.6,.6,.6));c.setLineWidth(.25);c.line(9*mm,19*mm,w-9*mm,19*mm)
        c.setFont(FONT_BOLD,7.4)
        c.drawCentredString(w/2,13*mm,'İşbu tutanak imza altına alınarak kygmteknik@ktb.gov.tr adresine gönderilecektir.')
        c.showPage()
    c.save();return buf.getvalue()


def _para_on(c,text,style,x,y,maxwidth):
    p=_p(text,style)
    _,h=p.wrap(maxwidth,200*mm);p.drawOn(c,x,y-h);return y-h


def _draw_qr(c,url,x,y,size):
    # Raster is embedded at high dpi and printed in 47mm square on A4 shipping sheets.
    q=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M,box_size=10,border=3)
    q.add_data(url);q.make(fit=True)
    img=q.make_image(fill_color='black',back_color='white').convert('RGB')
    from reportlab.lib.utils import ImageReader
    c.drawImage(ImageReader(img),x,y,width=size,height=size,mask='auto')
    return q.modules_count


def shipping_label_pdf(records,public_base,one_per_box=True):
    if not records:raise ValueError('Gönderi etiketi için en az bir kayıt gerekli.')
    if len(records)>MAX_RECORDS:raise ValueError(f'En fazla {MAX_RECORDS} gönderi hazırlanabilir.')
    count=sum(normalize_receipt(r)['boxCount'] if one_per_box else 1 for r in records)
    if count>250:raise ValueError('Bir PDF içinde en fazla 250 A4 sayfası hazırlanabilir. Gönderileri gruplara ayırın.')
    _styles();buf=BytesIO();w,h=landscape(A4)
    c=canvas.Canvas(buf,pagesize=(w,h),pageCompression=1)
    base=public_base.rstrip('/')
    for r0 in records:
        r=normalize_receipt(r0)
        box_plan=plan_cartons(r) if one_per_box else [{'number':1,'boxes':r['boxCount'],'packs':r['packCount'],'labels':r['total']}]
        for box in box_plan:
            _shipping_page(c,w,h,r,box,base,one_per_box)
    c.save();return buf.getvalue()

def _shipping_page(c,w,h,r,box,base,one_per_box):
        qr_url=base+'/tutanak#d='+compact_receipt(r)
        # QR deliberately contains all receipt fields, and no signatures. Anyone with QR can read them.
        margin=11*mm
        c.setLineWidth(0.75);c.roundRect(margin,margin,w-2*margin,h-2*margin,6*mm)
        c.setFont(FONT_BOLD,14);c.drawString(19*mm,h-25*mm,'T.C. KÜLTÜR VE TURİZM BAKANLIĞI')
        c.setFont(FONT_BOLD,11);c.drawString(19*mm,h-33*mm,'KÜTÜPHANELER VE YAYIMLAR GENEL MÜDÜRLÜĞÜ')
        c.setFont(FONT_BOLD,20);c.drawString(19*mm,h-46*mm,'RFID ETİKETLERİ GÖNDERİ ETİKETİ')
        qr_size=53*mm
        _draw_qr(c,qr_url,w-72*mm,h-68*mm,qr_size)
        c.setFont(FONT_REG,8.6);c.drawCentredString(w-45.5*mm,h-72*mm,'QR: Teslim tutanağı PDF')
        c.setFont(FONT_BOLD,11);c.drawString(20*mm,h-64*mm,'GÖNDERİLECEK KÜTÜPHANE')
        y=_para_on(c,r['library'],_styles()['shipval'],20*mm,h-66*mm,w-106*mm)-5*mm
        c.setFont(FONT_BOLD,11);c.drawString(20*mm,y,'İL / İLÇE:')
        c.setFont(FONT_REG,12);c.drawString(51*mm,y,f"{r['province']} / {r['district']}")
        y-=10*mm
        c.setFont(FONT_BOLD,10);c.drawString(20*mm,y,'ADRES')
        y=_para_on(c,r['address'],_styles()['shipaddr'],20*mm,y-4*mm,w-40*mm)-4*mm
        c.setFont(FONT_BOLD,10);c.drawString(20*mm,y,'KÜTÜPHANE TEL:')
        c.setFont(FONT_REG,11.5);c.drawString(64*mm,y,r['phone'])
        if r.get('recipient'):
            c.setFont(FONT_REG,10);c.drawRightString(w-18*mm,y,'Teslim Alacak: '+r['recipient'][:60])
        y-=12*mm
        if y < 76*mm:raise ValueError('Gönderi etiketinde adres çok uzun; daha kısa yazın veya ayrı satırları azaltın.')
        c.setStrokeColor(colors.black);c.setLineWidth(.7);c.line(19*mm,y,w-19*mm,y)
        y-=11*mm
        c.setFont(FONT_BOLD,11);c.drawString(20*mm,y,'İÇERİK: '+r['material'][:75])
        y-=13*mm
        c.setFont(FONT_BOLD,19)
        c.drawString(20*mm,y,f"{box['labels']:,}".replace(',','.')+(' ADET RFID ETİKETİ (BU KOLİ)' if one_per_box else ' ADET RFID ETİKETİ'))
        y-=13*mm
        c.setFont(FONT_BOLD,15)
        c.drawString(20*mm,y,(f"KOLİ {box['number']} / {r['boxCount']}  •  BU KOLİDE {box['packs']} PAKET" if one_per_box else f"{r['boxCount']} KOLİ  •  {r['packCount']} PAKET"))
        c.setFont(FONT_REG,9.5)
        c.drawRightString(w-17*mm,27*mm,f"TOPLAM SEVKİYAT: {r['total']:,} ADET / {r['packCount']} PAKET / {r['boxCount']} KOLİ".replace(',','.'))
        y-=8*mm
        c.setFont(FONT_REG,10)
        c.drawString(20*mm,y,f"Paket başına {r['unitsPerPack']:,} adet / Koli başına {r['packsPerBox']} paket".replace(',','.'))
        if r['partialPackLabels'] and (not one_per_box or box['number']==r['boxCount']):
            y-=6*mm
            c.setFont(FONT_REG,9)
            c.drawString(20*mm,y,f"Son pakette: {r['partialPackLabels']:,} adet (kısmi paket)".replace(',','.'))
        c.setFont(FONT_REG,8.5)
        c.drawRightString(w-17*mm,15*mm,'Tutanak için QR kodu telefonunuzla okutunuz.')
        c.showPage()


def plan_cartons(r):
    """Distribute individual packages into physical cartons with a per-carton label count."""
    r=normalize_receipt(r) if 'packCount' not in r else r
    cartons=r['boxCount']; packs=r['packCount']; limit=r['packsPerBox'];unit=r['unitsPerPack'];remaining=r['total']
    if cartons>packs:raise ValueError('Koli sayısı paket sayısından fazla olamaz.')
    if packs>remaining:raise ValueError('Paket sayısı etiket adedinden fazla olamaz.')
    # Normal packages have the declared capacity except the final partial package.
    # Explicitly overridden packaging counts instead receive an even estimate;
    # an override cannot reveal the *actual* physical per-package quantities.
    if packs==math.ceil(remaining/unit):
        package_quantities=[unit]*(packs-1)+[remaining-(packs-1)*unit]
    else:
        q,rest=divmod(remaining,packs)
        package_quantities=[q+int(i<rest) for i in range(packs)]
    out=[];cursor=0;remaining_packs=packs
    for i in range(cartons):
        take=min(limit,remaining_packs-(cartons-i-1))
        if take<1:raise ValueError('Koli/paket dağılımı geçersiz.')
        labels=sum(package_quantities[cursor:cursor+take]);cursor+=take;remaining_packs-=take
        out.append({'number':i+1,'packs':take,'labels':labels})
    if remaining_packs or cursor!=packs:raise ValueError('Koli/paket miktarları dengelenemedi. Sayıları kontrol edin.')
    return out
