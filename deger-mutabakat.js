/* deger-mutabakat.js — "endeksin gerisindesin" hükmünün GİRDİSİNİ denetler.
 *
 * 28 Ağu 2026: Kıyas paneli endekse karşı çift haneli bir geri kalış gösteriyordu.
 * Hesabın kendisi temizdi — USD bazlı, TWR, akış düzeltmeli (kayıtlı bir çekim ham
 * getiriyi eksiden artıya çeviriyor, yani düzeltme çalışıyor). Bozuk olan GİRDİYDİ:
 *
 *   Bir gün portföy sert düştü
 *   · o gün elde tutulan hisselerin çoğu YÜKSELMİŞTİ, endeks de artıdaydı
 *   · piyasa değeri o günün tek alımını doğru yansıtmıştı (ima edilen fiyat hareketi ~%0)
 *   · ama nakit, o alımın açıkladığından çok daha fazla düşmüştü
 *   · aradaki farkın ne satış, ne alış, ne kayıtlı akış karşılığı vardı
 *
 * O tek gün düzeltilince alfa üçte iki oranında toparlanıyor. Yani hükmün
 * büyük kısmı tek bir mutabakatsız kayıttan geliyordu. CLAUDE.md §15a'nın cümlesi:
 * "Sayının doğru hesaplanması, girdinin gerçek olduğunu göstermez."
 *
 * KİMLİK (bu modülün tamamı bundan türer):
 *   Δtotal = fiyatHareketi − komisyon + akış + cashAcik
 * cashAcik tanım gereği doğrudan getiriye girer. Sıfırdan farklıysa portföy o gün
 * ölçülmeyen bir sebeple değer değiştirmiştir.
 *
 * İKİ FARKLI ARIZA, İKİ FARKLI SONUÇ — karıştırma:
 *  · deger-acigi      : market tarafı işlemi doğru yansıtmış (ima edilen fiyat
 *                       hareketi makul) ama nakit tutmuyor → net değer gerçekten
 *                       sapmış, GETİRİ BOZULUR.
 *  · kayit-uyusmazligi: ima edilen fiyat hareketi imkânsız (%15+) → işlemin tarihi
 *                       snapshot'la uyuşmuyor (geriye dönük girilmiş satış). Net
 *                       değer muhtemelen doğru; bozuk olan İŞLEM DEFTERİ.
 *
 * Saf modül: DOM bilmez, fetch etmez, tarih/kur girdiden gelir.
 */

const g10 = (x) => String(x ?? "").slice(0, 10);
const say = (v) => (Number.isFinite(+v) ? +v : 0);

/** Nakit açığı bu $ eşiğinin altındaysa gürültü sayılır (kuruş yuvarlamaları, kısmi adet). */
export const ACIK_ESIGI = 25;
/** Bir günde ima edilen fiyat hareketi bunu aşarsa işlem kaydı snapshot'la uyuşmuyor demektir. */
export const IMA_TAVANI = 0.15;
/** Açık, o günün işlem hacminin bu kadarını buluyor ve İŞLEMLE AYNI YÖNDEYSE, açıklama
 *  "para kayboldu" değil "işlem nakde yansımamış"tır — kayıt ile anlık görüntü ayrışmıştır. */
export const YANSIMA_ORANI = 0.5;

