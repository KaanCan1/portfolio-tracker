/* 05-radar-view.js — Birleşik Hisse Radarı görünümü · swing tarayıcı UI · filtreler
 * app.js'in SIRALI dilimi (bölme: 15 Tem 2026). Dosyalar index.html'deki sırayla yüklenir;
 * klasik script'ler global kapsamı paylaşır — sıra değiştirme, dosyayı IIFE'ye sarma. */
/* ====================== Hisse Radarı (bağımsız yüklenir) ====================== */
let RADAR = { data: null, tier: "all", group: "all" };
const TIER_META = {
  strong:  { label: "GÜÇLÜ AL", cls: "t-strong" },
  buy:     { label: "AL",       cls: "t-buy" },
  watch:   { label: "İZLE",     cls: "t-watch" },
  neutral: { label: "NÖTR",     cls: "t-neutral" },
};

let radarPolls = 0;
async function loadRadarBoard() {
  try {
    const d = await (await fetch("/api/radar")).json();
    RADAR.data = d;
    renderRadarBoard();
    // Yalnızca aktif tarama sürerken tekrar çek (en çok ~15 kez). Tarama bitince
    // bazı semboller eksik kalsa bile sonsuz 8 sn'lik poll yapma — sayfa hafif kalsın.
    if (d.refreshing && radarPolls < 15) { radarPolls++; setTimeout(loadRadarBoard, 8000); }
    else radarPolls = 0;
  } catch {}
}

