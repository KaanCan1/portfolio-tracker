/* 10-mobil-pano.js — mobilde Genel sekmesinin ilk ekranı.
 * app.js'in SIRALI dilimi; klasik script, global kapsamı paylaşır (bkz. index.html).
 *
 * NEDEN VAR (3 Eyl 2026): telefonda uygulamayı açınca ilk karşılaşılan şey CNN korku
 * endeksiydi. Paranın nerede olduğunu görmek için iki ekran kaydırmak gerekiyordu:
 * hero kartı vardı ama piyasa göstergelerinin altında kalıyordu ve varlıklar üç ayrı
 * panele (cardsTop / cashGrid / tables) dağılmıştı. Midas'ın doğru yaptığı tek şey
 * sıralamadır: önce paran, sonra dağılımı, sonra piyasa.
 *
 * TEK KAYNAK KURALI: bu dosya HİÇBİR yeni hesap kurmaz. Hero toplamı, gün değişimi,
 * pozisyon değerleri — hepsi renderCards'ın zaten hesapladığı STATE'ten okunur.
 * Kendi toplamını kursaydı aynı sayının ikinci bir hesabı olurdu ve er geç ikisi
 * ayrışırdı (CLAUDE.md · "bir sayının iki hesabı varsa biri bozuktur"; 16 Ağu'da
 * ön yüz ve sunucu farklı toplam gösteriyordu). Tek istisna GRUPLAMA: altının dört ayrı
 * alım kaydı tek satırda toplanır — bu bir toplama, ayrı bir ölçüm değil.
 *
 * MASAÜSTÜNE DOKUNMAZ: bölüm ≤760px dışında display:none. Masaüstü yerleşimi
 * (cardsTop + donut + tables) olduğu gibi durur.
 */

/* Bir pozisyon satırının K/Z'si. Maliyet BİRİM maliyettir (costUSD/costTRY),
 * adetle çarpılır — ham holding'de toplam maliyet alanı yoktur. */
function mpKZ(deger, birimMaliyet, adet) {
  const maliyet = (Number(birimMaliyet) || 0) * (Number(adet) || 0);
  if (!(maliyet > 0) || deger == null) return { kz: null, pct: null, maliyet };
  const kz = deger - maliyet;
  return { kz, pct: (kz / maliyet) * 100, maliyet };
}

/* Altın: dört ayrı alım kaydı TEK satır. Kullanıcının isteği (3 Eyl) ve doğrusu da bu —
 * "kaç gram altınım var, ne durumda" tek soru; dört satır aynı soruyu dört kez soruyor.
 * Ağırlıklı ortalama maliyet: Σ(adet × birimMaliyet) ÷ Σadet. */
function mpAltinBirlestir(kayitlar) {
  let adet = 0, deger = 0, maliyet = 0, gunPct = null;
  for (const h of kayitlar) {
    const q = Number(h.quantity) || 0;
    adet += q;
    deger += Number(h.live?.marketValueTRY) || 0;
    maliyet += q * (Number(h.costTRY) || 0);
    if (gunPct == null && h.live?.gramChangePct != null) gunPct = h.live.gramChangePct;
  }
  if (!(adet > 0)) return null;
  const kz = maliyet > 0 ? deger - maliyet : null;
  return {
    adet, deger, maliyet, gunPct,
    ortMaliyet: maliyet / adet,
    kz, pct: kz != null && maliyet > 0 ? (kz / maliyet) * 100 : null,
    kayitSayisi: kayitlar.length,
  };
}

/* Satır: logo · sembol · adet×maliyet | değer · K/Z.
 * Renk YALNIZ K/Z'de (CLAUDE.md kural 3: açık pozisyonun K/Z'si sayılı istisnalardan).
 * Değer sütunu nötr basılır — o bir durum bilgisi, eylem çağrısı değil. */
