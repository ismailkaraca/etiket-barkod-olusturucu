# Tanex Etiket Stüdyosu

Excel dosyasındaki sütunlarla orijinal Word etiket şablonlarını dolduran FastAPI web uygulamasıdır.

## Yerleşik şablonlar

| Şablon | Etiket ölçüsü | A4 düzeni |
|---|---|---|
| **TW-2233 (varsayılan)** | 70 × 25,4 mm | 3 sütun × 11 satır = 33 etiket |
| TW-2044 | 48,5 × 25,4 mm | 4 sütun × 11 satır = 44 etiket |
| TW-2408 | 105 × 72 mm | 2 sütun × 4 satır = 8 etiket |
| TW-2404 | 210 × 74,25 mm | 1 sütun × 4 satır = 4 etiket |

Word şablonları `templates/` klasöründedir ve A4 baskı yerleşimleri özgün Word hücreleri korunarak oluşturulur. İstediğiniz `.docx` şablonunu arayüz üzerinden ekleyebilirsiniz. Çevrimiçi sürümde kişiye özel şablonlar tarayıcının IndexedDB alanında tutulur.

## Kullanım

1. Word şablonunu seçin (ilk açılışta TW-2233 seçilir).
2. Excel `.xlsx` dosyasını yükleyin, sayfa ve sütunları seçin.
3. Satır seçin; etiket adetlerini belirleyin, gerekirse hücreleri düzenleyin.
4. Canlı önizlemede otomatik punto ve hizalamayı kontrol edin.
5. Word çıktısını indirip **%100 gerçek boyut** ile yazdırın.

## Çalıştırma

Python 3.11+ ortamında: `pip install -r requirements.txt` ardından `uvicorn app:app --host 127.0.0.1 --port 8765`.

Vercel GitHub entegrasyonunda proje kök dizini: `tanex-etiket-studyosu`. FastAPI framework seçilir.

## Notlar

İnternet üzerinde kullanıcıların yüklediği Excel içerikleri önizleme/Word üretimi sırasında Vercel sunucusunda işlenir; uygulama bu verileri veritabanına kaydetmez. Baskı boyutlarını doğrulamak için ilk denemede boş A4 sayfası kullanın.
