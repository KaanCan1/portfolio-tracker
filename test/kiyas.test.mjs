/* GERÇEK modülü import eder. */
import test from "node:test";
import assert from "node:assert/strict";
import { gunlukGetiriler, adimMaskesi, twrZincir, seriMetrik, betaR2, yakalama, kiyasHesapla, kiyasHukum } from "../kiyas.js";

const yakin = (a, b, eps = 1e-9, m = "") => assert.ok(Math.abs(a - b) < eps, `${m} ${a} ≈ ${b} değil`);

/* Gün üretici: 2026-06-01'den itibaren ardışık takvim günleri. */
const gun = (i) => new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10);
const snapDizi = (degerler, kur = 40) => degerler.map((v, i) => ({ date: gun(i), total: v * kur, usdtry: kur }));
const bar = (degerler) => degerler.map((c, i) => ({ date: gun(i), close: c }));

test("twrZincir: akış yoksa düz oransal büyüme", () => {
  const z = twrZincir([100, 110, 121]);
  yakin(z[2], 1.21, 1e-12);
});

test("twrZincir: PARA GİRİŞİ getiri sayılmaz (PR #51'in hatası)", () => {
  // 100 → 200 ama 100'ü yatırılan para: gerçek getiri sıfır.
  const ham = 200 / 100 - 1;
  const z = twrZincir([100, 200], [0, 100]);
  yakin(z[1], 1, 1e-12, "TWR");
  assert.ok(ham > 0.9, "ham hesap %100 derdi — düzeltmenin ölçtüğü fark bu");
});

test("twrZincir: para ÇEKİLİŞİ de bozmaz", () => {
  const z = twrZincir([100, 50], [0, -50]);   // yarısını çektin, fiyat oynamadı
  yakin(z[1], 1, 1e-12);
});

test("seriMetrik: maks düşüş, en kötü/iyi gün ve pozitif oran", () => {
  const m = seriMetrik([100, 110, 88, 99]);
  yakin(m.getiri, -0.01, 1e-12);
  yakin(m.maxDD, 88 / 110 - 1, 1e-12);
  yakin(m.enKotuGun, 88 / 110 - 1, 1e-12);
  yakin(m.enIyiGun, 99 / 88 - 1, 1e-12);
  yakin(m.pozitifOran, 2 / 3, 1e-12);
  assert.equal(m.n, 3);
});

test("seriMetrik: sabit seri — volatilite 0, Sharpe tanımsız (0'a bölme yok)", () => {
  const m = seriMetrik([100, 100, 100, 100]);
  assert.equal(m.sharpe, null);
  assert.equal(m.yillikVol, null);
  yakin(m.getiri, 0, 1e-12);
});

test("betaR2: seri endeksin tam 2 katıysa beta 2, R² 1", () => {
  const rq = Array.from({ length: 40 }, (_, i) => Math.sin(i) / 100);
  const rp = rq.map((x) => x * 2);
  const { beta, r2 } = betaR2(rp, rq);
  yakin(beta, 2, 1e-9, "beta");
  yakin(r2, 1, 1e-9, "R²");
});

test("betaR2: 20 günden az veriyle ölçmez (uydurma beta basmaz)", () => {
  const r = Array.from({ length: 15 }, (_, i) => i / 1000);
  assert.equal(betaR2(r, r).beta, null);
});

test("betaR2: ilgisiz seride R² düşük çıkar — beta yorumlanamaz", () => {
  const rq = Array.from({ length: 60 }, (_, i) => Math.sin(i) / 100);
  const rp = Array.from({ length: 60 }, (_, i) => Math.cos(i * 3.7) / 100);
  const { r2 } = betaR2(rp, rq);
  assert.ok(r2 < 0.3, `R² ${r2} — 0,30 altında beklenirdi`);
});

test("yakalama: yukarıda endeksin 2 katı, aşağıda yarısı", () => {
  const rq = [0.01, -0.01, 0.02, -0.02, 0.01, -0.01, 0.03, -0.03, 0.01, -0.01];
  const rp = rq.map((x) => (x > 0 ? x * 2 : x * 0.5));
  const y = yakalama(rp, rq);
  yakin(y.yukari, 2, 1e-9);
  yakin(y.asagi, 0.5, 1e-9);
  assert.equal(y.yukariN, 5);
});

