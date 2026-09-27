import test from "node:test";
import assert from "node:assert/strict";
import { performansHesapla, performansDogrula, akisUSD } from "../performans.js";

const yakin = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} ≈ ${b} değil`);
const snap = (date, usd, usdtry = 40) => ({ date, total: usd * usdtry, usdtry });
const hesapla = (snapshots, flows, current, today = "2026-08-13") => performansHesapla({
  snapshots, flows, current, today, baslangic: "2026-06-01",
});

test("kişisel harcama için çekilen para net değeri düşürür ama getiriyi düşürmez", () => {
  const s = hesapla(
    [snap("2026-08-11", 1000), snap("2026-08-12", 800)],
    [{ date: "2026-08-12", type: "withdraw", currency: "USD", amount: 200, amountTRY: 8000 }],
    snap("2026-08-13", 800),
  );
  yakin(s.since.pct, 0);
  yakin(s.since.gainUSD, 0);
  assert.equal(s.since.flowCount, 1);
});

test("aynı gün çekim ve piyasa kazancı ayrışır; gün/hafta/ay tek hesabı kullanır", () => {
  const s = hesapla(
    [snap("2026-07-10", 1000), snap("2026-07-24", 1000), snap("2026-08-11", 1000), snap("2026-08-12", 810)],
    [{ date: "2026-08-12", type: "withdraw", currency: "USD", amount: 200, amountTRY: 8000 }],
    snap("2026-08-13", 810),
  );
  yakin(s.day.pct, 0);
  yakin(s.week.pct, 1);
  yakin(s.month.pct, 1);
  yakin(s.since.gainUSD, 10);
});

test("hafta sonu nakit akışı sonraki değerlemeye eklenir", () => {
  const s = hesapla(
    [snap("2026-08-14", 1000), snap("2026-08-17", 800)],
    [{ date: "2026-08-16", type: "withdraw", currency: "USD", amount: 200 }],
    snap("2026-08-21", 800), "2026-08-21",
  );
  yakin(s.since.pct, 0);
});

test("USD çekiminde kayıt anındaki TL karşılığı değil asıl dolar tutarı kullanılır", () => {
  yakin(akisUSD({ currency: "USD", amount: 200, amountTRY: 11000 }, 48), 200);
  yakin(akisUSD({ currency: "TL", amount: 4800 }, 48), 100);
});

test("belirsiz döviz akışında getiri uydurulmaz; eksik değerlemede ölçüm yok", () => {
  const snapshots = [snap("2026-07-24", 1000), snap("2026-08-11", 1000)];
  const s = hesapla(snapshots, [{ date: "2026-08-12", type: "withdraw", currency: "EUR", amount: 200 }], snap("2026-08-13", 800));
  assert.equal(s.since.ok, false);
  assert.equal(hesapla(snapshots, [], { total: 0, usdtry: 40 }), null);
});

test("gün açılışı zaten güncel nakdi içeriyorsa akış iki kez çıkarılmaz", () => {
  const s = performansHesapla({
    snapshots: [snap("2026-08-13", 800)],
    flows: [{ date: "2026-08-13", type: "withdraw", currency: "USD", amount: 200 }],
    current: snap("2026-08-13", 800), dayOpen: snap("2026-08-13", 800), today: "2026-08-13",
  });
  yakin(s.day.pct, 0);
});

test("açıklanamayan eski nakit farkı haftayı gizler, temiz bugünü korur", () => {
  const p = hesapla(
    [snap("2026-08-06", 1000), snap("2026-08-12", 700)], [], snap("2026-08-13", 700),
  );
  const audited = performansDogrula(p, [
    { d: "2026-08-12", ariza: "deger-acigi", cashAcik: -300 },
    { d: "2026-08-13", ariza: "kayit-uyusmazligi", cashAcik: -500 },
  ]);
  assert.equal(audited.day.verified, true);
  assert.equal(audited.week.verified, false);
  assert.equal(audited.since.verified, false);
  assert.deepEqual(audited.unexplained, [{ date: "2026-08-12", usd: -300 }]);
});
