/* signal-gates.js — kurulum kapıları: oynaklık tavanı + göreli güç eşiği.
 *
 * NEDEN VAR (10 Ağu 2026 ölçümü, 80 sinyal / 10 gün ufuk):
 *
 *  • Sinyaller aynı günlerde QQQ'nun 1.58 puan ALTINDA kaldı; yalnız 33/80'i
 *    endeksi yendi. Yani "kurulum" girdiği anda üstünlük üretmiyordu.
 *  • Stop × hedef matrisinin (1..4×ATR, 5-40 gün) HER hücresi negatifti. Çıkışı
 *    değiştirmek kurtarmıyor → sorun girişte. Hedef geometrisine dokunmak yerine
 *    girişi daraltmak gerekiyordu.
 *  • Ölçülebilir etkisi olan tek değişken oynaklıktı: sakin dilim (ATR %1.3-4.3)
 *    −0.19R, oynak dilim (%8.8-17.5) −0.46R. Evrenin ortalama günlük ATR'si %7;
 *    10 günlük gürültü bandı ≈ ATR×√10 ≈ %22, stoplar ise %12-15'te duruyordu —
 *    yani stop bandın İÇİNDE, gürültüden vuruluyordu.
 *
 * İki kapı da FAIL-OPEN'dır: veri yoksa sinyal geçer. Sebep, eksik veriyle tüm
 * evreni sessizce susturmanın (bir gün QQQ mumları gelmezse hiç sinyal üretmemek)
 * yanlış sinyalden daha kötü olmasıdır — sessizlik fark edilmez.
 *
 * Eşikler burada TEK YERDE; deneyin sonucu ölçülüp değiştirilecek. */

export const KAPI = {
  atrTavanPct: 8,   // günlük ATR/fiyat bunun üstündeyse kurulum yok
  rsUfukGun: 60,    // göreli güç penceresi (işlem günü)
  rsMinFark: 0,     // hisse getirisi − endeks getirisi bu puanın altındaysa kurulum yok
};

/** Günlük ATR'nin fiyata oranı (%) — "bu hisse günde ne kadar oynuyor". */
export const oynaklikPct = (atr, price) =>
  (typeof atr === "number" && typeof price === "number" && isFinite(atr) && isFinite(price) && price > 0
    ? (atr / price) * 100
    : null);

/** n gün önceye göre yüzde getiri. Seri kısa/bozuksa null (kapı fail-open olsun). */
export function getiriPct(kapanislar, n) {
  if (!Array.isArray(kapanislar) || kapanislar.length < n + 1) return null;
  const son = kapanislar[kapanislar.length - 1], ilk = kapanislar[kapanislar.length - 1 - n];
  if (!isFinite(son) || !isFinite(ilk) || ilk <= 0) return null;
  return ((son - ilk) / ilk) * 100;
}

/** Göreli güç: hisse getirisi − endeks getirisi (puan). Biri yoksa null. */
export function goreliGuc(hisseKapanislar, endeksKapanislar, gun = KAPI.rsUfukGun) {
  const h = getiriPct(hisseKapanislar, gun), e = getiriPct(endeksKapanislar, gun);
  return h == null || e == null ? null : +(h - e).toFixed(2);
}

/**
 * Kurulum kapısı. { gecti, sebep } döner; sebep yalnız reddedince doludur ve
 * kullanıcıya gösterilebilecek düz Türkçedir.
 * @param atrPct  oynaklikPct çıktısı (null → oynaklık kapısı uygulanmaz)
 * @param rsFark  goreliGuc çıktısı (null → RS kapısı uygulanmaz)
 */
export function kurulumKapisi({ atrPct = null, rsFark = null } = {}, esik = KAPI) {
  if (atrPct != null && atrPct > esik.atrTavanPct)
    return { gecti: false, kapi: "oynaklik",
      sebep: `Çok oynak (günlük ATR %${atrPct.toFixed(1)} > %${esik.atrTavanPct}) — 10 günlük gürültü bandı stopu yutar.` };
  if (rsFark != null && rsFark < esik.rsMinFark)
    return { gecti: false, kapi: "goreli-guc",
      sebep: `Endeksin gerisinde (${esik.rsUfukGun}g göreli güç ${rsFark.toFixed(1)} puan) — ölçüm bu grubun QQQ'yu yenmediğini gösterdi.` };
  return { gecti: true, kapi: null, sebep: null };
}