test("yakalama: 5'ten az gözlem varsa oran verilmez", () => {
  const rq = [0.01, 0.02, -0.01];
  assert.equal(yakalama(rq, rq).yukari, null);
});

test("kiyasHesapla: yetersiz kayıtta ölçüm yapmaz, nedenini söyler", () => {
  const s = kiyasHesapla({ snaps: snapDizi([100, 101, 102]), endeksler: { QQQ: bar([10, 10, 10]) } });
  assert.equal(s.ok, false);
  assert.equal(s.neden, "kayit");
});

test("kiyasHesapla: endeks barı olmayan günler pencereye girmez", () => {
  const snaps = snapDizi(Array.from({ length: 20 }, (_, i) => 100 + i));
  // yalnız 12 günün barı var
  const kismi = bar(Array.from({ length: 20 }, (_, i) => 10 + i)).slice(0, 12);
  const s = kiyasHesapla({ snaps, endeksler: { QQQ: kismi } });
  assert.equal(s.ok, true);
  assert.equal(s.n, 12, "ortak gün sayısı endeksle sınırlı");
  assert.equal(s.d1, gun(11));
});

test("kiyasHesapla: alfa = portföy − endeks, aynı pencerede", () => {
  const snaps = snapDizi(Array.from({ length: 30 }, (_, i) => 100 * 1.01 ** i));   // günde %1
  const q = bar(Array.from({ length: 30 }, (_, i) => 50 * 1.005 ** i));            // günde %0,5
  const s = kiyasHesapla({ snaps, endeksler: { QQQ: q } });
  yakin(s.portfoy.getiri, 1.01 ** 29 - 1, 1e-9);
  yakin(s.endeks.QQQ.getiri, 1.005 ** 29 - 1, 1e-9);
  yakin(s.endeks.QQQ.alfa, s.portfoy.getiri - s.endeks.QQQ.getiri, 1e-12);
});

test("kiyasHesapla: yatırılan para alfayı şişirmez", () => {
  // Fiyat hiç oynamıyor; 15. gün hesaba para giriyor. Gerçek getiri 0 olmalı.
  const degerler = Array.from({ length: 30 }, (_, i) => (i < 15 ? 100 : 200));
  const snaps = snapDizi(degerler);
  const flows = [{ date: gun(15), type: "deposit", amountTRY: 100 * 40 }];
  const s = kiyasHesapla({ snaps, flows, endeksler: { QQQ: bar(Array(30).fill(50)) } });
  yakin(s.portfoy.getiri, 0, 1e-9, "portföy getirisi");
  yakin(s.endeks.QQQ.alfa, 0, 1e-9, "alfa");
  assert.equal(s.akisN, 1, "arındırılan akış sayılır");
});

test("kiyasHesapla: borsa tatiline denk gelen akış atılmaz, sonraki güne taşınır", () => {
  const degerler = Array.from({ length: 30 }, (_, i) => (i < 15 ? 100 : 200));
  const snaps = snapDizi(degerler);
  // Endeks 14. günü atlıyor → o gün ortak değil; akış da o güne yazılmış
  const barlar = bar(Array(30).fill(50)).filter((_, i) => i !== 14);
  const flows = [{ date: gun(14), type: "deposit", amountTRY: 100 * 40 }];
  const s = kiyasHesapla({ snaps, flows, endeksler: { QQQ: barlar } });
  yakin(s.portfoy.getiri, 0, 1e-9, "taşınmayan akış %100 getiri gibi görünürdü");
});

test("kiyasHesapla: aynı güne iki kayıt varsa sonuncusu geçerli", () => {
  const snaps = [...snapDizi(Array.from({ length: 20 }, () => 100)), { date: gun(19), total: 150 * 40, usdtry: 40 }];
  const s = kiyasHesapla({ snaps, endeksler: { QQQ: bar(Array(20).fill(50)) } });
  assert.equal(s.n, 20);
  yakin(s.portfoy.getiri, 0.5, 1e-9);
});

