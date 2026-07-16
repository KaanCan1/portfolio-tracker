/* 04-pano-realize.js — günlük pano (bugün/kur/bilanço) · realize işlemler & 2026 kayıtları · vergi özeti + CSV · para giriş/çıkış
 * app.js'in SIRALI dilimi (bölme: 15 Tem 2026). Dosyalar index.html'deki sırayla yüklenir;
 * klasik script'ler global kapsamı paylaşır — sıra değiştirme, dosyayı IIFE'ye sarma. */
/* ====================== Günlük Pano: Bugün + Kur/Hisse + Bilanço ======================
 * Tamamen STATE'ten hesaplanır (ek API yok). Dağınık bilgiyi tek bakışta eyleme çevirir. */
/* Bilanço Nöbeti — 10 gün içinde bilançosu olan pozisyonlar. Qullamaggie kuralı:
 * swing'i bilanço üstünden taşıma (gap riski). Veri h.earnings (server earningsFor). */
function renderEarningsWatch() {
  const el = $("#earningsWatch");
  if (!el) return;
  const stocks = (STATE?.holdings || []).filter((h) =>
    h.type === "stock" && h.earnings && h.earnings.daysLeft != null && h.earnings.daysLeft <= 10);
  if (!stocks.length) { el.innerHTML = ""; return; }
  stocks.sort((a, b) => a.earnings.daysLeft - b.earnings.daysLeft);
  const swingSet = STATE.swingOpen || {};
  const rows = stocks.map((h) => {
    const e = h.earnings, sym = h.symbol.toUpperCase();
    const isSwing = h.horizon === "swing" || !!swingSet[sym];
    const dl = e.daysLeft === 0 ? "bugün" : e.daysLeft + "g";
    const hour = e.hour === "bmo" ? "açılış öncesi" : e.hour === "amc" ? "kapanış sonrası" : "";
    const move = e.expectedMovePct ? ` · ±%${e.expectedMovePct} beklenen` : "";
    const tone = e.daysLeft <= 2 ? "urgent" : e.daysLeft <= 5 ? "soon" : "";
    return `<button class="ew-row ${tone}${isSwing ? " swing" : ""}" data-sym="${sym}" title="Grafiği aç">
      <span class="ew-d">${dl}</span><b class="ew-sym">${sym}</b>
      ${isSwing ? `<span class="ew-chip">⚡ swing — taşıma!</span>` : ""}
      <span class="ew-meta">${fmtDate(e.date)}${hour ? " · " + hour : ""}${move}</span>
    </button>`;
  }).join("");
  el.innerHTML = `<section class="panel ew-panel">
    <div class="panel-head"><div>
      <h2>${svgIcon("calendar", "h2-ic")}Bilanço Nöbeti <span class="sw-chip">${stocks.length}</span></h2>
      <span class="chart-sub">10 gün içinde bilanço · Qullamaggie: swing'i bilanço üstünden <b>taşıma</b> (gap riski)</span>
    </div></div>
    <div class="ew-list">${rows}</div></section>`;
}
$("#earningsWatch")?.addEventListener("click", (e) => {
  const r = e.target.closest(".ew-row");
  if (r?.dataset.sym) openChartModal(r.dataset.sym);
});

