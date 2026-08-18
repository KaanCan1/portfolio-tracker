/* GERÇEK modülü import eder. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  gunlukKayit, normalize, kayitGecerli, olculenler, karne, kayitKur,
  TAVAN_GUN, YAZMA_ESIGI,
} from "../korelasyon-gunlugu.js";

const k = (t, carpan, n = 4) => ({ t, carpan, n, olculdu: carpan > 1, volAnnPct: 80, volBagimsizPct: 60, avgCorr: 0.4 });

/* ===== kayıt doğrulama ===== */

test("bozuk kayıt seriye GİRMEZ — null sızarsa okuyan her istatistik bozulur", () => {
  assert.equal(kayitGecerli(k("2026-08-18", 1.32)), true);
  assert.equal(kayitGecerli(null), false);
  assert.equal(kayitGecerli({ t: "18/08/2026", carpan: 1.3, n: 4 }), false, "tarih biçimi");
  assert.equal(kayitGecerli({ t: "2026-08-18", carpan: NaN, n: 4 }), false);
  assert.equal(kayitGecerli({ t: "2026-08-18", carpan: 0.9, n: 4 }), false, "çarpan 1'in altına inemez");
  assert.equal(kayitGecerli({ t: "2026-08-18", carpan: 1.3, n: 0 }), false);
  assert.equal(kayitGecerli({ t: "2026-08-18", carpan: 1.3, n: 2.5 }), false, "n tamsayı");
});

test("normalize: dizi değilse boş, bozuklar ayıklanır, tarihe göre sıralanır", () => {
  assert.deepEqual(normalize(null), []);
  assert.deepEqual(normalize({ a: 1 }), []);
  const s = normalize([k("2026-08-18", 1.3), { bozuk: true }, k("2026-08-12", 1.1)]);
  assert.equal(s.length, 2);
  assert.deepEqual(s.map((x) => x.t), ["2026-08-12", "2026-08-18"]);
});

/* ===== günlük kayıt ===== */

test("yeni gün seriye eklenir", () => {
  const r = gunlukKayit([k("2026-08-17", 1.30)], k("2026-08-18", 1.32));
  assert.equal(r.degisti, true);
  assert.equal(r.sebep, "yeni-gun");
  assert.equal(r.gunluk.length, 2);
});

test("GÜNÜN SON YAZIMI KAZANIR — aynı gün ikinci kayıt öncekini değiştirir", () => {
  const r = gunlukKayit([k("2026-08-18", 1.32)], k("2026-08-18", 1.45));
  assert.equal(r.gunluk.length, 1, "gün ÇOĞALMAZ");
  assert.equal(r.gunluk[0].carpan, 1.45);
  assert.equal(r.degisti, true);
});

test("eşik altı oynama YAZMA TETİKLEMEZ — /api/risk her sayfa açılışında koşuyor", () => {
  const r = gunlukKayit([k("2026-08-18", 1.320)], k("2026-08-18", 1.322));
  assert.equal(r.degisti, false);
  assert.equal(r.sebep, "esik-alti");
  assert.equal(r.gunluk[0].carpan, 1.320, "seri dokunulmadan döner");
});

test("eşiğin ÜSTÜ yazar", () => {
  const r = gunlukKayit([k("2026-08-18", 1.320)], k("2026-08-18", 1.320 + YAZMA_ESIGI + 1e-9));
  assert.equal(r.degisti, true);
});

test("pozisyon sayısı değişince çarpan aynı kalsa BİLE yazılır", () => {
  const r = gunlukKayit([k("2026-08-18", 1.32, 4)], k("2026-08-18", 1.32, 5));
  assert.equal(r.degisti, true);
  assert.equal(r.sebep, "bilesim-degisti");
  assert.equal(r.gunluk[0].n, 5);
});

test("geçersiz kayıt seriyi BOZMAZ ve yazma tetiklemez", () => {
  const once = [k("2026-08-18", 1.32)];
  const r = gunlukKayit(once, { t: "2026-08-19", carpan: NaN, n: 4 });
  assert.equal(r.degisti, false);
  assert.equal(r.sebep, "gecersiz-kayit");
  assert.deepEqual(r.gunluk, once);
});

