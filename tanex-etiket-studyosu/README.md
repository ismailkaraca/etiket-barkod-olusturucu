# Tanex Etiket Stüdyosu — İlk sürüm

Excel verilerini yeni veya mevcut Tanex Word etiket şablonlarına yerleştiren tarayıcı uygulaması (yerel veya Vercel).

## Çalıştırma

Windows: **start_windows.bat** dosyasına çift tıklayın. Python 3.11 veya üzeri gerekir. İlk çalıştırmada gereken Python paketlerini kurmak için internet bağlantısı gerekebilir. Sonrasında uygulama bilgisayarınızda çalışır.

macOS/Linux: Terminalden `bash start_linux_mac.sh` çalıştırın.

Tarayıcıdan `http://127.0.0.1:8765` adresini açın. Pencereyi/terminali kapatınca sunucu kapanır.

## İş akışı

1. Tanex `.docx` şablonu seçin veya **Başka Word şablonu ekle** ile yeni bir şablon kaydedin. Yüklediğiniz şablonlar aynı bilgisayarda `templates` klasöründe saklanır.
2. `.xlsx` dosyasını yükleyin; çalışma sayfasını seçin.
3. Yazdırılacak sütunları ve sıralarını seçin.
4. Satırları seçin, her satır için etiket adedini girin. **Düzenle** ile Excel alanlarını arayüzde değiştirin. Orijinal Excel dosyası değişmez.
5. Otomatik yazı boyutunu kullanın veya manuel punto seçin. İç boşluk ve hizalamayı düzenleyin. İlk sayfa kısmen kullanılmışsa başlangıç etiketi konumu seçin.
6. Önizlemede sayfaları kontrol edin, Word dosyasını indirin. Yazıcıda ölçek **%100 / Gerçek boyut** olmalıdır.

## Şablon uyumluluğu

- İlk sürüm tek bölüm ve tek ana Word tablosundan oluşan etiket sayfalarını destekler.
- Orijinal `.docx` tablosu, satır yükseklikleri, hücre genişlikleri, sayfa kenar boşlukları korunmaya çalışılır; hücre içindeki içerik değiştirilir.
- Serbest metin kutuları, iç içe tablolar, karmaşık şekiller ve alternatif şablon kuralları henüz desteklenmez.
- Tarayıcıdaki önizleme hesaplanmış geometriden üretilir. Word ve fiziksel yazıcı yazı karakterlerini/hizalamaları farklı işleyebilir. **Önce boş A4'e deneme baskısı alın.**
- Otomatik punto, yaklaşık font ölçümlerinden seçilir. Uygulama minimum puntoda bile sığmayan içeriklere uyarı verir. Tam fiziksel baskı uyumu otomatik olarak garanti edilemez.

## Çevrimiçi sürüm / Vercel

Vercel FastAPI runtime, `app.py` üzerinden çalışır. `requirements.txt` Python bağımlılıklarını içerir. Yüklenen kullanıcı şablonları Vercel diskinde değil tarayıcının IndexedDB alanında saklanır; başka cihaz veya tarayıcıyla kendiliğinden paylaşılmaz. Excel dosyası ve önizleme/ihracat istekleri Vercel sunucusunda geçici olarak işlenir. Hizmetin çalışması için kullanıcı verilerinin sunucuya aktarılması gerekir.

Çevrimiçi Excel yüklemesi için 4 MB, Word şablonu için 2 MB sınırı uygulanır. Oturum açma sistemi yoktur; yüklediğiniz kişisel veriler herkese görünmese de bulutta işlenir. Hassas kurum/üyelik verilerinde kullanım öncesi veri koruma ve erişim şartlarını değerlendirin.

## Gizlilik ve sınırlar

- **Yerel kullanımda** işlemler 127.0.0.1 üzerinde kalır. **Vercel üzerinde** Excel/Word içeriği sunucuya gönderilir ve RAM/bellekte işlenir; uygulama bunları veri tabanına kaydetmez.
- Excel verileri dosya olarak kalıcı saklanmaz. Çevrimiçi eklenen Word şablonları tarayıcının IndexedDB alanında saklanır; yerel kullanımda ayrıca `templates` klasöründe tutulabilir.
- Maksimum 600 etiket/çıktı, yerel dosya sınırları Word 2 MB / Excel 15 MB; Vercel: Word 2 MB / Excel 4 MB, Excel her çalışma sayfasında en fazla 6000 satır ve 120 sütun.
- Farklı bir bilgisayarda kullanmak için uygulama klasörünü aktarın.

## Teknik not

Backend: FastAPI / python-docx / standart XLSX-XML okuyucu / Pillow. UI: saf JavaScript + CSS, CDN bağımlılığı yok. Özellikle şablon tablosunu kopyalayarak DOCX sayfa düzenini korumaya odaklanılmıştır.
