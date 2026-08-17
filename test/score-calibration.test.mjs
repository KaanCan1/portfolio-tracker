/* GERÇEK modülü import eder. */
import test from "node:test";
import assert from "node:assert/strict";
import { KALIBRE, kanitOzeti, kalibreSkor } from "../score-calibration.js";

const kayit = (o) => ({ status: "stop", r: -1, signalDate: "2026-07-21", ...o });

test("kanitOzeti: kapanmış + açık (mtmR) birlikte sayılır", () => {
  const k = kanitOzeti([
    kayit({ status: "target", r: 2, signalDate: "2026-06-10" }),
    kayit({ status: "stop", r: -1, signalDate: "2026-06-10" }),
    kayit({ status: "open", r: undefined, mtmR: 0.5, signalDate: "2026-07-01" }),
  ]);
  assert.equal(k.n, 3, "açık pozisyon da beklentiye girer");
  assert.equal(k.kapaliN, 2);
  assert.equal(k.acikN, 1);
  assert.equal(k.gun, 2, "ilk iki kayıt AYNI günden — bir gün sayılır");
  assert.equal(k.isabet, 50, "isabet YALNIZ kapananlardan (açığın sonucu belli değil)");
  assert.ok(Math.abs(k.ortR - 0.5) < 1e-9);
});

test("kanitOzeti: bekleyen/süresi dolan kayıtlar sayılmaz", () => {
  const k = kanitOzeti([kayit({ status: "waiting", r: undefined }), kayit({ status: "expired", r: undefined })]);
  assert.equal(k.n, 0);
  assert.equal(k.ortR, null);
});

test("kanitOzeti: mtmR'si olmayan açık kayıt beklentiyi kirletmez", () => {
  const k = kanitOzeti([kayit({ status: "open", r: undefined, mtmR: undefined })]);
  assert.equal(k.n, 0, "ölçülmemiş açık pozisyon sayılamaz");
});

test("kanıt yoksa skor DEĞİŞMEZ ama etiketi dürüsttür", () => {
  const s = kalibreSkor(100, null);
  assert.equal(s.skor, 100);
  assert.equal(s.carpan, 1);
  assert.equal(s.durum, "olculmedi");
  assert.match(s.etiket, /ölçülmedi/);
});

/* Asıl vaka: kart 100 yazarken ölçüm −0.81R diyordu. */
test("olumsuz ölçüm skoru AŞAĞI çeker", () => {
  const s = kalibreSkor(100, { n: 32, gun: 10, ortR: -0.81, isabet: 6 });
  assert.ok(s.skor < 100, `100 kalmamalıydı, ${s.skor}`);
  assert.ok(s.skor > 0);
  assert.equal(s.durum, "olumsuz-kanit");
  assert.match(s.etiket, /-0\.81R/);
});

test("olumlu ölçüm skoru yukarı çeker ama 100'ü aşamaz", () => {
  const s = kalibreSkor(90, { n: 40, gun: 25, ortR: 0.6, isabet: 55 });
  assert.ok(s.skor > 90);
  assert.ok(s.skor <= 100);
  assert.equal(s.durum, "kanitli");
});

/* Ölçümün en pahalı dersi: aynı gün açılan sinyaller bağımsız gözlem değildir. */
test("çok işlem AZ GÜN → güven düşük kalır (küme tuzağı)", () => {
  const cokGun = kalibreSkor(100, { n: 60, gun: 40, ortR: -0.5 });
  const azGun = kalibreSkor(100, { n: 60, gun: 2, ortR: -0.5 });
  assert.ok(azGun.guven < cokGun.guven / 2,
    `2 günden gelen 60 işlem, 40 günden gelenle aynı güveni almamalı (${azGun.guven} vs ${cokGun.guven})`);
  assert.ok(azGun.skor > cokGun.skor, "güven düşükse düzeltme de küçük olmalı");
});

test("zayıf kanıt 'ölçüm yetersiz' olarak işaretlenir", () => {
  const s = kalibreSkor(80, { n: 4, gun: 2, ortR: -0.9 });
  assert.equal(s.durum, "zayif-kanit");
  assert.match(s.etiket, /yetersiz/);
  assert.ok(s.skor > 70, "zayıf kanıtla skor sert düşmemeli");
});

test("uç beklenti çarpanı uçurmaz (±1R tavanı)", () => {
  const uc = kalibreSkor(100, { n: 200, gun: 200, ortR: -8 });
  assert.ok(uc.skor >= 0);
  const uc2 = kalibreSkor(50, { n: 200, gun: 200, ortR: 12 });
  assert.ok(uc2.skor <= 100);
  assert.ok(uc2.carpan <= 1 + KALIBRE.rTavan);
});

test("ham skor 0-100'e BURADA kırpılır (önce kırpılırsa düzeltme kaybolur)", () => {
  const s = kalibreSkor(124, { n: 30, gun: 12, ortR: -0.3 });
  assert.ok(s.skor <= 100);
  const bozuk = kalibreSkor(NaN, null);
  assert.equal(bozuk.skor, 0, "bozuk giriş çökertmemeli");
});
