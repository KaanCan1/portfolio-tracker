/* GERÇEK modülü import eder — kopyasını değil. server.js'ten çıkarılan her
 * parçanın böyle test edilmesi gerekiyor; bugüne kadar mantık kopyalanıp
 * ayrıca "kopya sapmadı mı" kontrolü yapmak zorundaydık. */
import test from "node:test";
import assert from "node:assert/strict";
import { kaynak, kaynakDefteri } from "../sources.js";

const sessiz = { warn() {} };

test("dogrula ZORUNLU — doğrulamasız kaynak tanımlanamaz", () => {
  assert.throws(() => kaynak({ ad: "x", getir: async () => 1, log: sessiz }), /dogrula zorunlu/);
  assert.throws(() => kaynak({ ad: "x", dogrula: () => true, log: sessiz }), /getir fonksiyon olmalı/);
  assert.throws(() => kaynak({ getir: async () => 1, dogrula: () => true, log: sessiz }), /ad zorunlu/);
});

test("geçerli yanıt okunur ve sağlıklı görünür", async () => {
  const k = kaynak({ ad: "t", getir: async () => ({ v: 5 }), dogrula: (o) => o?.v > 0, log: sessiz });
  assert.deepEqual(await k.oku(), { v: 5 });
  const d = k.durum();
  assert.equal(d.saglikli, true);
  assert.equal(d.degerVar, true);
  assert.equal(d.sonHata, null);
  assert.equal(d.yasDk, 0);
});

test("3 Ağu senaryosu: yanıt geliyor ama gövde boş → KABUL EDİLMEZ, stale'e düşer", async () => {
  let govde = { usd: 47.5, gram: 6167 };
  const k = kaynak({ ad: "metals", getir: async () => govde, dogrula: (o) => o?.usd > 0 && o?.gram > 0, ttl: 0, log: sessiz });

  assert.deepEqual(await k.oku(), { usd: 47.5, gram: 6167 });

  // Uç boşalıyor — HTTP başarılı, gövde eksik (v4'ün yaptığı tam olarak bu)
  govde = { updated: "2026-08-03" };
  const sonuc = await k.oku();
  assert.equal(sonuc.stale, true, "boş gövde son iyi değere düşmeliydi");
  assert.equal(sonuc.usd, 47.5, "son iyi değer korunmalı");
  assert.match(k.durum().sonHata, /doğrulamayı geçmedi/);
  assert.equal(k.durum().saglikli, false);
});

test("son iyi değer yokken geçersiz gövde → hata fırlatır (sessizce null dönmez)", async () => {
  const k = kaynak({ ad: "t", getir: async () => ({}), dogrula: (o) => o?.v > 0, log: sessiz });
  await assert.rejects(() => k.oku(), /doğrulamayı geçmedi/);
});

test("ağ hatası da stale'e düşer", async () => {
  let patla = false;
  const k = kaynak({ ad: "t", getir: async () => { if (patla) throw new Error("ECONNRESET"); return { v: 1 }; }, dogrula: (o) => o?.v > 0, ttl: 0, log: sessiz });
  await k.oku();
  patla = true;
  const s = await k.oku();
  assert.equal(s.stale, true);
  assert.equal(s.v, 1);
  assert.match(k.durum().sonHata, /ECONNRESET/);
});

test("TTL içinde tekrar istek fetch açmaz", async () => {
  let n = 0;
  const k = kaynak({ ad: "t", getir: async () => { n++; return { v: 1 }; }, dogrula: () => true, ttl: 60_000, log: sessiz });
  await k.oku(); await k.oku(); await k.oku();
  assert.equal(n, 1);
  k.bayatlat();
  await k.oku();
  assert.equal(n, 2);
});

test("eşzamanlı istekler tek fetch'e biner", async () => {
  let n = 0;
  const k = kaynak({ ad: "t", dogrula: () => true, ttl: 0, log: sessiz,
    getir: async () => { n++; await new Promise((r) => setTimeout(r, 20)); return { v: n }; } });
  const hepsi = await Promise.all([k.oku(), k.oku(), k.oku(), k.oku(), k.oku()]);
  assert.equal(n, 1, "5 eşzamanlı istek 1 fetch açmalıydı");
  assert.deepEqual(new Set(hepsi.map((x) => x.v)), new Set([1]));
});

