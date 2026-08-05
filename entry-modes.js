/* entry-modes.js — GİRİŞ ZAMANLAMASI. Saf: fiyat çekmez, deftere yazmaz.
 *
 * NEDEN VAR (5 Ağu 2026): Alfa motoru teknik girişi bar KAPANINCA alır
 * (chSrvSignal → entry = c.close). Soru şu: "sinyali gün içinde görüp hemen
 * girsek daha mı iyi olurdu?" Bu bir strateji sorusudur, tahminle değil
 * ölçümle cevaplanmalı — o yüzden Laboratuvar'a bir varyant olarak girdi.
 *
 * GÜN İÇİ GİRİŞ NASIL MODELLENİR (ve neden bu dürüst):
 * Gün içi tik verimiz YOK. Ama gerçek hayatta "gün içi giriş" dediğin şey bir
 * ALIŞ-STOP EMRİDİR: akşam kapanışta kurulumu görürsün, "yarın EMA8'i yukarı
 * keserse al" emrini bırakırsın. Bu emir GÜNLÜK barla birebir sınanabilir:
 *   tetik  T = ema8[i-1]        (dünkü kapanışta bilinen tek EMA8 — bugünkü
 *                                EMA8 emri verirken HENÜZ YOKTUR)
 *   dolar mı → high[i] >= T
 *   dolum    → max(T, open[i])  (boşlukla açarsa stop emri açılışta dolar)
 * Tik verisi gerekmez, uydurma da yoktur.
 *
 * GÜN İÇİ GİRİŞİN GERÇEK BEDELİ — modelleme kusuru değil, kuralın kendisi:
 *   1) HACİM FİLTRESİ KAYBOLUR. "Kırılım hacimli mi?" ancak gün bitince belli
 *      olur. Emri sabah verdiysen bilmiyorsun. Kapanış girişinin en pahalı
 *      filtresi budur ve gün içi girişte uygulanamaz.
 *   2) STOP DAHA KÖRDÜR. QM stopu "günün dibi"dir; dolum anında günün dibi
 *      belli değildir. O yüzden ÖNCEKİ iki barın dibi kullanılır.
 *   3) KAPANIŞ TEYİDİ YOKTUR. Gün içi EMA8'i kesip kapanışta altına düşen
 *      barlar da işleme dönüşür — kapanış kuralının elediği tam bu küme.
 * Buna karşılık kazancı: dolum T'de olur, kapanış girişinin ödediği
 * "kapanışa kadar süren yükseliş" primi ödenmez.
 *
 * LOOKAHEAD YASAK: bu fonksiyon i barından SADECE open ve high okur. close,
 * low ve volume okunursa gelecekten bilgi sızar. Testte doğrudan sınanıyor
 * (i barının close/low/volume'ü değiştirilip sonucun sabit kalması). */

/* ADR% — server.js'teki chAdrAt ile AYNI formül; tek tanım kalsın diye buraya
 * taşındı, server oradan import ediyor. İki kopya olsa zamanla ayrışırdı. */
export const adrAt = (v, i, p = 20) => {
  let s = 0, k = 0;
  for (let j = i - p + 1; j <= i; j++) { const b = v[j]; if (!b) continue; s += (b.high - b.low) / b.close; k++; }
  return k ? (s / k) * 100 : null;
};

/* Kapanış girişindeki (chSrvSignal) eşiklerin aynısı — tek yerde. */
export const GIRIS_ESIK = { adrMin: 3, priorLegMin: 10, nearHighOran: 0.8 };

/* Gün içi (alış-stop) teknik giriş. Dolarsa {sym,date,entry,stop,...}, yoksa null.
 * `s` = { v, ema8, ema21, ema50, vma } (labCtx/chMkSeries'in ürettiği seri). */
export function seansIciGirisSinyali(s, sym, i) {
  if (!s || i < 62) return null;
  const v = s.v, c = v[i], p = v[i - 1], pp = v[i - 2];
  if (!c || !p || !pp) return null;

  /* ── Kurulum: YALNIZ kapanmış i-1 barından. Emri verdiğin an bu kadarını bilirsin. ── */
  const up = p.close > s.ema50[i - 1] && s.ema21[i - 1] > s.ema50[i - 1] && s.ema50[i - 1] > s.ema50[i - 11];
  const low5 = Math.min(...v.slice(i - 5, i).map((x) => x.close));
  const pullback = low5 < s.ema8[i - 2];
  const altinda = p.close <= s.ema8[i - 1];            // henüz kırmamış → kırılım taze olacak
  const hi60 = Math.max(...v.slice(i - 61, i).map((x) => x.high));
  const nearHigh = p.close >= GIRIS_ESIK.nearHighOran * hi60;
  const adr = adrAt(v, i - 1);
  const priorLeg = (p.close / Math.min(...v.slice(i - 41, i - 11).map((x) => x.close)) - 1) * 100;
  if (!(up && pullback && altinda && nearHigh && adr >= GIRIS_ESIK.adrMin && priorLeg >= GIRIS_ESIK.priorLegMin)) return null;
  /* Hacim filtresi burada YOK — bilerek. Gerekçe modül başında (2. madde). */

  /* ── Emir: tetik dünkü EMA8. Bugünkü EMA8 emri verirken hesaplanamaz. ── */
  const T = s.ema8[i - 1];
  if (!(T > 0)) return null;
  if (!(c.high >= T)) return null;                     // tetiğe değmedi → emir dolmadı
  const entry = Math.max(T, c.open);                   // boşlukla açtıysa dolum açılışta

  /* Stop: dolum anında GÜNÜN dibi bilinmez → önceki iki barın dibi (ya da ADR tabanı). */
  const stop = Math.max(Math.min(p.low, pp.low), entry - 1.2 * (adr / 100) * entry);
  if (!(entry > stop)) return null;

  return {
    sym, date: c.time, entry, stop, lane: "tech", seansIci: true,
    volRatio: s.vma[i - 1] ? p.volume / s.vma[i - 1] : 0,   // dünkü hacim — sıralama için
    adr, priorLeg,
    tetik: T, bosluklaDoldu: c.open > T,
  };
}
