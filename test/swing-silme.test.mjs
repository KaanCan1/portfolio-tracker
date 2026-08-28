/* GERÇEK modülü import eder. */
import test from "node:test";
import assert from "node:assert/strict";
import { silmeKarari } from "../swing-silme.js";

const lot = [{ pnlUSD: 91.29, shares: 19.75 }];

test("kısmi kâr YOK → doğrudan silinir", () => {
  assert.equal(silmeKarari({ id: "a" }), "sil");
  assert.equal(silmeKarari({ id: "a", realizedLots: [] }), "sil");
});

test("kısmi kâr VAR + arşivde değil → ARŞİVLE (kâr geriye dönük düşmesin)", () => {
  assert.equal(silmeKarari({ id: "a", realizedLots: lot }), "arsivle");
  assert.equal(silmeKarari({ id: "a", realizedLots: lot, archived: false }), "arsivle");
});

test("kısmi kâr VAR + ZATEN arşivde → SİL (ikinci tık bilerektir)", () => {
  assert.equal(silmeKarari({ id: "a", realizedLots: lot, archived: true }), "sil");
});

test("arşivdeki kayıt SONSUZA KADAR silinemez olmamalı — kaçış yolu şart", () => {
  // 20 Ağu'daki hata tam buydu: her tık arşivliyor, kayıt hiç gitmiyordu.
  let kayit = { id: "tem", realizedLots: lot };
  assert.equal(silmeKarari(kayit), "arsivle");
  kayit = { ...kayit, archived: true };          // sunucunun 1. tıkta yaptığı
  assert.equal(silmeKarari(kayit), "sil", "ikinci tık GERÇEKTEN silmeli");
});

test("bozuk/eksik girdi silme kararını çökertmez", () => {
  assert.equal(silmeKarari(undefined), "sil");
  assert.equal(silmeKarari(null), "sil");
  assert.equal(silmeKarari({ realizedLots: "bozuk" }), "sil");
});
