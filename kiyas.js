/* kiyas.js — "piyasayı yendim mi?" sorusunun saf hesap katmanı.
 *
 * 16 Ağu: Analiz sekmesinde aynı soruya cevap veren İKİ panel vardı ve iki farklı
 * sayı söylüyorlardı. Risk karnesinin altındaki "Benchmark" bloğu %66,7 diyordu,
 * altındaki "Temel çizgi" paneli TWR ile hesaplıyordu. Benchmark bloğunun alt notu
 * "TWR — para giriş/çıkışı bozmaz" yazıyordu ama serisi (renderRisk'in vN/v0−1'i)
 * akıştan hiç arındırılmamıştı: PR #51'de temel çizgide düzeltilen hata orada
 * duruyordu. Not ölçümü değil, ölçümün olmasını istediğimiz hâlini anlatıyordu.
 *
 * İki panel tek panele indi, hesap buraya çıktı. Kural: bu dosya DOM bilmez,
 * fetch etmez — girdi verilir, ölçüm döner, test gerçek kodu çağırır.
 *
 * DÖRT TUZAK (CLAUDE.md) burada nasıl karşılanıyor:
 *  · Temel çizgi yokluğu → zaten işin tamamı bu; portföy tek başına okunmuyor.
 *  · Sağdan sansür → yok; günlük seri kapanmış/açık ayrımı taşımıyor.
 *  · Gün kümelenmesi → ortak gün sayısı ham gözlem sayısı olarak DEĞİL, pencere
 *    uzunluğu olarak raporlanır; yorum katmanı "tek rejim" yanlılığını yazar.
 *  · Çakışan pencereler → günlük getiriler örtüşmez, sorun yok.
 */

const g10 = (x) => String(x ?? "").slice(0, 10);
const ORT = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/**
 * Zincirlenmiş endeksten günlük getiriler (fraksiyon).
 * @param {boolean[]} maske  i. adım GÜNLÜK mü (i≥1). Verilirse false adımlar atlanır.
 *
 * Maske neden var: 16 Ağu'da defterde Mart–Mayıs arası seyrek kayıtlar bulundu
 * (2 Mart → 1 Nisan tek adım, hepsi aynı kurla). Maskesiz hesapta o 30 günlük
 * sıçrama "bir günlük getiri" sayılıyor; √252 ile yıllıklanınca volatilite,
 * Sharpe, beta, en kötü gün — hepsi uydurma çıkar. Birikimli getiri zincirin
 * TAMAMINDAN okunur (o sıçrama gerçekten yaşandı), günlük İSTATİSTİK yalnız
 * gerçekten günlük olan adımlardan.
 */
export function gunlukGetiriler(zincir = [], maske = null) {
  const r = [];
  for (let i = 1; i < zincir.length; i++) {
    if (maske && !maske[i]) continue;
    if (zincir[i - 1] > 0) r.push(zincir[i] / zincir[i - 1] - 1);
  }
  return r;
}

/**
 * Ardışık gün maskesi: iki kayıt arası takvim farkı maxBosluk günü aşarsa o adım
 * günlük istatistiğe girmez. Varsayılan 4 gün — hafta sonu (3) + resmî tatil payı.
 */
export function adimMaskesi(tarihler = [], maxBosluk = 4) {
  const m = [false];
  for (let i = 1; i < tarihler.length; i++) {
    const fark = (new Date(tarihler[i]) - new Date(tarihler[i - 1])) / 86400000;
    m.push(isFinite(fark) && fark > 0 && fark <= maxBosluk);
  }
  return m;
}

/**
 * Zaman ağırlıklı getiri zinciri (TWR). 1'den başlar.
 * Günün getirisi o gün İÇERİ GİREN paradan arındırılır: r = (v_i − f_i)/v_{i−1} − 1.
 * Yatırdığın para performans değildir; arındırmazsan mevduat kazanç görünür.
 * @param {number[]} degerler  gün sonu değerler (aynı para birimi)
 * @param {number[]} akislar   aynı indeksli net akış (+ giriş, − çıkış); yoksa 0
 */
export function twrZincir(degerler = [], akislar = []) {
  const out = [1];
  for (let i = 1; i < degerler.length; i++) {
    const onceki = degerler[i - 1];
    const f = Number(akislar[i]) || 0;
    const r = onceki > 0 ? (degerler[i] - f) / onceki - 1 : 0;
    out.push(out[i - 1] * (1 + (isFinite(r) ? r : 0)));
  }
  return out;
}

