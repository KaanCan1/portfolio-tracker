/* risk-mc.js — Monte Carlo portföy riski: VaR · CVaR · Cholesky ile korelasyon.
 *
 * NEDEN VAR (17 Ağu 2026): Risk masasındaki VaR (`/api/risk`) korelasyonu ZATEN
 * biliyor — çünkü σ'yı tek tek hisselerden değil, ağırlıklı portföy getiri
 * serisinden (`portRet`) hesaplıyor; birlikte hareket veriye gömülü geliyor.
 * Ama uygulamanın İKİNCİ risk hesabı, pozisyon boyutlandırma (`raAdet` · 05,
 * `swingSizeCalc` · 08, `/api/risk` suggestUSD), her pozisyonu tek başına ölçüyor:
 * "sermayenin %1'i stopta risk". Altı pozisyonda bu sessizce "toplam %6 risk"
 * demeye gelir ve o cümle YALNIZ pozisyonlar bağımsızsa doğrudur. Piyasa düştüğü
 * gün hepsi birlikte düşer, stoplar aynı sabah delinir.
 *
 * Yani varsayım kodun içinde değil, yokluğundaydı: "her pozisyona ayrı %1" satırının
 * hiçbir yerinde "bu pozisyonlar bağımsızdır" yazmıyor.
 *
 * Bu modül o boşluğu ÖLÇÜLEBİLİR hâle getirir. İki modeli aynı marjinal
 * volatilitelerle koşturur, tek farkı korelasyondur:
 *   bağımsız    → L = diag(σ)            (kovaryansın köşegeni; ilişki yok)
 *   korelasyonlu → L = chol(Σ),  Σ = L·Lᵀ  (tam kovaryans)
 * Aradaki fark, boyutlandırma kuralının göremediği risktir.
 *
 * Saf modül: yan etkisi yok, ağ çağrısı yok, tohumlu rastgelelik → aynı girdi
 * aynı sayıyı verir (`swing-proven.js`'teki bootCI deseninin aynısı).
 *
 * SINIR — bu modül normal dağılım varsayar. Gerçek getiriler kalın kuyrukludur;
 * `tarihselVarCvar` bu yüzden yanında durur ve `ihlalTesti` hangisinin gerçeğe
 * yakın olduğunu SAYAR. Modelin çıktısına, ihlal testini görmeden güvenme. */

import { mulberry32 } from "./swing-proven.js";

/* ===== Getiri serisi ===== */

/** Mumlardan günlük getiri: {time, close} → [{time, r}]. İlk bar getiri üretmez. */
export function gunlukGetiri(mumlar) {
  const out = [];
  const c = (mumlar || []).filter((m) => m && Number(m.close) > 0);
  for (let i = 1; i < c.length; i++) out.push({ time: c[i].time, r: c[i].close / c[i - 1].close - 1 });
  return out;
}

/**
 * Sembolleri ORTAK tarihlerde hizalar.
 * NEDEN: bir hissenin halka arzı geç ya da bir günü eksikse, seriler kaydırılmadan
 * yan yana konduğunda kovaryans farklı GÜNLERİ eşleştirir ve korelasyon uydurur.
 * Kesişim almak gözlem sayısını düşürür ama sayıyı gerçek tutar.
 * @param {Record<string, Array>} mumlarBySym
 * @returns {{semboller:string[], tarihler:string[], R:number[][]}} R[i] = i'inci sembolün getirileri
 */
export function hizala(mumlarBySym, pencere = Infinity) {
  const semboller = Object.keys(mumlarBySym);
  const haritalar = semboller.map((s) => {
    const m = new Map();
    for (const g of gunlukGetiri(mumlarBySym[s])) m.set(g.time, g.r);
    return m;
  });
  if (!haritalar.length) return { semboller: [], tarihler: [], R: [] };
  let ortak = [...haritalar[0].keys()];
  for (const h of haritalar.slice(1)) ortak = ortak.filter((t) => h.has(t));
  ortak.sort();
  const tarihler = pencere < ortak.length ? ortak.slice(-pencere) : ortak;
  return { semboller, tarihler, R: haritalar.map((h) => tarihler.map((t) => h.get(t))) };
}

/* ===== Kovaryans ===== */

