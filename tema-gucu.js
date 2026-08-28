/* tema-gucu.js — "hangi tema gidiyor, içinde kim lider?" sorusunun saf hesap katmanı.
 *
 * 28 Ağu 2026: Analiz sekmesinde "Sektör / tema yoğunlaşması" paneli vardı ama
 * yalnız SENİN ağırlığını söylüyordu: "%65'in şu temada". Eksik olan ikinci yarısı —
 * o tema iyi bir yerde mi? Yoğunlaşma tek başına ne iyi ne kötü; QQQ'yu yenen bir
 * temada yoğunlaşmak ile geride kalan bir temada yoğunlaşmak aynı şey değil.
 *
 * NE ÖLÇER: radar evrenindeki (~107 sembol) her temanın MEDYAN 1A/3A getirisi ve
 * bunun endeksle farkı (göreli güç). Medyan, çünkü ortalamayı tek bir NBIS/MULL
 * uçuşu tek başına taşır ve tema "gidiyor" görünür.
 *
 * NE ÖLÇMEZ — ve panel bunu yazmak zorunda:
 *  · "Önümüzdeki dönemde ne gidecek." Momentumun tema düzeyinde sürüp sürmediği bu
 *    projede ÖLÇÜLMEDİ. Ölçülmüş olan bar düzeyinde göreli güç kapısı (60g getiri ≥
 *    QQQ → 10 günde +2.35 puan, 152 gün/6452 bar · signal-gates.js). Tema sıralaması
 *    o kapının akrabası ama aynı şey değil; kanıt oraya yazılıdır, buraya değil.
 *  · Hayatta kalma yanlılığı: radar evreni bugünün listesi. Üç ay önce çöken bir isim
 *    listeden düşmüşse temanın geçmiş medyanı olduğundan iyi çıkar.
 *  · Tema sayısı az (6) ve semboller eşit dağılmamış; 9 sembollü bir temanın medyanı
 *    18 sembollü temanınki kadar sağlam değil. `n` her satırda yazılır.
 *
 * Saf modül: DOM bilmez, fetch etmez.
 */

const say = (v) => (Number.isFinite(+v) ? +v : null);