/** Bir zincirin tüm okunabilir metrikleri. Getiriler fraksiyon (0,12 = %12). */
export function seriMetrik(zincir = [], maske = null) {
  const r = gunlukGetiriler(zincir, maske);
  const n = r.length;
  const getiri = zincir.length > 1 && zincir[0] > 0 ? zincir[zincir.length - 1] / zincir[0] - 1 : null;
  if (!n) return { getiri, yillikVol: null, sharpe: null, maxDD: null, enKotuGun: null, enIyiGun: null, pozitifOran: null, n: 0 };
  const m = ORT(r);
  const sd = n > 1 ? Math.sqrt(r.reduce((a, v) => a + (v - m) ** 2, 0) / (n - 1)) : 0;
  const ANN = Math.sqrt(252);
  let zirve = -Infinity, maxDD = 0;
  for (const v of zincir) { zirve = Math.max(zirve, v); if (zirve > 0) maxDD = Math.min(maxDD, v / zirve - 1); }
  return {
    getiri,
    yillikVol: sd > 0 ? sd * ANN : null,
    sharpe: sd > 0 ? (m / sd) * ANN : null,      // risksiz oran 0 — renderRisk ile aynı kabul
    maxDD,
    enKotuGun: Math.min(...r),
    enIyiGun: Math.max(...r),
    pozitifOran: r.filter((x) => x > 0).length / n,
    n,
  };
}

/**
 * Gerçekleşmiş beta + R² + yıllık Jensen alfası.
 * R² OLMADAN BETA YORUMLANMAZ: düşük R², endeksin portföyü açıklamadığı anlamına
 * gelir ve beta o durumda gürültünün eğimidir (docs/olcumler.md §14).
 */
export function betaR2(rp = [], rq = []) {
  const n = Math.min(rp.length, rq.length);
  if (n < 20) return { beta: null, r2: null, jensen: null, n };
  const a = rp.slice(-n), b = rq.slice(-n);
  const ma = ORT(a), mb = ORT(b);
  const cov = a.reduce((s, _, i) => s + (a[i] - ma) * (b[i] - mb), 0) / (n - 1);
  const vb = b.reduce((s, v) => s + (v - mb) ** 2, 0) / (n - 1);
  const sa = Math.sqrt(a.reduce((s, v) => s + (v - ma) ** 2, 0) / (n - 1)), sb = Math.sqrt(vb);
  if (!(vb > 0) || !(sa > 0)) return { beta: null, r2: null, jensen: null, n };
  const beta = cov / vb;
  return { beta, r2: (cov / (sa * sb)) ** 2, jensen: (ma - beta * mb) * 252, n };
}

/**
 * Yukarı/aşağı yakalama: endeksin yükseldiği günlerde ortalama ne kadarını aldın,
 * düştüğü günlerde ne kadarını yedin. İyi profil: yukarı > 1, aşağı < 1.
 * Tek başına getiriden daha çok şey söyler — asimetriyi gösterir.
 */
export function yakalama(rp = [], rq = []) {
  const n = Math.min(rp.length, rq.length);
  const up = [], upx = [], dn = [], dnx = [];
  for (let i = 0; i < n; i++) {
    if (rq[i] > 0) { up.push(rp[i]); upx.push(rq[i]); }
    else if (rq[i] < 0) { dn.push(rp[i]); dnx.push(rq[i]); }
  }
  const oran = (a, b) => (a.length >= 5 && ORT(b) !== 0 ? ORT(a) / ORT(b) : null);
  return { yukari: oran(up, upx), asagi: oran(dn, dnx), yukariN: up.length, asagiN: dn.length };
}

/**
 * Tam kıyas. Portföyün gün sonu kayıtlarını bir veya daha çok endeksle aynı
 * pencerede karşılaştırır.
 *
 * @param {Array}  snaps      [{date, total, usdtry}] — TL anlık görüntü + o günkü kur
 * @param {Array}  flows      [{date, type:'deposit'|'withdraw', amountTRY}]
 * @param {Object} endeksler  { QQQ:[{date|time, close}], SPY:[...] }
 * @param {number} minGun     bu kadar ortak gün yoksa ölçüm yapılmaz
 * @param {number} sonPencere son-dönem alfası için gün sayısı (kenar bozulmasın diye ayrı)
 * @param {string} baslangic  bu günden ÖNCEKİ kayıtlar hiç ölçülmez (YYYY-MM-DD)
 */