/** Günlük kayıtları tekilleştirip sıralar: {d, total, market, cash, kur} — hepsi USD. */
export function gunlukSeri(snaps = [], baslangic = null) {
  const gun = new Map();
  for (const s of snaps) {
    const d = g10(s?.date);
    if (!d || !(s.total > 0) || !(s.usdtry > 0)) continue;
    if (baslangic && d < baslangic) continue;
    const kur = say(s.usdtry);
    gun.set(d, { d, kur, total: say(s.total) / kur, market: say(s.market) / kur, cash: say(s.cash) / kur });
  }
  return [...gun.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
}

/** Gün → {alim, satim, fee, semboller} (USD). Alış/satış brütü ayrı tutulur; komisyon nakitten ayrıca çıkar. */
export function islemGunleri(trades = []) {
  const m = new Map();
  for (const t of trades) {
    const d = g10(t?.date); if (!d) continue;
    const o = m.get(d) || { alim: 0, satim: 0, fee: 0, semboller: [] };
    const tutar = say(t.shares) * say(t.kind === "buy" ? t.buyUSD : t.sellUSD);
    if (t.kind === "buy") o.alim += tutar; else o.satim += tutar;
    o.fee += say(t.feeUSD);
    o.semboller.push((t.kind === "buy" ? "AL " : "SAT ") + String(t.symbol || "?").toUpperCase());
    m.set(d, o);
  }
  return m;
}

/** Gün → net akış (USD). Akış TRY kaydedilir, o günün kuruyla çevrilir. */
export function akisGunleri(flows = [], kurBul = () => 0) {
  const m = new Map();
  for (const f of flows) {
    const d = g10(f?.date); if (!d) continue;
    const kur = say(kurBul(d)); if (!(kur > 0)) continue;
    const yon = f.type === "withdraw" ? -1 : 1;
    m.set(d, (m.get(d) || 0) + (yon * say(f.amountTRY)) / kur);
  }
  return m;
}

/**
 * Gün gün mutabakat. Her satır: o günün nakit açığı, ima edilen fiyat hareketi ve
 * (varsa) arıza etiketi. `sahteGetiri` = açığın o günkü net değere oranı — hükmü
 * kaç puan kaydırdığını doğrudan verir.
 */
export function mutabakat({ snaps = [], trades = [], flows = [], baslangic = null, esik = ACIK_ESIGI, imaTavani = IMA_TAVANI } = {}) {
  const S = gunlukSeri(snaps, baslangic);
  if (S.length < 2) return { ok: false, neden: "kayit", n: S.length, gunler: [], karne: null };
  const kurHarita = new Map(S.map((s) => [s.d, s.kur]));
  const tr = islemGunleri(trades);
  const fl = akisGunleri(flows, (d) => kurHarita.get(d) ?? 0);

  const gunler = [];
  for (let i = 1; i < S.length; i++) {
    const a = S[i - 1], b = S[i];
    const o = tr.get(b.d) || { alim: 0, satim: 0, fee: 0, semboller: [] };
    const akis = fl.get(b.d) || 0;
    const netAlim = o.alim - o.satim;

    // Nakit kimliği: Δcash = −netAlım − komisyon + akış + açık
    const cashAcik = (b.cash - a.cash) - (-netAlim - o.fee) - akis;
    // Piyasa kimliği: Δmarket = fiyatHareketi + netAlım
    const imaFiyat = a.market > 0 ? (b.market - a.market - netAlim) / a.market : null;
    const sahteGetiri = a.total > 0 ? cashAcik / a.total : 0;

    /* Arıza tipi. İkisini ayırmak şart, çünkü kullanıcı için YAPILACAK İŞ farklı:
     * uyuşmazlıkta işlemin tarihi düzeltilir, değer açığında eksik para hareketi girilir.
     *
     * İki işaret uyuşmazlığa götürür:
     *  a) ima edilen fiyat hareketi imkânsız (%15+) — işlem piyasa tarafına hiç yansımamış
     *  b) açık, işlem hacminin yarısından fazlasını buluyor VE aynı yönde: satış nakdi
     *     girmemiş (satış → eksi açık) ya da alış nakitten çıkmamış (alış → artı açık)
     * (b) olmadan 29-30 Haz "para kayboldu" diye raporlanıyordu; oysa o iki günde satış
     * geliri nakde hiç geçmemişti — net değer değil defter hatalıydı. */
    let ariza = null;
    if (Math.abs(cashAcik) >= esik) {
      const hacim = o.alim + o.satim;
      const yonluYansima = hacim > 0 && Math.abs(cashAcik) >= hacim * YANSIMA_ORANI &&
        ((o.satim > o.alim && cashAcik < 0) || (o.alim > o.satim && cashAcik > 0));
      const imaAsti = imaFiyat != null && Math.abs(imaFiyat) > imaTavani;
      ariza = imaAsti || yonluYansima ? "kayit-uyusmazligi" : "deger-acigi";
    }
    gunler.push({
      d: b.d, cashAcik: +cashAcik.toFixed(2), imaFiyat: imaFiyat == null ? null : +imaFiyat.toFixed(4),
      sahteGetiri: +sahteGetiri.toFixed(4), akis: +akis.toFixed(2), netAlim: +netAlim.toFixed(2),
      fee: +o.fee.toFixed(2), semboller: o.semboller, ariza,
    });
  }

  const acik = gunler.filter((g) => g.ariza === "deger-acigi");
  const uyusmaz = gunler.filter((g) => g.ariza === "kayit-uyusmazligi");
  // Etki bileşik: günlük sapmaları çarpıp toplam getiriye kaç puan eklendiğini bulur.
  const bilesikEtki = acik.reduce((a, g) => a * (1 + g.sahteGetiri), 1) - 1;
  const enBuyuk = [...acik].sort((x, y) => Math.abs(y.sahteGetiri) - Math.abs(x.sahteGetiri))[0] || null;

  return {
    ok: true,
    n: gunler.length,
    d0: S[0].d, d1: S[S.length - 1].d,
    gunler,
    karne: {
      acikGun: acik.length,
      uyusmazGun: uyusmaz.length,
      acikToplam: +acik.reduce((a, g) => a + g.cashAcik, 0).toFixed(2),
      bilesikEtkiPuan: +(bilesikEtki * 100).toFixed(2),
      enBuyuk: enBuyuk && { d: enBuyuk.d, usd: enBuyuk.cashAcik, puan: +(enBuyuk.sahteGetiri * 100).toFixed(2) },
      temiz: acik.length === 0,
    },
  };
}

/**
 * Kıyas hükmünün ne kadar güvenilir olduğunu tek cümlede yazar.
 * Kural: ölçüm kendi kanıt kalitesini söyler; söylemezse okuyucu sayıya olduğundan
 * fazla güvenir (CLAUDE.md · "kanıtı olmayan bölüm var gibi davranmaz").
 */
export function mutabakatNotu(sonuc, alfaPuan = null) {
  if (!sonuc?.ok) return null;
  const k = sonuc.karne;
  if (k.temiz && !k.uyusmazGun) return { ton: "ok", metin: "Girdi mutabık: her günün değer değişimi işlem, komisyon ve para akışıyla açıklanıyor." };
  const p = [];
  if (k.acikGun) {
    const y = Math.abs(k.bilesikEtkiPuan);
    /* "Getirinin X puanı BUDUR" değil "BU KADARINA KADAR olabilir": açığın tamamı
     * sahte getiri olmayabilir (kayıtsız bir alım da açık üretir ve net değeri bozmaz).
     * Ölçemediğimiz şeye kesinlik giydirmek, düzeltmeye çalıştığımız hatanın aynısı. */
    p.push(`${k.acikGun} gün net değer, işlem ve akışla açıklanmıyor (toplam ${k.acikToplam < 0 ? "−" : "+"}$${Math.abs(k.acikToplam).toFixed(0)}` +
      (k.enBuyuk ? `, en büyüğü ${k.enBuyuk.d}: ${k.enBuyuk.puan < 0 ? "−" : "+"}${Math.abs(k.enBuyuk.puan).toFixed(1)} puan` : "") +
      `). Getirinin ${y.toFixed(1)} puana kadarı bu kayıtlardan geliyor olabilir` +
      (alfaPuan != null && Math.abs(alfaPuan) > 0.1
        ? y >= Math.abs(alfaPuan)
          ? ` — alfanın tamamı kadar, yani hükmün işareti bile değişebilir.`
          : `; alfanın %${Math.round((y / Math.abs(alfaPuan)) * 100)}'i kadar.`
        : "."));
  }
  if (k.uyusmazGun) p.push(`${k.uyusmazGun} günde işlem kaydı o günün anlık görüntüsüyle uyuşmuyor (geriye dönük girilmiş satış) — net değer etkilenmez, işlem defteri güvenilmez.`);
  return { ton: k.acikGun ? "bad" : "warn", metin: p.join(" ") };
}