test(`tavan ${TAVAN_GUN} gün — en eski düşer, en yeni kalır`, () => {
  const uniq = Array.from({ length: TAVAN_GUN }, (_, i) =>
    k(new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), 1.2));
  const r = gunlukKayit(uniq, k("2030-01-01", 1.9));
  assert.equal(r.gunluk.length, TAVAN_GUN, "tavanı aşmaz");
  assert.equal(r.gunluk.at(-1).t, "2030-01-01");
  assert.notEqual(r.gunluk[0].t, uniq[0].t, "en eski düştü");
});

/* ===== ölçülmüş vs tanım ===== */

test("tek pozisyonlu gün ölçüm SAYILMAZ — çarpan 1 orada tanım, ölçüm değil", () => {
  const seri = [k("2026-08-17", 1, 1), k("2026-08-18", 1.32, 4)];
  const o = olculenler(seri);
  assert.equal(o.length, 1);
  assert.equal(o[0].t, "2026-08-18");
  assert.equal(normalize(seri).length, 2, "kayıt SİLİNMEZ, ayrılır");
});

/* ===== karne ===== */

test("kanıt yoksa karne sayı değil null döner ve olculdu=false der", () => {
  const r = karne([k("2026-08-18", 1.32)]);
  assert.equal(r.olculdu, false);
  assert.equal(r.ort, null);
  assert.equal(r.gun, 1);
});

test("karne: ortalama/min/max/aralık ölçülmüş günlerden", () => {
  const r = karne([k("2026-08-16", 1.20), k("2026-08-17", 1.40), k("2026-08-18", 1.30), k("2026-08-15", 1, 1)]);
  assert.equal(r.olculdu, true);
  assert.equal(r.gun, 3, "tek pozisyonlu gün sayılmadı");
  assert.ok(Math.abs(r.ort - 1.30) < 1e-12);
  assert.equal(r.min, 1.20);
  assert.equal(r.max, 1.40);
  assert.ok(Math.abs(r.aralik - 0.20) < 1e-12);
  assert.equal(r.ilkCarpan, 1.20, "ilk = en eski tarih");
  assert.equal(r.sonCarpan, 1.30, "son = en yeni tarih");
  assert.equal(r.ilk, "2026-08-16");
  assert.equal(r.son, "2026-08-18");
});

test("karne bozuk seride patlamaz", () => {
  assert.equal(karne(null).olculdu, false);
  assert.equal(karne([]).gun, 0);
});

/* ===== kayıtKur ===== */

test("kayitKur: /api/risk alanlarını birebir taşır", () => {
  const r = kayitKur({
    t: "2026-08-18",
    kor: { carpan: 1.324, olculdu: true },
    volAnnPct: 84.9, volBagimsizPct: 64.1, avgCorr: 0.42, n: 6,
  });
  assert.equal(kayitGecerli(r), true);
  assert.equal(r.carpan, 1.324);
  assert.equal(r.olculdu, true);
  assert.equal(r.n, 6);
  assert.equal(r.volBagimsizPct, 64.1);
});

test("kayitKur: eksik/bozuk girdide çarpan 1, sayısal alanlar null — 0 DEĞİL", () => {
  const r = kayitKur({ t: "2026-08-18", kor: null, volAnnPct: NaN, volBagimsizPct: undefined, avgCorr: null, n: 3 });
  assert.equal(r.carpan, 1);
  assert.equal(r.olculdu, false);
  assert.equal(r.volAnnPct, null, "0 yazmak 'volatilite sıfırdı' demek olurdu");
  assert.equal(r.volBagimsizPct, null);
  assert.equal(r.avgCorr, null);
});

/* ===== jsonb DİZİ tuzağı (CLAUDE.md) ===== */

test("seri JSON'a gidip geri döndüğünde aynı kalır — depoya dizi olarak yazılıyor", () => {
  const seri = [k("2026-08-17", 1.30), k("2026-08-18", 1.32)];
  const geri = normalize(JSON.parse(JSON.stringify(seri)));
  assert.deepEqual(geri, seri);
  assert.ok(Array.isArray(geri), "DİZİ — store.js jsonMetin/::jsonb yolundan geçmeli");
});
