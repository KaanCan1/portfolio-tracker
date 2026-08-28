import { test } from "node:test";
import assert from "node:assert/strict";
import {
  medyan, takvimKur, gunlukGozlemler, ozet, ortusmeyen, ofsetTaramasi,
  blokBootstrap, dayaniklilik, hukum, KARAR_ESIGI, TEK_TEMA_ORANI,
} from "../tema-momentum.js";

/* Sentetik mum üretici: kapanış dizisinden bar dizisi. Tarihler ardışık iş günü
 * değil, sadece sıralı — modül takvimi endeksten alıp indeksle çalışıyor.
 *
 * Tarihler GERÇEK tarih aritmetiğiyle üretiliyor. İlk hali `2026-01-${i}` idi ve
 * i>99'da "2026-01-100" çıkıyordu; modülün g10'u bunu slice(0,10) ile "2026-01-10"a
 * kesiyor, iki farklı bar aynı anahtara düşüyor ve seri sessizce bozuluyordu.
 * Testin kendi kurgusu ölçtüğü şeyi bozmasın. */
const T0 = Date.UTC(2026, 0, 1);
const gun = (i) => new Date(T0 + i * 86400000).toISOString().slice(0, 10);
const bar = (kapanislar, bas = 0) =>
  kapanislar.map((c, i) => ({ time: gun(bas + i), close: c }));
const duz = (n, v = 100) => Array.from({ length: n }, () => v);
/** Sabit günlük oranla büyüyen seri. */
const ramp = (n, oran, bas = 100) => Array.from({ length: n }, (_, i) => bas * (1 + oran) ** i);

test("medyan tek uçuşa dayanıklı, boş dizide null", () => {
  assert.equal(medyan([1, 2, 3]), 2);
  assert.equal(medyan([1, 2, 3, 4]), 2.5);
  assert.equal(medyan([1, 2, 3, 999]), 2.5);
  assert.equal(medyan([]), null);
});

test("takvim endeksten alınır, eksik barlı sembol kendi haritasında kalır", () => {
  const { takvim, fiyat } = takvimKur({
    QQQ: bar([10, 11, 12]),
    AAA: bar([5, 6]),          // bir bar eksik
  }, "QQQ");
  assert.deepEqual(takvim, ["2026-01-01", "2026-01-02", "2026-01-03"]);
  assert.equal(fiyat.AAA.size, 2);
  assert.equal(fiyat.AAA.get("2026-01-03"), undefined);   // ileri doldurma YOK
});

test("endeks yoksa takvim boş — sessizce yanlış eksen kurulmaz", () => {
  const { takvim } = takvimKur({ AAA: bar([1, 2, 3]) }, "QQQ");
  assert.deepEqual(takvim, []);
  assert.deepEqual(gunlukGozlemler({ mumlar: { AAA: bar([1, 2, 3]) } }).gozlemler, []);
});

test("pencere formasyon+ufuk toplamından kısaysa gözlem üretilmez", () => {
  const n = 10;
  const r = gunlukGozlemler({
    mumlar: { QQQ: bar(duz(n)), A: bar(duz(n)), B: bar(duz(n)), C: bar(duz(n)) },
    temaHarita: { A: "T1", B: "T2", C: "T3" }, formasyon: 5, ufuk: 5,
  });
  assert.equal(r.gozlemler.length, 0);
});

test("3 temadan az kaldığında sıralama yapılmaz", () => {
  const n = 60;
  const r = gunlukGozlemler({
    mumlar: { QQQ: bar(duz(n)), A: bar(duz(n)), B: bar(duz(n)) },
    temaHarita: { A: "T1", B: "T2" }, formasyon: 10, ufuk: 5,
  });
  assert.equal(r.gozlemler.length, 0);
});

test("kalıcı momentum: hep aynı tema lider ve ileri de kazanıyorsa pozitif ölçülür", () => {
  const n = 200;
  const r = gunlukGozlemler({
    mumlar: {
      QQQ: bar(ramp(n, 0.001)),
      A: bar(ramp(n, 0.004)),   // sürekli en güçlü
      B: bar(ramp(n, 0.001)),
      C: bar(ramp(n, -0.002)),  // sürekli en zayıf
    },
    temaHarita: { A: "Güçlü", B: "Orta", C: "Zayıf" }, formasyon: 20, ufuk: 10,
  });
  assert.ok(r.gozlemler.length > 50);
  const o = ozet(r.gozlemler);
  assert.equal(r.gozlemler[0].lider.tema, "Güçlü");
  assert.equal(r.gozlemler[0].enZayif.tema, "Zayıf");
  assert.ok(o.liderVsEvren > 0, "lider evreni yenmeli");
  assert.ok(o.liderVsZayif > 0);
  assert.equal(o.liderKazanmaOrani, 1);
});