/* Fiyat Alarm Merkezi — uygulama-içi alarmlar (STATE.alerts, server tetik durumu) */
const AL_TYPES = { below: "altına iner ≤", above: "üstüne çıkar ≥", pct_move: "günlük hareket ≥%" };
function renderAlerts() {
  const alerts = STATE?.alerts || [];
  // 1) Tetik şeridi (fired + near) — ana sayfa üstü
  const strip = $("#alertStrip");
  if (strip) {
    const fired = alerts.filter((a) => a.fired), near = alerts.filter((a) => a.near && !a.fired);
    if (fired.length || near.length) {
      strip.hidden = false;
      const pill = (a, kind) => {
        const cond = a.type === "below" ? `≤ ${fmtUSD(a.value)}` : a.type === "above" ? `≥ ${fmtUSD(a.value)}` : `|gün| ≥ %${a.value}`;
        return `<button class="al-pill ${kind}" data-sym="${a.symbol}"><b>${a.symbol}</b> ${a.price != null ? fmtUSD(a.price) : "—"} <span>${cond}</span></button>`;
      };
      strip.innerHTML = `<div class="al-strip${fired.length ? " has-fired" : ""}">
        <span class="al-strip-ic">${svgIcon("bell")}</span>
        <div class="al-strip-body">
          ${fired.length ? `<div class="al-strip-h"><b>${fired.length} fiyat alarmı TETİKLENDİ</b></div><div class="al-strip-pills">${fired.map((a) => pill(a, "fired")).join("")}</div>` : ""}
          ${near.length ? `<div class="al-strip-near"><span class="muted">${near.length} yakın:</span> ${near.map((a) => pill(a, "near")).join("")}</div>` : ""}
        </div>
      </div>`;
    } else { strip.hidden = true; strip.innerHTML = ""; }
  }
  // 2) Yönetim paneli
  const list = $("#alertsList");
  if (!list) return;
  const sub = $("#alertsSub");
  if (sub) sub.textContent = alerts.length ? `${alerts.length} alarm · ${alerts.filter((a) => a.fired).length} tetik` : "alarm yok";
  const rows = alerts.map((a) => {
    const st = a.fired ? `<span class="al-st fired">tetik</span>` : a.near ? `<span class="al-st near">yakın</span>` : `<span class="al-st">izliyor</span>`;
    const cond = a.type === "pct_move" ? `%${a.value}` : fmtUSD(a.value);
    return `<div class="al-row${a.fired ? " fired" : ""}">
      <b class="al-sym">${a.symbol}</b>
      <span class="al-cond">${AL_TYPES[a.type]} ${cond}</span>
      <span class="al-px">${a.price != null ? fmtUSD(a.price) : "—"}${a.dayChangePct != null ? ` <span class="${cls(a.dayChangePct)}">${fmtPct(a.dayChangePct)}</span>` : ""}</span>
      ${st}
      <button class="btn icon" data-al-del="${a.id}" title="Sil">🗑</button>
    </div>`;
  }).join("");
  list.innerHTML = `
    <form class="al-add" id="alertAddForm">
      <input class="al-in" id="alSym" placeholder="SEMBOL" list="symbolSuggestions" autocomplete="off" required />
      <select class="al-in" id="alType">
        <option value="above">üstüne çıkar ≥</option>
        <option value="below">altına iner ≤</option>
        <option value="pct_move">günlük hareket ≥%</option>
      </select>
      <input class="al-in al-num" id="alVal" type="number" step="any" placeholder="değer" required />
      <button class="btn primary sm" type="submit">+ Ekle</button>
    </form>
    ${rows ? `<div class="al-list">${rows}</div>` : `<div class="sw-muted al-empty">Henüz alarm yok — sembol + koşul + değer girip ekle. Tetiklenince ana sayfada uyarı çıkar.</div>`}`;
}
$("#alertStrip")?.addEventListener("click", (e) => {
  const p = e.target.closest(".al-pill"); if (p?.dataset.sym) openChartModal(p.dataset.sym);
});
$("#alertsList")?.addEventListener("submit", async (e) => {
  if (e.target.id !== "alertAddForm") return;
  e.preventDefault();
  const symbol = ($("#alSym").value || "").trim().toUpperCase();
  const type = $("#alType").value, value = parseFloat($("#alVal").value);
  if (!symbol || !isFinite(value)) return;
  try { await fetch("/api/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol, type, value }) }); await load(); } catch {}
});
$("#alertsList")?.addEventListener("click", async (e) => {
  const d = e.target.closest("[data-al-del]");
  if (d) { try { await fetch(`/api/alerts/${d.dataset.alDel}`, { method: "DELETE" }); await load(); } catch {} }
});

function renderDailyBoard() {
  const el = $("#dailyBoard");
  if (!el) return;
  const S = STATE;
  if (!S || !Array.isArray(S.holdings)) { el.innerHTML = ""; return; }
  const usdtry = S.fx?.usdtry || 0;
  const today = new Date().toISOString().slice(0, 10);
  const stocks = S.holdings.filter((h) => h.type === "stock" && h.live && h.live.priceUSD != null);

  const grandTRY = S.meta?.totals?.grandTRY ?? null;
  const totalUSD = (grandTRY != null && usdtry) ? grandTRY / usdtry : null;
  const dNow = new Date();

  /* ---------- modern minimal kart yardımcıları ---------- */
  const head = (icon, accent, ttl, sub) =>
    `<div class="db-head"><span class="db-badge ${accent}">${icon}</span>` +
    `<div class="db-head-t"><span class="db-ttl">${ttl}</span>${sub ? `<span class="db-sub">${sub}</span>` : ""}</div></div>`;
  const sUSD = (n) => (n == null || isNaN(n) ? "—" : (n >= 0 ? "+" : "") + fmtUSD0(n));
  const stat = (lbl, val, c = "") => `<div class="db-stat"><span>${lbl}</span><b class="${c}">${val}</b></div>`;
  const delta = (n, pct) => {
    if (n == null || isNaN(n)) return "";
    const t = n > 0 ? "pos" : n < 0 ? "neg" : "flat";
    const ar = n > 0 ? "▲" : n < 0 ? "▼" : "▪";
    return `<span class="db-delta ${t}">${ar} ${sUSD(n)}${pct != null && !isNaN(pct) ? ` · ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : ""}</span>`;
  };
  const dbSpark = (pts) => {
    if (!pts || pts.length < 3) return "";
    const min = Math.min(...pts), max = Math.max(...pts), rng = max - min || 1, n = pts.length, W = 100, H = 30;
    const xy = pts.map((v, i) => `${((i / (n - 1)) * W).toFixed(1)},${(H - 1.5 - ((v - min) / rng) * (H - 3)).toFixed(1)}`);
    const up = pts[n - 1] >= pts[0], col = up ? "var(--up)" : "var(--down)";
    return `<svg class="db-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="dbSparkG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".22"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
      <polygon points="0,${H} ${xy.join(" ")} ${W},${H}" fill="url(#dbSparkG)"/>
      <polyline points="${xy.join(" ")}" fill="none" stroke="${col}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
  };

  /* ---------- bugün: hisse hareketi vs kur etkisi + kazanan/kaybeden ---------- */
  const hist = (S.history || []).filter((s) => s.usdtry);
  const todayIdx = hist.findIndex((s) => s.date === today);
  const prevSnap = todayIdx > 0 ? hist[todayIdx - 1] : (todayIdx === -1 ? hist[hist.length - 1] : null);
  const usdtryPrev = prevSnap?.usdtry || null;
  let assetTRY = 0, prevUsdVal = 0, haveAsset = false, gainers = 0, losers = 0, topC = null;
  for (const h of stocks) {
    if (h.live.prevClose == null) continue;
    const chgUSD = (h.live.priceUSD - h.live.prevClose) * h.quantity;
    assetTRY += chgUSD * usdtry;
    prevUsdVal += h.live.prevClose * h.quantity;
    haveAsset = true;
    if (chgUSD > 0) gainers++; else if (chgUSD < 0) losers++;
    if (chgUSD !== 0 && (!topC || Math.abs(chgUSD) > Math.abs(topC.chg))) topC = { sym: h.symbol.toUpperCase(), chg: chgUSD };
  }
  const fxTRY = usdtryPrev ? prevUsdVal * (usdtry - usdtryPrev) : null;
  const dayTRY = assetTRY + (fxTRY || 0);
  const dayUSD = usdtry ? dayTRY / usdtry : null;
  const dayPct = (totalUSD != null && dayUSD != null && (totalUSD - dayUSD) !== 0) ? (dayUSD / (totalUSD - dayUSD)) * 100 : null;

  /* ---------- free-roll / house-money toplamları ---------- */
  const frList = stocks.map((h) => ({ h, fr: freeRollOf(h) })).filter((x) => x.fr.costBasis != null);
  let totalMV = 0, totalAtRisk = 0, freeValue = 0, totalCostBasis = 0, totalUnreal = 0;
  for (const { fr } of frList) {
    if (fr.mvUSD) totalMV += fr.mvUSD;
    totalAtRisk += Math.max(0, fr.effCost || 0);
    totalCostBasis += fr.costBasis || 0;
    if (fr.unreal != null) totalUnreal += fr.unreal;
    if (fr.free && fr.mvUSD) freeValue += fr.mvUSD;
  }
  const houseMoney = Math.max(0, totalMV - totalAtRisk);
  const freePct = totalMV > 0 ? (houseMoney / totalMV) * 100 : 0;
  const atRiskPct = totalMV > 0 ? (totalAtRisk / totalMV) * 100 : 0;
  const totalLocked = Object.values(REALIZED_USD).reduce((a, b) => a + (b || 0), 0);
  const freeCount = frList.filter((x) => x.fr.free).length;
  const recVals = frList.map((x) => x.fr.recovered).filter((v) => v != null);
  const avgRecovered = recVals.length ? recVals.reduce((a, b) => a + b, 0) / recVals.length : null;
  const unrealPct = totalCostBasis > 0 ? (totalUnreal / totalCostBasis) * 100 : null;

  /* ---------- realize / aylık hedef ---------- */
  const swGoal = SWINGDECK.goal || { min: 600, max: 700 };
  const gMin = swGoal.min || 600, gMax = swGoal.max || 700;
  const curKey = today.slice(0, 7);
  const thisMonth = swingMonthRealize(curKey);
  const pm = dNow.getMonth() - 1, prevKey = `${dNow.getFullYear() + (pm < 0 ? -1 : 0)}-${String(((pm + 12) % 12) + 1).padStart(2, "0")}`;
  const lastMonth = swingMonthRealize(prevKey);
  let ytdRealize = 0;
  for (let m = 0; m <= dNow.getMonth(); m++) ytdRealize += swingMonthRealize(`${dNow.getFullYear()}-${String(m + 1).padStart(2, "0")}`);
  const daysLeft = new Date(dNow.getFullYear(), dNow.getMonth() + 1, 0).getDate() - dNow.getDate();
  const dailyNeeded = daysLeft > 0 ? Math.max(0, gMin - thisMonth) / daysLeft : 0;

  /* ========== KPI şeridi (Net Değer · Açık K/Z · Bu Ay Realize · Risksiz) ========== */
  let kpiStrip = "";
  if (totalUSD != null) {
    const kpi = (lbl, val, sub) => `<div class="db-kpi"><span class="db-kpi-lbl">${lbl}</span><span class="db-kpi-val">${val}</span>${sub ? `<div class="db-kpi-sub">${sub}</div>` : ""}</div>`;
    kpiStrip = `<div class="db-card db-kpis">
      ${kpi("Net Değer", fmtUSD0(totalUSD), delta(dayUSD, dayPct) || `<span class="db-kpi-muted">bugün —</span>`)}
      ${kpi("Açık K/Z", `<span class="${cls(totalUnreal)}">${sUSD(totalUnreal)}</span>`, unrealPct != null ? `maliyetin ${unrealPct >= 0 ? "+" : ""}${unrealPct.toFixed(1)}%'i` : "açık pozisyon kâr/zarar")}
      ${kpi("Bu Ay Realize", `<span class="${cls(thisMonth)}">${fmtUSD0(thisMonth)}</span>`, `hedefin %${Math.max(0, Math.min(100, Math.round((thisMonth / gMin) * 100)))} kadarı`)}
      ${kpi("Risksiz Oran", `${freePct.toFixed(0)}<span class="db-kpi-pct">%</span>`, `${fmtUSD0(freeValue)} bedava değer`)}
    </div>`;
  }

  /* ========== Yaklaşan Bilançolar ========== */
  const earn = [];
  for (const h of stocks) {
    const e = h.earnings;
    if (e && e.daysLeft != null && e.daysLeft >= 0 && e.daysLeft <= 21)
      earn.push({ sym: h.symbol.toUpperCase(), date: e.date, days: e.daysLeft, move: e.expectedMovePct ?? null });
  }
  earn.sort((a, b) => a.days - b.days);
  const earnRows = earn.map((e) => {
    const tone = e.days <= 3 ? "bad" : e.days <= 7 ? "warn" : "ok";
    const badge = e.days <= 3 ? "yüksek risk" : e.days <= 7 ? "yaklaşıyor" : "";
    return `<li class="db-earn s-${tone}">
      <span class="db-earn-sym">${e.sym}</span>
      <span class="db-earn-mid"><span class="db-earn-date">${fmtDate(e.date)}</span>${e.move != null ? `<span class="db-earn-move">±%${Number(e.move).toFixed(1)} beklenen</span>` : ""}</span>
      <span class="db-earn-days">${e.days === 0 ? "bugün" : e.days + " gün"}</span>
      ${badge ? `<span class="db-earn-badge b-${tone}">${badge}</span>` : ""}
    </li>`;
  }).join("");
  const earnCard = `<div class="db-card db-earn-card">${head("📅", "a", "Yaklaşan Bilançolar", earn.length ? `${earn.length} bilanço · 21 gün` : "önümüzdeki 21 gün")}
    ${earn.length ? `<ul class="db-earn-list">${earnRows}</ul>
       <div class="db-foot">Bilanço bir yazı-tura — 3 günden yakınsa pozisyonu küçültmeyi düşün (Kural 1).</div>`
      : `<div class="db-empty">Önümüzdeki 21 günde tuttuğun hisselerde bilanço yok. 🟢</div>`}
  </div>`;

  /* ========== Swing Nöbeti: açık swing'lerde stop/hedef tetik (Kural 1) ========== */
  let swingStrip = "";
  const swAlerts = (SWINGDECK.trades || []).filter((t) => t.status === "open")
    .map((t) => ({ t, e: swEnrich(t) })).filter((x) => x.e.alert);
  if (swAlerts.length) {
    const rows = swAlerts.map(({ t, e }) => {
      const sym = String(t.symbol).toUpperCase();
      const bClose = `<button class="db-swbtn sell" data-sw-sellfull="${t.id}">💵 Kapat</button>`;
      const bProfit = `<button class="db-swbtn sell" data-sw-sellfull="${t.id}">💵 Kâr-al</button>`;
      const bStop = `<button class="db-swbtn edit" data-sw-editstop="${t.id}">⤴ Stop yükselt</button>`;
      const mk = (c, txt, acts) => `<div class="db-swrow ${c}"><span class="db-swrow-txt">${txt}</span><span class="db-swrow-acts">${acts}</span></div>`;
      if (e.alert === "stop") return mk("stop", `⛔ <b>${sym}</b> stop tetiklendi · ${fmtUSD(e.live)} ≤ ${fmtUSD(t.stop)} — planı uygula, sermayeyi koru`, bClose);
      if (e.alert === "target") return mk("target", `🎯 <b>${sym}</b> hedefi geçti · ${fmtUSD(e.live)} ≥ ${fmtUSD(t.target)} — kâr-al / stop'u yukarı taşı`, bProfit + bStop);
      return mk("near", `⚠ <b>${sym}</b> stop'a %${(e.toStop || 0).toFixed(0)} pay kaldı · ${fmtUSD(e.live)} — koru`, bStop);
    }).join("");
    swingStrip = `<div class="db-card db-swstrip">${head("📈", "a", "Swing Nöbeti", `${swAlerts.length} açık uyarı · Kural 1`)}${rows}</div>`;
  }

  el.innerHTML = `${kpiStrip}${swingStrip}<div class="db-grid db-grid-solo">${earnCard}</div>`;

  // Yeni kartlardaki sekme bağlantıları (async re-render'da kopmasın diye #dailyBoard'a tek seferlik delege)
  if (!el._boundNav) {
    el._boundNav = true;
    el.addEventListener("click", (ev) => {
      const g = ev.target.closest("[data-goview]");
      if (g) { ev.stopPropagation(); showView(g.dataset.goview); return; }
      const sf = ev.target.closest("[data-sw-sellfull]");
      if (sf) { ev.stopPropagation(); openSwingSell(sf.dataset.swSellfull, true); return; } // tek tık → kapat (tüm adet ön-dolu, modalda onay)
      const se = ev.target.closest("[data-sw-editstop]");
      if (se) { ev.stopPropagation(); openSwingModal(se.dataset.swEditstop); setTimeout(() => swingForm?.stop?.focus(), 80); return; } // stop yükselt → edit modalı, stop alanı odaklı
    });
  }
}