test("kiyasHesapla: birden çok endeks aynı ortak takvimi paylaşır", () => {
  const snaps = snapDizi(Array.from({ length: 25 }, (_, i) => 100 + i));
  const s = kiyasHesapla({
    snaps,
    endeksler: { QQQ: bar(Array.from({ length: 25 }, (_, i) => 50 + i)), SPY: bar(Array.from({ length: 22 }, (_, i) => 30 + i)) },
  });
  assert.equal(s.n, 22, "en kısa endeks pencereyi belirler");
  assert.equal(s.endeks.QQQ.n, s.endeks.SPY.n, "iki endeks aynı günleri ölçer");
});

test("kiyasHukum: endeksin gerisindeysen hüküm 'bad'", () => {
  const snaps = snapDizi(Array.from({ length: 30 }, (_, i) => 100 * 1.001 ** i));
  const s = kiyasHesapla({ snaps, endeksler: { QQQ: bar(Array.from({ length: 30 }, (_, i) => 50 * 1.01 ** i)) } });
  assert.equal(kiyasHukum(s, "QQQ").ton, "bad");
});

test("kiyasHukum: kazandın ama düşüşün 1,5 katıysa zafer rengi verilmez", () => {
  // Portföy sonda öne geçiyor ama arada endeksten çok daha derin çukura giriyor
  const p = [100, 60, 70, 90, 110, 130, 150, 170, 190, 210, 230];
  const q = [100, 95, 97, 99, 101, 103, 105, 107, 109, 111, 113];
  const s = kiyasHesapla({ snaps: snapDizi(p), endeksler: { QQQ: bar(q) }, minGun: 10 });
  const h = kiyasHukum(s, "QQQ");
  assert.equal(h.ton, "warn");
  assert.ok(h.kat >= 1.5);
});

test("kiyasHukum: kazandın ve düşüşün endeksten fazla değilse 'ok'", () => {
  const p = Array.from({ length: 20 }, (_, i) => 100 * 1.01 ** i);
  const q = Array.from({ length: 20 }, (_, i) => 100 * 1.004 ** i);
  const h = kiyasHukum(kiyasHesapla({ snaps: snapDizi(p), endeksler: { QQQ: bar(q) } }), "QQQ");
  assert.equal(h.ton, "ok");
});

/* ===== Boşluk maskesi: seyrek kayıt günlük istatistiği bozmasın ===== */

test("adimMaskesi: hafta sonu geçerli, uzun boşluk değil", () => {
  const m = adimMaskesi(["2026-08-07", "2026-08-10", "2026-08-11", "2026-09-15"]);
  assert.deepEqual(m, [false, true, true, false], "3 günlük hafta sonu geçer, 35 gün geçmez");
});

test("adimMaskesi: aynı gün tekrarı adım sayılmaz", () => {
  assert.deepEqual(adimMaskesi(["2026-08-10", "2026-08-10"]), [false, false]);
});

test("gunlukGetiriler: maskeli adım atlanır", () => {
  const r = gunlukGetiriler([100, 110, 220, 231], [false, true, false, true]);
  assert.equal(r.length, 2, "2× sıçrama günlük getiri sayılmaz");
  yakin(r[0], 0.1, 1e-12);
  yakin(r[1], 0.05, 1e-12);
});

test("seriMetrik: birikimli getiri boşluğu İÇERİR, volatilite içermez", () => {
  const z = [100, 110, 220, 231];                  // ortadaki adım 30 günlük sıçrama
  const maske = [false, true, false, true];
  const m = seriMetrik(z, maske);
  yakin(m.getiri, 1.31, 1e-12, "birikimli getiri tüm zincirden");
  assert.equal(m.n, 2, "istatistik yalnız gerçek günlerden");
  assert.ok(m.enIyiGun < 0.11, "sıçrama 'en iyi gün' olarak basılmaz");
});

