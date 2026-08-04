/* rate-limit.js — dakikalık istek penceresi. Saf, zamandan başka girdisi yok.
 *
 * server.js'ten çıkarıldı çünkü test edilemiyordu: dosya app.listen()'i modül
 * seviyesinde çağırdığı için import edilemiyor, dolayısıyla testi mantığı
 * KOPYALAMAK zorundaydı — ve kopyanın sapmadığını ayrıca kontrol etmek
 * gerekiyordu. Burada o bedel yok. */

export function rateLimiter(maxPerMin) {
  let hits = [];

  /* Slot açılana kadar BEKLER. Arka plan işleri için doğru davranış. */
  const gate = async function (softCap = maxPerMin) {
    const cap = Math.min(softCap, maxPerMin);
    for (;;) {
      const now = Date.now();
      hits = hits.filter((t) => now - t < 60_000);
      if (hits.length < cap) { hits.push(now); return; }
      await new Promise((r) => setTimeout(r, Math.max(250, 60_000 - (now - hits[0]) + 50)));
    }
  };

  /* BEKLEMEDEN n slot ayır, alabildiğini döndür. İstek yolunda beklemek
   * doğru değil: TwelveData toplu fiyat sorgusu SEMBOL BAŞINA kredi harcar,
   * 6 sembol için sırada beklemek isteği dakikalarca askıda tutardı. Bunun
   * yerine bu dakika kaç kredi varsa o kadar sembol istenir, kalanı son
   * bilinen değerle dolar. Ayrıca kredi muhasebesi doğru olur — tek slot
   * ayırıp 6 kredi harcamak mum çekimini 429'a sokardı. */
  gate.tryReserve = (n, softCap = maxPerMin) => {
    const now = Date.now();
    hits = hits.filter((t) => now - t < 60_000);
    const bos = Math.max(0, Math.min(softCap, maxPerMin) - hits.length);
    const al = Math.min(n, bos);
    for (let i = 0; i < al; i++) hits.push(now);
    return al;
  };

  return gate;
}
