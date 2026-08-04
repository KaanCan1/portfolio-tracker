/* GERÇEK modülü import eder. Bu eşikler bugüne kadar hiç sınanmamıştı —
 * server.js import edilemediği için sınanamıyorlardı. */
import test from "node:test";
import assert from "node:assert/strict";
import { pozisyonBulgulari, bayatKaynakBulgusu, ESIK, usd0 } from "../guard-alerts.js";

const BUGUN = "2026-08-04";
const poz = (o) => pozisyonBulgulari({ sym: "TEST", bugun: BUGUN, agirlik: 10, ...o });
const bul = (liste, kind) => liste.find((b) => b.alert?.kind === kind) || null;

test("usd0 yuvarlar ve binlik ayırır", () => {
  assert.equal(usd0(1057.49), "$1,057");
  assert.equal(usd0(0), "$0");
  assert.equal(usd0(null), "$0");
});

/* ── Kâr sıçraması ── */

test("sıçrama: ADR yokken taban eşik %6", () => {
  const az = poz({ price: 100, qty: 1, cost: 50, gunlukPct: 5.9, adr: null });
  assert.equal(bul(az, "spike"), null, "%5.9 taban eşiğin altında");
  const cok = poz({ price: 100, qty: 1, cost: 50, gunlukPct: 6.1, adr: null });
  assert.ok(bul(cok, "spike"), "%6.1 tetiklemeli");
});

test("sıçrama: ADR varsa eşik 1.2×ADR olur", () => {
  // ADR 10 → eşik 12; %11 tetiklememeli, %13 tetiklemeli
  assert.equal(bul(poz({ price: 100, qty: 1, cost: 50, gunlukPct: 11, adr: 10 }), "spike"), null);
  assert.ok(bul(poz({ price: 100, qty: 1, cost: 50, gunlukPct: 13, adr: 10 }), "spike"));
});

test("sıçrama: ADR düşükse taban eşik korunur (1.2×ADR < %6)", () => {
  // ADR 2 → 1.2×2 = 2.4 ama taban 6 kazanmalı
  assert.equal(bul(poz({ price: 100, qty: 1, cost: 50, gunlukPct: 4, adr: 2 }), "spike"), null);
});

test("sıçrama: ZARARDA tetiklenmez (kârı koru önerisi anlamsız olurdu)", () => {
  assert.equal(bul(poz({ price: 40, qty: 1, cost: 50, gunlukPct: 20, adr: null }), "spike"), null);
});

test("sıçrama: ana para geri alınmışsa 'bedava' der", () => {
  const b = bul(poz({ price: 100, qty: 2, cost: 50, gunlukPct: 10, realized: 500 }), "spike");
  assert.match(b.alert.action, /bedava/);
  assert.doesNotMatch(b.alert.action, /adet<\/b> sat/, "satış önerisi çıkmamalı");
});

test("sıçrama: kısmi satış matematiği (etkin maliyet / fiyat)", () => {
  // maliyet 50×2=100, realize 40 → etkin 60; fiyat 100 → 0.60 adet sat, 1.40 kalır
  const b = bul(poz({ price: 100, qty: 2, cost: 50, gunlukPct: 10, realized: 40 }), "spike");
  assert.match(b.alert.action, /0\.60 adet/);
  assert.match(b.alert.action, /1\.40 adet/);
  assert.match(b.alert.action, /\$60 cebe/);
});

/* ── Sert hareket: yalnız akış ── */

test("sert hareket MAİLE GİRMEZ, yalnız akışa düşer", () => {
  const l = poz({ price: 100, qty: 1, cost: 50, gunlukPct: -4, adr: null });
  const gap = l.find((b) => b.anahtar.startsWith("gap:"));
  assert.ok(gap, "akış olayı olmalı");
  assert.equal(gap.alert, null, "mail bulgusu OLMAMALI");
  assert.equal(gap.feed.sev, "warn", "düşüşte warn");
});

test("sert hareket sıçramayla ÇAKIŞMAZ (tek olay kalır)", () => {
  const l = poz({ price: 100, qty: 1, cost: 50, gunlukPct: 10, adr: null });
  assert.ok(bul(l, "spike"));
  assert.equal(l.find((b) => b.anahtar.startsWith("gap:")), undefined, "sıçrama varken gap olayı üretilmemeli");
});

