/* Portföy performansı: dış para hareketlerini getiriden ayıran saf hesap.
 * TWR günlük kapanışlarla yaklaşık hesaplanır; aynı gün içindeki alım/satım,
 * temettü ve kur hareketi içeride kalır. Yalnız portföye dışarıdan giren/çıkan
 * para akışları çıkarılır. Kayıt dışı çekim bu yöntemle düzeltilemez. */

const gun = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "").slice(0, 10)) ? String(v).slice(0, 10) : null;

export function akisUSD(f, kur) {
  const miktar = Number(f?.amount);
  const tryKarsiligi = Number(f?.amountTRY);
  if (f?.currency === "USD" && Number.isFinite(miktar) && miktar > 0) return miktar;
  if (f?.currency === "TL" && Number.isFinite(miktar) && miktar > 0) return miktar / kur;
  if (Number.isFinite(tryKarsiligi) && tryKarsiligi > 0) return tryKarsiligi / kur;
  return null;
}

function pencere(noktalar, flows, ilk, fallback = false) {
  if (!ilk || noktalar.length < 2) return null;
  const secili = noktalar.slice(ilk.index);
  if (secili.length < 2) return null;
  let zincir = 1, akisToplam = 0, akisN = 0;
  const series = [{ date: secili[0].date, index: 100, pct: 0 }];
  for (let i = 1; i < secili.length; i++) {
    const onceki = secili[i - 1], simdi = secili[i];
    let akis = 0;
    // Açılış değeri bugünkü nakdi zaten içeriyorsa aynı günkü akış yeniden
    // çıkarılmaz; diğer tüm pencerelerde para hareketi sonraki kapanışa taşınır.
    if (!fallback) for (const f of flows) {
      const tarih = gun(f?.date);
      if (!tarih || tarih <= onceki.date || tarih > simdi.date) continue;
      const usd = akisUSD(f, simdi.usdtry);
      if (usd == null) return { ok: false, reason: "akis_kuru" };
      akis += (f.type === "withdraw" ? -1 : 1) * usd;
      akisN++;
    }
    const oran = (simdi.usd - akis) / onceki.usd;
    if (!Number.isFinite(oran) || oran < 0) return { ok: false, reason: "deger" };
    zincir *= oran;
    akisToplam += akis;
    series.push({ date: simdi.date, index: zincir * 100, pct: (zincir - 1) * 100 });
  }
  const bas = secili[0], son = secili[secili.length - 1];
  return {
    ok: true, pct: (zincir - 1) * 100,
    gainUSD: son.usd - bas.usd - akisToplam,
    start: bas.date, end: son.date, flowCount: akisN,
    approximate: true, series,
  };
}

export function performansHesapla({ snapshots = [], flows = [], current, dayOpen = null, today, baslangic = "2026-06-01" } = {}) {
  const tarih = gun(today);
  const canliToplam = Number(current?.total), canliKur = Number(current?.usdtry);
  if (!tarih || !(canliToplam > 0) || !(canliKur > 0)) return null;
  const gunler = new Map();
  for (const s of snapshots) {
    const d = gun(s?.date), total = Number(s?.total), kur = Number(s?.usdtry);
    if (d && d <= tarih && total > 0 && kur > 0) gunler.set(d, { date: d, usd: total / kur, usdtry: kur });
  }
  // Son noktada her zaman güncel değerleme kullanılır; bugünkü eski snapshot
  // para çıkışından önceyse ekranda hayali bir performans oluşmaz.
  gunler.set(tarih, { date: tarih, usd: canliToplam / canliKur, usdtry: canliKur });
  const noktalar = [...gunler.values()].sort((a, b) => a.date.localeCompare(b.date));
  const onceki = noktalar.findLastIndex((s) => s.date < tarih);
  const sonGun = onceki >= 0 ? { index: onceki } : null;
  const cutoff = (days) => new Date(Date.parse(`${tarih}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
  const once = (date) => { const index = noktalar.findLastIndex((s) => s.date <= date); return index >= 0 ? { index } : null; };
  const ilk = (date) => { const index = noktalar.findIndex((s) => s.date >= date); return index >= 0 && index < noktalar.length - 1 ? { index } : null; };
  const sonGunlerden = (days) => {
    const tarihSiniri = cutoff(days);
    return baslangic && tarihSiniri < baslangic ? null : pencere(noktalar, flows, once(tarihSiniri));
  };
  const ytd = `${tarih.slice(0, 4)}-01-01`;
  let day = pencere(noktalar, flows, sonGun);
  if (!day && Number(dayOpen?.total) > 0) {
    const acilis = { date: tarih, usd: Number(dayOpen.total) / (Number(dayOpen.usdtry) || canliKur), usdtry: Number(dayOpen.usdtry) || canliKur };
    day = pencere([acilis, noktalar[noktalar.length - 1]], flows, { index: 0 }, true);
  }
  return {
    currency: "USD", method: "daily_twr",
    day, week: sonGunlerden(7),
    month: sonGunlerden(30),
    quarter: sonGunlerden(90),
    half: sonGunlerden(180),
    year: sonGunlerden(365),
    // Ölçüm tabanından önceki geriye doldurulmuş yıl kaydını
    // "yıl başı getirisi" diye sunma.
    ytd: baslangic && baslangic > ytd ? null : pencere(noktalar, flows, ilk(ytd)),
    since: pencere(noktalar, flows, ilk(baslangic)),
  };
}

/** Nakit mutabakatı açık kalan dönemin getirisini kesin sonuç diye sunma. */
export function performansDogrula(performance, auditDays = []) {
  if (!performance) return null;
  const issues = auditDays.filter((g) => g.ariza === "deger-acigi");
  const out = { ...performance };
  for (const key of ["day", "week", "month", "quarter", "half", "year", "ytd", "since"]) {
    const p = performance[key];
    if (!p?.ok) continue;
    const unmatched = issues.filter((g) => g.d > p.start && g.d <= p.end);
    out[key] = { ...p, verified: unmatched.length === 0, unexplainedCount: unmatched.length };
  }
  out.unexplained = issues
    .sort((a, b) => Math.abs(b.cashAcik) - Math.abs(a.cashAcik))
    .map((g) => ({ date: g.d, usd: g.cashAcik }));
  return out;
}
