"""Turkish phone formatting in QR, receipts and shipping PDFs."""
import unittest
from shipping import format_phone, normalize_receipt, compact_receipt, decode_receipt, receipt_pdf, shipping_label_pdf

class PhoneDisplayTests(unittest.TestCase):
    def test_variants(self):
        for original in ('02125424081','2125424081','+90 212 542 40 81','2125424081.0','(212) 542-40-81'):
            with self.subTest(original=original):
                self.assertEqual(format_phone(original), '(212) 542-40-81')
        self.assertEqual(format_phone('05418504272'), '(541) 850-42-72')
        self.assertEqual(format_phone('12345'), '12345')
    def test_receipt_and_qr(self):
        original=dict(province='İSTANBUL',district='BEYOĞLU',library='Deneme Halk Kütüphanesi',address='Deneme Mahallesi No: 1 Beyoğlu İstanbul',phone='02125424081',material='RFID Etiketi',total=9000)
        normalized=normalize_receipt(original)
        self.assertEqual(normalized['phone'], '(212) 542-40-81')
        self.assertEqual(decode_receipt(compact_receipt(normalized))['phone'], '(212) 542-40-81')
        self.assertTrue(receipt_pdf([original]).startswith(b'%PDF'))
        self.assertTrue(shipping_label_pdf([original],'https://etiket-barkod-olusturucu-h6aa.vercel.app',True).startswith(b'%PDF'))

if __name__ == '__main__':
    unittest.main()