/* ---------------- Modal: realize edilen işlemler ---------------- */
const tradeModalBg = $("#tradeModalBg");
const tradeForm = $("#tradeForm");
let TRADE_SYMBOL = null;

/* ---- Realize kazançları (broker "beyana tabi" tutarları) — vergi yılı seçicili ---- */
let R26_YEAR = null; // seçili vergi yılı (null → ilk render'da bugünün yılı/son yıl)
const r26YearOf = (r) => Number(r.year) || Number(String(r.date || "").slice(0, 4)) || 2026;
const r26ForYear = (year) => (STATE?.realized2026 || []).filter((r) => r26YearOf(r) === year);

function renderRealized2026() {
  const el = $("#realized2026");
  if (!el) return;
  const all = (STATE?.realized2026 || []).slice();
  const sub = $("#r26Sub");
  const sel = $("#r26Year");
  const titleEl = $("#r26Title");

  // Mevcut yıllar + seçili yıl
  const years = [...new Set(all.map(r26YearOf))].sort((a, b) => b - a);
  const curY = new Date().getFullYear();
  if (R26_YEAR == null) R26_YEAR = years.includes(curY) ? curY : (years[0] || curY);
  if (sel) {
    const opts = years.length ? years.slice() : [curY];
    if (!opts.includes(R26_YEAR)) opts.unshift(R26_YEAR);
    sel.innerHTML = opts.map((y) => `<option value="${y}"${y === R26_YEAR ? " selected" : ""}>${y}</option>`).join("");
  }
  if (titleEl) titleEl.textContent = R26_YEAR;

  const list = all.filter((r) => r26YearOf(r) === R26_YEAR);
  if (!list.length) {
    if (sub) sub.textContent = `${R26_YEAR} · kayıt yok`;
    el.innerHTML = `<div class="r26-empty">${R26_YEAR} yılı için kayıt yok. Satışlar otomatik düşer; broker kalemlerini “+ Kayıt Ekle”, eski satışları “↻ Satışları senkronla” ile getir.</div>`;
    return;
  }
  const net = list.reduce((s, x) => s + (Number(x.amountTRY) || 0), 0);
  const gains = list.filter((x) => x.amountTRY > 0).reduce((s, x) => s + x.amountTRY, 0);
  const losses = list.filter((x) => x.amountTRY < 0).reduce((s, x) => s + x.amountTRY, 0);
  // ── Sembol başına grupla (MULL'un 5 işlemi tek MULL satırında toplanır) ──
  const groups = {};
  for (const r of list) {
    const key = String(r.symbol || r.label || "—").toUpperCase();
    const g = (groups[key] = groups[key] || { key, sym: r.symbol || r.label || "—", total: 0, recs: [] });
    g.total += Number(r.amountTRY) || 0;
    g.recs.push(r);
  }
  const grouped = Object.values(groups).sort((a, b) => b.total - a.total);
  const mf = STATE?.midasFees || null; // Midas işlem ücreti özeti (her emir $1.5)
  if (sub) sub.textContent = `${R26_YEAR} · ${grouped.length} sembol · ${list.length} kayıt · net ${fmtTRY0(net)}`;
  // Aksiyon hücresi: ✎ düzelt her satırda; truth kalemi düzeltilmişse ↺ geri al, manuel kayıtta 🗑 sil
  const actCell = (r) => {
    const edit = `<button class="rz-edit" data-r26edit="${r.id}" data-r26cur="${Math.round(Number(r.amountTRY) || 0)}" title="Tutarı düzelt">✎</button>`;
    const isTruth = String(r.id).startsWith("r26-truth-");
    const extra = isTruth
      ? (r.edited ? `<button class="rz-edit rz-reset" data-r26reset="${r.id}" title="Broker değerine geri dön">↺</button>` : "")
      : `<button class="btn icon" data-delr26="${r.id}" title="Sil">🗑</button>`;
    return `<span class="r26-acts">${edit}${extra}</span>`;
  };
  const flag = (r) => r.edited ? `<span class="r26-auto r26-edited" title="Elle düzeltildi">✓ düzeltildi</span>` : r.auto ? `<span class="r26-auto" title="Satış işleminden otomatik">oto</span>` : "";
  const subRow = (r, key) => `<tr class="r26-sub" data-sub="${key}" hidden>
      <td class="l r26-sub-c">
        <span class="nm">${(r.label || r.symbol || "").replace(/"/g, "")}</span>
        ${flag(r)}
        ${r.date ? `<span class="tnote"> · 📅 ${fmtDate(r.date)}</span>` : ""}
      </td>
      <td class="${cls(r.amountTRY)}">${fmtTRY(r.amountTRY)}</td>
      <td>${actCell(r)}</td>
    </tr>`;
  const rows = grouped.map((g) => {
    const multi = g.recs.length > 1;
    const only = g.recs[0];
    if (!multi) {
      return `<tr>
      <td class="l">
        <span class="sym">${g.sym}</span> ${only.label && only.label !== g.sym ? `<span class="nm">${(only.label).replace(/"/g, "")}</span>` : ""}
        ${flag(only)}
        ${only.date ? `<div class="tnote">📅 ${fmtDate(only.date)}</div>` : ""}
      </td>
      <td class="${cls(g.total)}">${fmtTRY(g.total)}</td>
      <td>${actCell(only)}</td>
    </tr>`;
    }
    return `<tr class="r26-grp" data-grp="${g.key}">
      <td class="l">
        <span class="r26-exp">▸</span> <span class="sym">${g.sym}</span>
        <span class="r26-cnt">${g.recs.length} işlem</span>
      </td>
      <td class="${cls(g.total)}">${fmtTRY(g.total)}</td>
      <td></td>
    </tr>` + g.recs.slice().sort((a, b) => b.amountTRY - a.amountTRY)
      .map((r) => subRow(r, g.key)).join("");
  }).join("");
  el.innerHTML = `
    <div class="r26-summary">
      <div class="r26-stat"><span>Net realize</span><b class="${cls(net)}">${fmtTRY(net)}</b></div>
      <div class="r26-stat"><span>Toplam kazanç</span><b class="pos">${fmtTRY0(gains)}</b></div>
      <div class="r26-stat"><span>Toplam zarar</span><b class="neg">${fmtTRY0(losses)}</b></div>
      ${mf && mf.count ? `<div class="r26-stat" title="Midas her emirde (alış+satış) $${(mf.perTrade || 1.5).toFixed(2)} komisyon keser. ${mf.count} emir · realize tutarları bu komisyon düşülmüş NET'tir.">
        <span>Midas işlem ücreti</span><b class="neg">−${fmtTRY0(mf.tryTot)} <span class="muted" style="font-weight:600">($${fmtNum(mf.usd, 2)} · ${mf.count} emir)</span></b></div>` : ""}
    </div>
    <div class="tbl-wrap"><table class="r26-table">
      <thead><tr><th class="l">Sembol / Açıklama</th><th>Realize (₺)</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

// Sermaye defteri: para giriş/çıkış listesi + net sermaye özeti
function renderFlows() {
  const box = $("#flowsList");
  if (!box) return;
  const flows = [...(STATE.flows || [])].sort((a, b) =>
    (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)
  );
  const symFor = (c) => (c === "USD" ? "$" : c === "EUR" ? "€" : "₺");

  let net = 0, dep = 0, wd = 0;
  const rows = flows.map((f) => {
    const try_ = Number(f.amountTRY) || 0;
    const sign = f.type === "withdraw" ? -1 : 1;
    net += sign * try_;
    if (sign > 0) dep += try_; else wd += try_;
    return `<tr>
      <td class="l">${fmtDate(f.date)}</td>
      <td class="l"><span class="flow-tag ${f.type}">${f.type === "withdraw" ? "Çekme" : "Yatırma"}</span>${f.note ? `<div class="tnote">${f.note}</div>` : ""}</td>
      <td>${symFor(f.currency)}${fmtNum(f.amount, 2)}</td>
      <td class="${f.type === "withdraw" ? "neg" : "pos"}">${f.type === "withdraw" ? "−" : "+"}${fmtTRY0(try_)}</td>
      <td><button class="btn icon" data-delflow="${f.id}" title="Sil">🗑</button></td>
    </tr>`;
  }).join("");

  box.innerHTML = `
    <div class="trade-list-wrap">
      <table class="trade-table">
        <thead><tr>
          <th class="l">Tarih</th><th class="l">Tür</th><th>Tutar</th><th>₺ Karşılığı</th><th></th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="5" class="empty-row">Henüz kayıt yok. “+ Para Yatır” ile yatırdığın sermayeyi gir; gerçek getirin hesaplansın.</td></tr>`}</tbody>
      </table>
    </div>`;

  $("#flowsSub").innerHTML = flows.length
    ? `Net sermaye <b>${fmtTRY0(net)}</b> · Yatırılan ${fmtTRY0(dep)} − Çekilen ${fmtTRY0(wd)}`
    : "Yatırdığın parayı kaydet, gerçek getirini gör";

  box.querySelectorAll("[data-delflow]").forEach((b) =>
    b.addEventListener("click", async () => {
      await fetch(`/api/flows/${b.dataset.delflow}`, { method: "DELETE" });
      await load();
    })
  );
}

// Sayfa altındaki "İşlem Geçmişi" paneli: tüm sembollerin realize işlemleri
let TRADE_RANGE = "all";   // 1w | 1m | 3m | 1y | all
const TRADE_RANGE_DAYS = { "1w": 7, "1m": 30, "3m": 90, "1y": 365 };

function renderAllTrades() {
  const box = $("#allTrades");
  if (!box) return;
  const usdtry = STATE.fx.usdtry || 0;

  // Seçili zaman aralığına göre filtrele (tarih bazlı)
  const days = TRADE_RANGE_DAYS[TRADE_RANGE];
  let from = null;
  if (days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    from = d.toISOString().slice(0, 10);
  }
  const trades = [...(STATE.trades || [])]
    .filter((t) => !from || t.date >= from)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // en yeni en üstte

  let totUSD = 0, totProceeds = 0, sellCount = 0;
  const rows = trades.map((t) => {
    if (t.kind === "buy") {
      return `<tr>
        <td class="l">${fmtDate(t.date)}</td>
        <td class="l"><span class="sym">${t.symbol}</span> <span class="flow-tag deposit">Alış</span>${t.note ? `<div class="tnote">${t.note}</div>` : ""}</td>
        <td>${fmtNum(t.shares, 4)}</td>
        <td>${fmtUSD(t.buyUSD)}</td>
        <td>—</td>
        <td class="muted">maliyet ${fmtUSD(t.shares * t.buyUSD)}</td>
        <td>—</td>
        <td><button class="btn icon" data-delalltrade="${t.id}" title="Sil">🗑</button></td>
      </tr>`;
    }
    const pnl = t.shares * (t.sellUSD - t.buyUSD);
    const cost = t.shares * t.buyUSD;
    const pct = cost ? (pnl / cost) * 100 : null;
    totUSD += pnl; totProceeds += t.shares * t.sellUSD; sellCount++;
    const isSwingSell = t.src === "swing" || /swing/i.test(t.note || "");
    return `<tr>
      <td class="l">${fmtDate(t.date)}</td>
      <td class="l"><span class="sym">${t.symbol}</span>${isSwingSell ? ` <span class="tr-src-swing" title="Swing satışı — uzun vadeden ayrı değerlendirilir, toplama dahildir">⚡swing</span>` : ` <span class="tr-src-port" title="Uzun vade (portföy) satışı">uzun</span>`}${t.note ? `<div class="tnote">${t.note}</div>` : ""}</td>
      <td>${fmtNum(t.shares, 4)}</td>
      <td>${fmtUSD(t.buyUSD)}</td>
      <td>${fmtUSD(t.sellUSD)}</td>
      <td class="${cls(pnl)}">${fmtUSD(pnl)}</td>
      <td class="${pct != null ? cls(pct) : ""}">${fmtPct(pct)}</td>
      <td><button class="btn icon" data-delalltrade="${t.id}" title="Sil">🗑</button></td>
    </tr>`;
  }).join("");

  box.innerHTML = `
    <div class="trade-list-wrap">
      <table class="trade-table">
        <thead><tr>
          <th class="l">Tarih</th><th class="l">Sembol</th><th>Adet</th>
          <th>Alış $</th><th>Satış $</th><th>Realize K/Z</th><th>%</th><th></th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="8" class="empty-row">${TRADE_RANGE === "all" ? "Henüz işlem yok. “+ İşlem Ekle” ile sattığın hisseleri kaydet." : "Bu zaman aralığında işlem yok."}</td></tr>`}</tbody>
      </table>
    </div>`;

  const totPct = totProceeds - totUSD ? (totUSD / (totProceeds - totUSD)) * 100 : 0;
  const rangeLbl = { "1w": "son 7 gün", "1m": "son 30 gün", "3m": "son 3 ay", "1y": "son 1 yıl", all: "tüm zamanlar" }[TRADE_RANGE];
  $("#tradesSub").innerHTML = trades.length
    ? `${rangeLbl} · ${trades.length} işlem (${sellCount} satış) · Realize K/Z <b class="${cls(totUSD)}">${fmtUSD(totUSD)}</b> (${fmtPct(totPct)}) ≈ <b class="${cls(totUSD)}">${fmtTRY0(totUSD * usdtry)}</b>`
    : `${rangeLbl} · işlem yok`;

  box.querySelectorAll("[data-delalltrade]").forEach((b) =>
    b.addEventListener("click", async () => {
      await fetch(`/api/trades/${b.dataset.delalltrade}`, { method: "DELETE" });
      await load();
    })
  );
}

function openTrades(symbol) {
  TRADE_SYMBOL = symbol || null;
  const h = symbol && STATE.holdings.find((x) => x.symbol === symbol && x.type === "stock");
  tradeForm.reset();
  tradeForm.symbol.value = symbol || "";
  tradeForm.symbol.readOnly = !!symbol;        // satırdan açıldıysa sembol sabit
  tradeForm.name.value = h?.name || "";
  tradeForm.date.value = new Date().toISOString().slice(0, 10);
  // Satış için ortalama maliyeti otomatik doldur — K/Z gerçek maliyetten hesaplansın
  if (h?.costUSD != null) tradeForm.buyUSD.value = h.costUSD;
  $("#tradeTitle").textContent = symbol ? `${symbol} · Hisse İşlemleri` : "Yeni İşlem Ekle";
  toggleTradeKind();
  renderTrades();
  tradeModalBg.hidden = false;
}

// Alış/Satış'a göre form alanlarını ayarla
function toggleTradeKind() {
  const buy = tradeForm.kind.value === "buy";
  $("#tfSellLabel").style.display = buy ? "none" : "";
  $("#tfSharesLabel").firstChild.textContent = buy ? "Adet (alınan)" : "Adet (satılan)";
  $("#tfBuyLabel").firstChild.textContent = buy ? "Alış Fiyatı ($)" : "Alış Fiyatı ($ · boşsa ort. maliyet)";
  updateTradePreview();
}

function renderTrades() {
  const trades = (STATE.trades || []).filter((t) => !TRADE_SYMBOL || t.symbol === TRADE_SYMBOL);
  const usdtry = STATE.fx.usdtry || 0;
  let totUSD = 0, totProceeds = 0, totCost = 0, sellCount = 0;
  const rows = trades.map((t) => {
    if (t.kind === "buy") {
      return `<tr class="tr-buy">
        <td class="l">${fmtDate(t.date)}</td>
        <td class="l"><span class="sym">${t.symbol}</span> <span class="flow-tag deposit">Alış</span>${t.note ? `<div class="tnote">${t.note}</div>` : ""}</td>
        <td>${fmtNum(t.shares, 4)}</td>
        <td>${fmtUSD(t.buyUSD)}</td>
        <td class="muted">—</td>
        <td class="muted">maliyet ${fmtUSD(t.shares * t.buyUSD)}</td>
        <td class="muted">—</td>
        <td><button class="btn icon" data-deltrade="${t.id}" title="Sil">🗑</button></td>
      </tr>`;
    }
    const pnl = t.shares * (t.sellUSD - t.buyUSD);
    const cost = t.shares * t.buyUSD;
    const pct = cost ? (pnl / cost) * 100 : null;
    totUSD += pnl; totProceeds += t.shares * t.sellUSD; totCost += cost; sellCount++;
    return `<tr class="tr-sell ${pnl >= 0 ? "win" : "loss"}">
      <td class="l">${fmtDate(t.date)}</td>
      <td class="l"><span class="sym">${t.symbol}</span> <span class="flow-tag sell-tag">Satış</span>${t.note ? `<div class="tnote">${t.note}</div>` : ""}</td>
      <td>${fmtNum(t.shares, 4)}</td>
      <td>${fmtUSD(t.buyUSD)}</td>
      <td>${fmtUSD(t.sellUSD)}</td>
      <td><span class="tt-pnl ${cls(pnl)}">${pnl >= 0 ? "+" : ""}${fmtUSD(pnl)}</span></td>
      <td class="${pct != null ? cls(pct) : ""}">${fmtPct(pct)}</td>
      <td><button class="btn icon" data-deltrade="${t.id}" title="Sil">🗑</button></td>
    </tr>`;
  }).join("");

  $("#tradeRows").innerHTML = rows || `<tr><td colspan="8" class="empty-row">${TRADE_SYMBOL ? "Bu hisse için henüz işlem kaydı yok." : "Henüz işlem kaydı yok."}</td></tr>`;
  const totPct = totCost ? (totUSD / totCost) * 100 : 0;
  const heroTone = totUSD > 0 ? "pos" : totUSD < 0 ? "neg" : "flat";
  $("#tradeSummary").innerHTML = `
    <div class="ts-item ts-count"><span>İşlem</span><b>${trades.length}</b>${sellCount !== trades.length ? `<i>${sellCount} satış</i>` : `<i>&nbsp;</i>`}</div>
    <div class="ts-item ts-proceeds"><span>Toplam Satış</span><b>${fmtUSD(totProceeds)}</b><i>gerçekleşen ciro</i></div>
    <div class="ts-item ts-hero ts-${heroTone}"><span>Realize K/Z</span><b>${totUSD > 0 ? "+" : ""}${fmtUSD(totUSD)}</b><i>${totUSD > 0 ? "▲" : totUSD < 0 ? "▼" : ""} ${fmtPct(totPct)} getiri</i></div>
    <div class="ts-item ts-try"><span>≈ ₺ karşılığı</span><b>${fmtTRY0(totUSD * usdtry)}</b><i>${usdtry ? "kur " + fmtNum(usdtry, 2) : "&nbsp;"}</i></div>`;

  document.querySelectorAll("[data-deltrade]").forEach((b) =>
    b.addEventListener("click", async () => {
      await fetch(`/api/trades/${b.dataset.deltrade}`, { method: "DELETE" });
      await load();
      openTrades(TRADE_SYMBOL);
    })
  );
}

function updateTradePreview() {
  const sh = +tradeForm.shares.value || 0;
  const buy = +tradeForm.buyUSD.value || 0;
  const sell = +tradeForm.sellUSD.value || 0;
  if (tradeForm.kind.value === "buy") {
    const usdtry = STATE.fx?.usdtry || 0;
    $("#tfPreview").innerHTML = sh && buy
      ? `Maliyet: <b>${fmtUSD(sh * buy)}</b>${usdtry ? ` ≈ ${fmtTRY0(sh * buy * usdtry)}` : ""} · pozisyona eklenecek`
      : "Maliyet: —";
    return;
  }
  if (!sh || (!buy && !sell)) { $("#tfPreview").textContent = "Realize: —"; return; }
  const pnl = sh * (sell - buy);
  const pct = sh * buy ? (pnl / (sh * buy)) * 100 : 0;
  $("#tfPreview").innerHTML = `Realize: <b class="${cls(pnl)}">${fmtUSD(pnl)} (${fmtPct(pct)})</b> · Satış ${fmtUSD(sh * sell)}`;
}
["shares", "buyUSD", "sellUSD"].forEach((n) => tradeForm[n].addEventListener("input", updateTradePreview));
$("#tfKind").addEventListener("change", toggleTradeKind);

$("#addTradeBtn").addEventListener("click", () => openTrades(null));
$("#tradeRangeTabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-trange]");
  if (!b) return;
  TRADE_RANGE = b.dataset.trange;
  $("#tradeRangeTabs").querySelectorAll(".rt").forEach((x) => x.classList.toggle("active", x === b));
  renderAllTrades();
});
$("#tradeCloseBtn").addEventListener("click", () => (tradeModalBg.hidden = true));
tradeModalBg.addEventListener("click", (e) => { if (e.target === tradeModalBg) tradeModalBg.hidden = true; });

tradeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(tradeForm).entries());
  const sym = String(fd.symbol || "").trim().toUpperCase();
  if (!sym) return;
  const body = {
    symbol: sym, name: fd.name, date: fd.date, kind: fd.kind || "sell",
    shares: +fd.shares || 0, buyUSD: +fd.buyUSD || 0, sellUSD: +fd.sellUSD || 0,
    note: fd.note || "",
  };
  // Varlık senkronu (alışta ekleme/ortalama, satışta düşme/kapanış) sunucuda
  // tek noktadan yapılır; dönen "sync" mesajı ne olduğunu söyler.
  const r = await fetch("/api/trades", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const resp = await r.json().catch(() => ({}));

  await load();
  // Satırdan açıldıysa o sembolde kal; global ekleme ise listeyi açık tut
  openTrades(TRADE_SYMBOL || sym);
  $("#tfPreview").innerHTML = r.ok
    ? `<b class="pos">✓ İşlem eklendi</b>${resp.sync ? ` · ${resp.sync}` : ""}`
    : `<b class="neg">✗ ${resp.error || "İşlem eklenemedi"}</b>`;
});

/* ---------------- Modal: para giriş/çıkış ---------------- */
const flowModalBg = $("#flowModalBg");
const flowForm = $("#flowForm");

function flowTRY(amount, currency) {
  const fx = STATE.fx || {};
  if (currency === "USD") return amount * (fx.usdtry || 0);
  if (currency === "EUR") return amount * (fx.eurtry || 0);
  return amount; // TL
}
function openFlow(type) {
  flowForm.reset();
  flowForm.type.value = type;
  flowForm.date.value = new Date().toISOString().slice(0, 10);
  flowForm.currency.value = "TL";
  $("#flowTitle").textContent = type === "withdraw" ? "Para Çek" : "Para Yatır";
  $("#flowPreview").textContent = "≈ ₺ —";
  flowModalBg.hidden = false;
}
function updateFlowPreview() {
  const amt = +flowForm.amount.value || 0;
  const cur = flowForm.currency.value;
  $("#flowPreview").innerHTML = amt
    ? `≈ <b>${fmtTRY(flowTRY(amt, cur))}</b>${cur !== "TL" ? ` (${cur} kuru: ${fmtNum(cur === "USD" ? STATE.fx.usdtry : STATE.fx.eurtry, 4)})` : ""}`
    : "≈ ₺ —";
}
["amount", "currency"].forEach((n) => flowForm[n].addEventListener("input", updateFlowPreview));

$("#addDepositBtn").addEventListener("click", () => openFlow("deposit"));
$("#addWithdrawBtn").addEventListener("click", () => openFlow("withdraw"));
$("#flowCancelBtn").addEventListener("click", () => (flowModalBg.hidden = true));
flowModalBg.addEventListener("click", (e) => { if (e.target === flowModalBg) flowModalBg.hidden = true; });

flowForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(flowForm).entries());
  const amount = +fd.amount || 0;
  if (!amount) return;
  const body = {
    type: fd.type, date: fd.date, currency: fd.currency, amount,
    amountTRY: flowTRY(amount, fd.currency), note: fd.note || "",
  };
  await fetch("/api/flows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  flowModalBg.hidden = true;
  await load();
});

