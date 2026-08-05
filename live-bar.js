/* live-bar.js — günlük mum serisine BUGÜNÜN canlı barını bindirir. Saf.
 *
 * NEDEN VAR (5 Ağu 2026): Alfa Avı motoru fiyatı SADECE candleCache'ten
 * okuyordu ve o önbellek 18 saat TTL'li. Sonuç: seans içinde açık pozisyonda
 * dünün kapanışı görünüyordu, hedef/stop kontrolü de kapanmış mumla
 * yapılıyordu — "2026-08-03 mumunda hedef görüldü" mailleri bu yüzden
 * kapanış sonrası düşüyordu.
 *
 * NEDEN MUMU TAZELEMİYORUZ: 60 sembollük evrende mumu 5 dk'da bir çekmek
 * TwelveData kotasını (dk'da 7, günde 680 arka plan) anında yakardı. Canlı
 * kotasyon ise TEK toplu çağrı ve zaten 60 sn önbellekli — portföyün
 * kullandığı yolun aynısı.
 *
 * DETERMİNİZM KORUNUR: TP ve stop kontrolü high/low üzerinden yapılır ve
 * bunlar gün içinde TEK YÖNLÜ büyür. Kısmi barda "high >= tp1" doğruysa,
 * günün kapanmış barında da doğrudur — tekrar oynatma aynı sonucu verir.
 * (EMA21 iz süren çıkışı close'a baktığı için tek yönlü DEĞİLDİR; çağıran
 * onu kapanmış barla sınırlamalıdır.) */

export function canliBarBindir(candles, kotasyon, bugun) {
  if (!Array.isArray(candles) || !candles.length) return candles;
  const fiyat = Number(kotasyon?.price);
  if (!(fiyat > 0)) return candles;          // canlı fiyat yoksa seriye dokunma

  const son = candles[candles.length - 1];
  if (son?.time === bugun) {
    // Bugünün barı zaten var → yüksek/düşük GENİŞLETİLİR (asla daralmaz),
    // kapanış canlı fiyat olur. Daraltmak geçmişi çarpıtırdı.
    return [...candles.slice(0, -1), {
      ...son,
      high: Math.max(Number(son.high) || fiyat, fiyat),
      low: Math.min(Number(son.low) || fiyat, fiyat),
      close: fiyat,
      canli: true,
    }];
  }

  /* Bugünün barı hiç yok → sentetik bar. open = canlı fiyat (prevClose DEĞİL):
   * motor `c.open < stop` ile "açılışta boşluk" çıkışı arıyor; open'a prevClose
   * yazmak sahte boşluk üretebilirdi. open = fiyat olunca, fiyat stopun
   * altındaysa çıkış zaten canlı fiyattan olur — canlı hesap için doğrusu bu. */
  return [...candles, {
    time: bugun, open: fiyat,
    high: fiyat, low: fiyat, close: fiyat,
    volume: 0, canli: true,
  }];
}

/* Seriyi bugüne kadar KAPANMIŞ barlarla sınırlar — close'a bakan kararlar
 * (EMA21 iz süren) için. Canlı bar tek yönlü olmadığından oraya girmemeli. */
export function kapanmisBarlar(candles, bugun) {
  if (!Array.isArray(candles)) return candles;
  return candles.filter((c) => String(c?.time || "") < bugun);
}
