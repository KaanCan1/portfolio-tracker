/* 09-boot-notlar-ai.js — büyüme/sıfır-maliyet · görünüm yönlendirme + AÇILIŞ (boot) · gizlilik modu · hisse notları · Claude AI katmanı · grafik çizim araçları
 * app.js'in SIRALI dilimi (bölme: 15 Tem 2026). Dosyalar index.html'deki sırayla yüklenir;
 * klasik script'ler global kapsamı paylaşır — sıra değiştirme, dosyayı IIFE'ye sarma. */
/* ============================ Büyüme / Sıfır-Maliyet Motoru ============================
 * Tez: kâra geçince ana parayı çek, kârı "bedava pozisyon" olarak bırak → risksiz büyüme.
 * Etkin maliyet = pozisyon maliyeti − o sembolden realize edilen kâr. ≤0 ise pozisyon bedava.
 * Veri tamamen STATE'ten (holdings + REALIZED_USD + trades + history) — ek fetch yok. */
function freeRollOf(h) {
  const qty = Number(h.quantity) || 0;
  const avg = Number(h.costUSD);
  const price = h.live?.priceUSD ?? null;
  const mvUSD = h.live?.marketValueUSD ?? (price != null ? qty * price : null);
  const costBasis = avg > 0 ? avg * qty : null;          // USD ana para
  const realized = REALIZED_USD[String(h.symbol).toUpperCase()] || 0;
  const effCost = costBasis != null ? costBasis - realized : null; // etkin (kalan) ana para
  const recovered = costBasis ? Math.max(0, Math.min(100, (realized / costBasis) * 100)) : null;
  const free = effCost != null && effCost <= 0 && qty > 0; // ana parayı tamamen geri almış
  const unreal = mvUSD != null && costBasis != null ? mvUSD - costBasis : null;
  // "Ana parayı çek" aksiyonu: kalan ana parayı ($effCost) nakde çevirmek için satılacak adet
  let sellShares = null, cashOut = null, remainShares = null, remainValue = null;
  if (!free && effCost > 0 && price > 0 && mvUSD != null && mvUSD > effCost) {
    sellShares = Math.min(qty, effCost / price);
    cashOut = sellShares * price;        // ≈ kalan ana paran (cebe)
    remainShares = qty - sellShares;
    remainValue = remainShares * price;  // bedava binecek kısım (≈ kârın)
  }
  return { qty, avg, price, mvUSD, costBasis, realized, effCost, recovered, free, unreal,
    sellShares, cashOut, remainShares, remainValue, profitable: price > 0 && avg > 0 && price > avg };
}

