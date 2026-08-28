/* tema-momentum.js — "3 ayda lider olan tema, sonraki ayda da lider mi?"
 *
 * NEDEN VAR (28 Ağu 2026): Tema masası (§18) evrenin tema sıralamasını ölçüyor ve
 * paneli açan insan doğal olarak şunu soruyor: "Finans +15 puanda, oraya mı geçeyim?"
 * Panel bunu söylemiyordu ve söylememeliydi — çünkü tema momentumunun SÜRÜP SÜRMEDİĞİ
 * hiç ölçülmemişti. Bu dosya o ölçümü kurar. Cevap "hayır" çıkarsa da bulgudur: panel
 * "tarif eder, tavsiye etmez" cümlesini kanıtla söyleyebilir hale gelir.
 *
 * SORU: t gününde son F günün medyan getirisiyle lider olan tema, sonraki H günde
 * (a) endeksi, (b) TEMA SEÇMEMEYİ yeniyor mu?
 *
 * (b) şart. CLAUDE.md tuzağı 4: bir kurulumun değeri "artıda mı" ile değil, "kurulum
 * aramamaktan iyi mi" ile ölçülür. Buradaki karşılığı: liderin +%4 yapması bir şey
 * söylemez, evrenin tamamı +%5 yaptıysa tema seçmek DEĞER KAYBETTİRMİŞTİR.
 *
 * ÇAKIŞAN PENCERE TUZAĞI (CLAUDE.md tuzak 3) — bu ölçümün belkemiği:
 * t ve t+1'in ileri pencereleri H−1 gün ortak. Peş peşe günleri bağımsız gözlem
 * saymak örneklemi H katına şişirir ve her güven aralığını sahte biçimde daraltır.
 * Bu yüzden ANA ÖLÇÜM yalnız ÖRTÜŞMEYEN pencerelerdir (t, t+H, t+2H …). 360 barlık
 * veride bu ~14 gözlem demek — az, ve azlığı raporda yazılır; şişirilmiş 300
 * gözlemden dürüsttür.
 *
 * Örtüşmeyen seri başlangıç noktasına bağlıdır (ofset 0 ile ofset 7 farklı
 * pencereler seçer). Bu yüzden H ofsetin HEPSİ ayrı ayrı koşulur: sonuçların
 * dağılımı ölçümün kırılganlığını doğrudan gösterir. Tek ofset raporlamak,
 * ölçümün en iyi haline bakmak olurdu.
 *
 * Saf modül: dosya okumaz, ağ bilmez. Girdi mum sözlüğü, çıktı ölçüm.
 */

const g10 = (x) => String(x ?? "").slice(0, 10);

