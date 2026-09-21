# Portföy — onaylanan tasarımın uygulama planı

Tarih: 17 Eylül 2026

**Kullanıcı kararı:** Tasarım taslağı beğenildi. Aynı görsel yön, mobil için uygun etkileşim ve yerleşimlerle, adım adım gerçek uygulamaya taşınacak.

**Durum:** Faz 0, Faz 1 ve Faz 2 tamamlandı. Ortak masaüstü/mobil çerçeve, gerçek verili Genel Bakış ve isteğe bağlı Three.js dağılım görünümü uygulandı. Sıradaki paket Faz 3.

## Başlangıçta okunacak kaynaklar

- [Onaylanan görsel referans](onaylanan-referans.html): konuşmada onaylanan etkileşimli HTML parçasının sabit kopyası. Bağımsız uygulama sayfası değildir; gösterim ortamına ait yardımcılar içerebilir. Yerleşim, renk ve görsel hiyerarşi için referans alınır.
- [İnceleme ve doğrulanmış sorunlar](../inceleme-2026-09-17.md): hata kanıtları, mevcut ürün amacı ve kapsam sınırları.
- `README.md`: portföy, disiplin motoru, risk ve AI özellikleri.
- `public/index.html`: gerçek DOM kimlikleri, bütün formlar, mobil navigasyon ve script sırası.
- `package.json`, `.github/workflows/`: mevcut test ve açılış doğrulama araçları.

Referanstaki fiyatlar, kazançlar, bilanço tarihleri, skorlar ve örnek plan hesabı üretim verisi değildir. Uygulamaya sabit örnek rakam taşınmayacak.

## Ürün ve kapsam kararları

1. Yeni tasarım mevcut yatırım disiplinini görünür kılacak: **durum → öncelik → pozisyon → plan/kayıt → değerlendirme**.
2. Vanilla JS + Express korunacak. Bu işin önkoşulu bir framework veya chart kütüphanesi değişimi değil.
3. Görsel geçiş ile hesap değişiklikleri ayrı, küçük değişiklikler olarak tutulacak. İlgili güvenilirlik hataları canlı kullanıma geçmeden kapatılacak.
4. Varlık türleri korunacak: hisse, fon, altın, opsiyon, nakit; ayrıca swing defteri, realize, para hareketleri ve vergi çıktısı erişilebilir kalacak.
5. Radar, haftalık plan, Büyüme, Tez Masası, günlük denetim, raporlar, bildirimler, deneyler ve strateji laboratuvarı tasarım sadeleşirken kaybolmayacak.
6. Masaüstü ve mobil aynı veriyi ve aynı hesapları kullanacak. Sunum için ayrı yerleşimler olabilir; iş kuralları kopyalanmayacak.
7. “Plan”, “işlem kaydı” ve “gerçekleşmiş işlem” etiketleri mevcut API'nin gerçekten yaptığı işi anlatacak. Taslaktaki örnek “Plan oluştur” butonu gerçek olmayan bir kayıt API'sine bağlanmayacak. Mevcut kayıt akışı korunacak; kalıcı taslak modelinin eklenmesi ayrı kapsamdır.
8. Her faz çalışan ve incelenebilir bir sonuç verecek. Tasarım yönü onaylı olduğundan her küçük karar için yeniden onay istenmeyecek; önemli sapmalar açıkça belirtilecek.

## Tasarım sözleşmesi

### Ortak görsel dil

