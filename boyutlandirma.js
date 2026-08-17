/* boyutlandirma.js — pozisyon adedi: TEK formül, tek yer.
 *
 * NEDEN VAR (17 Ağu 2026): formül iki yerde birebir kopyalanıyordu — `raAdet()`
 * (public/js/05) ve `swingSizeCalc()` (public/js/08). CLAUDE.md bunu "birebir aynı
 * tutulur" diye yazıyor, yani kural koda değil DİSİPLİNE yazılmıştı. Bu projede o
 * cümlenin sonu belli: bir sayının iki hesabı varsa biri bozulur.
 *
 * KORELASYON ÇARPANI — bu turda eklenen şey. Eski formül her pozisyonu tek başına
 * ölçüyordu: "sermayenin %1'i stopta risk". Altı pozisyonda bu sessizce "toplam %6
 * risk" demeye gelir ve o cümle YALNIZ pozisyonlar bağımsızsa doğrudur. Ölçüm
 * (docs/olcumler.md §16) bağımsızlık varsayımının riski 1,32 kat az gösterdiğini
 * buldu; aynı riski taşımak için pozisyonlar ~%24 küçülmeli.
 *
 * ÇARPAN, TAVAN DEĞİL — karar ve gerekçesi:
 *   · Tavanı (tek pozisyon %25) düşürmek yalnız BÜYÜK pozisyonları bağlar; korelasyon
 *     cezası ise her pozisyona işler. Tavan yoğunlaşmayı sınırlar, korelasyonu değil;
 *     ikisi ayrı iş ve tavan olduğu gibi kalıyor.
 *   · Ölçüm çarpımsal bir oran üretti (σ_korelasyonlu / σ_bağımsız), toplamsal bir
 *     kesinti değil. Kararın biçimi ölçümün biçimini izler.
 *
 * ÇARPAN SABİT YAZILMAZ, TÜRETİLİR. 1,32 bugünkü altı pozisyonun bugünkü
 * ağırlıklarındaki değeri; docs/olcumler §16f açıkça "ikinci bir rejim görülmeden bu
 * oran sabit sanılmamalı" diyor. Sabit yazsam, portföy tek hisseye inse bile %24
 * kesmeye devam ederdim. `/api/risk` her istekte canlı kovaryanstan hesaplıyor.
 *
 * ÖLÇÜLMEDİYSE KESİNTİ YOK. Çarpan yoksa/1'in altındaysa 1 kabul edilir ve çağıran
 * `olculdu: false` görür — score-calibration.js'in kuralının aynısı: kanıt yoksa
 * çarpan 1 ama etiket "ölçülmedi" der. Uydurma bir kesinti, kesinti yapmamaktan kötüdür.
 */

export const TAVAN_PCT = 25;   // tek pozisyon tavanı (kaldıraçsız) — yoğunlaşma freni

/**
 * @param {object} g
 * @param {number} g.sermaye            risk sermayesi (USD)
 * @param {number} g.riskPct            pozisyon başına risk yüzdesi (1 = %1)
 * @param {number} g.giris              giriş fiyatı
 * @param {number} g.stop               stop fiyatı (giriş'in ALTINDA)
 * @param {number} [g.korelasyonCarpani] σ_korelasyonlu / σ_bağımsız (≥1). Yoksa kesinti yok.
 * @param {number} [g.tavanPct]         tek pozisyon tavanı, varsayılan 25
 * @returns {null|{adet:number, tavanDeydi:boolean, riskUSD:number, tutarUSD:number,
 *                 carpan:number, olculdu:boolean, carpansizAdet:number}}
 *          Girdi eksik/tutarsızsa null — çağıran "hesaplanamadı" der, 0 basmaz.
 */
export function adetHesapla({ sermaye, riskPct, giris, stop, korelasyonCarpani, tavanPct = TAVAN_PCT }) {
  if (!(sermaye > 0) || !(giris > 0) || !(stop > 0) || giris <= stop) return null;
  const rp = riskPct > 0 && riskPct <= 10 ? riskPct : 1;

  /* Çarpan yalnız 1'in ÜSTÜNDE anlamlı: korelasyon riski artırır, azaltmaz.
   * 1'in altında bir değer gelirse (gürültü ya da hatalı ölçüm) yok sayılır —
   * yoksa model pozisyonu BÜYÜTMEYİ önerir ve kesintinin yönü tersine döner. */
  const olculdu = Number.isFinite(korelasyonCarpani) && korelasyonCarpani > 1;
  const carpan = olculdu ? korelasyonCarpani : 1;

  const riskAmt = sermaye * (rp / 100);
  const birimRisk = giris - stop;
  const carpansizAdet = riskAmt / birimRisk;
  let adet = carpansizAdet / carpan;

  const tavanAdet = (sermaye * (tavanPct / 100)) / giris;
  const tavanDeydi = adet > tavanAdet;
  if (tavanDeydi) adet = tavanAdet;

  return {
    adet,
    tavanDeydi,
    riskUSD: adet * birimRisk,
    tutarUSD: adet * giris,
    carpan,
    olculdu,
    carpansizAdet,
  };
}

/**
 * Portföyün korelasyon çarpanı: aynı ağırlık ve aynı tek-tek volatilitelerle
 * "bağımsız olsalardı" ne kadar oynak görüneceğine kıyasla GERÇEK oynaklık.
 *
 * σ_bağımsız = √(Σ (wᵢ·σᵢ)²)   ·   çarpan = σ_gerçek / σ_bağımsız
 *
 * Pozitif korelasyonda çarpan > 1 olur ve tam olarak "bağımsızlık varsayımının
 * gizlediği risk"i verir. risk-mc.js'in iki-model karşılaştırmasının kapalı formu:
 * simülasyona gerek yok, çünkü ikisi de aynı kovaryanstan çıkıyor.
 *
 * @param {number[]} agirliklar   toplamı ~1
 * @param {number[]} sigmalar     pozisyon başına GÜNLÜK standart sapma
 * @param {number} sigmaGercek    portföyün gerçekleşmiş günlük standart sapması
 * @returns {{carpan:number, olculdu:boolean, sigmaBagimsiz:number}}
 */
export function korelasyonCarpaniHesapla(agirliklar, sigmalar, sigmaGercek) {
  if (!agirliklar?.length || agirliklar.length !== sigmalar?.length || !(sigmaGercek > 0)) {
    return { carpan: 1, olculdu: false, sigmaBagimsiz: 0 };
  }
  let kare = 0;
  for (let i = 0; i < agirliklar.length; i++) {
    const s = Number(sigmalar[i]);
    if (!Number.isFinite(s) || s < 0) return { carpan: 1, olculdu: false, sigmaBagimsiz: 0 };
    kare += (agirliklar[i] * s) ** 2;
  }
  const sigmaBagimsiz = Math.sqrt(kare);
  if (!(sigmaBagimsiz > 0)) return { carpan: 1, olculdu: false, sigmaBagimsiz: 0 };
  const carpan = sigmaGercek / sigmaBagimsiz;
  /* Tek pozisyonlu portföyde çarpan tanım gereği 1'dir — "ölçüldü" demek yanlış
   * olmaz ama kesinti de yoktur. 1'in altı ise negatif korelasyonun hakim olduğu
   * (ya da penceresi kısa) bir durum: kesinti yapmıyoruz, bkz. adetHesapla. */
  return { carpan, olculdu: carpan > 1, sigmaBagimsiz };
}