/** Medyan — tek uçuş temayı taşımasın (tema-gucu.js ile aynı gerekçe). */
export function medyan(a = []) {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Ortak takvim + sembol başına tarih→kapanış haritası.
 * Takvim endeksten alınır: her sembolün kendi barları farklı günlerde başlayıp
 * bitiyor; ortak bir eksen olmazsa "aynı pencere" diye karşılaştırdığımız şeyler
 * farklı günleri ölçer (kiyas.js'in ortak-gün kuralının aynısı).
 */
export function takvimKur(mumlar = {}, endeks = "QQQ") {
  const e = mumlar[endeks];
  if (!e?.length) return { takvim: [], fiyat: {} };
  const takvim = e.map((c) => g10(c.date ?? c.time));
  const fiyat = {};
  for (const [sym, bars] of Object.entries(mumlar)) {
    const m = new Map();
    for (const c of bars || []) {
      const g = g10(c.date ?? c.time);
      if (g && c.close > 0) m.set(g, +c.close);
    }
    fiyat[sym] = m;
  }
  return { takvim, fiyat };
}

/** i indeksinden k bar geriye getirisi (%). Eksik bar → null (ileri doldurma YOK:
 *  olmayan fiyatı taşımak, olmayan işlemi ölçmek olur). */
function getiri(harita, takvim, i, k) {
  if (i - k < 0) return null;
  const a = harita.get(takvim[i - k]), b = harita.get(takvim[i]);
  return a > 0 && b > 0 ? ((b - a) / a) * 100 : null;
}

/**
 * Her gün için tema sıralaması ve ileri getiriler.
 * @param {Object} mumlar     {SYM: [{time|date, close}]}
 * @param {Object} temaHarita {SYM: "tema başlığı"}
 * @param {number} formasyon  geriye bakış (işlem günü)
 * @param {number} ufuk       ileriye bakış (işlem günü)
 * @param {string} endeks     takvim + karşılaştırma endeksi
 */
export function gunlukGozlemler({ mumlar = {}, temaHarita = {}, formasyon = 63, ufuk = 21, endeks = "QQQ" } = {}) {
  const { takvim, fiyat } = takvimKur(mumlar, endeks);
  if (takvim.length < formasyon + ufuk + 1) return { takvim, gozlemler: [] };

  const temaSembol = {};
  for (const [sym, t] of Object.entries(temaHarita)) {
    if (!t || !fiyat[sym]) continue;
    (temaSembol[t] ||= []).push(sym);
  }
  const temalar = Object.keys(temaSembol);
  const gozlemler = [];

  for (let i = formasyon; i + ufuk < takvim.length; i++) {
    const satir = [];
    for (const t of temalar) {
      const geri = medyan(temaSembol[t].map((s) => getiri(fiyat[s], takvim, i, formasyon)).filter((x) => x != null));
      const ileri = medyan(temaSembol[t].map((s) => getiri(fiyat[s], takvim, i + ufuk, ufuk)).filter((x) => x != null));
      if (geri == null || ileri == null) continue;
      satir.push({ tema: t, geri, ileri, n: temaSembol[t].length });
    }
    if (satir.length < 3) continue;                       // 3 temadan az kaldıysa sıralamanın anlamı yok

    // Evren = tüm sembollerin medyanı: "tema seçmemek" temel çizgisi.
    const tumSemboller = Object.keys(temaHarita).filter((s) => fiyat[s]);
    const evrenIleri = medyan(tumSemboller.map((s) => getiri(fiyat[s], takvim, i + ufuk, ufuk)).filter((x) => x != null));
    const endeksIleri = getiri(fiyat[endeks], takvim, i + ufuk, ufuk);
    if (evrenIleri == null || endeksIleri == null) continue;

    const sirali = [...satir].sort((a, b) => b.geri - a.geri);
    gozlemler.push({
      i, tarih: takvim[i], bitis: takvim[i + ufuk],
      lider: sirali[0], enZayif: sirali[sirali.length - 1],
      temaSayisi: sirali.length, evrenIleri, endeksIleri,
      hepsi: sirali.map((x) => ({ tema: x.tema, geri: +x.geri.toFixed(2), ileri: +x.ileri.toFixed(2) })),
    });
  }
  return { takvim, gozlemler, temalar };
}

const ORT = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** Bir gözlem dizisinden dört karşılaştırmayı çıkarır (hepsi yüzde puan). */
export function ozet(gozlemler = []) {
  if (!gozlemler.length) return null;
  const liderVsEvren = gozlemler.map((g) => g.lider.ileri - g.evrenIleri);
  const liderVsEndeks = gozlemler.map((g) => g.lider.ileri - g.endeksIleri);
  const zayifVsEvren = gozlemler.map((g) => g.enZayif.ileri - g.evrenIleri);
  const liderVsZayif = gozlemler.map((g) => g.lider.ileri - g.enZayif.ileri);
  const yz = (a) => a.filter((x) => x > 0).length / a.length;
  return {
    n: gozlemler.length,
    liderVsEvren: +ORT(liderVsEvren).toFixed(2),
    liderVsEndeks: +ORT(liderVsEndeks).toFixed(2),
    zayifVsEvren: +ORT(zayifVsEvren).toFixed(2),
    liderVsZayif: +ORT(liderVsZayif).toFixed(2),
    liderKazanmaOrani: +yz(liderVsEvren).toFixed(3),
    ham: { liderVsEvren, liderVsEndeks, zayifVsEvren, liderVsZayif },
  };
}

/**
 * ÖRTÜŞMEYEN pencereler — ana ölçüm. `ofset` başlangıç kaydırması; H ofsetin
 * hepsi ayrı koşulur, çünkü hangi günlerin seçildiği sonucu değiştirir ve bu
 * değişkenlik ölçümün kendi kırılganlığıdır.
 */
export function ortusmeyen(gozlemler = [], ufuk = 21, ofset = 0) {
  const secili = [];
  for (let k = ofset; k < gozlemler.length; k += ufuk) secili.push(gozlemler[k]);
  return { ofset, ...(ozet(secili) || { n: 0 }) };
}

/** Tüm ofsetlerin dağılımı: hüküm, ofsetlerin çoğunda aynı yöne bakıyorsa verilir. */
export function ofsetTaramasi(gozlemler = [], ufuk = 21) {
  const hepsi = [];
  for (let o = 0; o < ufuk && o < gozlemler.length; o++) {
    const r = ortusmeyen(gozlemler, ufuk, o);
    if (r.n >= 3) hepsi.push(r);
  }
  if (!hepsi.length) return null;
  const al = (k) => hepsi.map((x) => x[k]).sort((a, b) => a - b);
  const cey = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  const lve = al("liderVsEvren");
  return {
    ofsetSayisi: hepsi.length,
    nOrtalama: +ORT(hepsi.map((x) => x.n)).toFixed(1),
    liderVsEvren: { ort: +ORT(lve).toFixed(2), min: +lve[0].toFixed(2), max: +lve[lve.length - 1].toFixed(2), medyan: +cey(lve, 0.5).toFixed(2) },
    pozitifOfsetOrani: +(lve.filter((x) => x > 0).length / lve.length).toFixed(3),
    hepsi,
  };
}

/**
 * Blok bootstrap — örtüşen tüm gözlemler üzerinde, blok uzunluğu = ufuk.
 * Örtüşmeyen ölçüm dürüst ama az gözlemli; bu, aynı soruyu daha çok veriyle
 * DESTEKLEYİCİ olarak sorar. Blok, örtüşmenin bağımlılık yarıçapını taşır:
 * tek tek gün çekmek çakışan pencere tuzağına bootstrap üstünden geri düşmek olur.
 */
export function blokBootstrap(dizi = [], blok = 21, iters = 2000, tohum = 20260828) {
  if (dizi.length < blok * 2) return null;
  let s = tohum;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const blokSayisi = Math.ceil(dizi.length / blok);
  const out = [];
  for (let k = 0; k < iters; k++) {
    let toplam = 0, adet = 0;
    for (let b = 0; b < blokSayisi; b++) {
      const bas = Math.floor(rnd() * (dizi.length - blok + 1));
      for (let j = 0; j < blok; j++) { toplam += dizi[bas + j]; adet++; }
    }
    out.push(toplam / adet);
  }
  out.sort((a, b) => a - b);
  const q = (p) => out[Math.min(out.length - 1, Math.floor(p * out.length))];
  return { alt: +q(0.05).toFixed(2), orta: +q(0.5).toFixed(2), ust: +q(0.95).toFixed(2), blok, iters };
}

/** Kaç bağımsız gözlem hüküm için yeterli — altındaysa "karar verme" denir. */
export const KARAR_ESIGI = 20;

/** Bir temayı çıkarınca edge'in bu oranından fazlası kayboluyorsa ölçülen şey
 *  tema momentumu değil, o temanın hikâyesidir. */
export const TEK_TEMA_ORANI = 0.7;

/**
 * Dayanıklılık: her tema sırayla evrenden çıkarılıp ölçüm tekrarlanır.
 * @param {Array} cikarmalar [{tema, yon}] — o tema yokken ölçülen lider−evren
 * @param {number} tamYon     hiçbir tema çıkarılmadan ölçülen lider−evren
 */
export function dayaniklilik(cikarmalar = [], tamYon = 0, oran = TEK_TEMA_ORANI) {
  if (!cikarmalar.length || !isFinite(tamYon) || Math.abs(tamYon) < 0.01) return null;
  const kalanlar = cikarmalar.map((c) => ({ ...c, kalanOran: c.yon / tamYon }));
  const enKritik = kalanlar.reduce((a, b) => (b.kalanOran < a.kalanOran ? b : a));
  return {
    enKritikTema: enKritik.tema,
    kalanYon: +enKritik.yon.toFixed(2),
    kalanOran: +enKritik.kalanOran.toFixed(3),
    tekTemayaBagli: enKritik.kalanOran < 1 - oran,
    hepsi: kalanlar,
  };
}

/**
 * Hüküm. DÖRT şart birlikte aranır, çünkü dördünden biri tek başına yanıltır:
 *  1. örtüşmeyen ölçümde yeterli gözlem (yoksa "karar verilemez")
 *  2. ofsetlerin çoğunda aynı yön (yoksa sonuç başlangıç gününün eseri)
 *  3. blok bootstrap aralığı 0'ı içermiyor (yoksa gürültüden ayırt edilemez)
 *  4. tek bir temayı çıkarınca edge ayakta kalıyor
 *
 * 4. şart 28 Ağu'da eklendi ve ilk koşuda ölçümü DEVİRDİ: lider−evren +5,61 puan,
 * tüm ofsetlerde pozitif, aralık [+2,62 … +8,61] — üç şart da sağlanıyordu. Ama AI ·
 * Yarı İletken teması evrenden çıkarılınca +0,75'e düştü. Liderliğin %77'si zaten o
 * temadaydı: ölçülen şey "tema momentumu" değil, tek bir temanın 17 aylık yükselişiydi.
 * Üç şartla yetinseydik panele "lider temaya geç" cümlesi yazacaktık.
 */
export function hukum({ tarama, bootstrap, dayanim, esik = KARAR_ESIGI } = {}) {
  if (!tarama) return { karar: "olculemedi", metin: "Örtüşmeyen pencere üretilemedi — veri penceresi formasyon + ufuk toplamından kısa." };
  const yeterli = tarama.nOrtalama >= esik;
  const yon = tarama.liderVsEvren.ort;
  const tutarli = tarama.pozitifOfsetOrani >= 0.7 || tarama.pozitifOfsetOrani <= 0.3;
  const sifirIceriyor = !bootstrap || (bootstrap.alt <= 0 && bootstrap.ust >= 0);

  if (dayanim?.tekTemayaBagli) {
    return { karar: "tek-tema", yon, metin: `Lider tema, tema seçmemeye göre ${yon >= 0 ? "+" : ""}${yon} puan — ama <b>${dayanim.enKritikTema}</b> evrenden çıkarılınca ${dayanim.kalanYon} puana düşüyor (%${Math.round(dayanim.kalanOran * 100)}'ü kalıyor). Ölçülen şey tema momentumu değil, tek bir temanın bu dönemdeki hikâyesi.` };
  }
  if (!yeterli) {
    return { karar: "karar-verme", yon, metin: `Örtüşmeyen pencere başına ortalama ${tarama.nOrtalama} bağımsız gözlem var; hüküm için ${esik} gerek. Nokta tahmin ${yon >= 0 ? "+" : ""}${yon} puan ama bu sayıdan kural çıkarma.` };
  }
  if (sifirIceriyor || !tutarli) {
    return { karar: "gurultu", yon, metin: `Lider tema, tema seçmemeye göre ${yon >= 0 ? "+" : ""}${yon} puan${bootstrap ? ` (%90 aralık ${bootstrap.alt} … ${bootstrap.ust})` : ""}. ${sifirIceriyor ? "Aralık 0'ı içeriyor" : "Ofsetler aynı yöne bakmıyor"} — tema momentumu gürültüden ayırt EDİLEMİYOR.` };
  }
  return { karar: yon > 0 ? "var" : "ters", yon, metin: `Lider tema, tema seçmemeye göre ${yon >= 0 ? "+" : ""}${yon} puan (%90 aralık ${bootstrap.alt} … ${bootstrap.ust}); ofsetlerin %${Math.round((yon > 0 ? tarama.pozitifOfsetOrani : 1 - tarama.pozitifOfsetOrani) * 100)}'i aynı yönde.` };
}