// Büyük sayıyı T/B/M ile kısalt ($1.2T, $345B …)
function fmtMcap(v) {
  if (v == null || !isFinite(v)) return "—";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(0)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${Math.round(v)}`;
}
const sgnPct = (v, d = 0) => (v == null || !isFinite(v) ? "—" : `<span class="${cls(v)}">${v >= 0 ? "+" : ""}${v.toFixed(d)}%</span>`);

const TREND_META = {
  hot:  { label: "↑↑ SICAK", cls: "tr-hot",  title: "Kısa + orta vade güçlü ralli, trend üstünde" },
  up:   { label: "↑ YÜKSELİŞ", cls: "tr-up", title: "Yükseliş trendinde, ılımlı momentum" },
  down: { label: "↓ DÜŞÜŞ", cls: "tr-down", title: "Kısa + orta vade negatif momentum" },
};

// Açılır detay: getiri · değerleme · büyüme/marj · analist · insider · 52h · model hedef
function radarDetail(s) {
  const cell = (label, val) => `<div class="rd-cell"><span class="rd-k">${label}</span><span class="rd-v">${val}</span></div>`;
  const rc = s.recoCounts || {};
  const recoLine = s.recoTotal
    ? `${rc.strongBuy || 0} güçlü-al · ${rc.buy || 0} al · ${rc.hold || 0} tut · ${(rc.sell || 0) + (rc.strongSell || 0)} sat (${s.recoTotal})`
    : "—";
  const io = s.insider || {};
  const insLine = (io.buys || io.sells)
    ? `${io.buys || 0} alım / ${io.sells || 0} satış · net ${io.netValue >= 0 ? "+" : "−"}$${(Math.abs(io.netValue || 0) / 1e6).toFixed(1)}M${io.lastBuy ? ` · son alım ${io.lastBuy}` : ""}`
    : "90 günde işlem yok";
  // Model hedef satırı — nasıl hesaplandığını da açıkça yaz
  const tgtLine = (s.target != null && s.price != null)
    ? `${fmtUSD(s.target)} <span class="${cls(s.upsidePct)}">(${s.upsidePct >= 0 ? "+" : ""}${s.upsidePct.toFixed(0)}% potansiyel)</span>` +
      `<span class="rd-basis">${(s.targetBasis && s.targetBasis.length) ? "model: " + s.targetBasis.join(" · ") : ""}</span>`
    : "—";
  // Swing kurulumu varsa: giriş/stop/hedef planı (birleşik tabloda swing segmenti buraya taşındı)
  const sw = s.swing;
  const swBlock = sw ? `<div class="rd-swing">${svgIcon("zap","ic-xs")} <b>Swing kurulumu — ${sw.setup?.label || sw.setup?.type || ""}:</b>
    Giriş <b>${fmtUSD(sw.entry)}</b>${sw.entryType ? ` <span class="muted">${ENTRY_TAG[sw.entryType] || ""}</span>` : ""} ·
    Stop <b class="neg">${fmtUSD(sw.stop)}${sw.riskPct != null ? ` (−${sw.riskPct.toFixed(1)}%)` : ""}</b> ·
    Hedef <b class="pos">${fmtUSD(sw.target)}${sw.rewardPct != null ? ` (+${sw.rewardPct.toFixed(1)}%)` : ""}</b> ·
    R/R <b>${sw.rr != null ? sw.rr.toFixed(1) + "R" : "—"}</b>${sw.grade ? ` · Kalite <span class="sw-grade ${GRADE_CLS[sw.grade] || "g-d"}">${sw.grade}</span>` : ""}
    ${sw.entry != null ? swFromBtn({ symbol: s.symbol, entry: sw.entry, stop: sw.stop, target: sw.target, note: sw.setup?.label || "" }) : ""}</div>` : "";
  // Satırdan detaya inen ölçülmemiş katman: karar kademesi, tema, 4 sinyal noktası.
  // Kaybolmadı, yalnız kararın önünden çekildi (14 Ağu).
  const tierD = TIER_META[s.tier?.key] || TIER_META.neutral;
  const dot = (key) => {
    const sg = (s.signals || []).find((x) => x.key === key) || {};
    return `<span class="rsig rsig-${sg.tone || "bad"}" title="${(sg.text || "").replace(/"/g, "")}">${sg.label || ""}</span>`;
  };
  const metaLine = `<div class="rd-meta">
    ${s.tier ? `<span class="rb-tier ${tierD.cls}">${tierD.label}</span>` : ""}
    ${s.theme ? `<span class="rb-theme rb-th-${s.theme.key || "other"}">${s.theme.title?.split(" · ")[0] || ""}</span>` : ""}
    <span class="rd-sigs">${dot("mom")}${dot("ana")}${dot("fun")}${dot("ins")}</span>
    <button class="btn icon rb-analiz" data-analiz="${s.symbol}" title="Teknik analizi aç / en güncel veriyle yenile">${svgIcon("refresh", "ic-sm")}</button>
  </div>`;
  return `<tr class="rb-detail" data-for="${s.symbol}" hidden><td colspan="4">
    ${swBlock}
    ${metaLine}
    ${s.story ? `<div class="rd-story"><b>Hikâye:</b> ${s.story}</div>` : ""}
    ${s.summaryText ? `<div class="rd-story rd-why"><b>Skor nereden geliyor?</b> ${s.summaryText}</div>` : ""}
    <div class="rd-grid">
      ${cell("1A", sgnPct(s.ret1M))}${cell("3A", sgnPct(s.ret3M))}${cell("6A", sgnPct(s.ret6M))}${cell("1Y", sgnPct(s.ret1Y))}${cell("YTD", sgnPct(s.retYTD))}
      ${cell("52h zirveye", sgnPct(s.fromHighPct))}
      ${cell("Piyasa değeri", fmtMcap(s.marketCap))}${cell("F/K", s.pe != null ? s.pe.toFixed(1) : "—")}${cell("PEG", s.pegYr != null ? s.pegYr.toFixed(2) : "—")}${cell("Beta", s.beta != null ? s.beta.toFixed(2) : "—")}
      ${cell("Gelir büyüme", sgnPct(s.revenueGrowth))}${cell("Kâr büyüme", sgnPct(s.earningsGrowth))}${cell("Brüt marj", s.grossMargin != null ? s.grossMargin.toFixed(0) + "%" : "—")}${cell("Net marj", s.profitMargin != null ? s.profitMargin.toFixed(0) + "%" : "—")}${cell("ROE", s.roe != null ? s.roe.toFixed(0) + "%" : "—")}
    </div>
    <div class="rd-row"><span class="rd-k">Model hedef (12A)</span><span class="rd-v">${tgtLine}</span></div>
    <div class="rd-row"><span class="rd-k">Analist</span><span class="rd-v">${recoLine}</span></div>
    <div class="rd-row"><span class="rd-k">Insider (90g)</span><span class="rd-v">${insLine}</span></div>
  </td></tr>`;
}

