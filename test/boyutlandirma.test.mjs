/* GERÇEK modülü import eder. */
import test from "node:test";
import assert from "node:assert/strict";
import { adetHesapla, korelasyonCarpaniHesapla, TAVAN_PCT } from "../boyutlandirma.js";

const temel = { sermaye: 10_000, riskPct: 1, giris: 100, stop: 90 };

test("temel formül: sermaye × risk% ÷ 1R", () => {
  const r = adetHesapla(temel);
  // 10.000 × %1 = 100$ risk, birim risk 10$ → 10 adet
  assert.equal(r.adet, 10);
  assert.equal(r.riskUSD, 100);
  assert.equal(r.tutarUSD, 1000);
  assert.equal(r.tavanDeydi, false);
});

test("eksik/tutarsız girdi null döner — 0 değil", () => {
  assert.equal(adetHesapla({ ...temel, sermaye: 0 }), null);
  assert.equal(adetHesapla({ ...temel, giris: 0 }), null);
  assert.equal(adetHesapla({ ...temel, stop: 0 }), null);
  assert.equal(adetHesapla({ ...temel, stop: 100 }), null, "stop = giriş geçersiz");
  assert.equal(adetHesapla({ ...temel, stop: 110 }), null, "stop girişin üstünde geçersiz");
});

test("risk% aralık dışıysa %1'e düşer (form serbest metin kabul ediyor)", () => {
  assert.equal(adetHesapla({ ...temel, riskPct: 0 }).adet, 10);
  assert.equal(adetHesapla({ ...temel, riskPct: 50 }).adet, 10);
  assert.equal(adetHesapla({ ...temel, riskPct: 2 }).adet, 20);
});

test(`tek pozisyon tavanı %${TAVAN_PCT} bağlar ve bildirilir`, () => {
  // stop çok yakın → adet fırlar, tavan devreye girer
  const r = adetHesapla({ ...temel, stop: 99.5 });
  assert.equal(r.tavanDeydi, true);
  assert.equal(r.adet, (10_000 * 0.25) / 100, "tavan = sermaye×%25 ÷ giriş");
  assert.equal(r.tutarUSD, 2500);
});

/* ===== korelasyon çarpanı ===== */

test("çarpan pozisyonu KÜÇÜLTÜR, büyütmez", () => {
  const yok = adetHesapla(temel);
  const var_ = adetHesapla({ ...temel, korelasyonCarpani: 1.32 });
  assert.ok(var_.adet < yok.adet);
  assert.ok(Math.abs(var_.adet - 10 / 1.32) < 1e-12);
  assert.equal(var_.olculdu, true);
  assert.equal(var_.carpan, 1.32);
  assert.equal(var_.carpansizAdet, 10, "kesintisiz adet de raporlanır (UI kıyas gösteriyor)");
});

test("ölçülen 1,32 çarpanı ~%24 küçültmeye denk — ölçümdeki sayı", () => {
  const r = adetHesapla({ ...temel, korelasyonCarpani: 1.32 });
  const kucultme = 1 - r.adet / r.carpansizAdet;
  assert.ok(Math.abs(kucultme - 0.2424) < 0.001, `küçültme ${kucultme}`);
});

test("çarpan yoksa/geçersizse kesinti YAPILMAZ ve olculdu=false", () => {
  for (const v of [undefined, null, NaN, 0, 1, -2, "1.4"]) {
    const r = adetHesapla({ ...temel, korelasyonCarpani: v });
    assert.equal(r.adet, 10, `çarpan ${String(v)} kesinti yapmamalı`);
    assert.equal(r.olculdu, false);
    assert.equal(r.carpan, 1);
  }
});

test("1'in ALTINDA çarpan pozisyonu büyütmez — kesintinin yönü tersine dönmez", () => {
  const r = adetHesapla({ ...temel, korelasyonCarpani: 0.8 });
  assert.equal(r.adet, 10);
  assert.equal(r.olculdu, false);
});

test("çarpan ve tavan birlikte: çarpan önce, tavan sonra", () => {
  const r = adetHesapla({ ...temel, stop: 99.5, korelasyonCarpani: 1.32 });
  // çarpansız adet 2000 → çarpanla 1515 → ikisi de tavanın (25) üstünde
  assert.equal(r.tavanDeydi, true);
  assert.equal(r.adet, 25);
});

test("korelasyonCarpaniHesapla: bilinen kovaryanstan doğru oran", () => {
  // iki eşit ağırlık, σ %2 ve %3, ρ = 0,4
  const w = [0.5, 0.5], sg = [0.02, 0.03];
  const sigmaGercek = Math.sqrt(0.25 * 4e-4 + 0.25 * 9e-4 + 2 * 0.25 * 0.4 * 0.02 * 0.03);
  const { carpan, olculdu, sigmaBagimsiz } = korelasyonCarpaniHesapla(w, sg, sigmaGercek);
  assert.ok(Math.abs(sigmaBagimsiz - Math.sqrt(0.25 * 4e-4 + 0.25 * 9e-4)) < 1e-15);
  assert.ok(carpan > 1 && olculdu);
  assert.ok(Math.abs(carpan - sigmaGercek / sigmaBagimsiz) < 1e-15);
});

test("korelasyonCarpaniHesapla: tam bağımsız portföyde çarpan 1, kesinti yok", () => {
  const w = [0.5, 0.5], sg = [0.02, 0.02];
  const bagimsiz = Math.sqrt(0.25 * 4e-4 + 0.25 * 4e-4);
  const r = korelasyonCarpaniHesapla(w, sg, bagimsiz);
  assert.ok(Math.abs(r.carpan - 1) < 1e-15);
  assert.equal(r.olculdu, false, "1 = kesinti yok");
});

test("korelasyonCarpaniHesapla: bozuk girdi sessizce 1 döner", () => {
  assert.equal(korelasyonCarpaniHesapla([], [], 0.01).olculdu, false);
  assert.equal(korelasyonCarpaniHesapla([1], [0.02], 0).carpan, 1);
  assert.equal(korelasyonCarpaniHesapla([0.5, 0.5], [0.02], 0.01).carpan, 1, "uzunluklar uyuşmuyor");
  assert.equal(korelasyonCarpaniHesapla([0.5, 0.5], [0.02, NaN], 0.01).carpan, 1);
});

test("tek pozisyonlu portföy: çarpan 1 (tanım gereği), kesinti yok", () => {
  const r = korelasyonCarpaniHesapla([1], [0.03], 0.03);
  assert.ok(Math.abs(r.carpan - 1) < 1e-15);
  assert.equal(r.olculdu, false);
});
