/* guard-ledger.js — bekçi uyarılarının KALICI defteri ve isabet hesabı. Saf:
 * fiyat çekmez, veritabanı bilmez, saat okumaz. Girdi verilir, yeni defter döner.
 *
 * NEDEN VAR: bekçi bir yıldır uyarı üretiyor ama "kaç uyarı işe yaradı"
 * ölçülmüyordu (docs/olcumler.md §7 — defterin kendi deyimiyle en büyük ölçüm
 * boşluğu). Bir uyarı sistemi için asıl metrik kapsam değil KESİNLİK: yanlış
 * alarm gönderen bekçi kapatılır, kapatılan bekçi işe yaramaz.
 *
 * Neden yeni bir defter: elde iki kayıt vardı ve ikisi de payda olamaz.
 *   guard_notified → yalnız idempotens imleci, 12 günde budanıyor.
 *   feed_events    → 14 gün / 150 olay tavanı, üstelik bekçi dışı olayları da içerir.
 * Precision'ın paydası "bekçinin ne iddia ettiği"dir ve kalıcı olmak zorunda.
 *
 * KAPSAM — yalnız MAİL EDİLEN bulgular deftere girer (alert !== null). Yalnız
 * akışa düşen olaylar (sert günlük hareket, swing stop/hedef) dışarıda: onlar
 * bilgi, uyarı değil. Bekçiyi "seni rahatsız ettiği" şeyden yargılıyoruz.
 * Bu bir yanlılık değil, tanım — ama tanım olduğu için yazılı duruyor.
 */

/* Bir uyarının hükmü. Üçüncü şık BİLEREK yok: "kararsız" seçeneği eklendiğinde
 * zor vakaların hepsi oraya kaçar ve ölçüm yapılmamış olur. Cevaplanmamış
 * uyarılar zaten ayrı sayılıyor (bkz. kapsam) — belirsizlik orada görünür. */
export const HUKUMLER = ["yaradi", "gereksiz"];

/* %90 için z. bootCI ile aynı güven düzeyi — iki ölçüm aynı dille konuşsun. */
const Z90 = 1.6448536269514722;

/* Wilson skor aralığı. Neden bootstrap değil: bootstrap ikili oranda küçük
 * n'de dejenere olur (10 gözlemde yeniden örnekleme 11 farklı değer üretir,
 * aralık taneli çıkar). Wilson tam da bu iş için var ve n küçükken normal
 * yaklaşımın aksine [0,1] dışına taşmaz. */
export function wilson(basari, n, z = Z90) {
  if (!(n > 0)) return null;
  const p = basari / n, z2 = z * z;
  const payda = 1 + z2 / n;
  const merkez = (p + z2 / (2 * n)) / payda;
  const yari = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / payda;
  return [Math.max(0, merkez - yari), Math.min(1, merkez + yari)];
}

/* Uyarıları deftere yaz. anahtar (tip:sembol:gün) zaten idempotens imleci —
 * aynı anahtar iki kez girmez, yani bir bulgu güne yalnız bir kayıt üretir.
 * Defter MUTASYONA UĞRAMAZ; yeni dizi döner. */
export function kayitEkle(defter, uyarilar, { ts, gun }) {
  const out = Array.isArray(defter) ? defter.slice() : [];
  const varOlan = new Set(out.map((k) => k.id));
  let eklenen = 0;
  for (const u of uyarilar || []) {
    const id = u?.anahtar;
    if (!id || varOlan.has(id)) continue;
    varOlan.add(id);
    out.push({
      id, ts, gun,
      kind: u.alert?.kind || "?",
      kindLabel: u.alert?.kindLabel || u.alert?.kind || "?",
      sev: u.alert?.sev || "warn",
      sym: u.alert?.sym || null,
      title: u.alert?.title || "",
      hukum: null,        // "yaradi" | "gereksiz" | null (cevaplanmadı)
      hukumTs: null,
    });
    eklenen++;
  }
  return { defter: out, eklenen };
}

/* Hüküm yaz. Var olan hüküm ÜZERİNE YAZILIR — fikir değiştirmek meşru, ama
 * değişiklik hukumTs'e düşer. Bilinmeyen id sessizce yutulmaz: ok=false. */
export function hukumYaz(defter, id, hukum, { ts }) {
  if (!HUKUMLER.includes(hukum)) return { defter, ok: false, hata: "geçersiz hüküm" };
  const out = (Array.isArray(defter) ? defter : []).slice();
  const i = out.findIndex((k) => k.id === id);
  if (i < 0) return { defter: out, ok: false, hata: "kayıt yok" };
  out[i] = { ...out[i], hukum, hukumTs: ts };
  return { defter: out, ok: true, kayit: out[i] };
}

/* Bir grup kaydın isabet özeti. */
function ozetle(kayitlar, minCevap) {
  const n = kayitlar.length;
  const cevaplanan = kayitlar.filter((k) => k.hukum);
  const yaradi = cevaplanan.filter((k) => k.hukum === "yaradi").length;
  const c = cevaplanan.length;
  const o = {
    n, cevaplanan: c, cevapsiz: n - c,
    yaradi, gereksiz: c - yaradi,
    kapsam: n ? c / n : 0,
    isabet: c ? yaradi / c : null,
    ga: wilson(yaradi, c),
    /* En kötü hâl: cevaplanmayanların HEPSİ gereksizmiş gibi. Cevaplanma oranı
     * düşükken asıl isabet buranın ile yukarıdakinin arasındadır; tek bir sayı
     * söylemek kendini kandırmak olur (defter kuralı 2: yanlılığı yaz). */
    kotuHal: n ? yaradi / n : null,
    hukum: "",
  };
  if (c < minCevap) o.hukum = `veri yetersiz (${c}/${minCevap} cevap)`;
  else if (o.ga[0] <= 0.5 && o.ga[1] >= 0.5) o.hukum = "gürültü — yazı-turadan ayırt edilemiyor";
  else if (o.ga[0] > 0.5) o.hukum = "isabetli";
  else o.hukum = "isabetsiz — bu tip kapatılmalı";
  return o;
}

/* isabetOlc(defter, secenekler)
 *   gunler   yalnız son N günün kayıtları (null → hepsi)
 *   bugun    "YYYY-MM-DD", pencere bununla hesaplanır
 *   minCevap bu sayıdan az cevapla hüküm verilmez (varsayılan 10)
 * Dönen: { toplam, tipler[], bekleyen[] } */
export function isabetOlc(defter, { gunler = null, bugun, minCevap = 10 } = {}) {
  let kayitlar = Array.isArray(defter) ? defter : [];
  if (gunler && bugun) {
    const sinir = new Date(Date.parse(bugun + "T00:00:00Z") - gunler * 86400_000).toISOString().slice(0, 10);
    kayitlar = kayitlar.filter((k) => String(k.gun || "") >= sinir);
  }
  const tipAdlari = [...new Set(kayitlar.map((k) => k.kind))].sort();
  return {
    toplam: ozetle(kayitlar, minCevap),
    tipler: tipAdlari.map((kind) => ({
      kind,
      kindLabel: kayitlar.find((k) => k.kind === kind)?.kindLabel || kind,
      ...ozetle(kayitlar.filter((k) => k.kind === kind), minCevap),
    })),
    // Cevapsızlar — en yeniden eskiye. Kapsamı yükseltmenin tek yolu bunları görmek.
    bekleyen: kayitlar.filter((k) => !k.hukum).sort((a, b) => (a.ts < b.ts ? 1 : -1)),
  };
}
