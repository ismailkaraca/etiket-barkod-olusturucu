#!/usr/bin/env python3
"""Download the official Tanex Word templates and verify their print layouts."""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from urllib.parse import urljoin, urlparse, unquote
import json, re, sys, time, zipfile
import requests
from bs4 import BeautifulSoup
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from core import inspect_template
SOURCE='https://www.tanexlabel.com/sablonlar-ve-olculer/'
TARGET=ROOT/'templates'
MODEL=re.compile(r'\bTW-\d{4}\b',re.I)
SIZE=re.compile(r'(\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?\s*mm|\d+(?:[.,]\d+)?\s*mm\s*(?:Yuvarlak|Oval)?)',re.I)
HEADERS={'User-Agent':'Mozilla/5.0 (compatible; TanexTemplateSync/1.0; library label templates)'}
def fetch(url):
    for attempt in range(3):
        try:
            r=requests.get(url,timeout=(12,35),headers=HEADERS)
            r.raise_for_status()
            if len(r.content)>8_000_000:raise ValueError('Word dosyası 8 MB üzerinde')
            return r.content
        except (requests.RequestException,ValueError):
            if attempt==2:raise
            time.sleep(1+attempt*2)
def links(page):
    soup=BeautifulSoup(page,'html.parser')
    result=[]
    codes=set()
    computer=False
    for el in soup.descendants:
        tag=getattr(el,'name',None)
        if tag in ('h1','h2','h3','h4','h5','strong'):
            if 'BİLGİSAYAR ŞABLONLARIMIZ' in el.get_text(' ',strip=True).upper():computer=True
        if tag!='a':continue
        url=urljoin(SOURCE,el.get('href',''))
        p=urlparse(url)
        if p.hostname not in ('tanexlabel.com','www.tanexlabel.com'):continue
        if '/sablondosya/' not in p.path.lower() or not p.path.lower().endswith('.docx'):continue
        parts=[]
        for prev in el.previous_elements:
            if isinstance(prev,str):
                t=' '.join(prev.split())
                if t and t.lower() not in ('indir','|'):parts.append(t)
            if len(' '.join(parts))>140:break
        ctx=' '.join(reversed(parts[-10:]))
        codes_before=MODEL.findall(ctx)
        url_code=MODEL.search(unquote(p.path))
        if computer:code='PC-'+str(1+sum(x['category']=='Bilgisayar' for x in result)).zfill(2)
        elif codes_before:code=codes_before[-1].upper()
        elif url_code:code=url_code.group().upper()
        else:continue
        if code in codes:
            if any(x['code']==code and x['url']==url for x in result):continue
            n=2
            while code+'-'+str(n) in codes:n+=1
            code+='-'+str(n)
        codes.add(code)
        row=el.find_parent('tr')
        context=row.get_text(' ',strip=True) if row else ctx
        matches=list(SIZE.finditer(context))
        if not matches:matches=list(SIZE.finditer(ctx))
        size=re.sub(r'\s+',' ',matches[-1].group(1)).strip() if matches else ''
        if not size:
            match=SIZE.search(unquote(p.path))
            if match:size=match.group(1)
        existing=sorted(TARGET.glob(code+'*.docx'))
        filename=existing[0].name if existing else code+'_'+(re.sub(r'[^a-zA-Z0-9.]+','-',size).strip('-')[:36] or 'etiket')+'.docx'
        warning=('Ürün kodu ile bağlantıdaki dosya adı uyuşmuyor' if url_code and not computer and code!=url_code.group().upper() else None)
        result.append({'code':code,'measurement':size,'category':'Bilgisayar' if computer else 'TW serisi',
                       'url':url,'filename':filename,'linkWarning':warning})
    return result
def download(item):
    p=TARGET/item['filename']
    error_note=None
    try:
        data=fetch(item['url'])
        if not zipfile.is_zipfile(BytesIO(data)):raise ValueError('Üretici geçerli DOCX göndermedi')
    except Exception as e:
        if not p.exists():return {**item,'status':'download_failed','error':str(e)[:260]}
        data=p.read_bytes()
        error_note='Üretici bağlantısı başarısız; mevcut dosya korundu: '+str(e)[:150]
    else:
        if p.exists():data=p.read_bytes()
        else:p.write_bytes(data)
    try:
        info=inspect_template(data,p.name)
        info.update({'id':p.stem,'name':item['code']+' · '+item['measurement'],
                     'model':item['code'],'measurement':item['measurement'],'category':item['category']})
        return {**item,'status':'compatible','info':info,'error':error_note}
    except Exception as e:
        return {**item,'status':'unsupported','error':str(e)[:260]}
def main():
    TARGET.mkdir(parents=True,exist_ok=True)
    items=links(fetch(SOURCE))
    print('Discovered official DOCX files:',len(items),flush=True)
    if len(items)<125:raise SystemExit('Üretici sayfasından eksik liste geldi; senkronizasyon iptal.')
    results=[]
    with ThreadPoolExecutor(max_workers=6) as pool:
        tasks=[pool.submit(download,x) for x in items]
        for task in as_completed(tasks):
            x=task.result()
            results.append(x)
            print(x['code'],x['status'],flush=True)
    results.sort(key=lambda x:(x['category']!='TW serisi',x['code']))
    names={x['filename'] for x in results}
    for p in sorted(TARGET.glob('*.docx')):
        if p.name in names:continue
        try:
            info=inspect_template(p.read_bytes(),p.name)
            info['id']=p.stem
            results.append({'code':p.stem,'measurement':'','category':'Yerel','url':None,
                            'filename':p.name,'status':'compatible','info':info})
        except Exception:pass
    report={'source':SOURCE,'generatedUTC':datetime.now(timezone.utc).isoformat(),'totalLinks':len(items),
            'compatibleCount':sum(x['status']=='compatible' for x in results),
            'unsupportedCount':sum(x['status']=='unsupported' for x in results),
            'failedCount':sum(x['status']=='download_failed' for x in results),'templates':results}
    (TARGET/'tanex_katalog.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('COUNTS',report['totalLinks'],report['compatibleCount'],report['unsupportedCount'],report['failedCount'],flush=True)
    if report['compatibleCount']<20:raise SystemExit('Uyumlu şablon sayısı yetersiz; otomatik gönderim iptal')
if __name__=='__main__':main()
