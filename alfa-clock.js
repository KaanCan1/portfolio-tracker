/* Alfa Avı'nın işlem saati ABD borsasına göre okunur. UTC tarihini kullanmak
 * cuma akşamı ve hafta sonu eski kotasyonu yeni bir işlem günü sanıyordu. */
const nyParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
});

export function nySaat(an = new Date()) {
  const p = Object.fromEntries(nyParts.formatToParts(an).map((x) => [x.type, x.value]));
  return { gun: `${p.year}-${p.month}-${p.day}`, dakika: Number(p.hour) * 60 + Number(p.minute), hafta: p.weekday };
}

export function islemGunu(gun) {
  const d = new Date(`${gun}T12:00:00Z`);
  return !Number.isNaN(+d) && d.getUTCDay() >= 1 && d.getUTCDay() <= 5;
}

export function tazeSeansKotasyonu(kotasyon, gun, an = new Date()) {
  if (!kotasyon || kotasyon.stale || kotasyon.extended || !(Number(kotasyon.price) > 0) || !islemGunu(gun)) return false;
  const simdi = nySaat(an);
  if (simdi.gun !== gun || simdi.dakika < 9 * 60 + 30) return false;
  const ham = Number(kotasyon.asOf);
  if (!Number.isFinite(ham) || ham <= 0) return false; // zamanı belirsiz fiyat işlem üretmez
  const zaman = new Date(ham < 1e12 ? ham * 1000 : ham);
  const q = nySaat(zaman);
  if (q.gun !== gun || q.dakika < 9 * 60 + 30 || q.dakika > 16 * 60) return false;
  const yas = +an - +zaman;
  // Seans içinde 15 dk'dan eski quote canlı sayılmaz. Kapanıştan sonra aynı
  // günün son düzenli seans fiyatı kullanılabilir; sonraki güne taşınamaz.
  return yas >= 0 && (simdi.dakika >= 16 * 60 || yas <= 15 * 60_000);
}

export function bugunBildir(gun, an = new Date()) {
  return gun === nySaat(an).gun && islemGunu(gun);
}

export function kapanmisIslemBari(gun, canli, an = new Date()) {
  const saat = nySaat(an);
  return islemGunu(gun) && (gun < saat.gun ||
    (gun === saat.gun && canli && saat.dakika >= 16 * 60 + 5));
}
