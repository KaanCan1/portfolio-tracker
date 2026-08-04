/* sources.js — Dış veri kaynakları için ortak sarmalayıcı. Saf: fs/pg/fetch
 * bilmez, hepsi dışarıdan verilir. Bu yüzden testler GERÇEK kodu import eder,
 * kopyasını değil (server.js app.listen() yüzünden import edilemiyor — bugün
 * dört testi kopyayla yazmak zorunda kaldık, her birinde ayrıca sapma
 * kontrolü gerekti; bu modül o bedeli ödemiyor).
 *
 * NEDEN VAR — 3 Ağu 2026: Truncgil v4 ucu HTTP 200 dönmeye devam ederken
 * gövdesi boşaldı. İstek "başarılı" sayıldı, `catch` çalışmadı, stale yedeği
 * hiç devreye girmedi ve usdtry null kaldı → bütün ₺ toplamları sıfırlandı.
 * Kaynağın doğrulaması YOKTU; diğer kaynaklarda vardı ama her biri kendi
 * yöntemini uydurmuştu (isFinite, Object.keys().length, ...).
 *
 * Bu yüzden `dogrula` OPSİYONEL BİR ALAN DEĞİL, imzanın zorunlu parçası.
 * Doğrulama olmadan kaynak tanımlanamaz — hata sınıfı yapısal olarak kapanır.
 *
 * Sarmalanan davranış (önceden her kaynakta elle tekrarlanıyordu):
 *   · TTL önbelleği
 *   · eşzamanlı istek birleştirme (aynı anda 5 istek gelirse 1 fetch)
 *   · son iyi değeri saklama + hatada `stale: true` ile döndürme
 *   · kalıcılık (isteğe bağlı) — Render diski geçici olduğu için DB önerilir
 *   · son başarı/hata zamanı → sağlık ucu bunu okur
 */

/* arkaPlanTazele: elde değer varsa bayat olsa bile ANINDA döndür, tazelemeyi
 * arka planda yap. VIX ve Korku-Açgözlülük böyle çalışıyordu ve haklı olarak:
 * bunlar sayfa açılışını bekletmemesi gereken ikincil göstergeler. Varsayılan
 * kapalı — döviz gibi hesabı doğrudan etkileyen kaynaklar taze değeri BEKLER,
 * yoksa kullanıcı yanlış toplam görür. */