/* ===== Birleşik Radar — Tarama skoru omurga; Swing kurulumu + Cuma Hoca + Sinyal tek satırda =====
 * Radar (skorlu, cuma bayraklı) ile Swing (kurulum) sembolde birleştirilir. Aksiyon sıralaması:
 * yüksek skor + taze swing tetiği en üste ("şimdi girilebilir"). */
function raActionable(u) { return !!(u.swing && u.swing.entry != null && ["breakout", "pullback"].includes(u.swing.setup?.type)); }
function raCombo(u) { let s = u.score ?? 0; if (raActionable(u) && (u.score ?? 0) >= 50) s += 18; if (u.cuma) s += 1; return s; }
function buildUnifiedRadar() {
  const ra = RADAR.data?.items || [], sw = SWING.data?.items || [];
  const raBy = {}; for (const r of ra) raBy[r.symbol] = r;
  const swBy = {}; for (const s of sw) swBy[s.symbol] = s;
  // kapı: kurulum VARDI ama oynaklık/göreli güç eşiğine takıldı → listede kalsın,
  // sebebi görünsün. Sessizce kaybolan kurulum, gösterilmeyen bilgidir.
  const syms = [...new Set([...ra.map((r) => r.symbol), ...sw.filter((s) => s.setup || s.cuma || s.kapi).map((s) => s.symbol)])];
  return syms.map((sym) => {
    const r = raBy[sym], s = swBy[sym];
    const swing = (s && s.setup) ? { setup: s.setup, entry: s.entry, stop: s.stop, target: s.target, rr: s.rr, riskPct: s.riskPct, rewardPct: s.rewardPct, grade: s.grade, entryType: s.entryType, verdict: s.verdict, rsi: s.rsi } : null;
    const base = r || { symbol: sym, score: null, tier: null, signals: [], theme: null, name: s?.name || null, price: s?.price ?? null, dayChangePct: s?.dayChangePct ?? null };
    return { ...base, symbol: sym, cuma: !!(r?.cuma || s?.cuma), swing, kapi: s?.kapi || null };
  });
}
function unifiedRow(u) {
  const tr = TREND_META[u.trend];
  const dc = u.dayChangePct;
  const badges = `${u.cuma ? `<span class="rb-badge cuma" title="Cuma Hoca listesi">${svgIcon("star","ic-xs")}</span>` : ""}${raActionable(u) ? `<span class="rb-badge sig" title="Taze swing tetiği — bugün girilebilir kurulum">${svgIcon("activity","ic-xs")}</span>` : ""}`;
  const scoreCell = u.score != null
    ? `<div class="rb-scorewrap"><div class="rb-bar"><i style="width:${u.score}%"></i></div><b>${u.score}</b></div>`
    : `<span class="muted rb-noscore">—</span>`;
  const su = u.swing ? SETUP_META[u.swing.setup?.type] : null;
  const KAPI_ETIKET = { oynaklik: "çok oynak", "goreli-guc": "endeksin gerisinde" };
  const swCell = u.swing
    ? `<span class="rb-sw">${su ? `<span class="chip ${su.cls}">${u.swing.setup.label}</span>` : ""}${u.swing.entry != null ? `<span class="rb-sw-lv">gir ${fmtUSD(u.swing.entry)} · <span class="neg">${fmtUSD(u.swing.stop)}</span></span>` : ""}</span>`
    : u.kapi
      // Kurulum vardı, kapı düşürdü. Sessiz kırmızı DEĞİL: bu bir uyarı değil,
      // "neden burada kurulum yok" cevabı. Tam gerekçe title'da.
      ? `<span class="rb-kapi" title="${(u.kapi.sebep || "").replace(/"/g, "")}">kurulum kapıda elendi · ${KAPI_ETIKET[u.kapi.ad] || u.kapi.ad}</span>`
      : `<span class="muted">—</span>`;
  // 14 Ağu: satır 8 sütundu — tema, hedef fiyat, karar çipi ve 4 sinyal noktası
  // (momentum/analist/bilanço/insider) hep bir aradaydı. Bunların hiçbirinin para
  // kazandırdığı ÖLÇÜLMEDİ; kurulum + plan ise ölçülmüş kapıdan geçiyor. Ölçülmemiş
  // olan satırdan detaya indi (satıra tıkla), ölçülmüş olan öne çıktı.
  return `<tr class="rb-main" data-sym="${u.symbol}">
    <td class="l rb-sym">
      <span class="rb-caret">▸</span>
      <span class="sym">${u.symbol}</span>
      ${tr ? `<span class="rb-trend ${tr.cls}" title="${tr.title}">${tr.label}</span>` : ""}
      ${badges}
      <span class="rb-name">${u.name ? u.name.replace(/"/g, "") : ""}</span>
    </td>
    <td class="rb-price">${fmtUSD(u.price)}${dc != null ? `<span class="rb-dc ${cls(dc)}">${fmtPct(dc)}</span>` : ""}</td>
    <td class="rb-score">${scoreCell}</td>
    <td class="l rb-swcell">${swCell}</td>
  </tr>${radarDetail(u)}`;
}

