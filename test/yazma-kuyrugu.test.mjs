/* GERÇEK modülü import eder. */
import test from "node:test";
import assert from "node:assert/strict";
import { kuyrukOlustur, veriIslemOlustur, VeriHata } from "../yazma-kuyrugu.js";

/* Sahte depo: belge bir JSON METNİ olarak tutulur (server.js'te de öyle —
 * dosyaya/jsonb'ye serileşir). Klonlama şart: aynı nesne referansı paylaşılırsa
 * yarış TESTTE görünmez ama üretimde vardır. Gecikme, iki isteğin araya girme
 * penceresini taklit eder. */
function sahteDepo({ gecikme = 1 } = {}) {
  let metin = JSON.stringify({ kayitlar: [] });
  const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    izler: { okuma: 0, yazma: 0 },
    async oku() { this.izler.okuma++; await bekle(gecikme); return JSON.parse(metin); },
    async yaz(v) { this.izler.yazma++; await bekle(gecikme); metin = JSON.stringify(v); },
    son: () => JSON.parse(metin),
  };
}

/* ── Yarışın kendisi ──────────────────────────────────────────────────────
 * Bu iki test bir çift: ilki hatayı ÜRETİR (kuyruksuz), ikincisi kapandığını
 * gösterir. İlkini silme — kuyruk bir gün devre dışı kalırsa yarışın gerçekten
 * var olduğunu kanıtlayan tek şey o. */

test("kuyruksuz oku-değiştir-yaz kayıt kaybeder (hatanın kendisi)", async () => {
  const depo = sahteDepo();
  const ciplakIslem = async (fn) => { const v = await depo.oku(); await fn(v); await depo.yaz(v); };

  await Promise.all([1, 2, 3, 4, 5].map((n) =>
    ciplakIslem(async (v) => { v.kayitlar.push({ n }); })));

  // Ölçülen davranışın aynısı: 5 istek 200 döndü, defterde 1 kayıt kaldı.
  assert.equal(depo.son().kayitlar.length, 1);
});

test("eşzamanlı 5 yazma → 5 kayıt (yarış kapalı)", async () => {
  const depo = sahteDepo();
  const veriIslem = veriIslemOlustur({ oku: () => depo.oku(), yaz: (v) => depo.yaz(v) });

  const sonuclar = await Promise.all([1, 2, 3, 4, 5].map((n) =>
    veriIslem(async (v) => { v.kayitlar.push({ n }); return v.kayitlar.length; })));

  assert.equal(depo.son().kayitlar.length, 5);
  assert.deepEqual(depo.son().kayitlar.map((k) => k.n).sort(), [1, 2, 3, 4, 5]);
  // Her işlem kendi eklemesinden SONRAKİ uzunluğu görür → gerçekten sıralı.
  assert.deepEqual(sonuclar.sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});

test("100 eşzamanlı yazmada da tek kayıt kaybolmaz", async () => {
  const depo = sahteDepo({ gecikme: 0 });
  const veriIslem = veriIslemOlustur({ oku: () => depo.oku(), yaz: (v) => depo.yaz(v) });
  await Promise.all(Array.from({ length: 100 }, (_, i) =>
    veriIslem(async (v) => { v.kayitlar.push({ n: i }); })));
  assert.equal(depo.son().kayitlar.length, 100);
});

test("bir işlem bitmeden sıradaki OKUMAZ (kilit tüm span'i kapsar)", async () => {
  const depo = sahteDepo();
  const veriIslem = veriIslemOlustur({ oku: () => depo.oku(), yaz: (v) => depo.yaz(v) });
  const sira = [];
  await Promise.all([
    veriIslem(async (v) => { sira.push("a-basla"); await new Promise((r) => setTimeout(r, 20)); v.kayitlar.push(1); sira.push("a-bit"); }),
    veriIslem(async (v) => { sira.push("b-basla"); v.kayitlar.push(2); sira.push("b-bit"); }),
  ]);
  assert.deepEqual(sira, ["a-basla", "a-bit", "b-basla", "b-bit"]);
});

/* ── Hata yolları ────────────────────────────────────────────────────────── */

test("fn fırlarsa yazılmaz ve hata çağırana yayılır", async () => {
  const depo = sahteDepo();
  const veriIslem = veriIslemOlustur({ oku: () => depo.oku(), yaz: (v) => depo.yaz(v) });
  await veriIslem(async (v) => { v.kayitlar.push({ n: 1 }); });

  await assert.rejects(
    () => veriIslem(async (v) => { v.kayitlar.push({ n: 2 }); throw new VeriHata(404, "kayıt yok"); }),
    (e) => e.durum === 404 && e.message === "kayıt yok");

  // Yarım kalan değişiklik diske gitmedi.
  assert.deepEqual(depo.son().kayitlar, [{ n: 1 }]);
});

test("bir işlem fırlasa da kuyruk kopmaz — sıradakiler koşar", async () => {
  const depo = sahteDepo();
  const veriIslem = veriIslemOlustur({ oku: () => depo.oku(), yaz: (v) => depo.yaz(v) });
  const sonuclar = await Promise.allSettled([
    veriIslem(async (v) => { v.kayitlar.push({ n: 1 }); }),
    veriIslem(async () => { throw new Error("patla"); }),
    veriIslem(async (v) => { v.kayitlar.push({ n: 3 }); }),
  ]);
  assert.deepEqual(sonuclar.map((s) => s.status), ["fulfilled", "rejected", "fulfilled"]);
  assert.deepEqual(depo.son().kayitlar, [{ n: 1 }, { n: 3 }]);
});

test("oku fırlarsa (bozuk dosya) hata yutulmaz ve yazma denenmez", async () => {
  const izler = { yazma: 0 };
  const veriIslem = veriIslemOlustur({
    oku: async () => { throw new Error("portfolio.json okunamadı"); },
    yaz: async () => { izler.yazma++; },
  });
  await assert.rejects(() => veriIslem(async () => {}), /okunamadı/);
  assert.equal(izler.yazma, 0);
});

test("islem.yazma() yazmayı iptal eder ama dönüş değerini korur", async () => {
  const depo = sahteDepo();
  const veriIslem = veriIslemOlustur({ oku: () => depo.oku(), yaz: (v) => depo.yaz(v) });
  const r = await veriIslem(async (v, islem) => { v.kayitlar.push({ n: 9 }); islem.yazma(); return "eklenecek yok"; });
  assert.equal(r, "eklenecek yok");
  assert.equal(depo.izler.yazma, 0);
  assert.deepEqual(depo.son().kayitlar, []);
});

/* ── Kuyruğun kendisi ────────────────────────────────────────────────────── */

test("kuyrukOlustur işleri veriliş sırasında koşturur", async () => {
  const kuyrukla = kuyrukOlustur();
  const sira = [];
  const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
  await Promise.all([
    kuyrukla(async () => { await bekle(15); sira.push(1); }),
    kuyrukla(async () => { await bekle(1); sira.push(2); }),
    kuyrukla(async () => { sira.push(3); }),
  ]);
  assert.deepEqual(sira, [1, 2, 3]);
});

test("bekle() kuyruk boşalınca çözülür, hata varken bile", async () => {
  const kuyrukla = kuyrukOlustur();
  kuyrukla(async () => { throw new Error("x"); }).catch(() => {});
  let bitti = false;
  kuyrukla(async () => { await new Promise((r) => setTimeout(r, 10)); bitti = true; });
  await kuyrukla.bekle();
  assert.equal(bitti, true);
});
