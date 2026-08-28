/* swing-proven.js — Kanıtlanmış Aylık Katkı ölçümü + bootstrap yardımcıları.
 * server.js'ten AYRI bir dosya: saf hesap, yan etkisi yok. Böylece hem gerçek
 * sunucu hem önizleme mock'u aynı sayıyı üretir ve fonksiyon tek başına test
 * edilebilir (7200 satırlık server.js'i ayağa kaldırmadan). */

/* ===== Bootstrap güven aralığı — "bu sayı gerçek mi, şans mı?" ====================
 * Nokta tahmini (ör. +$18/ay) TEK bir tarihsel diziden gelir. 6 işlemde bir büyük
 * kazanç ortalamayı taşıyorsa, işlemler biraz farklı gelseydi sonuç bambaşka olurdu.
 * Yeniden örnekleme (with replacement) bunu ölçer: aynı havuzdan 1000 alternatif
 * geçmiş üretip istatistiğin nerede salındığına bakar.
 * Tohum SABİT → aynı girdi aynı sonucu verir (rastgelelik güveni bozmasın). */
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bootCI(arr, stat, iters = 1000, seed = 42) {
  if (!arr || arr.length < 2) return null;
  const rnd = mulberry32(seed), out = [];
  const samp = new Array(arr.length);
  for (let k = 0; k < iters; k++) {
    for (let i = 0; i < arr.length; i++) samp[i] = arr[(rnd() * arr.length) | 0];
    out.push(stat(samp));
  }
  out.sort((a, b) => a - b);
  const q = (p) => out[Math.min(out.length - 1, Math.floor(p * out.length))];
  return { lo: +q(0.05).toFixed(2), med: +q(0.5).toFixed(2), hi: +q(0.95).toFixed(2) };
}

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/* Defterdeki her realize olayını tek tek $ K/Z olarak çıkarır (komisyon düşülmüş NET).
 * Kısmi satışlar realizedLots'ta ayrı ayrı durur — hepsi ayrı örneklem noktasıdır. */
export function swingRealizedLots(trades, fee = 1.5) {
  const out = [];
  for (const t of trades || []) {
    for (const lot of t.realizedLots || []) {
      if (lot.pnlUSD == null || !lot.date) continue;
      out.push({ date: String(lot.date).slice(0, 10), pnl: Number(lot.pnlUSD) || 0, symbol: t.symbol });
    }
    // realizedLots'suz kapanış (eski kayıt): adet hâlâ duruyorsa tek lot say
    if (t.status === "closed" && !(t.realizedLots || []).length && t.exitPrice != null && Number(t.qty) > 0 && t.closedAt)
      out.push({ date: String(t.closedAt).slice(0, 10), pnl: +(((t.exitPrice - t.entry) * t.qty) - fee).toFixed(2), symbol: t.symbol });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/* ===== Kanıtlanmış Aylık Katkı — "hedef" değil, ÖLÇÜM ==============================
 * Aylık hedef çubuğu bir dilekti; bu, defterin GERÇEKTE ne ürettiğidir.
 * Örneklem = son N takvim ayında kapanmış lot'lar. Nokta tahmin = toplam / geçen ay.
 * Üstüne bootstrap: aylık katkının %90 aralığı. Aralık 0'ı içeriyorsa katkı
 * gürültüden ayırt EDİLEMEZ ve kart bunu açıkça yazar. Küçük örneklemde (n<5)
 * aralık zaten anlamsızdır; orada hüküm verilmez, yalnız sayı gösterilir. */
export function swingProven(trades, monthsBack = 3, today = new Date()) {
  const lots = swingRealizedLots(trades);
  const curKey = monthKey(today);
  const startKey = monthKey(new Date(today.getFullYear(), today.getMonth() - (monthsBack - 1), 1));
  const inWin = lots.filter((l) => { const k = l.date.slice(0, 7); return k >= startKey && k <= curKey; });
  // Payda: pencerenin İLK işlemden sonraki kısmı — daha başlamadığın aylar seni
  // cezalandırmasın. Ama başladıktan sonra işlem yapmadığın ay 0 katkıdır ve SAYILIR;
  // "gelir" sorusunun dürüst paydası aktif ay değil, geçen aydır.
  const firstKey = lots.length ? lots[0].date.slice(0, 7) : startKey;
  const effStart = firstKey > startKey ? firstKey : startKey;
  const [sy, sm] = effStart.split("-").map(Number);
  const spanMonths = Math.max(1, (today.getFullYear() - sy) * 12 + (today.getMonth() + 1 - sm) + 1);

  const pnls = inWin.map((l) => l.pnl);
  const n = pnls.length;
  const total = +pnls.reduce((a, b) => a + b, 0).toFixed(2);
  const perMonth = +(total / spanMonths).toFixed(2);
  // Yeniden örnekleme TOPLAM üzerinden: n lot çek, topla, geçen aya böl
  const ci = n >= 2 ? bootCI(pnls, (s) => s.reduce((a, b) => a + b, 0) / spanMonths) : null;

  let verdict = "yetersiz";
  if (n >= 5 && ci) verdict = ci.lo > 0 ? "pozitif" : ci.hi < 0 ? "negatif" : "gurultu";
  // Hedef önerisi YALNIZ kanıtlanmış pozitif katkıda verilir; edge gürültüyse hedef
  // koymak dilektir ve site yine yalan söylemiş olur.
  let suggest = null;
  if (verdict === "pozitif") {
    const r25 = (v) => Math.max(25, Math.round(v / 25) * 25);
    const min = r25(ci.lo);
    suggest = { min, max: Math.max(min + 25, r25(ci.med)) };
  }
  return {
    n, spanMonths, windowStart: effStart, monthsBack, total, perMonth, ci, verdict, suggest,
    wins: pnls.filter((v) => v > 0).length,
    losses: pnls.filter((v) => v < 0).length,
  };
}
