/* nakit-komisyon.js — bir emrin NAKDE etkisi. Saf: veri/tarih bilmez, testli.
 *
 * NEDEN AYRI DOSYA (21 Ağu 2026): aynı muhasebe iki yerde yazılıydı ve biri
 * komisyonu unutmuştu.
 *   POST /api/trades  → nakit −(adet×fiyat) − $1.5   (doğru)
 *   appendBuyTrade    → nakit −(adet×fiyat)          (EKSİK)
 * İkincisi "+ Varlık Ekle" / hızlı ekleme yolu: bu yoldan girilen bir alışta
 * nakitten yalnız tutar düşüyor, $1.5 komisyon hiç görünmüyordu. Sessiz sapma: iki yol da HTTP 200
 * döner, tek fark nakit bakiyesinde birikir ve ancak aracı kurumla karşılaştırınca
 * fark edilir.
 *
 * CLAUDE.md: "Bir sayının iki hesabı varsa biri bozuktur; hangisi olduğunu
 * ölçmeden önce bileşenleri tek kaynağa indir." Bu dosya o tek kaynak.
 */

/** Midas her EMİRDE sabit ücret keser: alışta 1 kez, her satış emrinde ayrı
 *  (TP1/TP2/final üç ayrı emirdir). */
export const MIDAS_FEE = 1.5;

const say = (v) => (Number.isFinite(+v) ? +v : 0);

/**
 * Alışın nakde etkisi — NEGATİF döner (nakit azalır).
 * Komisyon tutara EKLENİR: $500'lık alış cebinden $501,5 çıkarır.
 * Adet ya da fiyat geçersizse 0 döner — "emir yok, ücret de yok".
 */
export function alisNakitDelta(adet, fiyat, fee = MIDAS_FEE) {
  const tutar = say(adet) * say(fiyat);
  if (!(tutar > 0)) return 0;
  return -(tutar + say(fee));
}

/**
 * Satışın nakde etkisi — POZİTİF döner (nakit artar).
 * Komisyon gelirden DÜŞÜLÜR: $300'lık satış cebine $298,5 koyar.
 */
export function satisNakitDelta(adet, fiyat, fee = MIDAS_FEE) {
  const gelir = say(adet) * say(fiyat);
  if (!(gelir > 0)) return 0;
  return gelir - say(fee);
}

/** Nakit bakiyesine deltayı uygular, 2 haneye yuvarlar. */
export function nakitUygula(mevcut, delta) {
  return +((say(mevcut) + say(delta)).toFixed(2));
}