function mpSatir({ id, sembol, alt, deger, degerMetin, kz, pct, renk, uyari, rozet }) {
  const kzMetin = kz == null ? "" :
    `<div class="mp-row-c ${kz >= 0 ? "up" : "down"}">${kz >= 0 ? "+" : "−"}${
      renk === "try" ? fmtTRY0(Math.abs(kz)) : fmtUSD0(Math.abs(kz))
    }${pct != null ? ` · %${Math.abs(pct).toFixed(2)}` : ""}</div>`;
  return `<button class="mp-row${uyari ? " uyari" : ""}"${id ? ` data-mp-pos="${id}"` : ""}>
    <span class="mp-logo" style="background:${mpLogoRenk(sembol)}">${mpLogoYazi(sembol)}</span>
    <span class="mp-row-m">
      <span class="mp-row-s">${sembol}${rozet || ""}</span>
      ${alt ? `<span class="mp-row-q">${alt}</span>` : ""}
    </span>
    <span class="mp-row-r">
      <span class="mp-row-v">${degerMetin ?? (renk === "try" ? fmtTRY0(deger) : fmtUSD0(deger))}</span>
      ${kzMetin}
    </span>
  </button>`;
}

/* Logo dairesi: gerçek marka logosu yok, sembolden türetilen sabit renk.
 * Rastgele DEĞİL — aynı sembol her açılışta aynı rengi alsın diye karakter toplamı. */
const MP_PALET = ["#2f6b45", "#1a6fd4", "#c9871f", "#8b5cf6", "#0e7490", "#be5a2e", "#4b5563", "#b03060"];
function mpLogoRenk(s) {
  const t = String(s || "?");
  if (t === "TL") return "#c8402f";
  if (t === "USD") return "#2f6b45";
  if (t === "EUR") return "#2b4a8b";
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return MP_PALET[h % MP_PALET.length];
}
const mpLogoYazi = (s) => {
  const t = String(s || "?");
  if (t === "TL") return "₺"; if (t === "USD") return "$"; if (t === "EUR") return "€";
  return t.slice(0, 2).toUpperCase();
};

/* Grup başlığı — solda ad, sağda grup toplamı ve K/Z'si. Midas'ın "BIST hisseleri
 * ₺4.773,75 / +₺1.182,55 (%32,93)" satırının karşılığı. Bu bilgi bugün üç ayrı
 * panele dağılmış durumda; burada satırların hemen üstünde duruyor. */
function mpGrupBasi(ad, toplam, kz, pct, renk, ekNot) {
  return `<div class="mp-grp-h">
    <span class="mp-grp-t">${ad}</span>
    <span class="mp-grp-r">
      <span class="mp-grp-v">${renk === "try" ? fmtTRY0(toplam) : fmtUSD0(toplam)}</span>
      ${kz != null
        ? `<span class="mp-grp-c ${kz >= 0 ? "up" : "down"}">${kz >= 0 ? "+" : "−"}${
            renk === "try" ? fmtTRY0(Math.abs(kz)) : fmtUSD0(Math.abs(kz))
          }${pct != null ? ` · %${Math.abs(pct).toFixed(2)}` : ""}</span>`
        : ekNot ? `<span class="mp-grp-c">${ekNot}</span>` : ""}
    </span>
  </div>`;
}

