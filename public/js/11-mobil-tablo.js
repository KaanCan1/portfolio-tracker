/* 11-mobil-tablo.js — tabloları telefonda okunur hâle getirir.
 * app.js'in SIRALI dilimi; klasik script, global kapsamı paylaşır.
 *
 * NEDEN VAR (4 Eyl 2026): Genel sekmesi mobil panoyla düzeldi ama diğer dördü
 * hâlâ tablo taşıyordu. Ölçüldü (375px genişlikte, dört sekme):
 *
 *   Radar   rb-table  940px · 214 satır → 1117 eleman ekran dışında
 *   Swing   sw-closed 776px · pg-table 641px →   94 eleman
 *   Analiz  ky-tablo / pr-size / pt-table 700px →  75 eleman
 *   Alfa    tablo yok                          →    0  (kart tabanlı, sorunsuz)
 *
 * Sayfa yatay KAYMIYORDU — `.tbl-wrap` kendi içinde kaydırıyor. Sorun daha sinsi:
 * telefonu tutarken sağdaki üç sütunun varlığından haberin olmuyor. "Gerçek K/Z"
 * ile "Fark" ekranın dışında duruyor ve o tabloya bakma sebebin zaten onlar.
 *
 * YÖNTEM: başlık satırını JS okur, her hücreye kendi sütun adını yazar
 * (data-mlbl), CSS mobilde satırı kart yapıp etiketi ::before ile basar. Elle
 * yazılsaydı 6 tablo × ~7 sütun = 42 etiket olurdu ve bir sütun eklendiğinde
 * sessizce kayardı — burada başlık nereden geliyorsa etiket de oradan geliyor.
 *
 * NEREYE UYGULANIR: yalnız aşağıdaki listedeki tablolara. Korelasyon MATRİSİ
 * (pr-corr) bilerek dışarıda — bir matrisi satır kartına çevirmek onu okunur
 * yapmaz, matrisin anlamı zaten iki eksenin kesişiminde. Başlıksız tablolar da
 * dışarıda: etiketi olmayan hücrenin kartı boş bir kutu olur.
 */

/* Kart satırına çevrilecek tablolar. Liste AÇIK tutuluyor (otomatik değil),
 * çünkü her tablo kartlaşmaya uygun değil ve bunu ancak insan bilir. */
const MT_TABLOLAR = [
  ".pg-table",          // Swing · plan vs gerçek
  ".trade-table",       // Swing · kapanmış işlemler + Pano · işlem geçmişi
  ".ky-tablo",          // Analiz · kıyas
  ".pr-size",           // Analiz · pozisyon boyutu
  ".pt-table",          // Analiz · pozisyon teknikleri
];

/** Başlıkları hücrelere taşır. colspan'li başlıklar atlanır — hangi hücreye
 *  ait olduğu belirsizdir ve yanlış etiket, etiketsizden kötüdür. */
function mtEtiketle(tablo) {
  const basliklar = [...tablo.querySelectorAll("thead th")].map((th) =>
    (th.colSpan > 1 ? "" : th.textContent.trim()));
  if (!basliklar.some(Boolean)) return;              // başlıksız tablo → dokunma
  for (const tr of tablo.querySelectorAll("tbody tr")) {
    const h = [...tr.children];
    // Tek hücreli "boş liste" satırları kart olmaz, olduğu gibi kalsın.
    if (h.length < 2) { tr.dataset.mtTek = "1"; continue; }
    h.forEach((td, i) => {
      const ad = basliklar[i];
      if (ad) td.dataset.mlbl = ad; else delete td.dataset.mlbl;
    });
  }
}

/** Görünür tüm hedef tabloları etiketler. Ucuz: yalnız aktif görünüm taranır. */
function mobilTablolariEtiketle(kok) {
  const alan = kok || document.querySelector(".view.active") || document;
  for (const sel of MT_TABLOLAR) alan.querySelectorAll(sel).forEach(mtEtiketle);
}

/* Paneller fetch'ten sonra kendilerini yeniden çiziyor ve her render çağrısına
 * elle etiketleme eklemek unutulacak bir adım olurdu (bu projede aynı sınıf hata
 * iki kez yaşandı: yeni kök modül sync'e eklenmedi, yeni uç smoke'a eklenmedi).
 * Gözlemci bunu yapıya bağlar: DOM'a tablo girerse etiket de girer.
 *
 * debounce ŞART — renderRadar 214 satırı tek seferde basıyor ve her satır ayrı
 * mutasyon; her birinde tam tarama yapmak sayfayı kilitler. */
let mtZaman = null;
function mtGozlemciKur() {
  if (mtGozlemciKur._kuruldu) return;
  const kok = document.querySelector(".content") || document.body;
  if (!kok) return;
  mtGozlemciKur._kuruldu = true;
  new MutationObserver((kayitlar) => {
    // Kendi yazdığımız data-mlbl niteliği yeni mutasyon doğurmasın (sonsuz döngü).
    if (!kayitlar.some((k) => k.type === "childList" && k.addedNodes.length)) return;
    clearTimeout(mtZaman);
    mtZaman = setTimeout(() => mobilTablolariEtiketle(), 120);
  }).observe(kok, { childList: true, subtree: true });
  mobilTablolariEtiketle();
}

document.addEventListener("DOMContentLoaded", mtGozlemciKur);
if (document.readyState !== "loading") mtGozlemciKur();