/* ===== "Bugün girilebilir" plan kartları — 14 Ağu ============================
 * Radar sekmesi 8 sütunlu bir tabloydu: skor barı, karar çipi, 4 sinyal noktası,
 * tema çipi, hedef fiyat… Hiçbiri "bu hisseye şimdi girer miyim, kaç adet?"
 * sorusunu cevaplamıyordu; cevap için satırı açıp modalı açmak gerekiyordu.
 *
 * Bu projenin ÖLÇÜLMÜŞ tek edge'i kapılar (docs/olcumler.md · 12 Ağu). Skor
 * bileşenlerinin (momentum/analist/bilanço/insider) para kazandırdığı ölçülmedi.
 * O yüzden sekmenin başı artık kapıdan geçmiş, planı YAZILABİLİR kurulumlar:
 * giriş · stop · hedef · R/Ö · ADET · risk $ — hepsi kartın üstünde.
 * Adet hesabı Swing modalıyla AYNI formül (risk sermayesi × risk% ÷ 1R, tek
 * pozisyon %25 tavanı) — iki yerde iki farklı sayı çıkmasın. */
function raRiskPct() {
  const v = Number($("#raRiskPct")?.value);
  return v > 0 && v <= 10 ? v : (SWINGDECK?.goal?.riskPct || 1);
}
function raSermaye() {
  const portUSD = ALLOC.usdtry && ALLOC.grandTotalTRY ? ALLOC.grandTotalTRY / ALLOC.usdtry : null;
  const goal = SWINGDECK?.goal || {};
  return goal.capital > 0 ? goal.capital : portUSD;
}
/** Kaç adet? 17 Ağu: formül artık KOPYA DEĞİL — adetHesapla (01-cekirdek) tek yer.
 * swingSizeCalc de aynı fonksiyonu çağırıyor, iki farklı adet çıkması imkânsız.
 * Korelasyon çarpanı da orada uygulanıyor (bkz. docs/olcumler.md §16). */
