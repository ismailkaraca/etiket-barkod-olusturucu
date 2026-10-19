"""Normal etiket, gönderi etiketi ve PDF/Word için telefon regresyon testi."""
from pathlib import Path
from io import BytesIO
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from docx import Document
from core import _parts_for_record, compose_labels, inspect_template, export_docx, export_pdf
from phone_utils import format_phone, is_phone_field
from shipping import format_phone as format_shipping_phone

def test_phone():
    for input_value in ['02125424081','2125424081','+90 212 542 40 81','00902125424081','2125424081.0','+212) 542-40-81','(212) 542-40-81']:
        assert format_phone(input_value)=='(212) 542-40-81', input_value
        assert format_phone(input_value)==format_shipping_phone(input_value),input_value
    assert format_phone('12345')=='12345'
    for name in ['Telefon','Cep Telefonu','GSM','tel. no','phone','Kütüphane Telefonu']:
        assert is_phone_field(name),name
    for name in ['Barkod','RFID Etiket Miktarı','Talep Miktarı','Kütüphane Adı','ISBN']:
        assert not is_phone_field(name),name
    headers=['Kütüphane Adı','Cep Telefonu','RFID Etiket Adedi','ISBN']
    values=['Deneme Halk Kütüphanesi','02125424081','2125424081','9782125424081']
    opts={'fieldOptions':{'1':{'label':'İletişim','showHeading':True},'2':{'label':'Adet'}}}
    parts=_parts_for_record(headers,[0,1,2,3],values,opts,1)
    assert [p['value'] for p in parts]==['Deneme Halk Kütüphanesi','(212) 542-40-81','2125424081','9782125424081']
    ship=_parts_for_record(headers,[],values,{'mode':'shipping','shippingMap':{'phone':'1'}},1)
    assert next(p for p in ship if p['role']=='phone')['value']=='(212) 542-40-81'
    extras=_parts_for_record(headers,[],values,{'extraFields':[{'kind':'text','label':'Telefon','formula':'{Cep Telefonu}'}]},1)
    assert extras[0]['value']=='(212) 542-40-81'
    path=Path(__file__).resolve().parents[1]/'templates'/'TW-223370x25.4mm.docx'
    template=path.read_bytes();meta=inspect_template(template,path.name)
    request={'headers':headers,'fields':[0,1,2,3],'records':[{'id':2,'qty':1,'values':values}], 'options':{'fieldOptions':opts['fieldOptions'],'font':'Arial','fontSize':10,'padding':1,'manual':True}}
    result=compose_labels(meta,request)
    text='\n'.join(next(x for x in result['pages'][0] if x)['text']['lines'])
    assert '(212) 542-40-81' in text and '2125424081' in text and '9782125424081' in text
    doc=Document(BytesIO(export_docx(template,meta,result,request['options'])))
    contents=' '.join(c.text for table in doc.tables for row in table.rows for c in row.cells)
    assert '(212) 542-40-81' in contents and '+212)' not in contents
    assert export_pdf(meta,result,request['options']).startswith(b'%PDF')
if __name__=='__main__':test_phone();print('PASS')