test("kiyasHesapla: 2026 Mart vakası — seyrek kayıt yıllık volatiliteyi şişirmez", () => {
  // 30 günlük boşlukla başlayan, sonrası günlük olan bir defter
  const seyrek = [{ d: "2026-03-02", v: 100 }, { d: "2026-04-01", v: 160 }];
  const gunluk = Array.from({ length: 25 }, (_, i) => ({ d: gun(i + 40), v: 160 * 1.002 ** i }));
  const hepsi = [...seyrek, ...gunluk];
  const snaps = hepsi.map((x) => ({ date: x.d, total: x.v * 40, usdtry: 40 }));
  const bars = hepsi.map((x) => ({ date: x.d, close: 50 }));
  const s = kiyasHesapla({ snaps, endeksler: { QQQ: bars } });
  assert.equal(s.ok, true);
  assert.equal(s.atlanan, 2, "Mart→Nisan ve Nisan→gündelik başlangıcı atlanır");
  assert.equal(s.gunlukN, 24);
  yakin(s.portfoy.getiri, (160 * 1.002 ** 24) / 100 - 1, 1e-9, "birikimli getiri %60'lık sıçramayı sayar");
  assert.ok(s.portfoy.yillikVol < 0.1, `yıllık vol ${s.portfoy.yillikVol} — sıçrama sızmış`);
});

/* ===== Ölçüm tabanı: geriye doldurulmuş kayıtlar pencereye girmez ===== */

test("kiyasHesapla: baslangic'ten önceki kayıtlar hiç ölçülmez", () => {
  const hepsi = Array.from({ length: 40 }, (_, i) => ({ d: gun(i), v: 100 + i }));
  const snaps = hepsi.map((x) => ({ date: x.d, total: x.v * 40, usdtry: 40 }));
  const bars = hepsi.map((x) => ({ date: x.d, close: 50 }));
  const s = kiyasHesapla({ snaps, endeksler: { QQQ: bars }, baslangic: gun(20) });
  assert.equal(s.n, 20);
  assert.equal(s.d0, gun(20));
  assert.equal(s.baslangic, gun(20));
  yakin(s.portfoy.getiri, 139 / 120 - 1, 1e-9, "getiri yalnız pencereden");
});

test("kiyasHesapla: 16 Ağu vakası — backfill dışarı alınınca hüküm dönebilir", () => {
  // Sahte tırmanış (backfill), sonra gerçek kayıtlarda düşüş; endeks yatay.
  const backfill = Array.from({ length: 20 }, (_, i) => 100 * 1.05 ** i);
  const gercek = Array.from({ length: 25 }, (_, i) => backfill[19] * 0.995 ** i);
  const snaps = [...backfill, ...gercek].map((v, i) => ({ date: gun(i), total: v * 40, usdtry: 40 }));
  const bars = snaps.map((x) => ({ date: x.date, close: 50 }));
  const hepsiyle = kiyasHesapla({ snaps, endeksler: { QQQ: bars } });
  const gercekle = kiyasHesapla({ snaps, endeksler: { QQQ: bars }, baslangic: gun(20) });
  assert.equal(kiyasHukum(hepsiyle, "QQQ").ton, "ok", "backfill dahil: kazanmış görünür");
  assert.equal(kiyasHukum(gercekle, "QQQ").ton, "bad", "backfill hariç: geride");
});

test("kiyasHesapla: baslangic pencereyi minGun altına düşürürse ölçmez", () => {
  const snaps = snapDizi(Array.from({ length: 30 }, (_, i) => 100 + i));
  const s = kiyasHesapla({ snaps, endeksler: { QQQ: bar(Array(30).fill(50)) }, baslangic: gun(25) });
  assert.equal(s.ok, false);
  assert.equal(s.neden, "kayit");
});

test("kiyasHesapla: gunluk dizisi maskeden geçmiş getirileri taşır (risk karnesi bunu kullanır)", () => {
  const snaps = snapDizi(Array.from({ length: 25 }, (_, i) => 100 * 1.01 ** i));
  const s = kiyasHesapla({ snaps, endeksler: { QQQ: bar(Array(25).fill(50)) } });
  assert.equal(s.portfoy.gunluk.length, s.portfoy.n, "gunluk ile istatistiğin n'i aynı seri");
  yakin(s.portfoy.gunluk[0], 0.01, 1e-9);
});
