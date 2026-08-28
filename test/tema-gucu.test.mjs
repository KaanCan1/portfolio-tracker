import { test } from "node:test";
import assert from "node:assert/strict";
import { medyan, temaGucu, MIN_SEMBOL } from "../tema-gucu.js";

const it = (symbol, title, ret1M, ret3M, extra = {}) =>
  ({ symbol, theme: { key: title.slice(0, 3).toLowerCase(), title }, ret1M, ret3M, ...extra });

test("medyan: tek ve cift uzunluk, bos dizi", () => {
  assert.equal(medyan([3, 1, 2]), 2);
  assert.equal(medyan([4, 1, 2, 3]), 2.5);
  assert.equal(medyan([]), null);
  assert.equal(medyan([null, undefined, NaN]), null);
});

test("medyan ortalamaya gore tek ucusa dayaniklidir", () => {
  const normal = [1, 2, 3, 4, 5];
  const ucus = [1, 2, 3, 4, 500];
  assert.equal(medyan(normal), medyan(ucus));       // medyan degismedi
  assert.notEqual(normal.reduce((a, b) => a + b) / 5, ucus.reduce((a, b) => a + b) / 5);
});

test("temasiz semboller evrene girmez", () => {
  const r = temaGucu({
    items: [it("AAA", "AI", 5, 10), { symbol: "ZZZ", ret1M: 99, ret3M: 99 }],
    endeks: { ret1M: 0, ret3M: 0 },
  });
  assert.equal(r.n, 1);
  assert.equal(r.temaSayisi, 1);
  assert.equal(r.satirlar[0].medyan3M, 10);
});

test("goreli guc endeks farkidir, siralama 3 aylik RS'e gore", () => {
  const r = temaGucu({
    items: [it("A1", "Zayıf", 1, 2), it("A2", "Zayıf", 1, 4), it("B1", "Güçlü", 9, 20), it("B2", "Güçlü", 11, 30)],
    endeks: { ret1M: 5, ret3M: 10 },
  });
  assert.deepEqual(r.satirlar.map((s) => s.title), ["Güçlü", "Zayıf"]);
  assert.equal(r.satirlar[0].medyan3M, 25);
  assert.equal(r.satirlar[0].rs3M, 15);
  assert.equal(r.satirlar[1].rs3M, -7);   // medyan 3 − endeks 10
  assert.equal(r.satirlar[1].rs1M, -4);
});

test("lider siralamasi 3 aylik getiriye gore ve tavanla sinirli", () => {
  const r = temaGucu({
    items: [it("C", "T", 1, 5), it("A", "T", 1, 30), it("B", "T", 1, 20), it("D", "T", 1, 25)],
    endeks: { ret1M: 0, ret3M: 0 }, liderSayisi: 2,
  });
  assert.deepEqual(r.satirlar[0].lider.map((x) => x.sym), ["A", "D"]);
  assert.equal(r.satirlar[0].lider[0].ret3M, 30);
});

test("zayif kanit damgasi: MIN_SEMBOL altindaki tema isaretlenir", () => {
  const az = Array.from({ length: MIN_SEMBOL - 1 }, (_, i) => it("A" + i, "Az", 1, 1));
  const cok = Array.from({ length: MIN_SEMBOL }, (_, i) => it("B" + i, "Çok", 1, 1));
  const r = temaGucu({ items: [...az, ...cok], endeks: { ret1M: 0, ret3M: 0 } });
  assert.equal(r.satirlar.find((s) => s.title === "Az").zayifKanit, true);
  assert.equal(r.satirlar.find((s) => s.title === "Çok").zayifKanit, false);
});

test("endeks getirisi yoksa RS null, satir yine doner", () => {
  const r = temaGucu({ items: [it("A", "T", 5, 10)], endeks: {} });
  assert.equal(r.satirlar[0].rs3M, null);
  assert.equal(r.satirlar[0].medyan3M, 10);
  assert.equal(r.ok, false);            // olculebilir tema yok
  assert.equal(r.hukum, null);
});

test("hukum: agirlikli goreli guc paranin durdugu yeri olcer", () => {
  const r = temaGucu({
    items: [it("A1", "İyi", 1, 20), it("A2", "İyi", 1, 20), it("B1", "Kötü", 1, 0), it("B2", "Kötü", 1, 0)],
    endeks: { ret1M: 0, ret3M: 10 },
    agirlik: { "İyi": 25, "Kötü": 75 },   // para agirlikli olarak KOTU temada
  });
  // (+10 × 25 + −10 × 75) / 100 = −5
  assert.equal(r.hukum.agirlikliRS, -5);
  assert.equal(r.hukum.ton, "bad");
  assert.match(r.hukum.metin, /5\.0 puan gerisinde/);
  assert.match(r.hukum.metin, /Kötü/);
});

test("hukum: portfoyde eslesen tema yoksa evreni anlatir", () => {
  const r = temaGucu({ items: [it("A", "T", 1, 20)], endeks: { ret1M: 0, ret3M: 10 }, agirlik: {} });
  assert.equal(r.hukum.ton, "neu");
  assert.match(r.hukum.metin, /seni değil/);
});

test("hukum: pozisyonun olmadigi lider tema soylenir", () => {
  const r = temaGucu({
    items: [it("A", "Lider", 1, 40), it("B", "Seninki", 1, 12)],
    endeks: { ret1M: 0, ret3M: 10 }, agirlik: { "Seninki": 100 },
  });
  assert.match(r.hukum.metin, /Evrenin lideri/);
  assert.match(r.hukum.metin, /hiç pozisyonun yok/);
});

test("portfoy agirligi satira tasinir, eslesmeyen tema 0 alir", () => {
  const r = temaGucu({
    items: [it("A", "Var", 1, 20), it("B", "Yok", 1, 5)],
    endeks: { ret1M: 0, ret3M: 10 }, agirlik: { "Var": 60 },
  });
  assert.equal(r.satirlar.find((s) => s.title === "Var").portfoyPct, 60);
  assert.equal(r.satirlar.find((s) => s.title === "Yok").portfoyPct, 0);
});

test("hukum kendi kapsamini yazar: olculen pay %70 altindaysa soylenir", () => {
  const dar = temaGucu({
    items: [it("A", "T", 1, 20)], endeks: { ret1M: 0, ret3M: 10 }, agirlik: { "T": 35 },
  });
  assert.equal(dar.hukum.olculenPay, 35);
  assert.match(dar.hukum.metin, /%35'i ölçülebiliyor/);

  const genis = temaGucu({
    items: [it("A", "T", 1, 20)], endeks: { ret1M: 0, ret3M: 10 }, agirlik: { "T": 90 },
  });
  assert.equal(genis.hukum.olculenPay, 90);
  assert.doesNotMatch(genis.hukum.metin, /ölçülebiliyor/);
});
