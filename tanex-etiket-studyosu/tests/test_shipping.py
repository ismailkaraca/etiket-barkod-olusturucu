"""Delivery receipt / landscape shipping smoke tests based on user supplied form."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import fitz
from fastapi.testclient import TestClient
from app import app
from shipping import normalize_receipt,plan_cartons,compact_receipt,decode_receipt
SAMPLE={
 'province':'ANKARA','district':'SİNCAN','library':'Sincan İlçe Halk Kütüphanesi',
 'address':'Atatürk Mahallesi No:1 Sincan/Ankara','phone':'0312 000 00 00',
 'material':'UHF RFID Kütüphane Etiketi (Şerit)','total':15000,'unitsPerPack':1000,'packsPerBox':9,
}
def test_two_boxes():
    p=plan_cartons(normalize_receipt(SAMPLE))
    assert [x['labels'] for x in p]==[9000,6000]
    assert [x['packs'] for x in p]==[9,6]
def test_landscape_a4_per_box_and_receipt():
    api=TestClient(app)
    res=api.post('/api/gonderi/etiket-pdf',json={'records':[SAMPLE],'onePerBox':True})
    assert res.status_code==200
    pdf=fitz.open(stream=res.content,filetype='pdf')
    assert len(pdf)==2 and pdf[0].rect.width>pdf[0].rect.height
    assert '9.000' in pdf[0].get_text() and '6.000' in pdf[1].get_text()
    res=api.post('/api/tutanak/pdf',json={'records':[SAMPLE]})
    assert res.status_code==200
    pdf=fitz.open(stream=res.content,filetype='pdf')
    assert len(pdf)==1 and pdf[0].rect.width<pdf[0].rect.height
    assert 'TESLİM EDİLEN MALZEME' in pdf[0].get_text()
def test_qr_receipt_generated_statelessly():
    token=compact_receipt(normalize_receipt(SAMPLE))
    assert decode_receipt(token)['library']==SAMPLE['library']
    res=TestClient(app).post('/api/tutanak/qr-pdf',json={'token':token})
    assert res.status_code==200 and res.content[:4]==b'%PDF'
    assert TestClient(app).post('/api/tutanak/qr-pdf',json={'token':'INVALIDTOKEN'}).status_code==400
def test_required_and_override():
    bad={**SAMPLE,'phone':''}
    assert TestClient(app).post('/api/tutanak/pdf',json={'records':[bad]}).status_code==400
    alt={**SAMPLE,'total':5000,'packCountOverride':6,'boxCountOverride':2}
    plan=plan_cartons(normalize_receipt(alt))
    assert sum(x['labels'] for x in plan)==5000 and all(x['labels']>0 for x in plan)