function renderGrowth() {
  const el = $("#growthDeck");
  if (!el) return;
  if (!STATE) { el.innerHTML = `<div class="radar-empty">↻ Portföy yükleniyor… (önce Genel Bakış)</div>`; return; }
  const stocks = (STATE.holdings || []).filter((h) => h.type === "stock");
  const rows = stocks.map((h) => ({ h, fr: freeRollOf(h) })).filter((x) => x.fr.costBasis != null);
  const pos = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "");

  // ---- portföy toplamları ----
  let totalMV = 0, totalAtRisk = 0, freeValue = 0, totalCostBasis = 0;
  for (const { fr } of rows) {
    if (fr.mvUSD) totalMV += fr.mvUSD;
    totalAtRisk += Math.max(0, fr.effCost || 0);
    totalCostBasis += fr.costBasis || 0;
    if (fr.free && fr.mvUSD) freeValue += fr.mvUSD;
  }
  const houseMoney = Math.max(0, totalMV - totalAtRisk);   // riskte olmayan (bedava/kâr) değer
  const freePct = totalMV > 0 ? (houseMoney / totalMV) * 100 : 0;
  const totalLocked = Object.values(REALIZED_USD).reduce((a, b) => a + (b || 0), 0); // toplam çekilmiş/realize kâr
  const freeCount = rows.filter((x) => x.fr.free).length;
  const nearCount = rows.filter((x) => !x.fr.free && x.fr.recovered >= 50).length;

  // ---- HERO ----
  const hero = `
    <div class="gr-hero">
      <div class="gr-mini gr-accent">
        <div class="gr-mini-lbl">🎁 Bedava Pozisyon Değeri</div>
        <div class="gr-mini-val pos">${fmtUSD0(freeValue)}</div>
        <div class="gr-mini-sub">${freeCount} pozisyon riskini sıfırladı</div>
      </div>
      <div class="gr-mini">
        <div class="gr-mini-lbl">Riskteki Ana Para</div>
        <div class="gr-mini-val">${fmtUSD0(totalAtRisk)}</div>
        <div class="gr-mini-sub">hâlâ geri alınmamış sermaye</div>
      </div>
      <div class="gr-mini">
        <div class="gr-mini-lbl">Kilitli Kâr (toplam realize)</div>
        <div class="gr-mini-val ${pos(totalLocked)}">${fmtUSD0(totalLocked)}</div>
        <div class="gr-mini-sub">cebe giren, kaybedilemez</div>
      </div>
      <div class="gr-mini">
        <div class="gr-mini-lbl">Bedava Oran</div>
        <div class="gr-mini-val">${freePct.toFixed(0)}<span class="gr-pctsign">%</span></div>
        <div class="gr-mini-sub">hisse değerinin risksiz kısmı</div>
      </div>
    </div>`;

  // ---- Sermaye ayrışması: riskteki ana para vs bedava/kâr ----
  const atRiskPct = totalMV > 0 ? (totalAtRisk / totalMV) * 100 : 0;
  const decomp = `
    <section class="panel">
      <div class="panel-head">
        <div><h2>Sermaye Ayrışması</h2>
        <span class="chart-sub">Toplam hisse değerinin ne kadarı hâlâ riskte, ne kadarı bedava (kâr yastığı)</span></div>
      </div>
      <div class="gr-split">
        <div class="gr-split-bar">
          <div class="gr-split-risk" style="width:${atRiskPct.toFixed(1)}%"></div>
          <div class="gr-split-free" style="width:${(100 - atRiskPct).toFixed(1)}%"></div>
        </div>
        <div class="gr-split-legend">
          <span><i class="dot risk"></i> Riskteki ana para <b>${fmtUSD0(totalAtRisk)}</b> · %${atRiskPct.toFixed(0)}</span>
          <span><i class="dot free"></i> Risksiz kısım (kâr yastığı) <b>${fmtUSD0(houseMoney)}</b> · %${(100 - atRiskPct).toFixed(0)}</span>
        </div>
      </div>
    </section>`;

  // ---- Pozisyon başına geri-kazanım + free-roll önerisi ----
  const ranked = [...rows].sort((a, b) => (b.fr.recovered ?? -1) - (a.fr.recovered ?? -1));
  const cards = ranked.map(({ h, fr }) => {
    const sym = h.symbol;
    const bar = `<div class="gr-rec"><div class="gr-rec-fill ${fr.free ? "done" : ""}" style="width:${Math.min(100, fr.recovered || 0).toFixed(0)}%"></div></div>`;
    let action;
    if (fr.free) {
      action = `<div class="gr-action free">🎁 Bedava pozisyon — ana paranı geri aldın, kalan ${fmtNum(fr.qty, 2)} adet (${fmtUSD0(fr.mvUSD)}) tamamen kâr. Artık sadece kazanırsın.</div>`;
    } else if (fr.sellShares != null) {
      action = `<div class="gr-action go">Ana paranı çek → <b>${fmtNum(fr.sellShares, 2)} adet sat</b> (≈${fmtUSD0(fr.cashOut)} cebe) · kalan <b>${fmtNum(fr.remainShares, 2)} adet</b> (${fmtUSD0(fr.remainValue)}) bedava biner.
        <button class="btn ghost sm gr-trade" data-trade="${sym}">İşlem gir</button></div>`;
    } else {
      action = `<div class="gr-action wait">Henüz kârda değil — ana para çıkışı zararla olur. Tez bozulmadıysa bekle, stopuna sadık kal.</div>`;
    }
    return `
      <div class="gr-pos${fr.free ? " is-free" : ""}">
        <div class="gr-pos-top">
          <div class="gr-pos-id"><b>${sym}</b> <span class="gr-muted">${fmtNum(fr.qty, 2)} adet · ort $${fmtNum(fr.avg, 2)}</span></div>
          <div class="gr-pos-right">
            <span class="gr-eff ${fr.free ? "pos" : ""}" title="Etkin maliyet = ana para − realize kâr">etkin maliyet ${fmtUSD0(fr.effCost)}</span>
          </div>
        </div>
        ${bar}
        <div class="gr-pos-meta">
          <span>Ana para geri alımı: <b>${fr.recovered != null ? fr.recovered.toFixed(0) : 0}%</b></span>
          <span>Realize: <b class="${pos(fr.realized)}">${fmtUSD0(fr.realized)}</b></span>
          <span>Kâğıt K/Z: <b class="${pos(fr.unreal)}">${fr.unreal != null ? fmtUSD0(fr.unreal) : "—"}</b></span>
        </div>
        ${action}
      </div>`;
  }).join("");
  const engine = `
    <section class="panel">
      <div class="panel-head">
        <div><h2>Sıfır-Maliyet Motoru <span class="gr-chip">${freeCount} bedava · ${nearCount} yakın</span></h2>
        <span class="chart-sub">Her pozisyonun ana para geri alım durumu + "ne zaman/ne kadar sat" önerisi</span></div>
      </div>
      <div class="gr-pos-grid">${cards || `<div class="sw-empty">Portföyde maliyetli hisse pozisyonu yok. Genel Bakış'tan pozisyon ekleyince burada free-roll takibi başlar.</div>`}</div>
    </section>`;

  // ---- BÜYÜME zaman serisi: ay ay realize + net değer trendi (Haziran 2026'dan sabit 12 ay) ----
  const now = new Date();
  const months = trackMonths().map((m) => ({ ...m, total: 0 }));
  const mIdx = Object.fromEntries(months.map((m, i) => [m.key, i]));
  for (const t of (STATE.trades || [])) {
    if (t.kind !== "sell" || !t.date) continue;
    const key = String(t.date).slice(0, 7);
    if (key in mIdx) months[mIdx[key]].total += (Number(t.shares) || 0) * ((Number(t.sellUSD) || 0) - (Number(t.buyUSD) || 0));
  }
  // Kümülatif realize eğrisi — "büyümeyi gözlemle": her ay biriken kilitli kâr
  let run = 0;
  const cumPts = months.map((m) => ({ label: m.label, key: m.key, v: (run += m.total) }));
  const curKey2 = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const totalCum = run;
  const growth = `
    <section class="panel gr-growth-panel">
      <div class="panel-head">
        <div><h2>Büyüme Eğrisi <span class="gr-chip">12 ay</span></h2>
        <span class="chart-sub">Ay ay biriken kilitli kâr — tezin: kârı cebe koy, ana parayı büyüt</span></div>
        <div class="gr-growth-tot ${pos(totalCum)}">${totalCum >= 0 ? "+" : ""}${fmtUSD0(totalCum)}<span>toplam realize</span></div>
      </div>
      ${growthCurve(cumPts, curKey2)}
    </section>`;

  el.innerHTML = hero + decomp + growth + engine;
}
// Kümülatif büyüme eğrisi (SVG alan+çizgi) — aylar x, biriken realize y
function growthCurve(pts, curKey) {
  if (!pts || !pts.length) return `<div class="sw-empty">Henüz realize kâr yok — kâr aldıkça büyüme eğrisi burada birikir.</div>`;
  const W = 760, H = 210, PADX = 10, PADT = 16, PADB = 26;
  const vMin = Math.min(0, ...pts.map((p) => p.v)), vMax = Math.max(0, ...pts.map((p) => p.v));
  const span = Math.max(1, vMax - vMin);
  const X = (i) => PADX + (i / Math.max(1, pts.length - 1)) * (W - 2 * PADX);
  const Y = (v) => PADT + (1 - (v - vMin) / span) * (H - PADT - PADB);
  const P = pts.map((p, i) => [X(i), Y(p.v)]);
  const line = smoothPath(P);
  const zeroY = Y(0);
  const area = `${line} L ${X(pts.length - 1).toFixed(1)} ${zeroY.toFixed(1)} L ${X(0).toFixed(1)} ${zeroY.toFixed(1)} Z`;
  const dots = pts.map((p, i) => {
    const cur = p.key === curKey;
    return `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="${cur ? 4 : 2.5}" class="gr-gc-dot${cur ? " cur" : ""}"><title>${p.label}: ${fmtUSD0(p.v)} biriken</title></circle>`;
  }).join("");
  const labels = pts.map((p, i) => `<text x="${X(i).toFixed(1)}" y="${(H - 8).toFixed(1)}" class="gr-gc-x${p.key === curKey ? " cur" : ""}">${p.label}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="gr-gc-svg" preserveAspectRatio="xMidYMid meet" aria-label="Kümülatif büyüme eğrisi">
    <line x1="0" x2="${W}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}" class="gr-gc-zero"/>
    <path d="${area}" class="gr-gc-area"/>
    <path d="${line}" class="gr-gc-line"/>
    ${dots}${labels}
  </svg>`;
}
$("#growthDeck")?.addEventListener("click", (e) => {
  const b = e.target.closest(".gr-trade");
  if (b) openTrades(b.dataset.trade); // mevcut işlem/realize modalını aç (satışı oradan gir)
});

/* ====================== Sol menü: görünüm yönlendirme ====================== */
/* Qullamaggie tarayıcı GÖRÜNÜMÜ kaldırıldı (3 Tem 2026) — aynı işi Alfa Avı yapıyor:
 * QM evreni (Tarama+Cuma Hoca+portföy) challenge evrenine bağlandı, adaylar orada
 * $1.500 sanal hesapla GERÇEKTEN işleme dönüşüyor (giriş/stop/hedef otomatik ölçülür).
 * QM_SETUP/QM_STAGE ve qmChartPanel KALIR — grafik modalındaki QM paneli bunları kullanır. */
const QM_SETUP = {
  breakout: { lbl: "BREAKOUT", cls: "qm-s-bo" },
  ep: { lbl: "EPISODIC PIVOT", cls: "qm-s-ep" },
  watch: { lbl: "KISMİ EŞLEŞME", cls: "qm-s-watch" },
};
const QM_STAGE = {
  "breaking-out": { lbl: "🚀 KIRILIYOR", cls: "qm-st-go" },
  "setting-up": { lbl: "⏳ KURULUYOR", cls: "qm-st-set" },
  "extended": { lbl: "⚠️ GERGİN", cls: "qm-st-ext" },
  "early": { lbl: "• ERKEN", cls: "qm-st-early" },
};

// Grafik modalı için Qullamaggie paneli (d.qm'den) — "girmeli miyim, stop ne?"
function qmChartPanel(qm) {
  const rowQ = (k, val, c = "") => `<div class="cm-r"><span class="cm-k">${k}</span><span class="cm-v ${c}">${val}</span></div>`;
  if (!qm || !qm.ok || qm.setup === "none") {
    return `<div class="cm-qm cm-qm-none"><div class="cm-qm-h">🏆 Qullamaggie</div>
      <div class="cm-qm-verdict v-early">Şu an QM kurulumu yok — büyük hamle + sıkışma yok ya da ADR/likidite yetersiz. Zorlama, başka aday bekle (Kural 1).</div></div>`;
  }
  const su = QM_SETUP[qm.setup] || QM_SETUP.breakout;
  const stg = QM_STAGE[qm.stage] || QM_STAGE.early;
  const verdict = {
    "breaking-out": { cls: "go", txt: `✅ <b>Tetik aktif</b> — pivot ${fmtUSD(qm.pivotHigh)} kırılıyor. QM girişi: gün-içi <b>opening range high</b>'da al, stop <b>günün dibi</b> (≤1×ADR).` },
    "setting-up": { cls: "set", txt: `⏳ <b>Henüz girme — bekle.</b> Pivot <b>${fmtUSD(qm.pivotHigh)}</b> kırılana kadar dur (pivota %${qm.consolidation?.nearHighPct} kaldı). Kırarsa 1-2 ay swing adayı.` },
    "extended": { cls: "ext", txt: `⚠️ <b>Kovalama.</b> 10MA'dan ${qm.extendedOverMA10}×ADR uzak (gergin). Geri çekilip ortalamaya yaklaşınca tekrar değerlendir.` },
    "early": qm.setup === "watch"
      ? { cls: "early", txt: `👀 <b>Kısmi eşleşme.</b> +%${Math.round(qm.priorMovePct)} gerçek hamle var ama tam kurulum yok — henüz giriş sinyali değil, altta nedenini gör.` }
      : { cls: "early", txt: `• <b>Erken.</b> Hamle var ama pivottan uzak — sıkışma olgunlaşsın, izle.` },
  }[qm.stage] || { cls: "early", txt: "—" };
  const chk = (qm.checklist || []).map((c) => `<span class="qm-chk ${c.pass ? "ok" : "no"}" title="${esc(c.k)}: ${esc(String(c.val))}">${c.pass ? "✓" : "✕"} ${c.k}</span>`).join("");
  const why = (qm.reasons || []).map((r) => `<div>• ${r}</div>`).join("");
  return `<div class="cm-qm">
    <div class="cm-qm-h">🏆 Qullamaggie <span class="qm-setup ${su.cls}">${su.lbl}</span><span class="qm-stage ${stg.cls}">${stg.lbl}</span><span class="cm-qm-score">${qm.score}</span></div>
    <div class="cm-qm-verdict v-${verdict.cls}">${verdict.txt}</div>
    ${rowQ("Giriş (pivot kırılımı)", fmtUSD(qm.entryTrigger), "i-entry")}
    ${rowQ("Stop (≤1×ADR)", `${fmtUSD(qm.stop)} <span class="muted">−%${qm.stopPct}</span>`, "neg")}
    ${rowQ("Hedef 2R · 3R", `${fmtUSD(qm.rTargets.r2)} · ${fmtUSD(qm.rTargets.r3)}`, "pos")}
    ${rowQ("ADR · Önceki hamle", `%${qm.adrPct} · +%${Math.round(qm.priorMovePct)}`)}
    ${qmSizeLine(qm)}
    <div class="cm-qm-checks">${chk}</div>
    ${why ? `<div class="cm-qm-why">${why}</div>` : ""}
  </div>`;
}

