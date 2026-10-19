"""Tanex Etiket Stüdyosu — DOCX template inspection, Excel import and print layout.

Local-only application. No external service, database or telemetry.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
from collections import Counter
import math
import re
import tempfile

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt, Mm
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from PIL import ImageFont
from phone_utils import format_phone, is_phone_field

MAX_LABELS = 600
FONT_DIR = Path('/usr/share/fonts/truetype')
FONT_FILES = {
    'Arial': ['/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],
    'Calibri': ['/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],
    'Aptos': ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],
    'Times New Roman': ['/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf'],
}

def _font(pt: float, name='Arial'):
    p = next((f for f in FONT_FILES.get(name, FONT_FILES['Arial']) if Path(f).exists()),'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
    try:return ImageFont.truetype(p, max(6,round(pt*4)))  # Approximate measuring scale
    except OSError:return ImageFont.load_default(size=max(6,round(pt*4)))

def _unique_table_cells(tbl):
    seen = set(); out=[]
    for row_index, row in enumerate(tbl.rows):
        for col_index,cell in enumerate(row.cells):
            key = id(cell._tc)
            if key in seen: continue
            seen.add(key)
            out.append((row_index,col_index,cell))
    return out

def inspect_template(data: bytes, name: str) -> dict:
    if len(data)>8_000_000:raise ValueError('Word dosyası 8 MB sınırını aşıyor.')
    try: doc=Document(BytesIO(data))
    except Exception:raise ValueError('Geçerli bir .docx dosyası yükleyin.')
    if len(doc.sections)!=1:raise ValueError('İlk sürüm yalnızca tek bölümden oluşan Word şablonlarını destekliyor.')
    if len(doc.tables)!=1:raise ValueError('Word dosyası tam olarak bir ana etiket tablosu içermeli.')
    if doc.element.body.xpath('.//w:drawing') or doc.element.body.xpath('.//w:pict') or doc.element.body.xpath('.//w:txbxContent'):
        raise ValueError('Görsel, şekil veya metin kutusu içeren şablonlar bu sürümde desteklenmiyor.')
    table=doc.tables[0]; section=doc.sections[0]
    if not table.rows or not table.columns:raise ValueError('Şablonda etiket hücresi bulunamadı.')
    if any(c._tc.xpath('.//w:txbxContent') for _,_,c in _unique_table_cells(table)):
        raise ValueError('Metin kutusu içeren tablolar şu anda desteklenmiyor.')
    if any(c.tables for _,_,c in _unique_table_cells(table)):
        raise ValueError('İç içe tablolar şu anda desteklenmiyor.')
    pagew=round(section.page_width.mm,3); pageh=round(section.page_height.mm,3)
    m={'top':round((section.top_margin or Mm(0)).mm,3), 'bottom':round((section.bottom_margin or Mm(0)).mm,3),'left':round((section.left_margin or Mm(0)).mm,3),'right':round((section.right_margin or Mm(0)).mm,3)}
    # Most commercial label templates have explicit fixed row heights, and fixed grid column widths.
    widths = [round(table.cell(0,i).width.mm,2) for i in range(len(table.columns))]
    heights = [round((row.height or Mm((pageh-m['top']-m['bottom'])/len(table.rows))).mm,2) for row in table.rows]
    cells=[]
    for r,c,cell in _unique_table_cells(table):
        cells.append({'index':len(cells),'r':r,'c':c,'width':round(cell.width.mm,2),'height':heights[r], 'text':cell.text.strip()[:40]})
    if not cells:raise ValueError('Şablonda kullanılabilir hücre bulunamadı.')
    if len(cells)>600:raise ValueError('Bir sayfada en fazla 600 etiket hücresi destekleniyor.')
    return {'name':name,'page':{'width':pagew,'height':pageh},'margins':m,'rows':len(table.rows),'cols':len(table.columns),'widths':widths,'heights':heights,'cells':cells,'perPage':len(cells), 'warnings':(['Bu dosya A4 değil; Word belgesinin özgün sayfa boyutu kullanılacak.'] if not (abs(pagew-210)<3 and abs(pageh-297)<3) else [])}

def to_text(value, heading=''):
    if value is None:return ''
    if isinstance(value,bool):return 'Evet' if value else 'Hayır'
    if isinstance(value,(int,float)):
        if heading and ('tarih' in heading.casefold() or 'zaman' in heading.casefold()) and 20000<float(value)<100000:
            dt=datetime(1899,12,30)+timedelta(days=float(value))
            return dt.strftime('%d.%m.%Y %H:%M') if dt.hour or dt.minute else dt.strftime('%d.%m.%Y')
        if isinstance(value,float) and value.is_integer():return str(int(value))
    return str(value).strip()

def inspect_xlsx(file_path: str) -> dict:
    """Read workbook values using the .xlsx Open XML standard (Python stdlib).

    Works offline without a proprietary spreadsheet runtime. Cached formula results
    are used; formulas without cached results appear blank.
    """
    import zipfile
    import posixpath
    from xml.etree import ElementTree as ET

    XML_NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    REL_NS='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    PKG_NS='http://schemas.openxmlformats.org/package/2006/relationships'
    M=lambda tag:'{%s}%s' % (XML_NS,tag)
    P=lambda tag:'{%s}%s' % (PKG_NS,tag)
    try:z=zipfile.ZipFile(file_path)
    except Exception as exc:raise ValueError('Dosya XLSX/ZIP biçiminde okunamadı.') from exc
    with z:
        namelist=set(z.namelist())
        if len(namelist)>10000:raise ValueError('Excel dosyası çok fazla dahili dosya içeriyor.')
        def loadxml(name):
            if name not in namelist:raise ValueError('Eksik XLSX bileşeni: '+name)
            if z.getinfo(name).file_size>30_000_000:raise ValueError('XLSX bileşeni çok büyük: '+name)
            return ET.fromstring(z.read(name))
        book=loadxml('xl/workbook.xml')
        relroot=loadxml('xl/_rels/workbook.xml.rels')
        rels={x.attrib.get('Id'):x.attrib.get('Target','') for x in relroot.findall(P('Relationship'))}
        shared=[]
        if 'xl/sharedStrings.xml' in namelist:
            root=loadxml('xl/sharedStrings.xml')
            for si in root.findall(M('si')):
                shared.append(''.join(el.text or '' for el in si.iter(M('t'))))
        styles=[];fmt_map={}
        if 'xl/styles.xml' in namelist:
            style_root=loadxml('xl/styles.xml')
            numfmts=style_root.find(M('numFmts'))
            if numfmts is not None:
                fmt_map={int(x.attrib['numFmtId']):x.attrib.get('formatCode','') for x in numfmts.findall(M('numFmt'))}
            xfs=style_root.find(M('cellXfs'))
            if xfs is not None:styles=[int(x.attrib.get('numFmtId',0)) for x in xfs.findall(M('xf'))]
        sheets=[]
        for spec in book.findall('.//'+M('sheets')+'/'+M('sheet')):
            name=spec.attrib.get('name','Sayfa')
            target=rels.get(spec.attrib.get('{%s}id'%REL_NS,''),'')
            if not target:continue
            if target.startswith('/'):path=target.lstrip('/')
            else:path=posixpath.normpath(posixpath.join('xl',target))
            if path not in namelist:continue
            tree=loadxml(path)
            sheetdata=tree.find(M('sheetData'))
            if sheetdata is None:continue
            rawrows=[]
            for item in sheetdata.findall(M('row')):
                rowid=int(item.attrib.get('r',len(rawrows)+1))
                if rowid>6001:break
                cells={}
                for c in item.findall(M('c')):
                    ref=c.attrib.get('r','')
                    chars=re.match(r'([A-Z]+)',ref)
                    if not chars:continue
                    col=0
                    for ch in chars.group(1):col=col*26+ord(ch)-64
                    col-=1
                    if col>=120:continue
                    typ=c.attrib.get('t','n')
                    value=c.find(M('v'))
                    if typ=='inlineStr':
                        istr=c.find(M('is'))
                        val=''.join(t.text or '' for t in istr.iter(M('t'))) if istr is not None else ''
                    elif value is None:val=None
                    elif typ=='s':
                        try:val=shared[int(value.text)]
                        except (ValueError,IndexError,TypeError):val=''
                    elif typ=='b':val=value.text=='1'
                    elif typ in ('str','e'):val=value.text or ''
                    else:
                        try:
                            v=float(value.text)
                            val=int(v) if v.is_integer() else v
                            fmtid=styles[int(c.attrib.get('s',0))] if styles else 0
                            custom=fmt_map.get(fmtid,'')
                            if re.fullmatch(r'0{2,}',custom) and isinstance(val,int):val=str(val).zfill(len(custom))
                            if fmtid in {14,15,16,17,18,19,20,21,22,45,46,47} or (custom and ('dd' in custom.lower() or 'yy' in custom.lower())):
                                if 1000 < float(val) < 100000:
                                    dt=datetime(1899,12,30)+timedelta(days=float(val))
                                    val=dt.strftime('%d.%m.%Y %H:%M') if dt.hour or dt.minute else dt.strftime('%d.%m.%Y')
                        except (ValueError,TypeError,OverflowError):val=value.text
                    cells[col]=val
                rawrows.append((rowid,cells))
            if not rawrows:continue
            headers0=rawrows[0][1]
            maxcol=min(max((c for c,v in headers0.items() if v is not None and str(v).strip()),default=-1)+1,120)
            if maxcol==0:continue
            dup=Counter();heads=[]
            for c in range(maxcol):
                v=headers0.get(c)
                label=str(v).strip() if v is not None else f'Sütun {c+1}'
                if not label:label=f'Sütun {c+1}'
                dup[label]+=1
                if dup[label]>1:label=f'{label} ({dup[label]})'
                heads.append(label)
            data=[]
            for rowid,cells in rawrows[1:]:
                if not any(v is not None and str(v).strip() for v in cells.values()):continue
                data.append({'id':rowid,'values':[to_text(cells.get(c),heads[c]) for c in range(maxcol)]})
            sheets.append({'name':name,'columns':heads,'rows':data,'count':len(data)})
    if not sheets:raise ValueError('Excel dosyasında okunabilir veri bulunamadı.')
    return {'sheets':sheets}

def _text_width_mm(s, font):
    return font.getlength(s) / 4.0 * 25.4/72

def wrap_text(text: str, max_mm:float, font):
    """Preserve manual line breaks; character split only for exceptionally long words."""
    result=[]
    for paragraph in (text.split('\n') if text else ['']):
        words=paragraph.split(' ')
        line=''
        for word in words:
            trial=(line+' '+word).strip() if line else word
            if not line or _text_width_mm(trial,font)<=max_mm:
                line=trial
            else:
                result.append(line)
                line=word
            while line and _text_width_mm(line,font)>max_mm:
                cut=len(line)
                while cut>1 and _text_width_mm(line[:cut],font)>max_mm:cut-=1
                result.append(line[:cut]);line=line[cut:]
        result.append(line)
    return result

def _line_segments(line, original, start_at, heading_length, bold_heading, value_bold):
    if not line:return [],start_at
    offset=original.find(line,start_at)
    if offset<0:offset=start_at
    pieces=[];boundary=heading_length
    if offset<boundary:
        prefix=line[:max(0,min(len(line),boundary-offset))]
        if prefix:pieces.append({'text':prefix,'bold':bool(bold_heading or value_bold)})
    rest=line[max(0,boundary-offset):] if offset<boundary else line
    if rest:pieces.append({'text':rest,'bold':bool(value_bold)})
    return pieces,offset+len(line)

# Advanced designer: per-field formatting, conditional content, shipment labels,
# grouping, QR/Code128, printer offsets and matching DOCX/PDF output.
from functools import lru_cache
import base64


def _safe_mm(value, default=0, maximum=10):
    try: return max(-maximum, min(maximum, float(value)))
    except (ValueError, TypeError): return default


def _resolve_expression(expression, headers, values, qty=1):
    lookup={str(k).casefold().strip():str(values[i] if i<len(values) else '') for i,k in enumerate(headers)}
    lookup['etiket_adedi']=str(qty)
    def sub(m):
        return lookup.get(m.group(1).strip().casefold(), '')
    return re.sub(r'\{([^{}]{1,140})\}', sub, str(expression or ''))[:1000]


def _code_png(kind, value):
    value=str(value or '').strip()[:250]
    if not value:return None
    stream=BytesIO()
    if kind=='qr':
        import qrcode
        qrcode.make(value,box_size=3,border=1).convert('RGB').save(stream,format='PNG')
    else:
        from reportlab.graphics.barcode.code128 import Code128
        from PIL import Image, ImageDraw
        from string import ascii_lowercase,ascii_uppercase
        barcode=Code128(value,barHeight=30,barWidth=1,quiet=False)
        barcode.validate();barcode.encode();barcode.decompose()
        widths={'a':1,'b':2,'c':3,'d':4}
        total=sum((ord(c)-ord('a')+1) if c.islower() else (ord(c)-ord('A')+1) for c in barcode.decomposed)
        image=Image.new('RGB',(int(total*2+20),70),'white');draw=ImageDraw.Draw(image);position=10
        for char in barcode.decomposed:
            width=(ord(char)-ord('a')+1) if char.islower() else (ord(char)-ord('A')+1)
            if char.isupper():draw.rectangle([position,8,position+width*2-1,60],fill='black')
            position+=width*2
        image.save(stream,format='PNG')
    return base64.b64encode(stream.getvalue()).decode('ascii')


def _parts_for_record(headers, fields, values, opts, qty):
    if str(opts.get('mode','standard'))=='shipping':
        mapping=opts.get('shippingMap') or {}
        def mapped(k):
            idx=mapping.get(k)
            if idx is None or str(idx)=='':return ''
            try:
                n=int(idx)
                return str(values[n] if 0<=n<len(values) else '')
            except (TypeError,ValueError):return ''
        library=mapped('library');address=mapped('address');person=mapped('person');phone=format_phone(mapped('phone'))
        city=mapped('city');district=mapped('district');count=mapped('count')
        town=' / '.join(x for x in (district,city) if x.strip())
        package=mapped('package') or str(opts.get('shipmentPackage') or '').strip()
        title=str(opts.get('shippingTitle') or 'KÜTÜPHANE ETİKET GÖNDERİSİ')[:120]
        basics=[('title','',title,1.05,True),('library','',library,1.15,True),('address','Adres',address,.88,False),('town','',town,.88,True),('person','Teslim Alacak',person,.85,False),('phone','Telefon',phone,.85,False),('count','RFID Etiket Adedi',count,.85,False),('package','Paket',package,.85,False)]
        hidden=set(opts.get('shippingHidden',[]) or [])
        ordered=opts.get('shippingOrder') or [x[0] for x in basics]
        candidates={k:(h,v,scale,bold) for k,h,v,scale,bold in basics}
        parts=[]
        for key in ordered:
            if key in hidden or key not in candidates:continue
            h,v,sc,b=candidates[key]
            if str(v).strip():
                parts.append({'kind':'text','heading':h,'value':str(v),'showHeading':bool(h), 'boldHeading':False,'boldValue':b,
                              'scale':sc,'align': 'center' if key in ('title','library','town') else 'left','beforeMM':0,'indentMM':0,'color':'#192b3c','role':key})
        return parts
    field_opts=opts.get('fieldOptions') or {}
    parts=[]
    for col in fields:
        conf=field_opts.get(str(col),{}) if isinstance(field_opts,dict) else {}
        conf=conf if isinstance(conf,dict) else {}
        raw=str(values[col] if col<len(values) else '')
        heading=str(conf.get('label',headers[col]))[:160]
        if is_phone_field(headers[col]) or is_phone_field(heading):raw=format_phone(raw)
        if not raw.strip() and conf.get('omitBlank',True):continue
        part={'kind':'text','heading':heading,'value':raw,'showHeading':bool(conf.get('showHeading',opts.get('showNames',False))),
              'boldHeading':bool(conf.get('boldHeading',False)), 'boldValue':bool(conf.get('boldValue',False)),
              'scale':_safe_mm(conf.get('scale',1),1,3) or 1,'align':str(conf.get('align',opts.get('align','center'))),
              'beforeMM':max(0,_safe_mm(conf.get('beforeMM',0),0,15)),'indentMM':_safe_mm(conf.get('indentMM',0),0,10),
              'color':str(conf.get('color','#192b3c'))[:7], 'fieldIndex':col}
        parts.append(part)
    for extra in (opts.get('extraFields') or [])[:12]:
        if not isinstance(extra,dict) or extra.get('enabled',True) is False:continue
        val=_resolve_expression(extra.get('formula',''),headers,values,qty)
        if not val.strip():continue
        kind=extra.get('kind','text')
        if kind not in ('text','qr','code128'):kind='text'
        if kind=='text' and is_phone_field(extra.get('label','')):val=format_phone(val)
        parts.append({'kind':kind,'heading':str(extra.get('label',''))[:100], 'value':val,
                      'showHeading':bool(extra.get('showHeading',False)), 'boldHeading':bool(extra.get('boldHeading',False)),
                      'boldValue':bool(extra.get('boldValue',False)), 'scale':float(extra.get('scale',1)),
                      'align':extra.get('align','center'),'beforeMM':max(0,_safe_mm(extra.get('beforeMM',0),0,15)),
                      'indentMM':0,'color':'#192b3c'})
    return parts


def _layout_text(parts, width_mm, height_mm, options):
    pad=max(0,_safe_mm(options.get('padding',3),3,20))
    width=max(2,width_mm-2*pad)
    height=max(2,height_mm-2*pad)
    name=options.get('font','Arial')
    base=float(options.get('fontSize',16));mini=max(4,float(options.get('minFontSize',6)))
    maxi=max(mini,float(options.get('maxFontSize',26)))
    sizes=[max(4,min(72,base))] if options.get('manual') else [k/2 for k in range(round(maxi*2),round(mini*2)-1,-1)]
    candidate=None
    for size in sizes:
        rich=[];total_height=0;widest=0
        for i,part in enumerate(parts):
            val=str(part.get('value',''))
            if not val.strip():continue
            scale=max(.45,min(2,float(part.get('scale',1))))
            this_size=round(size*scale,2)
            before=max(0,float(part.get('beforeMM',0)))
            if rich and options.get('fieldBlankLine'):before+=size*25.4/72
            total_height+=before
            if part.get('kind') in ('qr','code128'):
                code=part['kind'];imgw=min(width*.84,14 if code=='qr' else 26);imgh=min(14 if code=='qr' else 8,imgw if code=='qr' else 8)
                try:image=_code_png(code,val)
                except Exception:image=None
                rich.append({'segments':[], 'kind':code,'code':val,'imageData':image,'imageW':imgw,'imageH':imgh,
                             'size':this_size,'align':part.get('align','center'),'beforeMM':before,'indentMM':0,'fieldIndex':part.get('fieldIndex'),'role':part.get('role')})
                total_height+=imgh;widest=max(widest,imgw)
                continue
            heading=str(part.get('heading',''))
            prefix=(heading+': ') if part.get('showHeading') and heading else ''
            original=prefix+val
            font=_font(this_size,name)
            indent=float(part.get('indentMM',0));local_width=max(2,width-max(indent,0))
            wrapped=wrap_text(original,local_width,font)
            offset=0
            for j,line in enumerate(wrapped):
                chunks,offset=_line_segments(line,original,offset,len(prefix),part.get('boldHeading',False),part.get('boldValue',False) or options.get('bold',False))
                color=part.get('color','#192b3c')
                for seg in chunks:seg['color']=color
                rich.append({'segments':chunks,'kind':'text','size':this_size,'align':part.get('align',options.get('align','center')),
                             'beforeMM':before if j==0 else 0,'indentMM':indent,'fieldIndex':part.get('fieldIndex'),'role':part.get('role')})
                widest=max(widest,_text_width_mm(line,font)+max(indent,0))
                total_height+=this_size*25.4/72*1.23
        if not rich:rich=[{'segments':[],'kind':'text','size':size,'align':'center','beforeMM':0,'indentMM':0}]
        overflow=total_height>height+.1 or widest>width+.2
        candidate={'size':size,'richLines':rich,'lines':[''.join(s['text'] for s in r['segments']) if r['kind']=='text' else '[KOD]' for r in rich],
                   'overflow':overflow,'heightMM':round(total_height,2),'usableHeightMM':round(height,2),'usableWidthMM':round(width,2)}
        if not overflow:break
    return candidate


def compose_labels(template,request):
    headers=list(request.get('headers') or []);fields=[int(i) for i in (request.get('fields') or [])]
    opts=request.get('options') or {}
    if not fields and opts.get('mode')!='shipping' and not opts.get('extraFields'):raise ValueError('Yazdırılacak en az bir sütun seçmelisin.')
    if any(i<0 or i>=len(headers) for i in fields):raise ValueError('Sütun bilgileri hatalı.')
    first=int(request.get('start',0))
    if not 0<=first<template['perPage']:raise ValueError('Başlangıç etiketi geçersiz.')
    records=list(request.get('records') or [])
    group_col=opts.get('groupField',None)
    if group_col not in (None,''):
        group_col=int(group_col)
        if not 0<=group_col<len(headers):raise ValueError('Gruplama sütunu geçersiz.')
        records.sort(key=lambda r: str((r.get('values') or ['']*len(headers))[group_col] or '').casefold())
    else:group_col=None
    per=template['perPage'];positions=[None]*first;last_group=None;blank_groups=0
    for rec in records:
        copies=int(rec.get('qty',1))
        if not 0<=copies<=200:raise ValueError('Bir kayıt en fazla 200 etikete çoğaltılabilir.')
        if not copies:continue
        vals=list(rec.get('values') or [])
        group=str(vals[group_col] if group_col is not None and group_col<len(vals) else '') if group_col is not None else None
        if group_col is not None and opts.get('groupNewPage') and last_group is not None and group!=last_group:
            blanks=(-len(positions))%per;positions.extend([None]*blanks);blank_groups+=blanks
        last_group=group
        parts=_parts_for_record(headers,fields,vals,opts,copies)
        for _ in range(copies):positions.append({'sourceRow':rec.get('id'),'parts':parts,'group':group})
        if sum(v is not None for v in positions)>MAX_LABELS:raise ValueError(f'En fazla {MAX_LABELS} etiket oluşturulabilir.')
    total=sum(v is not None for v in positions)
    if not total:raise ValueError('En az bir kayıt ve etiket adedi seçmelisin.')
    page_count=math.ceil(len(positions)/per)
    if page_count>200:raise ValueError('Çok fazla sayfa oluştu.')
    pages=[];overflows=0
    for pg in range(page_count):
        page=[]
        for i,geom in enumerate(template['cells']):
            j=pg*per+i
            obj=positions[j] if j<len(positions) else None
            if obj is None:page.append(None);continue
            layout=_layout_text(obj['parts'],geom['width'],geom['height'],opts)
            if layout['overflow']:overflows+=1
            page.append({'sourceRow':obj['sourceRow'],'position':i+1,'text':layout,'parts':obj['parts'],'group':obj['group']})
        pages.append(page)
    return {'pages':pages,'total':total,'pageCount':page_count,'overflowCount':overflows,'start':first,'groupBlankCount':blank_groups}


def _apply_color(run,hexa):
    from docx.shared import RGBColor
    try:
        color=hexa.lstrip('#')
        if len(color)==6:run.font.color.rgb=RGBColor.from_string(color.upper())
    except (ValueError,TypeError):pass


def _replace_contents(cell,rich_lines,font_size,options):
    tc=cell._tc
    for node in list(tc):
        if node.tag!=qn('w:tcPr'):tc.remove(node)
    pad=max(0,_safe_mm(options.get('padding',3),3,20))
    props=tc.get_or_add_tcPr(); mar=props.find(qn('w:tcMar'))
    if mar is None:mar=OxmlElement('w:tcMar');props.append(mar)
    for side in ('top','left','bottom','right'):
        element=mar.find(qn('w:'+side))
        if element is None:element=OxmlElement('w:'+side);mar.append(element)
        element.set(qn('w:w'),str(round(pad*56.692913)));element.set(qn('w:type'),'dxa')
    cell.vertical_alignment={'top':WD_CELL_VERTICAL_ALIGNMENT.TOP,'center':WD_CELL_VERTICAL_ALIGNMENT.CENTER,'bottom':WD_CELL_VERTICAL_ALIGNMENT.BOTTOM}.get(options.get('vertical','center'),WD_CELL_VERTICAL_ALIGNMENT.CENTER)
    from docx.text.paragraph import Paragraph
    for part in rich_lines or [{'segments':[],'size':font_size,'align':'center','beforeMM':0,'indentMM':0,'kind':'text'}]:
        p=OxmlElement('w:p');tc.append(p);para=Paragraph(p,cell)
        para.alignment={'left':WD_ALIGN_PARAGRAPH.LEFT,'center':WD_ALIGN_PARAGRAPH.CENTER,'right':WD_ALIGN_PARAGRAPH.RIGHT}.get(part.get('align','center'),WD_ALIGN_PARAGRAPH.CENTER)
        pf=para.paragraph_format;pf.space_before=Mm(float(part.get('beforeMM',0)));pf.space_after=Pt(0);pf.line_spacing=1.0
        pf.left_indent=Mm(max(0,float(part.get('indentMM',0))))
        if part.get('kind') in ('qr','code128') and part.get('imageData'):
            run=para.add_run();run.add_picture(BytesIO(base64.b64decode(part['imageData'])),width=Mm(part['imageW']),height=Mm(part['imageH']))
        else:
            for seg in part.get('segments',[]):
                run=para.add_run(seg.get('text',''));run.font.name=options.get('font','Arial');run.font.size=Pt(part.get('size',font_size));run.font.bold=bool(seg.get('bold',False))
                _apply_color(run,seg.get('color','#192b3c'))


def _calibrate_doc(doc,opts):
    x=_safe_mm(opts.get('offsetX',0),0,5);y=_safe_mm(opts.get('offsetY',0),0,5)
    s=doc.sections[0]
    if x and (s.left_margin.mm+x)>=0 and (s.right_margin.mm-x)>=0:
        s.left_margin=Mm(s.left_margin.mm+x);s.right_margin=Mm(s.right_margin.mm-x)
    if y and (s.top_margin.mm+y)>=0 and (s.bottom_margin.mm-y)>=0:
        s.top_margin=Mm(s.top_margin.mm+y);s.bottom_margin=Mm(s.bottom_margin.mm-y)


def export_docx(template_data,template,composition,options):
    doc=Document(BytesIO(template_data));_calibrate_doc(doc,options);table=doc.tables[0]
    for paragraph in list(doc.paragraphs):
        if not paragraph.text and not paragraph._p.xpath('.//w:drawing') and not paragraph._p.xpath('.//w:pict'):
            paragraph._p.getparent().remove(paragraph._p)
    original=deepcopy(table._tbl)
    for num,page in enumerate(composition['pages']):
        if num:
            p=doc.add_paragraph();p.paragraph_format.page_break_before=True;p.paragraph_format.space_before=Pt(0);p.paragraph_format.space_after=Pt(0);p.paragraph_format.line_spacing=Pt(.1)
            r=p.add_run();r.font.size=Pt(1)
            tb=deepcopy(original);p._p.addnext(tb)
            from docx.table import Table
            tbl=Table(tb,doc._body)
        else:tbl=table
        for index,(_,_,cell) in enumerate(_unique_table_cells(tbl)):
            obj=page[index] if index<len(page) else None
            _replace_contents(cell,obj['text']['richLines'] if obj else [],obj['text']['size'] if obj else 8,options)
    for para in doc.paragraphs:
        if not para.text and not para._p.xpath('.//w:br') and not para._p.xpath('.//w:pPr/w:pageBreakBefore'):
            para.paragraph_format.space_after=Pt(0);para.paragraph_format.space_before=Pt(0);para.paragraph_format.line_spacing=1
            for r in para.runs:r.font.size=Pt(1)
    buffer=BytesIO();doc.save(buffer);return buffer.getvalue()


def export_pdf(template,composition,options):
    """Physical size PDF output; text metrics approximate MS Word's native fonts."""
    from reportlab.pdfgen import canvas
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.lib.colors import HexColor
    import textwrap
    font_path=next((p for p in FONT_FILES.get(options.get('font','Arial'), FONT_FILES['Arial']) if Path(p).exists()),None)
    reg='Helvetica';bold='Helvetica-Bold'
    if font_path:
        try:
            pdfmetrics.registerFont(TTFont('TanexRegular',font_path));reg='TanexRegular'
            bold_path=font_path.replace('Regular','Bold').replace('-Regular','-Bold')
            if Path(bold_path).is_file():pdfmetrics.registerFont(TTFont('TanexBold',bold_path));bold='TanexBold'
            else:bold=reg
        except Exception:pass
    mm=72/25.4;buf=BytesIO();w=template['page']['width'];h=template['page']['height'];c=canvas.Canvas(buf,pagesize=(w*mm,h*mm),pageCompression=1)
    xp=[];x=template['margins']['left'];yp=[];y=template['margins']['top']
    for wd in template['widths']:xp.append(x);x+=wd
    for ht in template['heights']:yp.append(y);y+=ht
    offx=_safe_mm(options.get('offsetX',0),0,5);offy=_safe_mm(options.get('offsetY',0),0,5)
    pad=max(0,_safe_mm(options.get('padding',3),3,20))
    for page in composition['pages']:
        for cell,item in zip(template['cells'],page):
            if not item:continue
            geo_x=xp[cell['c']]+offx;geo_y=yp[cell['r']]+offy;geom_w=cell['width'];geom_h=cell['height']
            info=item['text'];lines=info['richLines'];actual_h=info['heightMM']
            cursor={'top':geo_y+pad,'center':geo_y+(geom_h-actual_h)/2,'bottom':geo_y+geom_h-pad-actual_h}.get(options.get('vertical','center'),geo_y+pad)
            for line in lines:
                cursor+=line.get('beforeMM',0)
                if line.get('kind') in ('qr','code128') and line.get('imageData'):
                    iw,ih=line['imageW'],line['imageH']
                    px=geo_x+(geom_w-iw)/2
                    c.drawImage(ImageReader(BytesIO(base64.b64decode(line['imageData']))),px*mm,(h-cursor-ih)*mm,iw*mm,ih*mm,mask='auto')
                    cursor+=ih;continue
                segs=line.get('segments',[]);pt=line.get('size',info['size']);th=pt*25.4/72*1.23
                full=''.join(s.get('text','') for s in segs)
                totalwidth=sum(pdfmetrics.stringWidth(s.get('text',''),bold if s.get('bold') else reg,pt) for s in segs)/mm
                if line.get('align')=='right':xx=geo_x+geom_w-pad-totalwidth
                elif line.get('align')=='left':xx=geo_x+pad+max(0,line.get('indentMM',0))
                else:xx=geo_x+(geom_w-totalwidth)/2
                for seg in segs:
                    name=bold if seg.get('bold') else reg
                    c.setFont(name,pt)
                    try:c.setFillColor(HexColor(seg.get('color','#192b3c')))
                    except ValueError:c.setFillColor(HexColor('#192b3c'))
                    c.drawString(xx*mm,(h-cursor-th*.83)*mm,seg.get('text',''))
                    xx+=pdfmetrics.stringWidth(seg.get('text',''),name,pt)/mm
                cursor+=th
        c.showPage()
    c.save();return buf.getvalue()