export const ortalama = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/** Örneklem kovaryansı (n−1). R[i] = i'inci varlığın getiri dizisi. */
export function kovaryansMatrisi(R) {
  const n = R.length;
  if (!n) return [];
  const T = R[0].length;
  const mu = R.map(ortalama);
  const S = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      for (let t = 0; t < T; t++) s += (R[i][t] - mu[i]) * (R[j][t] - mu[j]);
      S[i][j] = S[j][i] = T > 1 ? s / (T - 1) : 0;
    }
  }
  return S;
}

/** Kovaryanstan korelasyon matrisi. */
export function korelasyonMatrisi(S) {
  const n = S.length;
  const sd = S.map((_, i) => Math.sqrt(S[i][i]));
  return S.map((satir, i) => satir.map((v, j) => (sd[i] && sd[j] ? v / (sd[i] * sd[j]) : 0)));
}

/* ===== Cholesky ===== */

/**
 * Σ = L·Lᵀ ayrıştırması (alt üçgen L).
 *
 * SEZGİ: tek boyutta rastgele sayıyı σ ile çarparsın. Çok boyutta aynı işi L yapar —
 * bağımsız Z vektörünü alıp aralarına Σ'nın anlattığı ilişkiyi yerleştirir.
 *
 * NEDEN JITTER: örneklem kovaryansı, gözlem sayısı varlık sayısına yaklaştıkça ya da
 * iki varlık neredeyse aynı hareket ettiğinde sayısal olarak pozitif-tanımlı olmaktan
 * çıkar (köşegende ~1e−18 negatif). Ayrıştırma sqrt(negatif) → NaN üretir ve NaN
 * simülasyonun sonuna kadar sessizce akar: VaR "—" değil, YANLIŞ bir sayı olarak çıkar.
 * Bu yüzden köşegene artan bir pay eklenip yeniden denenir; kaç denemede geçtiği
 * çağırana bildirilir, susup düzeltilmez.
 *
 * @returns {{L:number[][], jitter:number}}
 */
export function cholesky(S) {
  const n = S.length;
  const izOrt = n ? ortalama(S.map((_, i) => S[i][i])) : 0;
  for (let deneme = 0; deneme <= 8; deneme++) {
    const jitter = deneme === 0 ? 0 : izOrt * 1e-12 * 10 ** deneme;
    const L = Array.from({ length: n }, () => new Array(n).fill(0));
    let tamam = true;
    for (let i = 0; i < n && tamam; i++) {
      for (let j = 0; j <= i; j++) {
        let s = S[i][j] + (i === j ? jitter : 0);
        for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        if (i === j) {
          if (!(s > 0)) { tamam = false; break; }
          L[i][j] = Math.sqrt(s);
        } else {
          L[i][j] = s / L[j][j];
        }
      }
    }
    if (tamam) return { L, jitter };
  }
  throw new Error("cholesky: matris jitter'a rağmen pozitif-tanımlı değil");
}

/** Bağımsızlık modelinin "L"si: yalnız köşegen — marjinal σ aynı, ilişki sıfır. */
export function bagimsizL(S) {
  const n = S.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) L[i][i] = Math.sqrt(Math.max(0, S[i][i]));
  return L;
}

/* ===== Simülasyon ===== */

/** Box-Muller: tohumlu uniform çiftinden standart normal çifti. */
export function normalUretici(tohum = 42) {
  const rnd = mulberry32(tohum);
  let bekleyen = null;
  return function () {
    if (bekleyen !== null) { const v = bekleyen; bekleyen = null; return v; }
    let u = 0;
    while (u === 0) u = rnd();          // log(0) = −Infinity → tek bir NaN tüm seriyi bozar
    const v = rnd();
    const kok = Math.sqrt(-2 * Math.log(u));
    bekleyen = kok * Math.sin(2 * Math.PI * v);
    return kok * Math.cos(2 * Math.PI * v);
  };
}

/**
 * Portföyün 1 günlük getiri dağılımını simüle eder.
 * r = L·Z  ·  r_p = wᵀ·r
 * @returns {Float64Array} iter adet portföy getirisi (oran)
 */
export function mcPortfoyGetirileri({ L, agirliklar, iter = 50_000, tohum = 42, ortalamalar = null }) {
  const n = L.length;
  const norm = normalUretici(tohum);
  const out = new Float64Array(iter);
  const Z = new Float64Array(n);
  for (let k = 0; k < iter; k++) {
    for (let i = 0; i < n; i++) Z[i] = norm();
    let rp = 0;
    for (let i = 0; i < n; i++) {
      let ri = ortalamalar ? ortalamalar[i] : 0;
      const Li = L[i];
      for (let j = 0; j <= i; j++) ri += Li[j] * Z[j];
      rp += agirliklar[i] * ri;
    }
    out[k] = rp;
  }
  return out;
}