function raAdet(entry, stop) {
  const r = adetHesapla({
    sermaye: raSermaye(), riskPct: raRiskPct(), giris: entry, stop,
    korelasyonCarpani: KORCARPAN.carpan,
  });
  return r && { shares: r.adet, capped: r.tavanDeydi, riskUSD: r.riskUSD, tutarUSD: r.tutarUSD };
}
function raPlanKarti(u) {
  const s = u.swing, su = SETUP_META[s.setup?.type];
  const sz = raAdet(s.entry, s.stop);
  const rr = s.rr != null ? s.rr : (s.stop != null && s.target != null && s.entry > s.stop ? (s.target - s.entry) / (s.entry - s.stop) : null);
  const enc = encodeURIComponent(JSON.stringify({ symbol: u.symbol, entry: s.entry, stop: s.stop ?? null, target: s.target ?? null, note: su ? su.label : "" }));
  return `<article class="rp-card" data-rp="${u.symbol}">
    <header class="rp-head">
      <div class="rp-id">
        <span class="rp-sym">${u.symbol}</span>
        ${su ? `<span class="rp-setup">${s.setup.label}</span>` : ""}
        ${u.cuma ? `<span class="rp-cuma" title="Cuma Hoca — TradingView güçlü yükseliş listesi">${svgIcon("star", "ic-xs")}</span>` : ""}
      </div>
      <div class="rp-px">${fmtUSD(u.price)}${u.dayChangePct != null ? `<span class="rp-dc ${cls(u.dayChangePct)}">${fmtPct(u.dayChangePct)}</span>` : ""}</div>
    </header>
    <div class="rp-name">${u.name ? u.name.replace(/"/g, "") : ""}</div>
    <div class="rp-lvls">
      <div class="rp-lvl"><span>Gir</span><b>${fmtUSD(s.entry)}</b></div>
      <div class="rp-lvl stop"><span>Stop</span><b>${s.stop != null ? fmtUSD(s.stop) : "—"}</b></div>
      <div class="rp-lvl tgt"><span>Hedef</span><b>${s.target != null ? fmtUSD(s.target) : "—"}</b></div>
      <div class="rp-lvl"><span>R/Ö</span><b>${rr != null ? rr.toFixed(1) : "—"}</b></div>
    </div>
    ${sz
      ? `<div class="rp-size">
           <span class="rp-size-n"><b>${fmtNum(sz.shares, sz.shares >= 10 ? 0 : 2)}</b> adet</span>
           <span class="rp-size-s">${fmtUSD0(sz.tutarUSD)} tutar · riskin <b>${fmtUSD0(sz.riskUSD)}</b>${sz.capped ? " · %25 tavanı" : ""}</span>
         </div>`
      : `<div class="rp-size none">Adet için stop ve risk sermayesi gerek</div>`}
    <footer class="rp-foot">
      <span class="rp-score" title="0–100 birleşik skor — ölçülmüş bir edge DEĞİL, başlangıç filtresi">skor ${u.score ?? "—"}</span>
      <span class="rp-acts">
        <button class="btn ghost sm" data-rp-chart="${u.symbol}">Grafik</button>
        <button class="btn primary sm" data-swfrom="${enc}">Swing aç</button>
      </span>
    </footer>
  </article>`;
}