test("momentum yoksa (lider rastgele) lider-evren farkı sıfıra yakın", () => {
  const n = 200;
  // Üç tema da AYNI seriyi izliyor → hangisinin lider olduğu ileriyi bilgilendirmez
  const s = ramp(n, 0.002);
  const r = gunlukGozlemler({
    mumlar: { QQQ: bar(s), A: bar(s), B: bar(s), C: bar(s) },
    temaHarita: { A: "T1", B: "T2", C: "T3" }, formasyon: 20, ufuk: 10,
  });
  const o = ozet(r.gozlemler);
  assert.equal(o.liderVsEvren, 0);
  assert.equal(o.liderVsZayif, 0);
});

test("ortusmeyen: pencereler ufuk kadar atlayarak seçilir", () => {
  const sahte = Array.from({ length: 100 }, (_, i) => ({
    i, lider: { ileri: i }, enZayif: { ileri: 0 }, evrenIleri: 0, endeksIleri: 0,
  }));
  const r = ortusmeyen(sahte, 10, 0);
  assert.equal(r.n, 10);                       // 0,10,20…90
  assert.equal(r.ofset, 0);
  const r3 = ortusmeyen(sahte, 10, 3);
  assert.equal(r3.n, 10);                      // 3,13,…93
  assert.equal(r3.liderVsEvren, 48);           // (3+13+…+93)/10
});

test("ofsetTaramasi her başlangıcı ayrı koşar ve dağılımı verir", () => {
  const sahte = Array.from({ length: 60 }, (_, i) => ({
    i, lider: { ileri: i % 5 }, enZayif: { ileri: 0 }, evrenIleri: 0, endeksIleri: 0,
  }));
  const t = ofsetTaramasi(sahte, 5);
  assert.equal(t.ofsetSayisi, 5);
  // ofset k → hep (k%5) değeri; ortalamalar 0,1,2,3,4 olmalı
  assert.equal(t.liderVsEvren.min, 0);
  assert.equal(t.liderVsEvren.max, 4);
  assert.equal(t.pozitifOfsetOrani, 0.8);      // 5 ofsetin 4'ü pozitif
});

test("blokBootstrap: kısa dizide null, sabit dizide aralık o değerde kilitli", () => {
  assert.equal(blokBootstrap([1, 2, 3], 21), null);
  const sabit = new Array(100).fill(5);
  const b = blokBootstrap(sabit, 10, 200);
  assert.equal(b.alt, 5); assert.equal(b.ust, 5); assert.equal(b.blok, 10);
});

test("blokBootstrap tohumu sabit — aynı girdi aynı aralık", () => {
  const d = Array.from({ length: 120 }, (_, i) => Math.sin(i) * 3);
  assert.deepEqual(blokBootstrap(d, 12, 300), blokBootstrap(d, 12, 300));
});

test("hüküm: az gözlemde KARAR VERME der, nokta tahmini yine yazar", () => {
  const h = hukum({
    tarama: { nOrtalama: 8, liderVsEvren: { ort: 2.4 }, pozitifOfsetOrani: 0.9 },
    bootstrap: { alt: 1, ust: 3 },
  });
  assert.equal(h.karar, "karar-verme");
  assert.match(h.metin, /hüküm için 20 gerek/);
  assert.match(h.metin, /kural çıkarma/);
});

test("hüküm: aralık 0'ı içeriyorsa gürültü", () => {
  const h = hukum({
    tarama: { nOrtalama: 30, liderVsEvren: { ort: 1.2 }, pozitifOfsetOrani: 0.9 },
    bootstrap: { alt: -2, ust: 4 },
  });
  assert.equal(h.karar, "gurultu");
  assert.match(h.metin, /ayırt EDİLEMİYOR/);
});