export function kaynak({ ad, getir, dogrula, ttl = 60_000, kalici = null, log = console, arkaPlanTazele = false }) {
  if (!ad) throw new Error("kaynak: ad zorunlu");
  if (typeof getir !== "function") throw new Error(`kaynak(${ad}): getir fonksiyon olmalı`);
  // Kasıtlı sertlik: doğrulamasız kaynak tanımlanamaz. 3 Ağu olayının kökü buydu.
  if (typeof dogrula !== "function") throw new Error(`kaynak(${ad}): dogrula zorunlu — "HTTP 200 = veri geldi" varsayımı bu projede bir kez çöktü`);

  let sonIyi = null;        // son DOĞRULANMIŞ değer
  let sonBasariTs = 0;      // o değerin alındığı an
  let sonHata = null;       // son başarısızlığın sebebi (sağlık ucu için)
  let sonDenemeTs = 0;
  let ucus = null;          // devam eden fetch (istek birleştirme)

  const simdi = () => Date.now();

  async function tazele() {
    sonDenemeTs = simdi();
    // getir'e son iyi değer verilir: KISMİ kaynaklar elindekini tamamlayabilsin.
    // Somut ihtiyaç — Truncgil düşünce TCMB devreye giriyor ama altın yayımlamıyor;
    // gram'ı son iyi değerden taşımak gerekiyor. Bu olmadan yedek kaynak
    // doğrulamayı geçemez ve tüm zincir boşa düşerdi.
    const ham = await getir(sonIyi);
    if (!dogrula(ham)) {
      const e = new Error(`${ad}: gövde doğrulamayı geçmedi (kaynak yanıt verdi ama veri yok)`);
      e.code = "GECERSIZ_GOVDE";
      throw e;
    }
    sonIyi = ham;
    sonBasariTs = simdi();
    sonHata = null;
    if (kalici?.kaydet) Promise.resolve(kalici.kaydet(ham)).catch(() => {});
    return ham;
  }

  return {
    ad,

    /* Değeri okur. Sıra: taze önbellek → uçuştaki istek → yeni fetch →
     * son iyi değer (stale) → hata. */
    async oku() {
      if (sonIyi && simdi() - sonBasariTs < ttl) return sonIyi;
      // Arka plan modu: elde değer varken İSTEK YOLUNDA BEKLEME. Bayat değeri
      // anında ver, tazelemeyi arkada başlat. İlk açılışta (değer yokken)
      // beklenir — o zaman gösterecek bir şey yok zaten.
      if (arkaPlanTazele && sonIyi) {
        if (!ucus) {
          ucus = tazele().finally(() => { ucus = null; });
          ucus.catch((e) => { sonHata = e.message; log.warn?.(`  ⚠️ ${ad}: ${e.message}`); });
        }
        return { ...sonIyi, stale: true };
      }
      if (ucus) {
        // Aynı anda gelen istekler tek fetch'e biner. Başarısız olursa
        // aşağıdaki stale yoluna düşerler, kendi fetch'lerini açmazlar.
        try { return await ucus; } catch { /* stale yoluna düş */ }
      } else {
        ucus = tazele().finally(() => { ucus = null; });
        try { return await ucus; }
        catch (e) {
          sonHata = e.message;
          log.warn?.(`  ⚠️ ${ad}: ${e.message}`);
        }
      }
      if (sonIyi) return { ...sonIyi, stale: true };
      throw new Error(sonHata || `${ad}: veri yok`);
    },

    /* Açılışta kalıcı depodan doldurur. Doğrulamadan GEÇMEYEN yedek
     * yüklenmez — bozuk bir kayıt sessizce "son iyi değer" olmamalı. */
    async tohumla() {
      if (!kalici?.yukle || sonIyi) return false;
      try {
        const v = await kalici.yukle();
        if (v && dogrula(v)) { sonIyi = v; sonBasariTs = 0; return true; }
      } catch {}
      return false;
    },

    /* Sağlık ucu bunu okur. sonBasariTs 0 ise değer tohumdan geldi
     * (yaşı bilinmiyor) — "hiç doğrulanmış tazeleme olmadı" demektir. */
    durum() {
      const yasMs = sonBasariTs ? simdi() - sonBasariTs : null;
      return {
        ad,
        saglikli: !!sonIyi && !sonHata,
        sonBasari: sonBasariTs ? new Date(sonBasariTs).toISOString() : null,
        yasDk: yasMs == null ? null : Math.round(yasMs / 60_000),
        sonDeneme: sonDenemeTs ? new Date(sonDenemeTs).toISOString() : null,
        sonHata,
        degerVar: !!sonIyi,
      };
    },

    /* Testler ve elle tazeleme için: önbelleği düşür, değeri koru. */
    bayatlat() { sonBasariTs = 0; },
  };
}

/* Kayıt defteri — sağlık ucu tek yerden okusun diye. */
export function kaynakDefteri() {
  const kayit = new Map();
  return {
    ekle(k) { kayit.set(k.ad, k); return k; },
    get(ad) { return kayit.get(ad); },
    durumlar() { return [...kayit.values()].map((k) => k.durum()); },
    /* Bayat sayılanlar: doğrulanmış tazeleme üzerinden esikDk geçmiş olanlar.
     * Hiç değeri olmayan kaynak da bayat sayılır — "veri yok" en kötü hâl. */
    bayatOlanlar(esikDk) {
      return this.durumlar().filter((d) => !d.degerVar || d.yasDk == null || d.yasDk >= esikDk);
    },
  };
}