/* ---- 2026 realize kazanç kaydı: modal + ekle/sil ---- */
const r26ModalBg = $("#r26ModalBg");
const r26Form = $("#r26Form");
$("#addR26Btn")?.addEventListener("click", () => { r26Form.reset(); r26ModalBg.hidden = false; setTimeout(() => r26Form.label.focus(), 50); });
$("#syncR26Btn")?.addEventListener("click", async () => {
  const btn = $("#syncR26Btn");
  btn.disabled = true; btn.textContent = "↻ Senkronlanıyor…";
  try {
    const r = await fetch("/api/realized2026/sync-trades", { method: "POST" });
    const d = await r.json().catch(() => ({}));
    if (r.ok) toast(d.added ? `${d.added} satış realize defterine eklendi` : "Tüm satışlar zaten ekli", d.added ? "ok" : "warn");
    else toast(d.error || "Senkron başarısız", "err");
  } catch { toast("Senkron başarısız", "err"); }
  btn.disabled = false; btn.textContent = "↻ Satışları senkronla";
  await load();
});
$("#r26CancelBtn")?.addEventListener("click", () => (r26ModalBg.hidden = true));
r26ModalBg?.addEventListener("click", (e) => { if (e.target === r26ModalBg) r26ModalBg.hidden = true; });
r26Form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(r26Form).entries());
  const amountTRY = Number(fd.amountTRY);
  if (!fd.label || !isFinite(amountTRY)) return;
  await fetch("/api/realized2026", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: fd.label, amountTRY, date: fd.date || null, year: R26_YEAR }) });
  r26ModalBg.hidden = true;
  toast("Realize kaydı eklendi");
  await load();
});
// Vergi yılı değişimi
$("#r26Year")?.addEventListener("change", (e) => { R26_YEAR = Number(e.target.value) || R26_YEAR; renderRealized2026(); });
$("#realized2026")?.addEventListener("click", async (e) => {
  // ✎ tutarı düzelt (truth kalemi ya da manuel kayıt)
  const editBtn = e.target.closest("[data-r26edit]");
  if (editBtn) {
    const id = editBtn.dataset.r26edit;
    const cur = Number(editBtn.dataset.r26cur) || 0;
    const rec = (STATE?.realized2026 || []).find((x) => x.id === id);
    const val = await promptDialog({
      title: `${rec?.label || rec?.symbol || "Kayıt"} — gerçek realize (₺)`,
      message: "Broker'daki net kâr/zarar tutarını gir. Zarar için başına − koy.",
      value: String(cur), suffix: "₺",
    });
    if (val == null) return;
    const r = await fetch(`/api/realized2026/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amountTRY: val }) });
    if (!r.ok) return toast("Kaydedilemedi", "err");
    toast("Tutar güncellendi");
    await load();
    return;
  }
  // ↺ truth kalemini broker değerine geri al
  const resetBtn = e.target.closest("[data-r26reset]");
  if (resetBtn) {
    const ok = await confirmDialog({ title: "Düzeltme geri alınsın mı?", message: "Bu kalem broker'daki orijinal değerine döner.", confirmText: "Geri al" });
    if (!ok) return;
    await fetch(`/api/realized2026/${resetBtn.dataset.r26reset}`, { method: "DELETE" });
    toast("Broker değerine dönüldü");
    await load();
    return;
  }
  // Sembol grubu aç/kapa
  const grp = e.target.closest(".r26-grp[data-grp]");
  if (grp) {
    const key = grp.dataset.grp;
    const open = grp.classList.toggle("is-open");
    grp.querySelector(".r26-exp")?.classList.toggle("rot", open);
    grp.parentElement.querySelectorAll(`tr.r26-sub[data-sub="${CSS.escape(key)}"]`).forEach((tr) => { tr.hidden = !open; });
    return;
  }
  const b = e.target.closest("[data-delr26]");
  if (!b) return;
  const ok = await confirmDialog({ title: "Kayıt silinsin mi?", message: "Bu realize kaydı kaldırılacak.", confirmText: "Sil", danger: true });
  if (!ok) return;
  await fetch(`/api/realized2026/${b.dataset.delr26}`, { method: "DELETE" });
  toast("Kayıt silindi");
  await load();
});

/* ---- Vergi beyanı özeti + CSV çıktısı ---- */
const taxModalBg = $("#taxModalBg");
function openTaxModal() {
  const year = R26_YEAR || new Date().getFullYear();
  const list = r26ForYear(year).slice().sort((a, b) =>
    (a.date || "") < (b.date || "") ? 1 : (a.date || "") > (b.date || "") ? -1 : b.amountTRY - a.amountTRY);
  const gains = list.filter((x) => x.amountTRY > 0).reduce((s, x) => s + x.amountTRY, 0);
  const losses = list.filter((x) => x.amountTRY < 0).reduce((s, x) => s + x.amountTRY, 0);
  const net = gains + losses;
  const winN = list.filter((x) => x.amountTRY > 0).length;
  const lossN = list.filter((x) => x.amountTRY < 0).length;

  $("#taxYearTitle").textContent = year;
  const rows = list.map((r) => `<tr>
      <td class="l tx-date">${r.date ? fmtDate(r.date) : "<span class='muted'>—</span>"}</td>
      <td class="l"><b>${r.symbol || ""}</b> <span class="muted">${(r.label || "").replace(/"/g, "")}</span>${r.auto ? ` <span class="r26-auto">oto</span>` : ""}</td>
      <td class="${cls(r.amountTRY)} tx-amt">${fmtTRY(r.amountTRY)}</td>
    </tr>`).join("");

  $("#taxBody").innerHTML = list.length ? `
    <div class="tax-cards">
      <div class="tax-card"><span>Net realize (${year})</span><b class="${cls(net)}">${fmtTRY(net)}</b><small>${list.length} işlem</small></div>
      <div class="tax-card"><span>Toplam kazanç</span><b class="pos">${fmtTRY0(gains)}</b><small>${winN} kârlı</small></div>
      <div class="tax-card"><span>Toplam zarar</span><b class="neg">${fmtTRY0(losses)}</b><small>${lossN} zararlı</small></div>
    </div>
    <div class="tbl-wrap"><table class="tax-table">
      <thead><tr><th class="l">Tarih</th><th class="l">Sembol / Açıklama</th><th>Realize (₺)</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td class="l" colspan="2"><b>NET (${year})</b></td><td class="${cls(net)} tx-amt"><b>${fmtTRY(net)}</b></td></tr></tfoot>
    </table></div>`
    : `<div class="r26-empty">${year} yılı için kayıt yok — önce satışlarını senkronla veya kayıt ekle.</div>`;

  taxModalBg.hidden = false;
}
function downloadTaxCsv() {
  const year = R26_YEAR || new Date().getFullYear();
  const list = r26ForYear(year).slice().sort((a, b) => (a.date || "") < (b.date || "") ? -1 : 1);
  const gains = list.filter((x) => x.amountTRY > 0).reduce((s, x) => s + x.amountTRY, 0);
  const losses = list.filter((x) => x.amountTRY < 0).reduce((s, x) => s + x.amountTRY, 0);
  // Excel-TR uyumu: ';' ayraç + ondalık virgül + UTF-8 BOM
  const num = (v) => Number(v).toFixed(2).replace(".", ",");
  const esc = (v) => `"${String(v ?? "").replace(/"/g, "'")}"`;
  const lines = [["Tarih", "Sembol", "Açıklama", "Realize TL", "Tür", "Kaynak"].map(esc).join(";")];
  for (const r of list) lines.push([r.date || "", r.symbol || "", r.label || "", num(r.amountTRY), r.amountTRY >= 0 ? "Kazanç" : "Zarar", r.auto ? "Otomatik (satış)" : "Manuel"].map(esc).join(";"));
  lines.push("");
  lines.push([esc(""), esc(""), esc("TOPLAM KAZANÇ"), esc(num(gains)), esc(""), esc("")].join(";"));
  lines.push([esc(""), esc(""), esc("TOPLAM ZARAR"), esc(num(losses)), esc(""), esc("")].join(";"));
  lines.push([esc(""), esc(""), esc("NET REALİZE"), esc(num(gains + losses)), esc(""), esc("")].join(";"));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `realize-beyan-${year}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`${year} CSV indirildi`, "ok");
}
$("#exportR26Btn")?.addEventListener("click", openTaxModal);
$("#taxCloseBtn")?.addEventListener("click", () => (taxModalBg.hidden = true));
taxModalBg?.addEventListener("click", (e) => { if (e.target === taxModalBg) taxModalBg.hidden = true; });
$("#taxCsvBtn")?.addEventListener("click", downloadTaxCsv);
$("#taxPrintBtn")?.addEventListener("click", () => {
  document.body.classList.add("tax-printing");
  window.print();
  setTimeout(() => document.body.classList.remove("tax-printing"), 500);
});