- Açık görünüm referans: nötr açık gri sayfa, beyaz yüzey, koyu lacivertimsi metin, petrol tonu vurgu. Koyu görünüm aynı anlamsal tokenların karşılıklarıyla kurulacak; sistem tercihi ve kullanıcının seçimi desteklenebilir.
- Başlangıç tokenları: sayfa `#f5f6f8`, yüzey `#ffffff`, metin `#192634`, ikincil metin `#687585`, çizgi `#e6eaee`, vurgu `#096e75`, vurgu zemini `#e7f3f2`. Koyu karşılıklar referansta mevcut.
- Kazanç/kayıp ve risk renkleri marka vurgusundan ayrı. Durumlar metin/ikonla da anlatılacak.
- Sistem sans-serif yazı ailesi; sayılarda tabular figures. Üretimde gövde 14–16 px, ikincil içerik en az 12 px, mobil form alanları en az 16 px. Referanstaki çok küçük etiketler birebir kopyalanmayacak.
- Boşluk ölçeği 4/8/12/16/24/32 px; köşeler yaklaşık 8–12 px. İnce sınırlar ve sınırlı gölge; iç içe kartların azaltılması.
- Tek ikon ailesi; mevcut `svgIcon` altyapısı envanterlenip tek kaynağa bağlanacak. Konuşma önizlemesindeki global `lucide` veya `Tweak` nesnelerinin gerçek uygulamada var olduğu varsayılmayacak.
- Sayısal format tek kaynaktan: USD/TRY tercihi, negatif işaret, yüzde, para birimi, tarih ve veri zamanı. Mevcut TRY muhasebesi korunur; görünüm tercihi muhasebeyi değiştirmez.
- Gerçek veri yokken `0` veya olumlu durum uydurulmaz. Yükleniyor, boş, kısmi, bayat, hata, oturum kapalı ve mutabakat bekliyor durumlarının ortak bileşenleri olur.
- “Bedava / risksiz” yerine “Ana para geri alındı”; kalan pozisyon değeri ayrıca görünür.

### Masaüstü

- Dar ve nötr sol menü; sayfa adı, veri zamanı ve bağlama uygun birincil eylem üstte.
- Genel bakışta üç ana ölçü, performans grafiği, tek öncelik listesi ve kompakt pozisyon özeti.
- Pozisyon detayı sağdan açılan panel. Grafik veya uzun form gerektiğinde geniş modal.
- Tablo satırları bilgiye erişim noktası; ayrıntılı açıklamalar satıra doldurulmaz.

### Mobil — her fazın kabul koşulu

- Başlangıç aralıkları: `<640 px` telefon; `640–1023 px` tablet; `≥1024 px` masaüstü. Kırılmalar gerçek içerikle doğrulanır.
- Alt gezinme: **Genel · Pozisyonlar · Radar · Swing · Diğer**. Diğer altında Karar Günlüğü, Risk & Analiz, Raporlar, Deneyler ve yardımcı eylemler. Aynı anda iki menü veya iki aktif sekme görünmez.
- Üstte kompakt başlık ve bağlama uygun eylem. Ana değer tek satırda veya kontrollü iki satırda; yan ölçüler iki sütun.
- Pozisyonlar telefon ekranında varlık, değer, K/Z ve durum içeren okunabilir satır/kart görünümü. Adet, maliyet ve ayrıntı dokununca açılır. Karmaşık rapor tabloları gerektiğinde kendi alanında yatay kayabilir; tüm sayfa taşmaz.
- Kısa seçimler için alt çekmece; uzun pozisyon detayı, not ve işlem formu için tam ekran yüzey. Kapatma görünür; klavye ve geri hareketi öngörülebilir.
- Dokunma hedefleri en az 44×44 px. Hover zorunlu değil. Form etiketleri görünür, para alanlarında uygun `inputmode`, klavye açıldığında kaydet eylemi ve alanlar erişilebilir.
- Alt bar ve sabit eylemler `safe-area-inset-bottom` alanına uyar; son içerik arkalarında kalmaz. PWA'da ekran çentiği ve ekran yüksekliği değişimleri dikkate alınır.
- Gizlilik modu bütün yeni alanları kapsar; klavye/ekran okuyucu erişimi ve odak geri dönüşü doğrulanır.
- Grafik telefon genişliğine göre yeniden çizilir; sabit geniş grafik küçültülmez. Daha az tarih etiketi, dokunarak veri ayrıntısı ve renk dışında ayırıcı kullanılır.
- Kritik olay varsa mobilde net değerin hemen ardından tek öncelik alanı gösterilir. Ayrıntılı grafik kritik aksiyonu ekranın altına itmez.
- Azaltılmış hareket tercihi korunur. Arka plan yenilemesi formu, odak noktasını ve kaydırma konumunu sıfırlamaz.

## Faz 0 — keşif ve referansın sabitlenmesi ✅

### Yapılanlar

- Onaylanan tasarım proje içine referans olarak kopyalandı.
- İnceleme raporu ve önceki 283/283 test sonucu başlangıç bilgisi olarak kaydedildi; uygulama başlangıcında testler tekrar çalıştırılacak.
- Gerçek navigasyon ve veri API'leri envanterlendi. Aşağıdaki sözleşmeler mevcut koddan doğrulandı.

### Mevcut API ve desenler

