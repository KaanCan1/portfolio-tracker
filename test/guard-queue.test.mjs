/* GERÇEK modülü import eder. Bu senaryolar daha önce .shots/ altında,
 * mantığı KOPYALAYARAK koşuyordu; çıkarma işinden sonra kopya gerekmiyor. */
import test from "node:test";
import assert from "node:assert/strict";
import { kuyrukKarari } from "../guard-queue.js";

const W = (sym) => ({ sev: "warn", sym, title: "yoğunlaşma" });
const C = (sym) => ({ sev: "crit", sym, title: "stop delindi" });
const BOS = { items: [], lastFlush: null };
const DIGEST = 17;

const cagir = (o) => kuyrukKarari({ digestSaat: DIGEST, maxGun: 2, ...o });

test("sabah warn → mail YOK, kuyrukta bekler", () => {
  const r = cagir({ alerts: [W("NBIS")], durum: BOS, bugun: "2026-08-03", saat: "10:00", utcSaat: 10 });
  assert.equal(r.mailSayisi, 0);
  assert.equal(r.durum.items.length, 1);
  assert.equal(r.gonderilecek, null);
});

test("ACİL anında gider ve kuyruğu da bindirir", () => {
  const once = cagir({ alerts: [W("NBIS")], durum: BOS, bugun: "2026-08-03", saat: "10:00", utcSaat: 10 });
  const r = cagir({ alerts: [C("MU")], durum: once.durum, bugun: "2026-08-03", saat: "15:30", utcSaat: 15 });
  assert.equal(r.mailSayisi, 1);
  assert.equal(r.gonderilecek.length, 2, "acil + bekleyen birlikte gitmeli");
  assert.equal(r.gonderilecek[0].sev, "crit", "acil başta");
  assert.equal(r.gonderilecek[1].at, "10:00", "bekleyenin saati korunmalı");
  assert.equal(r.durum.items.length, 0, "kuyruk boşalmalı");
  assert.equal(r.durum.lastFlush, "2026-08-03");
});

test("acil sonrası gelen warn → aynı gün BİR DAHA mail yok", () => {
  const durum = { items: [], lastFlush: "2026-08-03" };
  const r = cagir({ alerts: [W("AMD")], durum, bugun: "2026-08-03", saat: "18:00", utcSaat: 21 });
  assert.equal(r.mailSayisi, 0, "lastFlush bugün → tekrar gönderilmemeli");
  assert.equal(r.durum.items.length, 1);
});

test("ertesi gün boşaltma saatinde biriken gider", () => {
  const durum = { items: [{ day: "2026-08-03", at: "18:00", alert: W("AMD") }], lastFlush: "2026-08-03" };
  const r = cagir({ alerts: [], durum, bugun: "2026-08-04", saat: "20:05", utcSaat: 17 });
  assert.equal(r.mailSayisi, 1);
  assert.equal(r.gonderilecek[0].sym, "AMD", "dünkü bulgu taşınmalı");
});

test("boşaltma saatinden ÖNCE warn beklemeye devam eder", () => {
  const r = cagir({ alerts: [W("SOFI")], durum: BOS, bugun: "2026-08-05", saat: "12:00", utcSaat: 12 });
  assert.equal(r.mailSayisi, 0);
});

test("bayat bulgu (2 günden eski) düşer", () => {
  const durum = { items: [{ day: "2026-07-30", at: "09:00", alert: W("ESKI") }], lastFlush: null };
  const r = cagir({ alerts: [], durum, bugun: "2026-08-05", saat: "20:00", utcSaat: 20 });
  assert.equal(r.durum.items.length, 0, "bayat bulgu atılmalı");
  assert.equal(r.mailSayisi, 0, "atılan bulgu için mail çıkmamalı");
});

test("bulgu yok + kuyruk boş → tamamen sessiz", () => {
  const r = cagir({ alerts: [], durum: BOS, bugun: "2026-08-05", saat: "20:00", utcSaat: 20 });
  assert.equal(r.mailSayisi, 0);
  assert.equal(r.gonderilecek, null);
});

test("girdi durumu MUTASYONA UĞRAMAZ", () => {
  const durum = { items: [{ day: "2026-08-05", at: "09:00", alert: W("X") }], lastFlush: null };
  const kopya = JSON.parse(JSON.stringify(durum));
  cagir({ alerts: [W("Y")], durum, bugun: "2026-08-05", saat: "10:00", utcSaat: 10 });
  assert.deepEqual(durum, kopya, "çağıranın nesnesi değişmemeli");
});

test("acil sayısı raporlanır", () => {
  const r = cagir({ alerts: [C("A"), C("B"), W("C")], durum: BOS, bugun: "2026-08-05", saat: "10:00", utcSaat: 10 });
  assert.equal(r.acilSayisi, 2);
  assert.equal(r.gonderilecek.length, 3);
});
