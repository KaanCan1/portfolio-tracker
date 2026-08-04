/* GERÇEK modülü import eder. */
import test from "node:test";
import assert from "node:assert/strict";
import { depoOlustur } from "../store.js";

const sessiz = { log() {} };

/* Sahte ortam: db bir Map, dosya sistemi bir nesne. dbYok=true iken dbYaz
 * false döner — server.js'te dbPool olmadığında olan şey. */
function ortam({ dbYok = false, db = {}, dosyalar = {} } = {}) {
  const izler = { dbYazma: [], dosyaYazma: [] };
  return {
    izler, db, dosyalar,
    kur: () => depoOlustur({
      log: sessiz,
      dbOku: async (k) => (dbYok ? null : (k in db ? db[k] : null)),
      dbYaz: async (k, v, o = {}) => {
        if (dbYok) return false;
        if (o.yalnizYoksa && k in db) return true;
        db[k] = v; izler.dbYazma.push(k); return true;
      },
      dosyaOku: async (p) => { if (!(p in dosyalar)) throw new Error("ENOENT"); return dosyalar[p]; },
      dosyaYaz: async (p, s) => { dosyalar[p] = s; izler.dosyaYazma.push(p); },
    }),
  };
}

test("DB'de kayıt varsa oradan okur, dosyaya bakmaz", async () => {
  const o = ortam({ db: { k: { a: 1 } }, dosyalar: { "/k.json": '{"a":999}' } });
  const d = o.kur()("k", { dosya: "/k.json" });
  assert.deepEqual(await d.oku(), { a: 1 });
});

test("DB boşsa dosyadan okur", async () => {
  const o = ortam({ dosyalar: { "/k.json": '{"a":2}' } });
  assert.deepEqual(await o.kur()("k", { dosya: "/k.json" }).oku(), { a: 2 });
});

test("hiçbir yerde kayıt yoksa varsayılanı döner", async () => {
  const o = ortam();
  assert.deepEqual(await o.kur()("k", { varsayilan: { trades: [] } }).oku(), { trades: [] });
});

test("varsayılan KLONLANIR — çağıranlar birbirini bozamaz", async () => {
  const o = ortam();
  const d = o.kur()("k", { varsayilan: { trades: [] } });
  const a = await d.oku();
  a.trades.push("kirlilik");
  const b = await d.oku();
  assert.deepEqual(b, { trades: [] }, "ikinci okuma temiz olmalı");
});

test("tohumla: DB boş + dosyada kayıt → DB'ye taşınır", async () => {
  const o = ortam({ dosyalar: { "/k.json": "[1,2,3]" } });
  const d = o.kur()("k", { dosya: "/k.json", tohumla: true });
  assert.deepEqual(await d.oku(), [1, 2, 3]);
  assert.deepEqual(o.db.k, [1, 2, 3], "DB'ye tohumlanmalıydı");
});

test("tohumla: DB YOKKEN 'tohumlandı' diye YALAN SÖYLEMEZ", async () => {
  const satirlar = [];
  const depo = depoOlustur({
    log: { log: (m) => satirlar.push(m) },
    dbOku: async () => null,
    dbYaz: async () => false,                 // dosya modu: DB yok
    dosyaOku: async () => "[1,2,3]",
    dosyaYaz: async () => {},
  });
  const d = depo("signal_ledger", { dosya: "/k.json", tohumla: true, varsayilan: [] });
  assert.deepEqual(await d.oku(), [1, 2, 3], "okuma yine de çalışmalı");
  assert.deepEqual(satirlar, [], "hiçbir şey yazılmadıysa 'tohumlandı' denmemeli");
});

test("tohumla: DB VARKEN gerçekten haber verir", async () => {
  const satirlar = [];
  const db = {};
  const depo = depoOlustur({
    log: { log: (m) => satirlar.push(m) },
    dbOku: async () => null,
    dbYaz: async (k, v) => { db[k] = v; return true; },
    dosyaOku: async () => "[1]",
    dosyaYaz: async () => {},
  });
  await depo("k", { dosya: "/k.json", tohumla: true }).oku();
  assert.equal(satirlar.length, 1);
  assert.match(satirlar[0], /tohumlandı/);
});

test("tohumla kapalıyken DB'ye yazılmaz", async () => {
  const o = ortam({ dosyalar: { "/k.json": "[1]" } });
  await o.kur()("k", { dosya: "/k.json" }).oku();
  assert.equal("k" in o.db, false);
});

test("yaz: DB varken YALNIZ DB'ye yazar (çift kopya olmaz)", async () => {
  const o = ortam({ dosyalar: { "/k.json": "{}" } });
  const nereye = await o.kur()("k", { dosya: "/k.json" }).yaz({ a: 5 });
  assert.equal(nereye, "db");
  assert.deepEqual(o.izler.dosyaYazma, [], "DB varken dosyaya YAZILMAMALI");
  assert.deepEqual(o.db.k, { a: 5 });
});

test("yaz: DB yokken dosyaya düşer", async () => {
  const o = ortam({ dbYok: true });
  const nereye = await o.kur()("k", { dosya: "/k.json" }).yaz({ a: 6 });
  assert.equal(nereye, "dosya");
  assert.deepEqual(JSON.parse(o.dosyalar["/k.json"]), { a: 6 });
});

test("yaz: DB de dosya da yoksa dürüstçe 'hicbiri' der", async () => {
  const o = ortam({ dbYok: true });
  assert.equal(await o.kur()("k", {}).yaz({ a: 7 }), "hicbiri");
});

test("bozuk dosya varsayılana düşer (okuma çökmez)", async () => {
  const o = ortam({ dosyalar: { "/k.json": "{yarım" } });
  assert.deepEqual(await o.kur()("k", { dosya: "/k.json", varsayilan: {} }).oku(), {});
});

test("normalize: eksik/bozuk kaydı beklenen şekle sokar", async () => {
  const o = ortam({ db: { k: { items: "dizi değil" } } });
  const d = o.kur()("k", {
    normalize: (v) => ({ items: Array.isArray(v?.items) ? v.items : [], lastFlush: v?.lastFlush || null }),
  });
  assert.deepEqual(await d.oku(), { items: [], lastFlush: null });
});

test("depoOlustur eksik bağımlılıkla kurulamaz", () => {
  assert.throws(() => depoOlustur({ dbOku: async () => null, dbYaz: async () => true }), /dosyaOku/);
  assert.throws(() => depoOlustur({ dosyaOku: async () => "", dosyaYaz: async () => {} }), /dbOku/);
});