function renderMobilPano() {
  const el = $("#mobilPano");
  if (!el) return;
  const S = STATE || {};
  const fx = S.fx || {};
  const holdings = S.holdings || [];
  const usdtry = fx.usdtry || 0;

  // Veri gelmeden çizme: yarım dolu bir hero, boş bir hero'dan kötüdür.
  if (!holdings.length && !usdtry) { el.hidden = true; return; }
  el.hidden = false;

  /* ---------- HERO ----------
   * heroTotal ve gün değişimi renderCards'ta hesaplanıyor; oradaki değerler
   * MP_HERO'ya yazılıp buraya taşınır. Burada yeniden hesaplanmaz. */
  const H = window.MP_HERO || {};
  const toplamTRY = H.grandTotal ?? null;
  const gunTRY = H.dayTRY ?? null, gunPct = H.dayPct ?? null;
  const gizli = document.body.classList.contains("privacy");

  const heroBlok = toplamTRY == null ? "" : `
    <div class="mp-hero">
      <div class="mp-hero-lbl">Net değer
        <button class="mp-eye" id="mpPrivacy" type="button" aria-label="Tutarları gizle/göster">
          ${gizli
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 10 8 10 8a18 18 0 0 1-2.16 3.19M6.6 6.6A18 18 0 0 0 2 12s3 8 10 8a9 9 0 0 0 5.4-1.6"/><path d="M1 1l22 22"/></svg>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>`}
        </button>
      </div>
      <div class="mp-hero-val">${mpBuyukTutar(toplamTRY)}</div>
      ${gunTRY != null ? `<div class="mp-hero-sub">
        <span class="mp-hero-chg ${gunTRY >= 0 ? "up" : "down"}">${gunTRY >= 0 ? "+" : "−"}${fmtTRY0(Math.abs(gunTRY))}</span>
        <span class="mp-hero-per">${gunPct != null ? `${gunPct >= 0 ? "+" : "−"}%${Math.abs(gunPct).toFixed(2)}` : ""} bugün</span>
      </div>` : ""}
      ${usdtry ? `<div class="mp-hero-usd">≈ ${fmtUSD0(toplamTRY / usdtry)} · kur ${fmtNum(usdtry, 2)}</div>` : ""}
    </div>`;

  /* ---------- EYLEM PILL'LERİ ----------
   * Hepsi zaten var olan modalları açar; mobilde menülerin içinden çıkarılıp
   * baş parmağın ulaştığı yere alındı. */
  const pills = `<div class="mp-acts">
    <button class="mp-pill main" data-mp-act="varlik"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Varlık</button>
    <button class="mp-pill" data-mp-act="islem"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>İşlem</button>
    <button class="mp-pill" data-mp-act="akis">Para giriş/çıkış</button>
    <button class="mp-pill" data-mp-act="realize">Realize</button>
  </div>`;

  /* ---------- DURUM ŞERİDİ ----------
   * Midas'ta karşılığı yok, çünkü Midas bakiye gösterir; bu uygulama karar aldırır.
   * Kural 1 skoru + risk bütçesi + stopsuz pozisyon: üçü de zaten ölçülüyor,
   * mobilde üç ayrı panelin altında kalıyordu. */
  const durum = mpDurumSeridi();

  /* ---------- GRUPLAR — sıra: NAKİT → HİSSE → ALTIN → OPSİYON ----------
   * Nakit en üstte (kullanıcının isteği, 3 Eyl): "elimde ne kadar hazır para var"
   * alım kararının ilk girdisi ve şu an drawer'ın içinde gömülü duruyor. */
  const gruplar = [];

  // NAKİT
  const cash = S.cash || {};
  const nakitTL = (Number(cash.tl) || 0) + (Number(cash.usd) || 0) * usdtry + (Number(cash.eur) || 0) * (fx.eurtry || 0);
  const nakitPct = toplamTRY > 0 ? (nakitTL / toplamTRY) * 100 : null;
  const hedef = S.regime?.cashTarget || null;
  gruplar.push(`<section class="mp-grp">
    ${mpGrupBasi("Nakit", nakitTL, null, null, "try",
      `${nakitPct != null ? `%${nakitPct.toFixed(1)}` : ""}${hedef ? ` · hedef %${hedef}` : ""}`)}
    ${mpSatir({ sembol: "TL", deger: Number(cash.tl) || 0, degerMetin: fmtTRY(Number(cash.tl) || 0), renk: "try" })}
    ${mpSatir({ sembol: "USD", deger: Number(cash.usd) || 0, degerMetin: fmtUSD(Number(cash.usd) || 0),
      alt: usdtry ? `≈ ${fmtTRY0((Number(cash.usd) || 0) * usdtry)}` : "" })}
    ${mpSatir({ sembol: "EUR", deger: Number(cash.eur) || 0, degerMetin: `€${fmtNum(Number(cash.eur) || 0, 2)}`,
      alt: fx.eurtry ? `≈ ${fmtTRY0((Number(cash.eur) || 0) * (fx.eurtry || 0))}` : "" })}
  </section>`);

  // HİSSELER — TAMAMI. Katlama yok (kullanıcının isteği, 3 Eyl): "3 pozisyon daha"
  // linki, en aşağıdaki pozisyonu görünmez yapıyordu; portföy 7-10 satır, katlamaya
  // değecek uzunlukta değil. Tavan gerekirse Alfa Avı'ndaki gibi çip listesi kurulur.
  const hisseler = holdings.filter((h) => h.type === "stock" && h.live?.marketValueUSD != null);
  if (hisseler.length) {
    let gDeger = 0, gMaliyet = 0;
    const satirlar = hisseler
      .slice()
      .sort((a, b) => (b.live.marketValueUSD || 0) - (a.live.marketValueUSD || 0))
      .map((h) => {
        const deger = h.live.marketValueUSD;
        const { kz, pct, maliyet } = mpKZ(deger, h.costUSD, h.quantity);
        gDeger += deger; gMaliyet += maliyet;
        const stopDelindi = h.guard?.breached;
        return mpSatir({
          id: h.id, sembol: String(h.symbol).toUpperCase(),
          alt: `${fmtNum(h.quantity, h.quantity < 10 ? 2 : 0)} adet · ${fmtUSD(h.costUSD)}`,
          deger, kz, pct, uyari: stopDelindi,
          rozet: stopDelindi ? `<i class="mp-rozet">stop</i>` : "",
        });
      }).join("");
    const gKZ = gMaliyet > 0 ? gDeger - gMaliyet : null;
    gruplar.push(`<section class="mp-grp">
      ${mpGrupBasi("Hisseler", gDeger, gKZ, gKZ != null ? (gKZ / gMaliyet) * 100 : null)}
      ${satirlar}
    </section>`);
  }

  // ALTIN — dört alım kaydı tek satırda
  const altin = mpAltinBirlestir(holdings.filter((h) => h.type === "gold"));
  if (altin) {
    gruplar.push(`<section class="mp-grp">
      ${mpGrupBasi("Altın", altin.deger, altin.kz, altin.pct, "try")}
      ${mpSatir({
        sembol: "GRAM", deger: altin.deger, renk: "try",
        alt: `${fmtNum(altin.adet, 2)} gr · ort. ${fmtTRY0(altin.ortMaliyet)}${altin.kayitSayisi > 1 ? ` · ${altin.kayitSayisi} alım` : ""}`,
        kz: altin.kz, pct: altin.pct,
      })}
    </section>`);
  }

  /* OPSİYONLAR — sembol `underlying`, K/Z sunucunun plTRY/plPct'i.
   * Kendi K/Z hesabımı kurmuyorum: sunucu prim, kontrat çarpanı ve yönü zaten
   * çözmüş durumda (server.js opsiyon bloğu). Burada yeniden çarpsaydım short
   * pozisyonda ya da çarpan değişince iki sayı ayrışırdı. */
  const opsiyonlar = (S.options || []).filter((o) => o.valueTRY != null);
  if (opsiyonlar.length) {
    let oDeger = 0, oKZ = 0, oMaliyet = 0;
    const satirlar = opsiyonlar.map((o) => {
      oDeger += Number(o.valueTRY) || 0;
      oKZ += Number(o.plTRY) || 0;
      oMaliyet += Math.abs(Number(o.costTRY) || 0);
      const vade = o.dte != null ? ` · ${o.dte}g` : "";
      return mpSatir({
        sembol: String(o.underlying || "OPT").toUpperCase(), renk: "try", deger: o.valueTRY,
        alt: `${o.contracts > 1 ? `${o.contracts}× ` : ""}${o.strike ? `$${o.strike} ` : ""}${(o.kind || "").toUpperCase()}${o.expiry ? ` · ${fmtDate(o.expiry)}` : ""}${vade}`,
        kz: o.plTRY != null ? o.plTRY : null, pct: o.plPct != null ? o.plPct : null,
      });
    }).join("");
    gruplar.push(`<section class="mp-grp">
      ${mpGrupBasi("Opsiyonlar", oDeger, oMaliyet ? oKZ : null, oMaliyet ? (oKZ / oMaliyet) * 100 : null, "try")}
      ${satirlar}
    </section>`);
  }

  /* ---------- ÖLÇÜM KARTLARI ----------
   * Renk YOK: bunlar ölçüm, eylem değil (CLAUDE.md kural 3). QQQ farkının altındaki
   * mutabakat uyarısı, 28 Ağu'da kurulan girdi denetiminin mobil karşılığı. */
  const olcum = mpOlcumKartlari();

  el.innerHTML = heroBlok + pills + durum + gruplar.join("") + olcum;
  mpBagla(el);
}

/* Büyük tutar: kuruşlar soluk. Sayının kendisi bir bakışta okunsun, virgülden
 * sonrası gürültü yapmasın (Midas'ın hero'sundaki tek gerçek tipografi fikri). */
function mpBuyukTutar(tl) {
  const s = fmtTRY(tl);
  const i = s.lastIndexOf(",");
  return i < 0 ? s : `${s.slice(0, i)}<small>${s.slice(i)}</small>`;
}

/* Durum şeridi — üç ölçüm tek satırda. Hepsi zaten hesaplanmış, burada toplanıyor. */
function mpDurumSeridi() {
  const parca = [];
  // Üçü de mevcut kaynaklardan: STATE.rule1 (sunucu), RBUD.d (/api/risk-budget,
  // renderRiskBudget'ın önbelleği), holdings. Yeniden hesap yok.
  const r1 = STATE?.rule1?.score ?? null;
  if (r1 != null) parca.push(`Kural 1 skoru <b>${r1}/100</b>`);
  const rb = (typeof RBUD !== "undefined" && RBUD.d && RBUD.d.ratio != null) ? RBUD.d : null;
  if (rb) parca.push(`risk bütçesinin <b>%${Math.round(rb.ratio)}</b>'i kullanıldı`);
  const stopsuz = (STATE?.holdings || []).filter(
    (h) => h.type === "stock" && !h.guard && !(Number(h.planStop) > 0)).length;
  if (stopsuz) parca.push(`<b>${stopsuz}</b> pozisyonda stop yok`);
  if (!parca.length) return "";
  const uyari = stopsuz > 0 || (rb && rb.ratio >= 70);
  return `<button class="mp-status${uyari ? " warn" : ""}" data-mp-act="kural1">
    <span class="mp-dot"></span>
    <span class="mp-status-t">${parca.join(" · ")}</span>
    <span class="mp-chev">›</span>
  </button>`;
}

