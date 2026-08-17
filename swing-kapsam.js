/* swing-kapsam.js — Swing Defteri kaydı ile Varlıklar'daki pozisyonun ÖRTÜŞMESİ.
 *
 * 14 Ağu: Kaan LITE ve ONDS'u önce Varlıklar'a ekledi (horizon=swing), sonra Swing
 * Defteri'nde "Portföyden seç" ile AYNI adetleri kaydetti. swingPositions portföy
 * toplamına koşulsuz ekleniyordu → aynı $607 iki kez sayıldı (hero toplamı, dağılım
 * donut'ı, Analiz "uydu" kovası) ve ana sayfada iki ayrı tabloda göründü. Kayıtta
 * "bu ayrı bir alım mı, yoksa mevcut pozisyonun planı mı" bilgisi hiç yoktu.
 *
 * KURAL: aynı hisse iki kez sayılmaz. Bir semboldeki swing adedinin Varlıklar'daki
 * adetle örtüşen kısmı PLAN kaydıdır (stop/hedef/tez taşır, değeri holding'de zaten
 * sayılıyor → toplama girmez). Örtüşmeyen fazlası AYRI ALIM'dır (yalnız defterde
 * duruyor → toplama girer).
 *
 * Kayda bayrak YAZMAK yerine her istekte TÜRETİLİR: kullanıcı holding'i silerse ya da
 * adedini değiştirirse kayıt kendiliğinden doğru tarafa geçer. Saklanan bayrak bayatlar,
 * türetilen oran bayatlamaz — bu projede "kural sürümü" disiplininin aynısı.
 */

/** Yalnız hisse holding'lerinden sembol→toplam adet haritası. */
export function holdingAdetleri(holdings = []) {
  const m = new Map();
  for (const h of holdings || []) {
    if (!h || h.type !== "stock") continue;
    const s = String(h.symbol || "").toUpperCase();
    if (!s) continue;
    const q = Number(h.quantity);
    if (!isFinite(q) || q <= 0) continue;
    m.set(s, (m.get(s) || 0) + q);
  }
  return m;
}

/**
 * Her açık swing kaydı için örtüşmeyi hesaplar.
 * @param {Array} swingler  açık swing kayıtları ({id, symbol, qty}) — verilen sırayla kapsanır
 * @param {Array} holdings  STATE.holdings benzeri dizi
 * @returns {Map<string,{kapsananQty:number, ekQty:number, portfoydeVar:boolean, holdingQty:number}>}
 */
export function swingKapsam(swingler = [], holdings = []) {
  const stok = holdingAdetleri(holdings);
  const kalan = new Map(stok);          // kapsam bütçesi — ilk kayıt önce kapsanır
  const out = new Map();
  for (const t of swingler || []) {
    if (!t) continue;
    const sym = String(t.symbol || "").toUpperCase();
    const qty = Number(t.qty) || 0;
    const holdingQty = stok.get(sym) || 0;
    const butce = kalan.get(sym) || 0;
    const ham = Math.max(0, Math.min(qty, butce));
    // Kayan nokta: 0.336575407 iki yerde de aynı yazılır ama toplamalar sapabilir.
    // 1e-9 payı olmadan tam örtüşen kayıt "0.0000000001 adet ayrı alım" sanılır.
    const kapsananQty = qty - ham < 1e-9 ? qty : ham;
    const ekQty = Math.max(0, qty - kapsananQty);
    kalan.set(sym, Math.max(0, butce - kapsananQty));
    out.set(String(t.id), { kapsananQty, ekQty, portfoydeVar: holdingQty > 0, holdingQty });
  }
  return out;
}

/**
 * Tek kaydın toplama giren (sayılan) maliyet/değer payı.
 * Plan kaydında 0, ayrı alımda tam, kısmen örtüşende oransal.
 */
export function sayilanPay({ qty, costUSD, valueUSD }, kapsam) {
  const q = Number(qty) || 0;
  const ek = kapsam ? kapsam.ekQty : q;
  const oran = q > 0 ? ek / q : 0;
  return {
    sayilanQty: ek,
    sayilanCostUSD: costUSD != null ? costUSD * oran : null,
    sayilanValueUSD: valueUSD != null ? valueUSD * oran : null,
    // Kartın/tablonun tek kelimeyle söyleyeceği şey
    kaynak: oran <= 0 ? "portfoy" : oran >= 1 ? "ayri" : "karma",
  };
}
