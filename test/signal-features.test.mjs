/* GERÇEK modülü import eder. */
import test from "node:test";
import assert from "node:assert/strict";
import { signalFeatures } from "../signal-features.js";

const ornek = {
  price: 224.76,
  t: { rsi: 61.4, atr: 6.8, sma50: 210, sma200: 190, w52High: 236.54, w52Low: 164.07, high20: 226 },
  plan: { entry: 224.76, stop: 204.01, target: 266.25 },
  radar: { score: 60, tier: { key: "buy" }, recoScore: 4.2, ret1M: 5.1, ret3M: 12.4, ret6M: -3.2,
           insider: { buys: 0, sells: 15, netValue: -450848802.87 } },
  rejim: { vix: 17.3, vixBant: "Sakin", fng: 62 },
};

test("teknik konum: mesafeler yüzde olarak, zirvenin altı NEGATİF", () => {
  const f = signalFeatures(ornek);
  assert.equal(f.rsi, 61.4);
  assert.equal(f.atrPct, 3.03);                 // 6.8/224.76*100
  assert.equal(f.sma50Ustu, true);
  assert.equal(f.sma200Ustu, true);
  assert.ok(f.zirveMesafe < 0, "52h zirvenin altındaysa negatif olmalı");
  assert.equal(f.zirveMesafe, -4.98);
  assert.ok(f.dip52Mesafe > 0);
});

test("plan geometrisi: stop ve hedef mesafesi (ölçümün asıl sorusu)", () => {
  const f = signalFeatures(ornek);
  assert.equal(f.stopMesafePct, 9.23);
  assert.equal(f.hedefMesafePct, 18.46);
});

test("insider net satış negatif kalır, yuvarlanır", () => {
  const f = signalFeatures(ornek);
  assert.equal(f.insiderNet, -450848803);
  assert.equal(f.insiderSatis, 15);
  assert.equal(f.insiderAlim, 0);
});

test("rejim alanları taşınır — kurulum ile piyasa şansı ayrışabilsin", () => {
  const f = signalFeatures(ornek);
  assert.equal(f.vix, 17.3);
  assert.equal(f.vixBant, "Sakin");
  assert.equal(f.fng, 62);
});

/* Bu modül defter yazımının İÇİNDE çalışır: eksik veri yüzünden fırlarsa
 * sinyal kaydı düşer. Hiçbir girdi kombinasyonu çökertmemeli. */
test("eksik veri: fırlamaz, olmayan alan null döner", () => {
  assert.doesNotThrow(() => signalFeatures());
  const bos = signalFeatures({});
  assert.equal(bos.rsi, null);
  assert.equal(bos.atrPct, null);
  assert.equal(bos.zirveMesafe, null);
  assert.equal(bos.insiderNet, null);
  assert.equal(bos.vixBant, null);
  assert.equal(bos.sma200Ustu, null, "bilinmiyorsa false DEĞİL null olmalı");
});

test("bozuk sayı (NaN/Infinity) null'a çevrilir — istatistiği zehirlemesin", () => {
  const f = signalFeatures({
    price: 100, t: { rsi: NaN, atr: Infinity, w52High: 0 }, plan: { entry: 100, stop: 90 },
    radar: { recoScore: NaN },
  });
  assert.equal(f.rsi, null);
  assert.equal(f.atrPct, null);
  assert.equal(f.zirveMesafe, null, "sıfıra bölme null olmalı");
  assert.equal(f.analistSkor, null);
  assert.equal(f.hedefMesafePct, null, "hedef yoksa null");
});

test("düz şema: değerler gruplanabilir olsun diye iç içe nesne YOK", () => {
  const f = signalFeatures(ornek);
  for (const [k, v] of Object.entries(f)) {
    assert.ok(v === null || ["number", "string", "boolean"].includes(typeof v),
      `${k} düz bir değer olmalı, ${typeof v} geldi`);
  }
});