test("sert hareket: yükselişte info, düşüşte warn", () => {
  const yukari = poz({ price: 100, qty: 1, cost: 200, gunlukPct: 4 });   // zararda → sıçrama yok
  assert.equal(yukari.find((b) => b.anahtar.startsWith("gap:")).feed.sev, "info");
});

/* ── Stop ── */

test("stop: fiyat stopun ALTINDA/eşitse crit üretir", () => {
  const b = bul(poz({ price: 98, qty: 1, cost: 50, planStop: 101, agirlik: 10 }), "stop");
  assert.equal(b.alert.sev, "crit");
  assert.match(b.alert.headline, /\$98/);
  assert.match(b.alert.headline, /\$101/);
});

test("stop: fiyat stopun ÜSTÜNDEyse tetiklenmez", () => {
  assert.equal(bul(poz({ price: 105, qty: 1, cost: 50, planStop: 101 }), "stop"), null);
});

test("stop: planStop yoksa tetiklenmez", () => {
  assert.equal(bul(poz({ price: 1, qty: 1, cost: 50, planStop: null }), "stop"), null);
  assert.equal(bul(poz({ price: 1, qty: 1, cost: 50, planStop: 0 }), "stop"), null);
});

/* ── Yoğunlaşma ── */

test("yoğunlaşma: eşik üstü VE stopsuz → tetiklenir", () => {
  const b = bul(poz({ price: 100, qty: 1, cost: 50, agirlik: 37, planStop: null }), "weight");
  assert.match(b.alert.title, /%37/);
});

test("yoğunlaşma: STOP VARSA tetiklenmez (bilinçli bahis, gürültü olurdu)", () => {
  assert.equal(bul(poz({ price: 100, qty: 1, cost: 50, agirlik: 60, planStop: 90 }), "weight"), null);
});

test("yoğunlaşma: eşiğin tam üstünde/altında sınır davranışı", () => {
  assert.equal(bul(poz({ price: 100, qty: 1, cost: 50, agirlik: ESIK.yogunlasmaPct, planStop: null }), "weight"), null);
  assert.ok(bul(poz({ price: 100, qty: 1, cost: 50, agirlik: ESIK.yogunlasmaPct + 0.1, planStop: null }), "weight"));
});

/* ── Girdi savunması ── */

test("geçersiz girdide hiçbir bulgu üretmez", () => {
  assert.deepEqual(poz({ price: 0, qty: 1, cost: 50, gunlukPct: 50 }), []);
  assert.deepEqual(poz({ price: 100, qty: 0, cost: 50, gunlukPct: 50 }), []);
});

test("gunlukPct null iken sıçrama/gap üretmez ama stop yine çalışır", () => {
  const l = poz({ price: 98, qty: 1, cost: 50, gunlukPct: null, planStop: 101 });
  assert.equal(bul(l, "spike"), null);
  assert.ok(bul(l, "stop"), "fiyat verisi eksik olsa da stop kontrolü çalışmalı");
});

/* ── Bayat kaynak ── */

test("bayat kaynak: yaş saate çevrilir, hata mesajı taşınır", () => {
  const b = bayatKaynakBulgusu({ ad: "doviz-altin", yasDk: 200, sonBasari: "2026-08-04T10:00:00.000Z", sonHata: "gövde eksik" }, 180, BUGUN);
  assert.equal(b.alert.sev, "warn");
  assert.match(b.alert.headline, /3 saattir bayat/);
  assert.match(b.alert.action, /gövde eksik/);
  assert.equal(b.anahtar, `kaynak:doviz-altin:${BUGUN}`);
});

test("bayat kaynak: hiç veri yoksa bunu ayrıca söyler", () => {
  const b = bayatKaynakBulgusu({ ad: "vix", yasDk: null, sonBasari: null, sonHata: null }, 180, BUGUN);
  assert.match(b.alert.headline, /hiç doğrulanmış veri yok/);
  assert.equal(b.alert.stats.find((s) => s.label === "Yaş").value, "—");
});