def validate_records(headers,records,fields,options):
    """Advisory checks only; never reject printable data based on heuristics."""
    duplicates={};out=[];counts={'empty':0,'duplicate':0,'long':0,'zero':0}
    for rec in records:
        vals=rec.get('values') or [];rid=rec.get('id');issues=[]
        check_fields=fields
        if options.get('mode')=='shipping':
            check_fields=[]
            for v in (options.get('shippingMap') or {}).values():
                try:
                    i=int(v)
                    if 0<=i<len(headers):check_fields.append(i)
                except (TypeError,ValueError):pass
        selected=' | '.join(str(vals[i] if i<len(vals) else '').strip() for i in check_fields)
        if not selected.strip(' |'):issues.append('Seçili alanların tamamı boş');counts['empty']+=1
        if selected and selected in duplicates:
            issues.append(f'Tekrarlanan kayıt ({duplicates[selected]}. satır ile aynı)');counts['duplicate']+=1
        else:duplicates[selected]=rid
        if any(len(str(vals[i] if i<len(vals) else ''))>160 for i in check_fields):issues.append('160 karakterden uzun alan');counts['long']+=1
        if int(rec.get('qty',1))<=0:issues.append('Etiket adedi sıfır');counts['zero']+=1
        if issues:out.append({'id':rid,'issues':issues})
    return {'issues':out,'summary':counts,'checked':len(records)}


