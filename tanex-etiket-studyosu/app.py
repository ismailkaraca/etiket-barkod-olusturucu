"""Tanex label designer: local and stateless Vercel deployments."""
from __future__ import annotations
import json
import base64
import binascii
import os
import re
import tempfile
import webbrowser
from pathlib import Path
from uuid import uuid4
from io import BytesIO

from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.responses import HTMLResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn
from core import inspect_template, inspect_xlsx, compose_labels, export_docx

ROOT=Path(__file__).resolve().parent
TEMPLATES=ROOT/'templates'
IS_VERCEL=bool(os.environ.get('VERCEL'))
STATIC=ROOT/'static'
DEFAULT_TEMPLATE_ID='TW-223370x25.4mm'
app=FastAPI(title='Tanex Etiket Stüdyosu',docs_url=None,redoc_url=None)
app.mount('/static',StaticFiles(directory=str(STATIC)),name='static')


def catalog():
    """Fast startup: use prevalidated template metadata from the import workflow.

    Existing 4 user-provided templates remain available even when a manufacturer
    source link breaks. Unsupported originals are kept in the GitHub archive,
    but are not offered for printing.
    """
    catalog_file=TEMPLATES/'tanex_katalog.json'
    out=[];seen=set();stats=None
    if catalog_file.is_file():
        try:
            with catalog_file.open(encoding='utf-8') as fh:manifest=json.load(fh)
            stats={k:manifest.get(k) for k in ('totalLinks','compatibleCount','unsupportedCount','failedCount','source','generatedUTC')}
            for item in manifest.get('templates',[]):
                if item.get('status')!='compatible':continue
                path=TEMPLATES/item['filename']
                if not path.is_file():continue
                info=item['info'].copy()
                info['id']=path.stem
                if info['id'] in seen:continue
                seen.add(info['id']);out.append(info)
        except (ValueError,KeyError,TypeError,OSError):
            stats=None
    # Extras added manually or before a full Tanex sync.
    for file in sorted(TEMPLATES.glob('*.docx')):
        if file.stem in seen:continue
        try:
            inf=inspect_template(file.read_bytes(),file.name)
            inf['id']=file.stem
            seen.add(inf['id']);out.append(inf)
        except Exception:continue
    out.sort(key=lambda item: (item['id'] != DEFAULT_TEMPLATE_ID, item.get('model',item['name']).casefold()))
    return out,stats

@app.get('/',response_class=HTMLResponse)
def home():return (STATIC/'index.html').read_text(encoding='utf-8')

@app.get('/api/templates')
def template_list():
    templates,stats=catalog()
    return {'templates':templates,'defaultTemplateId':DEFAULT_TEMPLATE_ID,'catalogStats':stats}

@app.post('/api/templates')
async def new_template(file: UploadFile=File(...)):
    if not (file.filename or '').lower().endswith('.docx'):
        raise HTTPException(400,'Yalnızca .docx Word şablonları kabul edilir.')
    data=await file.read()
    if len(data)>2_000_000:
        raise HTTPException(400,'Çevrimiçi şablon boyutu en fazla 2 MB olabilir.')
    try:info=inspect_template(data,file.filename or 'Yeni şablon')
    except ValueError as e:raise HTTPException(400,str(e))
    name=re.sub(r'[^\w.\-]+','_',Path(file.filename).stem,flags=re.UNICODE)[:65]
    final=f'{name}_{uuid4().hex[:8]}'
    info['id']=final
    if not IS_VERCEL:
        (TEMPLATES/(final+'.docx')).write_bytes(data)
    # Cloud browsers save this template themselves (IndexedDB), never Vercel filesystem.
    return {'template':info,'mode':'browser' if IS_VERCEL else 'disk'}