test("hüküm: ofsetler aynı yöne bakmıyorsa gürültü (aralık dar olsa bile)", () => {
  const h = hukum({
    tarama: { nOrtalama: 30, liderVsEvren: { ort: 1.2 }, pozitifOfsetOrani: 0.5 },
    bootstrap: { alt: 0.4, ust: 2.0 },
  });
  assert.equal(h.karar, "gurultu");
  assert.match(h.metin, /aynı yöne bakmıyor/);
});

test("hüküm: üç şart da sağlanınca var/ters ayrımı yapılır", () => {
  const varH = hukum({
    tarama: { nOrtalama: 30, liderVsEvren: { ort: 2.1 }, pozitifOfsetOrani: 0.85 },
    bootstrap: { alt: 0.6, ust: 3.4 },
  });
  assert.equal(varH.karar, "var");
  assert.match(varH.metin, /%85'i aynı yönde/);

  const tersH = hukum({
    tarama: { nOrtalama: 30, liderVsEvren: { ort: -2.1 }, pozitifOfsetOrani: 0.1 },
    bootstrap: { alt: -3.4, ust: -0.6 },
  });
  assert.equal(tersH.karar, "ters");
});

test("hüküm: tarama yoksa ölçülemedi", () => {
  assert.equal(hukum({}).karar, "olculemedi");
  assert.equal(KARAR_ESIGI, 20);
});

/* ---- Dayanıklılık: edge tek bir temanın hikâyesi mi? (28 Ağu)
 * Bu şart olmadan ilk koşu "tema momentumu VAR" diyordu: +5,61 puan, tüm
 * ofsetlerde pozitif, aralık 0'ı içermiyor. AI teması çıkarılınca +0,75'e
 * düştü — liderliğin %77'si zaten oradaydı. */

test("dayaniklilik: bir temayı çıkarınca edge çöküyorsa işaretlenir", () => {
  const d = dayaniklilik(
    [{ tema: "AI", yon: 0.75 }, { tema: "Finans", yon: 5.26 }, { tema: "Sağlık", yon: 5.63 }],
    5.61);
  assert.equal(d.enKritikTema, "AI");
  assert.equal(d.kalanYon, 0.75);
  assert.equal(d.kalanOran, 0.134);
  assert.equal(d.tekTemayaBagli, true);
});

test("dayaniklilik: hiçbir tema kritik değilse bayrak inik", () => {
  const d = dayaniklilik(
    [{ tema: "A", yon: 4.8 }, { tema: "B", yon: 5.2 }, { tema: "C", yon: 5.0 }], 5.0);
  assert.equal(d.tekTemayaBagli, false);
  assert.ok(d.kalanOran >= 1 - TEK_TEMA_ORANI);
});

test("dayaniklilik: edge zaten sıfıra yakınsa oran anlamsız → null", () => {
  assert.equal(dayaniklilik([{ tema: "A", yon: 0.1 }], 0.001), null);
  assert.equal(dayaniklilik([], 5), null);
});

test("hüküm: tek-tema şartı diğer üç şartı GEÇERSE bile önce çalışır", () => {
  const h = hukum({
    tarama: { nOrtalama: 40, liderVsEvren: { ort: 5.61 }, pozitifOfsetOrani: 1 },
    bootstrap: { alt: 2.62, ust: 8.61 },     // üç şart da temiz
    dayanim: { enKritikTema: "AI", kalanYon: 0.75, kalanOran: 0.134, tekTemayaBagli: true },
  });
  assert.equal(h.karar, "tek-tema");
  assert.match(h.metin, /AI/);
  assert.match(h.metin, /%13'ü kalıyor/);
});

test("hüküm: dayanım temizse eski üç şart aynen işler", () => {
  const saglam = { enKritikTema: "A", kalanYon: 4.8, kalanOran: 0.96, tekTemayaBagli: false };
  assert.equal(hukum({
    tarama: { nOrtalama: 40, liderVsEvren: { ort: 5.0 }, pozitifOfsetOrani: 0.9 },
    bootstrap: { alt: 2, ust: 8 }, dayanim: saglam,
  }).karar, "var");
  assert.equal(hukum({
    tarama: { nOrtalama: 8, liderVsEvren: { ort: 5.0 }, pozitifOfsetOrani: 0.9 },
    bootstrap: { alt: 2, ust: 8 }, dayanim: saglam,
  }).karar, "karar-verme");
});