/** Medyan — boş dizide null. Ortalama değil: tek uçuş temayı taşımasın. */
export function medyan(dizi = []) {
  const a = dizi.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Bir temanın satırı sağlam sayılması için gereken en az sembol. Altındakiler ölçülür ama "zayıf kanıt" damgalanır. */
export const MIN_SEMBOL = 5;

/**
 * Tema başına ölçüm.
 * @param {Array}  items      radar kayıtları: {symbol, theme:{key,title}, ret1M, ret3M, score, price}
 * @param {Object} endeks     {ret1M, ret3M} — yüzde (5.2 = %5,2)
 * @param {Object} agirlik    {temaBaslik: yüzde} — portföyünün o temadaki payı
 * @param {number} liderSayisi her temada kaç isim gösterilecek
 */
export function temaGucu({ items = [], endeks = {}, agirlik = {}, liderSayisi = 3 } = {}) {
  const grup = new Map();
  for (const it of items) {
    const title = it?.theme?.title;
    if (!title) continue;                       // temasız semboller (Cuma listesi) evrene girmez
    const g = grup.get(title) || { key: it.theme.key || null, title, uyeler: [] };
    g.uyeler.push(it);
    grup.set(title, g);
  }

  const e1 = say(endeks.ret1M), e3 = say(endeks.ret3M);
  const satirlar = [...grup.values()].map((g) => {
    const r1 = g.uyeler.map((x) => say(x.ret1M)).filter((x) => x != null);
    const r3 = g.uyeler.map((x) => say(x.ret3M)).filter((x) => x != null);
    const m1 = medyan(r1), m3 = medyan(r3);
    // Lider = tema içinde 3 aylık getirisi en yüksek olanlar. Skor değil getiri,
    // çünkü skor kendi kalibrasyon tartışmasını taşıyor (score-calibration.js) ve
    // "bu tema neyle gidiyor" sorusunun cevabı fiilen getiren isimlerdir.
    const lider = [...g.uyeler]
      .filter((x) => say(x.ret3M) != null)
      .sort((a, b) => b.ret3M - a.ret3M)
      .slice(0, liderSayisi)
      .map((x) => ({
        sym: String(x.symbol || "").toUpperCase(), ad: x.name || null,
        ret1M: say(x.ret1M), ret3M: say(x.ret3M), score: say(x.score),
        fromHighPct: say(x.fromHighPct), owned: !!x.owned, story: x.story || null,
      }));
    return {
      key: g.key, title: g.title, n: g.uyeler.length,
      medyan1M: m1 == null ? null : +m1.toFixed(2),
      medyan3M: m3 == null ? null : +m3.toFixed(2),
      rs1M: m1 == null || e1 == null ? null : +(m1 - e1).toFixed(2),
      rs3M: m3 == null || e3 == null ? null : +(m3 - e3).toFixed(2),
      portfoyPct: say(agirlik[g.title]) ?? 0,
      zayifKanit: g.uyeler.length < MIN_SEMBOL,
      lider,
    };
  });

  // Sıralama 3 aylık göreli güce göre; ölçülemeyen tema en sona.
  satirlar.sort((a, b) => (b.rs3M ?? -Infinity) - (a.rs3M ?? -Infinity));
  const olculen = satirlar.filter((s) => s.rs3M != null);
  return {
    ok: olculen.length > 0,
    n: items.filter((x) => x?.theme?.title).length,
    temaSayisi: satirlar.length,
    endeks: { ret1M: e1, ret3M: e3 },
    satirlar,
    hukum: hukumCikar(satirlar, olculen),
  };
}

/**
 * Portföyün tema yerleşimi hakkında tek cümle. Ağırlığın liderde mi, geride mi?
 * Renk yalnız eylem gerektiren yerde (CLAUDE.md tasarım kuralı 3) — hüküm burada.
 */
function hukumCikar(satirlar, olculen) {
  if (!olculen.length) return null;
  const tutulan = satirlar.filter((s) => s.portfoyPct > 0 && s.rs3M != null);
  if (!tutulan.length) return { ton: "neu", metin: "Portföyünde radar temalarından biriyle eşleşen pozisyon yok — bu tablo evreni anlatır, seni değil." };

  // Ağırlıklı göreli güç: paranın fiilen durduğu yerin gücü.
  const toplamPct = tutulan.reduce((a, s) => a + s.portfoyPct, 0);
  const agirlikliRS = toplamPct > 0 ? tutulan.reduce((a, s) => a + s.rs3M * s.portfoyPct, 0) / toplamPct : null;
  const enBuyuk = [...tutulan].sort((a, b) => b.portfoyPct - a.portfoyPct)[0];
  const lider = olculen[0];
  const kacirilan = olculen.filter((s) => !s.portfoyPct && s.rs3M > 0);

  if (agirlikliRS == null) return null;
  const yon = agirlikliRS >= 0 ? "önünde" : "gerisinde";
  /* Hüküm KENDİ KAPSAMINI yazar. Portföyün büyük bölümü radar evreninde değilse
   * (radar evreninde olmayan isimler portföyün önemli bir kısmını tutabilir) bu cümle
   * paranın yalnız bir kısmını anlatır. Kapsamı yazmayan hüküm, ölçmediği paraya
   * da hükmetmiş gibi okunur. */
  const kapsam = toplamPct < 70 ? ` <i>(paranın %${toplamPct.toFixed(0)}'i ölçülebiliyor — kalanı radar evreninde değil)</i>` : "";
  const parca = [`Paranın ağırlıklı olarak durduğu temalar son 3 ayda endeksin <b>${Math.abs(agirlikliRS).toFixed(1)} puan ${yon}</b>.${kapsam}`];
  parca.push(`En büyük ağırlığın <b>${enBuyuk.title}</b> (%${enBuyuk.portfoyPct.toFixed(0)}) — o tema endeksin ${enBuyuk.rs3M >= 0 ? "+" : "−"}${Math.abs(enBuyuk.rs3M).toFixed(1)} puan ${enBuyuk.rs3M >= 0 ? "önünde" : "gerisinde"}.`);
  if (lider.title !== enBuyuk.title && !lider.portfoyPct) parca.push(`Evrenin lideri <b>${lider.title}</b> (${lider.rs3M >= 0 ? "+" : "−"}${Math.abs(lider.rs3M).toFixed(1)} puan) ve orada hiç pozisyonun yok.`);
  else if (kacirilan.length) parca.push(`Endeksi geçen ${kacirilan.length} temada hiç pozisyonun yok.`);

  return { ton: agirlikliRS >= 0 ? "ok" : "bad", agirlikliRS: +agirlikliRS.toFixed(2), olculenPay: +toplamPct.toFixed(1), metin: parca.join(" ") };
}