| Alan | Mevcut kaynak / sözleşme | Geçişte kullanım |
|---|---|---|
| Navigasyon | `public/js/09-boot-notlar-ai.js:269` VIEWS, `:291` showView(name) | Yeni görünüm ve eski hash adresleri bu tek geçiş mekanizmasına bağlanır |
| Script sırası | `public/index.html:1067` ve devamı | 01–09 klasik script sırası, gerçek bağımlılık ayrıştırılana kadar korunur |
| Portföy | `server.js:4658` GET /api/portfolio; `public/js/01-cekirdek.js:201` load(), `:673` render() | Net değer/kapsam sözleşmesi çıkarılır; yeni görünüm aynı doğrulanmış kapsamı kullanır |
| Performans | `server.js:6066` GET /api/kiyas; `kiyas.js` kiyasHesapla() | TWR ve benchmark tek kaynaktan. Mevcut uç dönem parametresi almıyor; 1A/3A/1Y için yeni sözleşme ve test gerekir |
| Radar | `server.js:3282` GET /api/radar → items; `public/js/05-radar-view.js:14` loadRadarBoard() | items, tarama durumu ve ölçüm kanıtı korunur |
| Pozisyon işlemleri | `public/js/03-tablolar-modallar.js:585` ve devamı; `public/js/04-pano-realize.js:643` | Gerçek kaydet/sil/hata davranışı ortak görünüm bileşenleriyle sarılır |
| Swing | `public/js/08-swing-defteri.js:25` loadSwingDeck(), `:1003` openSwingModal(id,prefill), `:1074` openSwingFromPlan(p) | Adaydan plan alanlarına geçiş için mevcut desen; işlem anlamı değiştirilmez |
| Risk | `server.js:6116` GET /api/risk; boyutlandirma.js | Tarih hizalama düzeltmesi sonrası tek hesap; kapsam ve eksik veri etiketi korunur |
| Örnek önizleme | `scripts/mock-swing-server.js:974` → port 4321 | Görsel geliştirme. Mock ile gerçek API paritesi ayrıca doğrulanır |
| Test | package.json → npm test | Hesap ve kayıt değişikliklerine regresyon testi; görsel değişimlere anlamlı akış/görsel kontrol |

### Koruma kuralları

- Mock'ta çalışan bir yolun üretimde de doğru olduğu varsayılmayacak.
- Dosya adında “modül” yazması ES module olduğu anlamına gelmez; global kapsamı kıran toplu IIFE dönüşümü yapılmayacak.
- Eski DOM düğümleri kaldırılmadan onlara bağlanan doğrudan `.addEventListener` çağrıları güncellenecek.
- Aynı `id` ile masaüstü ve mobil DOM kopyası oluşturulmayacak.
- Yeni kütüphane/API gerekirse ilgili resmi doküman uygulama öncesinde okunacak; planda olmayan parametre uydurulmayacak.

## Faz 1 — ortak bileşenler ve uygulama çerçevesi ✅

**Çıktı:** Gerçek uygulamada yeni renkler, tipografi, menü, üst alan ve mobil alt bar. Mevcut ekranlara erişim sürer.

**Uygulama:**

- Referanstaki yüzey/renk/boşluk desenlerini uygulama tokenlarına aktar. Ortak buton, input, sekme, rozet, hata/boş/yükleme yüzeylerini tanımla.
- Yeni CSS'i sahipliği belli bir katmanda kur; uyarlanan bileşenin eski kurallarını kaldır. Kalıcı override yığını veya giderek artan `!important` kullanma.
- Navigasyonu tek görünüm tanımından yönet. Yeni Pozisyonlar görünümünü ekle; ilk adımda varlık ve yardımcı muhasebe alanlarını anlamlı şekilde buraya taşı. Eski kayıt formları korunur.
- Mobil gezinme kodunu animasyon katmanından ayır; menü davranışı `fx.js` animasyonlarına bağımlı olmasın.
- `lang="tr"`, PWA yüzey renkleri, görünür odak ve `aria-current` durumlarını düzenle.

**Referans:** onaylanan-referans.html, style.css başlangıç tokenları; index.html:23–80 ve mobil alt bar; 09-boot-notlar-ai.js:269–319; fx.js mobil yönlendirme bölümü.

**Kabul:** 320/390/768/1024/1440 px genişliklerde gezinme çalışır; sayfa yatay taşmaz; hiçbir özellik yalnız kaldırılmış menüye bağlı kalmaz; konsolda hata ve çift tıklama yan etkisi yok; telefon alt barı içeriği örtmez.

