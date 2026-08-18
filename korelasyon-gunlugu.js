/* korelasyon-gunlugu.js — korelasyon çarpanının zaman serisi. Saf: Date/DB bilmez,
 * tarih ve değerler dışarıdan verilir → testler GERÇEK kodu import eder.
 *
 * NEDEN VAR (18 Ağu 2026): çarpan 17 Ağu'da boyutlandırmaya bağlandı ve her
 * önerilen adedi bölüyor — ama `/api/risk` onu her istekte canlı kovaryanstan
 * hesaplayıp cevapla birlikte ATIYORDU. Hiçbir yere yazılmıyordu.
 *
 * docs/olcumler.md §16g'nin kendi cümlesi: "İkinci bir rejim görülmeden 1,32
 * oranı sabit sanılmamalı." O ikinci rejim geldiğinde kıyaslanacak seri
 * olmayacaktı. Bir sayıyı kullanıp kaydetmemek, onu ölçmemekle aynı kapıya
 * çıkar — geriye dönük üretilemez, çünkü geçmiş bileşim bilinmiyor.
 *
 * BACKFILL YOK. Seri bugünden başlar. Geçmiş çarpanı bugünkü ağırlıklarla
 * yeniden hesaplamak §5'teki "üretilmemiş geçmiş" tuzağının aynısı olurdu:
 * sayı doğru hesaplanır, girdi sahtedir. Seri kısa başlar ve gerçek olur.
 */

/** Kaç gün saklanır. ~1,5 yıl işlem günü; ikinci rejimi görmeye fazlasıyla yeter
 *  ve tek jsonb satırını makul boyutta tutar (kayıt ~120 bayt → ~48 KB). */
export const TAVAN_GUN = 400;

/** Bu farkın altındaki oynama gün içinde yazma tetiklemez. Çarpan 3 haneye
 *  yuvarlanıyor; 0,005 kabaca "panelde görünür değişiklik" demek. */
export const YAZMA_ESIGI = 0.005;

const sayi = (v) => (Number.isFinite(v) ? v : null);

/** Tek kaydı doğrula. Bozuk kayıt EKLENMEZ — seriye null sızarsa onu okuyan
 *  her istatistik sessizce bozulur ve nereden geldiği bulunamaz. */
export function kayitGecerli(k) {
  if (!k || typeof k !== "object") return false;
  if (typeof k.t !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(k.t)) return false;
  if (!Number.isFinite(k.carpan) || k.carpan < 1) return false;
  if (!Number.isInteger(k.n) || k.n < 1) return false;
  return true;
}

/** Depodan okunan ham değeri seriye çevirir (bozuk/eksik kayda karşı). */
export function normalize(v) {
  if (!Array.isArray(v)) return [];
  return v.filter(kayitGecerli).sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
}

/**
 * Günlük kaydı seriye işler. GÜNÜN SON YAZIMI KAZANIR: çarpan bileşime bağlı,
 * gün içinde pozisyon eklenirse günün doğru değeri sonuncusudur.
 *
 * @returns {{gunluk: object[], degisti: boolean, sebep: string}}
 *   `degisti:false` ise çağıran DB'ye YAZMAMALI — `/api/risk` her sayfa
 *   açılışında koşuyor, her istekte yazmak depoyu boş yere döver.
 */
export function gunlukKayit(mevcut, yeni, { tavan = TAVAN_GUN, esik = YAZMA_ESIGI } = {}) {
  const seri = normalize(mevcut);
  if (!kayitGecerli(yeni)) return { gunluk: seri, degisti: false, sebep: "gecersiz-kayit" };

  const i = seri.findIndex((k) => k.t === yeni.t);
  if (i === -1) {
    const gunluk = [...seri, yeni].slice(-tavan);
    return { gunluk, degisti: true, sebep: "yeni-gun" };
  }

  const eski = seri[i];
  const oynama = Math.abs(yeni.carpan - eski.carpan);
  // Pozisyon sayısı değiştiyse bileşim değişmiştir — çarpan aynı kalsa bile yaz.
  if (oynama < esik && yeni.n === eski.n) {
    return { gunluk: seri, degisti: false, sebep: "esik-alti" };
  }
  const gunluk = [...seri];
  gunluk[i] = yeni;
  return { gunluk, degisti: true, sebep: yeni.n !== eski.n ? "bilesim-degisti" : "gun-ici-guncelleme" };
}

/**
 * ÖLÇÜLMÜŞ kayıtlar — en az iki pozisyon. Tek pozisyonlu günde çarpan 1'dir ama
 * bu bir ÖLÇÜM değil TANIM (bkz. boyutlandirma.test.mjs "tanım gereği"). İkisini
 * aynı ortalamaya katmak seriyi 1'e doğru sulandırır; kayıt silinmez, ayrılır.
 */
export const olculenler = (seri) => normalize(seri).filter((k) => k.n >= 2);

/**
 * Serinin karnesi. Kanıt yoksa sayı değil `null` döner ve `olculdu:false` der —
 * score-calibration.js'in kuralı: kanıt yoksa etiket yalan söylemez.
 */
export function karne(seri, { minGun = 2 } = {}) {
  const o = olculenler(seri);
  if (o.length < minGun) {
    return { olculdu: false, gun: o.length, ilk: o[0]?.t ?? null, son: o.at(-1)?.t ?? null,
      ort: null, min: null, max: null, ilkCarpan: null, sonCarpan: null, aralik: null };
  }
  const c = o.map((k) => k.carpan);
  const toplam = c.reduce((a, b) => a + b, 0);
  return {
    olculdu: true,
    gun: o.length,
    ilk: o[0].t,
    son: o.at(-1).t,
    ort: toplam / c.length,
    min: Math.min(...c),
    max: Math.max(...c),
    ilkCarpan: c[0],
    sonCarpan: c.at(-1),
    aralik: Math.max(...c) - Math.min(...c),
  };
}

/** `/api/risk` çıktısından kayıt kurar. Alan adları bilerek API ile aynı —
 *  aynı sayının iki adı olursa er geç iki değeri olur (docs/olcumler §15). */
export function kayitKur({ t, kor, volAnnPct, volBagimsizPct, avgCorr, n }) {
  return {
    t,
    carpan: sayi(kor?.carpan) ?? 1,
    olculdu: !!kor?.olculdu,
    n: Number.isInteger(n) ? n : 0,
    volAnnPct: sayi(volAnnPct),
    volBagimsizPct: sayi(volBagimsizPct),
    avgCorr: sayi(avgCorr),
  };
}
