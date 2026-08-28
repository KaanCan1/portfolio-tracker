import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gunlukSeri, islemGunleri, akisGunleri, mutabakat, mutabakatNotu, ACIK_ESIGI,
} from "../deger-mutabakat.js";

/* Kur sabit 50 tutuluyor: modülün işi kur çevirmek değil, kimliği denetlemek.
 * Değişken kur ayrı testte (aşağıda) — orada akışın DOĞRU günün kuruyla
 * çevrildiği kontrol ediliyor. */
const snap = (d, total, market, cash, usdtry = 50) => ({ date: d, total, market, cash, usdtry });

test("gunlukSeri: ayni gune birden cok kayit varsa sonuncusu gecerli", () => {
  const S = gunlukSeri([snap("2026-06-01", 5000, 5000, 0), snap("2026-06-01", 6000, 6000, 0)]);
  assert.equal(S.length, 1);
  assert.equal(S[0].total, 120); // 6000/50
});

test("gunlukSeri: baslangic oncesi kayitlar olculmez", () => {
  const S = gunlukSeri([snap("2026-03-01", 5000, 5000, 0), snap("2026-06-02", 5000, 5000, 0)], "2026-06-01");
  assert.deepEqual(S.map((x) => x.d), ["2026-06-02"]);
});

test("gunlukSeri: bozuk kayit (total 0 / kur 0) atlanir", () => {
  const S = gunlukSeri([snap("2026-06-01", 0, 0, 0), snap("2026-06-02", 5000, 5000, 0, 0), snap("2026-06-03", 5000, 5000, 0)]);
  assert.deepEqual(S.map((x) => x.d), ["2026-06-03"]);
});

test("islemGunleri: alis ve satis brutu ayri, komisyon toplanir", () => {
  const m = islemGunleri([
    { date: "2026-06-02", symbol: "abc", kind: "buy", shares: 2, buyUSD: 100, feeUSD: 1.5 },
    { date: "2026-06-02", symbol: "xyz", kind: "sell", shares: 1, sellUSD: 300, feeUSD: 1.5 },
  ]);
  const o = m.get("2026-06-02");
  assert.equal(o.alim, 200);
  assert.equal(o.satim, 300);
  assert.equal(o.fee, 3);
  assert.deepEqual(o.semboller, ["AL ABC", "SAT XYZ"]);
});

test("akisGunleri: cekim negatif, o gunun kuruyla cevrilir", () => {
  const m = akisGunleri(
    [{ date: "2026-06-02", type: "withdraw", amountTRY: 5000 }, { date: "2026-06-03", type: "deposit", amountTRY: 4000 }],
    (d) => (d === "2026-06-02" ? 50 : 40));
  assert.equal(m.get("2026-06-02"), -100);
  assert.equal(m.get("2026-06-03"), 100);
});

