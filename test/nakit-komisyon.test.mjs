/* GERÇEK modülü import eder. */
import test from "node:test";
import assert from "node:assert/strict";
import { MIDAS_FEE, alisNakitDelta, satisNakitDelta, nakitUygula } from "../nakit-komisyon.js";

test("alışta komisyon tutara EKLENİR — $500'lık alış $501,5 götürür", () => {
  assert.equal(alisNakitDelta(10, 50), -(500 + MIDAS_FEE));
  assert.equal(alisNakitDelta(10, 50), -501.5);
});

test("satışta komisyon gelirden DÜŞÜLÜR — $300'lık satış $298,5 getirir", () => {
  assert.equal(satisNakitDelta(10, 30), 300 - MIDAS_FEE);
  assert.equal(satisNakitDelta(10, 30), 298.5);
});

test("işaretler ters: alış negatif, satış pozitif", () => {
  assert.ok(alisNakitDelta(1, 100) < 0);
  assert.ok(satisNakitDelta(1, 100) > 0);
});

test("Kaan'ın PLTR vakası: $500'lık alış, eksik olan tam $1,5'tu", () => {
  const komisyonsuz = -500;                       // eski appendBuyTrade davranışı
  const dogru = alisNakitDelta(4, 125);           // 4 × $125 = $500
  assert.equal(dogru, -501.5);
  assert.equal(+(dogru - komisyonsuz).toFixed(2), -1.5, "aradaki fark komisyonun kendisi");
});

test("emir yoksa ücret de yok — 0 adet/0 fiyat nakde dokunmaz", () => {
  for (const [a, f] of [[0, 50], [10, 0], [0, 0], [-5, 50], [10, -50]]) {
    assert.equal(alisNakitDelta(a, f), 0, `alış ${a}×${f}`);
    assert.equal(satisNakitDelta(a, f), 0, `satış ${a}×${f}`);
  }
});

test("bozuk girdi ücret uydurmaz", () => {
  assert.equal(alisNakitDelta(undefined, 50), 0);
  assert.equal(alisNakitDelta(10, null), 0);
  assert.equal(alisNakitDelta(NaN, NaN), 0);
  assert.equal(satisNakitDelta("abc", 50), 0);
});

test("kesirli adet (kısmi hisse) doğru hesaplanır", () => {
  assert.equal(alisNakitDelta(0.523990027, 100), +(-(52.3990027 + 1.5)));
});

test("nakitUygula: iki hane yuvarlar, bozuk bakiyeyi 0 sayar", () => {
  assert.equal(nakitUygula(1000, alisNakitDelta(4, 125)), 498.5);
  assert.equal(nakitUygula(498.5, satisNakitDelta(4, 130)), 1017);
  assert.equal(nakitUygula(undefined, -501.5), -501.5);
  assert.equal(nakitUygula(0.1, -0.2), -0.1, "kayan nokta artığı bırakmaz");
});

test("al-sat turu: iki emir = iki komisyon", () => {
  let nakit = 1000;
  nakit = nakitUygula(nakit, alisNakitDelta(4, 125));    // −501.5
  nakit = nakitUygula(nakit, satisNakitDelta(4, 125));   // +498.5
  assert.equal(nakit, 997, "başa baş satışta bile 2×$1,5 gider");
});