function renderRadarBoard() {
  const el = $("#radarBoard");
  if (!el) return;
  const d = RADAR.data;
  if (!d && !SWING.data) { el.innerHTML = `<div class="radar-empty">Yükleniyor…</div>`; return; }

  const all = buildUnifiedRadar();

  const when = d?.updated ? new Date(d.updated).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
  // tema çubuğu
  const gbar = $("#radarGroups");
  if (gbar && d?.groups) {
    gbar.innerHTML = [{ key: "all", title: "Tüm temalar" }, ...d.groups].map((g) =>
      `<button class="rg-chip${RADAR.group === g.key ? " active" : ""}" data-group="${g.key}">${g.title}</button>`
    ).join("");
    gbar.querySelectorAll("[data-group]").forEach((b) =>
      b.addEventListener("click", () => { RADAR.group = b.dataset.group; renderRadarBoard(); }));
  }

  // ── Bölüm 1: planı yazılabilir kurulumlar. Eski "şimdi girilebilir" şeridi
  // yalnız sembol+giriş yazan 5 pill'di; adet/risk yoktu, karar için yetmiyordu.
  const girilebilir = all
    .filter((u) => u.swing && u.swing.entry != null && u.swing.stop != null && u.swing.entry > u.swing.stop)
    .sort((a, b) => raCombo(b) - raCombo(a))
    .slice(0, 8);
  const elenenN = all.filter((u) => u.kapi).length;
  const sermaye = raSermaye();
  const planlar = girilebilir.length
    ? `<div class="rp-grid">${girilebilir.map(raPlanKarti).join("")}</div>`
    : `<div class="radar-empty">Planı yazılabilir kurulum yok${elenenN ? ` — ${elenenN} kurulum kapıda elendi (oynaklık ya da endeksin gerisinde)` : ""}. Kurulum yoksa zorlamak sistemin dışına çıkmaktır.</div>`;
  const riskKutu = `<label class="ra-risk" title="Adet hesabında kullanılan risk yüzdesi — Swing modalıyla aynı formül">
      risk <input id="raRiskPct" type="number" step="0.1" min="0.1" max="10" value="${raRiskPct()}" /> %
      ${sermaye ? `<i>${fmtUSD0(sermaye)} sermaye</i>` : `<i>sermaye yok</i>`}
    </label>`;
  const kanitPlan = girilebilir.length
    ? `${girilebilir.length} kurulum · kapıdan geçti${elenenN ? ` · ${elenenN} elendi` : ""}`
    : elenenN ? `0 kurulum · ${elenenN} kapıda elendi` : "kurulum yok";
  const bolum1 = `<section class="sw2-sec">
    <header class="sw2-sec-h"><h3>Bugün girilebilir</h3><span class="sw2-sec-rule"></span>
      <span class="sw2-sec-n">${kanitPlan}</span>${riskKutu}</header>
    <div class="sw2-sec-body">${planlar}</div>
  </section>`;

  // filtre
  let items = all.slice();
  const t = RADAR.tier;
  if (t === "swing") items = items.filter((u) => u.swing);
  else if (t === "cuma") items = items.filter((u) => u.cuma);
  else if (t !== "all") items = items.filter((u) => u.tier?.key === t);
  if (RADAR.group !== "all") items = items.filter((u) => u.theme?.key === RADAR.group);
  items.sort((a, b) => raCombo(b) - raCombo(a)); // aksiyon sıralaması: skor + taze swing bonusu

  const table = items.length
    ? `<div class="tbl-wrap rb-wrap"><table class="rb-table">
        <thead><tr>
          <th class="l">Hisse</th><th>Fiyat</th><th>Skor</th><th class="l">Kurulum · plan</th>
        </tr></thead>
        <tbody>${items.map(unifiedRow).join("")}</tbody>
      </table></div>`
    : `<div class="radar-empty">${(d && d.count < d.total) ? "Tarama sürüyor, birazdan dolacak…" : "Bu filtreye uygun hisse yok."}</div>`;

  // ── Bölüm 2: tam liste. Tarama sonucunun tamamı burada durur ama artık sekmenin
  // başı değil sonu — gün içinde bakılan şey plan kartları, bu bir arşiv.
  const kanitListe = (d && d.count < d.total)
    ? `taranıyor… ${d.count}/${d.total}`
    : `${all.length} hisse · ${all.filter((u) => u.swing).length} kurulum${elenenN ? ` · ${elenenN} kapıda elendi` : ""}`;
  // Plan kartları panelin dışında, üstte; tablo panelin içinde kalır (kancalar bozulmasın)
  const planEl = $("#radarPlans");
  if (planEl) planEl.innerHTML = bolum1;
  el.innerHTML = table;
  const sub2 = $("#radarBoardSub");
  if (sub2) sub2.textContent = `${kanitListe} · son tarama ${when} · satıra tıkla: plan + skorun nereden geldiği`;

  // plan kartı eylemleri
  planEl?.querySelectorAll("[data-rp-chart]").forEach((b) =>
    b.addEventListener("click", (e) => { e.stopPropagation(); openChartModal(b.dataset.rpChart); }));
  const riskInp = planEl?.querySelector("#raRiskPct");
  if (riskInp) riskInp.addEventListener("input", () => {
    // yalnız kartların adet satırını tazele — tüm panoyu yeniden çizmek odağı kaçırır
    planEl.querySelectorAll(".rp-card").forEach((c) => {
      const u = all.find((x) => x.symbol === c.dataset.rp); if (!u) return;
      const sz = raAdet(u.swing.entry, u.swing.stop), box = c.querySelector(".rp-size");
      if (!box || !sz) return;
      box.innerHTML = `<span class="rp-size-n"><b>${fmtNum(sz.shares, sz.shares >= 10 ? 0 : 2)}</b> adet</span>
        <span class="rp-size-s">${fmtUSD0(sz.tutarUSD)} tutar · riskin <b>${fmtUSD0(sz.riskUSD)}</b>${sz.capped ? " · %25 tavanı" : ""}</span>`;
    });
  });
  // Satıra tıkla → detayını aç/kapat
  el.querySelectorAll("tr.rb-main").forEach((row) => {
    row.addEventListener("click", (e) => {
      const ab = e.target.closest("[data-analiz]");
      if (ab) { openChartModal(ab.dataset.analiz, null, true); return; } // teknik analizi yenile
      const det = row.nextElementSibling;
      if (!det || !det.classList.contains("rb-detail")) return;
      const open = det.hasAttribute("hidden");
      if (open) det.removeAttribute("hidden"); else det.setAttribute("hidden", "");
      row.classList.toggle("open", open);
    });
  });
}

