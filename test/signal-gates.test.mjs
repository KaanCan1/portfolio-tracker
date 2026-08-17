/* GERÇEK modülü import eder. */
import test from "node:test";
import assert from "node:assert/strict";
import { KAPI, oynaklikPct, getiriPct, goreliGuc, kurulumKapisi } from "../signal-gates.js";

const seri = (baslangic, adet, artisPct) =>
  Array.from({ length: adet }, (_, i) => baslangic * (1 + (artisPct / 100) * (i / (adet - 1))));

test("oynaklikPct: ATR fiyatın yüzdesi olarak", () => {
  assert.ok(Math.abs(oynaklikPct(7, 100) - 7) < 1e-9);
  assert.equal(oynaklikPct(6.8, 224.76).toFixed(2), "3.03");
  assert.equal(oynaklikPct(null, 100), null);
  assert.equal(oynaklikPct(5, 0), null, "sıfır fiyat null olmalı");
  assert.equal(oynaklikPct(NaN, 100), null);
});

test("getiriPct: n gün önceye göre; seri kısaysa null", () => {
  assert.equal(getiriPct([100, 110], 1).toFixed(1), "10.0");
  assert.equal(getiriPct([100, 110], 5), null, "yetersiz veri null");
  assert.equal(getiriPct(null, 5), null);
  assert.equal(getiriPct([0, 50], 1), null, "sıfır tabana bölme null");
});

test("goreliGuc: hisse − endeks farkı puan olarak", () => {
  const hisse = seri(100, 61, 20);    // 60 günde +%20
  const endeks = seri(100, 61, 5);    // 60 günde +%5
  const fark = goreliGuc(hisse, endeks, 60);
  assert.ok(fark > 14 && fark < 16, `~15 puan bekleniyordu, ${fark} geldi`);
  assert.equal(goreliGuc(hisse, [1, 2], 60), null, "endeks serisi kısaysa null");
});

test("oynaklık kapısı: eşiğin üstü reddedilir, altı geçer", () => {
  const red = kurulumKapisi({ atrPct: 12 });
  assert.equal(red.gecti, false);
  assert.equal(red.kapi, "oynaklik");
  assert.match(red.sebep, /Çok oynak/);

  assert.equal(kurulumKapisi({ atrPct: 3 }).gecti, true);
  assert.equal(kurulumKapisi({ atrPct: KAPI.atrTavanPct }).gecti, true, "tam eşikte geçmeli");
});

test("göreli güç kapısı: endeksin gerisi reddedilir", () => {
  const red = kurulumKapisi({ rsFark: -4.2 });
  assert.equal(red.gecti, false);
  assert.equal(red.kapi, "goreli-guc");
  assert.match(red.sebep, /Endeksin gerisinde/);

  assert.equal(kurulumKapisi({ rsFark: 0 }).gecti, true, "tam eşikte geçmeli");
  assert.equal(kurulumKapisi({ rsFark: 8 }).gecti, true);
});

/* FAIL-OPEN: veri yoksa sinyal SUSMAZ. Bir gün QQQ mumları gelmezse tüm evrenin
 * sessizce kapanması, yanlış sinyalden daha kötüdür — sessizlik fark edilmez. */
test("veri yoksa kapı uygulanmaz (fail-open)", () => {
  assert.equal(kurulumKapisi({}).gecti, true);
  assert.equal(kurulumKapisi({ atrPct: null, rsFark: null }).gecti, true);
  assert.equal(kurulumKapisi().gecti, true);
  assert.equal(kurulumKapisi({ atrPct: null, rsFark: 5 }).gecti, true, "yalnız RS varsa o uygulanır");
});

test("oynaklık kapısı önce çalışır (daha güçlü kanıt olan eleme)", () => {
  const r = kurulumKapisi({ atrPct: 15, rsFark: -10 });
  assert.equal(r.kapi, "oynaklik");
});

test("eşikler dışarıdan verilebilir (deney ayarı tek yerden)", () => {
  assert.equal(kurulumKapisi({ atrPct: 12 }, { ...KAPI, atrTavanPct: 20 }).gecti, true);
  assert.equal(kurulumKapisi({ rsFark: 3 }, { ...KAPI, rsMinFark: 5 }).gecti, false);
});