// Swing pozisyon boyutu — QM giriş/stop'tan, nakit oranıyla çerçeveli
function qmSizeLine(qm) {
  const ps = positionSizing(qm.entryTrigger, qm.stop);
  if (!ps || ps.unknown) return "";
  const parts = ps.levels.map((L) =>
    `<b>%${L.posPct.toFixed(1)}</b> <span class="muted">(${L.riskPct === 0.01 ? "%1" : "%2"} risk · ${fmtUSD0(L.posVal)}${L.capped ? " · %25 sınır" : ""})</span>`).join(" · ");
  const cc = cashContext();
  const cashWarn = cc && cc.cashPct < cc.tgt[0] - 1
    ? ` <span class="neg">· nakit %${cc.cashPct.toFixed(0)} hedef altı, dikkat</span>` : "";
  return `<div class="cm-qm-size">📐 <b>Boyut:</b> ${parts}${cashWarn}</div>`;
}

const VIEWS = ["notlar", "genel", "swingdefteri", "buyume", "radar", "analiz", "challenge", "raporlar"];
const SWING_SEGS = ["swingdefteri", "buyume"]; // ⚡ Swing hub segmentleri (tek nav altında)
// Eski hash'ler (yer imi/paylaşılan link) → birleşik Radar + ilgili filtre
let pendingRadarFilter = null;
const RADAR_ALIASES = { firsat: "swing", hisse: "all", swing: "swing", tarama: "all", cuma: "cuma", sinyal: "swing", leopold: null };
function showView(name) {
  // Eski sekme adresi geldiyse Radar'a çevir, ilgili filtreyi hatırla
  if (name in RADAR_ALIASES) {
    const flt = RADAR_ALIASES[name];
    name = "radar";
    if (flt) pendingRadarFilter = flt;
  }
  if (!VIEWS.includes(name)) name = "genel";
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  // Nav: Swing hub (data-view=swingdefteri) 3 segmentin (defter/qm/büyüme) hepsinde aktif kalır
  document.querySelectorAll(".nav-item").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === name || (b.dataset.view === "swingdefteri" && SWING_SEGS.includes(name))));
  // Swing segment bar'larını senkronla
  if (SWING_SEGS.includes(name)) {
    document.querySelectorAll(".swing-seg .seg").forEach((b) => b.classList.toggle("active", b.dataset.swseg === name));
    try { localStorage.setItem("swingSeg", name); } catch {}
  }
  if (("#" + name) !== location.hash) history.replaceState(null, "", "#" + name);
  window.scrollTo(0, 0);
  $("#sidebar")?.classList.remove("open"); const _bd = $("#navBackdrop"); if (_bd) _bd.hidden = true; // mobilde menüyü kapat
  if (name === "notlar") loadNotes();
  if (name === "analiz") renderAnaliz();
  if (name === "challenge") { renderChallenge(); labInit(); }
  if (name === "raporlar") { renderDayAnalysis(); renderEdgeReports(); }
  if (name === "qm") { showView("challenge"); return; } // eski QM yer imleri → Alfa Avı
  if (name === "swingdefteri") loadSwingDeck();
  if (name === "buyume") renderGrowth();
  if (name === "radar" && pendingRadarFilter) {
    RADAR.tier = pendingRadarFilter; pendingRadarFilter = null;
    document.querySelectorAll("#radarTiers .rt").forEach((x) => x.classList.toggle("active", x.dataset.tier === RADAR.tier));
    renderRadarBoard();
  }
  requestAnimationFrame(() => buildViewJump(name));
}

/* Uzun sayfalarda yapışkan bölüm-atlama çubuğu — paneli başlıklardan otomatik üretir.
 * Hiçbir mevcut selektörü değiştirmez; sadece okur + üstte gezinme katmanı ekler. */
