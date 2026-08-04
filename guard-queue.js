/* guard-queue.js — bekçi mail kuyruğunun KARAR mantığı. Saf: tarih, ağ,
 * veritabanı bilmez; ne varsa parametreyle gelir.
 *
 * server.js'ten çıkarıldı çünkü test edilemiyordu (app.listen modül
 * seviyesinde → dosya import edilemez). Testi mantığı KOPYALAMAK zorundaydı
 * ve kopyanın sapmadığını ayrıca programatik olarak doğrulamak gerekiyordu.
 *
 * KURAL — aciliyete göre ayrışır:
 *   crit (stop delindi / risk bütçesi doldu) → BEKLETİLMEZ. Akşama ertelemek
 *     aracın işini baltalar; sermaye o an tehlikede.
 *   warn + info → kuyrukta bekler, günde bir kez toplu gider.
 * Acil mail zaten çıkıyorsa kuyruk ona BİNDİRİLİR — nasılsa gönderiyoruz,
 * ikincisinin anlamı yok. Pratikte günde 1 mail.
 *
 * lastFlush günü tutulur; tutulmasaydı boşaltma saatinden sonra gelen her
 * warn anında gider ve "günde bir" kuralı bozulurdu. */

/* kuyrukKarari(girdi) → { gonderilecek, durum, mailSayisi }
 *   alerts     bu taramanın bulguları  [{sev, ...}]
 *   durum      kalıcı kuyruk { items: [{day, at, alert}], lastFlush }
 *   bugun      "YYYY-MM-DD" (UTC) — kuyruk günü bununla anahtarlanır
 *   saat       "HH:MM" (TR) — karta yazılan bulgu saati
 *   utcSaat    0-23, boşaltma saatiyle karşılaştırılır
 *   digestSaat günlük boşaltma saati (UTC)
 *   maxGun     bundan eski bulgu düşer (bayat uyarı aksiyon edilebilir değil)
 * durum MUTASYONA UĞRAMAZ; yeni nesne döner. */
export function kuyrukKarari({ alerts = [], durum, bugun, saat, utcSaat, digestSaat, maxGun = 2 }) {
  const bayatSinir = new Date(Date.parse(bugun + "T00:00:00Z") - maxGun * 86400_000).toISOString().slice(0, 10);
  const items = (durum?.items || []).filter((x) => String(x?.day || "") >= bayatSinir);

  const acil = alerts.filter((a) => a.sev === "crit");
  for (const a of alerts) if (a.sev !== "crit") items.push({ day: bugun, at: saat, alert: a });
  const bekleyen = items.map((x) => ({ ...x.alert, at: x.at }));

  let gonderilecek = null;
  if (acil.length) {
    gonderilecek = [...acil.map((a) => ({ ...a, at: saat })), ...bekleyen];
  } else if (bekleyen.length && utcSaat >= digestSaat && durum?.lastFlush !== bugun) {
    gonderilecek = bekleyen;
  }

  if (gonderilecek?.length) {
    return { gonderilecek, durum: { items: [], lastFlush: bugun }, mailSayisi: 1, acilSayisi: acil.length };
  }
  return { gonderilecek: null, durum: { items, lastFlush: durum?.lastFlush ?? null }, mailSayisi: 0, acilSayisi: acil.length };
}