test("mutabik gun: alis nakitten dusmus, piyasaya girmis → acik yok", () => {
  const r = mutabakat({
    snaps: [snap("2026-06-01", 100000, 50000, 50000), snap("2026-06-02", 99925, 70000, 29925)],
    trades: [{ date: "2026-06-02", symbol: "ABC", kind: "buy", shares: 4, buyUSD: 100, feeUSD: 1.5 }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.karne.temiz, true);
  assert.equal(r.gunler[0].ariza, null);
  assert.equal(r.gunler[0].cashAcik, 0);
});

test("deger-acigi: nakit fazladan dusmus, piyasa islemi dogru yansitmis", () => {
  // 6 Tem 2026 vakasinin sadelestirilmisi: alim $400 ama nakitten $800 cikmis.
  const r = mutabakat({
    snaps: [snap("2026-06-01", 100000, 50000, 50000), snap("2026-06-02", 80000, 70000, 10000)],
    trades: [{ date: "2026-06-02", symbol: "ABC", kind: "buy", shares: 4, buyUSD: 100, feeUSD: 0 }],
  });
  const g = r.gunler[0];
  assert.equal(g.ariza, "deger-acigi");
  assert.equal(g.cashAcik, -400);          // (200−1000) − (−400) = −400
  assert.equal(g.imaFiyat, 0);             // piyasa tarafi temiz
  assert.equal(g.sahteGetiri, -0.2);       // −400/2000
  assert.equal(r.karne.acikGun, 1);
  assert.equal(r.karne.bilesikEtkiPuan, -20);
});

test("kayit-uyusmazligi: satis kaydi var ama snapshot'a hic yansimamis", () => {
  // 25 Haz vakasi: $1000 satis kaydi, ne piyasa dustu ne nakit artti.
  const r = mutabakat({
    snaps: [snap("2026-06-01", 100000, 100000, 0), snap("2026-06-02", 100000, 100000, 0)],
    trades: [{ date: "2026-06-02", symbol: "ABC", kind: "sell", shares: 10, sellUSD: 100, feeUSD: 0 }],
  });
  const g = r.gunler[0];
  assert.equal(g.ariza, "kayit-uyusmazligi");
  assert.equal(g.imaFiyat, 0.5);           // +1000/2000 → imkânsız, tavani asiyor
  assert.equal(r.karne.acikGun, 0);        // net deger etkilenmedi
  assert.equal(r.karne.uyusmazGun, 1);
});

test("kayitli akis acik uretmez", () => {
  const r = mutabakat({
    snaps: [snap("2026-06-01", 100000, 50000, 50000), snap("2026-06-02", 90000, 50000, 40000)],
    flows: [{ date: "2026-06-02", type: "withdraw", amountTRY: 10000 }],
  });
  assert.equal(r.karne.temiz, true);
  assert.equal(r.gunler[0].akis, -200);
});

test("esik altindaki gurultu ariza sayilmaz", () => {
  const kucuk = ACIK_ESIGI - 1;
  const r = mutabakat({
    snaps: [snap("2026-06-01", 100000, 50000, 50000), snap("2026-06-02", 100000 - kucuk * 50, 50000, 50000 - kucuk * 50)],
  });
  assert.equal(r.gunler[0].ariza, null);
  assert.equal(r.karne.temiz, true);
});

test("bilesik etki: iki ayri acik gunu carpilarak toplanir", () => {
  const r = mutabakat({
    snaps: [snap("2026-06-01", 100000, 50000, 50000), snap("2026-06-02", 90000, 50000, 40000), snap("2026-06-03", 81000, 50000, 31000)],
  });
  assert.equal(r.karne.acikGun, 2);
  // −%10 ve −%10 → bilesik −%19
  assert.equal(r.karne.bilesikEtkiPuan, -19);
});

test("mutabakatNotu: temiz seride olumlu, acikta alfa payini yazar", () => {
  const temiz = mutabakat({ snaps: [snap("2026-06-01", 100000, 100000, 0), snap("2026-06-02", 110000, 110000, 0)] });
  assert.equal(mutabakatNotu(temiz).ton, "ok");

  const bozuk = mutabakat({
    snaps: [snap("2026-06-01", 100000, 50000, 50000), snap("2026-06-02", 80000, 70000, 10000)],
    trades: [{ date: "2026-06-02", symbol: "ABC", kind: "buy", shares: 4, buyUSD: 100, feeUSD: 0 }],
  });
  const not = mutabakatNotu(bozuk, -25);
  assert.equal(not.ton, "bad");
  assert.match(not.metin, /1 gün/);
  assert.match(not.metin, /%80'i kadar/);  // 20 puan / 25 puan alfa
});

test("iki kayittan az seri olculmez", () => {
  const r = mutabakat({ snaps: [snap("2026-06-01", 100000, 100000, 0)] });
  assert.equal(r.ok, false);
  assert.equal(r.neden, "kayit");
  assert.equal(mutabakatNotu(r), null);
});

/* ---- Yönlü yansıma testleri (28 Ağu) — 29-30 Haz vakası.
 * Satış kaydı var, satış geliri nakde hiç geçmemiş: "para kayboldu" değil,
 * "defter ile anlık görüntü ayrışmış". Yapılacak iş farklı olduğu için etiket de. */

test("satis geliri nakde girmemisse kayit-uyusmazligi (deger-acigi degil)", () => {
  // $200 satis piyasa tarafina yansimis (market −$200) ama nakde hic gecmemis.
  // TL/50: market $1800 → $1600, cash $200 sabit, total $2000 → $1800.
  const r = mutabakat({
    snaps: [snap("2026-06-01", 100000, 90000, 10000), snap("2026-06-02", 90000, 80000, 10000)],
    trades: [{ date: "2026-06-02", symbol: "ABC", kind: "sell", shares: 2, sellUSD: 100, feeUSD: 0 }],
  });
  const g = r.gunler[0];
  assert.equal(g.cashAcik, -200);                // satis $200 nakde girmedi
  assert.ok(Math.abs(g.imaFiyat) <= 0.15);       // ima edilen fiyat hareketi makul → (a) tetiklemez
  assert.equal(g.ariza, "kayit-uyusmazligi");    // (b) yon+hacim tetikledi
  assert.equal(r.karne.acikGun, 0);
});

test("alis nakitten cikmamissa da kayit-uyusmazligi", () => {
  const r = mutabakat({
    snaps: [snap("2026-06-01", 100000, 50000, 50000), snap("2026-06-02", 110000, 60000, 50000)],
    trades: [{ date: "2026-06-02", symbol: "ABC", kind: "buy", shares: 2, buyUSD: 100, feeUSD: 0 }],
  });
  assert.equal(r.gunler[0].cashAcik, 200);       // alis $200 nakitten dusmedi (arti yonlu)
  assert.equal(r.gunler[0].ariza, "kayit-uyusmazligi");
});

test("alis dogru dusmus ama USTUNE nakit kaybolmussa deger-acigi kalir", () => {
  // 6 Tem vakasi: alim nakitten cikti, piyasaya girdi; ayrica $400 karsiliksiz kayip.
  // Acik islemle TERS yonde degil ayni yonde ama alis+eksi acik → yansima sayilmaz.
  const r = mutabakat({
    snaps: [snap("2026-06-01", 100000, 50000, 50000), snap("2026-06-02", 80000, 70000, 10000)],
    trades: [{ date: "2026-06-02", symbol: "ABC", kind: "buy", shares: 4, buyUSD: 100, feeUSD: 0 }],
  });
  assert.equal(r.gunler[0].ariza, "deger-acigi");
  assert.equal(r.karne.acikGun, 1);
});

test("mutabakatNotu: etki alfayi asiyorsa hukmun isareti degisebilir denir", () => {
  const r = mutabakat({
    snaps: [snap("2026-06-01", 100000, 50000, 50000), snap("2026-06-02", 80000, 70000, 10000)],
    trades: [{ date: "2026-06-02", symbol: "ABC", kind: "buy", shares: 4, buyUSD: 100, feeUSD: 0 }],
  });
  assert.match(mutabakatNotu(r, -12).metin, /işareti bile değişebilir/);
  assert.match(mutabakatNotu(r, -40).metin, /%50'i kadar/);
  assert.match(mutabakatNotu(r, -40).metin, /puana kadarı/);   // kesinlik iddia etmez
});
