# Tanex Etiket Stüdyosu — gönderi etiketi ve gelişmiş özellikler

## Gönderi etiketi

**Örnek gönderi etiketi oluştur** düğmesi temsili iki alıcıyla örnek baskıyı hazırlar. **Gönderi etiketi** modunda yüklenen Excel'deki Kütüphane Adı, Açık Adres, İlçe, İl, Teslim Alacak, Telefon, RFID Etiket Adedi ve Paket Numarası sütunları eşleştirilebilir. Alanlar sürükle-bırak ile sıralanır, gerektiğinde gizlenir. Büyük gönderi etiketleri için TW-2408 (105 × 72 mm) veya daha geniş bir etiket önerilir. **TW-2233 varsayılan olarak korunur.**

## Diğer gelişmeler

- Genel etiket modunda metin alanları ve önizleme satırları sürükle-bırak sıralanabilir. Alan bazında göreli font yüzdesi, hizalama, değer kalınlığı, renk, sol girinti ve üst boşluk ayarlanabilir; sütun adı bağımsız olarak yazdırılır, değiştirilir, kalınlaştırılır veya gizlenir.
- `'{İlçe} / {İl}'` gibi şablon ifadeleriyle birleşik alan oluşturulur; boş alanlar isteğe bağlı atlanır. QR ve Code128 barkod üretimi bulunur.
- Tasarım profilleri **yalnızca aynı tarayıcıda** saklanır. Kütüphanenin Excel verileri profillere kaydedilmez. Başka cihazda otomatik senkronize olmaz.
- Grup sütunu seçilerek gruplar yeni sayfadan başlatılabilir. Önizleme, Word ve PDF aynı arka uç yerleşim hesaplarını kullanır.
- Yazıcı kalibrasyonu için X/Y kayması ±5 mm ayarlanabilir; ayrı test PDF'sinde etiket sınırları ve merkez işaretleri bulunur. İlk baskı boş A4'e %100/gerçek boyutta yapılmalıdır.
- Veri kontrolü boş alan, tekrar kayıt, çok uzun hücre ve sıfır etiket sayısı için öneri sunar; yanlış işaretlemeler baskı dışına alınabilir. Excel'i yeniden indir özelliği düzenlenen verilerle yeni `.xlsx` oluşturur (özgün Excel değişmez).
- Word `.docx` ve PDF çıktısı üretilir. PDF çıktısında sunucu fontlarına bağlı olarak yazı ölçüleri Word'ün fontlarından küçük farklılık gösterebilir.
- Undo, satır düzenleme ve sürükle-bırak ile sütun sırası değişiklikleri için sunulur (tüm ayar işlemlerinin tam sürüm geçmişi değildir).

## Sınırlamalar ve güvenlik

Mevcut Word etiket motoru tablo hücreleri temelli `.docx` şablonları destekler; serbest konumlandırılmış metin kutuları/karmaşık şekiller desteklenmez. Etiket önizlemesinde sürükleyerek **satır sırası** değiştirilir; serbest piksel koordinatına yerleşim yapılmaz. Kod, verilerin işlenmesi için Vercel sunucusunu kullanır ve kalıcı veri tabanına kaydetmez; gizlilik gerektiren durumlar için uygulama Python ile yerel bilgisayarda çalıştırılabilir (internet gerektirmez, gerekli paketler ilk kurulumda yüklenir). Vercel'deki sürümün internet bağlantısı olmadan çalıştığı iddia edilmez.

## Yerel çalıştırma

Python 3.11+ ile, `pip install -r requirements.txt` ve `python app.py`; varsayılan adres `http://127.0.0.1:8765`. `start_windows.bat` / `start_linux_mac.sh` varsa kullanılabilir. 

## Test

`python -m pytest tests/test_advanced.py -q`.
