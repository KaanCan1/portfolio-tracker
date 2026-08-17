/* signal-features.js — sinyal anındaki BAĞLAM fotoğrafı (Sinyal Karnesi için).
 *
 * NEDEN VAR (10 Ağu 2026 ölçümü): defterde yalnız type/grade/entryType vardı.
 * Kart ise insider satışı, 52h mesafesi, momentum, rejim gibi yarım düzine rozet
 * gösteriyordu. "Hangi rozet para kazandırıyor?" sorulduğunda cevap verilemedi —
 * rozetler hiç yazılmamıştı ve geriye dönük kurtarılamıyordu (radarCache yalnız
 * BUGÜNKÜ hâli tutar, geçmişi yoktur). Buradaki alanlar sonradan gruplanabilsin
 * diye DÜZ ve SAYISALDIR; nesne içinde nesne yok.
 *
 * Aynı ölçümün ikinci bulgusu: 68 sonuçlanmış sinyalin çoğu birkaç günde açılmış
 * ve aynı hafta stoplanmıştı — sonucu belirleyen kurulum değil PİYASA GÜNÜYDÜ.
 * Bu yüzden rejim alanları (vix/fng) da fotoğrafa girer; onlar olmadan kurulum
 * performansı ile piyasa şansı ayrıştırılamaz.
 *
 * server.js'ten AYRI: saf fonksiyon, global okumaz, her şeyi parametreden alır →
 * test gerçek kodu import eder (guard-alerts.js / cash-target.js deseni). */

const say = (v) => (typeof v === "number" && isFinite(v) ? +v.toFixed(2) : null);
const oran = (a, b) =>
  (typeof a === "number" && typeof b === "number" && isFinite(a) && isFinite(b) && b !== 0
    ? +(((a - b) / b) * 100).toFixed(2)
    : null);

/**
 * @param t      signalCache kaydı: { rsi, atr, sma50, sma200, w52High, w52Low, high20 }
 * @param plan   buildPlan çıktısı: { entry, stop, target }
 * @param price  sinyalin doğduğu kapanış
 * @param radar  radarCache kaydı (opsiyonel): { score, tier, insider, recoScore, ret1M/3M/6M }
 * @param rejim  piyasa bağlamı (opsiyonel): { vix, vixBant, fng }
 */
export function signalFeatures({ t = {}, plan = {}, price = null, radar = {}, rejim = {} } = {}) {
  const ins = radar?.insider || {};
  const p = say(price);
  return {
    // ── teknik konum (sinyalin doğduğu andaki hâli)
    rsi: say(t.rsi),
    atrPct: p && t.atr != null ? say((t.atr / price) * 100) : null,  // günlük oynaklık ≈ ADR vekili
    sma50Ustu: t.sma50 != null && p != null ? price > t.sma50 : null,
    sma200Ustu: t.sma200 != null && p != null ? price > t.sma200 : null,
    zirveMesafe: oran(price, t.w52High),          // negatif = 52h zirvenin altında
    dip52Mesafe: oran(price, t.w52Low),
    yirmiGunZirveMesafe: oran(price, t.high20),
    // ── plan geometrisi ("hedef gerçekçi mi" sorusunun ölçüsü)
    stopMesafePct: plan.entry && plan.stop != null ? say(((plan.entry - plan.stop) / plan.entry) * 100) : null,
    hedefMesafePct: plan.entry && plan.target != null ? say(((plan.target - plan.entry) / plan.entry) * 100) : null,
    // ── radar bağlamı (temel + akış)
    skor: radar?.score ?? null,
    kademe: radar?.tier?.key ?? null,
    insiderNet: typeof ins.netValue === "number" ? Math.round(ins.netValue) : null, // negatif = net satış
    insiderAlim: ins.buys ?? null,
    insiderSatis: ins.sells ?? null,
    analistSkor: say(radar?.recoScore),
    // ── momentum
    ret1A: say(radar?.ret1M), ret3A: say(radar?.ret3M), ret6A: say(radar?.ret6M),
    // ── PİYASA REJİMİ: sonucu en çok bunun belirlediğini ölçüm gösterdi
    vix: say(rejim?.vix),
    vixBant: rejim?.vixBant ?? null,
    fng: rejim?.fng ?? null,
  };
}