$("#radarTiers")?.addEventListener("click", (e) => {
  const b = e.target.closest("[data-tier]");
  if (!b) return;
  RADAR.tier = b.dataset.tier;
  $("#radarTiers").querySelectorAll(".rt").forEach((x) => x.classList.toggle("active", x === b));
  renderRadarBoard();
});
$("#radarRefreshBtn")?.addEventListener("click", async () => {
  const btn = $("#radarRefreshBtn");
  btn.disabled = true; btn.textContent = "↻ Taranıyor…";
  // Birleşik tablo: hem skor taramasını hem swing kurulum taramasını tazele
  try { await fetch("/api/radar/refresh", { method: "POST" }); } catch {}
  try { await load(); } catch {} // izleme/portföy senkronu
  setTimeout(() => { btn.disabled = false; btn.textContent = "↻ Tara"; loadRadarBoard(); loadSwingBoard(); }, 2000);
});

/* ---- Swing tarayıcı: filtre + tara + grafik modal kapatma ---- */
$("#swingFilters")?.addEventListener("click", (e) => {
  const b = e.target.closest("[data-sf]");
  if (!b) return;
  SWING.filter = b.dataset.sf;
  $("#swingFilters").querySelectorAll(".rt").forEach((x) => x.classList.toggle("active", x === b));
  renderSwingBoard();
});
$("#swingRefreshBtn")?.addEventListener("click", async () => {
  const btn = $("#swingRefreshBtn");
  btn.disabled = true; btn.textContent = "↻ Taranıyor…";
  // izleme/portföy senkronu için portföyü de yenile, sonra board'u çek
  try { await load(); } catch {}
  setTimeout(() => { btn.disabled = false; btn.textContent = "↻ Tara"; loadSwingBoard(); }, 1500);
});
// Fırsat Radarı'ndaki kısa vade fırsat kartları → grafik modalı (delege)
$("#radar")?.addEventListener("click", (e) => {
  const o = e.target.closest(".fr-opp");
  if (o && o.dataset.sym) openChartModal(o.dataset.sym);
});