export function kiyasHesapla({ snaps = [], flows = [], endeksler = {}, minGun = 10, sonPencere = 30, maxBosluk = 4, baslangic = null } = {}) {
  // Aynı güne birden çok kayıt varsa sonuncusu geçerli (gün içi yazımlar üst üste biner)
  const gunler = new Map();
  for (const s of snaps || []) {
    if (!s?.date || !(s.total > 0) || !(s.usdtry > 0)) continue;
    const g = g10(s.date);
    if (baslangic && g < baslangic) continue;   // geriye doldurulmuş kayıt ölçüme girmez
    gunler.set(g, { d: g, usd: s.total / s.usdtry, kur: s.usdtry });
  }
  const temiz = [...gunler.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
  if (temiz.length < minGun) return { ok: false, neden: "kayit", n: temiz.length, minGun };

  const adlar = Object.keys(endeksler || {}).filter((k) => (endeksler[k] || []).length);
  if (!adlar.length) return { ok: false, neden: "endeks", n: 0, minGun };
  const haritalar = {};
  for (const ad of adlar) {
    haritalar[ad] = new Map();
    for (const c of endeksler[ad] || []) {
      const g = g10(c.date ?? c.time);
      if (g && c.close > 0) haritalar[ad].set(g, c.close);
    }
  }
  // ORTAK GÜN: portföy kaydı + HER endeksin barı. Tek takvim olmazsa seriler
  // farklı pencereleri ölçer ve alfa uydurma çıkar.
  const ortak = temiz.filter((s) => adlar.every((ad) => haritalar[ad].get(s.d) > 0));
  if (ortak.length < minGun) return { ok: false, neden: "ortak", n: ortak.length, minGun };

  /* Akış eşleme: para hareketi borsa tatiline denk gelirse kaydı DÜŞÜRME —
   * penceredeki ilk sonraki ortak güne taşı. Eski sürüm eşleşmeyen akışı sessizce
   * atıyordu; atılan her akış getiri gibi görünür. */
  const akisUSD = new Array(ortak.length).fill(0);
  const indeks = new Map(ortak.map((s, i) => [s.d, i]));
  for (const f of flows || []) {
    const g = g10(f?.date); if (!g) continue;
    const tutar = Number(f.amountTRY); if (!isFinite(tutar) || !tutar) continue;
    let i = indeks.get(g);
    if (i == null) { i = ortak.findIndex((s) => s.d > g); if (i < 0) continue; }  // pencere dışına taşma → yok say
    if (i === 0) continue;                                    // ilk gün taban; getiri üretmez
    akisUSD[i] += (f.type === "withdraw" ? -1 : 1) * tutar / ortak[i].kur;
  }

  const maske = adimMaskesi(ortak.map((x) => x.d), maxBosluk);
  const atlanan = maske.slice(1).filter((x) => !x).length;

  const P = twrZincir(ortak.map((x) => x.usd), akisUSD);
  const rp = gunlukGetiriler(P, maske);
  const portfoy = seriMetrik(P, maske);
  const akisN = akisUSD.filter((x) => x !== 0).length;

  const kes = Math.max(0, rp.length - sonPencere);
  const endeks = {};
  for (const ad of adlar) {
    const Q = twrZincir(ortak.map((x) => haritalar[ad].get(x.d)));
    const rq = gunlukGetiriler(Q, maske);
    const m = seriMetrik(Q, maske);
    const sonAlfa = rp.length - kes >= 10
      ? rp.slice(kes).reduce((a, b) => a * (1 + b), 1) - rq.slice(kes).reduce((a, b) => a * (1 + b), 1)
      : null;
    endeks[ad] = {
      ...m,
      zincir: Q,
      alfa: portfoy.getiri != null && m.getiri != null ? portfoy.getiri - m.getiri : null,
      ...betaR2(rp, rq),
      yakalama: yakalama(rp, rq),
      sonAlfa,
      sonGun: rp.length - kes,
    };
  }

  return {
    ok: true,
    n: ortak.length,
    d0: ortak[0].d,
    d1: ortak[ortak.length - 1].d,
    takvimGun: Math.round((new Date(ortak[ortak.length - 1].d) - new Date(ortak[0].d)) / 86400000),
    baslangic,                                 // pencere alt sınırı (varsa) — panel bunu yazar
    akisN,
    atlanan,                                   // günlük istatistiğe girmeyen sıçrama sayısı
    gunlukN: portfoy.n,                         // istatistiğin gerçekten dayandığı gün sayısı
    tarihler: ortak.map((x) => x.d),
    // gunluk: maskeden geçmiş günlük getiriler. Risk karnesi de bunu kullanır —
    // iki panel aynı seriyi konuşsun diye tek yerde üretilir.
    portfoy: { ...portfoy, zincir: P, gunluk: rp },
    endeks,
  };
}

/**
 * Hüküm. Getiri farkı TEK BAŞINA yeterli değildir — düşüş bedeliyle birlikte okunur.
 * Fazla getiri fazla sarsıntıyla alındıysa bedava değildir.
 */
export function kiyasHukum(sonuc, ana) {
  if (!sonuc?.ok) return null;
  const e = sonuc.endeks?.[ana]; if (!e || e.alfa == null) return null;
  const alfa = e.alfa * 100;
  const kat = e.maxDD < -0.001 ? Math.abs(sonuc.portfoy.maxDD / e.maxDD) : null;
  if (alfa <= 0) {
    return { ton: "bad", alfa, kat, metin: `${ana}'nın <b>${Math.abs(alfa).toFixed(1)} puan gerisindesin</b>. Aynı parayı hiç uğraşmadan endekste tutmak bu pencerede daha iyiydi — seçim yapmak değer katmadı.` };
  }
  if (kat && kat >= 1.5) {
    return { ton: "warn", alfa, kat, metin: `${ana}'yı <b>${alfa.toFixed(1)} puan</b> yendin ama düşüşün endeksin <b>${kat.toFixed(1)} katı</b>. Fazla getiri fazla sarsıntıyla alınmış — bedava değil.` };
  }
  return { ton: "ok", alfa, kat, metin: `${ana}'yı <b>${alfa.toFixed(1)} puan</b> yendin ve düşüşün endeksten fazla değil. Bu pencerede seçim yapmak işe yaradı.` };
}
