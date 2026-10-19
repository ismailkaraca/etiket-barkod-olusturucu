# RFID Gönderi Etiketi / Teslim Tutanağı — Tanex Etiket Stüdyosu

Kütüphaneler ve Yayımlar Genel Müdürlüğü'nün 2025 yılı UHF RFID Etiket Alımı teslim tutanağı örneğine göre hazırlanmıştır.

## URL'ler

- `/gonderi`: yeni yatay A4 gönderi etiketi + teslim tutanağı stüdyosu
- `/tutanak#d=...`: QR okutulunca otomatik PDF oluşturmaya çalışan indirme ekranı
- `/api/gonderi/etiket-pdf`: POST, PDF, isteğe bağlı her koli için 1 A4 sayfa
- `/api/tutanak/pdf`: POST, tutanakları A4 dikey sayfa halinde tek PDF olarak indirme
- `/api/tutanak/qr-pdf`: POST, QR tokenından tek imzasız tutanak PDF oluşturma
- `/api/gonderi/hesapla`: POST, miktar ve koli/paket hesapları

## Form ve Excel

Zorunlu alanlar: **İl, İlçe, Kütüphane adı, Açık adres, Kütüphane telefonu,
Malzeme türü, Toplam etiket, Paket başına etiket, Koli başına paket.**

Giriş elle yapılabilir. Excel dosyaları mevcut `/api/excel` okuyucusuyla alınır,
alanlar önceden önerilen eşlemelerden seçilerek kayda aktarılır. Eksik zorunlu
alanlar basımdan önce işaretlenir. Sistem gönderi sırasına göre seçili kayıtları
tek bir PDF dosyasında birleştirir.

Varsayılan olarak 1 pakette **1.000 RFID etiket** ve 1 kolide **9 paket**
önerilir; bunlar sadece kullanıcının değiştirebileceği başlangıç değerleridir.
**Gerçek ambalaj bilgileriyle doğrulanmalıdır.** 15.000 etiket örneğinde
1. koli = 9 paket / 9.000 etiket, 2. koli = 6 paket / 6.000 etiket.

## QR gizliliği ve hukuki durum

QR adresinin `#d=` parçası sunucuya URL sorgusu olarak otomatik iletilmez.
Gönderiye ait bilgiler QR içinde **sıkıştırılmış, şifrelenmemiştir**.
QR'ı okutan herkes kütüphane ve gönderi bilgilerini görüntüleyebilir.
Sayfa bu bilgileri sunucuya POST ederek anlık PDF üretir; kalıcı veritabanı
kaydı oluşturulmaz. Tarayıcı otomatik indirmeyi engellerse **PDF'yi yeniden
indir** düğmesi görünür.

Üretilen PDF, teslimin gerçekleştiğinin kanıtı değildir. **İmza alanları boş**
bırakılır. Gerçek teslim sırasında düzenlenip imzalanmalıdır.

## Yerel doğrulama

`pytest tests/test_shipping.py`

Üretim site URL'si (`SHIPPING_PUBLIC_URL`) isteğe bağlı ortam değişkeniyle
ayarlanabilir. Vercel dağıtımında varsayılan kalıcı adres:
`https://etiket-barkod-olusturucu-h6aa.vercel.app`.
