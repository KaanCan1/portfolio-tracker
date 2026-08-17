/* score-calibration.js — ham fırsat skorunu ÖLÇÜLMÜŞ sonuçla hizalar.
 *
 * SORUN (10 Ağu 2026): kart "100 FIRSAT SKORU" yazarken aynı kartın altında
 * "geçmiş isabet %14 · ort −0.6R" yazıyordu. Skor bir kanaat, ölçüm ise gerçekti
 * ve ikisi birbirini görmüyordu. 100 sayısı hiçbir kanıta dayanmıyordu.
 *
 * ÇÖZÜM — kanıtla ORANTILI düzeltme (shrinkage), kör düzeltme değil:
 *
 *   kalibre = ham × (1 + güven × beklenti)
 *
 * güven, örneklem büyüdükçe 0→1'e yaklaşır ve İKİ ayrı kısıttan geçer:
 *   • işlem sayısı  : n / (n + K)
 *   • BAĞIMSIZ GÜN  : gun / (gun + G)
 * İkincisi kritik: aynı gün açılan 18 sinyal aynı piyasa hareketini yaşar, 18
 * bağımsız gözlem DEĞİLDİR. Temmuz ölçümünde 68 işlemin 10 günden gelmesi tam
 * bu tuzaktı — yalnız n'e bakan bir kalibrasyon kendine fazla güvenirdi.
 *
 * Veri yoksa güven 0 → çarpan 1 → skor DEĞİŞMEZ. Kalibrasyon, kanıt oluştukça
 * devreye giren bir düzeltmedir; yokluğunda kanaat olduğu gibi kalır ama etiketi
 * dürüsttür ("ölçülmedi").
 *
 * Beklenti (ort R) hesabına AÇIK pozisyonlar da girer (mtmR). Yalnız kapananlara
 * bakmak sistematik olarak kötümserdir: stop kesin bir çıkıştır, kazanan ise
 * koşmaya devam edip "açık" kalır — kapananlar kaybedenlerle dolar. */

export const KALIBRE = {
  K: 20,          // işlem sayısı yarı-güven noktası
  G: 10,          // bağımsız gün yarı-güven noktası
  rTavan: 1,      // beklentinin çarpana etkisi ±1R ile sınırlı (uç değer skoru uçurmasın)
  yeterliN: 10,   // altındaysa "ölçüm yetersiz" denir
  yeterliGun: 8,  // bağımsız gün eşiği
};

const kis = (x, a, b) => Math.max(a, Math.min(b, x));

/** Defter kayıtlarından bir kurulum tipinin kanıt özeti.
 *  @param kayitlar tek bir kurulum tipine ait defter kayıtları */
export function kanitOzeti(kayitlar = []) {
  const kapali = kayitlar.filter((k) => ["target", "stop", "timeout"].includes(k.status));
  const acik = kayitlar.filter((k) => k.status === "open" && typeof k.mtmR === "number");
  const rler = [...kapali.map((k) => k.r), ...acik.map((k) => k.mtmR)]
    .filter((x) => typeof x === "number" && isFinite(x));
  const gunler = new Set([...kapali, ...acik].map((k) => k.signalDate).filter(Boolean));
  const kazanan = kapali.filter((k) => (k.r ?? 0) > 0).length;
  return {
    n: rler.length,
    kapaliN: kapali.length,
    acikN: acik.length,
    gun: gunler.size,
    isabet: kapali.length ? Math.round((kazanan / kapali.length) * 100) : null,
    ortR: rler.length ? rler.reduce((a, b) => a + b, 0) / rler.length : null,
  };
}

/** Ham skoru kanıtla hizala. Ham skor KIRPILMAMIŞ verilmelidir (0-100'e burada
 *  kırpılır); önce kırpılırsa 124 → 100 → düzeltme kaybolur. */
export function kalibreSkor(hamSkor, kanit = null, ayar = KALIBRE) {
  const ham = typeof hamSkor === "number" && isFinite(hamSkor) ? hamSkor : 0;
  const yok = { skor: kis(Math.round(ham), 0, 100), carpan: 1, guven: 0, durum: "olculmedi",
    etiket: "ölçülmedi", aciklama: "Bu kurulum için henüz sonuç ölçülmedi — skor yalnızca bir tarama kanaati." };
  if (!kanit || !kanit.n || kanit.ortR == null) return yok;

  const guvenN = kanit.n / (kanit.n + ayar.K);
  const guvenGun = (kanit.gun || 0) / ((kanit.gun || 0) + ayar.G);
  const guven = +(guvenN * guvenGun).toFixed(3);
  const beklenti = kis(kanit.ortR, -ayar.rTavan, ayar.rTavan);
  const carpan = +(1 + guven * beklenti).toFixed(3);
  const skor = kis(Math.round(ham * carpan), 0, 100);

  const yetersiz = kanit.n < ayar.yeterliN || (kanit.gun || 0) < ayar.yeterliGun;
  const rMetin = `${beklenti >= 0 ? "+" : ""}${kanit.ortR.toFixed(2)}R`;
  const ornek = `${kanit.n} işlem · ${kanit.gun} gün`;
  return {
    skor, carpan, guven,
    durum: yetersiz ? "zayif-kanit" : beklenti >= 0 ? "kanitli" : "olumsuz-kanit",
    etiket: yetersiz ? `ölçüm yetersiz (${ornek})` : `ölçüm: ${rMetin} · ${ornek}`,
    aciklama: yetersiz
      ? `Kanıt zayıf (${ornek}); skor kanaate yakın kaldı. Aynı gün açılan sinyaller bağımsız gözlem sayılmaz.`
      : `Bu kurulumun ölçülmüş beklentisi işlem başına ${rMetin} (${ornek}). Ham skor ${Math.round(ham)} → ${skor}.`,
  };
}