test("tohumla: geçerli yedek yüklenir, BOZUK yedek yüklenmez", async () => {
  const iyi = kaynak({ ad: "t", getir: async () => { throw new Error("kapalı"); }, dogrula: (o) => o?.v > 0, log: sessiz,
    kalici: { yukle: async () => ({ v: 9 }) } });
  assert.equal(await iyi.tohumla(), true);
  const s = await iyi.oku();
  assert.equal(s.v, 9);
  assert.equal(s.stale, true, "tohum tazeleme sayılmaz");

  const bozuk = kaynak({ ad: "t2", getir: async () => { throw new Error("kapalı"); }, dogrula: (o) => o?.v > 0, log: sessiz,
    kalici: { yukle: async () => ({ bozuk: true }) } });
  assert.equal(await bozuk.tohumla(), false, "doğrulamayı geçmeyen yedek yüklenmemeli");
  await assert.rejects(() => bozuk.oku());
});

test("başarılı okuma kalıcı depoya yazar, başarısız okuma YAZMAZ", async () => {
  const yazilan = [];
  let govde = { v: 1 };
  const k = kaynak({ ad: "t", getir: async () => govde, dogrula: (o) => o?.v > 0, ttl: 0, log: sessiz,
    kalici: { kaydet: async (x) => { yazilan.push(x); } } });
  await k.oku();
  govde = { bozuk: true };
  await k.oku().catch(() => {});
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(yazilan, [{ v: 1 }], "yalnız doğrulanmış değer kalıcı olmalı");
});

test("getir son iyi değeri alır — kısmi kaynak elindekini tamamlayabilir", async () => {
  // Gerçek ihtiyaç: Truncgil düşünce TCMB devreye giriyor ama altın yayımlamıyor
  let birincilCalisiyor = true;
  const k = kaynak({
    ad: "doviz", ttl: 0, log: sessiz,
    dogrula: (o) => o?.usd > 0 && o?.gram > 0,
    getir: async (sonIyi) => {
      if (birincilCalisiyor) return { usd: 47.5, gram: 6167, kaynak: "truncgil" };
      // yedek yalnız döviz verir → altını son iyi değerden taşı
      return { usd: 47.6, gram: sonIyi?.gram ?? null, kaynak: "tcmb" };
    },
  });
  await k.oku();
  birincilCalisiyor = false;
  const s = await k.oku();
  assert.equal(s.kaynak, "tcmb");
  assert.equal(s.usd, 47.6, "döviz TAZE olmalı");
  assert.equal(s.gram, 6167, "altın son iyi değerden taşınmalı");
  assert.equal(s.stale, undefined, "doğrulamayı geçti, stale değil");
});

test("arkaPlanTazele: istek yolunda BEKLEMEZ, arkada tazeler", async () => {
  let n = 0, cozul;
  const k = kaynak({
    ad: "vix", ttl: 0, arkaPlanTazele: true, dogrula: (o) => o?.v > 0, log: sessiz,
    getir: async () => { n++; if (n === 1) return { v: 1 }; await new Promise((r) => { cozul = r; }); return { v: 2 }; },
  });
  assert.deepEqual(await k.oku(), { v: 1 });          // ilk okuma bekler (değer yok)
  assert.equal(n, 1);

  const t0 = Date.now();
  const s = await k.oku();                            // bayat ama BEKLEMEMELİ
  assert.ok(Date.now() - t0 < 30, "istek yolunda beklememeliydi");
  assert.equal(s.v, 1, "eldeki değer anında dönmeli");
  assert.equal(s.stale, true);
  assert.equal(n, 2, "tazeleme arka planda başlamalıydı");

  cozul();                                            // arka plan tamamlansın
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await k.oku()).v, 2, "tazelenen değer sonraki okumada görünmeli");
});

test("arkaPlanTazele: ilk açılışta (değer yokken) bekler", async () => {
  const k = kaynak({ ad: "vix", ttl: 0, arkaPlanTazele: true, dogrula: (o) => o?.v > 0, log: sessiz,
    getir: async () => { await new Promise((r) => setTimeout(r, 15)); return { v: 7 }; } });
  const s = await k.oku();
  assert.equal(s.v, 7, "gösterecek değer yokken beklenmeli");
});

test("defter: bayat kaynakları listeler", async () => {
  const d = kaynakDefteri();
  const iyi = d.ekle(kaynak({ ad: "iyi", getir: async () => ({ v: 1 }), dogrula: () => true, log: sessiz }));
  const bos = d.ekle(kaynak({ ad: "bos", getir: async () => ({}), dogrula: (o) => o?.v > 0, log: sessiz }));
  await iyi.oku();
  await bos.oku().catch(() => {});

  const adlar = d.durumlar().map((x) => x.ad).sort();
  assert.deepEqual(adlar, ["bos", "iyi"]);
  const bayat = d.bayatOlanlar(60).map((x) => x.ad);
  assert.deepEqual(bayat, ["bos"], "değeri hiç olmayan kaynak bayat sayılmalı");
  assert.equal(d.bayatOlanlar(0).length, 2, "eşik 0 iken taze kaynak da bayat sayılır");
});