/* ===== VaR / CVaR ===== */

/**
 * @param {ArrayLike<number>} getiriler  portföy getirileri (oran, negatif = kayıp)
 * @param {number} p  güven (0.95 → en kötü %5)
 * @returns {{varOran:number, cvarOran:number}} POZİTİF kayıp oranları
 *
 * NEDEN pozitif: "VaR %95 = 0,028" cümlesi "%2,8 kaybedebilirsin" diye okunur.
 * İşareti hesapta tutup gösterimde çevirmek, iki panelde iki farklı işaret demektir.
 */
export function varCvar(getiriler, p = 0.95) {
  const a = Float64Array.from(getiriler);
  a.sort();
  const N = a.length;
  if (!N) return { varOran: 0, cvarOran: 0 };
  const idx = Math.max(0, Math.min(N - 1, Math.floor((1 - p) * N)));
  const varOran = -a[idx];
  let s = 0;
  const kuyruk = Math.max(1, idx + 1);
  for (let i = 0; i < kuyruk; i++) s += a[i];
  return { varOran, cvarOran: -(s / kuyruk) };
}

/** Dağılım varsayımı YOK: gerçekleşmiş portföy getirilerinin ampirik dilimi. */
export function tarihselVarCvar(portRet, p = 0.95) {
  return varCvar(portRet, p);
}

/** Ağırlıklı portföy getiri serisi — R hizalanmış, w sabit (bugünkü ağırlıklar). */
export function portfoySerisi(R, w) {
  const T = R[0]?.length || 0;
  const out = new Array(T).fill(0);
  for (let t = 0; t < T; t++) { let s = 0; for (let i = 0; i < R.length; i++) s += w[i] * R[i][t]; out[t] = s; }
  return out;
}

export const stdSapma = (a) => {
  if (a.length < 2) return 0;
  const m = ortalama(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

/* ===== İhlal testi (Kupiec POF) =====
 *
 * NEDEN VAR: bir VaR sayısı, üretildiği gün doğrulanamaz — ancak "eşiği vaat ettiği
 * sıklıkta aştı mı" diye SAYILARAK doğrulanır. %95 VaR'ın 250 günde ~12,5 kez
 * delinmesi BEKLENİR; 3 kez delindiyse model riski abartıyor, 40 kez delindiyse
 * güven veriyor ama korumuyor.
 *
 * Kupiec'in oransal ihlal (POF) testi bu farkın şansa sığıp sığmadığını söyler:
 * LR = −2·ln[ (1−p)^(N−x)·p^x / ((1−x/N)^(N−x)·(x/N)^x ] ~ χ²(1), %95 eşiği 3,841.
 *
 * TUZAK — ihlaller KÜMELENİR (docs/olcumler: gün kümelenmesi). Kupiec yalnız SAYIYA
 * bakar, sıraya bakmaz: aynı hafta üst üste gelen 10 ihlal ile yıla yayılmış 10 ihlal
 * bu testte aynı görünür. Bu yüzden en uzun ardışık ihlal serisi de döner.
 */
export function ihlalTesti(gerceklesen, esikler, p = 0.95) {
  const N = Math.min(gerceklesen.length, esikler.length);
  let x = 0, seri = 0, enUzunSeri = 0;
  const gunler = [];
  for (let i = 0; i < N; i++) {
    const ihlal = -gerceklesen[i] > esikler[i];
    if (ihlal) { x++; seri++; enUzunSeri = Math.max(enUzunSeri, seri); gunler.push(i); } else seri = 0;
  }
  const beklenen = N * (1 - p);
  let LR = null;
  if (x > 0 && x < N) {
    const pi = x / N;
    LR = -2 * (((N - x) * Math.log(p) + x * Math.log(1 - p)) - ((N - x) * Math.log(1 - pi) + x * Math.log(pi)));
  }
  return { N, ihlal: x, beklenen, oran: N ? x / N : 0, LR, reddedildi: LR != null ? LR > 3.841 : null, enUzunSeri, gunler };
}
