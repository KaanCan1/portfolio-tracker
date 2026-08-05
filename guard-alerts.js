/* guard-alerts.js — bekçinin BULGU ÜRETİCİLERİ. Saf: fiyat çekmez, mail
 * atmaz, veritabanı bilmez. Girdi verilir, bulgu (ya da hiçbir şey) döner.
 *
 * server.js'ten çıkarıldı çünkü test edilemiyordu (app.listen modül
 * seviyesinde → dosya import edilemez). Eşikler ve "bu bulgu tetiklenmeli mi"
 * kararı buraya taşındığı için artık tek tek sınanabiliyor.
 *
 * Her üretici { anahtar, feed, alert } döndürür:
 *   anahtar → idempotens imleci (tip:sembol:gün). Bulgu güne bir kez girer.
 *   feed    → "Sen Yokken" akışı olayı (her zaman)
 *   alert   → mail bulgusu; null ise bu bulgu MAİLE GİRMEZ, yalnız akışta
 *             durur (sert günlük hareket böyle: bilgi değerli ama mail
 *             etmeye değmez).
 * Karar mantığı burada, yan etki çağıranda — feedPush/mark orada kalır. */

export const usd0 = (x) => "$" + Math.round(Number(x) || 0).toLocaleString("en-US");

/* Eşikler tek yerde ve adlı. Dağılmış sihirli sayılar sınanamıyordu. */
export const ESIK = {
  sicramaMinPct: 6,      // günlük hareket bu yüzdenin altındaysa sıçrama sayılmaz
  sicramaAdrCarpani: 1.2, // ADR biliniyorsa eşik = 1.2 × ADR (ama en az sicramaMinPct)
  sertHareketPct: 3,     // yalnız akışa düşen "bugün sert oynadı" eşiği
  yogunlasmaPct: 35,     // bu ağırlığın üstünde + stopsuz → yoğunlaşma riski
};

/* Tek bir hisse pozisyonu için tüm bulgular. Sıra önemli değil; çağıran
 * hepsini akışa basar, mail bulgusu olanları idempotens kapısından geçirir. */
export function pozisyonBulgulari({ sym, price, qty, cost, gunlukPct, adr, agirlik, planStop, realized = 0, bugun }) {
  const out = [];
  if (!(price > 0) || !(qty > 0)) return out;

  const stop = Number(planStop) || 0;
  const kardaMi = cost != null && price > cost;
  const sicramaEsigi = Math.max(ESIK.sicramaMinPct, adr ? ESIK.sicramaAdrCarpani * adr : ESIK.sicramaMinPct);
  const sicradi = gunlukPct != null && gunlukPct >= sicramaEsigi && kardaMi;

  // (a) Kâr sıçraması → kârı koru + sıfır-maliyet önerisi
  if (sicradi) {
    const anapara = cost * qty, etkinMaliyet = anapara - (realized || 0);
    let oneri;
    if (etkinMaliyet <= 0) {
      oneri = "Bu pozisyon zaten <b>bedava</b> (ana paranı geri almışsın) — kâr tümüyle risksiz. Stopu yukarı çek, kalanı koştur.";
    } else {
      const satilacak = Math.min(qty, etkinMaliyet / price), kalan = qty - satilacak;
      oneri = `Kalan ana parayı çekmek için ~<b>${satilacak.toFixed(2)} adet</b> sat (~${usd0(etkinMaliyet)} cebe); kalan <b>${kalan.toFixed(2)} adet</b> (${usd0(kalan * price)}) bedava biner — tezin tam bu.`;
    }
    out.push({
      anahtar: `spike:${sym}:${bugun}`,
      feed: { key: `spike:${sym}:${bugun}`, type: "pos", sev: "warn", sym,
        title: `${sym} +${gunlukPct.toFixed(1)}% sıçradı — kârı koru`,
        detail: `${usd0(price)} · sıfır-maliyet fırsatı olabilir (Büyüme'ye bak)` },
      alert: { sev: "warn", kind: "spike", kindLabel: "Kâr sıçraması", sym,
        title: `+${gunlukPct.toFixed(1)}% sıçradı — kârı koru`,
        headline: `Günlük hareket ADR eşiğini (<b>${sicramaEsigi.toFixed(1)}%</b>) aştı.`,
        stats: [
          { label: "Fiyat", value: usd0(price) },
          { label: "Bugün", value: `+${gunlukPct.toFixed(1)}%` },
          { label: "Girişe göre", value: `+${((price / cost - 1) * 100).toFixed(0)}%` },
          { label: "Pozisyon", value: usd0(price * qty) },
        ],
        actionLabel: "Sıfır maliyet önerisi", action: oneri },
    });
  }

  // (a2) Sert günlük hareket — YALNIZ akış, mail yok. Sıçramayla çakışırsa
  // tek olay kalsın diye sicradi durumunda atlanır.
  if (gunlukPct != null && Math.abs(gunlukPct) >= ESIK.sertHareketPct && !sicradi) {
    out.push({
      anahtar: `gap:${sym}:${bugun}`,
      feed: { key: `gap:${sym}:${bugun}`, type: "pos", sev: gunlukPct < 0 ? "warn" : "info", sym,
        title: `${sym} bugün ${gunlukPct >= 0 ? "+" : ""}${gunlukPct.toFixed(1)}% hareket etti`,
        detail: usd0(price) + (gunlukPct < 0 ? " · stop planını kontrol et" : "") },
      alert: null,
    });
  }

  // (b) Stop delindi — tek CRIT pozisyon bulgusu; bekletilmeden mail edilir
  if (stop > 0 && price <= stop) {
    out.push({
      anahtar: `stop:${sym}:${bugun}`,
      feed: { key: `stop:${sym}:${bugun}`, type: "pos", sev: "crit", sym,
        title: `${sym} stop seviyesinde — planı uygula`,
        detail: `${usd0(price)} ≤ stop ${usd0(stop)} · Kural 1: önce sermayeyi koru` },
      alert: { sev: "crit", kind: "stop", kindLabel: "Stop delindi", sym,
        title: "Planlı stopuna indi",
        headline: `Fiyat <b>${usd0(price)}</b>, plan stopun <b>${usd0(stop)}</b> seviyesine indi ya da altına geçti.`,
        stats: [
          { label: "Fiyat", value: usd0(price) },
          { label: "Plan stop", value: usd0(stop) },
          { label: "Pozisyon", value: usd0(price * qty) },
          { label: "Ağırlık", value: `%${agirlik.toFixed(0)}` },
        ],
        action: "Planını uygula, tezini yeniden değerlendir. Kural 1: önce sermayeyi koru." },
    });
  }

  // (c) Yoğunlaşma — yalnız STOPSUZ pozisyonda. Stopu olan büyük pozisyon
  // bilinçli bir bahis; uyarı gürültü olurdu.
  if (agirlik > ESIK.yogunlasmaPct && !(stop > 0)) {
    out.push({
      anahtar: `weight:${sym}:${bugun}`,
      feed: { key: `weight:${sym}:${bugun}`, type: "pos", sev: "warn", sym,
        title: `${sym} portföyün %${agirlik.toFixed(0)}'i — stop yok`,
        detail: "Tek hisse seni sallayabilir · plan stop gir ya da kademeli azalt" },
      alert: { sev: "warn", kind: "weight", kindLabel: "Yoğunlaşma riski", sym,
        title: `Portföyün %${agirlik.toFixed(0)}'i — stop yok`,
        headline: "Tek hisse seni sallayabilir; bu pozisyonun plan stopu <b>yok</b>.",
        stats: [
          { label: "Ağırlık", value: `%${agirlik.toFixed(0)}` },
          { label: "Pozisyon", value: usd0(price * qty) },
          { label: "Fiyat", value: usd0(price) },
          { label: "Plan stop", value: "yok" },
        ],
        action: "Bir plan stop gir ya da kademeli azalt (Kural 1)." },
    });
  }

  return out;
}