@app.post('/api/excel')
async def excel(file: UploadFile=File(...)):
    filename=file.filename or ''
    if not filename.lower().endswith('.xlsx'):raise HTTPException(400,'Yalnızca .xlsx Excel dosyaları destekleniyor.')
    data=await file.read()
    if len(data)>(4_000_000 if IS_VERCEL else 15_000_000):raise HTTPException(400,'Excel dosyası sunucu yükleme sınırını aşıyor (çevrimiçi: 4 MB).')
    with tempfile.TemporaryDirectory() as tmp:
        loc=Path(tmp)/'input.xlsx';loc.write_bytes(data)
        try:return inspect_xlsx(str(loc))
        except Exception as e:raise HTTPException(400,f'Excel dosyası okunamadı: {e}')

class ComposeRequest(BaseModel):
    templateId:str
    templateData:str|None=None
    headers:list[str]
    fields:list[int]
    records:list[dict]
    start:int=0
    options:dict={}

def compose_from_request(payload:ComposeRequest):
    if len(payload.templateId)>130 or not re.fullmatch(r'[\w.\-]+', payload.templateId):
        raise HTTPException(400,'Geçersiz şablon kimliği.')
    if payload.templateData:
        if len(payload.templateData)>2_800_000:
            raise HTTPException(413,'Word şablonu 2 MB sınırını aşıyor.')
        try:buf=base64.b64decode(payload.templateData, validate=True)
        except (ValueError,binascii.Error):raise HTTPException(400,'Şablon verisi geçersiz.')
        try:template=inspect_template(buf,payload.templateId+'.docx')
        except ValueError as e:raise HTTPException(400,str(e))
    else:
        path=TEMPLATES/(payload.templateId+'.docx')
        if not path.is_file():raise HTTPException(404,'Şablon bulunamadı. Tekrar yükleyin.')
        buf=path.read_bytes()
        template=inspect_template(buf,path.name)
    try: comp=compose_labels(template,payload.model_dump())
    except (ValueError,TypeError,OverflowError,IndexError) as e:raise HTTPException(400,str(e))
    return template,comp,buf

@app.post('/api/preview')
def preview(payload:ComposeRequest):
    template,comp,_=compose_from_request(payload)
    return comp

