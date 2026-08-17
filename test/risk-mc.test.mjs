import test from "node:test";
import assert from "node:assert/strict";
import {
  gunlukGetiri, hizala, kovaryansMatrisi, korelasyonMatrisi, cholesky, bagimsizL,
  normalUretici, mcPortfoyGetirileri, varCvar, portfoySerisi, stdSapma, ihlalTesti,
} from "../risk-mc.js";

const mum = (time, close) => ({ time, close });

test("gunlukGetiri: n mumdan n−1 getiri, ilk bar getiri üretmez", () => {
  const g = gunlukGetiri([mum("2026-01-01", 100), mum("2026-01-02", 110), mum("2026-01-03", 99)]);
  assert.equal(g.length, 2);
  assert.ok(Math.abs(g[0].r - 0.1) < 1e-12);
  assert.ok(Math.abs(g[1].r - (-0.1)) < 1e-12);
});

test("hizala: yalnız ORTAK tarihleri alır — eksik gün farklı günleri eşleştirmez", () => {
  const a = [mum("01", 100), mum("02", 101), mum("03", 102), mum("04", 103)];
  const b = [mum("01", 50), mum("02", 51), mum("04", 53)];   // 03 eksik
  const { tarihler, R } = hizala({ A: a, B: b });
  // A: 02,03,04 · B: 02,04 → kesişim 02 ve 04
  assert.deepEqual(tarihler, ["02", "04"]);
  assert.equal(R[0].length, 2);
  assert.equal(R[1].length, 2);
});

test("cholesky: L·Lᵀ girdiyi geri verir", () => {
  const S = [[4, 2, 0.6], [2, 3, 0.5], [0.6, 0.5, 1]];
  const { L } = cholesky(S);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let s = 0;
    for (let k = 0; k < 3; k++) s += L[i][k] * L[j][k];
    assert.ok(Math.abs(s - S[i][j]) < 1e-10, `L·Lᵀ[${i}][${j}] ${s} ≠ ${S[i][j]}`);
  }
  assert.equal(L[0][1], 0, "L alt üçgen olmalı");
});

test("cholesky: tekil matriste jitter devreye girer, NaN üretmez", () => {
  // iki varlık birebir aynı hareket ediyor → matris tekil
  const S = [[0.0004, 0.0004], [0.0004, 0.0004]];
  const { L, jitter } = cholesky(S);
  assert.ok(jitter > 0, "jitter uygulanmalıydı");
  assert.ok(L.flat().every(Number.isFinite), "L NaN içeriyor");
});

test("cholesky: gerçekten negatif-tanımlı matris sessizce geçmez, hata atar", () => {
  assert.throws(() => cholesky([[1, 2], [2, 1]]), /pozitif-tanımlı/);
});

test("kovaryans + korelasyon: bilinen ilişkiyi geri okur", () => {
  const rnd = normalUretici(7);
  const n = 4000;
  const x = [], y = [];
  for (let i = 0; i < n; i++) {
    const z1 = rnd(), z2 = rnd();
    x.push(z1);
    y.push(0.8 * z1 + Math.sqrt(1 - 0.64) * z2);   // teorik ρ = 0,8
  }
  const C = korelasyonMatrisi(kovaryansMatrisi([x, y]));
  assert.ok(Math.abs(C[0][1] - 0.8) < 0.03, `ρ ${C[0][1]}`);
  assert.ok(Math.abs(C[0][0] - 1) < 1e-12);
});

test("MC korelasyonlu model, girdideki kovaryansı üretir (σ_p = √(wᵀΣw))", () => {
  const S = [[0.0004, 0.00024], [0.00024, 0.0009]];   // σ %2 ve %3, ρ = 0,4
  const w = [0.5, 0.5];
  const { L } = cholesky(S);
  const sim = mcPortfoyGetirileri({ L, agirliklar: w, iter: 200_000, tohum: 11 });
  let analitik = 0;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) analitik += w[i] * w[j] * S[i][j];
  analitik = Math.sqrt(analitik);
  const olculen = stdSapma(Array.from(sim));
  assert.ok(Math.abs(olculen / analitik - 1) < 0.02, `MC σ ${olculen} ≠ analitik ${analitik}`);
});

test("bağımsız model: aynı marjinal σ, daha DÜŞÜK portföy riski", () => {
  const S = [[0.0004, 0.00024], [0.00024, 0.0009]];
  const w = [0.5, 0.5];
  const kor = mcPortfoyGetirileri({ L: cholesky(S).L, agirliklar: w, iter: 100_000, tohum: 3 });
  const bag = mcPortfoyGetirileri({ L: bagimsizL(S), agirliklar: w, iter: 100_000, tohum: 3 });
  // köşegen aynı → tek tek volatiliteler aynı
  assert.ok(Math.abs(bagimsizL(S)[0][0] - Math.sqrt(S[0][0])) < 1e-15);
  assert.ok(varCvar(bag).varOran < varCvar(kor).varOran, "pozitif korelasyonda bağımsız model riski AZ göstermeli");
});

test("varCvar: CVaR her zaman VaR'dan büyük, ikisi de pozitif kayıp", () => {
  const { varOran, cvarOran } = varCvar(mcPortfoyGetirileri({
    L: cholesky([[0.0004, 0], [0, 0.0004]]).L, agirliklar: [0.5, 0.5], iter: 50_000, tohum: 5,
  }));
  assert.ok(varOran > 0 && cvarOran > varOran, `VaR ${varOran} CVaR ${cvarOran}`);
});

test("aynı tohum aynı sayıyı verir (ölçüm tekrarlanabilir)", () => {
  const cfg = { L: cholesky([[0.0004, 0.0001], [0.0001, 0.0004]]).L, agirliklar: [0.6, 0.4], iter: 10_000 };
  const a = varCvar(mcPortfoyGetirileri({ ...cfg, tohum: 99 })).varOran;
  const b = varCvar(mcPortfoyGetirileri({ ...cfg, tohum: 99 })).varOran;
  assert.equal(a, b);
});

test("portfoySerisi: ağırlıklı toplam", () => {
  const R = [[0.1, -0.2], [0.3, 0.4]];
  assert.deepEqual(portfoySerisi(R, [0.5, 0.5]).map((x) => +x.toFixed(10)), [0.2, 0.1]);
});

test("ihlalTesti: doğru kalibre modelde ihlal ~beklenen, reddedilmez", () => {
  // %95 eşiği tam %5 sıklıkla delinen yapay seri
  const N = 400, esik = new Array(N).fill(0.02);
  const gercek = Array.from({ length: N }, (_, i) => (i % 20 === 0 ? -0.03 : -0.001));
  const r = ihlalTesti(gercek, esik);
  assert.equal(r.ihlal, 20);
  assert.ok(Math.abs(r.beklenen - 20) < 1e-9);
  assert.equal(r.reddedildi, false);
});

test("ihlalTesti: riski az gösteren model reddedilir + seri uzunluğu raporlanır", () => {
  const N = 200, esik = new Array(N).fill(0.01);
  const gercek = Array.from({ length: N }, (_, i) => (i < 40 ? -0.05 : -0.001));  // 40 ihlal, hepsi ardışık
  const r = ihlalTesti(gercek, esik);
  assert.equal(r.ihlal, 40);
  assert.equal(r.enUzunSeri, 40, "kümelenme görünür olmalı");
  assert.equal(r.reddedildi, true);
});