**Kaçınılacaklar:** Sayı hesaplarını değiştirmek; script sırasını rastgele taşımak; yüklenmiş formu navigasyon kabuğuyla yeniden oluşturmak.

## Faz 2 — Genel Bakış ve veri durumları ✅

**Çıktı:** Referansa yakın gerçek dashboard; masaüstünde grafik + öncelikler, mobilde net değer → kritik öncelikler → performans → pozisyon özeti.

**Uygulama:**

- Net değer, dönem TWR ve aylık swing katkısı için kaynak/kapsam sözleşmesini yaz. Hisse/swing örtüşmesi, nakit ve opsiyonlar mevcut kurallarla sayılır.
- Net değer grafiği ile performans grafiğini ayrı isimlendir. TWR/benchmark dönemleri aynı tarihlerle ve aynı hesap fonksiyonuyla üretilir; yalnız kümülatif grafik kesilerek yanlış dönem getirisi türetilmez.
- `/api/kiyas` için gerekiyorsa sınırlı ve doğrulanan dönem parametresi ekle; pencere başlangıcındaki baz gözlem ve nakit akışını test et. Mevcut paramsız davranış korunur.
- Feed, alarm ve bilanço olaylarını varlık + olay türü + ilgili zaman/olay kimliğiyle tek öncelik listesinde birleştir. Farklı riskleri yanlışlıkla tek olay sayma. Tüm olaylara ayrıntıdan erişilsin.
- Piyasa rejimi/VIX/FNG görünümünü kompakt bağlam olarak taşı; ayrıntılar korunur.
- Loading, boş portföy, eksik kur/fiyat, bayat veri, mutabakat uyarısı ve API hatası durumlarını tasarla.

**Referans:** 01-cekirdek.js:565 renderFeed(), :673 render(), :1215 drawChart(); 04-pano-realize.js:8 renderEarningsWatch(), :43 renderAlerts(), :122 renderDailyBoard(); server.js:6066; kiyas.js; swing-kapsam.js.

**Kabul:** Aynı veri setinde eski/yeni net değer ve aylık realize tutarı eşleşir; dönem TWR'si ilgili testli hesapla eşleşir; bilinmeyen veri 0 görünmez; kritik olay mobilde öne çıkar; değişen periyot grafiği ve karşılaştırmayı birlikte günceller.

**Kaçınılacaklar:** Referans sayıları, varsayılan olumlu piyasa durumu, ikinci bir finansal hesap implementasyonu, üç ayrı alarm şeridi.

## Faz 3 — Pozisyonlar, ayrıntı ve kayıt formları ☐

**Çıktı:** Masaüstü tablosu / mobil pozisyon listesi; ortak pozisyon detayı; kullanılabilir kayıt formları.

**Uygulama:**

- Hisse, fon, altın ve opsiyon gösterimlerini koru. Masaüstünde değer, ağırlık, K/Z ve plan; mobilde en önemli alanlar ve dokunarak ayrıntı.
- Hisse detayı içinde fiyat/veri zamanı, adet/maliyet, plan, notlar, işlem geçmişi ve uygun olduğunda Tez Masası bağlantısı.
- Masaüstünde yan panel, mobilde tam ekran detay. Tek seçili varlık durumu; açılış/kapanışta odak yönetimi ve geri tuşu davranışı.
- Mevcut ekle/düzenle, nakit, para hareketi, opsiyon, alarm ve realize formlarını ortak alan/aksiyon diliyle yenile. “Silindi / arşivlendi” ayrımını aynen koru.
- Ortak HTTP hata işleyicisi: non-2xx başarısızlık, 401 oturum durumu, taslak korunması, tekrar deneme, devam eden istekte çift gönderimi engelleme. Başarı yalnız doğrulanmış kayıt sonrası gösterilir.
- Sayısal gizlilik tüm yeni değerler ve erişilebilir metinlerde uygulanır; yalnız blur güvenli gizleme sayılmaz.

**Referans:** 03-tablolar-modallar.js:59/240/351/433 render grupları, :589 submit; 04-pano-realize.js:405/454/643/699; 09-boot-notlar-ai.js:600 note submit; swing-silme.js; nakit-komisyon.js.

**Kabul:** Kaydet/düzenle/kısmi satış/arşiv/hata senaryoları izole veriyle çalışır; 500/401'de yazılan içerik kaybolmaz; mobil klavye kaydetmeyi engellemez; kapanış odağı tetikleyiciye döner; her varlık türü ve rapor erişilebilir.