// Swing tablo tıklamaları #swing üzerinde delege edilir (yeniden çizime dayanıklı)
$("#swing")?.addEventListener("click", (e) => {
  const del = e.target.closest("[data-delwatch]");
  if (del) { e.stopPropagation(); delWatch(del.dataset.delwatch); return; }
  const row = e.target.closest("tr.sw-row");
  if (row) openChartModal(row.dataset.sym);
});

// Cuma seçtikleri: yeniden tara + kart tıklaması → grafik (delege)
$("#cumaRefreshBtn")?.addEventListener("click", async () => {
  const btn = $("#cumaRefreshBtn"); btn.disabled = true; btn.textContent = "↻ Taranıyor…";
  try { await load(); } catch {}
  setTimeout(() => { btn.disabled = false; btn.textContent = "↻ Tara"; loadSwingBoard(); loadCuma(); }, 1500);
});
$("#cumaGrid")?.addEventListener("click", (e) => {
  const card = e.target.closest(".cuma-card");
  if (card?.dataset.sym) openChartModal(card.dataset.sym);
});
// Haftalık Fırsatlar: kart/grafik tıklaması (delege) + yeniden tara
$("#opps")?.addEventListener("click", (e) => {
  if (e.target.closest(".opp-news-row")) return; // haber linki kendi sekmesinde açılsın
  // Grafik butonu → modal (hero & genişletilmiş satır)
  if (e.target.closest(".opp-chart")) {
    const host = e.target.closest("[data-sym]");
    if (host?.dataset.sym) openChartModal(host.dataset.sym);
    return;
  }
  // Tablo satırı başlığı → genişlet/daralt
  const head = e.target.closest(".opp-row-head");
  if (head) {
    const row = head.closest(".opp-row");
    const detail = row.querySelector(".opp-row-detail");
    const open = row.classList.toggle("open");
    head.setAttribute("aria-expanded", open ? "true" : "false");
    if (detail) detail.hidden = !open;
    return;
  }
});
// Nöbet şeridindeki sembole tıkla → ilgili karta/satıra kaydır + vurgula (kapalıysa aç)
$("#oppWatchSyms")?.addEventListener("click", (e) => {
  const chip = e.target.closest(".ows-chip");
  if (!chip?.dataset.seek) return;
  const card = document.querySelector(`#opps [data-sym="${chip.dataset.seek}"]`);
  if (card) {
    if (card.classList.contains("opp-row") && !card.classList.contains("open")) {
      card.querySelector(".opp-row-head")?.click();
    }
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("seek-flash");
    setTimeout(() => card.classList.remove("seek-flash"), 1200);
  }
});
$("#oppRefreshBtn")?.addEventListener("click", async () => {
  const btn = $("#oppRefreshBtn");
  btn.disabled = true; btn.textContent = "↻ Taranıyor…";
  try { await load(); } catch {}
  setTimeout(() => { btn.disabled = false; btn.textContent = "↻ Tara"; loadOpportunities(); }, 1500);
});
$("#cmClose")?.addEventListener("click", closeChartModal);
$("#cmRefresh")?.addEventListener("click", () => {
  if (!cmCurrent.sym) return;
  const b = $("#cmRefresh"); b.disabled = true; b.textContent = "↻ Hesaplanıyor…";
  openChartModal(cmCurrent.sym, cmCurrent.ctx, true).finally(() => { b.disabled = false; b.textContent = "↻ Analizi Yenile"; });
});
$("#chartModalBg")?.addEventListener("click", (e) => { if (e.target.id === "chartModalBg") closeChartModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeChartModal(); });

