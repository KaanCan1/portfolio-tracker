/* yazma-kuyrugu.js — portföy belgesine oku→değiştir→yaz işlemlerini SIRAYA sokar.
 * Saf: fs/pg/express bilmez, oku/yaz dışarıdan verilir → testler GERÇEK kodu import eder.
 *
 * NEDEN VAR (18 Ağu 2026 — ölçülmüş kayıp, hata veren tek satır yok):
 * server.js'teki her yazan uç `const d = await loadData(); …; await saveData(d)`
 * yazıyordu. Bu bir oku-değiştir-yaz yarışı: iki istek çakışırsa ikisi de AYNI
 * eski belgeyi okur, kendi kaydını ekler, sonra ikisi de TÜM belgeyi geri yazar
 * — ikinci yazan birincinin eklediğini siler.
 *
 * Ölçüm (portfoy-safe önizleme, DB'siz dosya modu): aynı sembole 5 eşzamanlı
 * POST /api/realized2026 → beşi de HTTP 200, defterde 1 kayıt. 4 kayıt sessizce
 * yok oldu, logda tek satır iz yok. Sıralı iki POST'ta sorun görünmüyor; yani
 * elle test bu hatayı ASLA yakalamaz.
 *
 * Bu, projenin en pahalı hata ailesinin bir üyesi: signal_ledger'ın jsonb dizi
 * kaybı, /api/risk çift sayımı — hepsi "sessizce yanlış çalışan, hata vermeyen
 * kod". HTTP 200 ≠ veri yazıldı.
 *
 * ── Neden yalnız saveData'yı sıraya sokmak YETMEZ ─────────────────────────
 * Yarış yazma anında değil, OKUMA ile YAZMA ARASINDA. İki istek de eski belgeyi
 * okuduktan sonra yazmaları sıralasan bile ikincisi birincinin sonucunu görmemiş
 * olur ve üstüne yazar. Kilit oku-değiştir-yaz'ın TAMAMINI kapsamak zorunda;
 * bu yüzden burada sıraya giren birim `yaz` değil `islem`.
 *
 * ── Kapsam sınırı (bilerek) ───────────────────────────────────────────────
 * Bu kuyruk SÜREÇ İÇİdir. İki ayrı sunucu süreci (ör. iki Render örneği) aynı
 * satırı yazarsa yarış geri gelir — o zaman çözüm DB tarafında koşullu yazma
 * olur. Bugün tek örnek koşuyor; bu sınırı bilerek kabul ediyoruz, çünkü tek
 * örnekte bile ölçülen kayıp gerçekti ve süreç içi kuyruk onu tamamen kapatır.
 */

/* Söz zinciri: her iş bir öncekinin BİTİŞİNE bağlanır.
 * Zinciri `.catch` ile devam ettiriyoruz — bir iş fırlarsa zincir kopmamalı,
 * yoksa ilk hatadan sonra tüm yazmalar sessizce beklemede kalır (yine sessiz
 * veri kaybı, sadece başka kılıkta). Hata ÇAĞIRANA aynen yayılır. */
export function kuyrukOlustur() {
  let son = Promise.resolve();

  const kuyrukla = (is) => {
    const sonuc = son.then(is, is);   // önceki iş hata verse de sıradaki koşar
    son = sonuc.then(() => {}, () => {});
    return sonuc;                     // hata çağırana yayılsın
  };

  // Testler ve kapanış için: kuyruk boşalınca çözülür.
  kuyrukla.bekle = () => son.then(() => {}, () => {});
  return kuyrukla;
}

/* veriIslemOlustur({ oku, yaz }) → veriIslem(fn)
 *
 *   await veriIslem(async (d) => { d.notes.push(x); return d.notes; })
 *
 * fn belgeyi YERİNDE değiştirir; dönüş değeri veriIslem'in dönüşüdür.
 * Sıra garantisi: bir işlem bitmeden (yazma dahil) sıradaki OKUMAZ.
 *
 * Yazmayı iptal: fn'in ikinci argümanı `islem`; `islem.yazma()` çağrılırsa
 * belge geri yazılmaz ama dönüş değeri korunur (ör. "eklenecek bir şey yoktu").
 * fn FIRLATIRSA da yazılmaz — yarım kalmış değişiklik diske gitmez; bu, 404/400
 * gibi erken çıkışların doğal yolu.
 *
 * `oku` fırlatırsa (bozuk portfolio.json) hata aynen yayılır: o garanti
 * server.js'e ait ve burada zayıflatılmaz. */
export function veriIslemOlustur({ oku, yaz }) {
  if (typeof oku !== "function" || typeof yaz !== "function") {
    throw new Error("veriIslemOlustur: oku/yaz zorunlu");
  }
  const kuyrukla = kuyrukOlustur();

  const veriIslem = (fn) => kuyrukla(async () => {
    let yazilsin = true;
    const islem = { yazma() { yazilsin = false; } };
    const veri = await oku();
    const sonuc = await fn(veri, islem);
    if (yazilsin) await yaz(veri);
    return sonuc;
  });

  veriIslem.bekle = kuyrukla.bekle;
  return veriIslem;
}

/* HTTP durumu taşıyan hata — uç noktalar işlem içinden erken çıkabilsin diye.
 * (Fırlatmak yazmayı da iptal eder, bkz. yukarısı.) */
export class VeriHata extends Error {
  constructor(durum, mesaj) { super(mesaj); this.name = "VeriHata"; this.durum = durum; }
}
