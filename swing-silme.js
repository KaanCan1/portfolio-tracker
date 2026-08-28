/* swing-silme.js — bir swing kaydı silinirken ne yapılacağına karar verir.
 * Saf: veri bilmez, yalnız kaydın şekline bakar → testler GERÇEK kodu import eder.
 *
 * NEDEN AYRI DOSYA (20 Ağu 2026): kural üç satır ama YIKICI bir yolu yönetiyor ve
 * iki aşamalı. Uç noktanın içinde `if (hasRealized)` olarak duruyordu; biri
 * "sadeleştirip" arşivleme dalını kaldırsa gerçekleşmiş kâr sessizce silinir,
 * dalı kaldırmayıp `!archived` şartını düşürse kayıt HİÇ silinemez hale gelir.
 * İkisi de sessiz: HTTP 200 döner, kullanıcı yaptığını sanır. Bir kez yaşandı —
 * Kaan yanlış girdiği bir kaydı silemedi, defalarca "silindi" okudu.
 */

/**
 * @param {object|undefined} sw  swing kaydı (bulunamadıysa undefined)
 * @returns {"arsivle"|"sil"}
 *
 * ARŞİVLE: kısmi satıştan gerçekleşmiş kâr var ve kayıt henüz arşivde değil.
 *   Tamamen silmek o kârı ayın realize toplamından geriye dönük düşerdi.
 * SİL: kâr yok (kayıt zaten hayalî), ya da kullanıcı arşivdeki kayda BİR DAHA
 *   bastı — yani bilerek istiyor. Kazara silmek zor, bilerek silmek mümkün.
 */
export function silmeKarari(sw) {
  const kismiKar = !!(sw && Array.isArray(sw.realizedLots) && sw.realizedLots.length > 0);
  return kismiKar && !sw.archived ? "arsivle" : "sil";
}
