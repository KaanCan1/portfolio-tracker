# Hisse grafiği denetimi · 12 Ekim 2026

Düzeltmeler:
- Günlük mumdan “ORH giriş aktif” sonucu çıkıyordu. Yeni giriş senaryosu kapanmış günlük mumları kullanır; açılış aralığı, temas sırası ve emir gerçekleşmesi teyit edilmez.
- QM kurulumları grafik üzerinde oynaklık/göreli güç filtresini atlayabiliyordu. Senaryo aynı kapıları okur; eksik filtre verisi ayrıca görünür. QQQ karşılaştırması aynı kapanış tarihi ve ortak pencere üzerinden hesaplanır.
- Eski radar fiyatı ile mum kapanışı karışıyordu. Grafik analizinin fiyatı ve seviyeleri aynı kapanış serisine dayanır.
- Açık mum, bozuk OHLC, yinelenen tarih ve eski veri için ayrı kalite kontrolü eklendi. Bozuk mumlar düzeltilmiş gibi gösterilmez.
- EMA bulutunun tüm geçmişi son durumun rengine boyanıyordu. Yeni katman gerçek kesişimleri iki renge ayırır; geniş alan dolgusu grafiği kapatmaz.
- Swing planlarının portföyle örtüşen payı pozisyon özetinde tekrar sayılıyordu. Yalnız ek adet/maliyet/değer eklenir.
- İleri çizim çapaları yeni mumla sağa kayıyordu. Tarih çapası korunur. Bozuk localStorage çizimi grafik açılışını bozamaz.
- Fiyat ölçeğinde çizimler yeniden boyanmıyordu; kapatınca gözlemci/dinleyiciler kalıyordu. Koordinat değişimi takip edilir, kapatırken temizlenir.
- Sembol değiştirme ve kapatma sırasında eski ağ yanıtı grafiği tekrar çizebiliyordu. İptal ve istek sürümü bunu engeller.
- Boyut değişimi grafiği altı aya sıfırlıyordu. Görünür aralık korunur; ilk autoSize ölçümü sonrası başlangıç kadrajı uygulanır.
- Katman kontrolleri, gizlilik, odak döngüsü ve Escape sırası eklendi. Etkin fiyat seviyeleri kadraja dahil edilir.
- Formasyon puanları başarı yüzdesi, 2R fiyat tahmini veya ortalama bölgeleri otomatik nakit dağıtımı olarak sunulmaz.
- Lightweight Charts 4.2.0 ve lisansı uygulamada tutulur; grafik açılışı harici CDN'ye bağlı değildir.

## Doğrulama

`npm test` gerçek senaryo ve çizim yardımcılarını sınar. Tarayıcı kontrolü gerçek `/api/chart` yanıtını, ardından sentetik portföy ve giriş senaryosunu kullanır. Canlı portföy yazılmaz.

`PLAYWRIGHT_MODULE`, isteğe bağlı `CHROME_EXECUTABLE`, `CHART_TEST_URL` ve `CHART_TEST_PASSWORD` ile `node scripts/chart-ui-check.mjs` çalıştırılır. Sunucu izole, DB'siz önizleme olmalıdır; mum önbelleğinde en az 60 kapanmış NVDA mumu gerekir. `CHART_TEST_OUTPUT` ekran görüntülerini kaydeder.

Kontroller: giriş/stop/2R, filtreler, kapanış, eski/açık/bozuk mum, RS pencere hizası, örtüşen swing, çizim kaydet/aç/sil, fiyat ölçeği ve zoom/resize, araç çakışması, kaynak temizliği, istek yarışı, mobil, koyu tema ve gizlilik.

Giriş analizi koşullu plan geometrisidir. Daha iyi getiri veya “en iyi giriş” kanıtı değildir; mevcut otomatik işlem motorunun ölçülmüş kuralları değiştirilmez.

API referansı: [TradingView Lightweight Charts 4.2](https://tradingview.github.io/lightweight-charts/docs/4.2/api), özellikle seri fiyat koordinatları, fiyat çizgileri ve zaman aralığı API'leri.
