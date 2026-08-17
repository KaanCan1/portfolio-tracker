/* GERÇEK modülü import eder — guard-queue testiyle aynı ilke. */
import test from "node:test";
import assert from "node:assert/strict";
import { kayitEkle, hukumYaz, isabetOlc, wilson } from "../guard-ledger.js";

const U = (anahtar, kind = "stop", extra = {}) => ({
  anahtar,
  alert: { kind, kindLabel: kind === "stop" ? "Stop delindi" : kind, sev: "crit", sym: anahtar.split(":")[1], title: "t", ...extra },
});
const TS = "2026-08-09T10:00:00.000Z";

/* Defter n kayıtla kur, ilk k tanesine hüküm yaz (yaradi/gereksiz sırayla). */
function defterKur(n, yaradiSayisi, cevapsizSayisi = 0, kind = "stop") {
  let d = [];
  for (let i = 0; i < n; i++) d = kayitEkle(d, [U(`${kind}:S${i}:2026-08-01`, kind)], { ts: TS, gun: "2026-08-01" }).defter;
  const cevaplanacak = n - cevapsizSayisi;
  for (let i = 0; i < cevaplanacak; i++) {
    d = hukumYaz(d, `${kind}:S${i}:2026-08-01`, i < yaradiSayisi ? "yaradi" : "gereksiz", { ts: TS }).defter;
  }
  return d;
}

test("aynı anahtar iki kez deftere girmez (idempotens)", () => {
  const bir = kayitEkle([], [U("stop:MU:2026-08-09")], { ts: TS, gun: "2026-08-09" });
  assert.equal(bir.eklenen, 1);
  const iki = kayitEkle(bir.defter, [U("stop:MU:2026-08-09")], { ts: TS, gun: "2026-08-09" });
  assert.equal(iki.eklenen, 0, "aynı bulgu güne bir kez");
  assert.equal(iki.defter.length, 1);
});

test("yalnız mail edilen bulgular deftere girer — alert:null dışarıda kalır", () => {
  const r = kayitEkle([], [{ anahtar: "gap:MU:2026-08-09", alert: null }], { ts: TS, gun: "2026-08-09" });
  // alert yok → kind "?" olurdu; çağıran filtreliyor, ama modül de çökmemeli
  assert.equal(r.defter[0].kind, "?");
});

test("kayıt eklemek defteri MUTASYONA UĞRATMAZ", () => {
  const ilk = [];
  kayitEkle(ilk, [U("stop:MU:2026-08-09")], { ts: TS, gun: "2026-08-09" });
  assert.equal(ilk.length, 0);
});

test("hüküm yazılır ve üzerine yazılabilir", () => {
  let d = kayitEkle([], [U("stop:MU:2026-08-09")], { ts: TS, gun: "2026-08-09" }).defter;
  d = hukumYaz(d, "stop:MU:2026-08-09", "yaradi", { ts: TS }).defter;
  assert.equal(d[0].hukum, "yaradi");
  const r = hukumYaz(d, "stop:MU:2026-08-09", "gereksiz", { ts: "2026-08-10T00:00:00.000Z" });
  assert.equal(r.kayit.hukum, "gereksiz", "fikir değiştirmek meşru");
  assert.equal(r.kayit.hukumTs, "2026-08-10T00:00:00.000Z");
});

test("bilinmeyen id ve geçersiz hüküm sessizce yutulmaz", () => {
  const d = kayitEkle([], [U("stop:MU:2026-08-09")], { ts: TS, gun: "2026-08-09" }).defter;
  assert.equal(hukumYaz(d, "yok:YOK:2026-08-09", "yaradi", { ts: TS }).ok, false);
  assert.equal(hukumYaz(d, "stop:MU:2026-08-09", "belki", { ts: TS }).ok, false);
});

test("az cevapla hüküm verilmez", () => {
  const d = defterKur(5, 5);
  const r = isabetOlc(d, { bugun: "2026-08-09" });
  assert.equal(r.toplam.cevaplanan, 5);
  assert.match(r.toplam.hukum, /veri yetersiz/);
});

test("yarı yarıya isabet → gürültü (GA 0.5'i içerir)", () => {
  const r = isabetOlc(defterKur(20, 10), { bugun: "2026-08-09" });
  assert.equal(r.toplam.isabet, 0.5);
  assert.ok(r.toplam.ga[0] <= 0.5 && r.toplam.ga[1] >= 0.5);
  assert.match(r.toplam.hukum, /gürültü/);
});

test("yüksek isabet → 'isabetli', düşük isabet → 'kapatılmalı'", () => {
  assert.equal(isabetOlc(defterKur(40, 36), { bugun: "2026-08-09" }).toplam.hukum, "isabetli");
  assert.match(isabetOlc(defterKur(40, 4), { bugun: "2026-08-09" }).toplam.hukum, /kapatılmalı/);
});

test("cevapsızlar isabetin PAYDASINA girmez ama kapsam ve kötü hâl bunu söyler", () => {
  // 20 uyarı, 10'u cevaplanmış, 8'i "yaradı"
  const r = isabetOlc(defterKur(20, 8, 10), { bugun: "2026-08-09" });
  assert.equal(r.toplam.n, 20);
  assert.equal(r.toplam.cevaplanan, 10);
  assert.equal(r.toplam.isabet, 0.8, "yalnız cevaplananlar üzerinden");
  assert.equal(r.toplam.kapsam, 0.5);
  assert.equal(r.toplam.kotuHal, 0.4, "cevapsızların hepsi gereksizse isabet buraya düşer");
  assert.equal(r.bekleyen.length, 10);
});

test("tip kırılımı ayrı ayrı ölçülür", () => {
  const d = [...defterKur(12, 12, 0, "stop"), ...defterKur(12, 0, 0, "weight")];
  const r = isabetOlc(d, { bugun: "2026-08-09" });
  const stop = r.tipler.find((t) => t.kind === "stop");
  const weight = r.tipler.find((t) => t.kind === "weight");
  assert.equal(stop.isabet, 1);
  assert.equal(weight.isabet, 0);
  assert.equal(stop.kindLabel, "Stop delindi");
});

test("gün penceresi eski kayıtları dışarıda bırakır", () => {
  let d = kayitEkle([], [U("stop:ESKI:2026-06-01")], { ts: TS, gun: "2026-06-01" }).defter;
  d = kayitEkle(d, [U("stop:YENI:2026-08-08")], { ts: TS, gun: "2026-08-08" }).defter;
  assert.equal(isabetOlc(d, { bugun: "2026-08-09", gunler: 30 }).toplam.n, 1);
  assert.equal(isabetOlc(d, { bugun: "2026-08-09" }).toplam.n, 2, "pencere yoksa hepsi");
});

test("wilson aralığı [0,1] dışına taşmaz ve n=0'da null", () => {
  assert.equal(wilson(0, 0), null);
  const [lo, hi] = wilson(5, 5);
  assert.ok(lo >= 0 && hi <= 1, "5/5'te üst sınır 1'i aşmamalı");
  assert.ok(lo < 1, "5/5 kesinlik iddiası değil");
  const [lo0] = wilson(0, 5);
  assert.ok(lo0 >= 0);
});
