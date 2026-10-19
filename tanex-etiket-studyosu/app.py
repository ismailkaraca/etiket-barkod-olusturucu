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
app=FastAPI(title='Tanex Etiket Stüdyosu',docs_url=None,redoc_url=None)
app.mount('/static',StaticFiles(directory=str(STATIC)),name='static')


def catalog():
    out=[]
    for file in sorted(TEMPLATES.glob('*.docx')):
        try:
            buf=file.read_bytes()
            inf=inspect_template(buf,file.name)
            inf['id']=file.stem
            out.append(inf)
        except Exception:continue
    return out

@app.get('/',response_class=HTMLResponse)
def home():return (STATIC/'index.html').read_text(encoding='utf-8')

@app.get('/api/templates')
def template_list():return {'templates':catalog()}

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

if __name__=='__main__':
    print('Tanex Etiket Stüdyosu yerel adres: http://127.0.0.1:8765')
    uvicorn.run(app,host='127.0.0.1',port=8765,log_level='warning')
