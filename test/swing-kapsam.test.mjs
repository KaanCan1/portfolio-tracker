/* GERÇEK modülü import eder. */
import test from "node:test";
import assert from "node:assert/strict";
import { holdingAdetleri, swingKapsam, sayilanPay } from "../swing-kapsam.js";

const hold = (symbol, quantity, type = "stock") => ({ symbol, quantity, type });
const sw = (id, symbol, qty) => ({ id, symbol, qty });

test("holdingAdetleri: yalnız hisseleri sayar, sembolü büyütür, aynı sembolü toplar", () => {
  const m = holdingAdetleri([hold("lite", 0.5), hold("LITE", 1.5), hold("GRA", 10, "fund"), hold("ONDS", 32)]);
  assert.equal(m.get("LITE"), 2);
  assert.equal(m.get("ONDS"), 32);
  assert.equal(m.has("GRA"), false, "fon hisse adedine karışmaz");
});

test("holdingAdetleri: bozuk/sıfır adet atlanır", () => {
  const m = holdingAdetleri([hold("A", 0), hold("B", -3), hold("C", NaN), hold("", 5), null]);
  assert.equal(m.size, 0);
});

test("14 Ağu vakası: aynı adet portföyde de varsa swing kaydı toplama girmez", () => {
  const holdings = [hold("LITE", 0.336575407), hold("ONDS", 32.715394933)];
  const k = swingKapsam([sw("a", "LITE", 0.336575407), sw("b", "ONDS", 32.715394933)], holdings);
  assert.equal(k.get("a").ekQty, 0, "LITE tamamen portföyde — ek yok");
  assert.equal(k.get("b").ekQty, 0, "ONDS tamamen portföyde — ek yok");
  assert.equal(k.get("a").kapsananQty, 0.336575407);
  assert.equal(k.get("a").portfoydeVar, true);
});

test("portföyde olmayan sembol ayrı alımdır — tamamı sayılır", () => {
  const k = swingKapsam([sw("a", "NVDA", 3)], [hold("LITE", 1)]);
  assert.equal(k.get("a").ekQty, 3);
  assert.equal(k.get("a").kapsananQty, 0);
  assert.equal(k.get("a").portfoydeVar, false);
});

test("kısmi örtüşme: fazlası ayrı alım sayılır", () => {
  const k = swingKapsam([sw("a", "MU", 5)], [hold("MU", 2)]);
  assert.equal(k.get("a").kapsananQty, 2);
  assert.equal(k.get("a").ekQty, 3);
});

test("aynı sembolde iki kayıt: kapsam bütçesi sırayla tükenir, iki kez kapsanmaz", () => {
  const k = swingKapsam([sw("a", "MU", 2), sw("b", "MU", 2)], [hold("MU", 3)]);
  assert.equal(k.get("a").ekQty, 0, "ilk kayıt tamamen kapsandı");
  assert.equal(k.get("b").kapsananQty, 1);
  assert.equal(k.get("b").ekQty, 1, "kalan bütçe 1 → fazlası ayrı alım");
});

test("kayan nokta: bölünmüş holding tam örtüşmeyi bozmaz", () => {
  // 0.1 + 0.2 !== 0.3 — pay olmadan bu kayıt 'ayrı alım' sanılırdı
  const k = swingKapsam([sw("a", "X", 0.3)], [hold("X", 0.1), hold("X", 0.2)]);
  assert.equal(k.get("a").ekQty, 0);
  assert.equal(k.get("a").kapsananQty, 0.3);
});

test("sayilanPay: plan kaydı toplama sıfır katar", () => {
  const k = swingKapsam([sw("a", "LITE", 0.34)], [hold("LITE", 0.34)]);
  const p = sayilanPay({ qty: 0.34, costUSD: 316.22, valueUSD: 307.91 }, k.get("a"));
  assert.equal(p.sayilanCostUSD, 0);
  assert.equal(p.sayilanValueUSD, 0);
  assert.equal(p.kaynak, "portfoy");
});