**Kaçınılacaklar:** Yeni tasarım uğruna kayıt şemasını topluca değiştirmek; API hatasını yutmak; mobilde zorunlu sütunları sessizce gizlemek.

## Faz 4 — Radar → swing planı → takip ☐

**Çıktı:** Aday bulmaktan mevcut swing kayıt akışına, oradan izlemeye kesintisiz geçiş.

**Uygulama:**

- Radarın mevcut filtrelerini, tema gruplarını, izleme listesini ve detay bilgisini ortak görsel dile taşı. Filtreler mobilde kısa bir çekmecede; etkin filtre ve sonuç sayısı görünür.
- Skorun yanında kurulum, kanıt düzeyi, kaynak yaşı ve neden beklediği gösterilir. Veri yokluğu “kapıları geçti” gibi görünmez.
- `openSwingFromPlan(p)` desenini kullan; sembol/giriş/stop/hedef forma taşınır. Henüz gerçekleşmemiş alım, kullanıcı kaydetmeden gerçekleşmiş pozisyona dönüşmez.
- Boyutlandırma, risk bütçesi ve nakit kısıtları ortak hesaplardan beslenir. Referanstaki basit örnek hesap üretime taşınmaz.
- Swing hedefi, açık pozisyonlar, kısmi satışlar, haftalık plan, karar değerlendirmesi ve Büyüme aynı hiyerarşiye alınır.

**Referans:** 05-radar-view.js:14/216; 08-swing-defteri.js:433/1003/1074/1094/1267/1395; boyutlandirma.js; swing-kapsam.js; score-calibration.js; signal-gates.js.

**Kabul:** Adaydan açılan form doğru değerleri taşır; geçersiz giriş/stop ve yetersiz veri görünür; mobilde filtre/form/takip akışı tamamlanır; kısmi satış sonrası portföy ve swing aynı kapsamı konuşur.

**Kaçınılacaklar:** Görsel skoru başarı olasılığına çevirmek; sadece UI'da risk kuralı yazmak; gerçek işlem kaydıyla taslağı karıştırmak.

## Faz 5 — Karar günlüğü, analiz, raporlar ve deneyler ☐

**Çıktı:** Kalan ürün yüzeyleri aynı tasarım dilinde; yardımcı özellikler kaybolmadan daha düzenli.

**Uygulama:**

- Notlar ve karar değerlendirmeleri ortak Karar Günlüğü çatısı altında, tür/tarih/sembol bağlamını koruyarak sunulur. AI incelemesi isteğe bağlı; anahtar yokken normal günlük çalışır.
- Risk masası, performans kıyası, tema/yoğunlaşma ve teknik detaylar katmanlanır. Ölçüm kapsamı, pencere, eksik varlıklar ve mutabakat durumu sayının yanında yer alır.
- Günlük/aylık raporlar, realize/vergi CSV ve yazdırma çıktıları erişilebilir kalır.
- Alfa Avı “Deneyler” altında sanal sermaye etiketiyle; laboratuvar ve geçmiş kayıtları korunur.
- Giriş ekranı, bildirim çekmecesi, grafiğin yan alanı, PWA görünümü ve küçük yardımcı modallar da ortak tokenları kullanır.

**Referans:** 06-analiz.js; 07-alfa-oneriler.js:684 chLoadBoard(); 08-swing-defteri.js:827 renderDayAnalysis(); 09-boot-notlar-ai.js notlar/AI/aylık rapor bölümleri; public/login.html; public/manifest.json; 04-pano-realize.js:876.

**Kabul:** AI kapalı/hatalı durumlar ana akışı bozmaz; risk kapsamı açık; deney gerçek portföy toplamına karışmaz; notlar, CSV ve baskı işlevleri çalışır; telefon üzerinden tüm bölümlere ulaşılır.

**Kaçınılacaklar:** Deney sonuçlarını gerçek kazanca katmak; yardımcı özelliği “sadeleştirme” gerekçesiyle kaldırmak; AI cevabı beklerken bütün ekranı kilitlemek.

## Güvenilirlik işleri — ilgili fazların canlı kullanım koşulları

Bu maddeler görsel çalışma sırasında ayrı değişiklikler halinde ele alınır; doğrulanmış kanıtlar inceleme raporunda. Hepsini tek büyük sunucu refaktörüne dönüştürme.

