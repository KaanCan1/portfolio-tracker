/* GERÇEK modülü import eder. */
import test from "node:test";
import assert from "node:assert/strict";
import { canliBarBindir, kapanmisBarlar } from "../live-bar.js";

const BUGUN = "2026-08-05";
const mum = (time, o, h, l, c) => ({ time, open: o, high: h, low: l, close: c, volume: 1 });
const seri = [mum("2026-08-03", 100, 105, 99, 104), mum("2026-08-04", 104, 108, 103, 107)];

test("bugünün barı yoksa sentetik bar eklenir", () => {
  const r = canliBarBindir(seri, { price: 110 }, BUGUN);
  assert.equal(r.length, 3);
  const b = r[2];
  assert.equal(b.time, BUGUN);
  assert.equal(b.close, 110);
  assert.equal(b.high, 110);
  assert.equal(b.low, 110);
  assert.equal(b.open, 110, "open canlı fiyat olmalı — prevClose sahte boşluk çıkışı üretirdi");
  assert.equal(b.canli, true);
});

test("bugünün barı varsa high GENİŞLER, asla daralmaz", () => {
  const bugunlu = [...seri, mum(BUGUN, 107, 112, 106, 109)];
  const r = canliBarBindir(bugunlu, { price: 115 }, BUGUN);
  assert.equal(r.length, 3, "bar eklenmemeli, güncellenmeli");
  assert.equal(r[2].high, 115, "canlı fiyat yüksekten büyükse high büyür");
  assert.equal(r[2].low, 106, "low korunmalı");
  assert.equal(r[2].close, 115);
});

test("canlı fiyat mevcut high'ın ALTINDAysa high korunur (determinizm)", () => {
  const bugunlu = [...seri, mum(BUGUN, 107, 120, 106, 109)];
  const r = canliBarBindir(bugunlu, { price: 111 }, BUGUN);
  assert.equal(r[2].high, 120, "gün içi zirve geri alınamaz — tekrar oynatma bozulurdu");
  assert.equal(r[2].close, 111);
});

test("canlı fiyat mevcut low'un ALTINDAysa low düşer", () => {
  const bugunlu = [...seri, mum(BUGUN, 107, 112, 106, 109)];
  const r = canliBarBindir(bugunlu, { price: 101 }, BUGUN);
  assert.equal(r[2].low, 101);
  assert.equal(r[2].high, 112, "high sabit kalmalı");
});

test("canlı fiyat yoksa seri DEĞİŞMEZ", () => {
  assert.equal(canliBarBindir(seri, null, BUGUN), seri);
  assert.equal(canliBarBindir(seri, { price: 0 }, BUGUN), seri);
  assert.equal(canliBarBindir(seri, { price: NaN }, BUGUN), seri);
});

test("boş/geçersiz seri güvenle geçilir", () => {
  assert.deepEqual(canliBarBindir([], { price: 10 }, BUGUN), []);
  assert.equal(canliBarBindir(null, { price: 10 }, BUGUN), null);
});

test("girdi serisi MUTASYONA UĞRAMAZ", () => {
  const kopya = JSON.parse(JSON.stringify(seri));
  canliBarBindir(seri, { price: 999 }, BUGUN);
  assert.deepEqual(seri, kopya);
});

test("TP kontrolü kısmi barda tetiklenirse kapanmış barda da tetiklenir (monotonluk)", () => {
  // Gün içi: fiyat 115'e değdi → high 115. Sonra düşüp 108'de kapandı.
  const gunIci = canliBarBindir(seri, { price: 115 }, BUGUN);
  const tp = 112;
  assert.ok(gunIci[2].high >= tp, "gün içi tetiklenmeli");
  // Günün gerçek kapanmış barı: high yine 115 (zirve kayda geçer)
  const kapanmis = [...seri, mum(BUGUN, 107, 115, 106, 108)];
  assert.ok(kapanmis[2].high >= tp, "tekrar oynatmada da tetiklenmeli");
});

test("kapanmisBarlar bugünü dışarıda bırakır (close'a bakan kararlar için)", () => {
  const bugunlu = [...seri, mum(BUGUN, 107, 112, 106, 109)];
  const r = kapanmisBarlar(bugunlu, BUGUN);
  assert.equal(r.length, 2);
  assert.equal(r[r.length - 1].time, "2026-08-04");
});