/* Ölçüm kartları. Değeri olmayan kart BASILMAZ — kanıtı olmayan bölüm var gibi
 * davranmaz (CLAUDE.md tasarım kuralı 1). */
function mpOlcumKartlari() {
  const kart = (lbl, val, sub) => `<div class="mp-mcard">
    <div class="mp-mc-l">${lbl}</div><div class="mp-mc-v">${val}</div>
    ${sub ? `<div class="mp-mc-s">${sub}</div>` : ""}</div>`;
  const k = [];

  const ay = typeof swingMonthRealize === "function" ? swingMonthRealize(new Date().toISOString().slice(0, 7)) : null;
  if (ay != null) k.push(kart("Bu ay realize", `${ay < 0 ? "−" : "+"}${fmtUSD0(Math.abs(ay))}`,
    typeof swProvenSub === "function" ? swProvenSub() : ""));

  const H = window.MP_HERO || {};
  if (H.unrealUSD != null) k.push(kart("Açık K/Z", `${H.unrealUSD < 0 ? "−" : "+"}${fmtUSD0(Math.abs(H.unrealUSD))}`,
    H.unrealPct != null ? `maliyetin %${Math.abs(H.unrealPct).toFixed(1)}'i` : ""));
  if (H.freePct != null) k.push(kart("Risksiz oran", `%${H.freePct.toFixed(0)}`,
    H.freeValue != null ? `${fmtUSD0(H.freeValue)} bedava değer` : ""));

  // QQQ farkı — Kıyas paneli zaten çekilmişse (Analiz'e girildiyse) göster.
  const K = window.KIYAS?.veri;
  if (K?.ok && K.hukum?.alfa != null) {
    const mut = K.mutabakatNotu?.ton === "bad";
    k.push(kart("QQQ farkı", `${K.hukum.alfa >= 0 ? "+" : "−"}${Math.abs(K.hukum.alfa).toFixed(1)}p`,
      mut ? `girdi mutabık değil ⚠` : `${K.n} ortak gün`));
  }
  if (!k.length) return "";
  return `<div class="mp-secline"><b>Ölçümler</b><span class="mp-ln"></span></div>
    <div class="mp-mcards">${k.join("")}</div>`;
}

/* Olay bağlama — her şey MEVCUT akışlara gider, yeni bir yol açılmaz. */
function mpBagla(el) {
  el.querySelectorAll("[data-mp-pos]").forEach((b) =>
    b.addEventListener("click", () => openPositionDetail(b.dataset.mpPos)));
  el.querySelector("#mpPrivacy")?.addEventListener("click", () => $("#privacyToggle")?.click());
  el.querySelectorAll("[data-mp-act]").forEach((b) =>
    b.addEventListener("click", () => {
      const a = b.dataset.mpAct;
      if (a === "varlik") $("#addBtn")?.click();
      else if (a === "islem") (typeof openTrades === "function" ? openTrades() : $("#addTradeBtn")?.click());
      else if (a === "akis") $("#addDepositBtn")?.click();
      else if (a === "realize") $("#r26AddBtn")?.click() ?? $("#realized2026")?.scrollIntoView({ behavior: "smooth" });
      else if (a === "kural1") $("#rule1Panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
}
