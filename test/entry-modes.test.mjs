/* GERÇEK modülü import eder. En kritik test LOOKAHEAD testidir: gün içi giriş
 * sinyali, girdiği barın close/low/volume'ünü OKUMAMALIDIR — okusaydı backtest
 * geleceği bilerek karar verir ve tüm kıyas yalan olurdu. */
import test from "node:test";
import assert from "node:assert/strict";
import { seansIciGirisSinyali, adrAt, GIRIS_ESIK } from "../entry-modes.js";

const ema = (v, p) => { const k = 2 / (p + 1); let e = null; return v.map((c) => (e = e == null ? c.close : c.close * k + e * (1 - k))); };
const vma = (v, p) => v.map((c, i) => (i < p - 1 ? null : v.slice(i - p + 1, i + 1).reduce((a, b) => a + b.volume, 0) / p));
const seri = (v) => ({ v, ema8: ema(v, 8), ema21: ema(v, 21), ema50: ema(v, 50), vma: vma(v, 20) });

/* Kurulumu gerçekten tetikleyen sentetik seri: uzun yükseliş (priorLeg + trend),
 * sonra EMA8 altına kısa geri çekilme, son barda tetiğe değen bir gün. */
function kurulum({ sonHigh = 200, sonOpen = 180, sonClose = 999, sonLow = -1, sonVol = 1e6 } = {}) {
  const v = [];
  for (let i = 0; i < 80; i++) {                 // yatay taban — 60g zirvesi düşük kalsın
    const px = 100 + i * 0.02;
    v.push({ time: `d${i}`, open: px, high: px * 1.02, low: px * 0.98, close: px, volume: 1e6 });
  }
  for (let i = 0; i < 30; i++) {                 // %60'lık momentum hamlesi (priorLeg ≥ %10)
    const px = 102 + i * 2;
    v.push({ time: `u${i}`, open: px, high: px * 1.03, low: px * 0.97, close: px, volume: 1e6 });
  }
  for (let i = 0; i < 4; i++) {                  // EMA8 altına geri çekilme
    const px = 158 - i * 2;
    v.push({ time: `p${i}`, open: px, high: px * 1.02, low: px * 0.97, close: px, volume: 1e6 });
  }
  v.push({ time: "T", open: sonOpen, high: sonHigh, low: sonLow < 0 ? sonOpen * 0.99 : sonLow, close: sonClose === 999 ? sonOpen : sonClose, volume: sonVol });
  return v;
}

test("adrAt: elle hesapla doğrula (yüzde cinsinden ortalama gün aralığı)", () => {
  const v = [{ high: 11, low: 9, close: 10 }, { high: 22, low: 18, close: 20 }];
  assert.equal(adrAt(v, 1, 2), 20);            // (2/10 + 4/20)/2 = 0.20 → %20
  assert.equal(adrAt([], 0, 2), null);
});

test("kurulum tuttuğunda ve tetiğe değildiğinde sinyal üretir", () => {
  const v = kurulum({ sonHigh: 200 });
  const s = seri(v);
  const g = seansIciGirisSinyali(s, "TEST", v.length - 1);
  assert.ok(g, "kurulum + tetik → sinyal olmalı");
  assert.equal(g.lane, "tech");
  assert.equal(g.seansIci, true);
  assert.ok(g.entry > g.stop, "stop girişin altında olmalı");
  assert.ok(g.adr >= GIRIS_ESIK.adrMin);
});

test("LOOKAHEAD YOK: girilen barın close/low/volume'ü sonucu DEĞİŞTİRMEZ", () => {
  const i = kurulum().length - 1;
  const temiz = seansIciGirisSinyali(seri(kurulum({ sonHigh: 200 })), "TEST", i);
  assert.ok(temiz, "önce temiz kurulumda sinyal olmalı");

  // Aynı gün: fiyat tetiği kesip DİBE çakılıp çok düşük kapansın, hacim sıfırlansın.
  const bozuk = seansIciGirisSinyali(
    seri(kurulum({ sonHigh: 200, sonClose: 1, sonLow: 1, sonVol: 1 })), "TEST", i);
  assert.ok(bozuk, "kapanış çöktü diye sinyal kaybolamaz — dolum zaten gün içinde oldu");
  assert.equal(bozuk.entry, temiz.entry, "giriş fiyatı kapanıştan ETKİLENMEMELİ");
  assert.equal(bozuk.stop, temiz.stop, "stop günün dibinden ETKİLENMEMELİ");
  assert.equal(bozuk.volRatio, temiz.volRatio, "hacim oranı DÜNKÜ hacimden gelmeli");
});

test("tetiğe değilmezse emir dolmaz", () => {
  const v = kurulum({ sonHigh: 100 });          // gün boyu EMA8'in çok altında
  assert.equal(seansIciGirisSinyali(seri(v), "TEST", v.length - 1), null);
});

test("boşlukla açarsa dolum AÇILIŞTA olur (tetikte değil)", () => {
  const v = kurulum({ sonHigh: 400, sonOpen: 350 });
  const g = seansIciGirisSinyali(seri(v), "TEST", v.length - 1);
  assert.ok(g);
  assert.equal(g.entry, 350, "stop emri boşluklu açılışta doldu");
  assert.equal(g.bosluklaDoldu, true);
  assert.ok(g.entry > g.tetik, "dolum tetiğin üstünde — bu gün içi girişin gerçek maliyeti");
});

test("dün zaten EMA8 ÜSTÜNDE kapandıysa kırılım taze değil → sinyal yok", () => {
  const v = kurulum();
  v[v.length - 2].close = 500;                  // dünü EMA8'in çok üstüne taşı
  assert.equal(seansIciGirisSinyali(seri(v), "TEST", v.length - 1), null);
});

test("momentum hamlesi (priorLeg) yoksa sinyal yok", () => {
  const v = kurulum();
  for (let i = 80; i < 110; i++) v[i].close = 102;   // hamleyi düzleştir
  assert.equal(seansIciGirisSinyali(seri(v), "TEST", v.length - 1), null);
});

test("kısa seride güvenle null döner", () => {
  assert.equal(seansIciGirisSinyali(seri(kurulum().slice(-10)), "TEST", 9), null);
  assert.equal(seansIciGirisSinyali(null, "TEST", 100), null);
});