test("sayilanPay: ayrı alımın tamamı toplama girer", () => {
  const k = swingKapsam([sw("a", "NVDA", 2)], []);
  const p = sayilanPay({ qty: 2, costUSD: 400, valueUSD: 460 }, k.get("a"));
  assert.equal(p.sayilanCostUSD, 400);
  assert.equal(p.sayilanValueUSD, 460);
  assert.equal(p.kaynak, "ayri");
});

test("sayilanPay: kısmi örtüşmede oransal pay ve 'karma' etiketi", () => {
  const k = swingKapsam([sw("a", "MU", 4)], [hold("MU", 1)]);
  const p = sayilanPay({ qty: 4, costUSD: 400, valueUSD: 480 }, k.get("a"));
  assert.equal(p.sayilanQty, 3);
  assert.equal(p.sayilanCostUSD, 300);
  assert.equal(p.sayilanValueUSD, 360);
  assert.equal(p.kaynak, "karma");
});

test("sayilanPay: fiyatı olmayan pozisyonda değer null kalır (0 sanılmasın)", () => {
  const k = swingKapsam([sw("a", "NVDA", 2)], []);
  const p = sayilanPay({ qty: 2, costUSD: 400, valueUSD: null }, k.get("a"));
  assert.equal(p.sayilanValueUSD, null);
  assert.equal(p.sayilanCostUSD, 400);
});

/* ===== Risk evreni — /api/risk'in pozisyon toplama kuralı ==========================
 * 17 Ağu: /api/risk açık swing kayıtlarını holdings'in ÜZERİNE koşulsuz ekliyordu.
 * LITE ve ONDS her iki yerde de durduğu için aynı adet iki kez sayıldı; ağırlıklar
 * şişti, dolayısıyla portföy volatilitesi, VaR, beta ve risk katkısı da sessizce
 * yanlış çıktı (gerçek veride LITE %8,6 yerine %14,7 göründü).
 * Kural burada, sunucudan bağımsız sabitlenir. */
const riskEvreni = (holdings, swingler) => {
  const evren = holdings.filter((h) => h.type === "stock" && Number(h.quantity) > 0)
    .map((h) => ({ symbol: h.symbol, quantity: Number(h.quantity) }));
  const acik = swingler.filter((t) => t.status === "open" && Number(t.qty) > 0);
  const kapsamlar = swingKapsam(acik, holdings);
  for (const t of acik) {
    const { sayilanQty } = sayilanPay({ qty: t.qty }, kapsamlar.get(String(t.id)));
    if (sayilanQty > 0) evren.push({ symbol: t.symbol, quantity: sayilanQty });
  }
  return evren;
};
const topla = (evren) => evren.reduce((m, p) => {
  const s = p.symbol.toUpperCase(); m[s] = (m[s] || 0) + p.quantity; return m;
}, {});

test("risk evreni: portföyle TAM örtüşen swing planı adedi ikiye katlamaz", () => {
  const evren = riskEvreni(
    [hold("LITE", 0.34), hold("NVDA", 2)],
    [{ ...sw("a", "LITE", 0.34), status: "open" }],
  );
  assert.deepEqual(topla(evren), { LITE: 0.34, NVDA: 2 });
});

test("risk evreni: örtüşmeyen fazla AYRI alımdır, riske girer", () => {
  const evren = riskEvreni(
    [hold("MU", 1)],
    [{ ...sw("a", "MU", 4), status: "open" }],
  );
  assert.deepEqual(topla(evren), { MU: 4 });   // 1 holding + 3 ek — 5 değil
});

test("risk evreni: hiç holding'i olmayan swing tamamen riske girer", () => {
  const evren = riskEvreni([], [{ ...sw("a", "NBIS", 5), status: "open" }]);
  assert.deepEqual(topla(evren), { NBIS: 5 });
});

test("risk evreni: kapanmış swing kaydı riske girmez", () => {
  const evren = riskEvreni([hold("NVDA", 2)], [{ ...sw("a", "SOFI", 8), status: "closed" }]);
  assert.deepEqual(topla(evren), { NVDA: 2 });
});