def export_calibration_pdf(template,options):
    """Printable test sheet with physical label borders and center fiducials."""
    from reportlab.pdfgen import canvas
    from reportlab.lib.colors import HexColor
    mm=72/25.4;w=template['page']['width'];h=template['page']['height']
    b=BytesIO();c=canvas.Canvas(b,pagesize=(w*mm,h*mm))
    xp=[];x=template['margins']['left'];yp=[];y=template['margins']['top']
    for wd in template['widths']:xp.append(x);x+=wd
    for ht in template['heights']:yp.append(y);y+=ht
    offx=_safe_mm(options.get('offsetX',0),0,5);offy=_safe_mm(options.get('offsetY',0),0,5)
    c.setStrokeColor(HexColor('#7A8898'));c.setLineWidth(.35)
    for item in template['cells']:
        x=xp[item['c']]+offx;y=yp[item['r']]+offy;cw=item['width'];ch=item['height']
        c.rect(x*mm,(h-y-ch)*mm,cw*mm,ch*mm,fill=0,stroke=1)
        midx=(x+cw/2)*mm;midy=(h-y-ch/2)*mm
        c.line(midx-4,midy,midx+4,midy);c.line(midx,midy-4,midx,midy+4)
        c.setFont('Helvetica',5);c.drawString((x+1)*mm,(h-y-3)*mm,str(item['index']+1))
    c.setFont('Helvetica',7);c.drawString(4*mm,2*mm,'Tanex calibration | print at 100% / actual size')
    c.showPage();c.save();return b.getvalue()
