/* GERÇEK modülü import eder. Daha önce mantık kopyalanıyor ve ayrıca
 * "kopya sapmadı mı" testiyle korunuyordu — çıkarma işinden sonra gereksiz. */
import test from "node:test";
import assert from "node:assert/strict";
import { rateLimiter } from "../rate-limit.js";


test("tryReserve boş kapasite kadar verir, fazlasını vermez", () => {
  const g = rateLimiter(7);
  assert.equal(g.tryReserve(6, 7), 6);
  assert.equal(g.tryReserve(6, 7), 1, "kalan yalnız 1 slot olmalı");
  assert.equal(g.tryReserve(3, 7), 0, "dolu gate 0 döndürmeli");
});

test("tryReserve softCap'i aşmaz", () => {
  const g = rateLimiter(7);
  assert.equal(g.tryReserve(10, 3), 3);
  assert.equal(g.tryReserve(10, 3), 0);
});

test("tryReserve BEKLEMEZ — istek yolunu askıda bırakmaz", () => {
  const g = rateLimiter(7);
  g.tryReserve(7, 7);
  const t0 = Date.now();
  assert.equal(g.tryReserve(5, 7), 0);
  assert.ok(Date.now() - t0 < 20, "senkron dönmeliydi");
});

test("kredi muhasebesi doğru: 6 sembol 6 slot tüketir", () => {
  const g = rateLimiter(7);
  g.tryReserve(6, 7);            // toplu fiyat sorgusu, 6 sembol
  assert.equal(g.tryReserve(7, 7), 1, "mum çekimine 1 slot kalmalı — eskiden 6 slot yanlışlıkla boştaydı");
});