/* Bayat veri kaynağı. warn: veri bozuk ama sermaye doğrudan tehlikede değil. */
export function bayatKaynakBulgusu(durum, esikDk, bugun) {
  /* Üç ayrı hâl, üç ayrı cümle. Eskiden ikisi "hiç doğrulanmış veri yok" diye tek
   * torbaya giriyordu ve YANLIŞ alarm veriyordu (5 Ağu): tohumlanmış kaynakta
   * DOĞRULANMIŞ bir değer VARDIR, yalnız yaşı bilinmez. Panik hak etmeyen duruma
   * panik cümlesi yazmak, gerçek arızayı da gürültüye gömer. */
  const tohumdan = durum.yasDk == null && durum.degerVar;
  const yasMetni = durum.yasDk != null
    ? `${Math.floor(durum.yasDk / 60)} saattir bayat`
    : tohumdan
      ? `yeniden başlatmadan beri tazelenemedi (${durum.tohumYasDk ?? "?"} dk)`
      : "hiç doğrulanmış veri yok";
  const headline = tohumdan
    ? `Sunucu yeniden başladı, kaynak <b>${durum.tohumYasDk ?? "?"} dk</b>dır tazelenemiyor. Ekrandaki sayılar kalıcı depodaki son doğrulanmış değerden — yaşı bilinmiyor.`
    : `Son doğrulanmış veri alınalı <b>${yasMetni}</b>. Ekrandaki sayılar son bilinen değerlerden.`;
  return {
    anahtar: `kaynak:${durum.ad}:${bugun}`,
    feed: { key: `kaynak:${durum.ad}:${bugun}`, type: "sistem", sev: "warn", sym: null,
      title: `Veri kaynağı bayat: ${durum.ad}`, detail: yasMetni + (durum.sonHata ? ` · ${durum.sonHata}` : "") },
    alert: { sev: "warn", kind: "kaynak", kindLabel: "Veri kaynağı", sym: null,
      title: `${durum.ad} kaynağı bayat`,
      headline,
      stats: [
        { label: "Kaynak", value: durum.ad },
        { label: "Son başarı", value: durum.sonBasari ? durum.sonBasari.slice(0, 16).replace("T", " ") : tohumdan ? "depodan" : "—" },
        { label: "Yaş", value: durum.yasDk != null ? `${durum.yasDk} dk` : tohumdan ? `${durum.tohumYasDk ?? "?"} dk+` : "—" },
        { label: "Eşik", value: `${esikDk} dk` },
      ],
      action: (durum.sonHata || "Kaynak yanıt vermiyor.") + " Sağlayıcı ucu değişmiş olabilir — /api/health/sources'a bak." },
  };
}
