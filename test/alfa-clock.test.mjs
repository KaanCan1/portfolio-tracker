import test from "node:test";
import assert from "node:assert/strict";
import { nySaat, islemGunu, tazeSeansKotasyonu, bugunBildir, kapanmisIslemBari } from "../alfa-clock.js";
import { canliBarBindir } from "../live-bar.js";

const cuma = "2026-09-25";
const cumaSeans = new Date("2026-09-25T19:30:00Z"); // New York 15:30
const cumaQ = { price: 90, asOf: Date.parse("2026-09-25T19:29:00Z") / 1000 };
const seri = [{ time: "2026-09-24", open: 100, high: 102, low: 98, close: 100 }];

test("UTC gece yarısı geçse de New York cuma gününde kalır", () => {
  assert.equal(nySaat(new Date("2026-09-26T01:00:00Z")).gun, cuma);
  assert.equal(islemGunu(cuma), true);
  assert.equal(islemGunu("2026-09-26"), false);
  assert.equal(islemGunu("2026-09-27"), false);
});

test("cuma fiyatı pazar sentetik satış barı oluşturmaz", () => {
  const pazar = new Date("2026-09-27T15:00:00Z");
  assert.equal(tazeSeansKotasyonu(cumaQ, "2026-09-27", pazar), false);
  assert.equal(canliBarBindir(seri, cumaQ, "2026-09-27", pazar), seri);
  assert.equal(bugunBildir(cuma, pazar), false);
  assert.equal(bugunBildir("2026-09-27", pazar), false);
});

test("zamanı eksik, bayat, premarket veya farklı gün kotasyonu işlem üretmez", () => {
  assert.equal(tazeSeansKotasyonu({ price: 90 }, cuma, cumaSeans), false);
  assert.equal(tazeSeansKotasyonu({ ...cumaQ, stale: true }, cuma, cumaSeans), false);
  assert.equal(tazeSeansKotasyonu({ ...cumaQ, extended: true }, cuma, cumaSeans), false);
  assert.equal(tazeSeansKotasyonu({ price: 90, asOf: Date.parse("2026-09-25T13:00:00Z") / 1000 }, cuma, cumaSeans), false);
  assert.equal(tazeSeansKotasyonu({ price: 90, asOf: Date.parse("2026-09-24T19:29:00Z") / 1000 }, cuma, cumaSeans), false);
  assert.equal(tazeSeansKotasyonu(cumaQ, cuma, new Date("2026-09-25T19:50:00Z")), false);
});

test("doğrulanmış düzenli seans kotasyonu stop barı üretir; önceki gün bildirilmez", () => {
  assert.equal(tazeSeansKotasyonu(cumaQ, cuma, cumaSeans), true);
  assert.equal(canliBarBindir(seri, cumaQ, cuma, cumaSeans)[1].low, 90);
  assert.equal(bugunBildir(cuma, cumaSeans), true);
  assert.equal(bugunBildir("2026-09-24", cumaSeans), false);
});

test("yaz/kış saati New York takvimine göre değerlendirilir", () => {
  const kis = new Date("2026-01-05T15:30:00Z");
  const kisQ = { price: 90, asOf: Date.parse("2026-01-05T15:29:00Z") / 1000 };
  assert.equal(tazeSeansKotasyonu(kisQ, "2026-01-05", kis), true);
  assert.equal(tazeSeansKotasyonu(kisQ, "2026-01-05", new Date("2026-01-05T14:29:00Z")), false);
});

test("EMA21 çıkışı seans içinde olmaz, kapanıştan sonra aynı gün olur", () => {
  assert.equal(kapanmisIslemBari(cuma, true, cumaSeans), false);
  assert.equal(kapanmisIslemBari(cuma, true, new Date("2026-09-25T20:06:00Z")), true);
  assert.equal(kapanmisIslemBari(cuma, false, new Date("2026-09-25T20:06:00Z")), false);
  assert.equal(kapanmisIslemBari(cuma, false, new Date("2026-09-27T15:00:00Z")), true);
});
