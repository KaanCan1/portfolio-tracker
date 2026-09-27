import test from "node:test";
import assert from "node:assert/strict";
import { alfaBoyut } from "../alfa-risk.js";

const boyut = (entry, stop) => alfaBoyut(entry, stop, 1500, 3, 350, 850);

test("risk sınırı min tutardan küçük pozisyon gerektiriyorsa işlem açılmaz", () => {
  assert.equal(boyut(100, 80), 0); // $350 emir $70 kaybettirir; bütçe $45
});

test("normal boyut risk bütçesini ve pozisyon tavanını aşmaz", () => {
  assert.equal(boyut(100, 95), 850);
  assert.ok(850 * 0.05 <= 45);
  assert.equal(boyut(100, 92), 562.5);
});

test("geçersiz stop veya giriş işlem üretmez", () => {
  assert.equal(boyut(100, 100), 0);
  assert.equal(boyut(100, 101), 0);
  assert.equal(boyut(0, 1), 0);
});