| İş | En geç tamamlanacağı nokta | Doğrulama |
|---|---|---|
| G1: Challenge bütün yazarlarında atomik kayıt | Faz 5 Deneyler canlı kullanımından önce | N eşzamanlı farklı kayıt → N kayıt; aynı ID iki kez → tek kayıt; arka plan motoru da aynı yol |
| G2: Risk getirilerinde gün/aralık hizalama | Faz 4 boyutlandırma / Faz 5 risk görünümünden önce | Bayat seri, eksik ara gün, kısa geçmiş; sentetik korelasyon kanıtı ve API testi |
| G3: Yapılandırılmış DB arızasında açık hata/salt-okunur durum | Yeni sürümün gerçek verili dağıtımından önce | Bağlantı/yazma arızasında geçici diske sessiz başarı yok; DB tanımsız geliştirme modu çalışır |
| G4: Not yazmada HTTP hata kontrolü | Faz 3 ortak kayıt katmanı | 401/500/ağ hatasında metin korunur, başarı gösterilmez |
| G5: MCP radar `items` eşlemesi | Faz 4 Radar tamamlanırken | Gerçek API şekliyle aday döner; boş/hata durumu ayrılır |
| G6: QM sabit/parametreli rota sırası | Faz 4 plan kalite kontrolü | `/api/qm/history` HISTORY sembolü dönmez; tek sembol sorgusu sürer |
| G7: Giriş sınırında güvenilir proxy/IP | Gerçek verili dağıtımdan önce | Güvenilmeyen forwarded başlığı sayaç aşımı sağlamaz; dağıtımın proxy zinciri belgelenir |

## Faz 6 — bütünlük, erişilebilirlik ve son geçiş ☐

**Çıktı:** Bütün ekranları aynı dilde, masaüstü ve mobilde doğrulanmış uygulama.

**Doğrulama:**

- `npm test`, sunucu/istemci sözdizimi ve mevcut CI açılış/eşzamanlı yazma kontrolleri.
- Yeni mantık için anlamlı regresyon testleri; yalnız CSS değerini tekrarlayan testler yazılmaz.
- Gerçek HTTP sözleşme testleri mock doğrulamasından ayrı tutulur. Dış ağ/ücretli servis gerektirmeyen geçici veri deposu kullanılır.
- Kritik kullanıcı yolları: giriş → genel bakış → varlık detayı → düzenleme; radar → swing formu → kayıt; kısmi satış → nakit/realize; not yazma → hata → tekrar deneme; rapor → CSV.
- 320, 390, 430, 768, 1024 ve 1440 px; açık/koyu; klavye; artırılmış metin; azaltılmış hareket; loading/boş/hata/bayat veri; uzun sembol/ad ve büyük tutarlar.
- Telefon tarayıcısı ve mümkünse gerçek cihaz/PWA: güvenli alanlar, sanal klavye, geri hareketi, alt bar. Gerçek cihaz yoksa emülasyonla doğrulananlar ve kalan boşluk açıkça raporlanır.
- Grafiklerde API değerleriyle görünüm paritesi; kullanıcı form yazarken arka plan yenilemesinin formu silmemesi; gereksiz tekrar istek ve çift listener olmaması.
- Eski CSS/ölü render parçaları yalnız referansları kalmadığı doğrulandıktan sonra temizlenir. Örnek rakamlar, `Tweak`, konuşmaya özel API ve geçici mock URL'leri üretim koduna sızmaz.
- Değişen dosyalar, testler, görsel kanıt ve bilinen sınırlar kaydedilir. Yayınlama bu yerel tasarım planının otomatik parçası değildir.

## Her fazın teslim biçimi

1. Durumu bu dosyada işaretle; yapılanları ve bir sonraki adımı kısa notla ekle.
2. Masaüstü ve mobil çalışan önizlemeyi kontrol et; görsel referansla sapmaları açıkla.
3. İlgili davranışları test et ve sonucu yaz.
4. İlgisiz işlev veya veri değişimini aynı faza katma.
5. Bir sonraki oturum bu dosya, referans ve ilgili kaynak bölümleriyle başlayabilsin.

**İlk uygulama paketi:** Faz 1 ortak tasarım sistemi + masaüstü/mobil çerçeve; ardından Faz 2 gerçek verili Genel Bakış. Sonraki paketler bu temel üzerine sırayla gelir.