let _jumpObserver = null;
function jumpShort(t) {
  t = (t || "").replace(/\s+/g, " ").trim();
  const m = t.match(/^(\p{Extended_Pictographic}️?|\p{Emoji_Presentation}️?)/u);
  const emoji = m ? m[0] + " " : "";
  let rest = t.replace(/^(\p{Extended_Pictographic}️?|\p{Emoji_Presentation}️?)\s*/u, "");
  // başlığın ilk anlamlı kısmı — ayraçtan (&, /, ·, —, -) önce kes
  let label = rest.split(/\s*[&/·—–-]\s*/)[0].trim();
  const words = label.split(" ");
  if (words.length > 3) label = words.slice(0, 3).join(" ");
  if (label.length > 20) label = label.slice(0, 19) + "…";
  return emoji + label;
}
function buildViewJump(name) {
  const view = document.querySelector(".view.active");
  if (!view) return;
  view.querySelector(":scope > .view-jump")?.remove();
  if (_jumpObserver) { _jumpObserver.disconnect(); _jumpObserver = null; }
  const blocks = [...view.children]
    .flatMap((el) => el.classList.contains("duo-grid") ? [...el.children] : [el]) // yan yana panel çiftleri de sekme çipi alır
    .filter((el) =>
      !el.classList.contains("view-head") && !el.classList.contains("view-jump") &&
      (el.matches("section, .panel, .card, .home-drawer")));
  const items = [];
  blocks.forEach((b, i) => {
    let h = b.querySelector(".panel-head h2") || b.querySelector(":scope > h2") || b.querySelector(":scope > h3");
    let raw = "";
    if (h) { const tx = [...h.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").trim(); raw = (tx || h.textContent) || ""; }
    else { const lb = b.querySelector(":scope > .label, :scope > .card-label"); if (lb) raw = lb.textContent; }
    raw = raw.trim();
    if (!raw) return;
    if (!b.id) b.id = "vsec-" + name + "-" + i;
    items.push({ id: b.id, label: raw });
    b.style.scrollMarginTop = "60px";
  });
  if (items.length < 3) return; // kısa sayfada gerek yok
  const bar = document.createElement("div");
  bar.className = "view-jump";
  bar.innerHTML = items.map((it) => `<button class="vj-chip" data-jump="${it.id}">${jumpShort(it.label)}</button>`).join("");
  const head = view.querySelector(":scope > .view-head");
  if (head) head.after(bar); else view.prepend(bar);
  // Aktif bölümü vurgula (görünürdeki blok)
  _jumpObserver = new IntersectionObserver((ents) => {
    ents.forEach((en) => {
      if (!en.isIntersecting) return;
      bar.querySelectorAll(".vj-chip").forEach((c) => c.classList.toggle("active", c.dataset.jump === en.target.id));
    });
  }, { rootMargin: "-60px 0px -70% 0px", threshold: 0 });
  items.forEach((it) => { const el = document.getElementById(it.id); if (el) _jumpObserver.observe(el); });
}
// Chip → ilgili bölüme yumuşak kaydır
document.addEventListener("click", (e) => {
  const c = e.target.closest(".vj-chip"); if (!c) return;
  document.getElementById(c.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" });
});
// Radar birleşik tabloya indirildi (4 segment → tek skorlu liste); eski hash'ler filtreye yönlenir
$("#nav")?.addEventListener("click", (e) => {
  const b = e.target.closest(".nav-item");
  if (!b) return;
  // ⚡ Swing nav → HER ZAMAN Defter açılır (segment bar'dan Büyüme'ye geçilebilir)
  showView(b.dataset.view);
});
// Swing hub segment bar (Defter / Qullamaggie / Büyüme)
document.addEventListener("click", (e) => {
  const b = e.target.closest(".swing-seg .seg");
  if (b) showView(b.dataset.swseg);
});
window.addEventListener("hashchange", () => showView((location.hash || "").slice(1)));
// Mobil menü: hamburger açar/kapar; backdrop'a tıkla → kapat
function setNav(open) {
  $("#sidebar")?.classList.toggle("open", open);
  const bd = $("#navBackdrop"); if (bd) bd.hidden = !open;
}
$("#menuToggle")?.addEventListener("click", () => setNav(!$("#sidebar")?.classList.contains("open")));
$("#navBackdrop")?.addEventListener("click", () => setNav(false));
$("#logoutBtn")?.addEventListener("click", async () => {
  try { await fetch("/api/logout", { method: "POST" }); } catch {}
  window.location.href = "/login";
});

$("#refreshBtn").addEventListener("click", load);
$("#addWatchBtn").addEventListener("click", addWatch);
$("#watchInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addWatch(); });

/* ---- Gizlilik modu: tutarları gerçek anlamda gizle (••••, blur değil) ----
   Her duyarlı öğenin yalnızca METİN düğümlerindeki rakamlar •'a çevrilir; sembol,
   yapı ve renkler (inline hex'ler) korunur. Orijinal değer öğede saklanır, geri
   alınır. render her çizimde yeniden uygular. */
const PM_SEL = [
  ".card.hero .value", ".card.hero .hero-usd", ".card.hero .meta",
  "#sbVal", "#sbUsd", // sol menü nabız kartı da gizlilik modunda maskelenir
  ".hero-compare .hc-v",
  ".cards-metrics .card .value", ".cards-metrics .card .meta",
  ".alloc .lg-val", ".alloc .lg-usd", ".alloc .lg-pct",
  ".alloc .dc-main", ".alloc .dc-sub", ".alloc .dc-pct",
  ".mover-card .mv-pct",
  ".cash-item .v",
  "#chartSub", ".chart-ylabels span",
  "#tables tbody td:not(.l):not(.spark-col)", "#tables tfoot td:not(.l)",
  "#allTrades tbody td:not(.l)", "#allTrades tfoot td:not(.l)",
  "#realized2026 tbody td:not(.l)", "#realized2026 .r26-stat > b",
  ".trade-table td:not(.l)", ".ts-item b",
].join(", ");
function maskEl(el) {
  if (el.dataset.pm === "1") return;
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
  el._pmOrig = nodes.map((n) => n.nodeValue);
  nodes.forEach((n) => { n.nodeValue = n.nodeValue.replace(/[0-9]/g, "•"); });
  el.dataset.pm = "1";
}
function unmaskEl(el) {
  if (el.dataset.pm !== "1") return;
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
  if (el._pmOrig && el._pmOrig.length === nodes.length) {
    nodes.forEach((n, i) => { n.nodeValue = el._pmOrig[i]; });
  }
  delete el.dataset.pm; el._pmOrig = null;
}
function applyMask(on) {
  if (on) document.querySelectorAll(PM_SEL).forEach(maskEl);
  else document.querySelectorAll('[data-pm="1"]').forEach(unmaskEl);
}
function applyPrivacy(on) {
  document.body.classList.toggle("privacy", on);
  try { localStorage.setItem("privacy", on ? "1" : "0"); } catch {}
  const b = document.getElementById("privacyToggle");
  if (b) { b.textContent = on ? "🙈" : "👁"; b.classList.toggle("on", on); }
  applyMask(on);
}
// Buton her render'da yeniden oluşuyor → delege dinleyici (tek sefer)
document.addEventListener("click", (e) => {
  if (e.target.closest("#privacyToggle")) applyPrivacy(!document.body.classList.contains("privacy"));
});
try { if (localStorage.getItem("privacy") === "1") document.body.classList.add("privacy"); } catch {}

showView("genel"); // açılış HER ZAMAN Genel Bakış (hash oturum içi gezinmede çalışmaya devam eder)
sbGreeting(); sbMarket(); // sol menü selamlama + NYSE durumu ilk boyada hazır olsun
loadSentiment(); // duygu kartları anında gelsin (ağır portföy çağrısını beklemeden)
loadFeed(); setInterval(loadFeed, 120_000); // "Sen Yokken" akışı — bağımsız, 2 dk'da bir tazelenir
loadRadarBoard(); // hisse radarı bağımsız yüklensin
loadSwingBoard(); // swing tarayıcı bağımsız yüklensin
loadNotes(); // hisse notları + nav rozeti bağımsız yüklensin
load();
setInterval(load, 60_000);

/* ====================== Hisse Notları (kişisel etiketli not defteri) ======================
 * Alım/satım fikirleri; sembol + etiket + serbest metin. /api/notes ile Supabase-kalıcı. */
const NOTE_LABELS = {
  alacaklarim:  { name: "Alacaklarım",  cls: "buy" },
  izliyorum:    { name: "İzliyorum",    cls: "watch" },
  satacaklarim: { name: "Satacaklarım", cls: "sell" },
  tez:          { name: "Tez / Fikir",  cls: "thesis" },
  genel:        { name: "Genel",        cls: "gen" },
};
let NOTES = [];
let NOTE_FILTER = "all";
let NOTE_EDIT_ID = null;
let NOTE_QUERY = "";
function noteEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function noteDateLabel(iso) {
  try { return new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short" }); } catch { return ""; }
}
async function loadNotes() {
  try {
    const r = await fetch("/api/notes");
    if (!r.ok) return;
    NOTES = await r.json();
  } catch { return; }
  renderNotes();
  updateNotesBadge();
}
function updateNotesBadge() {
  const nav = document.querySelector('.nav-item[data-view="notlar"]');
  if (!nav) return;
  nav.querySelector(".nav-badge")?.remove();
  if (NOTES.length) {
    const b = document.createElement("span");
    b.className = "nav-badge"; b.textContent = NOTES.length;
    nav.appendChild(b);
  }
}
function renderNotes() {
  const sel = $("#noteLabel");
  if (sel && !sel.options.length) {
    sel.innerHTML = Object.entries(NOTE_LABELS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join("");
  }
  const fBox = $("#notesFilter");
  if (fBox) {
    const counts = { all: NOTES.length };
    for (const k of Object.keys(NOTE_LABELS)) counts[k] = NOTES.filter((n) => n.label === k).length;
    const chip = (key, name) => `<button type="button" class="note-fchip${NOTE_FILTER === key ? " active" : ""}" data-nfilter="${key}">${name}<span class="note-fcount">${counts[key] || 0}</span></button>`;
    fBox.innerHTML = chip("all", "Tümü") + Object.entries(NOTE_LABELS).map(([k, v]) => chip(k, v.name)).join("");
  }
  const list = $("#notesList");
  if (!list) return;
  const q = NOTE_QUERY.trim().toLowerCase();
  let items = NOTES.filter((n) => NOTE_FILTER === "all" || n.label === NOTE_FILTER);
  if (q) items = items.filter((n) =>
    (n.text || "").toLowerCase().includes(q) || (n.title || "").toLowerCase().includes(q) || (n.symbol || "").toLowerCase().includes(q));
  items = items.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)); // pinli üste (tarih sırası korunur)
  if (!items.length) {
    list.innerHTML = `<div class="notes-empty">${q ? "Aramayla eşleşen not yok." : NOTES.length ? "Bu etikette not yok." : "Henüz not yok — yukarıdan ilk fikrini ekle."}</div>`;
    return;
  }
  // Sembolün güncel fiyatı (portföyde varsa) — "yazıldığında → şimdi" deltası için
  const liveOf = (sym) => {
    const h = (STATE?.holdings || []).find((x) => String(x.symbol).toUpperCase() === sym);
    return Number(h?.live?.price ?? h?.live?.priceUSD) || null;
  };
  list.innerHTML = items.map((n) => {
    const lb = NOTE_LABELS[n.label] || { name: n.label, cls: "gen" };
    const edited = n.updatedAt && n.createdAt && n.updatedAt.slice(0, 10) !== n.createdAt.slice(0, 10);
    // Fiyat damgası: not anındaki fiyat + bugünkü fiyatla yüzde fark (tez ölçümü)
    let priceChip = "";
    if (n.symbol && n.priceAtUSD) {
      const now = liveOf(n.symbol);
      const d = now ? ((now / n.priceAtUSD - 1) * 100) : null;
      priceChip = `<span class="note-price" title="Not yazıldığındaki fiyat → güncel">✍️ $${(+n.priceAtUSD).toFixed(2)}${d != null ? ` → <b class="${d >= 0 ? "win-c" : "loss-c"}">${d >= 0 ? "+" : ""}${d.toFixed(1)}%</b>` : ""}</span>`;
    }
    const conv = n.conviction ? `<span class="note-conv" title="Güven ${n.conviction}/5">${"●".repeat(n.conviction)}${"○".repeat(5 - n.conviction)}</span>` : "";
    const levels = (n.targetUSD || n.stopUSD)
      ? `<div class="note-levels">${n.targetUSD ? `<span>hedef <b class="win-c">$${(+n.targetUSD).toFixed(2)}</b></span>` : ""}${n.stopUSD ? `<span>stop <b class="loss-c">$${(+n.stopUSD).toFixed(2)}</b></span>` : ""}</div>` : "";
    return `<div class="note-card note-${lb.cls}${n.pinned ? " pinned" : ""}" data-id="${n.id}">
      <div class="note-card-top">
        <span class="note-tag note-${lb.cls}">${noteEsc(lb.name)}</span>
        ${n.symbol ? `<span class="note-symbol" data-chsym="${noteEsc(n.symbol)}" title="Grafiği aç — ${noteEsc(n.symbol)}">${noteEsc(n.symbol)} ↗</span>` : ""}
        ${conv}${priceChip}
        <span class="note-date">${noteDateLabel(n.createdAt)}${edited ? " · düzenlendi" : ""}</span>
        <span class="note-actions">
          <button type="button" class="note-act${n.pinned ? " pin-on" : ""}" data-note-pin title="${n.pinned ? "Sabitlemeyi kaldır" : "Üste sabitle"}">${n.pinned ? "📌" : "📍"}</button>
          <button type="button" class="note-act" data-note-edit>Düzenle</button>
          <button type="button" class="note-act danger" data-note-del>Sil</button>
        </span>
      </div>
      ${n.title ? `<div class="note-title">${noteEsc(n.title)}</div>` : ""}
      <div class="note-body">${noteEsc(n.text).replace(/\n/g, "<br>")}</div>
      ${levels}
      ${n.url ? `<a class="note-src" href="${noteEsc(n.url)}" target="_blank" rel="noopener noreferrer">${svgIcon("link", "ic-xs")} kaynak</a>` : ""}
    </div>`;
  }).join("");
}
function resetNoteForm() {
  NOTE_EDIT_ID = null;
  $("#noteForm")?.reset();
  const ex = $("#noteExtra"); if (ex) ex.hidden = true;
  $("#noteMore")?.setAttribute("aria-expanded", "false");
  const sub = $("#noteSubmit"); if (sub) sub.textContent = "Not ekle";
  const cancel = $("#noteCancel"); if (cancel) cancel.hidden = true;
  const hint = $("#noteHint"); if (hint) hint.textContent = "Enter ile kaydet · Shift+Enter yeni satır · not anındaki fiyat otomatik damgalanır";
}
$("#noteMore")?.addEventListener("click", () => {
  const ex = $("#noteExtra"); if (!ex) return;
  ex.hidden = !ex.hidden;
  $("#noteMore")?.setAttribute("aria-expanded", String(!ex.hidden));
});
$("#noteSearch")?.addEventListener("input", (e) => { NOTE_QUERY = e.target.value || ""; renderNotes(); });
$("#noteForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = ($("#noteText")?.value || "").trim();
  if (!text) { $("#noteText")?.focus(); return; }
  const body = {
    text, symbol: $("#noteSymbol")?.value || "", label: $("#noteLabel")?.value || "genel",
    title: $("#noteTitle")?.value || "", targetUSD: $("#noteTarget")?.value || null,
    stopUSD: $("#noteStop")?.value || null, conviction: $("#noteConv")?.value || null,
    url: $("#noteUrl")?.value || "",
  };
  const sub = $("#noteSubmit"); if (sub) sub.disabled = true;
  try {
    const url = NOTE_EDIT_ID ? `/api/notes/${NOTE_EDIT_ID}` : "/api/notes";
    await fetch(url, { method: NOTE_EDIT_ID ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    resetNoteForm();
    await loadNotes();
  } catch {} finally { if (sub) sub.disabled = false; }
});
$("#noteText")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#noteForm")?.requestSubmit(); }
});
$("#noteCancel")?.addEventListener("click", () => resetNoteForm());
$("#notesFilter")?.addEventListener("click", (e) => {
  const c = e.target.closest("[data-nfilter]"); if (!c) return;
  NOTE_FILTER = c.dataset.nfilter;
  renderNotes();
});
$("#notesList")?.addEventListener("click", async (e) => {
  const card = e.target.closest(".note-card"); if (!card) return;
  const id = card.dataset.id;
  const note = NOTES.find((n) => n.id === id);
  if (e.target.closest("[data-note-pin]")) {
    if (!note) return;
    try {
      await fetch(`/api/notes/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned: !note.pinned }) });
      await loadNotes();
    } catch {}
    return;
  }
  if (e.target.closest("[data-note-edit]")) {
    if (!note) return;
    NOTE_EDIT_ID = id;
    if ($("#noteSymbol")) $("#noteSymbol").value = note.symbol || "";
    if ($("#noteLabel")) $("#noteLabel").value = note.label || "genel";
    if ($("#noteText")) $("#noteText").value = note.text || "";
    if ($("#noteTitle")) $("#noteTitle").value = note.title || "";
    if ($("#noteTarget")) $("#noteTarget").value = note.targetUSD ?? "";
    if ($("#noteStop")) $("#noteStop").value = note.stopUSD ?? "";
    if ($("#noteConv")) $("#noteConv").value = note.conviction ?? "";
    if ($("#noteUrl")) $("#noteUrl").value = note.url || "";
    const hasExtra = !!(note.title || note.targetUSD || note.stopUSD || note.conviction || note.url);
    const ex = $("#noteExtra"); if (ex) ex.hidden = !hasExtra;
    $("#noteMore")?.setAttribute("aria-expanded", String(hasExtra));
    const sub = $("#noteSubmit"); if (sub) sub.textContent = "Güncelle";
    const cancel = $("#noteCancel"); if (cancel) cancel.hidden = false;
    const hint = $("#noteHint"); if (hint) hint.textContent = "Notu düzenliyorsun";
    $("#noteText")?.focus();
    $("#noteForm")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const del = e.target.closest("[data-note-del]");
  if (del) {
    if (del.dataset.confirm !== "1") {
      del.dataset.confirm = "1"; del.textContent = "Emin?"; del.classList.add("armed");
      setTimeout(() => { if (del.isConnected) { del.dataset.confirm = ""; del.textContent = "Sil"; del.classList.remove("armed"); } }, 2600);
      return;
    }
    try { await fetch(`/api/notes/${id}`, { method: "DELETE" }); if (NOTE_EDIT_ID === id) resetNoteForm(); await loadNotes(); } catch {}
  }
});

/* Açılır-kapanır paneller — DELEGE (JS ile sonradan render edilen paneller de çalışsın).
 * Varsayılan kapalı, seçim localStorage'da hatırlanır. */
// Bir defalık: paneller artık varsayılan AÇIK — eski "kapalı" tercihlerini temizle
try {
  if (!localStorage.getItem("collapseOpenDefault")) {
    Object.keys(localStorage).filter((k) => k.startsWith("collapse:")).forEach((k) => localStorage.removeItem(k));
    localStorage.setItem("collapseOpenDefault", "1");
  }
} catch {}
function collapseSavedCollapsed(id, def = false) {
  try { const v = localStorage.getItem("collapse:" + id); if (v === "0") return false; if (v === "1") return true; } catch {}
  return def;
}
function collapseToggle(p) {
  p.classList.toggle("is-collapsed");
  try { localStorage.setItem("collapse:" + p.id, p.classList.contains("is-collapsed") ? "1" : "0"); } catch {}
}
document.addEventListener("click", (e) => {
  const t = e.target.closest(".panel-toggle"); if (!t || e.target.closest(".tip")) return;
  const p = t.closest(".collapsible"); if (p) collapseToggle(p);
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const t = e.target.closest(".panel-toggle"); if (!t) return;
  const p = t.closest(".collapsible"); if (p) { e.preventDefault(); collapseToggle(p); }
});
// Statik collapsible'lara açılışta kayıtlı durumu uygula
document.querySelectorAll(".collapsible").forEach((p) => p.classList.toggle("is-collapsed", collapseSavedCollapsed(p.id)));

/* ====================== Claude AI katmanı (tez masası + gün denetimi) ======================
 * /api/ai/* uçlarını kullanır; ANTHROPIC_API_KEY yoksa UI kendini gizler/bilgi verir. */
let AI_STATUS = null;
let DA_AI_PAYLOAD = null; // renderDayAnalysis'in Claude'a gönderilecek kanıt paketi
const AI_DESK = { sym: null };
async function aiStatus() {
  if (AI_STATUS !== null) return AI_STATUS;
  try { AI_STATUS = await (await fetch("/api/ai/status")).json(); } catch { AI_STATUS = { enabled: false }; }
  return AI_STATUS;
}

/* ---- Analiz · Claude Tez Masası ---- */
async function renderAiDesk() {
  const el = $("#aiDeskBox"); if (!el) return;
  const st = await aiStatus();
  if (!st.enabled) {
    el.innerHTML = `<div class="ai-off">Claude bağlı değil. <b>ANTHROPIC_API_KEY</b> ortam değişkenini ekleyince bu panel aktifleşir (Render → Environment · lokalde <code>.env</code>).</div>`;
    return;
  }
  const syms = [...new Set((STATE?.holdings || []).filter((h) => h.type === "stock" && h.symbol).map((h) => String(h.symbol).toUpperCase()))].sort();
  if (!syms.length) { el.innerHTML = `<div class="ai-off">Tez üretmek için portföyde hisse pozisyonu olmalı.</div>`; return; }
  if (!AI_DESK.sym || !syms.includes(AI_DESK.sym)) AI_DESK.sym = syms[0];
  if (!el.querySelector("#aiDeskSym")) {
    el.innerHTML = `<div class="ai-desk-bar">
      <select id="aiDeskSym" aria-label="Sembol seç"></select>
      <button class="btn primary sm" id="aiDeskGo">Tez üret</button>
      <button class="btn ghost sm" id="aiDeskFresh" title="24 saatlik önbelleği yok say, yeniden üret">↻ Yeniden</button>
      <span class="ai-desk-hint">~30–60 sn · 24 saat önbellek · sonuç kalıcı kaydedilir</span>
    </div><div id="aiThesisOut"></div>`;
  }
  const sel = el.querySelector("#aiDeskSym");
  sel.innerHTML = syms.map((s) => `<option value="${s}"${s === AI_DESK.sym ? " selected" : ""}>${s}</option>`).join("");
  aiLoadCachedThesis(AI_DESK.sym);
}
async function aiLoadCachedThesis(sym) {
  const out = $("#aiThesisOut"); if (!out) return;
  if (out.dataset.sym === sym && out.dataset.state === "done") return;
  out.dataset.sym = sym; out.dataset.state = "";
  out.innerHTML = "";
  try {
    const r = await fetch(`/api/ai/thesis?symbol=${encodeURIComponent(sym)}`);
    if (r.ok) { renderThesisCard(await r.json()); return; }
  } catch {}
  const out2 = $("#aiThesisOut");
  if (out2 && out2.dataset.sym === sym && out2.dataset.state !== "done")
    out2.innerHTML = `<div class="ai-empty">Bu sembol için kayıtlı tez yok — <b>Tez üret</b>'e bas.</div>`;
}
async function aiGenThesis(force) {
  const out = $("#aiThesisOut"); const sym = AI_DESK.sym; if (!out || !sym) return;
  out.dataset.sym = sym; out.dataset.state = "";
  out.innerHTML = `<div class="ai-loading">🤖 Claude <b>${noteEsc(sym)}</b> tezini yazıyor… (~30–60 sn)</div>`;
  const btns = [$("#aiDeskGo"), $("#aiDeskFresh")];
  btns.forEach((b) => b && (b.disabled = true));
  try {
    const r = await fetch("/api/ai/thesis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: sym, force }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "tez üretilemedi");
    renderThesisCard(j);
  } catch (e) {
    const o = $("#aiThesisOut");
    if (o && o.dataset.sym === sym) o.innerHTML = `<div class="ai-err">⚠️ ${noteEsc(e.message)}</div>`;
  } finally { btns.forEach((b) => b && (b.disabled = false)); }
}
function renderThesisCard(rec) {
  const out = $("#aiThesisOut"); if (!out) return;
  if (out.dataset.sym && rec.symbol !== out.dataset.sym) return; // kullanıcı sembol değiştirdi
  const r = rec.result || {};
  const kmap = { EKLE: ["buy", "EKLE"], TUT: ["hold", "TUT"], AZALT: ["sell", "AZALT"], GRI_BOLGE: ["gray", "GRİ BÖLGE"] };
  const [kcls, klbl] = kmap[r.karar] || ["gray", noteEsc(r.karar || "?")];
  const g = Math.max(0, Math.min(100, Math.round(+r.guven || 0)));
  const li = (arr) => (arr || []).map((x) => `<li>${noteEsc(x)}</li>`).join("");
  out.dataset.state = "done";
  out.innerHTML = `<div class="ai-card">
    <div class="ai-head">
      <span class="ai-pill ai-${kcls}">${klbl}</span>
      <span class="ai-sym">${noteEsc(rec.symbol)}</span>
      <span class="ai-conf" title="Güven"><i style="width:${g}%"></i></span><b class="ai-conf-n">${g}</b>
      <span class="ai-meta">${noteEsc(String(rec.model || "").replace("claude-", ""))} · ${noteEsc(String(rec.at || "").slice(0, 10))}${rec.cached ? " · önbellek" : ""}</span>
    </div>
    <p class="ai-ozet">${noteEsc(r.ozet || "")}</p>
    <div class="ai-cols">
      <div class="ai-col ai-bull"><h4>🐂 Boğa tezi</h4><ul>${li(r.boga_tezi)}</ul></div>
      <div class="ai-col ai-bear"><h4>🐻 Ayı tezi</h4><ul>${li(r.ayi_tezi)}</ul></div>
    </div>
    ${(r.riskler || []).length ? `<div class="ai-sec"><h4>Riskler</h4><ul>${li(r.riskler)}</ul></div>` : ""}
    ${(r.kirmizi_cizgiler || []).length ? `<div class="ai-sec ai-redline"><h4>⛔ Kırmızı çizgiler — biri gerçekleşirse tez çöker</h4><ul>${li(r.kirmizi_cizgiler)}</ul></div>` : ""}
    ${r.seviyeler ? `<div class="ai-levels">${r.seviyeler.stop != null ? `<span class="ai-lv">stop <b>$${(+r.seviyeler.stop).toFixed(2)}</b></span>` : ""}${r.seviyeler.hedef != null ? `<span class="ai-lv">hedef <b>$${(+r.seviyeler.hedef).toFixed(2)}</b></span>` : ""}<span class="ai-lv-note">${noteEsc(r.seviyeler.aciklama || "")}</span></div>` : ""}
    ${(r.kontrol_listesi || []).length ? `<div class="ai-sec"><h4>📋 İzleme listesi</h4><ul>${li(r.kontrol_listesi)}</ul></div>` : ""}
    <div class="ai-disclaimer">Claude'un panondaki veriyle ürettiği görüştür — garanti yok, yatırım tavsiyesi değildir. Karar senin.</div>
  </div>`;
}
$("#aiDeskBox")?.addEventListener("click", (e) => {
  if (e.target.closest("#aiDeskGo")) aiGenThesis(false);
  else if (e.target.closest("#aiDeskFresh")) aiGenThesis(true);
});
$("#aiDeskBox")?.addEventListener("change", (e) => {
  if (e.target.id === "aiDeskSym") { AI_DESK.sym = e.target.value; aiLoadCachedThesis(AI_DESK.sym); }
});

/* ---- Raporlar · Claude gün denetimi ---- */
async function daRenderAiSlot(date) {
  const box = $("#daAi"); if (!box) return;
  box.dataset.date = date;
  const st = await aiStatus();
  if (!st.enabled) { box.innerHTML = ""; return; }
  try {
    const r = await fetch(`/api/ai/day-review?date=${encodeURIComponent(date)}`);
    if (r.ok) { renderDayAiCard(await r.json()); return; }
  } catch {}
  const b2 = $("#daAi");
  if (b2 && b2.dataset.date === date)
    b2.innerHTML = `<div class="da-ai-cta"><button class="btn primary sm" data-da-ai>🤖 Claude ile derinleştir</button><span class="ai-desk-hint">Motor bulgularını Claude süreç koçuna denetletir · kalıcı denetim izi</span></div>`;
}
async function daRunAi(force) {
  const box = $("#daAi"); if (!box || !DA_AI_PAYLOAD) return;
  const date = DA_AI_PAYLOAD.date;
  box.innerHTML = `<div class="ai-loading">🤖 Claude günü denetliyor… (~30–60 sn)</div>`;
  try {
    const r = await fetch("/api/ai/day-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...DA_AI_PAYLOAD, force }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "denetim alınamadı");
    renderDayAiCard(j);
  } catch (e) {
    const b = $("#daAi");
    if (b && b.dataset.date === date) b.innerHTML = `<div class="ai-err">⚠️ ${noteEsc(e.message)} <button class="btn ghost sm" data-da-ai>tekrar dene</button></div>`;
  }
}
function renderDayAiCard(rec) {
  const box = $("#daAi"); if (!box) return;
  if (box.dataset.date && rec.date !== box.dataset.date) return;
  const r = rec.result || {};
  const kmap = { DOGRU: ["win", "Doğru"], TARTISMALI: ["neu", "Tartışmalı"], HATALI: ["loss", "Hatalı"] };
  const n = Math.max(0, Math.min(100, Math.round(+r.disiplin_notu || 0)));
  box.innerHTML = `<div class="ai-card ai-day">
    <div class="ai-head">
      <span class="ai-pill ai-${n >= 70 ? "buy" : n >= 40 ? "hold" : "sell"}">Disiplin ${n}/100</span>
      <span class="ai-sym">Claude gün denetimi</span>
      <span class="ai-meta">${noteEsc(String(rec.model || "").replace("claude-", ""))} · ${noteEsc(String(rec.at || "").slice(0, 10))}${rec.cached ? " · kayıtlı" : ""}</span>
      <button class="btn ghost sm ai-refresh" data-da-ai-fresh title="Yeniden denetle">↻</button>
    </div>
    <p class="ai-ozet">${noteEsc(r.genel || "")}</p>
    <div class="ai-day-trades">${(r.islemler || []).map((t) => {
      const [c, l] = kmap[t.karar] || ["neu", noteEsc(t.karar || "?")];
      return `<div class="ai-dt"><div class="ai-dt-top"><b>${noteEsc(t.symbol)}</b><span class="ch-pill ${c}">${l}</span></div><div class="ai-dt-why">${noteEsc(t.gerekce || "")}</div><div class="ai-dt-lesson">📌 ${noteEsc(t.ders || "")}</div></div>`;
    }).join("")}</div>
    ${r.yarin_kurali ? `<div class="ai-tomorrow">🗓 Yarının kuralı: <b>${noteEsc(r.yarin_kurali)}</b></div>` : ""}
    <div class="ai-disclaimer">Süreç denetimi (motor bulguları + Claude) — kalıcı denetim izi. Yatırım tavsiyesi değildir.</div>
  </div>`;
}
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-da-ai]")) daRunAi(false);
  else if (e.target.closest("[data-da-ai-fresh]")) daRunAi(true);
});

/* Alfa Avı: izleme listesi satırı / açık pozisyon kartı → grafik modalı (QM analiziyle) */
document.addEventListener("click", (e) => {
  if (e.target.closest("summary")) return; // katlanır gerekçe aç/kapa — grafik açma
  const el = e.target.closest("[data-chsym]");
  if (el) openChartModal(el.dataset.chsym, { horizon: "swing" });
});

/* ====================== Grafik: hero seviye şeridi ("bu fiyatı bekle") ======================
 * Yan panelin EN ÜSTÜNDE, en kritik 3 seviye büyük ve renkli: giriş/stop/hedef.
 * Öncelik: QM kurulumu > açık pozisyon planı > uzun vade biriktirme. */
function cmHeroLevels(d, pos, pl) {
  const cur = pl?.currentPrice ?? d.price;
  const dist = (p) => (cur && p) ? ((p / cur - 1) * 100) : null;
  const cell = (lbl, price, kind, sub) => price == null ? "" :
    `<div class="cm-hc ${kind}"><span>${lbl}</span><b>${fmtUSD(price)}</b><i>${sub || ""}</i></div>`;
  const qm = d.qm;
  if (qm?.ok && qm.setup !== "none" && qm.entryTrigger != null) {
    const dd = dist(qm.entryTrigger);
    const head = qm.stage === "breaking-out"
      ? "🔥 Tetik AKTİF — pivot kırılıyor, ORH girişini değerlendir"
      : qm.stage === "extended"
        ? "⚠️ Gergin — kovalama, geri çekilme bekle"
        : "⏳ BU FİYATI BEKLE — pivot kırılmadan girme";
    return `<div class="cm-hero ${qm.stage === "breaking-out" ? "live" : ""}">
      <div class="cm-hero-h">${head}</div>
      <div class="cm-hero-row">
        ${cell("GİRİŞ", qm.entryTrigger, "entry", dd != null ? (dd >= 0 ? `+%${dd.toFixed(1)} uzakta` : "fiyat üstünde") : "")}
        ${cell("STOP", qm.stop, "stop", qm.stopPct != null ? `girişten −%${qm.stopPct}` : "")}
        ${cell("HEDEF 2R", qm.rTargets?.r2, "target", qm.rTargets?.r3 ? `3R → ${fmtUSD(qm.rTargets.r3)}` : "")}
      </div></div>`;
  }
  if (pos?.qty > 0 && (pos.guard?.stop != null || pos.guard?.target != null || pos.costUSD != null)) {
    const sd = dist(pos.guard?.stop);
    return `<div class="cm-hero pos">
      <div class="cm-hero-h">📍 Pozisyon planın — bu seviyeleri izle</div>
      <div class="cm-hero-row">
        ${cell("MALİYET", pos.costUSD, "cost", pos.profitPct != null ? fmtPct(pos.profitPct) : "")}
        ${cell("İZ SÜREN STOP", pos.guard?.stop, "stop", pos.guard?.breached ? "İHLAL — çık!" : sd != null ? `%${Math.abs(sd).toFixed(1)} altta` : "")}
        ${cell("PLAN HEDEF", pos.guard?.target, "target", pos.guard?.targetHit ? "hedefe ULAŞTI" : dist(pos.guard?.target) != null ? `+%${dist(pos.guard?.target).toFixed(1)} yukarıda` : "")}
      </div></div>`;
  }
  const z = pl?.longterm?.zones?.[0];
  if (z) {
    return `<div class="cm-hero lt">
      <div class="cm-hero-h">🌱 Uzun vade — kademeli biriktirme bölgesi</div>
      <div class="cm-hero-row">
        ${cell("1. BÖLGE", z.price, "entry", z.isNow ? "ŞİMDİ bölgede" : dist(z.price) != null ? `%${Math.abs(dist(z.price)).toFixed(1)} uzakta` : "")}
        ${cell("200g DÖNÜŞ", pl?.longterm?.reclaim, "cost", "")}
        ${cell("FİYAT", cur, "now", "")}
      </div></div>`;
  }
  return "";
}

/* ====================== Grafik çizim araçları (TradingView tarzı, kalıcı) ======================
 * ╱ Trend (2 tık) + ─ Yatay seviye (1 tık) → sembol başına localStorage'da saklanır
 * ("cmDraw:SYM"), grafik her açılışta geri yüklenir. ESC yarım çizimi iptal eder.
 * Çapalar mum zamanına bağlıdır; 360 günlük pencere kaydıkça çok eskiyen çapalar düşer. */
const CM_DRAW = { tool: null, canvas: null, ctx: null, chart: null, series: null, sym: null, items: [], pending: null, cleanup: [], redraw: null };
const cmDrawKey = (sym) => "cmDraw:" + sym;
function cmDrawLoad(sym) { try { return JSON.parse(localStorage.getItem(cmDrawKey(sym))) || []; } catch { return []; } }
function cmDrawSave() { try { localStorage.setItem(cmDrawKey(CM_DRAW.sym), JSON.stringify(CM_DRAW.items)); } catch {} }

function initDrawings(chartEl, chart, series, candles, sym) {
  CM_DRAW.cleanup.forEach((f) => { try { f(); } catch {} });
  CM_DRAW.cleanup = [];
  const canvas = document.createElement("canvas");
  canvas.className = "cm-draw-canvas";
  chartEl.appendChild(canvas);
  Object.assign(CM_DRAW, { canvas, ctx: canvas.getContext("2d"), chart, series, sym, tool: null, pending: null });
  CM_DRAW.timeIdx = new Map(candles.map((c, i) => [c.time, i]));
  CM_DRAW.idxTime = candles.map((c) => c.time);
  CM_DRAW.items = cmDrawLoad(sym);
  cmSetTool(null);

  const logicalOf = (p) => {
    if (p.ext != null) return CM_DRAW.idxTime.length - 1 + p.ext; // son mumun sağına uzatılmış nokta
    const i = CM_DRAW.timeIdx.get(p.time);
    return i == null ? null : i;
  };
  function redraw() {
    const { ctx } = CM_DRAW;
    const r = chartEl.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    const px = (l) => chart.timeScale().logicalToCoordinate(l);
    const py = (price) => series.priceToCoordinate(price);
    const drawTrend = (p1, p2, preview) => {
      const l1 = logicalOf(p1), l2 = logicalOf(p2);
      if (l1 == null || l2 == null) return;
      const x1 = px(l1), x2 = px(l2), y1 = py(p1.price), y2 = py(p2.price);
      if ([x1, x2, y1, y2].some((v) => v == null)) return;
      ctx.strokeStyle = "#7c5cff"; ctx.lineWidth = 2; ctx.setLineDash(preview ? [5, 4] : []);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#7c5cff";
      [[x1, y1], [x2, y2]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill(); });
    };
    const drawH = (price) => {
      const y = py(price); if (y == null) return;
      ctx.strokeStyle = "#e07b2f"; ctx.lineWidth = 1.5; ctx.setLineDash([7, 5]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(r.width, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#e07b2f"; ctx.font = "700 11px " + (getComputedStyle(document.body).fontFamily || "sans-serif");
      ctx.fillText("$" + (+price).toFixed(2), 8, y - 5);
    };
    for (const it of CM_DRAW.items) it.t === "trend" ? drawTrend(it.p1, it.p2) : drawH(it.price);
    if (CM_DRAW.pending?.p1 && CM_DRAW.pending.p2) drawTrend(CM_DRAW.pending.p1, CM_DRAW.pending.p2, true);
  }
  CM_DRAW.redraw = redraw;

  function sizeCanvas() {
    const r = chartEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    canvas.style.width = r.width + "px"; canvas.style.height = r.height + "px";
    CM_DRAW.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }
  function pointAt(ev) {
    const r = canvas.getBoundingClientRect();
    const logical = chart.timeScale().coordinateToLogical(ev.clientX - r.left);
    const price = series.coordinateToPrice(ev.clientY - r.top);
    if (logical == null || price == null) return null;
    const i = Math.round(logical), n = CM_DRAW.idxTime.length;
    if (i >= n) return { ext: i - (n - 1), price };
    return { time: CM_DRAW.idxTime[Math.max(0, Math.min(n - 1, i))], price };
  }
  canvas.addEventListener("click", (ev) => {
    if (!CM_DRAW.tool) return;
    const p = pointAt(ev); if (!p) return;
    if (CM_DRAW.tool === "hline") {
      CM_DRAW.items.push({ t: "h", price: p.price });
      cmDrawSave(); cmSetTool(null); redraw();
      toast(`Yatay seviye kaydedildi — $${(+p.price).toFixed(2)}`);
    } else if (CM_DRAW.tool === "trend") {
      if (!CM_DRAW.pending) CM_DRAW.pending = { p1: p, p2: null };
      else {
        CM_DRAW.items.push({ t: "trend", p1: CM_DRAW.pending.p1, p2: p });
        CM_DRAW.pending = null; cmDrawSave(); cmSetTool(null);
        toast("Trend çizgisi kaydedildi");
      }
      redraw();
    }
  });
  canvas.addEventListener("mousemove", (ev) => {
    if (CM_DRAW.tool === "trend" && CM_DRAW.pending) { const p = pointAt(ev); if (p) { CM_DRAW.pending.p2 = p; redraw(); } }
  });
  const esc = (ev) => { if (ev.key === "Escape" && CM_DRAW.tool) { cmSetTool(null); redraw(); } };
  document.addEventListener("keydown", esc);
  CM_DRAW.cleanup.push(() => document.removeEventListener("keydown", esc));
  const sub = () => redraw();
  chart.timeScale().subscribeVisibleLogicalRangeChange(sub);
  CM_DRAW.cleanup.push(() => { try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(sub); } catch {} });
  const ro = new ResizeObserver(sizeCanvas);
  ro.observe(chartEl);
  CM_DRAW.cleanup.push(() => ro.disconnect());
  sizeCanvas();
}
function cmSetTool(tool) {
  CM_DRAW.tool = tool;
  CM_DRAW.pending = null;
  if (CM_DRAW.canvas) {
    CM_DRAW.canvas.style.pointerEvents = tool ? "auto" : "none";
    CM_DRAW.canvas.style.cursor = tool ? "crosshair" : "default";
  }
  $("#cmToolTrend")?.classList.toggle("active", tool === "trend");
  $("#cmToolHline")?.classList.toggle("active", tool === "hline");
}
$("#cmToolTrend")?.addEventListener("click", () => cmSetTool(CM_DRAW.tool === "trend" ? null : "trend"));
$("#cmToolHline")?.addEventListener("click", () => cmSetTool(CM_DRAW.tool === "hline" ? null : "hline"));
$("#cmToolClear")?.addEventListener("click", () => {
  if (!CM_DRAW.sym) return;
  CM_DRAW.items = [];
  cmDrawSave();
  CM_DRAW.redraw?.();
  toast("Bu sembolün çizimleri silindi");
});


/* ====================== Cep bildirimleri (PWA + Web Push) ======================
 * Sidebar'daki tek düğme tüm akışı yönetir. iOS'ta push YALNIZ ana ekrana eklenmiş
 * PWA'da çalışır (16.4+) — Safari sekmesindeysek rehber gösteririz. Abonelik sunucuda
 * push_state'te yaşar; mail kanalı YEDEK olarak aynen devam eder. */
const PUSHC = { reg: null, sub: null };
const pushCap = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const pushIsIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function pushB64(k) { // VAPID public key (base64url) → Uint8Array
  const pad = "=".repeat((4 - (k.length % 4)) % 4);
  const raw = atob((k + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
function pushPaint() {
  const b = $("#pushBtn"); if (!b) return;
  b.hidden = false;
  if (b.dataset.guide) { b.textContent = "🔔 Bildirim için ana ekrana ekle"; return; }
  b.textContent = PUSHC.sub ? "🔔 Bildirimler açık" : "🔕 Bildirimleri aç";
  b.classList.toggle("on", !!PUSHC.sub);
  b.title = PUSHC.sub ? "Kapatmak için dokun" : "Stop/TP/Alfa olayları telefona anlık düşsün";
}
async function pushInit() {
  const b = $("#pushBtn"); if (!b) return;
  if (!pushCap()) {
    // iOS Safari sekmesi: Push API yok — ana ekrana ekleme rehberi göster
    if (pushIsIOS() && !navigator.standalone) { b.dataset.guide = "1"; pushPaint(); }
    return; // desteksiz masaüstü → düğme gizli kalır
  }
  try {
    PUSHC.reg = await navigator.serviceWorker.register("sw.js");
    PUSHC.sub = await PUSHC.reg.pushManager.getSubscription();
    pushPaint();
  } catch { /* SW kaydolamadı (örn. güvensiz bağlam) → düğme gizli kalır */ }
}
$("#pushBtn")?.addEventListener("click", async () => {
  const b = $("#pushBtn");
  if (b.dataset.guide) {
    toast("Safari'de Paylaş düğmesi → “Ana Ekrana Ekle” → uygulamayı ana ekrandan aç; bu düğme orada aktifleşir.", "ok");
    return;
  }
  try {
    if (PUSHC.sub) { // kapat
      const endpoint = PUSHC.sub.endpoint;
      await PUSHC.sub.unsubscribe().catch(() => {});
      PUSHC.sub = null;
      fetch("/api/push/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint }) }).catch(() => {});
      toast("Bildirimler kapatıldı");
      pushPaint(); return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Bildirim izni verilmedi — tarayıcı ayarlarından açabilirsin", "err"); return; }
    const { key } = await (await fetch("/api/push/pubkey")).json();
    if (!key) { toast("Sunucuda push yapılandırması yok (mock/dev ortamı olabilir)", "err"); return; }
    PUSHC.sub = await PUSHC.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushB64(key) });
    await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sub: PUSHC.sub.toJSON() }) });
    toast("🔔 Bildirimler açık — test bildirimi gönderiliyor");
    fetch("/api/push/test", { method: "POST" }).catch(() => {});
    pushPaint();
  } catch (e) { toast("Bildirim kurulumu başarısız: " + (e?.message || e), "err"); }
});
pushInit();

/* ====================== Aylık Edge Raporu (Raporlar sekmesi) ======================
 * Sunucu ay kapanınca karneyi üretir (KV edge_reports); burada yalnız çizilir.
 * Boş durumda "geçen ayı şimdi oluştur" ile elle tetiklenebilir (POST build). */
let EDGE = { data: null, ym: null };
const EDGE_LBL = { yes: "Evet — plana uydum", partial: "Kısmen", no: "Hayır", breakout: "Kırılım", pullback: "Geri çekilme", ep: "EP / haber", A: "A · güçlü", B: "B · orta", C: "C · zayıf" };
const edgeUsd = (v) => `${v >= 0 ? "+" : ""}$${Math.abs(v) >= 100 ? Math.round(v) : v}`;
function edgeGrpTbl(title, m, keyLbl) {
  const keys = Object.keys(m || {}).filter((k) => k !== "—" || Object.keys(m).length === 1);
  if (!keys.length) return "";
  const rows = keys.map((k) => {
    const g = m[k]; const hit = g.n ? Math.round((g.kazanan / g.n) * 100) : 0;
    return `<tr><td class="l">${EDGE_LBL[k] || k}</td><td>${g.n}</td><td>%${hit}</td><td class="${g.pnl >= 0 ? "win-c" : "loss-c"}">${edgeUsd(g.pnl)}</td></tr>`;
  }).join("");
  return `<div class="edge-grp"><div class="tp-h">${title}</div><table class="dj-table"><thead><tr><th class="l">${keyLbl}</th><th>İşlem</th><th>İsabet</th><th>Net K/Z</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function edgePaint(ym) {
  const box = $("#edgeBox"); const rec = EDGE.data?.[ym];
  if (!box || !rec) return;
  const s = rec.stats;
  const kpi = (l, v, c) => `<div class="edge-kpi"><i>${l}</i><b class="${c || ""}">${v}</b></div>`;
  const ai = rec.ai ? `<div class="edge-ai">
      <div class="tp-h">Koç yorumu · Claude</div>
      <p>${rec.ai.ozet}</p>
      ${rec.ai.guclu_yonler?.length ? `<ul class="ch-ev">${rec.ai.guclu_yonler.map((t) => `<li class="da-pos">${t}</li>`).join("")}</ul>` : ""}
      ${rec.ai.zayif_yonler?.length ? `<ul class="ch-ev">${rec.ai.zayif_yonler.map((t) => `<li class="da-warn">${t}</li>`).join("")}</ul>` : ""}
      <p><b>Ayın dersi:</b> ${rec.ai.ay_dersi}</p>
      <p><b>Gelecek ay kuralı:</b> ${rec.ai.gelecek_ay_kurali}</p>
      <p class="sw-muted">${rec.ai.alfa_kiyasi || ""}</p>
    </div>` : (rec.aiErr ? `<div class="rk-empty">Koç yorumu üretilemedi: ${rec.aiErr}</div>` : "");
  box.innerHTML = `
    <div class="edge-kpis">
      ${kpi("Kapanan işlem", s.kapanan)}
      ${kpi("İsabet", s.isabet != null ? `%${s.isabet}` : "—", s.isabet >= 50 ? "win-c" : "")}
      ${kpi("Realize", edgeUsd(s.realizedUSD), s.realizedUSD >= 0 ? "win-c" : "loss-c")}
      ${kpi("Ort. kazanç / kayıp", `${s.ortKazanc != null ? "$" + s.ortKazanc : "—"} / ${s.ortKayip != null ? "$" + s.ortKayip : "—"}`)}
      ${kpi("Net değer", s.netDeger.getiriPct != null ? `%${s.netDeger.getiriPct}` : "—", (s.netDeger.getiriPct || 0) >= 0 ? "win-c" : "loss-c")}
      ${kpi("Alfa Avı", `${s.alfa.islem} işlem · ${edgeUsd(s.alfa.pnl)}`, s.alfa.pnl >= 0 ? "win-c" : "loss-c")}
    </div>
    ${s.enIyi || s.enKotu ? `<div class="edge-line">${s.enIyi ? `En iyi: <b>${s.enIyi.sym}</b> <span class="win-c">${edgeUsd(s.enIyi.pnl)}</span>` : ""}${s.enKotu && s.enKotu !== s.enIyi ? ` · en kötü: <b>${s.enKotu.sym}</b> <span class="loss-c">${edgeUsd(s.enKotu.pnl)}</span>` : ""} · ay içi maks. düşüş ${s.netDeger.maksDususPct != null ? `<b class="loss-c">%${s.netDeger.maksDususPct}</b>` : "—"}</div>` : ""}
    <div class="edge-grps">
      ${edgeGrpTbl("Setup kırılımı", s.setupKirilimi, "Setup")}
      ${edgeGrpTbl("Güven kalibrasyonu", s.guvenKalibrasyonu, "Güven")}
      ${edgeGrpTbl("Plan uyumu", s.planUyum, "Plana uydun mu?")}
      ${edgeGrpTbl("Hata etiketleri", s.hataEtiketleri, "Etiket")}
    </div>
    ${ai}
    ${s.kapanan === 0 && s.alfa.islem === 0 ? `<div class="rk-empty">Bu ay kapanan işlem yok — karne sakin ama net değer seyri yukarıda.</div>` : ""}`;
}
async function renderEdgeReports() {
  const box = $("#edgeBox"); if (!box) return;
  if (!EDGE.data) { try { EDGE.data = await (await fetch("/api/edge-reports")).json(); } catch { EDGE.data = {}; } }
  const months = Object.keys(EDGE.data || {}).filter((k) => /^\d{4}-\d{2}$/.test(k)).sort().reverse();
  const sel = $("#edgeMonthSel");
  if (!months.length) {
    box.innerHTML = `<div class="rk-empty">Henüz aylık karne yok — ilk rapor ay kapanınca otomatik oluşur.
      <button class="btn ghost sm" id="edgeBuildBtn">Geçen ayı şimdi oluştur</button></div>`;
    $("#edgeBuildBtn")?.addEventListener("click", async (e) => {
      e.target.disabled = true; e.target.textContent = "Oluşturuluyor…";
      try { await fetch("/api/edge-reports/build", { method: "POST" }); EDGE.data = null; renderEdgeReports(); }
      catch { toast("Rapor oluşturulamadı", "err"); e.target.disabled = false; e.target.textContent = "Geçen ayı şimdi oluştur"; }
    });
    return;
  }
  if (sel) {
    sel.hidden = months.length < 2;
    sel.innerHTML = months.map((m) => `<option value="${m}">${m}</option>`).join("");
    sel.value = EDGE.ym && months.includes(EDGE.ym) ? EDGE.ym : months[0];
    sel.onchange = () => { EDGE.ym = sel.value; edgePaint(sel.value); };
  }
  EDGE.ym = sel && !sel.hidden ? sel.value : months[0];
  edgePaint(EDGE.ym);
}
