/* cash-target.js — Türetilmiş hedef nakit. Saf hesap, yan etkisi yok; server.js'ten
 * ayrı tutuluyor ki tek başına test edilebilsin (swing-proven.js ile aynı desen). */
/* ===== Türetilmiş hedef nakit ====================================================
 * vixRegime() PİYASA temelini verir ve tek girdisi vardır: VIX. Portföyün
 * büyüklüğünü, dışarı çıkan parayı, elde tutulan altını bilmez — o yüzden
 * "%20–25" herkese aynı şeyi söyler. Burası o temeli senin kısıtlarınla düzeltir.
 *
 * Nakdin İKİ ayrı işi vardır ve karıştırılınca yanlış sayı çıkar:
 *
 *   İş A — FIRSAT CEPHANESİ: düşüşte alım yapabilmek. Altın bunu KISMEN görebilir;
 *          korelasyonsuz ve satılabilir. Ama tam nakit değildir: fiziksel satış
 *          spread'i, ziynette işçilik kaybı ve TL→USD→aracı kurum gecikmesi var.
 *          Bu yüzden iskonto (goldHaircut) + tavan (goldMaxCover) uygulanır —
 *          altın hiçbir zaman cephanenin tamamının yerine geçmez.
 *   İş B — ZORUNLU SATIŞ TAMPONU: düzenli bir dış akış varsa (flows'taki
 *          "withdraw" kayıtları) kötü günde satmak zorunda kalmamak için. Bu iş
 *          ALTINLA GÖRÜLEMEZ: parayı o gün istiyorsun, T+3 işe yaramaz. Tamponun
 *          tamamı nakit olmalıdır.
 *
 * Uzun vade burada sayısal bir girdi DEĞİL, altının nakit yerine sayılmasının
 * gerekçesidir: gecikmeyi ancak gün-içi işlem yapmıyorsan göze alabilirsin.
 * Dış akış kaydı yoksa tampon 0'dır — bu uç kendiliğinden sadeleşir. */
export const CASH_MODEL = {
  goldHaircut: 0.70,    // fiziksel altının nakit-eşdeğeri (spread + işçilik + gecikme)
  goldMaxCover: 0.70,   // altın fırsat cephanesinin en fazla bu kadarını karşılayabilir
  bufferMonths: 2,      // zorunlu satış tamponu: kaç aylık dış akış nakitte dursun
  outflowLookback: 6,   // aylık dış akış ortalaması kaç aya bakılarak bulunsun
};

// flows'taki "withdraw" kayıtlarından aylık ortalama dış akış (TL).
// Payda AY sayısıdır, çekim yapılan ay sayısı değil — düzensiz çekim de düzgün ortalanır.
export function monthlyOutflowTRY(flows, months = CASH_MODEL.outflowLookback, today = new Date()) {
  const start = new Date(today.getFullYear(), today.getMonth() - (months - 1), 1);
  const cutStart = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-01`;
  let sum = 0;
  for (const f of flows || []) {
    if (f.type !== "withdraw" || !f.date) continue;
    if (String(f.date).slice(0, 10) < cutStart) continue;
    sum += Math.abs(Number(f.amountTRY) || 0);
  }
  return sum / months;
}

export function deriveCashTarget(base, { grandTotal, goldTRY = 0, flows = [], today = new Date() }) {
  if (!Array.isArray(base) || !(grandTotal > 0)) return null;
  const M = CASH_MODEL;
  const [bLo, bHi] = base;

  // İş A — piyasa temelinin TL karşılığı
  const needLo = (grandTotal * bLo) / 100, needHi = (grandTotal * bHi) / 100;
  const goldCredit = Math.max(0, goldTRY * M.goldHaircut);
  const coverLo = Math.min(goldCredit, needLo * M.goldMaxCover);
  const coverHi = Math.min(goldCredit, needHi * M.goldMaxCover);

  // İş B — bilinen dış akıştan türeyen tampon (altın sayılmaz)
  const outflowTRY = monthlyOutflowTRY(flows, M.outflowLookback, today);
  const bufferTRY = outflowTRY * M.bufferMonths;

  const tgtLoTRY = Math.max(0, needLo - coverLo) + bufferTRY;
  const tgtHiTRY = Math.max(0, needHi - coverHi) + bufferTRY;
  const toPct = (v) => Math.round((v / grandTotal) * 100);
  let lo = toPct(tgtLoTRY);
  let hi = Math.max(lo, toPct(tgtHiTRY));
  if (hi === lo) hi = lo + 1;            // sıfır genişlikte bant çubukta görünmez olur

  return {
    targetCash: [lo, hi],
    baseCash: base,
    gold: {
      valueTRY: Math.round(goldTRY),
      creditTRY: Math.round(goldCredit),
      // hedeften düşülen kısım — portföyün yüzdesi cinsinden (kartın "−%X" satırı)
      pct: toPct(coverLo),
      // altın piyasa temelinin yüzde kaçını karşıladı (alt sınır üzerinden)
      coversPct: needLo > 0 ? Math.round((coverLo / needLo) * 100) : 0,
    },
    buffer: {
      monthlyOutflowTRY: Math.round(outflowTRY),
      months: M.bufferMonths,
      TRY: Math.round(bufferTRY),
      pct: toPct(bufferTRY),
    },
    changed: lo !== bLo || hi !== bHi,
    model: M,
  };
}