@app.post('/api/export')
def download(payload:ComposeRequest):
    template,comp,buf=compose_from_request(payload)
    try:result=export_docx(buf,template,comp,payload.options)
    except Exception as e:raise HTTPException(500,f'Word çıktısı oluşturulamadı: {e}')
    return Response(content=result,media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',headers={'Content-Disposition':'attachment; filename="tanex_etiketler.docx"','X-Labels':str(comp['total']),'X-Pages':str(comp['pageCount'])})

# Print-ready PDF uses the same computed page order and label geometry as DOCX.
@app.post('/api/export-pdf')
def download_pdf(payload:ComposeRequest):
    from core import export_pdf
    template,comp,_=compose_from_request(payload)
    try:result=export_pdf(template,comp,payload.options)
    except Exception as e:raise HTTPException(500,f'PDF çıktısı hazırlanamadı: {e}')
    return Response(content=result,media_type='application/pdf',headers={'Content-Disposition':'attachment; filename="tanex_etiketler.pdf"'})

@app.post('/api/calibration')
def calibration_page(payload:ComposeRequest):
    from core import export_calibration_pdf
    template,_,_=compose_from_request(payload)
    return Response(content=export_calibration_pdf(template,payload.options),media_type='application/pdf',headers={'Content-Disposition':'attachment; filename=tanex_kalibrasyon.pdf'})

@app.post('/api/check')
def check_records(payload:ComposeRequest):
    from core import validate_records
    return validate_records(payload.headers,payload.records,payload.fields,payload.options)

class ExcelExportRequest(BaseModel):
    headers:list[str]
    records:list[dict]

@app.post('/api/export-excel')
def export_edited_excel(payload:ExcelExportRequest):
    if len(payload.headers)>120 or len(payload.records)>6000:
        raise HTTPException(400,'Excel çıktı sınırı aşıldı.')
    import xlsxwriter
    output=BytesIO()
    workbook=xlsxwriter.Workbook(output,{'in_memory':True,'strings_to_urls':False})
    worksheet=workbook.add_worksheet('Düzenlenen Veriler')
    headerfmt=workbook.add_format({'bold':True,'bg_color':'#DBEAFE','border':1})
    for j,header in enumerate(payload.headers):worksheet.write_string(0,j,str(header)[:500],headerfmt)
    for i,row in enumerate(payload.records,1):
        for j,cell in enumerate(row.get('values',[])[:len(payload.headers)]):
            # Persist text exactly, including postal codes and phone leading zeros.
            worksheet.write_string(i,j,str(cell or '')[:32000])
    worksheet.freeze_panes(1,0);worksheet.autofilter(0,0,max(1,len(payload.records)),max(0,len(payload.headers)-1))
    for col in range(min(len(payload.headers),120)):worksheet.set_column(col,col,23)
    workbook.close()
    return Response(content=output.getvalue(),media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',headers={'Content-Disposition':'attachment; filename="duzenlenmis_excel.xlsx"'})



# --- Independent landscape-A4 shipping label / RFID handover receipt studio ---
class ShipmentBatch(BaseModel):
    records:list[dict]
    onePerBox:bool=True

class QRReceipt(BaseModel):
    token:str

@app.get('/gonderi', response_class=HTMLResponse)
def shipping_studio():
    return (STATIC/'gonderi.html').read_text(encoding='utf-8')

@app.get('/tutanak', response_class=HTMLResponse)
def receipt_qr_page():
    return (STATIC/'tutanak.html').read_text(encoding='utf-8')

@app.post('/api/gonderi/hesapla')
def calculate_shipping(payload:ShipmentBatch):
    from shipping import normalize_receipt,plan_cartons
    try:
        return {'records':[dict(normalize_receipt(x),boxPlan=plan_cartons(normalize_receipt(x))) for x in payload.records]}
    except ValueError as e:raise HTTPException(400,str(e))

@app.post('/api/gonderi/etiket-pdf')
def shipment_document(payload:ShipmentBatch,request:Request):
    from shipping import shipping_label_pdf
    # Point to the stable production alias; an immutable preview deployment must not appear in QR links.
    public=os.environ.get('SHIPPING_PUBLIC_URL',
        'https://etiket-barkod-olusturucu-h6aa.vercel.app' if IS_VERCEL else str(request.base_url).rstrip('/'))
    try:output=shipping_label_pdf(payload.records,public,payload.onePerBox)
    except ValueError as e:raise HTTPException(400,str(e))
    return Response(content=output,media_type='application/pdf',headers={
        'Content-Disposition':'attachment; filename="rfid_gonderi_etiketleri_A4_yatay.pdf"',
        'Cache-Control':'no-store','Referrer-Policy':'no-referrer'})

@app.post('/api/tutanak/pdf')
def receipt_document(payload:ShipmentBatch):
    from shipping import receipt_pdf
    try:output=receipt_pdf(payload.records)
    except ValueError as e:raise HTTPException(400,str(e))
    return Response(content=output,media_type='application/pdf',headers={
       'Content-Disposition':'attachment; filename="rfid_etiket_teslim_tutanaklari.pdf"','Cache-Control':'no-store'})

@app.post('/api/tutanak/qr-pdf')
def receipt_by_qr(payload:QRReceipt):
    from shipping import decode_receipt,receipt_pdf
    try:receipt=decode_receipt(payload.token);output=receipt_pdf([receipt])
    except ValueError as e:raise HTTPException(400,str(e))
    return Response(content=output,media_type='application/pdf',headers={
       'Content-Disposition':'attachment; filename="rfid_etiket_teslim_tutanagi.pdf"','Cache-Control':'no-store','Referrer-Policy':'no-referrer'})

if __name__=='__main__':
    print('Tanex Etiket Stüdyosu yerel adres: http://127.0.0.1:8765')
    uvicorn.run(app,host='127.0.0.1',port=8765,log_level='warning')
