const $ = (s, el = document) => el.querySelector(s);
const fmtTRY = (n) =>
  n == null || isNaN(n) ? "—" : "₺" + Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtTRY0 = (n) =>
  n == null || isNaN(n) ? "—" : "₺" + Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 0 });
const fmtUSD = (n) =>
  n == null || isNaN(n) ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtUSD0 = (n) =>
  n == null || isNaN(n) ? "—" : "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
const fmtNum = (n, d = 4) =>
  n == null || isNaN(n) ? "—" : Number(n).toLocaleString("tr-TR", { maximumFractionDigits: d });
const fmtPct = (n) => (n == null || isNaN(n) ? "—" : (n >= 0 ? "+" : "") + n.toFixed(2) + "%");
const cls = (n) => (n >= 0 ? "pos" : "neg");

const TR_MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const fmtDate = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y) return iso;
  return `${d} ${TR_MONTHS[m - 1]} ${y}`;
};

const GROUPS = {
  stock: { title: "Hisseler (ABD)", types: ["stock"] },
  fund: { title: "Fonlar (TEFAS)", types: ["fund"] },
};

/* ---------------- İpucu (tooltip) sistemi ----------------
 * Kullanım: HTML'de <span class="tip" data-tip="…">?</span> ya da JS
 * şablonlarında tipIcon("…"). Tek bir yüzen kutu tüm sayfaya hizmet
 * eder; masaüstünde hover, mobilde dokunmayla açılır/kapanır. */
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const tipIcon = (text) => `<span class="tip" data-tip="${esc(text)}">?</span>`;
const tipBox = document.createElement("div");
tipBox.id = "tipBox";
tipBox.hidden = true;
document.body.appendChild(tipBox);
let tipFor = null;
function showTip(el) {
  tipBox.textContent = el.dataset.tip || "";
  tipBox.hidden = false;
  tipFor = el;
  tipBox.style.maxWidth = Math.min(320, window.innerWidth - 24) + "px";
  const r = el.getBoundingClientRect();
  const b = tipBox.getBoundingClientRect();
  let x = r.left + r.width / 2 - b.width / 2;
  x = Math.max(12, Math.min(x, window.innerWidth - b.width - 12));
  let y = r.bottom + 8;
  if (y + b.height > window.innerHeight - 8) y = r.top - b.height - 8;
  tipBox.style.left = x + "px";
  tipBox.style.top = y + "px";
}
function hideTip() { tipBox.hidden = true; tipFor = null; }
document.addEventListener("mouseover", (e) => {
  const t = e.target.closest(".tip");
  if (t) showTip(t);
  else if (tipFor) hideTip();
});
document.addEventListener("click", (e) => {
  const t = e.target.closest(".tip");
  if (t) { e.preventDefault(); (tipFor === t && !tipBox.hidden) ? hideTip() : showTip(t); }
  else hideTip();
});
window.addEventListener("scroll", hideTip, { passive: true });

// Varlık dağılımı paleti (kategori → renk)
const ALLOC_COLORS = {
  stock: "#2f8f57",   // hisse — yeşil (marka aksanı)
  fund: "#3fa7b8",    // fon — turkuaz
  gold: "#d9a92b",    // altın — altın sarısı
  option: "#7c6cf0",  // opsiyon — mor
  cash: "#9aa394",    // nakit — adaçayı grisi
};
const ALLOC_LABELS = { stock: "Hisse", fund: "Fon", gold: "Altın", option: "Opsiyon", cash: "Nakit" };

// Donut (halka) SVG'si üretir. segs: [{label, value, color}]
function donutSVG(segs) {
  const total = segs.reduce((s, x) => s + x.value, 0) || 1;
  const R = 15.915494; // çevre = 100 → dasharray doğrudan yüzde
  let acc = 0;
  const arcs = segs.map((s) => {
    const pct = (s.value / total) * 100;
    const gap = pct > 2 ? 0.8 : 0;             // dilimler arası ince boşluk
    const dash = `${Math.max(pct - gap, 0)} ${100 - Math.max(pct - gap, 0)}`;
    const off = 25 - acc;                       // 12 yönünden başla, saat yönü
    acc += pct;
    return `<circle data-alloc-key="${s.key}" cx="21" cy="21" r="${R}" fill="none" stroke="${s.color}" stroke-width="5.5" stroke-dasharray="${dash}" stroke-dashoffset="${off}" />`;
  }).join("");
  return `<svg viewBox="0 0 42 42" class="donut">
    <circle cx="21" cy="21" r="${R}" fill="none" stroke="var(--bg2)" stroke-width="5.5"/>
    <g class="donut-arcs">${arcs}</g>
  </svg>`;
}

// Donut merkezindeki yazı — varsayılan: toplam değer (₺ + $); hover: o dilim
function allocCenterDefault() {
  const c = $("#donutCenter");
  if (!c) return;
  const usd = ALLOC.usdtry ? ALLOC.grandTotalTRY / ALLOC.usdtry : null;
  c.innerHTML = `
    <span class="dc-top">Toplam</span>
    <span class="dc-main">${fmtTRY0(ALLOC.grandTotalTRY)}</span>
    ${usd != null ? `<span class="dc-sub">≈ ${fmtUSD0(usd)}</span>` : ""}`;
}
function allocCenterShow(key) {
  const c = $("#donutCenter");
  const s = ALLOC.segs.find((x) => x.key === key);
  if (!c || !s) return;
  const pct = (s.value / ALLOC.total) * 100;
  c.innerHTML = `
    <span class="dc-pct" style="color:${s.color}">${pct.toFixed(1)}%</span>
    <span class="dc-lbl">${s.label}</span>
    <span class="dc-sub">${fmtTRY0(s.value)}</span>`;
}
// Donut dilimleri + legend satırlarına hover bağla
function bindAlloc() {
  allocCenterDefault();
  document.querySelectorAll("[data-alloc-key]").forEach((el) => {
    el.addEventListener("mouseenter", () => allocCenterShow(el.dataset.allocKey));
    el.addEventListener("mouseleave", allocCenterDefault);
  });
}

let STATE = null;
let RANGE = "1d";
let ALLOC = { segs: [], total: 0, usdtry: 0, grandTotalTRY: 0 }; // varlık dağılımı (donut hover)

async function load() {
  $("#updated").innerHTML = '<span class="spin">↻</span> yükleniyor…';
  PRORISK = null; // her yüklemede taze risk hesabı
  try {
    const r = await fetch("/api/portfolio");
    if (r.status === 401) { window.location.href = "/login"; return; }
    STATE = await r.json();
    render();
    renderReports();
  } catch (e) {
    $("#updated").textContent = "Bağlantı hatası";
  }
}

/* ---------------- Günlük raporlar ---------------- */
async function renderReports() {
  const el = $("#reports");
  if (!el) return;
  let reports = [];
  try { reports = await (await fetch("/api/reports")).json(); } catch {}
  if (!reports.length) {
    el.innerHTML = `<div class="radar-empty">Henüz rapor yok. İlk rapor, fiyatlar eksiksiz geldiğinde bugün için otomatik oluşturulur.</div>`;
    return;
  }
  const sigChip = (s) => s?.signal ? `<span class="chip sig-${s.signal.tone}">${s.signal.emoji} ${s.signal.label}</span>` : "";
  const card = (rep, open) => {
    const buy = rep.stocks.filter((s) => s.signal?.tone === "buy");
    const trim = rep.stocks.filter((s) => s.profitTake);
    const swing = rep.stocks.filter((s) => s.swing);
    const dc = rep.dayChangePct;
    const rows = rep.stocks.map((s) => `<tr>
        <td class="l"><b>${s.symbol}</b></td>
        <td>${s.price != null ? fmtUSD(s.price) : "—"}</td>
        <td class="${s.dayChangePct != null ? cls(s.dayChangePct) : ""}">${s.dayChangePct != null ? fmtPct(s.dayChangePct) : "—"}</td>
        <td>${s.rsi != null ? s.rsi.toFixed(0) : "—"}</td>
        <td class="l">${sigChip(s)}</td>
        <td class="l">${s.profitTake ? `<span class="pt-chip pt-${s.profitTake.level}">✂️ ${s.profitTake.trim}</span>` : ""}</td>
      </tr>`).join("");
    const list = (label, arr, fn) => arr.length ? `<div class="rep-line"><b>${label}:</b> ${arr.map(fn).join(" · ")}</div>` : "";
    return `<details class="rep" ${open ? "open" : ""}>
      <summary>
        <span class="rep-date">${fmtDate(rep.date)}</span>
        <span class="rep-total">₺${(rep.totalTRY || 0).toLocaleString("tr-TR")}</span>
        ${dc != null ? `<span class="chip ${cls(dc)}">${fmtPct(dc)}</span>` : ""}
        ${rep.regime ? `<span class="chip">VIX ${fmtNum(rep.regime.vix, 1)} · ${rep.regime.band}</span>` : ""}
        <span class="rep-mini">🟢${rep.stocks.filter((s) => s.signal?.tone === "buy").length} ✂️${rep.stocks.filter((s) => s.profitTake).length} 📈${rep.stocks.filter((s) => s.swing).length}</span>
      </summary>
      <div class="rep-body">
        ${rep.note ? `<div class="rep-line rep-note">📋 ${rep.note}</div>` : ""}
        ${rep.regime ? `<div class="rep-line rep-regime">📊 ${rep.regime.advice}</div>` : ""}
        ${list("🟢 Alım", buy, (s) => `${s.symbol}${s.upsidePct != null ? ` (+%${s.upsidePct.toFixed(0)})` : ""}`)}
        ${list("✂️ Kâr-al", trim, (s) => `${s.symbol} ${s.profitTake.trim}`)}
        ${list("📈 Swing", swing, (s) => `${s.symbol} ${s.swing.label}${s.swing.grade ? ` (not ${s.swing.grade})` : ""}`)}
        <div class="tbl-wrap"><table>
          <thead><tr><th class="l">Sembol</th><th>Fiyat</th><th>Gün</th><th>RSI</th><th class="l">Sinyal</th><th class="l">Kâr-al</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>
    </details>`;
  };
  el.innerHTML = reports.map((rep, i) => card(rep, i === 0)).join("");
}

function costOf(h) {
  if (h.costTRY != null && h.costTRY !== 0) return h.costTRY;
  if (h.costUSD != null && STATE.fx.usdtry) return h.costUSD * h.quantity * STATE.fx.usdtry;
  return 0;
}

/* Sembol başına realize edilen K/Z (USD) — yalnızca satışlar. Sütun + sıralama
 * bunu kullanır. render() her çiziminde tazeler. */
let REALIZED_USD = {};
function computeRealizedBySym(trades = []) {
  const m = {};
  for (const t of trades) {
    if (t.kind === "buy") continue;
    const sym = String(t.symbol || "").toUpperCase();
    const pl = (Number(t.shares) || 0) * ((Number(t.sellUSD) || 0) - (Number(t.buyUSD) || 0));
    if (sym && isFinite(pl)) m[sym] = (m[sym] || 0) + pl;
  }
  return m;
}

/* Mini sparkline (son ~30 kapanış) → kompakt SVG. Renk: dönem getirisine göre. */
function sparklineSVG(closes) {
  if (!closes || closes.length < 3) return `<span class="spark-na">—</span>`;
  const w = 76, h = 24, pad = 2;
  const min = Math.min(...closes), max = Math.max(...closes), range = max - min || 1;
  const n = closes.length;
  const x = (i) => pad + (i / (n - 1)) * (w - 2 * pad);
  const y = (v) => pad + (1 - (v - min) / range) * (h - 2 * pad);
  const up = closes[n - 1] >= closes[0];
  const stroke = up ? "var(--up)" : "var(--down)";
  const fill = up ? "var(--up-soft)" : "var(--down-soft)";
  const linePts = closes.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const areaPts = `${pad},${h - pad} ${linePts} ${(w - pad)},${h - pad}`;
  const periodPct = closes[0] ? ((closes[n - 1] - closes[0]) / closes[0]) * 100 : 0;
  return `<span class="spark" title="Son ${n} gün: ${periodPct >= 0 ? "+" : ""}${periodPct.toFixed(1)}%">
    <svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none">
      <polygon points="${areaPts}" fill="${fill}"></polygon>
      <polyline points="${linePts}" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"></polyline>
      <circle cx="${x(n - 1).toFixed(1)}" cy="${y(closes[n - 1]).toFixed(1)}" r="1.9" fill="${stroke}"></circle>
    </svg></span>`;
}

/* Portföy kıyas şeridi: gün / hafta / ay değişimi (snapshot'lardan + bugünün açılışı). */
function buildCompare(history, current, dayOpenTotal) {
  const segs = [];
  const now = Date.now();
  const agoTotal = (days) => {
    const target = now - days * 86400_000;
    for (let i = (history || []).length - 1; i >= 0; i--) {
      if (new Date(history[i].date).getTime() <= target) return history[i].total;
    }
    return null;
  };
  const pushSeg = (label, base) => {
    if (base == null || !(base > 0) || current == null) return;
    segs.push({ label, pct: ((current - base) / base) * 100 });
  };
  // Yılbaşından itibaren (YTD): bu yılın ilk kayıt değerini baz al
  const yearStart = () => {
    const jan1 = `${new Date().getFullYear()}-01-01`;
    const h = history || [];
    for (let i = 0; i < h.length; i++) if (h[i].date >= jan1) return h[i].total;
    return null;
  };
  pushSeg("Gün", dayOpenTotal);
  pushSeg("Hafta", agoTotal(7));
  pushSeg("Ay", agoTotal(30));
  pushSeg("Yıl başı", yearStart());
  return segs;
}

/* ============================================================
   Piyasa duygusu: CNN tarzı Aç Gözlülük göstergesi + VIX rejimi
   ============================================================ */

// Aç Gözlülük endeksinin 5 bölgesi (CNN ölçeği, 0–100)
const FNG_ZONES = [
  { from: 0,  to: 25,  color: "#e8473c", label: "Aşırı Korku" },
  { from: 25, to: 45,  color: "#ef8e3a", label: "Korku" },
  { from: 45, to: 55,  color: "#e8c042", label: "Nötr" },
  { from: 55, to: 75,  color: "#86c060", label: "Açgözlülük" },
  { from: 75, to: 100, color: "#22a05a", label: "Aşırı Açgözlülük" },
];
const fngColor = (s) => (FNG_ZONES.find((z) => s >= z.from && s <= z.to) || FNG_ZONES[2]).color;

// Yarım daire gösterge: skor 0 → sol (180°), 100 → sağ (0°)
function fngGaugeSVG(score) {
  const cx = 110, cy = 104, r = 84, w = 17;
  const a = (s) => Math.PI - (s / 100) * Math.PI; // skor → radyan
  const pt = (s, rad) => [cx + rad * Math.cos(a(s)), cy - rad * Math.sin(a(s))];
  const arc = (s1, s2, color) => {
    const [x1, y1] = pt(s1, r), [x2, y2] = pt(s2, r);
    return `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}"
      fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="butt"/>`;
  };
  const s = Math.max(0, Math.min(100, score));
  // İğne (needle): merkezden skora doğru ince üçgen
  const [nx, ny] = pt(s, r - 4);
  const [lx, ly] = pt(s + 8, 9);
  const [rx, ry] = pt(s - 8, 9);
  const col = fngColor(s);
  return `<svg class="fng-gauge" viewBox="0 0 220 132" role="img" aria-label="Aç Gözlülük ${score}/100">
    ${FNG_ZONES.map((z) => arc(z.from + (z.from ? 0.6 : 0), z.to - (z.to < 100 ? 0.6 : 0), z.color)).join("")}
    <polygon points="${lx.toFixed(1)},${ly.toFixed(1)} ${rx.toFixed(1)},${ry.toFixed(1)} ${nx.toFixed(1)},${ny.toFixed(1)}" fill="#1b2520"/>
    <circle cx="${cx}" cy="${cy}" r="11" fill="#1b2520"/>
    <circle cx="${cx}" cy="${cy}" r="4.5" fill="#fff"/>
    <text x="${cx}" y="${cy - 26}" text-anchor="middle" class="fng-gauge-num" fill="${col}">${score}</text>
  </svg>`;
}

function renderSentiment(data) {
  const host = $("#sentimentRow");
  if (!host) return;
  const rg = data.regime;
  const fg = data.fearGreed;
  const SCALE = 40; // nakit barı ölçeği (%)

  // ---- Aç Gözlülük göstergesi (CNN tarzı yarım daire) ----
  const fngHist = (label, v) => v == null ? "" :
    `<span class="fng-h"><i>${label}</i><b style="color:${fngColor(v)}">${v}</b></span>`;
  const fngCard = fg ? `
    <div class="card fng fng-${fg.tone || "calm"}">
      <div class="sent-head">
        <span class="label">Aç Gözlülük Endeksi</span>
        <span class="sent-src">CNN</span>
      </div>
      <div class="fng-gauge-wrap">
        ${fngGaugeSVG(fg.score)}
        <div class="fng-rating" style="color:${fngColor(fg.score)}">${fg.band || fg.rating || ""}</div>
      </div>
      <div class="fng-history">
        ${fngHist("Önceki", fg.prevClose)}
        ${fngHist("1 hafta", fg.week)}
        ${fngHist("1 ay", fg.month)}
        ${fngHist("1 yıl", fg.year)}
      </div>
    </div>` : "";

  // ---- VIX piyasa rejimi ----
  const hasCash = rg && rg.currentCashPct != null;
  const regimeCard = rg ? `
    <div class="card regime regime-${rg.tone}">
      <div class="sent-head">
        <span class="label">Piyasa Rejimi · VIX${rg.stale ? ' <i class="stale-tag" title="Canlı VIX kaynağı geçici yanıt vermedi; son bilinen değer">bayat</i>' : ""}</span>
        <span class="regime-band">${rg.band}</span>
      </div>
      <div class="regime-val">${fmtNum(rg.vix, 2)}${rg.vixChangePct != null ? ` <span class="chip ${cls(rg.vixChangePct)}">${fmtPct(rg.vixChangePct)}</span>` : ""}</div>
      <div class="regime-note">${rg.note}</div>
      ${hasCash ? `
      <div class="regime-bar" title="Nakit oranı (0–${SCALE}%)">
        <div class="rb-target" style="left:${(rg.targetCash[0] / SCALE) * 100}%;width:${((rg.targetCash[1] - rg.targetCash[0]) / SCALE) * 100}%"></div>
        <div class="rb-marker" style="left:${(Math.min(rg.currentCashPct, SCALE) / SCALE) * 100}%"></div>
      </div>
      <div class="regime-legend">
        <span>Hedef nakit <b>%${rg.targetCash[0]}–${rg.targetCash[1]}</b></span>
        <span>Senin nakit <b>%${rg.currentCashPct.toFixed(0)}</b> · portföy %${rg.currentInvestedPct.toFixed(0)}</span>
      </div>
      <div class="regime-advice ${rg.status}">${rg.advice}</div>` : `
      <div class="regime-legend"><span>Hedef nakit <b>%${rg.targetCash[0]}–${rg.targetCash[1]}</b></span></div>`}
    </div>` : "";

  host.innerHTML = (fngCard || regimeCard) ? `<div class="cards-mid">${fngCard}${regimeCard}</div>` : "";
}

// Duygu kartlarını ağır portföy çağrısını beklemeden hemen yükle
async function loadSentiment() {
  try {
    const d = await (await fetch("/api/sentiment")).json();
    renderSentiment(d);
  } catch {}
}

function render() {
  const { holdings, fx, cash, trades = [] } = STATE;

  // ---- Toplamlar ----
  let totalMarket = 0, totalCost = 0;
  holdings.forEach((h) => {
    const mv = h.live?.marketValueTRY;
    if (mv) totalMarket += mv;
    totalCost += costOf(h);
  });
  // Swing pozisyonları (Swing Defteri) — ayrı alımlar ama HEPSİ BİR PORTFÖY → toplama dahil
  let swingMarketTRY = 0, swingCostTRY = 0;
  (STATE.swingPositions || []).forEach((p) => {
    if (fx.usdtry && p.valueUSD != null) {
      swingMarketTRY += p.valueUSD * fx.usdtry;
      swingCostTRY += (p.costUSD || 0) * fx.usdtry;
    }
  });
  totalMarket += swingMarketTRY;
  totalCost += swingCostTRY;
  // Opsiyonlar toplama dahil (long +, short -; yalnızca güncel primi girilenler değerlenir)
  let optMarket = 0;
  (STATE.options || []).forEach((o) => {
    if (o.valueTRY == null) return;
    const sign = o.direction === "short" ? -1 : 1;
    totalMarket += sign * o.valueTRY;
    totalCost += sign * (o.costTRY || 0);
    optMarket += sign * o.valueTRY;
  });
  const cashTL = (cash.tl || 0) + (cash.usd || 0) * (fx.usdtry || 0) + (cash.eur || 0) * (fx.eurtry || 0);
  const grandTotal = totalMarket + cashTL;
  const profit = totalMarket - totalCost;
  const profitPct = totalCost ? (profit / totalCost) * 100 : 0;

  // ---- Realize edilen kâr (USD) — ana satışlar + SWING setup realize'leri (ayrı tutulmaz).
  // Server birleşik (çift-saymasız) realizedBySym verir; yoksa ana satışlardan hesapla. ----
  REALIZED_USD = STATE.realizedBySym || computeRealizedBySym(trades); // sembol başına (sütun + sıralama + Büyüme)
  const realizedUSD = Object.values(REALIZED_USD).reduce((s, v) => s + (v || 0), 0);
  const realizedTRY = realizedUSD * (fx.usdtry || 0);

  // ---- Net yatırılan sermaye (gerçek getiri için) ----
  const netInvested = (STATE.flows || []).reduce(
    (s, f) => s + (f.type === "withdraw" ? -1 : 1) * (Number(f.amountTRY) || 0), 0
  );
  const realProfit = grandTotal - netInvested;
  const realPct = netInvested > 0 ? (realProfit / netInvested) * 100 : null;

  // ---- Veri sağlığı: kaynak rate-limit olduğunda kırık değer göstermeyelim ----
  const healthy = fx.usdtry && fx.gram && holdings.every((h) => h.live?.marketValueTRY != null);
  const lastSnap = (STATE.history || []).slice(-1)[0];
  const heroTotal = healthy ? grandTotal : (lastSnap ? lastSnap.total : grandTotal);

  // ---- Varlık dağılımı (donut) ----
  const sumType = (t) => holdings.filter((h) => h.type === t).reduce((s, h) => s + (h.live?.marketValueTRY || 0), 0);
  const allocRaw = {
    stock: sumType("stock") + swingMarketTRY, // swing pozisyonları da hisse dağılımına dahil
    fund: sumType("fund"),
    gold: sumType("gold"),
    option: Math.max(0, optMarket),
    cash: cashTL,
  };
  const segs = Object.entries(allocRaw)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ key: k, label: ALLOC_LABELS[k], value: v, color: ALLOC_COLORS[k] }))
    .sort((a, b) => b.value - a.value);
  const allocTotal = segs.reduce((s, x) => s + x.value, 0) || 1;
  // Hover etkileşimi için dağılım verisini sakla (merkez yazısı bunu kullanır)
  ALLOC = { segs, total: allocTotal, usdtry: fx.usdtry || 0, grandTotalTRY: grandTotal };
  const allocCard = healthy && segs.length
    ? `<div class="card alloc">
        <div class="alloc-head"><div class="label">Varlık Dağılımı ${tipIcon("İpucu: Tek dilim büyüdükçe tek olaya bağımlılığın artar. Nakit dilimi sigortandır — VIX rejim hedefiyle karşılaştır (Fırsat Radarı).")}</div></div>
        <div class="alloc-body">
          <div class="donut-wrap">
            ${donutSVG(segs)}
            <div class="donut-center" id="donutCenter"></div>
          </div>
          <div class="alloc-legend">
            ${segs.map((s) => `
              <div class="lg-item" data-alloc-key="${s.key}">
                <span class="lg-dot" style="background:${s.color}"></span>
                <span class="lg-name">${s.label}</span>
                <span class="lg-pct">${((s.value / allocTotal) * 100).toFixed(1)}%</span>
                <span class="lg-val">${fmtTRY0(s.value)}</span>
                <span class="lg-usd">${fx.usdtry ? fmtUSD0(s.value / fx.usdtry) : ""}</span>
              </div>`).join("")}
          </div>
        </div>
      </div>`
    : `<div class="card alloc"><div class="label">Varlık Dağılımı</div><div class="alloc-empty">↻ Veriler yenileniyor…</div></div>`;

  // ---- Piyasa duygusu (Aç Gözlülük + VIX) — tam veriyle yeniden çiz ----
  renderSentiment({ regime: STATE.regime, fearGreed: STATE.fearGreed });

  // ---- Üst kartlar (hero + dağılım) ----
  // Sunucudan gelen günlük özet + veri sağlığı: sayıların nereden geldiği ve
  // ne kadar güvenilir olduğu tek bakışta görünsün.
  const meta = STATE.meta || null;
  const healthIssues = meta
    ? [
        meta.missingPrices?.length ? `⚠️ Fiyat alınamadı: ${meta.missingPrices.join(", ")} — toplamlar bu kalemler olmadan/eski değerle.` : "",
        meta.stalePrices?.length ? `🕒 Son bilinen fiyat: ${meta.stalePrices.join(", ")} — canlı çekilemedi, yenisi gelince güncellenecek.` : "",
        meta.metalsStale ? `🕒 Döviz/altın son bilinen değerle gösteriliyor (kaynak geçici erişilemedi).` : "",
        meta.staleSignals?.length ? `⏳ Teknik veri bayat: ${meta.staleSignals.join(", ")} (yeni tarama bekleniyor).` : "",
        meta.noSignalYet?.length ? `↻ İlk tarama bekleyen: ${meta.noSignalYet.join(", ")}.` : "",
      ].filter(Boolean)
    : [];
  $("#cardsTop").innerHTML = `
      <div class="card hero">
        <button class="privacy-toggle" id="privacyToggle" type="button" title="Tutarları gizle/göster (gizlilik modu)" aria-label="Gizlilik modu">${document.body.classList.contains("privacy") ? "🙈" : "👁"}</button>
        <div class="label">Toplam Portföy ${tipIcon("İpucu: Tüm portföy USD'ye endekslidir — getiriler kur etkisinden arındırılmış gerçek performansı gösterir. ₺ karşılığı yalnızca burada, USD'nin altında referans olarak yazılır.")}</div>
        <div class="value">${fx.usdtry ? fmtUSD(heroTotal / fx.usdtry) : fmtTRY(heroTotal)}</div>
        ${fx.usdtry ? `<div class="hero-usd">≈ ${fmtTRY(heroTotal)} · ₺ karşılığı</div>` : ""}
        ${(() => {
          const segs = buildCompare(STATE.history, grandTotal, STATE.dayOpen?.total);
          return segs.length ? `<div class="hero-compare">${segs.map((s) =>
            `<div class="hc-seg ${s.pct >= 0 ? "up" : "down"}"><span class="hc-k">${s.label}</span><span class="hc-v">${s.pct >= 0 ? "▲" : "▼"} ${fmtPct(Math.abs(s.pct))}</span></div>`
          ).join("")}</div>` : "";
        })()}
        <div class="meta">${healthy ? (fx.usdtry ? `Varlık ${fmtUSD0(totalMarket / fx.usdtry)} + Nakit ${fmtUSD0(cashTL / fx.usdtry)}${optMarket ? ` · içinde Opsiyon ${fmtUSD0(optMarket / fx.usdtry)}` : ""}` : `Varlık ${fmtTRY0(totalMarket)} + Nakit ${fmtTRY0(cashTL)}`) : "↻ Veriler yenileniyor · son bilinen değer"}</div>
        ${meta?.summaryText ? `<div class="hero-note">📋 ${meta.summaryText}</div>` : ""}
        ${healthIssues.length ? `<div class="hero-health">${healthIssues.join("<br>")}</div>` : ""}
      </div>
      ${allocCard}`;

  // ---- Günün en çok yükselen / düşen pozisyonu ----
  const movers = holdings.filter((h) => h.live?.dayChangePct != null && isFinite(h.live.dayChangePct));
  let moverCard = "";
  if (movers.length) {
    const best = movers.reduce((a, b) => (b.live.dayChangePct > a.live.dayChangePct ? b : a));
    const worst = movers.reduce((a, b) => (b.live.dayChangePct < a.live.dayChangePct ? b : a));
    const moverRow = (h, dir) => `<div class="mv-row mv-${dir}">
        <span class="mv-dir">${dir === "up" ? "▲" : "▼"}</span>
        <span class="mv-sym">${h.symbol}</span>
        <span class="mv-pct">${fmtPct(h.live.dayChangePct)}</span>
      </div>`;
    moverCard = `<div class="card mover-card">
        <div class="label">Günün Hareketi ${tipIcon("Bugün açılışa göre portföyündeki en çok yükselen ve düşen pozisyon. Tek günlük oynama trend değildir; ama büyük düşüşü olan pozisyonun stop planını kontrol et.")}</div>
        <div class="mv-body">${best ? moverRow(best, "up") : ""}${worst && worst !== best ? moverRow(worst, "down") : ""}</div>
      </div>`;
  }

  // ---- Metrik kartları ----
  $("#cardsMetrics").innerHTML = `${moverCard}`+ `
      <div class="card">
        <div class="label">Toplam Getiri ${tipIcon("İpucu: Açık pozisyonların kâğıt üzerindeki kâr/zararı, USD bazında. Maliyetler işlemlerle otomatik senkrondur. Kâğıt kârı gerçek kâr değildir — realize edene kadar piyasanındır.")}</div>
        <div class="value ${healthy ? cls(profit) : ""}">${healthy ? (fx.usdtry ? fmtUSD(profit / fx.usdtry) : fmtTRY(profit)) : "—"}</div>
        <div class="meta ${healthy ? cls(profit) : ""}">${healthy ? `${fmtPct(profitPct)} · Maliyet ${fx.usdtry ? fmtUSD0(totalCost / fx.usdtry) : fmtTRY0(totalCost)}` : `Maliyet ${fx.usdtry ? fmtUSD0(totalCost / fx.usdtry) : fmtTRY0(totalCost)}`}</div>
      </div>
      <div class="card">
        <div class="label">Realize Edilen K/Z ${tipIcon("İpucu: Cebe giren/çıkan gerçek sonuç — yalnızca satışlardan, USD bazında hesaplanır. Kural 1'in karnesi budur: bu sayı negatifleşiyorsa sistemde değil disiplinde sorun var demektir.")}</div>
        <div class="value ${cls(realizedUSD)}">${fmtUSD(realizedUSD)}</div>
        <div class="meta">${trades.filter((t) => t.kind !== "buy").length} satış</div>
      </div>
      ${netInvested > 0 ? `
      <div class="card">
        <div class="label">Gerçek Getiri ${tipIcon("İpucu: Bugünkü toplam değer − net yatırdığın para, USD bazında. Piyasa kazancını cebinden eklediğin paradan ayırır; portföyün gerçekten büyüyor mu sorusunun tek dürüst cevabı.")}</div>
        <div class="value ${healthy ? cls(realProfit) : ""}">${healthy ? (fx.usdtry ? fmtUSD(realProfit / fx.usdtry) : fmtTRY(realProfit)) : "—"}</div>
        <div class="meta ${healthy ? cls(realProfit) : ""}">${realPct != null ? fmtPct(realPct) : "—"} · Sermaye ${fx.usdtry ? fmtUSD0(netInvested / fx.usdtry) : fmtTRY0(netInvested)}</div>
      </div>` : ""}
      <div class="card">
        <div class="label">USD / TRY</div>
        <div class="value">${fmtNum(fx.usdtry, 4)}</div>
        <div class="meta">EUR/TRY ${fmtNum(fx.eurtry, 4)}</div>
      </div>
      <div class="card">
        <div class="label">Gram Altın</div>
        <div class="value">${fmtTRY(fx.gram)}</div>
        <div class="meta">${holdings.filter((h) => h.type === "gold").reduce((s, h) => s + h.quantity, 0)} gram tutuluyor</div>
      </div>`;

  // ---- Varlık dağılımı hover etkileşimi ----
  bindAlloc();

  // ---- Portföy Önerileri + En Büyük 3 Pozisyon panelleri ----
  renderRule1();
  renderTopPicks();

  // ---- Günlük Pano: Bugün brifingi + Kur/Hisse ayrıştırması + Bilanço takvimi ----
  renderDailyBoard();
  renderEarningsWatch();
  renderAlerts();
  renderHuntStrip();
  // Home "Swing Nöbeti" şeridi için swing verisini bir kez yükle (yüklenince board yeniden çizilir)
  if (!SWINGDECK._loaded) loadSwingDeck();

  // ---- Büyüme sekmesi açıksa STATE tazelendikçe yeniden çiz (free-roll canlı kalsın) ----
  if ($("#view-buyume")?.classList.contains("active")) renderGrowth();
  // ---- Analiz açıksa STATE türevli panelleri tazele (ilk yüklemede hash #analiz olsa bile dolsun; fetch'li paneller view geçişinde yüklenir) ----
  if ($("#view-analiz")?.classList.contains("active")) {
    renderAnalizSummary(); renderProRisk(); renderRealizeSummary(); renderRisk(); renderPosTech(); renderHeatmap(); renderSector(); renderAiDesk();
  }

  // ---- Grafik ----
  drawChart();

  // ---- Nakit ----
  $("#cashGrid").innerHTML = `
    <div class="cash-item"><div class="k">Nakit TL</div><div class="v">${fmtTRY(cash.tl)}</div></div>
    <div class="cash-item"><div class="k">Dolar</div><div class="v">${fmtUSD(cash.usd)}</div>
      <div class="k">≈ ${fmtTRY((cash.usd || 0) * (fx.usdtry || 0))}</div></div>
    <div class="cash-item"><div class="k">Euro</div><div class="v">€${fmtNum(cash.eur, 2)}</div>
      <div class="k">≈ ${fmtTRY((cash.eur || 0) * (fx.eurtry || 0))}</div></div>
    <div class="cash-item"><div class="k">Nakit Toplam</div><div class="v">${fx.usdtry ? fmtUSD(cashTL / fx.usdtry) : fmtTRY(cashTL)}</div>
      ${fx.usdtry ? `<div class="k">≈ ${fmtTRY(cashTL)}</div>` : ""}</div>`;

  // ---- Tablolar ----
  let html = "";
  // Hisseler (ABD) — portföy holding'leri (normal tablo)
  const stockRows = holdings.filter((h) => h.type === "stock");
  if (stockRows.length) html += renderGroup("📈 ABD Hisseleri", stockRows, "stock", "long");
  // Swing pozisyonları (Swing Defteri) — ayrı tablo, holding'lerden bağımsız
  html += renderSwingGroup(STATE.swingPositions || []);
  // Opsiyonlar — ABD hisselerinin hemen altında
  html += renderOptionsGroup(STATE.options || []);
  // Fonlar (TEFAS)
  const fundRows = holdings.filter((h) => h.type === "fund");
  if (fundRows.length) html += renderGroup(GROUPS.fund.title, fundRows, "fund");
  // Altın
  const goldRows = holdings.filter((h) => h.type === "gold");
  if (goldRows.length) html += renderGoldGroup(goldRows);
  $("#tables").innerHTML = html;

  // ---- Fırsat radarı (sinyaller + kâr-al) ----
  renderRadar();

  // ---- Swing tarayıcı + izleme listesi ----
  renderSwing();

  // ---- İşlem geçmişi (tüm semboller) ----
  renderAllTrades();

  // ---- 2026 realize kazançları (broker) ----
  renderRealized2026();

  // ---- Sermaye: para giriş/çıkış ----
  renderFlows();

  document.querySelectorAll("th.sortable").forEach((th) =>
    th.addEventListener("click", () => {
      const g = th.dataset.group, k = th.dataset.sort;
      const cur = sortState[g];
      if (cur && cur.key === k) {
        cur.dir = cur.dir === "desc" ? "asc" : "desc"; // 2. tık: küçükten büyüğe
      } else {
        sortState[g] = { key: k, dir: "desc" }; // 1. tık: büyükten küçüğe
      }
      render();
    })
  );

  document.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => delHolding(b.dataset.del))
  );
  document.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => openEdit(b.dataset.edit))
  );
  document.querySelectorAll("[data-trade]").forEach((b) =>
    b.addEventListener("click", () => openTrades(b.dataset.trade))
  );
  document.querySelectorAll("[data-pos]").forEach((b) =>
    b.addEventListener("click", () => openPositionDetail(b.dataset.pos))
  );
  document.querySelectorAll("[data-swpos]").forEach((b) =>
    b.addEventListener("click", () => openChartModal(b.dataset.swpos, { horizon: "swing" }))
  );
  document.querySelectorAll("[data-swedit]").forEach((b) =>
    b.addEventListener("click", () => { showView("swingdefteri"); openSwingModal(b.dataset.swedit); })
  );
  document.querySelectorAll("[data-swdeck]").forEach((b) =>
    b.addEventListener("click", () => showView("swingdefteri"))
  );
  document.querySelectorAll("[data-opt-edit]").forEach((b) =>
    b.addEventListener("click", () => openEditOption(b.dataset.optEdit))
  );
  document.querySelectorAll("[data-opt-del]").forEach((b) =>
    b.addEventListener("click", () => delOption(b.dataset.optDel))
  );
  document.querySelectorAll("[data-view-swing]").forEach((b) =>
    b.addEventListener("click", (e) => { e.stopPropagation(); showView("swingdefteri"); })
  );
  document.querySelectorAll("[data-view-growth]").forEach((b) =>
    b.addEventListener("click", (e) => { e.stopPropagation(); showView("buyume"); })
  );

  $("#updated").textContent = "Son güncelleme: " + new Date(STATE.updatedAt).toLocaleTimeString("tr-TR");

  // Yapışkan mini özet verisi (kaydırınca üstte görünür)
  try {
    const _segs = buildCompare(STATE.history, grandTotal, STATE.dayOpen?.total);
    const _day = _segs.find((s) => s.label === "Gün");
    updateMiniTop(grandTotal, fx.usdtry, _day ? _day.pct : null);
  } catch {}

  // Gizlilik modu açıksa yeni çizilen tutarları maskele (••••)
  if (document.body.classList.contains("privacy")) applyMask(true);
}

/* Yapışkan üst mini-özet — kaydırınca portföy değeri + günlük değişim hep görünür */
function updateMiniTop(grandTRY, usdtry, dayPct) {
  const bar = $("#miniTop"); if (!bar) return;
  const usd = usdtry ? grandTRY / usdtry : null;
  bar.querySelector(".mt-val").textContent = fmtTRY0(grandTRY);
  bar.querySelector(".mt-sub").textContent = usd != null ? "≈ " + fmtUSD0(usd) : "";
  const d = bar.querySelector(".mt-day");
  if (dayPct != null && isFinite(dayPct)) { d.textContent = (dayPct >= 0 ? "▲ " : "▼ ") + "%" + Math.abs(dayPct).toFixed(2); d.className = "mt-day " + cls(dayPct); }
  else { d.textContent = ""; d.className = "mt-day"; }
  if (document.body.classList.contains("privacy")) applyMask(true);
}
(function bindMiniTop() {
  let shown = false;
  const onScroll = () => {
    const y = (document.scrollingElement ? document.scrollingElement.scrollTop : 0) || window.scrollY || 0;
    const on = y > 300;
    if (on === shown) return;
    shown = on;
    const b = $("#miniTop"); if (!b) return;
    if (on) b.hidden = false;
    b.classList.toggle("show", on);
    document.body.classList.toggle("mini-on", on);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("click", (e) => {
    if (e.target.closest(".mt-up")) (document.scrollingElement || document.documentElement).scrollTo({ top: 0, behavior: "smooth" });
  });
})();

/* ---------------- Grafik (SVG) ---------------- */
const RANGE_DAYS = { "1d": 1, "1w": 7, "1m": 30, "3m": 90, "6m": 180, "1y": 365, all: Infinity };

// Görünür aralık için veri noktalarını hazırlar: [{label, total, totalTRY}]
// total = USD (portföy dolara endeksli). Geçmiş noktalar o günün kuruyla, gün
// içi noktalar güncel kurla çevrilir. totalTRY ipucu için saklanır.
function buildSeries() {
  const liveRate = STATE.fx?.usdtry || null;
  const toUsd = (tl, rate) => { const r = rate || liveRate; return r ? tl / r : tl; };
  if (RANGE === "1d") {
    const today = new Date().toISOString().slice(0, 10);
    const intr = (STATE.intraday || []).filter((p) => p.t.slice(0, 10) === today);
    const series = [];
    if (STATE.dayOpen && STATE.dayOpen.date === today && STATE.dayOpen.total != null) {
      series.push({ label: "Açılış", total: toUsd(STATE.dayOpen.total, STATE.dayOpen.usdtry), totalTRY: STATE.dayOpen.total });
    }
    for (const p of intr) {
      series.push({
        label: new Date(p.t).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
        total: toUsd(p.total, p.usdtry), totalTRY: p.total,
      });
    }
    return { pts: series, intraday: true };
  }
  const history = (STATE.history || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const days = RANGE_DAYS[RANGE];
  let f = history;
  if (days !== Infinity) {                         // "Tümü"de filtre yok (Infinity cutoff'u bozar)
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
    const cutISO = cutoff.toISOString().slice(0, 10);
    f = history.filter((s) => s.date >= cutISO);
  }
  return { pts: f.map((s) => ({ label: fmtDate(s.date), total: toUsd(s.total, s.usdtry), totalTRY: s.total })), intraday: false };
}

// Eksende eşit aralıklı (ilk ve son dahil) en fazla `max` etiket seçer
function pickTicks(pts, max) {
  const n = pts.length;
  if (n <= max) return pts.map((p) => p.label);
  const step = (n - 1) / (max - 1);
  const out = [];
  for (let k = 0; k < max; k++) out.push(pts[Math.round(k * step)].label);
  return out;
}

// Catmull-Rom → kübik bezier: noktaları yumuşak, doğal bir eğriye çevirir
function smoothPath(P) {
  if (!P.length) return "";
  if (P.length < 3) return "M " + P.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L ");
  let d = `M ${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || P[i + 1];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

/* ===== Çizgi ikon yardımcısı (Lucide tabanlı — emoji yerine temiz, hareketsiz ikonlar) ===== */
const ICONS = {
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="m22 12.18-9.17 4.16a2 2 0 0 1-1.66 0L2 12.18"/><path d="m22 17.18-9.17 4.16a2 2 0 0 1-1.66 0L2 17.18"/>',
  barChart: '<line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  gradCap: '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  microscope: '<path d="M6 18h8"/><path d="M3 22h18"/><path d="M14 22a7 7 0 1 0 0-14h-1"/><path d="M9 14h2"/><path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z"/><path d="M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3"/>',
  map: '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
  factory: '<path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><path d="M17 18h1"/><path d="M12 18h1"/><path d="M7 18h1"/>',
  dollar: '<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
  clipboardCheck: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  sprout: '<path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/>',
  lineChart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
  trendUp: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  briefcase: '<rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  trendDown: '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
  alertTriangle: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
};
function svgIcon(name, cls) {
  const p = ICONS[name]; if (!p) return "";
  return `<svg class="${cls || ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

/* Başlık emojilerini otomatik çizgi-ikona çevir — tüm sekmelerde tutarlı, hareketsiz.
 * Idempotent: başında zaten ikon (öğe düğümü) olan başlığı atlar; sadece baştaki emojiyi değiştirir. */
const HEADER_ICONS = {
  "💹": "lineChart", "💎": "sprout", "🎯": "target", "🏆": "trophy", "🔬": "microscope",
  "🎓": "gradCap", "📐": "barChart", "📊": "barChart", "📡": "activity", "🗺": "map",
  "🏭": "factory", "🗓": "calendar", "💵": "dollar", "🧾": "receipt", "📒": "clipboardCheck",
  "🛡": "shield", "⚖": "scale", "🧬": "layers", "⚡": "zap", "🔔": "bell",
  "💡": "lightbulb", "🔎": "search", "📅": "calendar", "📈": "trendUp", "💼": "briefcase",
  "📉": "trendDown", "⚠": "alertTriangle",
};
function iconizeHeaders(root) {
  (root || document).querySelectorAll("h1.view-title, .view-title, h2, h3, h4, .pr-h2").forEach((h) => {
    const first = h.firstChild;
    if (!first || first.nodeType !== 3) return;                 // ilk düğüm metin değil → zaten ikonlu
    const m = first.nodeValue.match(/^\s*(\p{Extended_Pictographic})️?\s*/u);
    if (!m) return;
    const name = HEADER_ICONS[m[1]];
    if (!name) return;                                          // eşlenmemiş emoji → dokunma
    first.nodeValue = first.nodeValue.slice(m[0].length);
    h.insertAdjacentHTML("afterbegin", svgIcon(name, "h2-ic"));
  });
}
(() => {
  if (typeof MutationObserver === "undefined" || !document.body) return;
  let t = null;
  const obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => iconizeHeaders(), 60); });
  obs.observe(document.body, { childList: true, subtree: true });
  iconizeHeaders();
})();

function drawChart() {
  const box = $("#chartBox");
  const { pts, intraday } = buildSeries();

  if (pts.length === 0) {
    $("#chartSub").textContent = intraday ? "Gün içi veri birikiyor…" : "Henüz veri yok";
    box.innerHTML = `<div class="chart-empty">${
      intraday
        ? "Bugünün seyri uygulama açık kaldıkça (her ~1 dk) dolar 📈"
        : "Bugün milat 📈 · Portföy değeri verileri bugünden itibaren birikmeye başlayacak."
    }</div>`;
    return;
  }

  const first = pts[0].total;
  const last = pts[pts.length - 1].total;
  const change = last - first;
  const changePct = first ? (change / first) * 100 : 0;
  const baseLabel = intraday ? "bugün açılışa göre" : pts.length > 1 ? "dönem başına göre" : "";
  $("#chartSub").innerHTML =
    `${fmtUSD(last)} <span class="chart-chg ${cls(change)}">${change >= 0 ? "▲" : "▼"} ${fmtUSD(Math.abs(change))} (${fmtPct(changePct)})</span>` +
    (baseLabel ? ` <span class="chart-base">· ${baseLabel}</span>` : "");

  if (pts.length === 1) {
    box.innerHTML = `<div class="chart-empty single">
      <div class="single-val">${fmtUSD(last)}</div>
      <div class="single-note">${pts[0].label} · ${intraday ? "Gün içi ilk nokta alındı, seyir dakikalar içinde şekillenecek." : "İlk kayıt alındı. Grafik birkaç günde şekillenecek."}</div>
    </div>`;
    return;
  }

  // ölçek
  const W = 1000, H = 240, pad = { t: 16, r: 12, b: 24, l: 12 };
  const vals = pts.map((p) => p.total);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const px = (i) => pad.l + (i / (pts.length - 1)) * (W - pad.l - pad.r);
  const py = (v) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);

  const up = change >= 0;
  const color = up ? "#1f8a4e" : "#d24437";
  const lastX = px(pts.length - 1), lastY = py(last);
  const lineD = smoothPath(pts.map((p, i) => [px(i), py(p.total)]));
  const areaD = `${lineD} L ${(W - pad.r).toFixed(1)} ${(H - pad.b).toFixed(1)} L ${pad.l.toFixed(1)} ${(H - pad.b).toFixed(1)} Z`;

  // Yatay referans ızgarası (4 seviye) + açılış/dönem başı kesikli çizgisi
  const gridVals = [max, min + (max - min) * 2 / 3, min + (max - min) / 3, min];
  const grid = gridVals.map((v) =>
    `<line x1="${pad.l}" y1="${py(v).toFixed(1)}" x2="${(W - pad.r).toFixed(1)}" y2="${py(v).toFixed(1)}" class="cg-grid" vector-effect="non-scaling-stroke"/>`
  ).join("");
  const baseInRange = first >= min && first <= max;
  const baseLine = baseInRange
    ? `<line x1="${pad.l}" y1="${py(first).toFixed(1)}" x2="${(W - pad.r).toFixed(1)}" y2="${py(first).toFixed(1)}" class="cg-base" vector-effect="non-scaling-stroke"/>`
    : "";

  // Dönem zirvesi / dibi işaretçileri (detaylı görünüm)
  let hiI = 0, loI = 0;
  pts.forEach((p, i) => { if (p.total > pts[hiI].total) hiI = i; if (p.total < pts[loI].total) loI = i; });
  const peak = (i, cls2) => `<div class="chart-peak ${cls2}" style="left:${((px(i) / W) * 100).toFixed(2)}%; top:${((py(pts[i].total) / H) * 100).toFixed(2)}%"><span>${cls2 === "hi" ? "▲ zirve" : "▼ dip"} ${fmtUSD0(pts[i].total)}</span></div>`;
  const peaks = (!intraday && pts.length >= 4 && hiI !== loI) ? peak(hiI, "hi") + peak(loI, "lo") : "";

  box.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="chart-svg">
      <defs>
        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.26"/>
          <stop offset="55%" stop-color="${color}" stop-opacity="0.08"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
        <filter id="cglow" x="-3%" y="-12%" width="106%" height="124%">
          <feGaussianBlur stdDeviation="2.4" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      ${grid}${baseLine}
      <path d="${areaD}" fill="url(#cg)"/>
      <path d="${lineD}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" filter="url(#cglow)"/>
    </svg>
    <div class="chart-ylabels">${
      gridVals.map((v) => `<span style="top:${((py(v) / H) * 100).toFixed(1)}%">${fmtUSD0(v)}</span>`).join("")
    }</div>
    ${peaks}
    <div class="chart-enddot" style="left:${((lastX / W) * 100).toFixed(2)}%; top:${((lastY / H) * 100).toFixed(2)}%; --c:${color}"></div>
    <div class="chart-cursor"></div>
    <div class="chart-hot" style="background:${color}"></div>
    <div class="chart-tip"></div>
    <div class="chart-axis">${
      (intraday ? pickTicks(pts, 6) : [pts[0].label, pts[pts.length - 1].label])
        .map((l) => `<span>${l}</span>`).join("")
    }</div>`;

  attachHover(box, pts, { px, py, W, H, first, color });
  if (document.body.classList.contains("privacy")) applyMask(true);
}

// İmleçle gezinme: dikey çizgi + nokta + balon (değer ve başlangıca göre kazanç)
function attachHover(box, pts, { px, py, W, H, first, color }) {
  const cursor = box.querySelector(".chart-cursor");
  const hot = box.querySelector(".chart-hot");
  const tip = box.querySelector(".chart-tip");
  const n = pts.length;

  const show = (on) => {
    [cursor, hot, tip].forEach((el) => (el.style.opacity = on ? "1" : "0"));
  };

  const move = (clientX) => {
    const rect = box.getBoundingClientRect();
    let frac = (clientX - rect.left) / rect.width;
    frac = Math.max(0, Math.min(1, frac));
    const i = Math.round(frac * (n - 1));
    const p = pts[i];
    const xPct = (px(i) / W) * 100;
    const yPct = (py(p.total) / H) * 100;
    const diff = p.total - first;
    const diffPct = first ? (diff / first) * 100 : 0;

    cursor.style.left = xPct + "%";
    hot.style.left = xPct + "%";
    hot.style.top = yPct + "%";
    tip.style.left = `clamp(46px, ${xPct}%, calc(100% - 46px))`;
    tip.style.top = `clamp(6px, ${yPct}%, 78%)`;
    tip.innerHTML = `
      <div class="tip-d">${p.label}</div>
      <div class="tip-v">${fmtUSD(p.total)}</div>
      <div class="tip-c ${cls(diff)}">${diff >= 0 ? "▲" : "▼"} ${fmtUSD(Math.abs(diff))} (${fmtPct(diffPct)})</div>
      ${p.totalTRY != null ? `<div class="tip-tl">≈ ${fmtTRY0(p.totalTRY)}</div>` : ""}`;
    if (document.body.classList.contains("privacy"))
      tip.querySelectorAll(".tip-v, .tip-c, .tip-tl").forEach((e) => { e.textContent = e.textContent.replace(/[0-9]/g, "•"); });
    show(true);
  };

  box.onpointermove = (e) => move(e.clientX);
  box.onpointerleave = () => show(false);
  box.ontouchmove = (e) => { if (e.touches[0]) move(e.touches[0].clientX); };
}

$("#rangeTabs").addEventListener("click", (e) => {
  const b = e.target.closest(".rt");
  if (!b) return;
  RANGE = b.dataset.range;
  document.querySelectorAll(".rt").forEach((x) => x.classList.toggle("active", x === b));
  if (STATE) drawChart();
});

/* ---------------- Fırsat Radarı: özet + kısa vade + risk + 52h + sinyaller -- */
function renderRadar() {
  const el = $("#radar");
  if (!el || !STATE) return;
  const stocks = (STATE.holdings || []).filter((h) => h.type === "stock");
  const withSig = stocks.filter((h) => h.sig?.signal);
  const buy  = withSig.filter((h) => h.sig.signal.tone === "buy");
  const trim = withSig.filter((h) => h.sig.profitTake);
  const sell = withSig.filter((h) => h.sig.signal.tone === "sell" && !h.sig.profitTake);

  // Kısa vadeli fırsatlar: radar evreni swing kurulumları (AL kararı)
  const swItems = (SWING.data && SWING.data.items) || [];
  const shortOpps = swItems.filter((s) => s.verdict && s.verdict.key === "buy").slice(0, 6);

  if (!withSig.length && !shortOpps.length) {
    el.innerHTML = `<div class="card radar">
      <div class="radar-head"><span class="label">🎯 Fırsat Radarı</span></div>
      <div class="radar-empty">↻ Sinyaller hesaplanıyor… (RSI · 200g ort · analist · swing kurulumları · birkaç dakika sürebilir)</div>
    </div>`;
    return;
  }

  // ---- Portföy/nakit bağlamı ----
  const fx = STATE.fx || {}, cash = STATE.cash || {};
  const portTRY = ALLOC.grandTotalTRY || 0;
  const cashTRY = (cash.tl || 0) + (cash.usd || 0) * (fx.usdtry || 0) + (cash.eur || 0) * (fx.eurtry || 0);
  const cashPct = portTRY ? (cashTRY / portTRY) * 100 : null;
  const reg = STATE.regime || null;
  const tgt = reg && reg.targetCash ? reg.targetCash : [20, 25];

  // ---- 1) GÜNÜN FIRSAT ÖZETİ ----
  let todo;
  if (trim.length || sell.length) todo = `${trim.length + sell.length} pozisyon kâr-al / aşırı alım bölgesinde — kısmi satışı düşün, nakde geç.`;
  else if (buy.length && cashPct != null && cashPct > tgt[0]) todo = `${buy.length} portföy hissesi alım bölgesinde ve nakdin var (%${cashPct.toFixed(0)}) — kademeli ekle.`;
  else if (shortOpps.length) todo = `${shortOpps.length} kısa vadeli kurulum hazır — aşağıdaki fırsatlara bak.`;
  else if (reg && reg.advice) todo = reg.advice;
  else todo = "Belirgin aksiyon yok — izlemede kal. 🟡";

  const stat = (n, label, c) => `<div class="fr-stat ${c}"><b>${n}</b><span>${label}</span></div>`;
  const movers = stocks.filter((h) => h.live && h.live.dayChangePct != null)
    .sort((a, b) => b.live.dayChangePct - a.live.dayChangePct);
  const top = movers[0], bot = movers[movers.length - 1];
  const summaryHTML = `<div class="fr-summary">
    <div class="fr-stats">
      ${stat(buy.length, "Alım fırsatı", "s-buy")}
      ${stat(shortOpps.length, "Kısa vade", "s-opp")}
      ${stat(trim.length, "Kâr-al", "s-trim")}
      ${stat(sell.length, "Aşırı alım", "s-sell")}
      ${cashPct != null ? stat("%" + cashPct.toFixed(0), `Nakit · hedef %${tgt[0]}-${tgt[1]}`, "s-cash") : ""}
      ${reg ? stat(reg.band || "—", "Rejim · VIX " + (reg.vix != null ? reg.vix.toFixed(0) : "—"), "s-reg") : ""}
    </div>
    <div class="fr-todo"><b>Bugün:</b> ${todo}</div>
    ${(top && bot && movers.length > 1) ? `<div class="fr-movers">
      <span class="fr-mv pos">▲ ${top.symbol} ${fmtPct(top.live.dayChangePct)}</span>
      <span class="fr-mv neg">▼ ${bot.symbol} ${fmtPct(bot.live.dayChangePct)}</span></div>` : ""}
  </div>`;

  // ---- 2) KISA VADELİ FIRSATLAR (tıkla → grafik) ----
  const shortHTML = shortOpps.length ? `<div class="fr-sec">
    <h4>⚡ Kısa Vadeli Fırsatlar <span class="fr-hint">radar evreni · tıkla → grafik & plan</span></h4>
    <div class="fr-opps">
      ${shortOpps.map((s) => {
        const su = s.setup ? SETUP_META[s.setup.type] : null;
        const own = s.owned ? `<span class="chip mini">portföy</span>` : "";
        return `<div class="fr-opp" data-sym="${s.symbol}" role="button" tabindex="0">
          <div class="fr-opp-top"><span class="sym">${s.symbol}</span>${own}<span class="sw-grade ${GRADE_CLS[s.grade] || "g-d"}">${s.grade}</span></div>
          <div class="fr-opp-setup">${su ? su.label : (s.trend || "")}</div>
          <div class="fr-opp-lvls">
            <span>Giriş <b>${fmtUSD(s.entry)}</b> <i>${ENTRY_TAG[s.entryType] || ""}</i></span>
            <span class="pos">Hedef +${s.rewardPct != null ? s.rewardPct.toFixed(0) : "—"}%</span>
            <span class="muted">${s.rr != null ? s.rr.toFixed(1) + "R" : ""}</span>
          </div>
        </div>`;
      }).join("")}
    </div></div>` : "";

  // ---- 3) POZİSYON & RİSK UYARILARI ----
  const alerts = [];
  stocks.forEach((h) => {
    const w = portTRY && h.live ? ((h.live.marketValueTRY || 0) / portTRY) * 100 : 0;
    if (w >= 20) alerts.push({ tone: "bad", text: `<b>${h.symbol}</b> portföyün %${w.toFixed(0)}'i — yoğunlaşma riski, dağıtmayı düşün.` });
  });
  if (cashPct != null) {
    if (cashPct < tgt[0]) alerts.push({ tone: "warn", text: `Nakit düşük (%${cashPct.toFixed(0)}, hedef %${tgt[0]}-${tgt[1]}) — düzeltmede manevra alanın dar.` });
    else if (cashPct > tgt[1] + 5) alerts.push({ tone: "good", text: `Nakit yüksek (%${cashPct.toFixed(0)}, hedef %${tgt[0]}-${tgt[1]}) — fırsatlarda kullanılabilir.` });
  }
  stocks.forEach((h) => {
    const g = h.sig && h.sig.gainPct;
    if (g != null && g <= -12) {
      const inBuy = h.sig.signal && h.sig.signal.tone === "buy";
      alerts.push({ tone: "warn", text: `<b>${h.symbol}</b> %${g.toFixed(0)} zararda${inBuy ? " · alım bölgesinde (ortalama düşürme?)" : " · stop/tezi gözden geçir"}.` });
    }
  });
  // Pozisyon Bekçisi: iz süren stop ihlali / yaklaşması / hedef
  stocks.forEach((h) => {
    const gd = h.guard;
    if (!gd) return;
    if (gd.breached) alerts.unshift({ tone: "bad", text: `🛑 <b>${h.symbol}</b> iz süren stopun (${fmtUSD(gd.stop)}) altında — çıkış/azaltma planını uygula, "belki döner" deme.` });
    else if (gd.targetHit) alerts.push({ tone: "good", text: `🎯 <b>${h.symbol}</b> hedefine (${fmtUSD(gd.target)}) ulaştı — kâr-al planını uygula.` });
    else if (gd.near) alerts.push({ tone: "warn", text: `<b>${h.symbol}</b> iz süren stopa %${gd.distPct.toFixed(1)} kaldı (${fmtUSD(gd.stop)}) — kırılırsa plan: çık.` });
  });
  // Bilanço Nöbetçisi: ≤7 gün içinde bilanço
  stocks.forEach((h) => {
    const e = h.earnings;
    if (!e || e.daysLeft > 7) return;
    alerts.push({
      tone: e.daysLeft <= 2 ? "bad" : "warn",
      text: `🗓️ <b>${h.symbol}</b> bilançosu ${fmtDate(e.date)}${e.hour === "bmo" ? " (açılış öncesi)" : e.hour === "amc" ? " (kapanış sonrası)" : ""} — ${e.daysLeft === 0 ? "bugün" : e.daysLeft + " gün"} kaldı, gecelik gap riskine karşı pozisyon boyutunu gözden geçir.`,
    });
  });
  const alertsHTML = alerts.length ? `<div class="fr-sec">
    <h4>⚠️ Pozisyon & Risk</h4>
    <ul class="fr-alerts">${alerts.slice(0, 10).map((a) => `<li class="fa-${a.tone}">${a.text}</li>`).join("")}</ul>
  </div>` : "";

  // ---- 4) 52-HAFTA KONUM PANOSU (her hisse için aralık çubuğu) ----
  const board = stocks.filter((h) => h.sig && h.sig.w52High != null && h.sig.w52Low != null
      && h.live && h.live.priceUSD != null && h.sig.w52High > h.sig.w52Low)
    .map((h) => {
      const lo = h.sig.w52Low, hi = h.sig.w52High, p = h.live.priceUSD;
      const pos = Math.max(0, Math.min(100, ((p - lo) / (hi - lo)) * 100));
      const rsi = h.sig.rsi;
      let tag, cls;
      if (pos <= 25) { tag = "dipte · fırsat"; cls = "good"; }
      else if (pos >= 80) { tag = "zirvede · kâr-al"; cls = "bad"; }
      else { tag = "orta bölge"; cls = "mid"; }
      if (rsi != null && rsi < 35) { tag = "aşırı satım"; cls = "good"; }
      else if (rsi != null && rsi > 72) { tag = "aşırı alım"; cls = "bad"; }
      return { h, lo, hi, p, pos, rsi, tag, cls };
    })
    .sort((a, b) => a.pos - b.pos);
  const boardHTML = board.length ? `<div class="fr-sec">
    <h4>📊 52-Hafta Konumu <span class="fr-hint">dip = ucuz/fırsat · zirve = kâr-al · RSI rozetli</span></h4>
    <div class="fr-range-list">
      ${board.map((b) => `<div class="fr-range">
        <span class="fr-range-sym">${b.h.symbol}</span>
        <div class="fr-range-bar" title="52h: ${fmtUSD(b.lo)} – ${fmtUSD(b.hi)}"><i style="left:${b.pos.toFixed(0)}%"></i></div>
        <span class="fr-range-rsi">${b.rsi != null ? "RSI " + b.rsi.toFixed(0) : ""}</span>
        <span class="fr-range-tag t-${b.cls}">${b.tag}</span>
      </div>`).join("")}
    </div></div>` : "";

  // ---- 5) MEVCUT SİNYAL KOLONLARI ----
  const item = (h, body) => `<li><span class="r-sym">${h.symbol}</span><span class="r-txt">${body}</span></li>`;
  const col = (c, icon, title, list, bodyFn) => list.length
    ? `<div class="radar-col ${c}"><h4>${icon} ${title} <span class="cnt">${list.length}</span></h4>
        <ul>${list.map((h) => item(h, bodyFn(h))).join("")}</ul></div>` : "";
  const fmtUp = (h) => h.sig.upsidePct != null ? ` · analist +%${h.sig.upsidePct.toFixed(0)}` : "";
  const cols = col("buy", "🟢", "Alım Bölgesi", buy, (h) => `${h.sig.reasons?.length ? h.sig.reasons.join(", ") : "alım bölgesi"}${fmtUp(h)}`)
             + col("trim", "✂️", "Kâr-Al", trim, (h) => h.sig.profitTake.text)
             + col("sell", "🔴", "Aşırı Alım", sell, (h) => `${h.sig.reasons?.length ? h.sig.reasons.join(", ") : "aşırı alım"}`);
  const colsHTML = withSig.length ? `<div class="fr-sec"><h4>🎯 Portföy Sinyalleri</h4>
    ${cols ? `<div class="radar-cols">${cols}</div>` : `<div class="radar-empty">Şu an belirgin sinyal yok — hepsi nötr. 🟡</div>`}</div>` : "";

  el.innerHTML = `<div class="card radar fr-card">
    <div class="radar-head">
      <span class="label">🎯 Fırsat Radarı</span>
      <span class="meta">özet · kısa vade · risk · 52h · sinyaller</span>
    </div>
    ${summaryHTML}${shortHTML}${alertsHTML}${boardHTML}${colsHTML}
  </div>`;
}

/* ---------------- Swing Tarayıcı (radar evreni + izleme) ---------------- */
let SWING = { data: null, filter: "all" };
const SETUP_META = {
  breakout: { label: "Breakout", cls: "sw-breakout" },
  pullback: { label: "Pullback", cls: "sw-pullback" },
  oversold: { label: "Aşırı satım", cls: "sw-oversold" },
};
const GRADE_CLS = { A: "g-a", B: "g-b", C: "g-c", D: "g-d" };

let swingPolls = 0;
async function loadSwingBoard() {
  try {
    const d = await (await fetch("/api/swing")).json();
    SWING.data = d;
    renderRadarBoard(); // birleşik Radar tablosuna swing kurulumlarını işle (join tazelenir)
    if (STATE) renderRadar(); // ana sayfa Fırsat Radarı şeridi (kısa vade)
    // Sadece tarama sürerken tekrar çek (en çok ~20 kez; TD taraması yavaş).
    if (d.refreshing && swingPolls < 20) { swingPolls++; setTimeout(loadSwingBoard, 8000); }
    else swingPolls = 0;
  } catch {}
}

const ENTRY_TAG = { now: "şimdi", breakout: "kırılımda", pullback: "geri çekilmede", wait: "bekle" };

function swingRow(s) {
  const su = s.setup ? SETUP_META[s.setup.type] : null;
  const v = s.verdict || { tone: "warn", label: "—" };
  const tags = `${s.owned ? `<span class="chip mini">portföy</span>` : ""}${s.watched ? `<span class="chip mini watch">izleme</span>` : ""}${s.cuma ? `<span class="chip mini cuma">⭐ Cuma Hoca</span>` : ""}`;
  const entryCell = s.entry != null
    ? `${fmtUSD(s.entry)}<span class="sw-etag">${ENTRY_TAG[s.entryType] || ""}</span>`
    : `<span class="muted">bekle</span>`;
  return `<tr class="sw-row" data-sym="${s.symbol}">
    <td class="l sw-sym"><span class="sym">${s.symbol}</span> ${tags}<span class="sw-name">${s.name ? s.name.replace(/"/g, "") : ""}</span></td>
    <td class="l sw-verdict">
      <span class="sw-vb v-${v.tone}">${v.label}</span>
      ${su ? `<span class="chip ${su.cls}">${s.setup.label}</span>` : ""}
    </td>
    <td class="rb-price">${fmtUSD(s.price)}${s.dayChangePct != null ? `<span class="rb-dc ${cls(s.dayChangePct)}">${fmtPct(s.dayChangePct)}</span>` : ""}</td>
    <td class="sw-entry">${entryCell}</td>
    <td class="neg">${fmtUSD(s.stop)} <span class="muted">−${s.riskPct.toFixed(1)}%</span></td>
    <td class="pos">${fmtUSD(s.target)} <span class="muted">+${s.rewardPct.toFixed(1)}%</span></td>
    <td><b>${s.rr != null ? s.rr.toFixed(1) + "R" : "—"}</b></td>
    <td>${s.rsi != null ? s.rsi.toFixed(0) : "—"}</td>
    <td><span class="sw-grade ${GRADE_CLS[s.grade] || "g-d"}">${s.grade}</span></td>
    <td class="sw-go">${s.entry != null ? swFromBtn({ symbol: s.symbol, entry: s.entry, stop: s.stop, target: s.target, note: s.setup?.label || "" }) : ""}<span class="sw-go-chart" title="Grafik">📊</span></td>
  </tr>`;
}

function renderSwingBoard() {
  const el = $("#swing");
  if (!el) return;
  const d = SWING.data;

  // İzleme listesi çipleri (portföy yüklemesinden gelir)
  const wl = STATE.watchlist || [];
  const chips = wl.length
    ? wl.map((w) => {
        const ch = w.dayChangePct;
        return `<span class="wl-chip">${w.symbol}${w.price != null ? ` <b>${fmtUSD(w.price)}</b>` : ""}${ch != null ? ` <span class="${cls(ch)}">${fmtPct(ch)}</span>` : ""}<button data-delwatch="${w.symbol}" title="Kaldır">×</button></span>`;
      }).join("")
    : `<span class="muted">İzleme listen boş — radar evreni yine de taranır. Yukarıdan sembol ekleyebilirsin.</span>`;

  const sub = $("#swingSub");
  if (sub && d) {
    const when = d.updated ? new Date(d.updated).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
    sub.textContent = d.count < d.total
      ? `Taranıyor… ${d.count}/${d.total} hisse hazır`
      : `${d.count} hisse · ${d.setups} aktif kurulum · son tarama ${when}`;
  }

  let body;
  if (!d) {
    body = `<div class="radar-empty">Yükleniyor…</div>`;
  } else {
    let items = d.items || [];
    if (SWING.filter === "setup") items = items.filter((s) => s.setup);
    else if (SWING.filter !== "all") items = items.filter((s) => s.setup?.type === SWING.filter);
    body = items.length
      ? `<div class="tbl-wrap rb-wrap"><table class="rb-table sw-table">
          <thead><tr>
            <th class="l">Hisse</th><th class="l">Öneri</th><th>Fiyat</th>
            <th>Giriş</th><th>Stop</th><th>Hedef</th><th>R/R</th><th>RSI</th><th>Not</th><th></th>
          </tr></thead>
          <tbody>${items.map(swingRow).join("")}</tbody>
        </table></div>`
      : `<div class="radar-empty">${d.count < d.total ? "Tarama sürüyor, birazdan dolacak…" : "Bu filtreye uygun kurulum yok."}</div>`;
  }

  el.innerHTML = `<div class="wl-bar">${chips}</div>${body}`;
  // Tıklama olayları delege edilir (aşağıda, #swing üzerinde bir kez) — board
  // 8 sn'de bir yeniden çizildiğinden satır bazlı dinleyici kaybolurdu.
}

// load() portföyü tazeleyince çipler güncellensin diye eski isim korunur
function renderSwing() { renderSwingBoard(); if (CUMA.list) renderCuma(); }

/* ---- Cuma hocanın seçtikleri (Radar 4. segment, SABİT 28 hisse) ---------
 * Liste kodda sabit (/api/cuma → [{symbol,name}]); setuplar swing taramasından
 * süzülür. Kürate kart tasarımı — swing tablosundan kasıtlı olarak farklı. */
let CUMA = { list: null };
async function loadCuma() {
  try { CUMA.list = await (await fetch("/api/cuma")).json(); }
  catch { CUMA.list = CUMA.list || []; }
  if (!SWING.data) loadSwingBoard();   // kurulumlar swing taramasından gelir
  renderCuma();
}
// Tek hisse kartı: setupluysa zengin (plan + pozisyon), değilse kompakt izleme
function cumaCard(c, item) {
  const sym = c.symbol, name = c.name || item?.name || "";
  if (!item) {
    return `<div class="cuma-card scanning" data-sym="${sym}">
      <div class="cc-top"><div class="cc-id"><span class="cc-sym">${sym}</span><span class="cc-name">${name}</span></div></div>
      <div class="cc-watch muted">↻ taranıyor…</div>
    </div>`;
  }
  const v = item.verdict || { tone: "warn", label: "—" };
  const su = item.setup ? SETUP_META[item.setup.type] : null;
  const dc = item.dayChangePct;
  const hasSetup = !!item.setup;
  let body;
  if (item.entry != null) {
    const ps = positionSizing(item.entry, item.stop);
    const L = ps && !ps.unknown ? ps.levels[0] : null;
    body = `
      <div class="cc-chips">
        <span class="cc-verdict v-${v.tone}">${v.label}</span>
        ${su ? `<span class="cc-setup">📐 ${item.setup.label}</span>` : ""}
        ${item.grade ? `<span class="sw-grade ${GRADE_CLS[item.grade] || "g-d"}">${item.grade}</span>` : ""}
      </div>
      <div class="cc-plan">
        <span>Giriş<b>${fmtUSD(item.entry)}</b></span>
        <span>Stop<b class="neg">${fmtUSD(item.stop)}</b></span>
        <span>Hedef<b class="pos">${fmtUSD(item.target)}</b></span>
        <span>R/R<b>${item.rr != null ? item.rr.toFixed(1) + "R" : "—"}</b></span>
      </div>
      ${L ? `<div class="cc-pos">💰 Gir: <b>%${L.posPct.toFixed(1)}</b> portföy · <b>${fmtTRY0(L.posValTRY)}</b> <span class="muted">${fmtNum(L.shares, 2)} adet</span></div>` : ""}
      <div class="cc-acts">${swFromBtn({ symbol: sym, entry: item.entry, stop: item.stop, target: item.target, note: item.setup?.label || "" })}</div>`;
  } else {
    body = `<div class="cc-chips"><span class="cc-verdict v-${v.tone}">${v.label}</span></div>
            <div class="cc-watch muted">Kurulum bekleniyor — ${item.trend || "izlemede"}</div>`;
  }
  return `<div class="cuma-card${hasSetup ? " has-setup" : ""}" data-sym="${sym}">
    <div class="cc-top">
      <div class="cc-id"><span class="cc-sym">${sym}</span><span class="cc-name">${name}</span></div>
      <div class="cc-price">${fmtUSD(item.price)}${dc != null ? ` <span class="${cls(dc)}">${fmtPct(dc)}</span>` : ""}</div>
    </div>
    ${body}
  </div>`;
}
function renderCuma() {
  const grid = $("#cumaGrid"), sub = $("#cumaSub");
  if (!grid) return;
  const list = CUMA.list || [];
  const byS = {};
  (SWING.data?.items || []).forEach((s) => { if (s.cuma) byS[s.symbol] = s; });
  // Setuplu önce (R/R'a göre), sonra fiyatı/verisi gelenler, en son taranmayanlar
  const ranked = list.map((c) => ({ c, item: byS[c.symbol] }));
  ranked.sort((a, b) => {
    const sa = a.item?.setup ? 1 : 0, sb = b.item?.setup ? 1 : 0;
    if (sa !== sb) return sb - sa;
    const da = a.item ? 1 : 0, db = b.item ? 1 : 0;
    if (da !== db) return db - da;
    return (b.item?.rr || 0) - (a.item?.rr || 0);
  });
  const setupN = ranked.filter((r) => r.item?.setup).length;
  const scannedN = ranked.filter((r) => r.item).length;
  if (sub) sub.textContent = `${list.length} sabit hisse · ${setupN} aktif kurulum${scannedN < list.length ? ` · ${scannedN}/${list.length} tarandı` : ""}`;
  grid.innerHTML = list.length
    ? `<div class="cuma-grid">${ranked.map(({ c, item }) => cumaCard(c, item)).join("")}</div>`
    : `<div class="radar-empty">↻ Liste yükleniyor…</div>`;
}

/* ---- Pozisyon büyüklüğü: portföyün %1–2'sini riske atan sabit-kesir kuralı ----
 * adet = (portföy × risk%) ÷ (giriş − stop). Tek pozisyon %25 ile sınırlı (kaldıraçsız).
 * Portföy değeri ALLOC'tan (₺ toplam ÷ USD/TRY) USD'ye çevrilir. */
const MAX_ALLOC_PCT = 0.25;
// Nakit oranı bağlamı — chart modalı + öneriler (sentiment paneliyle aynı hesap).
// Kullanıcı nakit oranını korumak istiyor: alımlar bu banda göre çerçevelenir.
function cashContext() {
  const fx = STATE?.fx || {}, cash = STATE?.cash || {};
  const portTRY = ALLOC.grandTotalTRY || 0;
  if (!portTRY || !fx.usdtry) return null;
  const cashTRY = (cash.tl || 0) + (cash.usd || 0) * (fx.usdtry || 0) + (cash.eur || 0) * (fx.eurtry || 0);
  const cashPct = (cashTRY / portTRY) * 100;
  const tgt = STATE?.regime?.targetCash || [20, 25];
  return { portTRY, portUSD: portTRY / fx.usdtry, cashTRY, cashUSD: cashTRY / fx.usdtry, cashPct, tgt, usdtry: fx.usdtry };
}

function positionSizing(entry, stop) {
  if (entry == null || stop == null || !(entry > stop)) return null;
  const usdtry = ALLOC.usdtry, totalTRY = ALLOC.grandTotalTRY;
  if (!usdtry || !totalTRY) return { unknown: true };
  const portUSD = totalTRY / usdtry;
  const perShare = entry - stop;
  const calc = (riskPct) => {
    const riskAmt = portUSD * riskPct;
    // Midas parçalı (kesirli) hisse alıyor → adet TAM SAYIYA yuvarlanmaz.
    // Asıl çıktı pozisyon TUTARI ve PORTFÖY %'sidir; adet ikincil bilgi.
    const maxShares = (portUSD * MAX_ALLOC_PCT) / entry;
    let shares = riskAmt / perShare;
    let capped = false;
    if (shares > maxShares) { shares = maxShares; capped = true; }
    const posVal = shares * entry;
    return {
      riskPct, shares,
      posVal, posValTRY: posVal * usdtry,
      posPct: (posVal / portUSD) * 100,
      riskUSD: shares * perShare, riskTRY: shares * perShare * usdtry,
      capped,
    };
  };
  return { portUSD, usdtry, perShare, levels: [calc(0.01), calc(0.02)] };
}

function positionSizingHTML(pl) {
  const ps = positionSizing(pl.entry, pl.stop);
  if (!ps) return ""; // giriş yok (bekle/kaçın) → pozisyon önerme
  if (ps.unknown)
    return `<div class="cm-sec">💰 Pozisyon önerisi</div><div class="cm-psnote">Portföy değeri yüklenince hesaplanır — önce “Genel Bakış”ı aç.</div>`;
  const rows = ps.levels.map((L) => {
    const tag = L.riskPct === 0.01 ? "Temkinli %1" : "Agresif %2";
    return `<div class="cm-psr">
      <b>${tag}</b>
      <span class="cm-psv"><b>%${L.posPct.toFixed(1)}</b> · ${fmtTRY0(L.posValTRY)} <span class="muted">(≈${fmtUSD0(L.posVal)} · ${fmtNum(L.shares, 2)} adet${L.capped ? " · %25 sınırı" : ""})</span></span>
      <span class="cm-psrisk">stopta −${fmtTRY0(L.riskTRY)}</span>
    </div>`;
  }).join("");
  return `<div class="cm-sec">💰 Pozisyon önerisi · portföy ≈${fmtTRY0(ps.portUSD * ps.usdtry)}</div>
    <div class="cm-ps">${rows}</div>
    <div class="cm-psnote">Parçalı (Midas): tutar = portföy × risk% ÷ (giriş − stop) × giriş. Stop olursa kaybın sağdaki tutar kadar. Tek pozisyon %25 ile sınırlı.</div>`;
}

/* ---- Kademeli giriş planı: tek seferde değil 2-3 dilimde ----
 * Kuruluma göre yön: breakout → piramit (güçte ekle), diğer → kademeli alım
 * (zayıflıkta indir). Ağırlıklı ortalama maliyeti de hesaplar. */
function scaledEntryPlan(pl) {
  if (pl.entry == null || pl.stop == null || !(pl.entry > pl.stop)) return null;
  const risk = pl.entry - pl.stop;
  const isBreakout = pl.setup?.type === "breakout" || pl.entryType === "breakout";
  let tranches;
  if (isBreakout) {
    tranches = [
      { pct: 50, price: pl.entry, label: "Kırılım onayı" },
      { pct: 30, price: pl.entry + 0.5 * risk, label: "Devam +0.5R" },
      { pct: 20, price: pl.entry + 1.0 * risk, label: "Güç +1R" },
    ];
  } else {
    const p3 = Math.max(pl.entry - 0.8 * risk, pl.stop + 0.15 * risk);
    tranches = [
      { pct: 40, price: pl.entry, label: "İlk dilim" },
      { pct: 35, price: pl.entry - 0.4 * risk, label: "Zayıflık −0.4R" },
      { pct: 25, price: p3, label: "Derin alım" },
    ];
  }
  const avgCost = tranches.reduce((s, t) => s + t.price * t.pct, 0) / 100;
  return { isBreakout, tranches, avgCost };
}

function scaledPlanHTML(pl) {
  const sp = scaledEntryPlan(pl);
  if (!sp) return "";
  const rows = sp.tranches.map((t) =>
    `<div class="cm-trr"><span class="cm-trp">%${t.pct}</span><span class="cm-trl">${t.label}</span><b>${fmtUSD(t.price)}</b></div>`
  ).join("");
  return `<div class="cm-sec">🪜 Kademeli giriş · ${sp.isBreakout ? "piramit (güçte ekle)" : "kademeli alım (zayıflıkta indir)"}</div>
    <div class="cm-scaled">${rows}<div class="cm-tr-avg">Ağırlıklı ort. maliyet ≈ <b>${fmtUSD(sp.avgCost)}</b></div></div>
    <div class="cm-psnote">${sp.isBreakout
      ? "Kırılım tutarsa ekle — yanılırsan yalnızca ilk dilim risk alır, tüm pozisyon tepeden girmemiş olur."
      : "Düştükçe ortalama maliyetin düşer. Ama her dilimde stop'a uy; “nakit bitene kadar ekleme” tuzağına düşme."}</div>`;
}

/* ---- Uzun Vade paneli: kademeli biriktirme bölgeleri + nakit oranı koruması ---- */
function longtermPanel(lt) {
  if (!lt) return "";
  const vcls = ({ buy: "go", watch: "set", wait: "ext" })[lt.verdict.key] || "set";
  const val = lt.valuation || {};
  const vchip = (lbl, pct) => pct == null ? "" :
    `<span class="lt-vchip ${pct <= 0 ? "below" : "above"}">${lbl} ${pct >= 0 ? "+" : ""}${pct}%</span>`;
  const zonesHTML = lt.zones.length
    ? lt.zones.map((z) => `<div class="lt-zone${z.isNow ? " now" : ""}">
        <span class="lt-zpct">%${z.pct}</span><span class="lt-zlbl">${z.label}</span><b>${fmtUSD(z.price)}</b>
      </div>`).join("")
    : (lt.reclaim != null ? `<div class="lt-zone"><span class="lt-zlbl">200g üstüne dönüş tetiği</span><b>${fmtUSD(lt.reclaim)}</b></div>` : "");
  return `<div class="cm-lt">
    <div class="cm-lt-h">🌱 Uzun Vade <span class="lt-verdict v-${vcls}">${lt.verdict.label}</span></div>
    <div class="lt-val"><span class="lt-vlbl">Ort. uzaklık</span>${vchip("20g", val.to20)}${vchip("50g", val.to50)}${vchip("200g", val.to200)}</div>
    ${zonesHTML ? `<div class="lt-zones">${zonesHTML}</div>` : ""}
  </div>`;
}

/* ================= Haftalık Fırsatlar ================= */
const OPP = { data: null };
let oppPolls = 0;
const PAT_TONE_CLS = { bull: "good", bear: "bad", neutral: "warn" };
const WK_ARROW = { up: "↑", down: "↓", flat: "→" };

async function loadOpportunities() {
  const el = $("#opps");
  if (el && !OPP.data) el.innerHTML = `<div class="radar-empty">Taranıyor…</div>`;
  try {
    const d = await (await fetch("/api/opportunities")).json();
    OPP.data = d;
    renderOpportunities();
    if (d.refreshing && oppPolls < 15) { oppPolls++; setTimeout(loadOpportunities, 8000); }
    else oppPolls = 0;
  } catch {}
  // Fırsat backtest (geçmiş Top 10'un gerçek sonucu) — bağımsız, hata yutulur
  try {
    const h = await (await fetch("/api/opportunities/history")).json();
    renderOppBacktest(h);
  } catch {}
}

function renderOppBacktest(h) {
  const el = $("#oppBacktest");
  if (!el) return;
  if (!h || !h.totalPicks) {
    el.innerHTML = `<div class="opp-bt"><div class="opp-bt-h">📊 Geçmiş fırsatların sonucu</div><div class="opp-bt-empty">Sonuç birikiyor — her gün Top 10 kaydedilir, hedef/stop vurdukça istatistik buraya düşer. Birkaç gün sonra anlamlı olur.</div></div>`;
    return;
  }
  const r = h.realized;
  const stats = r ? `<div class="opp-bt-stats">
      <div class="obt"><span>İsabet</span><b class="${r.winRate >= 50 ? "pos" : "neg"}">${r.winRate}%</b><small>${r.n} sonuçlandı</small></div>
      <div class="obt"><span>Ort. getiri</span><b class="${cls(r.avgRet)}">${fmtPct(r.avgRet)}</b><small>işlem başına</small></div>
      <div class="obt"><span>Ort. R</span><b class="${cls(r.avgR ?? 0)}">${r.avgR != null ? (r.avgR >= 0 ? "+" : "") + r.avgR.toFixed(2) + "R" : "—"}</b><small>risk birimi</small></div>
      <div class="obt"><span>Hedef · Stop</span><b>${r.target} · ${r.stop}</b><small>${h.open?.n ? "açık " + h.open.n : "kapanan"}</small></div>
    </div>` : `<div class="opp-bt-empty">Henüz hedef/stop vuran işlem yok (açık: ${h.open?.n || 0}). Sonuçlar olgunlaşıyor.</div>`;
  const recent = (h.recent || []).slice(0, 10).map((s) =>
    `<span class="obt-pill ${s.ret > 0 ? "pos" : "neg"}" title="${s.date} · ${s.status === "target" ? "hedef" : "stop"}">${s.symbol} ${fmtPct(s.ret)}</span>`
  ).join("");
  el.innerHTML = `<div class="opp-bt">
    <div class="opp-bt-h">📊 Geçmiş fırsatların sonucu <span class="muted">${h.firstDate || "?"}'den beri · ${h.days} gün · ${h.totalPicks} öneri izlendi</span></div>
    ${stats}
    ${recent ? `<div class="opp-bt-list">${recent}</div>` : ""}
    <div class="opp-bt-note">“Geçmiş Top 10'a uysaydım ne olurdu?” — her gün listenin anlık kaydı alınır, sonraki mumlarla hedef mi stop mu önce vurdu ölçülür. Skoru gerçek sonuçla kalibre eder; geleceğin garantisi değildir.</div>
  </div>`;
}

// Gerçek portföy değerinden $ pozisyon penceresi (sabit-kesir %1 temkinli kademe)
function oppPositionWindow(o) {
  const ps = positionSizing(o.entry, o.stop);
  if (!ps) return "";
  if (ps.unknown) return `<div class="opp-pos muted">💰 Pozisyon penceresi “Genel Bakış” yüklenince hesaplanır.</div>`;
  const L = ps.levels[0]; // %1 temkinli
  if (!L) return "";
  const rewardTRY = L.shares * (o.target - o.entry) * ps.usdtry;
  return `<div class="opp-pos">
    <div class="opp-pos-main">💰 Gir: <b>%${L.posPct.toFixed(1)}</b> portföy · <b>${fmtTRY0(L.posValTRY)}</b> <span class="muted">(≈${fmtUSD0(L.posVal)} · ${fmtNum(L.shares, 2)} adet${L.capped ? " · %25 sınırı" : ""})</span></div>
    <div class="opp-pos-rr"><span class="neg">stopta −${fmtTRY0(L.riskTRY)}</span> &nbsp;→&nbsp; <span class="pos">hedefte +${fmtTRY0(rewardTRY)}</span> &nbsp;<b>${o.rr != null ? o.rr.toFixed(1) + "R" : ""}</b></div>
  </div>`;
}

// Kademeli giriş özet satırı (kartta kompakt) — detayı grafik modalında
function oppScaledLine(o) {
  const sp = scaledEntryPlan(o);
  if (!sp) return "";
  const parts = sp.tranches.map((t) => `<span>%${t.pct}&nbsp;<b>${fmtUSD(t.price)}</b></span>`).join('<i>·</i>');
  return `<div class="opp-scaled">🪜 ${sp.isBreakout ? "Piramit" : "Kademeli"}: ${parts} <span class="muted">→ ort ${fmtUSD(sp.avgCost)}</span></div>`;
}

// Kısa $ biçimi (insider değeri için): $1.2M / $850K
function fmtMoneyShort(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}
function fmtNewsDate(dt) {
  if (!dt) return "";
  const d = new Date(dt * 1000);
  const days = Math.floor((Date.now() - d.getTime()) / 86400_000);
  if (days <= 0) return "bugün";
  if (days === 1) return "dün";
  if (days < 7) return `${days} gün önce`;
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
}
// Insider rozeti — 90 günlük açık piyasa alım/satım özeti
function oppInsiderChip(ins) {
  if (!ins || (!ins.buys && !ins.sells)) return "";
  if (ins.signal === "buy")
    return `<span class="opp-ins ins-buy" title="Son 90 gün yönetici açık piyasa alımı">🟢 Insider alım ${fmtMoneyShort(ins.buyValue)}${ins.lastBuy ? ` · ${ins.lastBuy}` : ""}</span>`;
  if (ins.signal === "sell")
    return `<span class="opp-ins ins-sell" title="Son 90 gün net yönetici satışı">🔴 Insider satış</span>`;
  return `<span class="opp-ins ins-neu" title="Son 90 gün alım+satım karışık">⚪ Insider karışık</span>`;
}
// Son haberler nöbeti
function oppNews(news) {
  if (!Array.isArray(news) || !news.length) {
    return `<div class="opp-news empty">📰 Son 7 günde öne çıkan haber yok</div>`;
  }
  const rows = news.slice(0, 2).map((n) =>
    `<a class="opp-news-row" href="${n.url || "#"}" target="_blank" rel="noopener" title="${(n.headline || "").replace(/"/g, "'")}">
       <span class="onr-dot"></span>
       <span class="onr-head">${(n.headline || "").replace(/</g, "&lt;")}</span>
       <span class="onr-meta">${n.source ? n.source + " · " : ""}${fmtNewsDate(n.dt)}</span>
     </a>`).join("");
  return `<div class="opp-news"><div class="opp-news-h">📰 Haber nöbeti</div>${rows}</div>`;
}

// Hero için geniş mini grafik (giriş/stop/hedef referans çizgili)
function oppHeroSpark(o) {
  const closes = o.spark;
  if (!closes || closes.length < 3) return "";
  const w = 260, h = 84, pad = 4;
  const refs = [o.stop, o.target].filter((v) => v != null);
  const min = Math.min(...closes, ...refs), max = Math.max(...closes, ...refs), range = max - min || 1;
  const n = closes.length;
  const x = (i) => pad + (i / (n - 1)) * (w - 2 * pad);
  const y = (v) => pad + (1 - (v - min) / range) * (h - 2 * pad);
  const up = closes[n - 1] >= closes[0];
  const stroke = up ? "var(--up)" : "var(--down)";
  const fill = up ? "var(--up-soft)" : "var(--down-soft)";
  const linePts = closes.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const areaPts = `${pad},${h - pad} ${linePts} ${(w - pad)},${h - pad}`;
  const refLine = (v, color, dash) => v == null ? "" :
    `<line x1="${pad}" y1="${y(v).toFixed(1)}" x2="${w - pad}" y2="${y(v).toFixed(1)}" stroke="${color}" stroke-width="1" stroke-dasharray="${dash}" opacity=".55"></line>`;
  return `<div class="opp-hero-chart"><svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">
      <polygon points="${areaPts}" fill="${fill}"></polygon>
      ${refLine(o.target, "var(--up)", "3 3")}
      ${refLine(o.stop, "var(--down)", "3 3")}
      <polyline points="${linePts}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>
      <circle cx="${x(n - 1).toFixed(1)}" cy="${y(closes[n - 1]).toFixed(1)}" r="2.6" fill="${stroke}"></circle>
    </svg></div>`;
}

// Çipler şeridi (hero + genişletilmiş satır ortak)
function oppChips(o) {
  const su = o.setup ? SETUP_META[o.setup.type] : null;
  const v = o.verdict || { tone: "warn", label: "—" };
  const pat = o.pattern;
  const patTone = PAT_TONE_CLS[pat?.tone] || "warn";
  return `<div class="opp-chips">
    <span class="sw-vb v-${v.tone}">${v.label}</span>
    ${su ? `<span class="chip ${su.cls}">${o.setup.label}</span>` : ""}
    ${pat ? `<span class="chip pat-${patTone}">📐 ${pat.label}</span>` : ""}
    ${o.weekly ? `<span class="chip wk-${o.weekly.tone}">📅 Haftalık ${WK_ARROW[o.weekly.dir] || ""}</span>` : ""}
    <span class="sw-grade ${GRADE_CLS[o.grade] || "g-d"}">${o.grade}</span>
    ${oppInsiderChip(o.insider)}
    ${o.fromHighPct != null ? `<span class="opp-meta">52h zirveye −${o.fromHighPct.toFixed(0)}%</span>` : ""}
    ${o.ret3M != null ? `<span class="opp-meta ${cls(o.ret3M)}">3A ${fmtPct(o.ret3M)}</span>` : ""}
  </div>`;
}

// Plan grid + pozisyon + neden + haber (hero & genişletilmiş satır ortak gövde)
function oppDetailBody(o) {
  const hr = o.hitRate;
  const whyHTML = (o.why || []).map((w) => `<li class="s-${w.tone}">${w.text}</li>`).join("");
  return `${oppChips(o)}
    <div class="opp-plan">
      <div class="opp-pl"><span>Fiyat</span><b>${fmtUSD(o.price)}</b></div>
      <div class="opp-pl i-entry"><span>Giriş ${ENTRY_TAG[o.entryType] ? `<i>${ENTRY_TAG[o.entryType]}</i>` : ""}</span><b>${fmtUSD(o.entry)}</b></div>
      <div class="opp-pl"><span>Stop</span><b class="neg">${fmtUSD(o.stop)} <small>−${o.riskPct.toFixed(1)}%</small></b></div>
      <div class="opp-pl"><span>Hedef</span><b class="pos">${fmtUSD(o.target)} <small>+${o.rewardPct.toFixed(1)}%</small></b></div>
      <div class="opp-pl"><span>Risk/Ödül</span><b>${o.rr != null ? o.rr.toFixed(1) + "R" : "—"}</b></div>
      ${hr ? `<div class="opp-pl"><span>Geçmiş isabet</span><b>${hr.winRate}% <small>${hr.n} işlem${hr.avgR != null ? `, ort ${hr.avgR >= 0 ? "+" : ""}${hr.avgR.toFixed(1)}R` : ""}</small></b></div>` : `<div class="opp-pl"><span>Geçmiş isabet</span><b class="muted">veri birikiyor</b></div>`}
    </div>
    ${oppPositionWindow(o)}
    ${oppScaledLine(o)}
    ${whyHTML ? `<ul class="opp-why">${whyHTML}</ul>` : ""}
    ${oppNews(o.news)}
    <div class="opp-acts">
      <button class="btn ghost sm opp-chart">📊 Grafik + çizgiler</button>
      ${swFromBtn({ symbol: o.symbol, entry: o.entry, stop: o.stop, target: o.target, note: o.setup?.label || "" })}
    </div>`;
}

// #1 fırsat: öne çıkan büyük "Haftanın Seçimi" kartı
function oppHeroCard(o) {
  const tags = `${o.owned ? `<span class="chip mini">portföy</span>` : ""}${o.watched ? `<span class="chip mini watch">izleme</span>` : ""}${o.cuma ? `<span class="chip mini cuma">⭐ Cuma Hoca</span>` : ""}`;
  const hot = o.insider?.signal === "buy" || (Array.isArray(o.news) && o.news.length);
  return `<div class="opp-hero${hot ? " hot" : ""}" data-sym="${o.symbol}">
    <div class="opp-hero-badge">⭐ Haftanın Seçimi</div>
    <div class="opp-hero-grid">
      <div class="opp-hero-left">
        <div class="opp-hero-id">
          <span class="opp-hero-sym">${o.symbol}</span>
          <span class="opp-hero-name">${o.name ? o.name.replace(/"/g, "") : ""}</span>
          ${tags}
        </div>
        ${oppHeroSpark(o)}
        <div class="opp-hero-scorebox" title="Fırsat skoru — kalite + R/R + momentum + formasyon">
          <span class="opp-hero-score">${o.score}</span><span class="opp-hero-scorelbl">fırsat skoru</span>
        </div>
      </div>
      <div class="opp-hero-right opp-body">
        ${oppDetailBody(o)}
      </div>
    </div>
  </div>`;
}

// 2-N: kompakt, tıkla→genişle tablo satırı
function oppTableRow(o, i) {
  const su = o.setup ? SETUP_META[o.setup.type] : null;
  const v = o.verdict || { tone: "warn", label: "—" };
  const hot = o.insider?.signal === "buy" || (Array.isArray(o.news) && o.news.length);
  const flag = o.insider?.signal === "buy" ? "🟢" : (Array.isArray(o.news) && o.news.length ? "📰" : "");
  const tags = `${o.owned ? `<span class="chip mini">portföy</span>` : ""}${o.cuma ? `<span class="chip mini cuma">⭐</span>` : ""}`;
  return `<div class="opp-row${hot ? " hot" : ""}" data-sym="${o.symbol}">
    <button class="opp-row-head" aria-expanded="false">
      <span class="orh-rank">#${i + 1}</span>
      <span class="orh-id"><b>${o.symbol}</b>${flag ? ` <span class="orh-flag">${flag}</span>` : ""} ${tags}<span class="orh-name">${o.name ? o.name.replace(/"/g, "") : ""}</span></span>
      <span class="orh-score" title="Fırsat skoru">${o.score}</span>
      <span class="orh-rr">${o.rr != null ? o.rr.toFixed(1) + "R" : "—"}</span>
      <span class="orh-setup">${su ? `<span class="chip ${su.cls}">${o.setup.label}</span>` : ""}<span class="sw-vb v-${v.tone}">${v.label}</span></span>
      <span class="orh-arrow">▾</span>
    </button>
    <div class="opp-row-detail opp-body" hidden>${oppDetailBody(o)}</div>
  </div>`;
}

function renderOpportunities() {
  const el = $("#opps");
  if (!el) return;
  const d = OPP.data;
  const sub = $("#oppSub");
  if (sub && d) {
    const when = d.updated ? new Date(d.updated).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
    sub.textContent = d.refreshing ? `· taranıyor… ${d.scanned} aday hazır` : `· ${d.scanned} aday · ${when}`;
  }
  if (!d) { el.innerHTML = `<div class="radar-empty">Yükleniyor…</div>`; return; }
  // Nöbet şeridi: 10 hisse + insider/haber göstergesi
  const ws = $("#oppWatchSyms");
  if (ws) {
    ws.innerHTML = (d.items || []).map((o) => {
      const flag = o.insider?.signal === "buy" ? "🟢" : (Array.isArray(o.news) && o.news.length ? "📰" : "");
      return `<span class="ows-chip" data-seek="${o.symbol}">${o.symbol}${flag ? ` ${flag}` : ""}</span>`;
    }).join("");
  }
  if (!d.items?.length) {
    el.innerHTML = `<div class="radar-empty">${d.refreshing ? "Tarama sürüyor, birazdan dolacak…" : "Şu an kriterlere uyan girilebilir kurulum yok. Bu da bir bilgidir — sistem 'bu hafta zorlama' diyor."}</div>`;
    return;
  }
  const [hero, ...rest] = d.items;
  el.innerHTML = `${oppHeroCard(hero)}${rest.length ? `
    <div class="opp-table">
      <div class="opp-table-h"><span>#</span><span>Sembol</span><span>Skor</span><span>R/R</span><span>Kurulum</span><span></span></div>
      ${rest.map((o, i) => oppTableRow(o, i + 1)).join("")}
    </div>` : ""}`;
}

/* ---------------- Grafik modalı: Lightweight Charts + oto-seviyeler -------- */
let cmChart = null, cmResizeHandler = null, cmCandle = null, cmCandles = null;

function closeChartModal() {
  const bg = $("#chartModalBg");
  if (bg) bg.hidden = true;
  if (cmResizeHandler) { window.removeEventListener("resize", cmResizeHandler); cmResizeHandler = null; }
  resetMeasure();
  if (cmChart) { try { cmChart.remove(); } catch {} cmChart = null; cmCandle = null; cmCandles = null; }
}

/* ===== Ölçüm aracı (TradingView measure tool) — grafikte basılı tutup çek:
   Δfiyat · % · çubuk sayısı · hacim. Ölç moduyken bir yakalama katmanı LC crosshair'ini
   devre dışı bırakır; mum koordinatından fiyat, zaman ekseninden çubuk farkı okunur. ===== */
const MEASURE = { mode: false, cleanup: null };
const fmtBigNum = (v) => v >= 1e9 ? (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? (v / 1e3).toFixed(1) + "K" : String(Math.round(v));
// Piyasa değeri: $ önekli, trilyon (T) desteğiyle
const fmtMktCap = (v) => v == null || !isFinite(v) ? "—" : v >= 1e12 ? "$" + (v / 1e12).toFixed(2) + "T" : v >= 1e9 ? "$" + (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? "$" + (v / 1e6).toFixed(1) + "M" : "$" + fmtBigNum(v);
function cmRemoveMeasureLines() {
  try { if (MEASURE.l1 && cmCandle) cmCandle.removePriceLine(MEASURE.l1); } catch {}
  try { if (MEASURE.l2 && cmCandle) cmCandle.removePriceLine(MEASURE.l2); } catch {}
  MEASURE.l1 = MEASURE.l2 = null;
}
function cmClearMeasureOverlay() {
  if (MEASURE.cleanup) { MEASURE.cleanup(); MEASURE.cleanup = null; }
  cmRemoveMeasureLines();
  document.querySelectorAll(".cm-measure-catch, .cm-measure-box, .cm-measure-info").forEach((n) => n.remove());
}
function resetMeasure() {
  MEASURE.mode = false;
  $("#cmMeasure")?.classList.remove("active");
  $("#cmChart")?.classList.remove("measuring");
  cmClearMeasureOverlay();
}
function toggleMeasure() {
  if (!cmChart || !cmCandle) return;
  MEASURE.mode = !MEASURE.mode;
  $("#cmMeasure")?.classList.toggle("active", MEASURE.mode);
  $("#cmChart")?.classList.toggle("measuring", MEASURE.mode);
  cmClearMeasureOverlay();
  if (MEASURE.mode) installMeasureCatch();
}
function installMeasureCatch() {
  const el = $("#cmChart"); if (!el) return;
  const catcher = document.createElement("div"); catcher.className = "cm-measure-catch"; el.appendChild(catcher);
  let start = null, box = null, info = null;
  const pos = (e) => { const r = el.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return { x: t.clientX - r.left, y: t.clientY - r.top }; };
  const down = (e) => {
    e.preventDefault();
    cmClearBoxes();
    start = pos(e);
    box = document.createElement("div"); box.className = "cm-measure-box"; el.appendChild(box);
    info = document.createElement("div"); info.className = "cm-measure-info"; el.appendChild(info);
  };
  const move = (e) => {
    if (!start || !box) return;
    e.preventDefault();
    const cur = pos(e);
    const x0 = Math.min(start.x, cur.x), y0 = Math.min(start.y, cur.y);
    box.style.cssText = `left:${x0}px;top:${y0}px;width:${Math.abs(cur.x - start.x)}px;height:${Math.abs(cur.y - start.y)}px`;
    const p1 = cmCandle.coordinateToPrice(start.y), p2 = cmCandle.coordinateToPrice(cur.y);
    if (p1 == null || p2 == null) return;
    const dPrice = p2 - p1, pct = p1 ? dPrice / p1 * 100 : 0, up = dPrice >= 0;
    box.classList.toggle("up", up); box.classList.toggle("down", !up);
    // Sağ fiyat eksenine hizalı çizgiler (TradingView gibi): başlangıç (gri) + hedef (yön rengi) — sağda fiyat etiketi
    const col = up ? "#2f8f57" : "#cf473d";
    if (!MEASURE.l1) MEASURE.l1 = cmCandle.createPriceLine({ price: p1, color: "#8a93a0", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "" });
    else MEASURE.l1.applyOptions({ price: p1 });
    if (!MEASURE.l2) MEASURE.l2 = cmCandle.createPriceLine({ price: p2, color: col, lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: (up ? "▲" : "▼") + "%" + Math.abs(pct).toFixed(1) });
    else MEASURE.l2.applyOptions({ price: p2, color: col, title: (up ? "▲" : "▼") + "%" + Math.abs(pct).toFixed(1) });
    let bars = null, li0 = null;
    try {
      const l1 = cmChart.timeScale().coordinateToLogical(start.x), l2 = cmChart.timeScale().coordinateToLogical(cur.x);
      if (l1 != null && l2 != null) { bars = Math.abs(Math.round(l2 - l1)); li0 = Math.round(Math.min(l1, l2)); }
    } catch {}
    let volTxt = "";
    if (bars != null && li0 != null && cmCandles?.length) {
      let vsum = 0; for (let i = Math.max(0, li0); i <= Math.min(cmCandles.length - 1, li0 + bars); i++) vsum += cmCandles[i]?.volume || 0;
      if (vsum > 0) volTxt = ` · Hacim ${fmtBigNum(vsum)}`;
    }
    info.className = "cm-measure-info " + (up ? "up" : "down");
    info.innerHTML = `<b>${up ? "▲" : "▼"} ${fmtUSD(Math.abs(dPrice))} · ${up ? "+" : "−"}%${Math.abs(pct).toFixed(2)}</b>${bars != null ? `<span>${bars} çubukta${volTxt}</span>` : ""}`;
    info.style.left = `${Math.min(cur.x + 14, el.clientWidth - 180)}px`; info.style.top = `${Math.max(4, y0 - 6)}px`;
  };
  const end = () => { start = null; };
  function cmClearBoxes() { el.querySelectorAll(".cm-measure-box, .cm-measure-info").forEach((n) => n.remove()); box = info = null; cmRemoveMeasureLines(); }
  catcher.addEventListener("mousedown", down);
  catcher.addEventListener("touchstart", down, { passive: false });
  window.addEventListener("mousemove", move); window.addEventListener("mouseup", end);
  window.addEventListener("touchmove", move, { passive: false }); window.addEventListener("touchend", end);
  MEASURE.cleanup = () => {
    window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", end);
    window.removeEventListener("touchmove", move); window.removeEventListener("touchend", end);
  };
}
$("#cmMeasure")?.addEventListener("click", toggleMeasure);

// Portföydeki bir hisseden grafik aç → pozisyon bağlamını (maliyet/K-Z) da geçir
function openPositionDetail(id) {
  const h = (STATE?.holdings || []).find((x) => x.id === id);
  if (!h) return;
  const mvTRY = h.live?.marketValueTRY ?? null;
  const cost = costOf(h);
  const profitTRY = mvTRY != null ? mvTRY - cost : null;
  openChartModal(h.symbol, {
    qty: h.quantity,
    costUSD: h.costUSD != null ? Number(h.costUSD) : null,
    mvTRY,
    profitTRY,
    profitPct: cost && profitTRY != null ? (profitTRY / cost) * 100 : null,
    guard: h.guard || null,
    earnings: h.earnings || null,
    horizon: h.horizon === "swing" ? "swing" : "long",
  });
}

let cmCurrent = { sym: null, ctx: null };
// Grafik açılınca pozisyonu portföyden + swing defterinden otomatik çöz (ctx verilmese de)
function resolveChartPosition(sym, ctx) {
  if (ctx && ctx.qty != null) return ctx;            // çağıran zaten pozisyon verdi
  const S = String(sym || "").toUpperCase();
  const fx = STATE?.fx?.usdtry || ALLOC?.usdtry || null;
  const h = (STATE?.holdings || []).find((x) => x.type === "stock" && x.symbol === S);
  const sws = (STATE?.swingPositions || []).filter((p) => String(p.symbol).toUpperCase() === S);
  if (!h && !sws.length) return ctx;                 // sahip değil → pozisyon kartı yok
  let qty = 0, costTRY = 0, costUSDw = 0, mvTRY = 0, hasMv = false, guard = null;
  let horizon = ctx?.horizon, earnings = ctx?.earnings || null;
  if (h) {
    const q = Number(h.quantity) || 0;
    qty += q; costTRY += costOf(h) || 0;
    if (h.costUSD != null) costUSDw += Number(h.costUSD) * q;
    const mv = h.live?.marketValueTRY;
    if (mv != null) { mvTRY += mv; hasMv = true; }
    guard = h.guard || guard;
    horizon = horizon || (h.horizon === "swing" ? "swing" : "long");
    earnings = earnings || h.earnings || null;
  }
  for (const p of sws) {
    const q = Number(p.qty) || 0;
    qty += q; costUSDw += (Number(p.entry) || 0) * q;
    if (fx) costTRY += (Number(p.entry) || 0) * q * fx;
    if (p.valueUSD != null && fx) { mvTRY += p.valueUSD * fx; hasMv = true; }
    if (!guard && p.guard) guard = { stop: p.guard.stop, distPct: p.guard.distPct, breached: p.guard.breached, target: p.target ?? null, targetHit: p.guard.targetHit };
    horizon = horizon || "swing";
  }
  const profitTRY = hasMv ? mvTRY - costTRY : null;
  return {
    qty, costUSD: qty > 0 ? costUSDw / qty : null,
    mvTRY: hasMv ? mvTRY : null, profitTRY,
    profitPct: costTRY > 0 && profitTRY != null ? (profitTRY / costTRY) * 100 : null,
    guard, earnings, horizon,
  };
}

async function openChartModal(sym, ctx = null, fresh = false) {
  const bg = $("#chartModalBg");
  if (!bg) return;
  cmCurrent = { sym, ctx };
  bg.hidden = false;
  $("#cmSym").textContent = sym;
  $("#cmName").textContent = "";
  $("#cmPrice").textContent = "";
  $("#cmTV").href = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(sym)}`;
  const chartEl = $("#cmChart"), sideEl = $("#cmSide"), legEl = $("#cmLegend");
  chartEl.innerHTML = `<div class="cm-skel"><div class="cm-skel-bars">${
    Array.from({ length: 28 }, (_, i) => `<span style="height:${20 + Math.round(60 * Math.abs(Math.sin(i / 2.3)))}%"></span>`).join("")
  }</div><div class="cm-skel-label">↻ ${sym} grafiği hazırlanıyor…</div></div>`;
  sideEl.innerHTML = ""; legEl.innerHTML = "";
  if (cmChart) { try { cmChart.remove(); } catch {} cmChart = null; }

  // Önbellekteyse anında gelir; değilse tek bir canlı çekim (kısa). Geçici
  // "kaynak meşgul" durumunda bir kez otomatik tekrar dener.
  let d;
  const tryFetch = async () => {
    const r = await fetch(`/api/chart?symbol=${encodeURIComponent(sym)}${fresh ? "&fresh=1" : ""}`);
    if (!r.ok) { const e = new Error((await r.json().catch(() => ({}))).error || "veri yok"); e.status = r.status; throw e; }
    return r.json();
  };
  try {
    try {
      d = await tryFetch();
    } catch (e1) {
      if (e1.status === 502) { await new Promise((r) => setTimeout(r, 2500)); d = await tryFetch(); }
      else throw e1;
    }
  } catch (e) {
    chartEl.innerHTML = `<div class="cm-loading">📉 ${sym} grafiği yüklenemedi.<br><span style="color:var(--muted);font-size:13px">${String(e.message || e)}</span><br><button class="btn ghost sm" id="cmRetry" style="margin-top:12px">↻ Tekrar dene</button> <a class="btn ghost sm" href="https://www.tradingview.com/chart/?symbol=${encodeURIComponent(sym)}" target="_blank" rel="noopener" style="margin-top:12px">TradingView ↗</a></div>`;
    $("#cmRetry")?.addEventListener("click", () => openChartModal(sym, ctx));
    return;
  }
  if (!window.LightweightCharts) {
    chartEl.innerHTML = `<div class="cm-loading">Grafik kütüphanesi yüklenemedi (internet?).</div>`;
    return;
  }

  const pos = resolveChartPosition(sym, ctx);   // portföy + swing pozisyonu otomatik
  $("#cmName").textContent = d.name || "";
  $("#cmPrice").textContent = d.price != null ? fmtUSD(d.price) : "";

  // --- Lightweight Charts ---
  chartEl.innerHTML = "";
  const LC = window.LightweightCharts;
  const chart = LC.createChart(chartEl, {
    layout: { background: { color: "#ffffff" }, textColor: "#3a4a3f", fontFamily: "inherit" },
    grid: { vertLines: { color: "#eef1ee" }, horzLines: { color: "#eef1ee" } },
    rightPriceScale: { borderColor: "#dfe5df" },
    timeScale: { borderColor: "#dfe5df", timeVisible: false },
    crosshair: { mode: LC.CrosshairMode.Normal },
    autoSize: true,
  });
  cmChart = chart;

  // ── EMA Cloud (Ripster 8/21) — EN ALTTA: iki-çizgi-arası bulut dolgusu ──
  // Z-order = ekleme sırası. Bulut önce (altta), mumlar sonra (üstte) → mumlar gizlenmez.
  // 8 EMA momentum, 21 EMA trend. Bulut yeşil=8>21 (boğa), kırmızı=8<21 (ayı).
  let emaCloud = null;
  if (d.ema8?.length && d.ema21?.length) {
    const tmap21 = new Map(d.ema21.map((p) => [p.time, p.value]));
    const last8 = d.ema8[d.ema8.length - 1];
    const bull = last8.value >= (tmap21.get(last8.time) ?? last8.value);
    const cloudCol = bull ? "rgba(16,185,129,.16)" : "rgba(220,68,61,.15)";
    const lo = [], hi = [];
    for (const p of d.ema8) { const v21 = tmap21.get(p.time); if (v21 == null) continue; lo.push({ time: p.time, value: Math.min(p.value, v21) }); hi.push({ time: p.time, value: Math.max(p.value, v21) }); }
    // hi: bulut rengiyle scale-altına kadar dolu · lo: arka plan rengiyle üstünü kapatır → sadece 8↔21 arası renkli kalır
    chart.addAreaSeries({ lineWidth: 0, topColor: cloudCol, bottomColor: cloudCol, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }).setData(hi);
    chart.addAreaSeries({ lineWidth: 0, topColor: "#ffffff", bottomColor: "#ffffff", priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }).setData(lo);
    emaCloud = { bull };
  }

  const candle = chart.addCandlestickSeries({
    upColor: "#2f8f57", downColor: "#cf473d", borderVisible: false,
    wickUpColor: "#2f8f57", wickDownColor: "#cf473d",
  });
  candle.setData(d.candles);
  cmCandle = candle; cmCandles = d.candles; resetMeasure(); // ölçüm aracı için referanslar
  initDrawings(chartEl, chart, candle, d.candles, sym);      // kalıcı trend/yatay çizim katmanı
  if (d.sma20?.length) chart.addLineSeries({ color: "#56b1d6", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(d.sma20);
  if (d.sma50?.length) chart.addLineSeries({ color: "#d9a92b", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(d.sma50);
  if (d.sma200?.length) chart.addLineSeries({ color: "#6b5fd0", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(d.sma200);
  // EMA çizgileri EN ÜSTTE (bulutun ve mumların üstünde)
  if (d.ema21?.length) chart.addLineSeries({ color: "#f59e0b", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }).setData(d.ema21);
  if (d.ema8?.length) chart.addLineSeries({ color: "#0ea5a0", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }).setData(d.ema8);

  // Hacim histogramı (alt %18'lik bantta)
  const volData = d.candles.filter((c) => c.volume != null).map((c) => ({
    time: c.time, value: c.volume,
    color: c.close >= c.open ? "rgba(47,143,87,.35)" : "rgba(207,71,61,.35)",
  }));
  if (volData.length) {
    const vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false });
    vol.setData(volData);
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  }

  const pl = d.plan || {};
  const DS = LC.LineStyle;
  const line = (price, color, style, title, width = 2) => {
    if (price == null || !isFinite(price)) return;
    candle.createPriceLine({ price, color, lineWidth: width, lineStyle: style, axisLabelVisible: true, title });
  };
  // Güncel fiyat referansı (gri ince) — giriş seviyelerinden ayırt etmek için
  if (pl.currentPrice != null) line(pl.currentPrice, "#94a39a", DS.Dotted, "Fiyat", 1);
  // 52 hafta zirve/dip (TradingView tarzı High/Low çizgileri)
  if (d.stats?.w52High != null) line(d.stats.w52High, "#cf473d", DS.Dashed, "52h Zirve", 1);
  if (d.stats?.w52Low != null) line(d.stats.w52Low, "#5a8fb0", DS.Dashed, "52h Dip", 1);
  // ── SWING (Qullamaggie) — tek giriş otoritesi: pivot kırılımı + stop + R hedef
  if (d.qm?.ok && d.qm.setup !== "none") {
    line(d.qm.entryTrigger, "#0a8f6e", DS.Solid, "Swing Giriş", 2);
    line(d.qm.stop, "#b8281f", DS.Dashed, "Swing Stop", 2);
    if (d.qm.rTargets?.r2) line(d.qm.rTargets.r2, "#1f7a48", DS.Dashed, "Hedef 2R", 1);
    if (d.qm.rTargets?.r3) line(d.qm.rTargets.r3, "#1f7a48", DS.Dotted, "Hedef 3R", 1);
  }
  // ── UZUN VADE — kademeli biriktirme bölgeleri (yeşil-gri, swing'le karışmaz)
  (pl.longterm?.zones || []).forEach((z, i) =>
    line(z.price, z.isNow ? "#2f8f57" : "#7fae8e", z.isNow ? DS.Solid : DS.Dashed, `Biriktir %${z.pct}`, z.isNow ? 2 : 1));
  if (pl.longterm?.reclaim != null) line(pl.longterm.reclaim, "#7fae8e", DS.Dashed, "200g dönüş", 1);
  // Destek / Direnç (ince noktalı, bağlam)
  (d.levels?.support || []).forEach((v, i) => line(v, "#9aa7a0", DS.Dotted, i === 0 ? "Destek" : "", 1));
  (d.levels?.resistance || []).forEach((v, i) => line(v, "#c98a3a", DS.Dotted, i === 0 ? "Direnç" : "", 1));
  // Pozisyon: ortalama maliyet çizgisi (mor)
  if (pos?.costUSD != null && isFinite(pos.costUSD)) line(pos.costUSD, "#7c6cf0", DS.Solid, "Maliyet", 1);
  // Pozisyon Bekçisi: iz süren stop (turuncu) + manuel hedef
  if (pos?.guard?.stop != null) line(pos.guard.stop, "#e07b2f", DS.Dashed, "İz süren stop");
  if (pos?.guard?.target != null) line(pos.guard.target, "#1f7a48", DS.Solid, "Plan hedef", 1);

  // --- EĞİMLİ trend çizgileri + formasyon şekli (otomatik çizim) ---
  const pats = d.patterns || {};
  const tline = (ln, color, style, width = 2) => {
    if (!ln?.p1 || !ln?.p2) return;
    const data = [{ time: ln.p1.time, value: ln.p1.value }, { time: ln.p2.time, value: ln.p2.value }]
      .sort((a, b) => (a.time < b.time ? -1 : 1));
    if (data[0].time === data[1].time) return; // dejenere (tek nokta) çizgi atla
    chart.addLineSeries({ color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }).setData(data);
  };
  // Eğimli trend çizgileri: düşen direnç (tepe) belirgin koyu, yükselen destek (dip) mavi
  (pats.trendlines || []).forEach((t) => {
    const falling = t.role === "resistance" && t.slope < 0;
    const rising = t.role === "support" && t.slope > 0;
    if (falling) tline(t, "#2b2f36", DS.Solid, 2.5);            // düşen trend — net & kalın (örnek grafikler)
    else if (rising) tline(t, "rgba(47,143,87,.9)", DS.Solid, 2); // yükselen trend — yeşil
    else tline(t, t.role === "resistance" ? "rgba(201,138,58,.55)" : "rgba(86,177,214,.55)", DS.Solid, 1);
  });
  // Formasyon çizgileri (bayrak/üçgen/boyun) — tona göre renk, daha kalın
  if (pats.pattern?.lines?.length) {
    const pt = pats.pattern.tone;
    const col = pt === "bull" ? "#1f7a48" : pt === "bear" ? "#cf473d" : "#7c6cf0";
    pats.pattern.lines.forEach((ln) => tline(ln, col, ln.role === "pole" ? DS.Solid : DS.Dashed, ln.role === "pole" ? 3 : 2));
    if (pats.pattern.breakout != null) line(pats.pattern.breakout, col, DS.Dashed, "Kırılım", 1);
  }

  // Son ~130 güne (≈6 ay) odakla — trend çizgileri ve formasyon sıkışmadan
  // net görünsün (tüm 360 mumu birden göstermek hareketi ezerdi). Kullanıcı
  // geriye kaydırıp tüm geçmişi yine görebilir.
  const NB = d.candles.length;
  const focusRange = () => chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, NB - 130), to: NB + 3 });
  focusRange();
  cmResizeHandler = focusRange;
  window.addEventListener("resize", cmResizeHandler);

  // ── Grafik üstü stats overlay (TradingView tarzı): piyasa değeri · ADR% · RS · sektör ──
  const st = d.stats || {};
  if (st.marketCap != null || st.adrPct != null || st.rsRating != null || st.industry) {
    const ov = document.createElement("div");
    ov.className = "cm-stats-ov";
    const rsCls = st.rsRating == null ? "" : st.rsRating >= 80 ? "good" : st.rsRating >= 50 ? "warn" : "bad";
    const adrCls = st.adrPct == null ? "" : st.adrPct >= 4 ? "good" : "muted";
    ov.innerHTML = `
      ${st.marketCap != null ? `<div class="cs-r"><span>Market Cap</span><b>${fmtMktCap(st.marketCap)}</b></div>` : ""}
      ${st.adrPct != null ? `<div class="cs-r"><span>ADR%</span><b class="${adrCls}">${st.adrPct.toFixed(2)}%</b></div>` : ""}
      ${st.rsRating != null ? `<div class="cs-r"><span>RS Rating</span><b class="${rsCls}">${st.rsRating}</b></div>` : ""}
      ${st.industry ? `<div class="cs-r ind"><span>${st.exchange ? st.exchange + " · " : ""}${st.industry}</span></div>` : ""}`;
    chartEl.appendChild(ov);
  }

  // --- Yan panel: iki LENS (Swing/Qullamaggie + Uzun Vade) + göstergeler ---
  const ind = d.indicators || {};
  const row = (k, val, c = "") => `<div class="cm-r"><span class="cm-k">${k}</span><span class="cm-v ${c}">${val}</span></div>`;
  const keyCell = (k, val) => `<div class="cm-keycell"><span>${k}</span><b>${val}</b></div>`;
  const sigRows = (d.signals || []).map((g) =>
    `<div class="cm-sig"><span class="cm-sig-n">${g.name}</span><span class="cm-sig-v s-${g.tone}">${g.value}</span><span class="cm-sig-t">${g.text}</span></div>`
  ).join("");
  // Pozisyon kartı — portföy + swing defterinden otomatik (sahip olunan her sembolde)
  const posCard = (pos && pos.qty > 0) ? `
    <div class="cm-pos">
      <div class="cm-pos-head">📍 Pozisyonun${pos.horizon ? `<span class="cm-pos-hz">${pos.horizon === "swing" ? "⚡ swing" : "🌱 uzun"}</span>` : ""}</div>
      ${row("Adet", fmtNum(pos.qty, 4))}
      ${row("Ort. maliyet", pos.costUSD != null ? fmtUSD(pos.costUSD) : "—")}
      ${row("Değer", pos.mvTRY != null ? fmtTRY0(pos.mvTRY) : "—")}
      ${row("K/Z", pos.profitTRY != null ? `${fmtTRY0(pos.profitTRY)} <span class="muted">${fmtPct(pos.profitPct)}</span>` : "—", pos.profitTRY != null ? cls(pos.profitTRY) : "")}
      ${pos.guard ? row("İz süren stop", `${fmtUSD(pos.guard.stop)} <span class="muted">${pos.guard.breached ? "İHLAL — çık!" : "−%" + pos.guard.distPct.toFixed(1) + " mesafe"}</span>`, pos.guard.breached ? "neg" : "") : ""}
      ${pos.guard?.target != null ? row("Plan hedef", fmtUSD(pos.guard.target), pos.guard.targetHit ? "pos" : "") : ""}
      ${pos.earnings ? row("Bilanço", `${fmtDate(pos.earnings.date)} <span class="muted">${pos.earnings.daysLeft === 0 ? "bugün" : pos.earnings.daysLeft + " gün"}${pos.earnings.hour === "bmo" ? " · açılış öncesi" : pos.earnings.hour === "amc" ? " · kapanış sonrası" : ""}</span>`, pos.earnings.daysLeft <= 7 ? "neg" : "") : ""}
    </div>` : "";
  const pat = d.patterns?.pattern || null;
  const patTone = ({ bull: "good", bear: "bad", neutral: "warn" })[pat?.tone] || "warn";
  const wk = d.weekly || null;
  const wkChip = wk ? `<span class="chip wk-${wk.tone}">📅 Haftalık ${WK_ARROW[wk.dir] || ""}</span>` : "";
  const whyHTML = (d.why || []).map((w) => `<li class="s-${w.tone}">${w.text}</li>`).join("");
  // Horizon'a göre lens sırası: uzun-vade pozisyonu → biriktirme önce; aksi halde swing önce
  const swingHTML = qmChartPanel(d.qm);
  const ltHTML = longtermPanel(pl.longterm);
  const horizonChip = pos?.horizon
    ? `<span class="chip ${pos.horizon === "swing" ? "hz-swing" : "hz-long"}">${pos.horizon === "swing" ? "⚡ Swing pozisyonu" : "🌱 Uzun vade pozisyonu"}</span>` : "";
  const lensHTML = pos?.horizon === "long" ? ltHTML + swingHTML : swingHTML + ltHTML;
  // Stats kartı (görseldeki gibi): Market Cap · ADR% · RS Rating · 52h aralık · sektör
  const st2 = d.stats || {};
  const rsCls2 = st2.rsRating == null ? "" : st2.rsRating >= 80 ? "pos" : st2.rsRating >= 50 ? "warn" : "neg";
  const statsCard = (st2.marketCap != null || st2.adrPct != null || st2.rsRating != null || st2.industry) ? `
    <div class="cm-stats-card">
      <div class="cm-stats-head">${d.symbol}${st2.exchange ? ` · ${st2.exchange}` : ""}</div>
      <div class="cm-stats-grid">
        ${st2.marketCap != null ? `<div class="cs2"><span>Market Cap</span><b>${fmtMktCap(st2.marketCap)}</b></div>` : ""}
        ${st2.adrPct != null ? `<div class="cs2"><span>ADR%</span><b class="${st2.adrPct >= 4 ? "pos" : ""}">${st2.adrPct.toFixed(2)}%</b></div>` : ""}
        ${st2.rsRating != null ? `<div class="cs2"><span>RS Rating</span><b class="${rsCls2}">${st2.rsRating}</b></div>` : ""}
        ${st2.dollarVol != null ? `<div class="cs2"><span>$ Hacim</span><b>${fmtMktCap(st2.dollarVol)}</b></div>` : ""}
        ${(st2.w52High != null && st2.w52Low != null) ? `<div class="cs2"><span>52h Aralık</span><b>${fmtUSD(st2.w52Low)} – ${fmtUSD(st2.w52High)}</b></div>` : ""}
        ${st2.fromHighPct != null ? `<div class="cs2"><span>Zirveden</span><b class="${st2.fromHighPct >= -10 ? "pos" : "neg"}">${st2.fromHighPct.toFixed(1)}%</b></div>` : ""}
      </div>
      ${st2.industry ? `<div class="cm-stats-ind">${st2.industry}</div>` : ""}
    </div>` : "";
  sideEl.innerHTML = `
    ${cmHeroLevels(d, pos, pl)}
    ${statsCard}
    ${posCard}
    <div class="cm-ctx">
      <div class="cm-grade ${GRADE_CLS[pl.grade] || "g-d"}" title="Teknik kalite notu (A–D)">${pl.grade || "—"}</div>
      <div class="cm-setup">${horizonChip}<span class="sw-trend">${pl.trend || "—"}</span>${pat ? `<span class="chip pat-${patTone}">📐 ${pat.label} ~%${pat.confidence}</span>` : ""}${wkChip}</div>
    </div>
    ${lensHTML}
    <div class="cm-sec">Teknik göstergeler</div>
    <div class="cm-sigs">${sigRows || '<span class="muted">—</span>'}</div>
    <div class="cm-key">
      ${keyCell("Fiyat", fmtUSD(pl.currentPrice ?? d.price))}
      ${keyCell("ATR (14)", ind.atr != null ? fmtUSD(ind.atr) : "—")}
      ${keyCell("SMA 20·50·200", `${ind.sma20 != null ? Math.round(ind.sma20) : "—"}·${ind.sma50 != null ? Math.round(ind.sma50) : "—"}·${ind.sma200 != null ? Math.round(ind.sma200) : "—"}`)}
      ${(d.ema8?.length && d.ema21?.length) ? (() => { const e8 = d.ema8[d.ema8.length - 1].value, e21 = d.ema21[d.ema21.length - 1].value, bull = e8 >= e21; return keyCell("EMA 8/21", `${Math.round(e8)}·${Math.round(e21)} <span class="${bull ? "pos" : "neg"}">${bull ? "▲" : "▼"}</span>`); })() : ""}
    </div>
    <div class="cm-disc">Otomatik teknik analiz · yatırım tavsiyesi değildir (Kural 1).</div>
  `;

  legEl.innerHTML = `
    <span class="lg"><i style="background:#0a8f6e"></i> Swing Giriş</span>
    <span class="lg"><i style="background:#b8281f"></i> Swing Stop</span>
    <span class="lg"><i style="background:#1f7a48"></i> Hedef 2R/3R</span>
    <span class="lg"><i style="background:#7fae8e"></i> Biriktir (uzun vade)</span>
    <span class="lg"><i style="background:#56b1d6"></i> SMA20</span>
    <span class="lg"><i style="background:#d9a92b"></i> SMA50</span>
    <span class="lg"><i style="background:#6b5fd0"></i> SMA200</span>
    <span class="lg"><i style="background:#0ea5a0"></i> EMA8</span>
    <span class="lg"><i style="background:#f59e0b"></i> EMA21</span>
    <span class="lg"><i style="background:rgba(16,185,129,.45)"></i> EMA Bulutu</span>
    <span class="lg"><i style="background:#c98a3a"></i> Direnç</span>
    <span class="lg"><i style="background:#9aa7a0"></i> Destek</span>
    <span class="lg"><i style="background:#7c6cf0"></i> Maliyet</span>`;
}

async function addWatch() {
  const inp = $("#watchInput");
  const sym = (inp.value || "").trim().toUpperCase();
  if (!sym) return;
  inp.value = "";
  try {
    await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: sym }),
    });
    await load();
  } catch {}
}

async function delWatch(sym) {
  try {
    await fetch(`/api/watchlist/${encodeURIComponent(sym)}`, { method: "DELETE" });
    await load();
  } catch {}
}

/* ---------------- Tablo: hisse / fon — sıralanabilir başlıklar ---------------- */
// Her grup için (stock/fund) aktif sıralama durumu: { key, dir }
const sortState = {};

// Sıralanabilir sütunlar ve karşılaştırılacak değerleri
const SORT_COLS = [
  { key: "symbol", label: "Sembol", cls: "l", get: (h) => h.symbol || "" },
  { key: "name",   label: "Ad",     cls: "l", get: (h) => h.name || "" },
  { key: "price",  label: "Fiyat",  cls: "",  get: (h) => (h.type === "stock" ? h.live?.priceUSD : h.live?.priceTRY) },
  { key: "spark",  label: "30 Gün", cls: "spark-col", get: (h) => { const s = h.spark; return s && s.length > 1 && s[0] ? ((s[s.length - 1] - s[0]) / s[0]) * 100 : null; } },
  { key: "qty",    label: "Adet",   cls: "",  get: (h) => h.quantity },
  { key: "cost",   label: "Maliyet", cls: "", get: (h) => costOf(h) },
  { key: "mv",     label: "Piyasa Değeri", cls: "", get: (h) => h.live?.marketValueTRY },
  { key: "profit", label: "Getiri", cls: "",  get: (h) => { const mv = h.live?.marketValueTRY; return mv != null ? mv - costOf(h) : null; } },
  { key: "pct",    label: "%",      cls: "",  get: (h) => {
    // Hisse → dolar getirisi (tabloda gösterilen %'yle aynı); fon → TRY
    if (h.type === "stock" && h.costUSD != null && h.live?.marketValueUSD != null) {
      const c = h.costUSD * h.quantity; return c ? ((h.live.marketValueUSD - c) / c) * 100 : null;
    }
    const mv = h.live?.marketValueTRY; if (mv == null) return null; const c = costOf(h); return c ? ((mv - c) / c) * 100 : null;
  } },
  { key: "realized", label: "Realize K/Z", cls: "", get: (h) => REALIZED_USD[String(h.symbol).toUpperCase()] ?? null },
];

function sortRows(rows, groupKey) {
  const st = sortState[groupKey];
  const col = st && SORT_COLS.find((c) => c.key === st.key);
  if (!col) return rows;
  const dir = st.dir === "asc" ? 1 : -1;
  const isNull = (v) => v == null || (typeof v === "number" && !isFinite(v));
  return [...rows].sort((a, b) => {
    const va = col.get(a), vb = col.get(b);
    if (isNull(va) && isNull(vb)) return 0;
    if (isNull(va)) return 1;   // boş değerler her zaman en altta
    if (isNull(vb)) return -1;
    if (typeof va === "string" || typeof vb === "string") {
      return String(va).localeCompare(String(vb), "tr") * dir;
    }
    return (va - vb) * dir;
  });
}

function sortableHead(groupKey) {
  const st = sortState[groupKey] || {};
  return SORT_COLS.map((c) => {
    const active = st.key === c.key;
    const arrow = active ? (st.dir === "asc" ? " ▲" : " ▼") : "";
    return `<th class="${c.cls} sortable${active ? " active" : ""}" data-sort="${c.key}" data-group="${groupKey}">${c.label}${arrow}</th>`;
  }).join("") + (groupKey === "stock" ? `<th title="Ana paranın geri alınma oranı + sıfır maliyet için kalan adet">Sıfır Maliyet</th>` : "") + "<th></th>";
}

/* ---------------- Tablo: hisse / fon ---------------- */
function renderGroup(title, rows, groupKey, horizon = "long") {
  rows = sortRows(rows, groupKey);
  const fx = STATE.fx || {};
  const isStockGroup = groupKey === "stock"; // hisseler USD-native → USD göster
  const money = isStockGroup ? fmtUSD : fmtTRY;
  const usdtry = fx.usdtry;
  let sumCost = 0, sumMv = 0, sumReal = 0;
  const body = rows.map((h) => {
    const live = h.live || {};
    const cost = costOf(h);
    const mv = live.marketValueTRY;
    const profit = mv != null ? mv - cost : null;
    // USD-öncelikli gösterim değerleri (hisse); fon/diğer TRY kalır
    const costShow = isStockGroup ? (h.costUSD != null ? h.costUSD * h.quantity : (usdtry ? cost / usdtry : cost)) : cost;
    const mvShow = isStockGroup ? (live.marketValueUSD ?? (usdtry && mv != null ? mv / usdtry : mv)) : mv;
    const profitShow = mvShow != null && costShow != null ? mvShow - costShow : null;
    // % gösterim para birimiyle TUTARLI: hisse → dolar getirisi (Getiri $ ve Toplam ile aynı), fon → TRY
    const profitPct = costShow && profitShow != null ? (profitShow / costShow) * 100 : null;
    sumCost += costShow || 0; if (mvShow) sumMv += mvShow;

    const priceCell = h.type === "stock"
      ? `${fmtUSD(live.priceUSD)}${live.dayChangePct != null ? ` <span class="chip ${cls(live.dayChangePct)}">${fmtPct(live.dayChangePct)}</span>` : ""}`
      : `${fmtTRY(live.priceTRY)}${live.dayChangePct != null ? ` <span class="chip ${cls(live.dayChangePct)}">${fmtPct(live.dayChangePct)}</span>` : ""}`;

    const tradeBtn = h.type === "stock"
      ? `<button class="btn icon" data-trade="${h.symbol}" title="İşlem / Realize kâr">📈</button>` : "";

    const sig = h.sig;
    const sigTitle = sig ? (sig.summary || sig.signal?.label || "").replace(/"/g, "'") : "";
    const sigBadge = sig?.signal
      ? `<span class="sig-dot sig-${sig.signal.tone}${sig.stale ? " sig-stale" : ""}" title="${sigTitle}" aria-label="${sig.signal.label}"></span>`
      : "";
    const ptChip = sig?.profitTake
      ? `<span class="pt-chip pt-${sig.profitTake.level}" title="${sig.profitTake.text}">✂️ ${sig.profitTake.trim}</span>`
      : "";
    // Pozisyon Bekçisi: iz süren stop durumu (her zaman mesafeyi göster)
    const g = h.guard;
    const guardChip = !g ? "" : g.breached
      ? `<span class="gd-chip gd-stop" title="İz süren stop ${fmtUSD(g.stop)} altına indi — çıkış/azaltma planını uygula">🛑 stop!</span>`
      : g.targetHit
        ? `<span class="gd-chip gd-tgt" title="Hedef ${fmtUSD(g.target)} aşıldı — kâr-al planını uygula">🎯 hedef</span>`
        : g.near
          ? `<span class="gd-chip gd-near" title="İz süren stop ${fmtUSD(g.stop)} (3×ATR) — fiyata %${g.distPct.toFixed(1)} mesafe">⚠️ stopa %${g.distPct.toFixed(1)}</span>`
          : g.distPct != null
            ? `<span class="gd-chip gd-ok" title="İz süren stop ${fmtUSD(g.stop)} (3×ATR) — fiyata %${g.distPct.toFixed(1)} mesafe">🛡 %${g.distPct.toFixed(0)}</span>`
            : "";
    // Bilanço Nöbetçisi: yaklaşan bilanço (≤7 gün)
    const e = h.earnings;
    const earnChip = e && e.daysLeft <= 7
      ? `<span class="gd-chip gd-earn${e.daysLeft <= 2 ? " gd-earn-hot" : ""}" title="Bilanço ${fmtDate(e.date)}${e.hour === "bmo" ? " · açılış öncesi" : e.hour === "amc" ? " · kapanış sonrası" : ""} — gecelik gap riskine karşı pozisyonu gözden geçir">🗓️ ${e.daysLeft === 0 ? "bugün" : e.daysLeft + "g"}</span>`
      : "";

    // Swing rozeti: bu pozisyonun bir kısmı/tamamı Swing Defteri'nde takip ediliyorsa
    const sw = (STATE.swingOpen || {})[String(h.symbol).toUpperCase()];
    const swingChip = h.type === "stock" && sw
      ? `<span class="sw-hold-chip" data-view-swing="1" title="Bu pozisyonun ${fmtNum(sw.qty, 2)} adedi Swing Defteri'nde takip ediliyor — tıkla">📈 swing ${fmtNum(sw.qty, 2)}</span>`
      : "";
    // Sıfır-maliyet rozeti: ana para geri alındıysa 🎁 bedava, yarıyı geçtiyse geri-alım %
    const fr = h.type === "stock" ? freeRollOf(h) : null;
    const freeChip = !fr ? "" : fr.free
      ? `<span class="gr-hold-chip free" data-view-growth="1" title="Ana paranı geri aldın — bu pozisyon bedava biniyor (Büyüme sekmesi)">🎁 bedava</span>`
      : fr.recovered != null && fr.recovered >= 50
        ? `<span class="gr-hold-chip" data-view-growth="1" title="Ana paranın %${fr.recovered.toFixed(0)}'ini geri aldın — Büyüme sekmesi">🎁 %${fr.recovered.toFixed(0)}</span>`
        : "";
    const symCell = h.type === "stock"
      ? `<span class="sym sym-link" data-pos="${h.id}" title="Pozisyon detayı + grafik">${h.symbol}</span>`
      : `<span class="sym">${h.symbol}</span>`;
    // Realize edilen K/Z (bu sembol) — yalnızca satışlar
    const realUSD = REALIZED_USD[String(h.symbol).toUpperCase()];
    sumReal += realUSD || 0;
    const realCell = realUSD != null
      ? `<span class="${cls(realUSD)}">${fmtUSD(realUSD)}</span>`
      : `<span class="muted">—</span>`;
    // Sıfır-maliyet sütunu (yalnızca hisse): geri-alım % + sıfır maliyet için kalan adet
    const frCell = !fr ? `<span class="muted">—</span>`
      : fr.free
        ? `<div class="zc-cell"><div class="zc-bar"><div class="zc-fill done" style="width:100%"></div></div><span class="zc-tag free">🎁 bedava</span></div>`
        : fr.costBasis
          ? `<div class="zc-cell"><div class="zc-bar"><div class="zc-fill" style="width:${Math.min(100, fr.recovered || 0).toFixed(0)}%"></div></div><span class="zc-tag">%${(fr.recovered || 0).toFixed(0)}${fr.sellShares != null ? ` · ${fmtNum(fr.sellShares, 1)} adet` : ""}</span></div>`
          : `<span class="muted">—</span>`;
    return `<tr>
      <td class="l">${symCell} ${sigBadge}</td>
      <td class="l nm">${h.name || ""} ${ptChip}${guardChip}${earnChip}${swingChip}${freeChip}</td>
      <td>${h.error ? `<span class="err">veri yok</span>` : priceCell}</td>
      <td class="spark-col">${h.type === "stock" ? sparklineSVG(h.spark) : `<span class="spark-na">—</span>`}</td>
      <td>${fmtNum(h.quantity, 6)}</td>
      <td>${money(costShow)}</td>
      <td>${mvShow != null ? money(mvShow) : "—"}</td>
      <td class="${profitShow != null ? cls(profitShow) : ""}">${profitShow != null ? money(profitShow) : "—"}</td>
      <td class="${profitPct != null ? cls(profitPct) : ""}">${fmtPct(profitPct)}</td>
      <td>${realCell}</td>
      ${isStockGroup ? `<td class="zc-col">${frCell}</td>` : ""}
      <td><div class="row-actions">
        ${tradeBtn}
        <button class="btn icon" data-edit="${h.id}" title="Düzenle">✎</button>
        <button class="btn icon" data-del="${h.id}" title="Sil">🗑</button>
      </div></td>
    </tr>`;
  }).join("");

  const tProfit = sumMv - sumCost;
  return `<div class="group${groupKey === "stock" && horizon === "swing" ? " group-swing" : ""}">
    <div class="group-title"><span class="dot"></span>${title} <span class="cnt">· ${rows.length} kalem</span></div>
    <div class="tbl-wrap"><table>
      <thead><tr>${sortableHead(groupKey)}</tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td class="l" colspan="5">Toplam</td>
        <td>${money(sumCost)}</td><td>${money(sumMv)}</td>
        <td class="${cls(tProfit)}">${money(tProfit)}</td>
        <td class="${cls(tProfit)}">${fmtPct(sumCost ? (tProfit / sumCost) * 100 : 0)}</td>
        <td>${sumReal ? `<span class="${cls(sumReal)}">${fmtUSD(sumReal)}</span>` : ""}</td>
        ${isStockGroup ? "<td></td>" : ""}<td></td>
      </tr></tfoot>
    </table></div>
  </div>`;
}

/* ---- Tablo: Swing pozisyonları (Swing Defteri açık işlemleri) ----
 * Holding'lerden BAĞIMSIZ ayrı tablo: Swing Defteri'ne eklenen pozisyon doğrudan buraya gelir.
 * Sembol/giriş/stop/hedef + canlı fiyat/K/Z. */
/* Swing çıkış disiplini hücresi (Faz 1): iz süren stop · R · zaman-stop · MA */
function swDisciplineCell(p) {
  const bits = [];
  const g = p.guard;
  if (g) {
    if (g.breached) bits.push(`<span class="sw-d bad" title="İz süren stop ${fmtUSD(g.stop)} altında — çık, 'belki döner' deme">🛑 stop ${fmtUSD(g.stop)}</span>`);
    else if (g.near) bits.push(`<span class="sw-d warn" title="İz süren stopa %${g.distPct} kaldı (${fmtUSD(g.stop)}) — kırılırsa çık">⚠️ stopa %${g.distPct}</span>`);
    else bits.push(`<span class="sw-d ok" title="Chandelier iz süren stop: 22g zirve − 3×ATR. Bu seviyenin altına kapanış = çıkış.">stop ${fmtUSD(g.stop)} · %${g.distPct}</span>`);
  } else if (p.stop != null) {
    bits.push(`<span class="sw-d muted">stop ${fmtUSD(p.stop)}</span>`);
  } else {
    bits.push(`<span class="sw-d muted" title="Stop yok = plan yok. Düzenle ile stop gir.">stop yok</span>`);
  }
  if (p.currentR != null) {
    const rc = p.currentR >= 2 ? "good" : p.currentR >= 1 ? "ok" : p.currentR <= -0.5 ? "bad" : "warn";
    const rTip = p.currentR >= 2 ? "≥2R: yarısını sat, stop'u girişe çek (breakeven), kalanı 20MA ile sürükle"
      : p.currentR >= 1 ? "≥1R: stop'u en az girişe (breakeven) çekmeyi düşün"
      : "1R altı: plana göre stopta kal, ekleme yapma";
    bits.push(`<span class="sw-d ${rc}" title="${rTip}">${p.currentR >= 0 ? "+" : ""}${p.currentR.toFixed(1)}R</span>`);
  }
  if (p.timeStop) bits.push(`<span class="sw-d warn" title="≥7 gün açık ama <1R ilerleme — kurulum çalışmadı, zaman-stop'u değerlendir (Qullamaggie: kırılım çalışmazsa hızlı çık)">⏳ zaman-stop</span>`);
  else if (p.belowMa10 && p.belowMa20) bits.push(`<span class="sw-d warn" title="Fiyat 10 & 20 günlük ortalama altında — momentum kırıldı">↓ MA10/20 altı</span>`);
  else if (p.belowMa10) bits.push(`<span class="sw-d warn" title="Fiyat 10 günlük ortalama altında — agresif çıkış sinyali">↓ MA10 altı</span>`);
  return `<div class="sw-disc">${bits.join("")}</div>`;
}

function renderSwingGroup(positions) {
  if (!positions || !positions.length) return "";
  // Aynı sembolden çoklu swing → TEK satır (ağırlıklı ortalama giriş/stop/hedef, toplam adet/maliyet/değer)
  const bySym = {};
  for (const p of positions) {
    const g = bySym[p.symbol] || (bySym[p.symbol] = {
      symbol: p.symbol, name: p.name, ids: [], count: 0,
      qty: 0, entryW: 0, stopW: 0, stopQty: 0, tgtW: 0, tgtQty: 0,
      costUSD: 0, valueUSD: 0, plUSD: 0, hasVal: false,
      price: p.price, dayChangePct: p.dayChangePct,
      guard: null, currentR: p.currentR, mfeR: p.mfeR, maeR: p.maeR,
      timeStop: false, belowMa10: false, belowMa20: false, daysOpen: p.daysOpen,
    });
    g.ids.push(p.id); g.count++;
    g.qty += p.qty; g.entryW += p.entry * p.qty;
    if (p.stop != null) { g.stopW += p.stop * p.qty; g.stopQty += p.qty; }
    if (p.target != null) { g.tgtW += p.target * p.qty; g.tgtQty += p.qty; }
    g.costUSD += p.costUSD || 0;
    if (p.valueUSD != null) { g.valueUSD += p.valueUSD; g.plUSD += (p.plUSD || 0); g.hasVal = true; }
    if (p.name) g.name = p.name;
    if (p.price != null) { g.price = p.price; g.dayChangePct = p.dayChangePct; }
    // Çıkış disiplini (Faz 1): en kötü durumu yansıt (ihlal > near), R/MA/zaman-stop taşı
    if (p.guard && (!g.guard || (p.guard.breached && !g.guard.breached) || (p.guard.near && !g.guard.near && !g.guard.breached))) g.guard = p.guard;
    if (p.currentR != null) g.currentR = p.currentR;
    if (p.mfeR != null) g.mfeR = p.mfeR;
    if (p.maeR != null) g.maeR = p.maeR;
    if (p.daysOpen != null) g.daysOpen = p.daysOpen;
    if (p.timeStop) g.timeStop = true;
    if (p.belowMa10) g.belowMa10 = true;
    if (p.belowMa20) g.belowMa20 = true;
  }
  const merged = Object.values(bySym).map((g) => ({
    symbol: g.symbol, name: g.name, count: g.count, ids: g.ids,
    qty: g.qty, entry: g.qty ? g.entryW / g.qty : 0,
    stop: g.stopQty ? g.stopW / g.stopQty : null, target: g.tgtQty ? g.tgtW / g.tgtQty : null,
    price: g.price, dayChangePct: g.dayChangePct,
    costUSD: g.costUSD, valueUSD: g.hasVal ? g.valueUSD : null,
    plUSD: g.hasVal ? g.plUSD : null, plPct: g.hasVal && g.costUSD ? (g.plUSD / g.costUSD) * 100 : null,
    guard: g.guard, currentR: g.currentR, mfeR: g.mfeR, maeR: g.maeR,
    timeStop: g.timeStop, belowMa10: g.belowMa10, belowMa20: g.belowMa20, daysOpen: g.daysOpen,
  })).sort((a, b) => (b.valueUSD ?? b.costUSD) - (a.valueUSD ?? a.costUSD));
  let sCost = 0, sVal = 0;
  const body = merged.map((p) => {
    if (p.valueUSD != null) { sCost += p.costUSD || 0; sVal += p.valueUSD; } // canlı fiyatı olanlar (apples-to-apples)
    const priceCell = p.price != null
      ? `${fmtUSD(p.price)}${p.dayChangePct != null ? ` <span class="chip ${cls(p.dayChangePct)}">${fmtPct(p.dayChangePct)}</span>` : ""}`
      : `<span class="muted">—</span>`;
    const mergeBadge = p.count > 1 ? ` <span class="sw-merge" title="${p.count} swing birleşik · ağırlıklı ort.">×${p.count}</span>` : "";
    const editBtn = p.count > 1
      ? `<button class="btn icon" data-swdeck="1" title="${p.count} swing — Swing Defteri'nde gör">✎</button>`
      : `<button class="btn icon" data-swedit="${p.ids[0]}" title="Swing Defteri'nde düzenle">✎</button>`;
    return `<tr>
      <td class="l"><span class="sym sym-link" data-swpos="${p.symbol}" title="Grafik + analiz">${p.symbol}</span>${mergeBadge}</td>
      <td class="l nm">${p.name || ""}</td>
      <td>${priceCell}</td>
      <td>${fmtUSD(p.entry)}</td>
      <td>${p.stop != null ? `<span class="neg">${fmtUSD(p.stop)}</span>` : `<span class="muted">stop yok</span>`}</td>
      <td>${p.target != null ? `<span class="pos">${fmtUSD(p.target)}</span>` : `<span class="muted">hedef yok</span>`}</td>
      <td>${fmtNum(p.qty, 6)}</td>
      <td>${fmtUSD(p.costUSD)}</td>
      <td>${p.valueUSD != null ? fmtUSD(p.valueUSD) : "—"}</td>
      <td class="${p.plUSD != null ? cls(p.plUSD) : ""}">${p.plUSD != null ? fmtUSD(p.plUSD) : "—"}</td>
      <td class="${p.plPct != null ? cls(p.plPct) : ""}">${fmtPct(p.plPct)}</td>
      <td>${swDisciplineCell(p)}</td>
      <td><div class="row-actions">${editBtn}</div></td>
    </tr>`;
  }).join("");
  const tPl = sVal - sCost;
  return `<div class="group group-swing">
    <div class="group-title"><span class="dot"></span>⚡ ABD — Swing (stop / hedef) <span class="cnt">· ${merged.length} sembol${positions.length !== merged.length ? ` (${positions.length} işlem)` : ""} · Swing Defteri</span></div>
    <div class="tbl-wrap"><table>
      <thead><tr>
        <th class="l">Sembol</th><th class="l">Ad</th><th>Fiyat</th><th>Giriş</th><th>Stop</th><th>Hedef</th>
        <th>Adet</th><th>Maliyet</th><th>Değer</th><th>K/Z</th><th>%</th><th>Durum (iz süren stop · R)</th><th></th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td class="l" colspan="7">Toplam</td>
        <td>${fmtUSD(sCost)}</td><td>${fmtUSD(sVal)}</td>
        <td class="${cls(tPl)}">${fmtUSD(tPl)}</td>
        <td class="${cls(sCost ? (tPl / sCost) * 100 : 0)}">${fmtPct(sCost ? (tPl / sCost) * 100 : 0)}</td><td></td><td></td>
      </tr></tfoot>
    </table></div>
  </div>`;
}

/* ---------------- Tablo: opsiyonlar (manuel prim) ---------------- */
function renderOptionsGroup(rows) {
  const head = `<div class="group-title">
      <span class="dot opt"></span>Opsiyonlar (ABD)
      <span class="cnt">· ${rows.length} pozisyon · toplama dahil</span>
    </div>`;

  if (!rows.length) {
    return `<div class="group opt-group">${head}
      <div class="empty-opt">Henüz opsiyon yok. Üstteki <b>+ Opsiyon Ekle</b> ile ekleyebilirsin.</div>
    </div>`;
  }

  let sCost = 0, sVal = 0, sPl = 0;
  const body = rows.map((o) => {
    const dirChip = o.direction === "short"
      ? `<span class="chip neg">SHORT</span>` : `<span class="chip pos">LONG</span>`;
    const kindChip = `<span class="chip ${o.kind === "call" ? "pos" : "neg"}">${o.kind.toUpperCase()}</span>`;
    const dte = o.dte;
    const dteTxt = dte == null ? "—"
      : dte < 0 ? `<span class="err">vade geçti</span>`
      : dte <= 7 ? `<span class="chip neg">${dte}g</span>`
      : `<span class="muted">${dte}g</span>`;
    const hasCur = o.currentPremium != null;
    sCost += o.costUSD || 0;
    if (o.valueUSD != null) sVal += o.valueUSD;
    if (o.plUSD != null) sPl += o.plUSD;

    const MULT = 100;
    const autoBadge = o.premiumSource === "oto" ? ` <span class="chip auto" title="Yahoo zincirinden otomatik">oto</span>` : "";
    const curCell = hasCur ? `${fmtUSD(o.currentPremium)}${autoBadge}` : `<span class="muted">gir →</span>`;
    const beDist = o.pctToBreakeven != null
      ? ` <span class="muted">(BE'ye ${o.pctToBreakeven >= 0 ? "+" : ""}${o.pctToBreakeven.toFixed(1)}%)</span>` : "";
    const mp = o.maxProfitInf ? `<b class="pos">sınırsız</b>` : (o.maxProfit != null ? `<b class="pos">${fmtUSD(o.maxProfit * o.contracts * MULT)}</b>` : "—");
    const ml = o.maxLossInf ? `<b class="neg">sınırsız</b>` : (o.maxLoss != null ? `<b class="neg">${fmtUSD(o.maxLoss * o.contracts * MULT)}</b>` : "—");
    const moneyChip = o.moneyness
      ? `<span class="chip ${o.moneyness === "ITM" ? "pos" : o.moneyness === "OTM" ? "neg" : ""}">${o.moneyness}</span>` : "";

    return `<tr>
      <td class="l"><span class="sym">${o.underlying}</span></td>
      <td class="l">${kindChip} ${dirChip}</td>
      <td>${fmtUSD(o.strike)}</td>
      <td class="l">${fmtDate(o.expiry)} ${dteTxt}</td>
      <td>${fmtNum(o.contracts, 2)}</td>
      <td>${fmtUSD(o.premiumPaid)}</td>
      <td>${curCell}</td>
      <td>${fmtUSD(o.costUSD)}</td>
      <td>${o.valueUSD != null ? fmtUSD(o.valueUSD) : "—"}</td>
      <td class="${o.plUSD != null ? cls(o.plUSD) : ""}">${o.plUSD != null ? fmtUSD(o.plUSD) : "—"}</td>
      <td class="${o.plPct != null ? cls(o.plPct) : ""}">${fmtPct(o.plPct)}</td>
      <td><div class="row-actions">
        <button class="btn icon" data-opt-edit="${o.id}" title="Düzenle / prim güncelle">✎</button>
        <button class="btn icon" data-opt-del="${o.id}" title="Sil">🗑</button>
      </div></td>
    </tr>
    <tr class="opt-detail"><td colspan="12">
      ${moneyChip}
      <span>Breakeven <b>${o.breakeven != null ? fmtUSD(o.breakeven) : "—"}</b>${beDist}</span>
      <span class="sep">·</span><span>Max kâr ${mp}</span>
      <span class="sep">·</span><span>Max zarar ${ml}</span>
      ${o.underlyingPrice ? `<span class="sep">·</span><span class="muted">dayanak ${fmtUSD(o.underlyingPrice)}</span>` : ""}
    </td></tr>`;
  }).join("");

  return `<div class="group opt-group">${head}
    <div class="tbl-wrap"><table>
      <thead><tr>
        <th class="l">Dayanak</th><th class="l">Tür</th><th>Strike $</th>
        <th class="l">Vade</th><th>Kontrat</th><th>Giriş $</th><th>Güncel $</th>
        <th>Maliyet $</th><th>Değer $</th><th>K/Z $</th><th>%</th><th></th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td class="l" colspan="7">Toplam</td>
        <td>${fmtUSD(sCost)}</td><td>${fmtUSD(sVal)}</td>
        <td class="${cls(sPl)}">${fmtUSD(sPl)}</td>
        <td class="${cls(sPl)}">${fmtPct(sCost ? (sPl / sCost) * 100 : 0)}</td><td></td>
      </tr></tfoot>
    </table></div>
  </div>`;
}

/* ---------------- Tablo: altın (görseldeki düzen) ---------------- */
function renderGoldGroup(rows) {
  const usdtry = STATE.fx.usdtry;
  let sCost = 0, sMv = 0, sCostUSD = 0, sMvUSD = 0;
  const body = rows.map((h) => {
    const live = h.live || {};
    const paid = h.costTRY || 0;
    const mv = live.marketValueTRY;
    const gainPct = paid && mv != null ? ((mv - paid) / paid) * 100 : null;
    const paidUSD = h.costUSD || (usdtry ? paid / usdtry : null);
    const mvUSD = live.marketValueUSD;
    const gainPctUSD = paidUSD && mvUSD != null ? ((mvUSD - paidUSD) / paidUSD) * 100 : null;
    sCost += paid; if (mv) sMv += mv;
    if (paidUSD) sCostUSD += paidUSD; if (mvUSD) sMvUSD += mvUSD;

    return `<tr>
      <td>${fmtTRY(paid)}</td>
      <td>${mv != null ? fmtTRY(mv) : "—"}</td>
      <td class="${gainPct != null ? cls(gainPct) : ""}">${fmtPct(gainPct)}</td>
      <td><span class="ayar">${h.ayar || 24}</span></td>
      <td class="gold-gram">${fmtNum(h.quantity, 2)} Gram</td>
      <td>${fmtUSD(paidUSD)}</td>
      <td>${mvUSD != null ? fmtUSD(mvUSD) : "—"}</td>
      <td class="${gainPctUSD != null ? cls(gainPctUSD) : ""}">${fmtPct(gainPctUSD)}</td>
      <td class="l gold-date">${fmtDate(h.purchaseDate)}</td>
      <td><div class="row-actions">
        <button class="btn icon" data-edit="${h.id}" title="Düzenle">✎</button>
        <button class="btn icon" data-del="${h.id}" title="Sil">🗑</button>
      </div></td>
    </tr>`;
  }).join("");

  const tGain = sMv - sCost, tGainUSD = sMvUSD - sCostUSD;
  return `<div class="group gold-group">
    <div class="group-title"><span class="dot gold"></span>Altın <span class="cnt">· ${rows.length} alım</span></div>
    <div class="tbl-wrap"><table class="gold-table">
      <thead><tr>
        <th>Ödenen Tutar</th><th>Şuanki Karşılığı</th><th>%lik kazanç</th>
        <th>Ayar</th><th>Gram Altın</th>
        <th>Alındığı Zamanki<br>Dolar Karşılığı</th><th>Şuanki<br>Dolar Karşılığı</th>
        <th>%lik kazanç<br>$ bazında</th><th class="l">Alındığı Tarih</th><th></th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td>${fmtTRY(sCost)}</td><td>${fmtTRY(sMv)}</td>
        <td class="${cls(tGain)}">${fmtPct(sCost ? (tGain / sCost) * 100 : 0)}</td>
        <td></td><td>${fmtNum(rows.reduce((s, h) => s + h.quantity, 0), 2)} Gram</td>
        <td>${fmtUSD(sCostUSD)}</td><td>${fmtUSD(sMvUSD)}</td>
        <td class="${cls(tGainUSD)}">${fmtPct(sCostUSD ? (tGainUSD / sCostUSD) * 100 : 0)}</td>
        <td></td><td></td>
      </tr></tfoot>
    </table></div>
  </div>`;
}

/* ---------------- Modal: varlık ---------------- */
const modalBg = $("#modalBg");
const form = $("#holdingForm");

function toggleFields() {
  const t = $("#typeSel").value;
  $("#costUsdLabel").style.display = t === "stock" ? "" : "none";
  $("#planStopLabel").style.display = t === "stock" ? "" : "none";
  $("#planTargetLabel").style.display = t === "stock" ? "" : "none";
  $("#ayarLabel").style.display = t === "gold" ? "" : "none";
  $("#dateLabel").style.display = t === "gold" ? "" : "none";
  $("#qtyLabel").firstChild.textContent = t === "gold" ? "Miktar (gram) " : "Adet / Miktar ";
  // Tür pilleri aktif durumu
  document.querySelectorAll("#typePills .type-pill").forEach((p) => p.classList.toggle("active", p.dataset.type === t));
  // Vade pilleri (uzun/swing) yalnızca hissede
  const hzWrap = $("#hzPills");
  if (hzWrap) {
    hzWrap.style.display = t === "stock" ? "" : "none";
    const hz = $("#hzSel")?.value || "long";
    hzWrap.querySelectorAll(".hz-pill").forEach((p) => p.classList.toggle("active", p.dataset.hz === hz));
  }
  // Altın için alındığı tarih önemli → gelişmiş alanı aç
  const adv = $("#advFields");
  if (adv && t === "gold") adv.open = true;
}
// Vade seçimi: pill'ler (gizli #hzSel'i sürer); swing seçilince stop/hedef alanını aç
$("#hzPills")?.addEventListener("click", (e) => {
  const p = e.target.closest(".hz-pill");
  if (!p) return;
  $("#hzSel").value = p.dataset.hz;
  $("#hzPills").querySelectorAll(".hz-pill").forEach((x) => x.classList.toggle("active", x === p));
  if (p.dataset.hz === "swing") { const adv = $("#advFields"); if (adv) adv.open = true; }
});
$("#typeSel").addEventListener("change", toggleFields);
// Tür seçimi: şık pill'ler (gizli select'i sürer)
$("#typePills")?.addEventListener("click", (e) => {
  const p = e.target.closest(".type-pill");
  if (!p) return;
  $("#typeSel").value = p.dataset.type;
  toggleFields();
  $("#symbolInput")?.focus();
});

/* Sembol otomatik tamamlama: radar + izleme + portföy + swing verisinden
 * sembol→ad eşlemesi kurar, datalist'i doldurur. */
const SYM_NAMES = {};
function buildSymbolSuggestions() {
  const add = (sym, name) => { if (!sym) return; sym = String(sym).toUpperCase(); if (name && !SYM_NAMES[sym]) SYM_NAMES[sym] = String(name).replace(/"/g, ""); else if (!(sym in SYM_NAMES)) SYM_NAMES[sym] = SYM_NAMES[sym] || ""; };
  (SWING?.data?.items || []).forEach((s) => add(s.symbol, s.name));
  (RADAR?.data?.items || []).forEach((s) => add(s.symbol, s.name));
  (STATE?.holdings || []).forEach((h) => add(h.symbol, h.name));
  (STATE?.watchlist || []).forEach((w) => add(w.symbol, w.name));
  (OPP?.data?.items || []).forEach((s) => add(s.symbol, s.name));
  const dl = $("#symbolSuggestions");
  if (!dl) return;
  dl.innerHTML = Object.keys(SYM_NAMES).sort().map((sym) =>
    `<option value="${sym}">${SYM_NAMES[sym] || ""}</option>`).join("");
}
// Sembol yazınca / seçince adı boşsa otomatik doldur
function autofillName(inputEl, nameEl) {
  const sym = (inputEl.value || "").trim().toUpperCase();
  if (sym && SYM_NAMES[sym] && nameEl && !nameEl.value) nameEl.value = SYM_NAMES[sym];
}
$("#symbolInput")?.addEventListener("input", () => autofillName($("#symbolInput"), $("#nameInput")));
$("#symbolInput")?.addEventListener("change", () => autofillName($("#symbolInput"), $("#nameInput")));

function openAdd() {
  form.reset();
  form.id.value = "";
  $("#modalTitle").textContent = "Varlık Ekle";
  buildSymbolSuggestions();
  const adv = $("#advFields"); if (adv) adv.open = false;
  toggleFields();
  modalBg.hidden = false;
  setTimeout(() => $("#symbolInput")?.focus(), 50);
}
function openEdit(id) {
  const h = STATE.holdings.find((x) => x.id === id);
  if (!h) return;
  $("#modalTitle").textContent = "Varlık Düzenle";
  form.id.value = h.id;
  form.type.value = h.type;
  form.symbol.value = h.symbol;
  form.name.value = h.name || "";
  form.quantity.value = h.quantity;
  form.costUSD.value = h.costUSD ?? "";
  form.costTRY.value = h.costTRY ?? "";
  if (form.planStop) form.planStop.value = h.planStop ?? "";
  if (form.planTarget) form.planTarget.value = h.planTarget ?? "";
  if (form.ayar) form.ayar.value = h.ayar ?? 24;
  if (form.purchaseDate) form.purchaseDate.value = h.purchaseDate ?? "";
  if ($("#hzSel")) $("#hzSel").value = h.horizon === "swing" ? "swing" : "long";
  buildSymbolSuggestions();
  const adv = $("#advFields");
  if (adv) adv.open = h.planStop != null || h.planTarget != null || h.costTRY != null || !!h.purchaseDate;
  toggleFields();
  modalBg.hidden = false;
}
$("#addBtn").addEventListener("click", openAdd);
$("#cancelBtn").addEventListener("click", () => (modalBg.hidden = true));
modalBg.addEventListener("click", (e) => { if (e.target === modalBg) modalBg.hidden = true; });

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(form).entries());
  const id = fd.id;
  delete fd.id;
  if (fd.type !== "gold") { delete fd.ayar; delete fd.purchaseDate; }
  if (fd.type !== "stock") { delete fd.planStop; delete fd.planTarget; delete fd.horizon; }
  ["quantity", "costUSD", "costTRY", "purchaseDate"].forEach((k) => { if (fd[k] === "") delete fd[k]; });
  // Plan alanları: boş bırakmak = planı temizlemek (PUT merge'inde eski değer kalmasın)
  ["planStop", "planTarget"].forEach((k) => { if (fd[k] === "") fd[k] = null; });
  const method = id ? "PUT" : "POST";
  const url = id ? `/api/holdings/${id}` : "/api/holdings";
  await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(fd) });
  modalBg.hidden = true;
  load();
});

// Hisseyi Uzun Vade ↔ Swing taşı (horizon). Swing'e taşıyınca stop/hedef girmek için formu aç.
async function setHorizon(id, next) {
  try {
    await fetch(`/api/holdings/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ horizon: next }) });
    await load();
    toast(next === "swing" ? "Swing'e taşındı — stop/hedef gir" : "Uzun vadeye taşındı", "ok");
    if (next === "swing") openEdit(id);
  } catch { toast("Taşınamadı", "warn"); }
}

async function delHolding(id) {
  const h = STATE.holdings.find((x) => x.id === id);
  // Hisse + canlı fiyat varsa: çöp = güncel fiyattan TAM SATIŞ. İşlem Geçmişi'ne
  // "Satış" + 2026 Realize'a otomatik kayıt düşer. Diğer varlıklar sade kaldırılır.
  const px = h?.live?.priceUSD;
  if (h?.type === "stock" && h.quantity > 0 && px > 0) {
    const costUSD = h.costUSD != null ? Number(h.costUSD) : null;
    const rate = STATE?.fx?.usdtry;
    const realizeTRY = costUSD != null && rate ? (px - costUSD) * h.quantity * rate : null;
    const ok = await confirmDialog({
      title: `${h.symbol} satılsın mı?`,
      message: `${h.quantity} adet güncel fiyattan (${fmtUSD(px)}) satış olarak işlenecek.\n` +
        `İşlem Geçmişi'ne “Satış” + 2026 Realize'a otomatik kayıt eklenir.` +
        (realizeTRY != null ? `\nTahmini realize: ${realizeTRY >= 0 ? "+" : ""}${fmtTRY(realizeTRY)}` : ""),
      confirmText: "Sat", danger: true,
    });
    if (!ok) return;
    try {
      const r = await fetch("/api/trades", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "sell", symbol: h.symbol, name: h.name || "", shares: h.quantity, sellUSD: px }),
      });
      if (!r.ok) throw new Error();
      toast(`${h.symbol} satıldı · Realize'a yazıldı`, "ok");
    } catch { toast(`${h.symbol} satılamadı`, "warn"); return; }
    return load();
  }
  // Hisse ama canlı fiyat yok → satış fiyatını elle girmek için İşlem modalını aç
  if (h?.type === "stock" && h.quantity > 0) {
    toast("Canlı fiyat yok — satışı “+ İşlem Ekle” ile gir", "warn");
    openTrades(h.symbol);
    return;
  }
  // Fon / altın gibi varlıklar: sade kaldırma (işlem defteri hisseye özgü)
  const ok = await confirmDialog({
    title: `${h?.symbol || "Varlık"} silinsin mi?`,
    message: h?.name ? `${h.name} listeden kaldırılacak.` : "Bu varlık listeden kaldırılacak.",
    confirmText: "Sil", danger: true,
  });
  if (!ok) return;
  await fetch(`/api/holdings/${id}`, { method: "DELETE" });
  toast(`${h?.symbol || "Varlık"} silindi`);
  load();
}

/* ---- Hızlı ekleme: sembol + adet → anında hisse ekle ---- */
// Canlı önizleme: sembol adı + adet×fiyat ≈ $/₺. Boşken kısa yönlendirme gösterir.
function qaUpdatePreview() {
  const sym = ($("#qaSymbol")?.value || "").trim().toUpperCase();
  const qty = parseFloat($("#qaQty")?.value);
  const cost = parseFloat($("#qaCost")?.value);
  const nameEl = $("#qaName"), prevEl = $("#qaPreview");
  if (nameEl) nameEl.textContent = sym && SYM_NAMES[sym] ? SYM_NAMES[sym] : "";
  if (!prevEl) return;
  if (!sym || !(qty > 0)) {
    prevEl.className = "qa-preview";
    prevEl.textContent = "Sembol + adet gir → anında portföye eklenir.";
    return;
  }
  if (cost > 0) {
    const usd = qty * cost;
    const rate = STATE?.fx?.usdtry;
    prevEl.className = "qa-preview ready";
    prevEl.innerHTML = `<b>${sym}</b> · ${qty} adet × ${fmtUSD(cost)} = <b>${fmtUSD(usd)}</b>${rate ? ` ≈ <b>${fmtTRY(usd * rate)}</b>` : ""} · İşlem Geçmişi'ne “Alış” yazılır`;
  } else {
    prevEl.className = "qa-preview ready";
    prevEl.innerHTML = `<b>${sym}</b> · ${qty} adet — fiyat boş, canlı fiyattan eklenir (işlem geçmişine yazılmaz)`;
  }
}
["#qaSymbol", "#qaQty", "#qaCost"].forEach((sel) => {
  $(sel)?.addEventListener("input", qaUpdatePreview);
  $(sel)?.addEventListener("change", qaUpdatePreview);
});

$("#quickAdd")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const sym = ($("#qaSymbol").value || "").trim().toUpperCase();
  const qty = parseFloat($("#qaQty").value);
  const cost = parseFloat($("#qaCost").value);
  if (!sym) { $("#qaSymbol").focus(); return; }
  if (!(qty > 0)) { toast("Adet gir", "warn"); $("#qaQty").focus(); return; }
  const body = { type: "stock", symbol: sym, quantity: qty, name: SYM_NAMES[sym] || "" };
  if (cost > 0) body.costUSD = cost;
  const btn = $("#qaAdd"); const orig = btn.innerHTML; btn.disabled = true; btn.textContent = "Ekleniyor…";
  try {
    const r = await fetch("/api/holdings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error();
    $("#qaSymbol").value = ""; $("#qaQty").value = ""; $("#qaCost").value = "";
    toast(cost > 0 ? `${sym} eklendi · İşlem Geçmişi'ne yazıldı` : `${sym} eklendi`, "ok");
    await load();
    qaUpdatePreview();
  } catch { toast(`${sym} eklenemedi`, "warn"); }
  finally { btn.disabled = false; btn.innerHTML = orig; $("#qaSymbol").focus(); }
});

/* ---- Toast bildirimi ---- */
let toastTimer = null;
function toast(msg, tone = "ok") {
  let el = $("#toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
  el.className = `toast t-${tone} show`;
  el.textContent = (tone === "ok" ? "✓ " : tone === "warn" ? "⚠ " : "") + msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

/* ---- Şık onay diyaloğu (tarayıcı confirm yerine) → Promise<bool> ---- */
function confirmDialog({ title, message = "", confirmText = "Onayla", cancelText = "Vazgeç", danger = false } = {}) {
  return new Promise((resolve) => {
    const bg = document.createElement("div");
    bg.className = "confirm-bg";
    bg.innerHTML = `
      <div class="confirm-box" role="alertdialog" aria-modal="true">
        <div class="confirm-title">${title}</div>
        ${message ? `<div class="confirm-msg">${message}</div>` : ""}
        <div class="confirm-actions">
          <button class="btn ghost" data-act="cancel">${cancelText}</button>
          <button class="btn ${danger ? "danger-solid" : "primary"}" data-act="ok">${confirmText}</button>
        </div>
      </div>`;
    document.body.appendChild(bg);
    const close = (val) => { bg.classList.add("closing"); setTimeout(() => bg.remove(), 160); resolve(val); };
    bg.addEventListener("click", (e) => {
      if (e.target === bg) close(false);
      const b = e.target.closest("[data-act]");
      if (b) close(b.dataset.act === "ok");
    });
    const onKey = (e) => { if (e.key === "Escape") { close(false); document.removeEventListener("keydown", onKey); } };
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() => { bg.classList.add("show"); bg.querySelector('[data-act="ok"]')?.focus(); });
  });
}

// Sayısal değer giriş modalı (realize override düzeltme için) → değer veya null döner
function promptDialog({ title, message = "", value = "", suffix = "", confirmText = "Kaydet" } = {}) {
  return new Promise((resolve) => {
    const bg = document.createElement("div");
    bg.className = "confirm-bg";
    bg.innerHTML = `
      <div class="confirm-box" role="dialog" aria-modal="true">
        <div class="confirm-title">${title}</div>
        ${message ? `<div class="confirm-msg">${message}</div>` : ""}
        <div class="prompt-field"><input class="prompt-input" type="text" inputmode="decimal" value="${value}" />${suffix ? `<span class="prompt-suffix">${suffix}</span>` : ""}</div>
        <div class="confirm-actions">
          <button class="btn ghost" data-act="cancel">Vazgeç</button>
          <button class="btn primary" data-act="ok">${confirmText}</button>
        </div>
      </div>`;
    document.body.appendChild(bg);
    const input = bg.querySelector(".prompt-input");
    const close = (val) => { bg.classList.add("closing"); setTimeout(() => bg.remove(), 160); document.removeEventListener("keydown", onKey); resolve(val); };
    const submit = () => {
      const raw = input.value.trim().replace(/\./g, "").replace(",", ".").replace(/[^0-9.\-]/g, "");
      const n = Number(raw);
      close(isFinite(n) && raw !== "" ? n : null);
    };
    bg.addEventListener("click", (e) => {
      if (e.target === bg) return close(null);
      const b = e.target.closest("[data-act]");
      if (b) b.dataset.act === "ok" ? submit() : close(null);
    });
    const onKey = (e) => { if (e.key === "Escape") close(null); if (e.key === "Enter" && document.activeElement === input) submit(); };
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() => { bg.classList.add("show"); input.focus(); input.select(); });
  });
}

// NOT: Realize Özeti artık salt-gösterim. Düzeltme tek yerden — Vergi paneli (kalem bazlı ✎).

/* ---------------- Modal: opsiyon ---------------- */
const optionModalBg = $("#optionModalBg");
const optionForm = $("#optionForm");

function openAddOption() {
  optionForm.reset();
  optionForm.id.value = "";
  optionForm.contracts.value = 1;
  $("#optionModalTitle").textContent = "Opsiyon Ekle";
  optionModalBg.hidden = false;
}
function openEditOption(id) {
  const o = (STATE.options || []).find((x) => x.id === id);
  if (!o) return;
  $("#optionModalTitle").textContent = "Opsiyon Düzenle";
  optionForm.id.value = o.id;
  optionForm.underlying.value = o.underlying;
  optionForm.kind.value = o.kind;
  optionForm.direction.value = o.direction;
  optionForm.expiry.value = o.expiry || "";
  optionForm.strike.value = o.strike ?? "";
  optionForm.contracts.value = o.contracts ?? "";
  optionForm.premiumPaid.value = o.premiumPaid ?? "";
  optionForm.currentPremium.value = o.currentPremium ?? "";
  optionForm.note.value = o.note || "";
  optionModalBg.hidden = false;
}
$("#addOptionBtn").addEventListener("click", openAddOption);
$("#optionCancelBtn").addEventListener("click", () => (optionModalBg.hidden = true));
optionModalBg.addEventListener("click", (e) => { if (e.target === optionModalBg) optionModalBg.hidden = true; });

optionForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(optionForm).entries());
  const id = fd.id;
  delete fd.id;
  if (fd.currentPremium === "") delete fd.currentPremium;
  const method = id ? "PUT" : "POST";
  const url = id ? `/api/options/${id}` : "/api/options";
  await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(fd) });
  optionModalBg.hidden = true;
  load();
});

async function delOption(id) {
  const o = (STATE.options || []).find((x) => x.id === id);
  const label = o ? `${o.underlying} ${o.kind.toUpperCase()}` : "Opsiyon";
  const ok = await confirmDialog({ title: `${label} silinsin mi?`, message: "Bu opsiyon pozisyonu kaldırılacak.", confirmText: "Sil", danger: true });
  if (!ok) return;
  await fetch(`/api/options/${id}`, { method: "DELETE" });
  toast(`${label} silindi`);
  load();
}

/* ---------------- Modal: nakit ---------------- */
const cashModalBg = $("#cashModalBg");
const cashForm = $("#cashForm");
$("#editCashBtn").addEventListener("click", () => {
  cashForm.tl.value = STATE.cash.tl ?? "";
  cashForm.usd.value = STATE.cash.usd ?? "";
  cashForm.eur.value = STATE.cash.eur ?? "";
  cashModalBg.hidden = false;
});
$("#cashCancelBtn").addEventListener("click", () => (cashModalBg.hidden = true));
cashModalBg.addEventListener("click", (e) => { if (e.target === cashModalBg) cashModalBg.hidden = true; });
cashForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(cashForm).entries());
  const body = { tl: +fd.tl || 0, usd: +fd.usd || 0, eur: +fd.eur || 0 };
  await fetch("/api/cash", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  cashModalBg.hidden = true;
  load();
});

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

  /* ========== Getiri Kaynağı ========== */
  let fxCard;
  const contribStat = topC ? stat("En çok katkı", `${topC.sym} ${sUSD(topC.chg)}`, cls(topC.chg)) : stat("Pozisyon", String(stocks.length));
  if (!haveAsset || !stocks.length) {
    fxCard = `<div class="db-card">${head("💱", "b", "Getiri Kaynağı", "USD sepet")}<div class="db-empty">USD hisse pozisyonu yok.</div></div>`;
  } else if (fxTRY == null) {
    const assetUSD = usdtry ? assetTRY / usdtry : null;
    fxCard = `<div class="db-card db-fx">${head("💱", "b", "Getiri Kaynağı", "Bugün · USD sepet")}
      <div class="db-big ${cls(assetTRY)}">${sUSD(assetUSD)}</div>
      <div class="db-big-sub">≈ ${assetTRY >= 0 ? "+" : ""}${fmtTRY0(assetTRY)} · hisse hareketi</div>
      <div class="db-stats">${stat("Kazanan", String(gainers), "pos")}${stat("Kaybeden", String(losers), losers ? "neg" : "")}${contribStat}</div>
      <div class="db-foot">Kur etkisi için dünkü USD/TRY snapshot'ı gerekiyor — yarın hesaplanır.</div></div>`;
  } else {
    const totalTRY = assetTRY + fxTRY;
    const totUSD = usdtry ? totalTRY / usdtry : null;
    const assetUSD = usdtry ? assetTRY / usdtry : null;
    const aAbs = Math.abs(assetTRY), fAbs = Math.abs(fxTRY), tot = aAbs + fAbs || 1;
    const aPct = Math.round((aAbs / tot) * 100), fPct = 100 - aPct;
    const note = fAbs > aAbs * 1.5 ? "Kazancın çoğu kurdan — hisse performansını ayrı değerlendir."
      : aAbs > fAbs * 1.5 ? "Değişim ağırlıkla hisseden — gerçek performans." : "Hisse ve kur dengeli.";
    fxCard = `<div class="db-card db-fx">${head("💱", "b", "Getiri Kaynağı", "Bugün · USD sepet")}
      <div class="db-big ${cls(totalTRY)}">${sUSD(totUSD)}</div>
      <div class="db-big-sub">≈ ${totalTRY >= 0 ? "+" : ""}${fmtTRY0(totalTRY)} · ₺ karşılığı</div>
      <div class="db-bar"><span class="db-bar-a" style="width:${aPct}%"></span><span class="db-bar-f" style="width:${fPct}%"></span></div>
      <div class="db-attr-row"><span><i class="db-dot a"></i> Hisse hareketi</span><b class="${cls(assetTRY)}">${sUSD(assetUSD)} <small>${aPct}%</small></b></div>
      <div class="db-attr-row"><span><i class="db-dot f"></i> USD/TRY kuru</span><b class="${cls(fxTRY)}">${fxTRY >= 0 ? "+" : ""}${fmtTRY0(fxTRY)} <small>${fPct}%</small></b></div>
      <div class="db-stats">${stat("Kazanan", String(gainers), "pos")}${stat("Kaybeden", String(losers), losers ? "neg" : "")}${contribStat}</div>
      <div class="db-foot">${note}</div></div>`;
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

  /* ========== Bedava Pozisyon (house-money) + Sıradaki Hamle ========== */
  let houseStrip = "", nextMoveCard = "";
  if (frList.length) {
    houseStrip = `<div class="db-card db-house">${head("🎁", "g", "Bedava Pozisyon", "Ana parası çıkmış · risksiz")}
      <div class="db-house-top">
        <div class="db-ring" style="--p:${Math.max(0, Math.min(100, freePct)).toFixed(0)}"><span class="db-ring-v">${freePct.toFixed(0)}<i>%</i></span></div>
        <div class="db-house-nums">
          <div><span>Bedava değer</span><b class="pos">${fmtUSD0(freeValue)}</b></div>
          <div><span>Riskteki ana para</span><b>${fmtUSD0(totalAtRisk)}</b></div>
          <div><span>Kilitli kâr (Σ realize)</span><b class="${cls(totalLocked)}">${fmtUSD0(totalLocked)}</b></div>
        </div>
      </div>
      <div class="db-split"><span class="db-split-risk" style="width:${atRiskPct.toFixed(1)}%"></span><span class="db-split-free" style="width:${(100 - atRiskPct).toFixed(1)}%"></span></div>
      <div class="db-stats">${stat("Pozisyon", String(frList.length))}${stat("Riskini sıfırlayan", String(freeCount), freeCount ? "pos" : "")}${stat("Ort. geri-alım", avgRecovered != null ? `%${avgRecovered.toFixed(0)}` : "—")}</div>
      <div class="db-foot"><a class="db-link" data-goview="buyume">Büyüme'de detaylar →</a></div>
    </div>`;

    // Sıradaki Hamle: ana para çekmeye en yakın / hazır pozisyon
    const ready = frList.filter((x) => !x.fr.free && x.fr.sellShares != null && x.fr.unreal > 0)
      .sort((a, b) => (b.fr.recovered || 0) - (a.fr.recovered || 0) || (b.fr.unreal || 0) - (a.fr.unreal || 0));
    if (ready.length) {
      const { h, fr } = ready[0];
      const sym = h.symbol.toUpperCase();
      const nSell = Math.min(fr.qty, Math.ceil(fr.sellShares));
      const cashOut = nSell * fr.price;
      const nRemain = +(fr.qty - nSell).toFixed(2);
      const remainVal = nRemain * fr.price;
      nextMoveCard = `<div class="db-card db-move">${head("🎯", "v", "Sıradaki Hamle", "Ana parayı çek")}
        <div class="db-move-sym"><b>${sym}</b> <span class="pos">${sUSD(fr.unreal)}</span> kârda · maliyetin %${(fr.recovered || 0).toFixed(0)} kadarı geri alındı</div>
        <div class="db-prog"><i class="db-prog-fill" style="width:${Math.max(3, Math.min(100, fr.recovered || 0)).toFixed(0)}%"></i></div>
        <div class="db-move-act"><b>${fmtNum(nSell, 2)} adet</b> sat → ana paran <b class="pos">${fmtUSD0(cashOut)}</b> cebe,<br>kalan <b>${fmtNum(nRemain, 2)} adet</b> 🎁 bedava biner</div>
        <div class="db-stats">${stat("Cebe (ana para)", fmtUSD0(cashOut), "pos")}${stat("Bedava binecek", fmtUSD0(remainVal), "pos")}${stat("Açık kâr", sUSD(fr.unreal), cls(fr.unreal))}</div>
        <button class="db-move-btn" data-goview="buyume">Büyüme'de göster →</button>
      </div>`;
    } else {
      const closest = frList.filter((x) => !x.fr.free && x.fr.recovered != null)
        .sort((a, b) => (b.fr.recovered || 0) - (a.fr.recovered || 0))[0];
      nextMoveCard = `<div class="db-card db-move">${head("🎯", "v", "Sıradaki Hamle", "Ana parayı çek")}
        <div class="db-move-wait">Şu an ana para çekmeye hazır pozisyon yok — kâr büyüsün, zorlama.</div>
        ${closest ? `<div class="db-prog"><i class="db-prog-fill" style="width:${Math.max(3, Math.min(100, closest.fr.recovered || 0)).toFixed(0)}%"></i></div>
        <div class="db-move-rec">En yakını <b>${closest.h.symbol.toUpperCase()}</b>: maliyetin %${(closest.fr.recovered || 0).toFixed(0)} kadarı geri alındı. ${closest.fr.unreal > 0 ? "Biraz daha kâr, sonra ana parayı çek." : "Önce kâra geçmeli (Kural 1)."}</div>` : ""}
      </div>`;
    }
  }

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

  /* ========== Bu Ay Realize ========== */
  const goalTone = thisMonth >= gMin ? "ok" : thisMonth > 0 ? "warm" : "zero";
  const goalCard = `<div class="db-card db-goal">${head("📊", "g", "Bu Ay Realize", `Hedef $${gMin}–${gMax}/ay`)}
    <div class="db-big ${cls(thisMonth)}">${fmtUSD0(thisMonth)}</div>
    <div class="sw-goal-bar">
      <div class="sw-goal-band" style="left:${((gMin / gMax) * 100).toFixed(1)}%;right:0"></div>
      <div class="sw-goal-fill ${goalTone}" style="width:${Math.max(0, Math.min(100, (thisMonth / gMax) * 100)).toFixed(1)}%"></div>
    </div>
    <div class="db-stats">${stat("Geçen ay", fmtUSD0(lastMonth), cls(lastMonth))}${stat("Bu yıl", fmtUSD0(ytdRealize), cls(ytdRealize))}${stat("Günlük gereken", thisMonth >= gMin ? "✓ tamam" : fmtUSD0(dailyNeeded))}</div>
    <div class="db-foot">${thisMonth >= gMin ? `<span class="pos">✓ Aylık hedef tutturuldu</span>` : `hedefe <b>${fmtUSD0(gMin - thisMonth)}</b> kaldı`} · ${daysLeft} gün · <a class="db-link" data-goview="swingdefteri">defter →</a></div>
  </div>`;

  /* ========== Net Değer Kilometre Taşı ========== */
  let mileCard = "";
  if (totalUSD != null && totalUSD > 0) {
    const MILES = [10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2500000, 5000000];
    const next = MILES.find((m) => m > totalUSD) || Math.ceil(totalUSD / 1e6 + 1) * 1e6;
    const prev = [...MILES].reverse().find((m) => m <= totalUSD) || 0;
    const milePct = next > prev ? ((totalUSD - prev) / (next - prev)) * 100 : 0;
    let delta30 = null, ytdNW = null;
    const mhist = (S.history || []).filter((s) => s.total != null);
    if (mhist.length) {
      const cut = new Date(); cut.setDate(cut.getDate() - 30);
      const cutISO = cut.toISOString().slice(0, 10);
      const past = [...mhist].reverse().find((s) => s.date <= cutISO) || mhist[0];
      if (past) delta30 = totalUSD - (past.usdtry ? past.total / past.usdtry : past.total / usdtry);
      const yStart = `${dNow.getFullYear()}-01-01`;
      const base = mhist.find((s) => s.date >= yStart) || mhist[0];
      if (base) ytdNW = totalUSD - (base.usdtry ? base.total / base.usdtry : base.total / usdtry);
    }
    let etaTxt = null;
    if (delta30 != null && delta30 > 0) {
      const months = (next - totalUSD) / delta30;
      etaTxt = months <= 1 ? `~${Math.max(1, Math.round(months * 4.3))} hf` : months <= 18 ? `~${Math.round(months)} ay` : `~${(months / 12).toFixed(1)} yıl`;
    }
    const nwPts = mhist.map((s) => (s.usdtry ? s.total / s.usdtry : s.total / usdtry));
    mileCard = `<div class="db-card db-mile">${head("🚀", "b", "Net Değer Kilometre Taşı", "Büyüme hedefi")}
      <div class="db-mile-head"><div class="db-big">${fmtUSD0(totalUSD)}</div>${delta30 != null ? delta(delta30) : ""}</div>
      ${dbSpark(nwPts)}
      <div class="db-mile-bar"><div class="db-mile-fill" style="width:${Math.max(2, Math.min(100, milePct)).toFixed(1)}%"></div></div>
      <div class="db-stats">${stat("Sıradaki eşik", fmtUSD0(next))}${stat("Kalan", fmtUSD0(next - totalUSD))}${stat("Tahmini süre", etaTxt || "—")}</div>
      <div class="db-foot">%${milePct.toFixed(0)} yolda${ytdNW != null ? ` · yıl başından <b class="${cls(ytdNW)}">${ytdNW >= 0 ? "+" : ""}${fmtUSD0(ytdNW)}</b>` : ""}</div>
    </div>`;
  }
  const progressRow = `<div class="db-grid">${goalCard}${mileCard}</div>`;

  const thesisRow = (houseStrip || nextMoveCard) ? `<div class="db-grid db-grid-thesis">${houseStrip}${nextMoveCard}</div>` : "";
  el.innerHTML = `${kpiStrip}${swingStrip}${thesisRow}${progressRow}<div class="db-grid">${fxCard}${earnCard}</div>`;

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
      return `<tr>
        <td class="l">${fmtDate(t.date)}</td>
        <td class="l"><span class="sym">${t.symbol}</span> <span class="flow-tag deposit">Alış</span>${t.note ? `<div class="tnote">${t.note}</div>` : ""}</td>
        <td>${fmtNum(t.shares, 4)}</td>
        <td>${fmtUSD(t.buyUSD)}</td>
        <td>—</td>
        <td class="muted">maliyet ${fmtUSD(t.shares * t.buyUSD)}</td>
        <td>—</td>
        <td><button class="btn icon" data-deltrade="${t.id}" title="Sil">🗑</button></td>
      </tr>`;
    }
    const pnl = t.shares * (t.sellUSD - t.buyUSD);
    const cost = t.shares * t.buyUSD;
    const pct = cost ? (pnl / cost) * 100 : null;
    totUSD += pnl; totProceeds += t.shares * t.sellUSD; totCost += cost; sellCount++;
    return `<tr>
      <td class="l">${fmtDate(t.date)}</td>
      <td class="l"><span class="sym">${t.symbol}</span>${t.note ? `<div class="tnote">${t.note}</div>` : ""}</td>
      <td>${fmtNum(t.shares, 4)}</td>
      <td>${fmtUSD(t.buyUSD)}</td>
      <td>${fmtUSD(t.sellUSD)}</td>
      <td class="${cls(pnl)}">${fmtUSD(pnl)}</td>
      <td class="${pct != null ? cls(pct) : ""}">${fmtPct(pct)}</td>
      <td><button class="btn icon" data-deltrade="${t.id}" title="Sil">🗑</button></td>
    </tr>`;
  }).join("");

  $("#tradeRows").innerHTML = rows || `<tr><td colspan="8" class="empty-row">${TRADE_SYMBOL ? "Bu hisse için henüz işlem kaydı yok." : "Henüz işlem kaydı yok."}</td></tr>`;
  const totPct = totCost ? (totUSD / totCost) * 100 : 0;
  $("#tradeSummary").innerHTML = `
    <div class="ts-item"><span>İşlem</span><b>${trades.length}${sellCount !== trades.length ? ` <span class="muted">(${sellCount} satış)</span>` : ""}</b></div>
    <div class="ts-item"><span>Toplam Satış</span><b>${fmtUSD(totProceeds)}</b></div>
    <div class="ts-item"><span>Realize K/Z</span><b class="${cls(totUSD)}">${fmtUSD(totUSD)}</b></div>
    <div class="ts-item"><span>Getiri %</span><b class="${cls(totUSD)}">${fmtPct(totPct)}</b></div>
    <div class="ts-item"><span>≈ ₺</span><b class="${cls(totUSD)}">${fmtTRY0(totUSD * usdtry)}</b></div>`;

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
  hot:  { label: "🔥 SICAK", cls: "tr-hot",  title: "Kısa + orta vade güçlü ralli, trend üstünde" },
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
  const swBlock = sw ? `<div class="rd-swing">⚡ <b>Swing kurulumu — ${sw.setup?.label || sw.setup?.type || ""}:</b>
    Giriş <b>${fmtUSD(sw.entry)}</b>${sw.entryType ? ` <span class="muted">${ENTRY_TAG[sw.entryType] || ""}</span>` : ""} ·
    Stop <b class="neg">${fmtUSD(sw.stop)}${sw.riskPct != null ? ` (−${sw.riskPct.toFixed(1)}%)` : ""}</b> ·
    Hedef <b class="pos">${fmtUSD(sw.target)}${sw.rewardPct != null ? ` (+${sw.rewardPct.toFixed(1)}%)` : ""}</b> ·
    R/R <b>${sw.rr != null ? sw.rr.toFixed(1) + "R" : "—"}</b>${sw.grade ? ` · Kalite <span class="sw-grade ${GRADE_CLS[sw.grade] || "g-d"}">${sw.grade}</span>` : ""}
    ${sw.entry != null ? swFromBtn({ symbol: s.symbol, entry: sw.entry, stop: sw.stop, target: sw.target, note: sw.setup?.label || "" }) : ""}</div>` : "";
  return `<tr class="rb-detail" data-for="${s.symbol}" hidden><td colspan="8">
    ${swBlock}
    ${s.story ? `<div class="rd-story">💡 <b>Hikâye:</b> ${s.story}</div>` : ""}
    ${s.summaryText ? `<div class="rd-story rd-why">🧮 <b>Skor nereden geliyor?</b> ${s.summaryText}</div>` : ""}
    <div class="rd-grid">
      ${cell("1A", sgnPct(s.ret1M))}${cell("3A", sgnPct(s.ret3M))}${cell("6A", sgnPct(s.ret6M))}${cell("1Y", sgnPct(s.ret1Y))}${cell("YTD", sgnPct(s.retYTD))}
      ${cell("52h zirveye", sgnPct(s.fromHighPct))}
      ${cell("Piyasa değeri", fmtMcap(s.marketCap))}${cell("F/K", s.pe != null ? s.pe.toFixed(1) : "—")}${cell("PEG", s.pegYr != null ? s.pegYr.toFixed(2) : "—")}${cell("Beta", s.beta != null ? s.beta.toFixed(2) : "—")}
      ${cell("Gelir büyüme", sgnPct(s.revenueGrowth))}${cell("Kâr büyüme", sgnPct(s.earningsGrowth))}${cell("Brüt marj", s.grossMargin != null ? s.grossMargin.toFixed(0) + "%" : "—")}${cell("Net marj", s.profitMargin != null ? s.profitMargin.toFixed(0) + "%" : "—")}${cell("ROE", s.roe != null ? s.roe.toFixed(0) + "%" : "—")}
    </div>
    <div class="rd-row"><span class="rd-k">🎯 Model hedef (12A)</span><span class="rd-v">${tgtLine}</span></div>
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
  const syms = [...new Set([...ra.map((r) => r.symbol), ...sw.filter((s) => s.setup || s.cuma).map((s) => s.symbol)])];
  return syms.map((sym) => {
    const r = raBy[sym], s = swBy[sym];
    const swing = (s && s.setup) ? { setup: s.setup, entry: s.entry, stop: s.stop, target: s.target, rr: s.rr, riskPct: s.riskPct, rewardPct: s.rewardPct, grade: s.grade, entryType: s.entryType, verdict: s.verdict, rsi: s.rsi } : null;
    const base = r || { symbol: sym, score: null, tier: null, signals: [], theme: null, name: s?.name || null, price: s?.price ?? null, dayChangePct: s?.dayChangePct ?? null };
    return { ...base, symbol: sym, cuma: !!(r?.cuma || s?.cuma), swing };
  });
}
function unifiedRow(u) {
  const dotFor = (key) => {
    const sg = (u.signals || []).find((x) => x.key === key) || {};
    return `<span class="rsig rsig-${sg.tone || "bad"}" title="${(sg.text || "").replace(/"/g, "")}">${sg.label || ""}</span>`;
  };
  const tier = TIER_META[u.tier?.key] || TIER_META.neutral;
  const tr = TREND_META[u.trend];
  const dc = u.dayChangePct;
  const tgtCell = (u.target != null && u.upsidePct != null)
    ? `<div class="rb-tgt"><b>${fmtUSD(u.target)}</b><span class="rb-up ${cls(u.upsidePct)}">${u.upsidePct >= 0 ? "+" : ""}${u.upsidePct.toFixed(0)}%</span></div>`
    : "—";
  const badges = `${u.cuma ? `<span class="rb-badge cuma" title="Cuma Hoca listesi">⭐</span>` : ""}${raActionable(u) ? `<span class="rb-badge sig" title="Taze swing tetiği — bugün girilebilir kurulum">📡</span>` : ""}`;
  const scoreCell = u.score != null
    ? `<div class="rb-scorewrap"><div class="rb-bar"><i style="width:${u.score}%"></i></div><b>${u.score}</b></div>`
    : `<span class="muted rb-noscore">—</span>`;
  const tierCell = u.tier ? `<span class="rb-tier ${tier.cls}">${tier.label}</span>` : `<span class="muted">—</span>`;
  const su = u.swing ? SETUP_META[u.swing.setup?.type] : null;
  const swCell = u.swing
    ? `<span class="rb-sw">${su ? `<span class="chip ${su.cls}">${u.swing.setup.label}</span>` : ""}${u.swing.entry != null ? `<span class="rb-sw-lv">gir ${fmtUSD(u.swing.entry)} · <span class="neg">${fmtUSD(u.swing.stop)}</span></span>` : ""}</span>`
    : `<span class="muted">—</span>`;
  return `<tr class="rb-main" data-sym="${u.symbol}">
    <td class="l rb-sym">
      <span class="rb-caret">▸</span>
      <span class="sym">${u.symbol}</span>
      ${tr ? `<span class="rb-trend ${tr.cls}" title="${tr.title}">${tr.label}</span>` : ""}
      ${badges}
      <span class="rb-name">${u.name ? u.name.replace(/"/g, "") : ""}</span>
      ${u.story ? `<span class="rb-story">${u.story.replace(/"/g, "")}</span>` : ""}
    </td>
    <td class="l"><span class="rb-theme rb-th-${u.theme?.key || "other"}">${u.theme?.title?.split(" · ")[0] || "—"}</span></td>
    <td class="rb-price">${fmtUSD(u.price)}${dc != null ? `<span class="rb-dc ${cls(dc)}">${fmtPct(dc)}</span>` : ""}</td>
    <td class="rb-tgtcell">${tgtCell}</td>
    <td class="rb-score">${scoreCell}</td>
    <td>${tierCell}</td>
    <td class="l rb-sigs">${dotFor("mom")}${dotFor("ana")}${dotFor("fun")}${dotFor("ins")}
      <button class="btn icon rb-analiz" data-analiz="${u.symbol}" title="Teknik analizi aç / en güncel veriyle yenile">🔄</button></td>
    <td class="l rb-swcell">${swCell}</td>
  </tr>${radarDetail(u)}`;
}

function renderRadarBoard() {
  const el = $("#radarBoard");
  if (!el) return;
  const d = RADAR.data;
  if (!d && !SWING.data) { el.innerHTML = `<div class="radar-empty">Yükleniyor…</div>`; return; }

  const all = buildUnifiedRadar();

  // alt bilgi
  const sub = $("#radarBoardSub");
  if (sub) {
    const when = d?.updated ? new Date(d.updated).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
    const setups = all.filter((u) => u.swing).length;
    sub.textContent = (d && d.count < d.total)
      ? `Taranıyor… ${d.count}/${d.total} hisse hazır`
      : `${all.length} hisse tek listede · ${setups} swing kurulumu · skor + momentum/analist/bilanço/insider · son tarama ${when}`;
  }
  // tema çubuğu
  const gbar = $("#radarGroups");
  if (gbar && d?.groups) {
    gbar.innerHTML = [{ key: "all", title: "Tüm temalar" }, ...d.groups].map((g) =>
      `<button class="rg-chip${RADAR.group === g.key ? " active" : ""}" data-group="${g.key}">${g.title}</button>`
    ).join("");
    gbar.querySelectorAll("[data-group]").forEach((b) =>
      b.addEventListener("click", () => { RADAR.group = b.dataset.group; renderRadarBoard(); }));
  }

  // Aksiyon şeridi: yüksek skor (≥50) + taze swing tetiği → "şimdi girilebilir" ilk 5
  const action = all.filter((u) => (u.score ?? 0) >= 50 && raActionable(u)).sort((a, b) => raCombo(b) - raCombo(a)).slice(0, 5);
  const strip = action.length ? `<div class="ra-strip">
    <div class="ra-strip-h">🎯 Şimdi girilebilir <span>yüksek skor + taze swing tetiği — hem temel hem teknik hazır</span></div>
    <div class="ra-strip-row">${action.map((u) => `<button class="ra-pill" data-rapill="${u.symbol}">
      <span class="ra-pill-sym">${u.symbol}</span><span class="ra-pill-score">skor ${u.score}</span>
      <span class="ra-pill-lv">gir ${fmtUSD(u.swing.entry)} · stop <span class="neg">${fmtUSD(u.swing.stop)}</span></span>
      ${u.cuma ? `<span class="ra-pill-cuma">⭐</span>` : ""}</button>`).join("")}</div>
  </div>` : "";

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
          <th class="l">Hisse</th><th class="l">Tema</th><th>Fiyat</th>
          <th>Hedef · Potansiyel</th><th>Skor</th><th>Karar</th><th class="l">Sinyaller</th><th class="l">Swing</th>
        </tr></thead>
        <tbody>${items.map(unifiedRow).join("")}</tbody>
      </table></div>`
    : `<div class="radar-empty">${(d && d.count < d.total) ? "Tarama sürüyor, birazdan dolacak…" : "Bu filtreye uygun hisse yok."}</div>`;

  el.innerHTML = strip + table;

  // aksiyon şeridi pill → grafik
  el.querySelectorAll("[data-rapill]").forEach((b) =>
    b.addEventListener("click", () => openChartModal(b.dataset.rapill)));
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

/* ============================ Görünüm: Analiz ============================ */
// Günlük değişimi diverging kırmızı↔gri↔yeşil skalaya çevirir (±%4 doygunluk).
// Koyu kutularda beyaz, açık kutularda koyu yazı → her zaman okunur.
function heatStyle(pct) {
  if (pct == null || isNaN(pct)) return { bg: "hsl(140 6% 91%)", fg: "#5a655d" };
  const t = Math.max(-1, Math.min(1, pct / 4));
  const mag = Math.abs(t);
  const hue = t >= 0 ? 146 : 6;
  const sat = 14 + mag * 54;     // 14%..68%
  const light = 93 - mag * 44;   // 93%..49%
  return { bg: `hsl(${hue} ${sat}% ${light}%)`, fg: light < 64 ? "#ffffff" : "#1d2722" };
}

// Basit squarified treemap: items[{value,...}] (desc) → her birine {x,y,w,h} (%)
function squarify(items, x, y, w, h) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const area = w * h;
  const sc = items.map((i) => ({ ...i, area: (i.value / total) * area }));
  const out = [];
  let rx = x, ry = y, rw = w, rh = h, i = 0;
  while (i < sc.length) {
    const vertical = rw >= rh;
    const side = vertical ? rh : rw;
    let row = [], rowArea = 0, best = Infinity, j = i;
    for (; j < sc.length; j++) {
      const ta = rowArea + sc[j].area;
      const len = ta / side;
      const worst = [...row, sc[j]].reduce((m, t) => {
        const thick = t.area / len;
        return Math.max(m, Math.max(len / thick, thick / len));
      }, 0);
      if (worst > best && row.length) break;
      best = worst; row = [...row, sc[j]]; rowArea = ta;
    }
    const len = rowArea / side;
    let off = 0;
    for (const t of row) {
      const thick = t.area / len;
      if (vertical) { out.push({ ...t, x: rx, y: ry + off, w: len, h: thick }); off += thick; }
      else { out.push({ ...t, x: rx + off, y: ry, w: thick, h: len }); off += thick; }
    }
    if (vertical) { rx += len; rw -= len; } else { ry += len; rh -= len; }
    i = j; best = Infinity;
  }
  return out;
}

function renderHeatmap() {
  const el = $("#heatmap"); if (!el) return;
  const stocks = (STATE?.holdings || []).filter((h) => h.type === "stock" && h.live?.marketValueTRY > 0);
  if (!stocks.length) {
    el.innerHTML = `<div class="radar-empty">Hisse pozisyonu yok ya da fiyatlar yenileniyor.</div>`;
    return;
  }
  const total = stocks.reduce((s, h) => s + h.live.marketValueTRY, 0);
  const items = stocks.map((h) => ({
    id: h.id, symbol: h.symbol, value: h.live.marketValueTRY,
    pct: h.live.dayChangePct, mv: h.live.marketValueTRY,
    share: (h.live.marketValueTRY / total) * 100,
    usd: h.live.marketValueUSD ?? null,
  })).sort((a, b) => b.value - a.value);
  const tiles = squarify(items, 0, 0, 100, 100);
  el.innerHTML = `<div class="hm-canvas">${tiles.map((t) => {
    const { bg, fg } = heatStyle(t.pct);
    const area = t.w * t.h;            // %² — yazı yoğunluğunu kutu boyutuna göre ayarla
    const showPct = area >= 60 && t.h >= 7;
    const showVal = area >= 220 && t.h >= 12;
    return `<div class="hm-tile" data-pos="${t.id}"
      title="${t.symbol} · ${fmtTRY0(t.mv)} (%${t.share.toFixed(1)}) · gün ${fmtPct(t.pct)}"
      style="left:${t.x}%;top:${t.y}%;width:${t.w}%;height:${t.h}%;background:${bg};color:${fg}">
      <span class="hm-sym">${t.symbol}</span>
      ${showPct ? `<span class="hm-pct">${t.pct != null ? fmtPct(t.pct) : "—"}</span>` : ""}
      ${showVal ? `<span class="hm-val">${fmtTRY0(t.mv)}</span>` : ""}
    </div>`;
  }).join("")}</div>
  <div class="hm-legend">
    <span class="hm-leg-lbl">Günlük</span>
    <span class="hm-leg-scale">
      ${[-4, -2, 0, 2, 4].map((p) => `<i style="background:${heatStyle(p).bg}"></i>`).join("")}
    </span>
    <span class="hm-leg-ends"><b>−%4</b><b>+%4</b></span>
  </div>`;
  el.querySelectorAll("[data-pos]").forEach((b) =>
    b.addEventListener("click", () => openPositionDetail(b.dataset.pos)));
}

function renderSector() {
  const el = $("#sectorBox"); if (!el) return;
  const stocks = (STATE?.holdings || []).filter((h) => h.type === "stock" && h.live?.marketValueTRY > 0);
  const totalStock = stocks.reduce((s, h) => s + h.live.marketValueTRY, 0);
  if (!totalStock) { el.innerHTML = `<div class="radar-empty">Hisse pozisyonu yok.</div>`; return; }
  const map = {};
  for (const h of stocks) {
    const key = h.theme?.title || "Diğer / Sınıflandırılmamış";
    (map[key] = map[key] || { value: 0, syms: [] });
    map[key].value += h.live.marketValueTRY;
    map[key].syms.push(h.symbol);
  }
  const rows = Object.entries(map).map(([title, v]) => ({ title, ...v, pct: (v.value / totalStock) * 100 }))
    .sort((a, b) => b.value - a.value);
  const top = rows[0];
  const PALETTE = ["#2f8f57", "#3fa7b8", "#d9a92b", "#7c6cf0", "#cf7a3d", "#5b8def", "#9aa394"];
  const warn = top && top.pct >= 40
    ? `<div class="sector-warn">⚠️ Yoğunlaşma: portföy hisselerinin <b>%${top.pct.toFixed(0)}</b>'i tek temada (<b>${top.title}</b>). Riski dağıtmayı düşün.</div>`
    : top && top.pct >= 30
      ? `<div class="sector-warn soft">ℹ️ En büyük tema <b>${top.title}</b> · %${top.pct.toFixed(0)}. Dengeli görünüyor.</div>` : "";
  el.innerHTML = warn + rows.map((r, i) => `
    <div class="sector-row">
      <div class="sector-top">
        <span class="sector-name">${r.title}</span>
        <span class="sector-pct">%${r.pct.toFixed(1)} · ${fmtTRY0(r.value)}</span>
      </div>
      <div class="sector-bar"><span style="width:${r.pct.toFixed(1)}%;background:${PALETTE[i % PALETTE.length]}"></span></div>
      <div class="sector-syms">${r.syms.join(" · ")}</div>
    </div>`).join("");
}

async function renderWeekly() {
  const el = $("#weeklyBox"); if (!el) return;
  el.innerHTML = `<div class="radar-empty">↻ Hesaplanıyor…</div>`;
  let d;
  try { d = await (await fetch("/api/weekly")).json(); } catch { el.innerHTML = `<div class="radar-empty">Veri alınamadı.</div>`; return; }
  if (!d.stocks?.length) { el.innerHTML = `<div class="radar-empty">Haftalık veri için hisse mumları henüz taranmadı. Swing tarayıcıyı bir kez açıp bekle.</div>`; return; }
  const p = d.portfolio;
  const head = p ? `<div class="wk-hero ${cls(p.changeTRY)}">
      <div class="wk-hero-lbl">Bu hafta portföy (${fmtDate(p.fromDate)} → ${fmtDate(p.toDate)})</div>
      <div class="wk-hero-val">${p.changeTRY >= 0 ? "+" : ""}${fmtTRY0(p.changeTRY)} <span class="wk-hero-pct">${p.pct != null ? fmtPct(p.pct) : ""}</span></div>
    </div>` : "";
  const b = d.best, w = d.worst;
  const bw = (b && w) ? `<div class="wk-bw">
      <div>🏆 En iyi <b>${b.symbol}</b> <span class="${cls(b.pct)}">${fmtPct(b.pct)}</span></div>
      <div>🔻 En kötü <b>${w.symbol}</b> <span class="${cls(w.pct)}">${fmtPct(w.pct)}</span></div>
    </div>` : "";
  const maxAbs = Math.max(1, ...d.stocks.map((s) => Math.abs(s.pct)));
  const rows = d.stocks.map((s) => {
    const w = (Math.abs(s.pct) / maxAbs) * 50; // merkezden ±%50
    const bar = s.pct >= 0
      ? `<span class="wk-bar-pos" style="width:${w}%"></span>`
      : `<span class="wk-bar-neg" style="width:${w}%;margin-left:${50 - w}%"></span>`;
    return `<tr>
      <td class="l sym-link" data-wk="${s.symbol}"><b>${s.symbol}</b></td>
      <td class="wk-bar-cell"><span class="wk-bar-mid"></span>${bar}</td>
      <td class="${cls(s.pct)}">${fmtPct(s.pct)}</td>
    </tr>`;
  }).join("");
  el.innerHTML = `${head}${bw}
    <table class="wk-table"><tbody>${rows}</tbody></table>
    <p class="modal-note">Son 5 işlem günü değişimi · candleCache'ten (ek API maliyeti yok).</p>`;
  el.querySelectorAll("[data-wk]").forEach((b) => b.addEventListener("click", () => openChartModal(b.dataset.wk)));
}

async function renderBacktest() {
  const el = $("#backtestBox"); if (!el) return;
  el.innerHTML = `<div class="radar-empty">↻ Hesaplanıyor…</div>`;
  let d;
  try { d = await (await fetch("/api/backtest")).json(); } catch { el.innerHTML = `<div class="radar-empty">Veri alınamadı.</div>`; return; }
  const card = (title, st, tip) => {
    if (!st) return `<div class="bt-card"><div class="bt-title">${title}</div><div class="bt-empty">yeterli geçmiş yok</div></div>`;
    return `<div class="bt-card">
      <div class="bt-title">${title} <span class="bt-n">${st.n} sinyal</span></div>
      <div class="bt-main ${cls(st.avgRet)}">${fmtPct(st.avgRet)}</div>
      <div class="bt-sub">isabet %${st.winRate.toFixed(0)} · ${tip}</div>
      <div class="bt-range">en iyi <span class="pos">${fmtPct(st.best)}</span> · en kötü <span class="neg">${fmtPct(st.worst)}</span></div>
    </div>`;
  };
  const cards = `<div class="bt-cards">
    ${card("🟢 ALIM bölgesi sinyali", d.buy, "ort. getiri (sinyalden bugüne)")}
    ${card("📉 Swing kurulumu", d.setup, "ort. getiri")}
    ${card("🔴 Aşırı alım (sat)", d.sell, "isabet = sonradan düştü")}
  </div>`;
  const samples = (d.samples || []).slice(0, 16).map((s) => `<tr>
      <td class="l sym-link" data-bt="${s.symbol}"><b>${s.symbol}</b></td>
      <td class="l"><span class="bt-tag bt-${s.tag}">${s.tag === "buy" ? "ALIM" : s.tag === "sell" ? "SAT" : "KURULUM"}</span></td>
      <td>${fmtDate(s.date)}</td>
      <td>${fmtUSD(s.entry)} → ${fmtUSD(s.now)}</td>
      <td class="${cls(s.ret)}">${fmtPct(s.ret)}</td>
    </tr>`).join("");
  el.innerHTML = `${cards}
    ${samples ? `<div class="bt-sec">Sinyalden bugüne — örnekler</div>
    <table class="bt-table"><thead><tr><th class="l">Sembol</th><th class="l">Sinyal</th><th>Tarih</th><th>Fiyat</th><th>Getiri</th></tr></thead>
    <tbody>${samples}</tbody></table>` : ""}
    <p class="modal-note">Her sembol+sinyal İLK işaretlendiği günden bugüne ölçülür (son ~${d.windowDays} gün rapor geçmişi). Skoru gözle kalibre etmek içindir; geçmiş performans gelecek getiri garantisi değildir.</p>`;
  el.querySelectorAll("[data-bt]").forEach((b) => b.addEventListener("click", () => openChartModal(b.dataset.bt)));
}

/* ---- Sinyal Karnesi: kayıtlı planların gerçek stop/hedef sonucu ---- */
const LEDGER_TYPE = { breakout: "Breakout", pullback: "Pullback", oversold: "Aşırı satım" };
const LEDGER_STATUS = {
  waiting: { label: "giriş bekliyor", cls: "ls-wait" },
  open: { label: "açık", cls: "ls-open" },
  target: { label: "🎯 hedef", cls: "ls-target" },
  stop: { label: "🛑 stop", cls: "ls-stop" },
  timeout: { label: "süre doldu", cls: "ls-timeout" },
  expired: { label: "tetiklenmedi", cls: "ls-expired" },
  invalid: { label: "geçersiz", cls: "ls-expired" },
};

async function renderLedger() {
  const el = $("#ledgerBox"); if (!el) return;
  el.innerHTML = `<div class="radar-empty">↻ Hesaplanıyor…</div>`;
  let d;
  try { d = await (await fetch("/api/signal-stats")).json(); }
  catch { el.innerHTML = `<div class="radar-empty">Veri alınamadı.</div>`; return; }
  if (!d.count) {
    el.innerHTML = `<div class="radar-empty">Henüz kayıtlı sinyal yok. Swing taraması kurulum ürettikçe burada birikir — birkaç gün sonra hangi sinyal tipinin gerçekten para kazandırdığını göreceksin.</div>`;
    return;
  }
  const card = (tp) => {
    const st = d.byType?.[tp];
    const ttl = LEDGER_TYPE[tp];
    if (!st || !st.total) return `<div class="bt-card"><div class="bt-title">${ttl}</div><div class="bt-empty">kayıt yok</div></div>`;
    const main = st.winRate != null
      ? `<div class="bt-main ${st.winRate >= 50 ? "pos" : "neg"}">%${st.winRate.toFixed(0)}</div>`
      : `<div class="bt-main muted">—</div>`;
    const avgR = st.avgR != null ? `${st.avgR >= 0 ? "+" : ""}${st.avgR.toFixed(2)}R ort.` : "henüz sonuç yok";
    return `<div class="bt-card">
      <div class="bt-title">${ttl} <span class="bt-n">${st.total} sinyal</span></div>
      ${main}
      <div class="bt-sub">isabet (hedef ${st.target} · stop ${st.stop}${st.timeout ? ` · zaman aşımı ${st.timeout}` : ""}) · ${avgR}</div>
      <div class="bt-range">${st.open ? `açık ${st.open} · ` : ""}${st.waiting ? `bekleyen ${st.waiting} · ` : ""}${st.expired ? `tetiklenmeyen ${st.expired} · ` : ""}toplam ${st.totalR != null ? (st.totalR >= 0 ? "+" : "") + st.totalR.toFixed(1) + "R" : "—"}</div>
    </div>`;
  };
  const rows = (d.records || []).slice(0, 16).map((r) => {
    const s = LEDGER_STATUS[r.status] || { label: r.status, cls: "" };
    const res = r.r != null ? `<b class="${cls(r.r)}">${r.r >= 0 ? "+" : ""}${r.r.toFixed(2)}R</b>` : "—";
    return `<tr>
      <td class="l sym-link" data-lg="${r.symbol}"><b>${r.symbol}</b></td>
      <td class="l"><span class="chip sw-${r.type}">${LEDGER_TYPE[r.type] || r.type}</span></td>
      <td>${fmtDate(r.signalDate)}</td>
      <td>${fmtUSD(r.entry)}</td>
      <td class="neg">${fmtUSD(r.stop)}</td>
      <td class="pos">${fmtUSD(r.target)}</td>
      <td class="l"><span class="ls ${s.cls}">${s.label}</span></td>
      <td>${res}</td>
    </tr>`;
  }).join("");
  el.innerHTML = `<div class="bt-cards">${card("pullback")}${card("breakout")}${card("oversold")}</div>
    ${rows ? `<table class="bt-table">
      <thead><tr><th class="l">Sembol</th><th class="l">Kurulum</th><th>Sinyal</th><th>Giriş</th><th>Stop</th><th>Hedef</th><th class="l">Durum</th><th>Sonuç</th></tr></thead>
      <tbody>${rows}</tbody></table>` : ""}
    <p class="modal-note">Plan: girişe değince pozisyon açılmış sayılır, sonra hangi seviye (stop/hedef) önce vurduysa o sonuçtur; ikisi aynı muma denk gelirse muhafazakâr olarak stop sayılır. %50 üstü isabet + pozitif ortalama R = güvenilir kurulum. Mum önbelleğinden ölçülür, ek API maliyeti yoktur.</p>`;
  el.querySelectorAll("[data-lg]").forEach((b) => b.addEventListener("click", () => openChartModal(b.dataset.lg)));
}

function renderAnalizSummary() {
  const el = $("#analizSummary"); if (!el) return;
  const stocks = (STATE?.holdings || []).filter((h) => h.type === "stock");
  const totalStock = stocks.reduce((s, h) => s + (h.live?.marketValueTRY || 0), 0);
  // En yoğun tema
  const themeMap = {};
  for (const h of stocks) {
    const k = h.theme?.title || "Diğer";
    themeMap[k] = (themeMap[k] || 0) + (h.live?.marketValueTRY || 0);
  }
  const topTheme = Object.entries(themeMap).sort((a, b) => b[1] - a[1])[0];
  const topPct = topTheme && totalStock ? (topTheme[1] / totalStock) * 100 : 0;
  // Realize K/Z — yalnızca satışlar
  const trades = (STATE?.trades || []).filter((t) => t.kind !== "buy");
  const realizedUSD = trades.reduce((s, t) => s + t.shares * (t.sellUSD - t.buyUSD), 0);
  // Günlük en iyi/kötü (anlık)
  const withDc = stocks.filter((h) => h.live?.dayChangePct != null);
  withDc.sort((a, b) => b.live.dayChangePct - a.live.dayChangePct);
  const best = withDc[0], worst = withDc[withDc.length - 1];
  const stat = (lbl, val, sub, c = "") => `
    <div class="asum">
      <div class="asum-lbl">${lbl}</div>
      <div class="asum-val ${c}">${val}</div>
      <div class="asum-sub">${sub}</div>
    </div>`;
  el.innerHTML =
    stat("Hisse Değeri", fmtTRY0(totalStock), `${stocks.length} pozisyon`) +
    stat("En Yoğun Tema", topTheme ? `%${topPct.toFixed(0)}` : "—", topTheme ? topTheme[0] : "—", topPct >= 40 ? "neg" : "") +
    stat("Bugün En İyi", best ? best.symbol : "—", best ? fmtPct(best.live.dayChangePct) : "—", best ? cls(best.live.dayChangePct) : "") +
    stat("Bugün En Kötü", worst ? worst.symbol : "—", worst ? fmtPct(worst.live.dayChangePct) : "—", worst ? cls(worst.live.dayChangePct) : "") +
    stat("Realize K/Z", fmtUSD0(realizedUSD), `${trades.length} satış`, cls(realizedUSD));
}

/* ===== Realize Özeti — sembol başına net K/Z (aracı kurum "Yatırım geliri" birebir) ===== */
function renderRealizeSummary() {
  const el = $("#realizeSummary"); if (!el) return;
  const usdtry = STATE?.fx?.usdtry || 0;
  const ovr = STATE?.realizeOverrideTRY || {};      // ground-truth TL (hisse + opsiyon net)
  const calc = STATE?.realizedBySym || {};          // USD (override olmayan semboller)
  const rows = {};
  // 1) Ground-truth override (TL, sabit — kesin)
  for (const [sym, tl] of Object.entries(ovr)) rows[sym] = { sym, tl: +tl, gt: true };
  // 2) Override edilmeyen semboller: hesaplanan USD → TL
  for (const [sym, usd] of Object.entries(calc)) {
    if (rows[sym]) continue;
    if (!usdtry) continue;
    rows[sym] = { sym, tl: usd * usdtry, gt: false };
  }
  const edited = STATE?.realizeOverrideEdited || {};   // kullanıcı elle düzelttiği semboller
  for (const r of Object.values(rows)) r.edited = Object.prototype.hasOwnProperty.call(edited, r.sym);
  const list = Object.values(rows).sort((a, b) => b.tl - a.tl);
  if (!list.length) { el.innerHTML = `<div class="radar-empty">Henüz realize edilmiş işlem yok.</div>`; return; }
  const pos = list.filter((r) => r.tl >= 0).reduce((s, r) => s + r.tl, 0);
  const neg = list.filter((r) => r.tl < 0).reduce((s, r) => s + r.tl, 0);
  const net = pos + neg;
  const winN = list.filter((r) => r.tl > 0).length;
  const usd = (tl) => (usdtry ? ` <span class="rz-usd">${fmtUSD0(tl / usdtry)}</span>` : "");
  el.innerHTML = `
    <div class="rz-head">
      <div class="rz-h"><span class="rz-h-lbl">NET REALİZE</span><span class="rz-h-val ${cls(net)}">${fmtTRY0(net)}${usd(net)}</span></div>
      <div class="rz-h"><span class="rz-h-lbl">Kazanan</span><span class="rz-h-val pos">+${fmtTRY0(pos)}</span></div>
      <div class="rz-h"><span class="rz-h-lbl">Kaybeden</span><span class="rz-h-val neg">${fmtTRY0(neg)}</span></div>
      <div class="rz-h"><span class="rz-h-lbl">İsabet</span><span class="rz-h-val">${list.length ? Math.round((winN / list.length) * 100) : 0}% · ${winN}/${list.length}</span></div>
    </div>
    <div class="rz-list">
      ${list.map((r) => `
        <div class="rz-row">
          <span class="rz-sym">${r.sym}${r.gt ? "" : ` <span class="rz-tag">hesap</span>`}${r.edited ? ` <span class="rz-tag rz-edited" title="Vergi panelinden elle düzeltildi">✓ düzeltildi</span>` : ""}</span>
          <span class="rz-amt ${cls(r.tl)}">${r.tl >= 0 ? "+" : ""}${fmtTRY0(r.tl)}${usd(r.tl)}</span>
        </div>`).join("")}
    </div>`;
}

/* ===== Profesyonel Risk Masası — korelasyon · VaR · risk katkısı · boyutlama · tahsis · faktör ===== */
let PRORISK = null;
const PRO_TARGETS_KEY = "proAllocTargets";
function proTargets() {
  try { const t = JSON.parse(localStorage.getItem(PRO_TARGETS_KEY)); if (t && typeof t === "object") return t; } catch {}
  return { core: 55, satellite: 20, cash: 20, other: 5 }; // çekirdek hisse / swing / nakit / altın+opsiyon
}
async function renderProRisk() {
  const el = $("#proRiskBox"); if (!el) return;
  if (PRORISK == null) {
    el.innerHTML = `<div class="radar-empty">📊 Risk motoru çalışıyor — getiri serileri hesaplanıyor…</div>`;
    try { PRORISK = await (await fetch("/api/risk")).json(); } catch { PRORISK = { error: true }; }
  }
  const R = PRORISK;
  if (!R || R.error) { el.innerHTML = `<div class="radar-empty">Risk verisi alınamadı (mum verisi eksik olabilir).</div>`; return; }
  if (R.empty) { el.innerHTML = `<div class="radar-empty">${R.reason || "Risk için yeterli geçmiş yok"} — birkaç gün veri biriktikçe dolar.</div>`; return; }
  const fx = STATE?.fx?.usdtry || 0;
  const P = R.portfolio, pos = R.positions || [];

  // ---- Panel 1: Risk & Korelasyon ----
  const kpi = (lbl, val, sub, tone = "", tip = "") => `
    <div class="pr-kpi ${tone}">
      <div class="pr-kpi-l">${lbl}${tip ? ` <span class="tip" data-tip="${tip}">?</span>` : ""}</div>
      <div class="pr-kpi-v">${val}</div>
      <div class="pr-kpi-s">${sub}</div>
    </div>`;
  const divTone = P.diversification >= 55 ? "good" : P.diversification >= 35 ? "warn" : "bad";
  const kpis = `<div class="pr-kpis">
    ${kpi("VaR %95 (1 gün)", fx ? fmtTRY0(P.var95USD * fx) : fmtUSD0(P.var95USD), `≈ ${fmtUSD0(P.var95USD)} · portföyün %${P.var95Pct}`, P.var95Pct >= 4 ? "bad" : P.var95Pct >= 2.5 ? "warn" : "good", "Value at Risk: normal koşulda %95 ihtimalle 1 günde bu tutardan FAZLA kaybetmezsin. Tarihsel en kötü %5 gün de hesaba katılır.")}
    ${kpi("Yıllık Volatilite", `%${P.volAnnPct}`, "portföy oynaklığı", P.volAnnPct >= 40 ? "bad" : P.volAnnPct >= 25 ? "warn" : "good", "Portföyün yıllıklandırılmış standart sapması. %25 altı sakin, %40 üstü çok oynak.")}
    ${kpi("Beta (SPY)", P.beta != null ? P.beta.toFixed(2) : "—", P.beta != null ? (P.beta > 1.1 ? "piyasadan agresif" : P.beta < 0.9 ? "piyasadan sakin" : "piyasayla uyumlu") : "—", P.beta != null && P.beta > 1.3 ? "warn" : "", "Piyasaya (S&P 500) duyarlılık. 1.5 = piyasa %1 düşünce portföy ~%1.5 düşer.")}
    ${kpi("Çeşitlendirme", `%${P.diversification}`, `ort. korelasyon ${P.avgCorr}`, divTone, "Pozisyonlar ne kadar bağımsız hareket ediyor. Düşükse 'çok hisse ama tek bahis' demektir — gerçek çeşitlendirme yok.")}
  </div>`;

  // Korelasyon ısı haritası
  const cc = (v) => v >= 0.7 ? "cc-h" : v >= 0.45 ? "cc-m" : v >= 0.2 ? "cc-l" : v >= -0.2 ? "cc-z" : "cc-n";
  const cm = R.correlation || { syms: [], matrix: [] };
  const corrTable = cm.syms.length >= 2 ? `
    <div class="pr-sub">Korelasyon matrisi <span class="pr-hint">kırmızı = birlikte hareket (çeşitlendirme yok) · yeşil = bağımsız</span></div>
    <div class="pr-corr-wrap"><table class="pr-corr"><thead><tr><th></th>${cm.syms.map((s) => `<th>${s}</th>`).join("")}</tr></thead>
    <tbody>${cm.syms.map((s, i) => `<tr><th>${s}</th>${cm.matrix[i].map((v, j) => `<td class="${i === j ? "cc-self" : cc(v)}" title="${s}↔${cm.syms[j]}: ${v}">${i === j ? "—" : v.toFixed(2)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : "";

  // Risk katkısı: ağırlığından fazla risk taşıyan pozisyon = gizli risk
  const maxRC = Math.max(1, ...pos.map((p) => Math.abs(p.rcPct)));
  const rcRows = pos.slice(0, 12).map((p) => {
    const over = p.rcPct > p.weightPct + 3;
    return `<div class="pr-rc-row">
      <span class="pr-rc-sym">${p.symbol}</span>
      <div class="pr-rc-bar"><i class="${over ? "over" : ""}" style="width:${Math.max(2, Math.abs(p.rcPct) / maxRC * 100).toFixed(0)}%"></i></div>
      <span class="pr-rc-val ${over ? "neg" : ""}">%${p.rcPct.toFixed(1)}<span class="pr-rc-w"> / ağ. %${p.weightPct}</span></span>
    </div>`;
  }).join("");
  const panel1 = `<div class="pr-block">
    <div class="pr-h2">🛡️ Risk & Korelasyon</div>
    ${kpis}${corrTable}
    <div class="pr-sub">Risk katkısı <span class="pr-hint">her pozisyonun TOPLAM portföy riskine payı — ağırlığından büyükse (kırmızı) o pozisyon gizli risk taşıyor</span></div>
    <div class="pr-rc">${rcRows}</div>
  </div>`;

  // ---- Panel 2: Tahsis & Rebalancing ----
  const tg = proTargets();
  let coreV = 0, satV = 0, goldV = 0, optV = 0, cashV = 0;
  for (const h of (STATE.holdings || [])) { const v = h.live?.marketValueTRY || 0; if (h.type === "gold") goldV += v; else coreV += v; }
  for (const p of (STATE.swingPositions || [])) satV += (p.valueUSD || 0) * fx;
  const cash = STATE.cash || {}; cashV = (cash.tl || 0) + (cash.usd || 0) * fx + (cash.eur || 0) * (STATE.fx?.eurtry || 0);
  for (const o of (STATE.options || [])) optV += (o.valueTRY || 0) * (o.direction === "short" ? -1 : 1);
  const otherV = goldV + optV;
  const totA = coreV + satV + cashV + otherV;
  const buckets = [
    { key: "core", lbl: "Çekirdek (uzun vade)", val: coreV, tgt: tg.core, color: "var(--green)" },
    { key: "satellite", lbl: "Uydu (swing)", val: satV, tgt: tg.satellite, color: "var(--amber-d, #d98a00)" },
    { key: "cash", lbl: "Nakit (kuru toz)", val: cashV, tgt: tg.cash, color: "#5b8def" },
    { key: "other", lbl: "Altın + Opsiyon", val: otherV, tgt: tg.other, color: "#9b8cff" },
  ];
  const allocRows = buckets.map((b) => {
    const act = totA ? b.val / totA * 100 : 0;
    const drift = act - b.tgt;
    const action = Math.abs(drift) < 4 ? `<span class="pr-ok">dengede</span>` : drift > 0 ? `<span class="pr-warn">%${Math.abs(drift).toFixed(0)} kıs</span>` : `<span class="pr-add">%${Math.abs(drift).toFixed(0)} ekle</span>`;
    return `<div class="pr-alloc-row">
      <span class="pr-alloc-lbl"><i style="background:${b.color}"></i>${b.lbl}</span>
      <div class="pr-alloc-bar"><div class="pr-alloc-fill" style="width:${Math.min(100, act).toFixed(0)}%;background:${b.color}"></div><span class="pr-alloc-tgt" style="left:${Math.min(100, b.tgt)}%" title="hedef %${b.tgt}"></span></div>
      <span class="pr-alloc-pct">%${act.toFixed(0)}<span class="pr-alloc-t"> / %${b.tgt}</span></span>
      <span class="pr-alloc-act">${action}</span>
    </div>`;
  }).join("");
  const panel2 = `<div class="pr-block">
    <div class="pr-h2">⚖️ Tahsis & Rebalancing <button class="pr-edit-tg" data-pr-edit-targets title="Hedef ağırlıkları düzenle">✎ hedef</button></div>
    <div class="pr-hint">Core-Satellite modeli: çekirdek uzun-vade pozisyonlar + uydu swing'ler + nakit yastığı. Çubuk = gerçek ağırlık, çizgi = hedef. Sapma %4'ü geçince öneri çıkar.</div>
    <div class="pr-alloc">${allocRows}</div>
  </div>`;

  // ---- Panel 3: Pozisyon Boyutlama ----
  const szRows = pos.map((p) => {
    const diff = p.suggestPct != null ? p.weightPct - p.suggestPct : null;
    const flag = diff == null ? "" : diff > 4 ? `<span class="pr-warn">büyük</span>` : diff < -4 ? `<span class="pr-add">yer var</span>` : `<span class="pr-ok">uygun</span>`;
    return `<tr>
      <td class="l"><b>${p.symbol}</b></td>
      <td>%${p.weightPct}</td>
      <td>${p.suggestPct != null ? `%${p.suggestPct}` : "—"}</td>
      <td>${p.adrPct != null ? `%${p.adrPct}` : "—"}</td>
      <td>%${p.volAnnPct ?? "—"}</td>
      <td>${flag}</td>
    </tr>`;
  }).join("");
  const panel3 = `<div class="pr-block">
    <div class="pr-h2">🎯 Risk-Bazlı Pozisyon Boyutlama</div>
    <div class="pr-hint">Qullamaggie kuralı tüm portföye: 1×ADR stopta portföyün %1'i risk. "Önerilen" = bu kurala göre ideal ağırlık. Gerçek bundan büyükse pozisyon fazla iri (tek hata canını yakar).</div>
    <div class="tbl-wrap"><table class="pr-size"><thead><tr><th class="l">Sembol</th><th>Gerçek</th><th>Önerilen</th><th>ADR</th><th>Vol</th><th></th></tr></thead><tbody>${szRows}</tbody></table></div>
  </div>`;

  // ---- Panel 4: Faktör & Maruziyet ----
  // Momentum (3a) sıralı
  const momo = pos.filter((p) => p.momo3mPct != null).slice().sort((a, b) => b.momo3mPct - a.momo3mPct);
  const momoRows = momo.map((p) => `<div class="pr-mo-row"><span>${p.symbol}</span><span class="${cls(p.momo3mPct)}">${p.momo3mPct >= 0 ? "+" : ""}%${p.momo3mPct} <small>3a</small></span><span class="${p.momo6mPct != null ? cls(p.momo6mPct) : ""}">${p.momo6mPct != null ? (p.momo6mPct >= 0 ? "+" : "") + "%" + p.momo6mPct + " 6a" : ""}</span></div>`).join("");
  // Sektör/tema konsantrasyonu
  const themeMap = {};
  for (const h of (STATE.holdings || [])) { if (h.type !== "stock") continue; const k = h.theme?.title || h.theme || "Diğer"; themeMap[k] = (themeMap[k] || 0) + (h.live?.marketValueTRY || 0); }
  const themeTot = Object.values(themeMap).reduce((s, v) => s + v, 0) || 1;
  const themeRows = Object.entries(themeMap).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => { const pct = v / themeTot * 100; return `<div class="pr-th-row"><span class="pr-th-lbl">${k}</span><div class="pr-th-bar"><i style="width:${pct.toFixed(0)}%;${pct >= 40 ? "background:var(--red)" : ""}"></i></div><span class="pr-th-pct ${pct >= 40 ? "neg" : ""}">%${pct.toFixed(0)}</span></div>`; }).join("");
  // Opsiyon vs Hisse realize (vergi kalemlerinden: label'da Call/Put = opsiyon)
  let optReal = 0, stkReal = 0;
  for (const r of (STATE.realized2026 || [])) { const o = /\b(call|put)\b/i.test(r.label || ""); if (o) optReal += Number(r.amountTRY) || 0; else stkReal += Number(r.amountTRY) || 0; }
  const ovsH = `<div class="pr-ovh">
      <div class="pr-ovh-c ${cls(stkReal)}"><div class="pr-ovh-l">Hisse realize</div><div class="pr-ovh-v">${fmtTRY0(stkReal)}</div></div>
      <div class="pr-ovh-c ${cls(optReal)}"><div class="pr-ovh-l">Opsiyon realize</div><div class="pr-ovh-v">${fmtTRY0(optReal)}</div></div>
    </div>${optReal < 0 && stkReal > 0 ? `<div class="pr-flag">⚠️ Opsiyonlar net zarar, hisseler net kâr. Tezine sadık kal: opsiyon kovalamak yerine hisse tut.</div>` : ""}`;
  const panel4 = `<div class="pr-block">
    <div class="pr-h2">🧬 Faktör & Maruziyet</div>
    <div class="pr-fac-grid">
      <div><div class="pr-sub">Momentum (güç sırası)</div><div class="pr-mo">${momoRows || "<div class='pr-hint'>veri yok</div>"}</div></div>
      <div><div class="pr-sub">Tema yoğunlaşması</div><div class="pr-th">${themeRows || "<div class='pr-hint'>veri yok</div>"}</div>
        <div class="pr-sub" style="margin-top:12px">Opsiyon vs Hisse (realize)</div>${ovsH}</div>
    </div>
  </div>`;

  el.innerHTML = panel1 + panel2 + panel3 + panel4;
}
// Hedef ağırlık düzenleme
$("#proRiskBox")?.addEventListener("click", async (e) => {
  if (!e.target.closest("[data-pr-edit-targets]")) return;
  const t = proTargets();
  const labels = { core: "Çekirdek (uzun vade) %", satellite: "Uydu (swing) %", cash: "Nakit %", other: "Altın+Opsiyon %" };
  const next = { ...t };
  for (const k of ["core", "satellite", "cash", "other"]) {
    const v = await promptDialog({ title: labels[k], message: "Hedef ağırlık (%). Toplam 100 olmalı.", value: String(t[k]), suffix: "%" });
    if (v == null) return; next[k] = v;
  }
  const sum = next.core + next.satellite + next.cash + next.other;
  if (Math.abs(sum - 100) > 0.5) return toast(`Toplam %${sum.toFixed(0)} — 100 olmalı`, "err");
  localStorage.setItem(PRO_TARGETS_KEY, JSON.stringify(next));
  toast("Hedef ağırlıklar güncellendi");
  renderProRisk();
});

/* ===== Risk & Performans Karnesi — günlük net-değer serisinden trader metrikleri ===== */
function renderRisk() {
  const el = $("#riskBox"); if (!el) return;
  const S = STATE;
  const usdtry = S?.fx?.usdtry || 0;
  // Net değer serisi → USD (her snapshot kendi günkü kuruyla çevrilir)
  const series = (S?.history || [])
    .filter((s) => s.total != null)
    .map((s) => ({ date: s.date, v: s.usdtry ? s.total / s.usdtry : (usdtry ? s.total / usdtry : s.total) }))
    .filter((p) => p.v > 0);

  if (series.length < 8) {
    el.innerHTML = `<div class="rk-empty">Risk metrikleri ve ileri tahmin için yeterli geçmiş yok. Her gün otomatik bir net-değer kaydı (snapshot) alınır; ~2 hafta sonra Sharpe, volatilite, düşüş ve tahmin anlamlı olur.
      <div class="rk-empty-bar"><div class="rk-empty-fill" style="width:${Math.min(100, series.length / 14 * 100).toFixed(0)}%"></div></div>
      <b>${series.length}/14 gün</b> birikti.</div>`;
    return;
  }

  // Günlük getiriler
  const rets = [];
  for (let i = 1; i < series.length; i++) {
    const r = series[i].v / series[i - 1].v - 1;
    if (isFinite(r)) rets.push(r);
  }
  const n = rets.length;
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (n > 1 ? n - 1 : 1);
  const sd = Math.sqrt(variance);
  const dn = rets.filter((r) => r < 0);
  const dSd = dn.length ? Math.sqrt(dn.reduce((a, b) => a + b * b, 0) / dn.length) : 0;
  const ANN = Math.sqrt(252);
  const annVol = sd * ANN;
  const sharpe = sd > 0 ? (mean / sd) * ANN : null;
  const sortino = dSd > 0 ? (mean / dSd) * ANN : null;

  // Toplam getiri + CAGR (gerçek gün sayısına göre)
  const v0 = series[0].v, vN = series[series.length - 1].v;
  const totRet = vN / v0 - 1;
  const days = Math.max(1, (new Date(series[series.length - 1].date) - new Date(series[0].date)) / 86400000);
  const cagr = v0 > 0 ? Math.pow(vN / v0, 365 / days) - 1 : null;

  // Maksimum düşüş + şu anki düşüş (underwater)
  let peak = -Infinity, maxDD = 0;
  const dd = series.map((p) => { peak = Math.max(peak, p.v); const d = p.v / peak - 1; maxDD = Math.min(maxDD, d); return d; });
  const curDD = dd[dd.length - 1];

  const best = Math.max(...rets), worst = Math.min(...rets);
  const posRatio = rets.filter((r) => r > 0).length / n;

  // Konsantrasyon (holdings piyasa değerinden)
  const mvs = (S?.holdings || [])
    .filter((h) => h.type === "stock" && h.live?.marketValueUSD != null)
    .map((h) => ({ sym: String(h.symbol).toUpperCase(), mv: h.live.marketValueUSD }));
  const totMV = mvs.reduce((a, b) => a + b.mv, 0);
  let hhi = null, effN = null, topW = null, topSym = null;
  if (totMV > 0 && mvs.length) {
    hhi = mvs.reduce((a, b) => a + (b.mv / totMV) ** 2, 0);
    effN = 1 / hhi;
    const top = mvs.slice().sort((a, b) => b.mv - a.mv)[0];
    topW = (top.mv / totMV) * 100; topSym = top.sym;
  }

  // biçim yardımcıları
  const pf = (frac, d = 1) => (frac == null || !isFinite(frac) ? "—" : `${frac >= 0 ? "+" : ""}${(frac * 100).toFixed(d)}%`);
  const pp = (frac, d = 0) => (frac == null || !isFinite(frac) ? "—" : `${(frac * 100).toFixed(d)}%`);
  const rat = (x, d = 2) => (x == null || !isFinite(x) ? "—" : x.toFixed(d));
  const shCls = sharpe == null ? "" : sharpe >= 1 ? "pos" : sharpe < 0 ? "neg" : "";
  const shLbl = sharpe == null ? "" : sharpe >= 2 ? "çok iyi" : sharpe >= 1 ? "sağlıklı" : sharpe >= 0 ? "zayıf" : "riskli";

  const hero = (lbl, val, sub, c = "", tip = "") =>
    `<div class="rk-card"><div class="rk-card-lbl">${lbl}${tip ? tipIcon(tip) : ""}</div><div class="rk-card-val ${c}">${val}</div><div class="rk-card-sub">${sub}</div></div>`;
  const st = (lbl, val, c = "") => `<div class="rk-stat"><span>${lbl}</span><b class="${c}">${val}</b></div>`;

  const note = `Sharpe <b class="${shCls}">${rat(sharpe)}</b>${shLbl ? ` (${shLbl})` : ""} — getirini aldığın riske göre okur. ` +
    `En kötü anda zirveden <b class="neg">${pp(maxDD)}</b> düştün${curDD < -0.005 ? `, şu an <b class="neg">${pp(curDD)}</b> altındasın` : ", şu an zirveye yakınsın"}. ` +
    (effN != null ? `Gerçekte <b>${effN.toFixed(1)}</b> pozisyona dağılmışsın${topSym ? ` (en ağır <b>${topSym}</b> %${topW.toFixed(0)})` : ""}${effN < 2.5 || (topW && topW > 40) ? ` — yoğunlaşma yüksek, tek hisse seni sallayabilir (Kural 1).` : "."}` : "");

  // ===== İleriye dönük tahmin (geometrik Brownian — geçmiş getiri eğilimi + oynaklık) =====
  const muLog = mean - variance / 2;            // günlük log-sürüklenme
  const HZ = 126;                               // ~6 ay iş günü
  const z25 = 0.674;                            // %25–75 bandı için z-skoru
  const proj = [];
  for (let t = 1; t <= HZ; t++) {
    const drift = muLog * t, vol = sd * Math.sqrt(t);
    proj.push({ t, med: vN * Math.exp(drift), lo: vN * Math.exp(drift - z25 * vol), hi: vN * Math.exp(drift + z25 * vol) });
  }
  const pEnd = proj[proj.length - 1];           // 6 ay sonu medyan/alt/üst
  const p3 = proj[Math.min(proj.length - 1, 62)]; // ~3 ay (63 iş günü)
  const MILES = [10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2500000, 5000000];
  const milestone = MILES.find((m) => m > vN) || Math.ceil(vN / 1e6 + 1) * 1e6;
  const Lm = Math.log(milestone / vN);          // hedefe log-mesafe
  // analitik varış (iş günü): muLog·t ± z·sd·√t = Lm  →  x=√t için ikinci derece denklem
  const etaT = (sign) => { if (muLog <= 0) return null; const b = sign * z25 * sd; const x = (-b + Math.sqrt(b * b + 4 * muLog * Lm)) / (2 * muLog); return x > 0 ? x * x : null; };
  const bdMon = (bd) => (bd == null ? null : bd / 21);   // iş günü → ay
  const etaFmt = (mon) => (mon == null ? "belirsiz" : mon < 1.2 ? `~${Math.max(1, Math.round(mon * 4.3))} hafta` : mon <= 18 ? `~${Math.round(mon)} ay` : `~${(mon / 12).toFixed(1)} yıl`);
  const etaMed = etaT(0), etaFast = etaT(1), etaSlow = etaT(-1);
  const fcText = muLog > 0
    ? `Mevcut tempoda <b>${fmtUSD0(milestone)}</b> eşiği medyan <b>${etaFmt(bdMon(etaMed))}</b> uzakta — iyimser ${etaFmt(bdMon(etaFast))}, temkinli ${etaFmt(bdMon(etaSlow))}. <b>3 ay</b> sonra medyan ≈ <b>${fmtUSD0(p3.med)}</b>, <b>6 ay</b> ≈ <b>${fmtUSD0(pEnd.med)}</b> (olası ${fmtUSD0(pEnd.lo)}–${fmtUSD0(pEnd.hi)}).`
    : `Son ${series.length} günün eğilimi yatay/negatif — bu tempoda <b>${fmtUSD0(milestone)}</b> eşiği için anlamlı varış süresi yok. 3 ay olası ${fmtUSD0(p3.lo)}–${fmtUSD0(p3.hi)}, 6 ay <b>${fmtUSD0(pEnd.lo)}–${fmtUSD0(pEnd.hi)}</b>. Eğilim pozitife dönünce netleşir.`;

  // ===== Getiri kaynak dökümü: kilitli realize + açık kâğıt kâr + opsiyon (Kaan: "48% nereden?") =====
  const realizedTot = Object.values(REALIZED_USD || {}).reduce((a, b) => a + (b || 0), 0);
  const unrealTot = (S?.holdings || []).filter((h) => h.type === "stock").reduce((a, h) => {
    const px = h.live?.priceUSD, q = h.quantity, c = h.costUSD;
    return (px != null && q != null && c != null) ? a + (px - c) * q : a;
  }, 0);
  const optTot = (S?.options || []).reduce((a, o) => a + (Number(o.plUSD) || 0), 0);
  const srcTot = realizedTot + unrealTot + optTot;
  const srcAbs = Math.max(Math.abs(realizedTot), Math.abs(unrealTot), Math.abs(optTot), 1);
  const srcRow = (lbl, val, note2) => `<div class="rk-src-row">
    <span class="rk-src-l">${lbl}<i>${note2}</i></span>
    <span class="rk-src-track"><span class="rk-src-bar ${val >= 0 ? "pos" : "neg"}" style="width:${(Math.abs(val) / srcAbs * 100).toFixed(0)}%"></span></span>
    <span class="rk-src-v ${cls(val)}">${val >= 0 ? "+" : ""}${fmtUSD0(val)}</span></div>`;
  const srcBlock = `<div class="rk-src">
    <div class="rk-src-head"><b>Getiri nereden geliyor?</b> <span class="rk-src-tot ${cls(srcTot)}">toplam kâr ${srcTot >= 0 ? "+" : ""}${fmtUSD0(srcTot)}</span></div>
    ${srcRow("💵 Kilitli realize", realizedTot, "satılan · cebe girdi, kaybedilemez")}
    ${srcRow("📈 Açık kâğıt kâr", unrealTot, "hâlâ piyasada · riskli")}
    ${optTot !== 0 ? srcRow("⚙️ Opsiyon", optTot, "açık opsiyon K/Z") : ""}
    <div class="rk-src-note">Kilitli kısım büyükse tezin işliyor — kârı cebe koyup ana parayı büyütüyorsun. Kâğıt kâr geri verilebilir; kademeli realize ile kilitle (Kural 1).</div>
  </div>`;

  // ===== Sağlık skoru (Sharpe + düşüş + çeşitlendirme → tek okunur değer) =====
  let hs = 50;
  if (sharpe != null) hs += Math.max(-26, Math.min(26, sharpe * 13));
  hs += Math.max(-26, maxDD * 100 * 0.9);
  if (effN != null) hs += Math.max(-14, Math.min(10, (effN - 2) * 6));
  hs = Math.round(Math.max(3, Math.min(99, hs)));
  const hLbl = hs >= 75 ? "güçlü" : hs >= 55 ? "sağlıklı" : hs >= 40 ? "dikkat" : "kırılgan";
  const hCls = hs >= 75 ? "pos" : hs >= 55 ? "" : hs >= 40 ? "warn" : "neg";

  // ===== Birleşik grafik: geçmiş net değer + tahmin medyanı + %25–75 bandı + eşik =====
  const W = 720, HC = 250, pad = { l: 6, r: 70, t: 16, b: 24 };
  const base = series.length - 1;
  const spanX = base + HZ;
  const xAt = (i) => pad.l + (i / spanX) * (W - pad.l - pad.r);
  const pastMax = Math.max(...series.map((p) => p.v)), pastMin = Math.min(...series.map((p) => p.v));
  const hiEnd = pEnd.hi, loEnd = pEnd.lo;
  const yMax = Math.max(pastMax, hiEnd) * 1.06;
  const yMin = Math.max(0, Math.min(pastMin, loEnd) * 0.96);
  const showMile = milestone <= yMax;   // eşik ancak görüş alanındaysa çizilir
  const yAt = (v) => pad.t + (1 - (Math.max(yMin, Math.min(yMax, v)) - yMin) / (yMax - yMin)) * (HC - pad.t - pad.b);
  const pastPts = series.map((p, i) => [xAt(i), yAt(p.v)]);
  const pastD = smoothPath(pastPts);
  const areaD = `${pastD} L ${xAt(base).toFixed(1)} ${yAt(yMin).toFixed(1)} L ${xAt(0).toFixed(1)} ${yAt(yMin).toFixed(1)} Z`;
  const medD = smoothPath([[xAt(base), yAt(vN)], ...proj.map((p) => [xAt(base + p.t), yAt(p.med)])]);
  const hiPts = proj.map((p) => [xAt(base + p.t), yAt(p.hi)]);
  const loPts = proj.map((p) => [xAt(base + p.t), yAt(p.lo)]);
  const bandPts = [[xAt(base), yAt(vN)], ...hiPts, ...loPts.reverse()].map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const yMile = yAt(milestone), xToday = xAt(base);
  const chartSvg = `<svg class="rk-fc-svg" viewBox="0 0 ${W} ${HC}" preserveAspectRatio="none" aria-hidden="true">
    <polygon points="${bandPts}" fill="var(--green-soft)" opacity=".8"/>
    <path d="${areaD}" fill="var(--up-soft)"/>
    ${showMile ? `<line x1="${pad.l}" y1="${yMile.toFixed(1)}" x2="${(W - pad.r).toFixed(1)}" y2="${yMile.toFixed(1)}" stroke="var(--ink2)" stroke-width="1" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>` : ""}
    <line x1="${xToday.toFixed(1)}" y1="${pad.t}" x2="${xToday.toFixed(1)}" y2="${(HC - pad.b).toFixed(1)}" stroke="var(--line-strong)" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>
    <path d="${pastD}" fill="none" stroke="var(--green)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <path d="${medD}" fill="none" stroke="var(--green-d)" stroke-width="1.8" stroke-dasharray="5 4" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  </svg>`;

  el.innerHTML = `
    <div class="rk-top">
      <div class="rk-health">
        <div class="rk-health-score ${hCls}">${hs}<span>/100</span></div>
        <div class="rk-health-lbl">Portföy sağlığı · <b class="${hCls}">${hLbl}</b></div>
        <div class="rk-hbar"><span class="rk-hmark" style="left:${hs}%"></span></div>
        <div class="rk-health-sub">Sharpe ${rat(sharpe)} · maks. düşüş ${pp(maxDD)} · ${effN != null ? effN.toFixed(1) + " etkin pozisyon" : "—"}</div>
      </div>
      <div class="rk-heads">
        ${hero("Toplam Getiri", `<span class="${cls(totRet)}">${pf(totRet)}</span>`, `${Math.round(days)} günde · ${fmtUSD0(vN - v0)}`)}
        ${hero("Maks. Düşüş", `<span class="neg">${pp(maxDD)}</span>`, curDD < -0.005 ? `şu an ${pp(curDD)}` : "şu an zirvede", "", "Zirveden dibe en derin kayıp — en kötü anda ne kadar acıya katlandın.")}
        ${hero("Çeşitlendirme", effN != null ? effN.toFixed(1) : "—", topSym ? `en ağır ${topSym} %${topW.toFixed(0)}` : "etkin pozisyon", effN != null && effN < 2.5 ? "neg" : "", "Kaç bağımsız pozisyona dağılmışsın (1/HHI). Düşükse tek hisse seni sallar — Kural 1.")}
      </div>
    </div>

    ${srcBlock}

    <div class="rk-fc">
      <div class="rk-fc-head"><b>Net değer · 6 ay ileri tahmin</b><span class="rk-fc-cap">geçmiş eğilim + oynaklıktan türetildi</span></div>
      <div class="rk-fc-chart">
        ${chartSvg}
        ${showMile ? `<span class="rk-fc-mile" style="top:${(yMile / HC * 100).toFixed(1)}%">${fmtUSD0(milestone)}</span>` : ""}
        <span class="rk-fc-today" style="left:${(xToday / W * 100).toFixed(1)}%">bugün</span>
      </div>
      <div class="rk-legend">
        <span><i class="lg-line"></i> geçmiş</span>
        <span><i class="lg-dash"></i> tahmin (medyan)</span>
        <span><i class="lg-band"></i> %25–75 olası aralık</span>
        ${showMile ? `<span><i class="lg-mile"></i> ${fmtUSD0(milestone)} eşiği</span>` : ""}
      </div>
      <div class="rk-fc-eta">${fcText}</div>
    </div>

    <div class="rk-grid rk-grid-sm">
      ${st("Sharpe", `${rat(sharpe)}${shLbl ? ` · ${shLbl}` : ""}`, shCls)}
      ${st("Yıllık Volatilite", pp(annVol))}
      ${st("En İyi / Kötü Gün", `${pf(best)} / ${pf(worst)}`)}
      ${st("Pozitif Gün", pp(posRatio), posRatio >= 0.5 ? "pos" : "")}
    </div>
    ${benchmarkBlock(series, totRet, days, pf)}
    <div class="rk-note">${note} <span class="rk-disc">Tahmin geçmiş volatiliteden türetilen bir <b>olasılık aralığıdır</b>, garanti değil.</span></div>`;
}

/* Benchmark: portföy TWR getirisi vs S&P 500 (SPY) + Nasdaq-100 (QQQ) — aynı pencerede.
 * "Piyasayı yeniyor muyum?" Fark (alpha) pozitifse evet. */
let BENCH = { data: null, _loading: false };
async function loadBenchmark() {
  if (BENCH.data || BENCH._loading) return;
  BENCH._loading = true;
  try { BENCH.data = await (await fetch("/api/benchmark")).json(); if ($("#riskBox")) renderRisk(); }
  catch {} finally { BENCH._loading = false; }
}
function benchReturn(series, d0, d1) {
  if (!series?.length) return null;
  const at = (target) => { let v = null; for (const p of series) { if (p.date <= target) v = p.close; else break; } return v; };
  const c0 = at(d0), c1 = at(d1);
  return (c0 && c1) ? (c1 / c0 - 1) : null;
}
function benchmarkBlock(series, totRet, days, pf) {
  if (!BENCH.data) { loadBenchmark(); return ""; }
  const d0 = series[0].date, d1 = series[series.length - 1].date;
  const spy = benchReturn(BENCH.data.SPY, d0, d1), qqq = benchReturn(BENCH.data.QQQ, d0, d1);
  if (spy == null && qqq == null) return "";
  const row = (lbl, r) => {
    if (r == null) return "";
    const alpha = totRet - r;
    return `<div class="bm-row"><span class="bm-lbl">${lbl}</span><b class="${cls(r)}">${pf(r)}</b>
      <span class="bm-alpha ${cls(alpha)}">${alpha >= 0 ? "▲" : "▼"} ${pf(alpha)}</span></div>`;
  };
  return `<div class="rk-bench">
    <div class="bm-head">📊 Benchmark <span class="sw-muted">aynı ${Math.round(days)} günde · piyasayı yendin mi?</span></div>
    <div class="bm-rows">
      <div class="bm-row bm-port"><span class="bm-lbl">Portföyün</span><b class="${cls(totRet)}">${pf(totRet)}</b><span class="bm-alpha">—</span></div>
      ${row("S&P 500 · SPY", spy)}
      ${row("Nasdaq-100 · QQQ", qqq)}
    </div>
    <div class="bm-note">Sağdaki fark = alpha (portföy − endeks). Pozitifse piyasayı yendin. Getiri günlük değişimlerden (TWR) — para giriş/çıkışı bozmaz.</div>
  </div>`;
}

/* ===== Pozisyon Teknikleri — her holding'in trader metrikleri (h.sig'ten) ===== */
function renderPosTech() {
  const el = $("#posTechBox"); if (!el) return;
  const stocks = (STATE?.holdings || []).filter((h) => h.type === "stock" && h.live?.priceUSD != null);
  if (!stocks.length) { el.innerHTML = `<div class="rk-empty">USD hisse pozisyonu yok.</div>`; return; }
  const anySig = stocks.some((h) => h.sig && h.sig.rsi != null);

  const sgn = (v, d = 0, suf = "%") => (v == null || !isFinite(v) ? `<span class="pt-na">—</span>` : `<span class="${cls(v)}">${v >= 0 ? "+" : ""}${v.toFixed(d)}${suf}</span>`);

  const rows = stocks.map((h) => {
    const sig = h.sig || {};
    const sym = String(h.symbol).toUpperCase();
    const price = h.live.priceUSD;
    const cost = Number(h.costUSD) || null;
    const gainPct = sig.gainPct != null ? sig.gainPct : (cost ? ((price - cost) / cost) * 100 : null);

    // Sinyal rozeti (buildSignal'dan)
    const sg = sig.signal || null;
    const sgCls = sg ? (sg.tone === "buy" ? "pt-buy" : sg.tone === "sell" ? "pt-sell" : "pt-neutral") : "pt-neutral";
    const sgCell = sg ? `<span class="pt-sig ${sgCls}">${sg.label}</span>` : `<span class="pt-na">—</span>`;

    // RSI (>70 ısınmış kırmızı, <30 aşırı satım yeşil)
    const rsi = sig.rsi;
    const rsiCls = rsi == null ? "" : rsi >= 70 ? "neg" : rsi <= 30 ? "pos" : "";
    const rsiCell = rsi == null ? `<span class="pt-na">—</span>` : `<b class="${rsiCls}">${rsi.toFixed(0)}</b>`;

    // Trend: fiyat vs SMA50 / SMA200
    const a50 = sig.sma50 != null ? price >= sig.sma50 : null;
    const a200 = sig.sma200 != null ? price >= sig.sma200 : null;
    let trCell = `<span class="pt-na">—</span>`;
    if (a50 != null && a200 != null) {
      if (a50 && a200) trCell = `<span class="pt-tr pos" title="Fiyat SMA50 ve SMA200 üstünde — yükseliş trendi">▲ güçlü</span>`;
      else if (!a50 && !a200) trCell = `<span class="pt-tr neg" title="Fiyat SMA50 ve SMA200 altında — düşüş trendi">▼ zayıf</span>`;
      else trCell = `<span class="pt-tr warn" title="SMA50/200 arasında — kararsız">◆ karışık</span>`;
    } else if (a50 != null) trCell = a50 ? `<span class="pt-tr pos" title="SMA50 üstünde">▲</span>` : `<span class="pt-tr neg" title="SMA50 altında">▼</span>`;

    // Açık R = açık kâr / planlı risk (stop varsa)
    const stop = h.planStop ?? sig.swing?.stop ?? null;
    let rCell = `<span class="pt-na">—</span>`;
    if (cost && stop != null && cost - stop > 0) {
      const openR = (price - cost) / (cost - stop);
      rCell = `<b class="${cls(openR)}" title="Açık kârın ${Math.abs(openR).toFixed(1)} risk birimi (stop ${fmtUSD(stop)})">${openR >= 0 ? "+" : ""}${openR.toFixed(1)}R</b>`;
    }

    return `<tr>
      <td class="l"><b>${sym}</b></td>
      <td class="l">${sgCell}</td>
      <td>${rsiCell}</td>
      <td>${trCell}</td>
      <td>${sgn(sig.fromHighPct, 0)}</td>
      <td>${sgn(sig.upsidePct, 0)}</td>
      <td>${sgn(gainPct, 1)}</td>
      <td>${rCell}</td>
    </tr>`;
  }).join("");

  el.innerHTML = `
    <div class="tbl-wrap"><table class="pt-table">
      <thead><tr>
        <th class="l">Sembol</th><th class="l">Sinyal</th>
        <th>RSI</th><th>Trend</th>
        <th>52h Zirve</th><th>Analist Hedef</th><th>K/Z</th>
        <th>Açık R</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="pt-note">${anySig
      ? "RSI &gt; 70 ısınmış · &lt; 30 aşırı satım. Trend = fiyatın SMA50/200'e göre yeri. 52h Zirve = 52 hafta zirvesinden uzaklık. Analist Hedef = ortalama hedefe potansiyel. Açık R = açık kârın stopuna göre kaç risk birimi (Kural 1)."
      : "📡 Teknik veriler henüz taranıyor (RSI/SMA/52h analist). Birkaç dakika sonra tazele — ek API maliyeti olmadan günlük taramadan gelir."}</div>`;
}

/* ====================== Alfa Avı — AI oyun-parası swing challenge (İLERİYE DÖNÜK) ======================
 * BUGÜNDEN itibaren canlı hesap: $1.500 nakit, gerçek portföyden BAĞIMSIZ. Yapay zekâ kuralına göre
 * SADECE tetik oluşunca pozisyon açar (asla stop'suz girmez), riske göre boyutlar (~%3/işlem), hedef/stop
 * ile bekler; hedef → sat (nakde), stop → kes (nakde), sonra yeni işlem. Strateji: Swing Momentum
 * (8/21/50 EMA) + Qullamaggie teyidi. Geçmiş "gir-çık" listesi yok — bugünden ileri gerçek mumlarla işler. */
const CHALLENGE = {
  startCapital: 1500, goal: 2500, startDate: "2026-07-01",
  riskPct: 3, tp1: 6, tp2: 12, trailEma: "EMA21",
  minNotional: 350, maxNotional: 850,
  // Evren dinamik: Radar + Swing defterindeki TÜM semboller + çekirdek liste (chUniverse doldurur)
  coreWatch: ["NVDA", "AMD", "MU", "NBIS", "INTC", "SNDK", "TSLA", "SOFI", "NOW"],
  maxSyms: 60,               // API nezaketi: evren üst sınırı (QM evreni bağlanınca 40→60)
  watch: [],
  _sym: {}, _loaded: false,
  _frozen: new Map(),        // sunucudaki immutable defter (id → plan)
  _posted: new Set(),        // bu oturumda POST'lananlar (tekrar göndermeyi önler)
};

/* Endeks (QQQ) rejim filtresi — araştırma: Qullamaggie QQQ 10/20MA altında kırılım almaz;
 * 8-21 EMA okulu "ikisinin altı = bekle" der. Kuralımız (günlük kapanışla):
 *   QQQ > EMA8 ve > EMA21  → on      (normal boyut)
 *   QQQ < EMA8, ≥ EMA21    → caution (yeni girişte yarım boyut — erken uyarı)
 *   QQQ < EMA21            → off     (YENİ GİRİŞ KAPALI; açık pozisyonlar kurallarıyla yönetilir) */
CHALLENGE.indexSym = "QQQ";
/* RAI ETF'leri: VIXY = VIX vadelileri (opsiyon piyasasının korku fiyatlaması — put/call verisi
 * ücretsiz planlarda yok, bu onun likit vekili) · HYG/IEF = kredi iştahı · XLY/XLP = rotasyon */
CHALLENGE.raiSyms = ["VIXY", "HYG", "IEF", "XLY", "XLP"];
async function chLoadIndex() {
  const need = [CHALLENGE.indexSym, ...CHALLENGE.raiSyms].filter((s) => !CHALLENGE._sym[s]);
  await Promise.all(need.map(async (sym) => {
    try {
      const d = await (await fetch(`/api/chart?symbol=${encodeURIComponent(sym)}`)).json();
      const v = Array.isArray(d.candles) ? d.candles : [];
      if (v.length < 30) return;
      CHALLENGE._sym[sym] = { v, ema8: chEMA(v, 8), ema21: chEMA(v, 21), ema50: chEMA(v, 50), vma: chVMA(v, 20), idx: Object.fromEntries(v.map((c, i) => [c.time, i])) };
    } catch {}
  }));
  // Oran serileri (kredi/rotasyon) — pay serisi omurga, payda en yakın önceki bar
  CHALLENGE._credit = chRatioSer(CHALLENGE._sym.HYG, CHALLENGE._sym.IEF);
  CHALLENGE._rot = chRatioSer(CHALLENGE._sym.XLY, CHALLENGE._sym.XLP);
}

/* ---- RİSK İŞTAHI ENDEKSİ (RAI 0-100) — formüller server.js chRaiAt ile BİREBİR AYNI ----
 * trend .30 (QQQ EMA dizilimi) · vol .20 (VIXY↔EMA21 sapması, ters) · kredi .20 (HYG/IEF)
 * · rotasyon .10 (XLY/XLP) · genişlik .20 (evrende EMA21 üstü % + 20g zirve−dip).
 * Bant: ≥65 risk-on · 45-64 nötr · 30-44 temkin (yarım boyut) · <30 risk-off (giriş yok).
 * Nihai rejim = fiyat kapısı (QQQ EMA) ile RAI'den KÖTÜ olanı — RAI asla gevşetmez.
 * Kalibrasyon: 7 Nis 2025 çöküşü=2 · Haz 2026 rallisi=86 (315 günlük doğrulama). */
const chRaiClamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));
const chNearBar = (ser, d) => { if (!ser) return null; let i = ser.idx[d]; if (i == null) { for (i = ser.v.length - 1; i >= 0 && ser.v[i].time > d; i--); } return i != null && i >= 0 ? i : null; };
const chRatioSer = (a, b) => { if (!a || !b) return null; const v = []; for (let i = 0; i < a.v.length; i++) { const j = chNearBar(b, a.v[i].time); if (j == null) continue; v.push({ time: a.v[i].time, close: a.v[i].close / b.v[j].close }); } return v.length >= 30 ? { v, ema21: chEMA(v, 21), idx: Object.fromEntries(v.map((c, i) => [c.time, i])) } : null; };
const chRaiBand = (s) => s == null ? null : s >= 65 ? "riskon" : s >= 45 ? "notr" : s >= 30 ? "temkin" : "riskoff";
const chRaiBandTR = {
  riskon: ["risk-on", "piyasa iştahlı — girişler normal boyutta"],
  notr: ["nötr", "ne korku ne coşku — normal kurallar, fiyat kapısı belirleyici"],
  temkin: ["temkin", "iştah zayıflıyor — yeni girişler YARIM boyut"],
  riskoff: ["risk-off", "korku baskın — YENİ GİRİŞ YOK"],
};
const chWorseSt = (a, b) => { const r = { on: 0, caution: 1, off: 2 }; return (r[a] ?? 0) >= (r[b] ?? 0) ? a : b; };
// Bilanço karartması: bilançoya ≤3 gün kala YENİ giriş yok (veri yoksa engelleme — dürüst varsayılan)
const chEarnBlockedC = (sym, d) => { const e = (CHALLENGE._earn || {})[sym]; if (!e) return false; const diff = (Date.parse(e) - Date.parse(d)) / 86400000; return diff >= 0 && diff <= 3; };
// RS (göreli güç) — aynı gün birden çok tetikte güçlü olan önce (QM: en güçlü ata bin)
const chRS = (s, i) => { const v = s.v, ret = (n) => i >= n && v[i - n] ? v[i].close / v[i - n].close - 1 : 0; return 0.5 * ret(63) + 0.3 * ret(21) + 0.2 * ret(126); };
function chRaiAt(d) {
  const comps = {}, w = {};
  { const Q = CHALLENGE._sym[CHALLENGE.indexSym], i = chNearBar(Q, d);
    if (i != null && i >= 50) { const c = Q.v[i].close; let s = 50;
      s += c > Q.ema21[i] ? 18 : -28; s += c > Q.ema8[i] ? 12 : -8;
      if (Q.ema21[i] > Q.ema50[i]) s += 10; if (i >= 10 && Q.ema50[i] > Q.ema50[i - 10]) s += 10;
      comps.trend = chRaiClamp(s); w.trend = 0.30; } }
  { // Volatilite: gerçek VIX (FRED) varsa seviye+sapma; yoksa VIXY sapması (contango→seviye anlamsız)
    const V = CHALLENGE._vixSer ? { ser: CHALLENGE._vixSer, kind: "vix" } : CHALLENGE._sym.VIXY ? { ser: CHALLENGE._sym.VIXY, kind: "vixy" } : null;
    const i = V ? chNearBar(V.ser, d) : null;
    if (i != null && i >= 21) {
      const x = V.ser.v[i].close, pct = x / V.ser.ema21[i] - 1;
      comps.vol = chRaiClamp(Math.round(V.kind === "vix" ? 140 - 4.2 * x - pct * 80 : 55 - pct * 550));
      w.vol = 0.20; } }
  { const C = CHALLENGE._credit, i = chNearBar(C, d);
    if (i != null && i >= 21) { const r = C.v[i].close, pct = r / C.ema21[i] - 1, sl = i >= 10 ? r / C.v[i - 10].close - 1 : 0;
      comps.credit = chRaiClamp(Math.round(50 + pct * 4000 + sl * 1500)); w.credit = 0.20; } }
  { const R = CHALLENGE._rot, i = chNearBar(R, d);
    if (i != null && i >= 21) { const r = R.v[i].close, pct = r / R.ema21[i] - 1, sl = i >= 10 ? r / R.v[i - 10].close - 1 : 0;
      comps.rot = chRaiClamp(Math.round(50 + pct * 1500 + sl * 800)); w.rot = 0.10; } }
  { let n = 0, ab = 0, nh = 0, nl = 0;
    for (const sym of CHALLENGE.watch) {
      const s = CHALLENGE._sym[sym], i = chNearBar(s, d);
      if (i == null || i < 21) continue;
      n++;
      if (s.v[i].close > s.ema21[i]) ab++;
      const cs = s.v.slice(i - 19, i + 1).map((x) => x.close);
      if (s.v[i].close >= Math.max(...cs)) nh++;
      if (s.v[i].close <= Math.min(...cs)) nl++;
    }
    if (n >= 5) { const above = (ab / n) * 100, nhl = ((nh - nl) / n) * 100;
      comps.breadth = chRaiClamp(Math.round(0.7 * above + 0.3 * chRaiClamp(50 + nhl * 1.2))); w.breadth = 0.20; } }
  const wSum = Object.values(w).reduce((a, b) => a + b, 0);
  if (!wSum) return null;
  let s = 0; for (const k of Object.keys(comps)) s += comps[k] * w[k];
  return { score: Math.round(s / wSum), comps };
}
function chRaiToday() {
  const q = CHALLENGE._sym[CHALLENGE.indexSym] || CHALLENGE._sym.VIXY;
  if (!q) return null;
  return chRaiAt(q.v[q.v.length - 1].time);
}

// Fiyat kapısı (yalnız QQQ EMA) — RAI ile birleşmeden önceki ham durum
function chEmaGateAt(d) {
  const q = CHALLENGE._sym[CHALLENGE.indexSym];
  if (!q) return "on"; // endeks verisi yoksa engelleme (dürüst varsayılan: filtre pasif)
  const i = chNearBar(q, d);
  if (i == null || i < 21) return "on";
  const c = q.v[i].close;
  if (c < q.ema21[i]) return "off";
  if (c < q.ema8[i]) return "caution";
  return "on";
}
// Nihai rejim = fiyat kapısı ∨ RAI bandı (kötü olan kazanır)
function chRegimeAt(d) {
  const g = chEmaGateAt(d);
  const rb = chRaiBand(chRaiAt(d)?.score);
  return chWorseSt(g, rb === "riskoff" ? "off" : rb === "temkin" ? "caution" : "on");
}
function chRegimeToday() {
  const q = CHALLENGE._sym[CHALLENGE.indexSym];
  const rai = chRaiToday();
  if (!q) return { state: "on", txt: "endeks verisi yok — filtre pasif", qqq: null, rai, emaState: "on" };
  const i = q.v.length - 1, c = q.v[i].close;
  const emaSt = c < q.ema21[i] ? "off" : c < q.ema8[i] ? "caution" : "on";
  const rb = chRaiBand(rai?.score);
  const st = chWorseSt(emaSt, rb === "riskoff" ? "off" : rb === "temkin" ? "caution" : "on");
  let txt = emaSt === "off"
    ? `QQQ ${c.toFixed(2)} < EMA21 ${q.ema21[i].toFixed(2)} — piyasa riskli, YENİ GİRİŞ KAPALI`
    : emaSt === "caution"
      ? `QQQ ${c.toFixed(2)} < EMA8 ${q.ema8[i].toFixed(2)} (EMA21 üstünde) — dikkat, yarım boyut`
      : `QQQ ${c.toFixed(2)} > EMA8 & EMA21 — piyasa sağlıklı`;
  if (rai) {
    txt += ` · risk iştahı ${rai.score}/100 (${chRaiBandTR[rb][0]})`;
    if (st !== emaSt) txt += " — kısıt RAI'den geliyor"; // fiyat müsait ama iştah bozuk (erken uyarı)
  }
  return { state: st, txt, qqq: c, rai, emaState: emaSt };
}

// Açılan planı sunucu defterine bir kez yaz (idempotent; evren değişse de karar kaymaz)
function chFreeze(t) {
  if (CHALLENGE._frozen.has(t.id) || CHALLENGE._posted.has(t.id)) return;
  CHALLENGE._posted.add(t.id);
  fetch("/api/challenge/open", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: t.id, sym: t.sym, date: t.date, entry: t.entry, stop: t.stop, tp1: t.tp1, tp2: t.tp2, notional: t.notional, shares: t.shares, rai: t.rai ?? null }),
  }).catch(() => CHALLENGE._posted.delete(t.id));
}

// Evreni topla: Radar taraması + Swing defteri sembolleri + çekirdek (tekilleştirilmiş)
async function chUniverse() {
  const syms = new Set(CHALLENGE.coreWatch);
  try {
    const r = await (await fetch("/api/radar")).json();
    (r.items || r.stocks || []).forEach((s) => { const x = String(s.symbol || "").toUpperCase(); if (x) syms.add(x); });
  } catch {}
  try {
    const d = await (await fetch("/api/swing-trades")).json();
    (d.trades || []).forEach((t) => { const x = String(t.symbol || "").toUpperCase(); if (x) syms.add(x); });
  } catch {}
  // QM tarayıcı evreni bağlantısı (görünüm kaldırıldı): Cuma Hoca + portföy + izleme listesi —
  // adaylar artık burada, $1.500 sanal hesapla GERÇEK işleme dönüşür
  try {
    const c = await (await fetch("/api/cuma")).json();
    (Array.isArray(c) ? c : []).forEach((x) => { const s = String(x.symbol || "").toUpperCase(); if (s) syms.add(s); });
  } catch {}
  (STATE?.holdings || []).forEach((h) => { if (h.type === "stock" && h.symbol) syms.add(String(h.symbol).toUpperCase()); });
  (STATE?.watchlist || []).forEach((w) => { const s = String(typeof w === "string" ? w : w.symbol || "").toUpperCase(); if (s) syms.add(s); });
  return [...syms].slice(0, CHALLENGE.maxSyms);
}
const chEMA = (v, p) => { const k = 2 / (p + 1); let e = null; return v.map((c) => (e = e == null ? c.close : c.close * k + e * (1 - k))); };
const chVMA = (v, p) => v.map((c, i) => i < p - 1 ? null : v.slice(i - p + 1, i + 1).reduce((a, b) => a + b.volume, 0) / p);
const chADR = (v, i, p = 20) => { let s = 0, k = 0; for (let j = i - p + 1; j <= i; j++) { if (j < 0) continue; s += (v[j].high - v[j].low) / v[j].close; k++; } return k ? (s / k) * 100 : null; };
const chFmtD = (d) => { if (!d) return "—"; const x = new Date(d); return `${x.getUTCDate()} ${["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"][x.getUTCMonth()]}`; };
const chSize = (entry, stop) => { const frac = (entry - stop) / entry; const riskUSD = CHALLENGE.startCapital * CHALLENGE.riskPct / 100; return Math.max(CHALLENGE.minNotional, Math.min(CHALLENGE.maxNotional, riskUSD / Math.max(0.001, frac))); };

async function chLoad() {
  // Donmuş defter (immutable açılışlar) — evrenden önce gelsin ki sembolleri de yüklensin
  try {
    const led = await (await fetch("/api/challenge")).json();
    (led.trades || []).forEach((t) => { if (t && t.id) CHALLENGE._frozen.set(t.id, t); });
    // Sunucudan gelen bağlam: bilanço takvimi (karartma), sektörler (tavan), gerçek VIX (FRED)
    CHALLENGE._earn = led.earnings || {};
    CHALLENGE._sect = led.sectors || {};
    if (Array.isArray(led.vix) && led.vix.length >= 60) {
      const v = led.vix;
      CHALLENGE._vixSer = { v, ema21: chEMA(v, 21), idx: Object.fromEntries(v.map((c, i) => [c.time, i])) };
    }
  } catch {}
  const universe = await chUniverse();
  for (const t of CHALLENGE._frozen.values()) if (!universe.includes(t.sym)) universe.push(t.sym);
  await chLoadIndex(); // QQQ rejim filtresi — evrenle birlikte yüklenir (watch'a girmez)
  // Parti parti yükle (5'erli) — 30+ sembolde API'yi boğmadan; mum çoğunlukla sunucu önbelleğinden gelir
  const one = async (sym) => {
    try {
      const d = await (await fetch(`/api/chart?symbol=${encodeURIComponent(sym)}`)).json();
      const v = Array.isArray(d.candles) ? d.candles : [];
      if (v.length < 60) return;
      CHALLENGE._sym[sym] = { v, ema8: chEMA(v, 8), ema21: chEMA(v, 21), ema50: chEMA(v, 50), vma: chVMA(v, 20), idx: Object.fromEntries(v.map((c, i) => [c.time, i])) };
    } catch {}
  };
  for (let i = 0; i < universe.length; i += 5) await Promise.all(universe.slice(i, i + 5).map(one));
  CHALLENGE.watch = universe.filter((s) => CHALLENGE._sym[s]); // sadece verisi olanlar
}

// Birleşik giriş sinyali (EMA 8/21/50 + QM teyidi) — belirli bir barda tetik
function chSignal(sym, i) {
  const s = CHALLENGE._sym[sym]; if (!s || i < 60) return null;
  const v = s.v, c = v[i];
  const up = c.close > s.ema50[i] && s.ema21[i] > s.ema50[i] && s.ema50[i] > s.ema50[i - 10];
  const low5 = Math.min(...v.slice(i - 4, i + 1).map((x) => x.close));
  const pullback = low5 < s.ema8[i - 1];
  const crossover = c.close > s.ema8[i] && v[i - 1].close <= s.ema8[i - 1];
  const volOk = s.vma[i] != null && c.volume > s.vma[i];
  const hi60 = Math.max(...v.slice(i - 60, i + 1).map((x) => x.high));
  const nearHigh = c.close >= 0.8 * hi60;
  const adr = chADR(v, i);
  if (!(up && pullback && crossover && volOk && nearHigh && adr >= 3)) return null;
  const stop = Math.max(Math.min(c.low, v[i - 1].low), c.close - 1.2 * (adr / 100) * c.close);
  return { sym, i, date: c.time, entry: c.close, stop, ema8: s.ema8[i], ema21: s.ema21[i], ema50: s.ema50[i], volRatio: c.volume / s.vma[i], adr, nearHighPct: (c.close / hi60 - 1) * 100, priorLeg: (c.close / Math.min(...v.slice(i - 40, i - 10).map((x) => x.close)) - 1) * 100 };
}

// BUGÜNDEN ileri: $1.500 nakit ile kronolojik sim (tetikte aç, kademeli çıkış + iz süren stop)
function chRun() {
  const P = CHALLENGE, ts = P._sym[P.watch.find((s) => P._sym[s])];
  if (!ts) return { positions: [], equity: [], cash: P.startCapital };
  const dates = ts.v.map((c) => c.time).filter((d) => d >= P.startDate);
  let cash = P.startCapital; const positions = [], equity = [];
  const lastClose = (sym) => { const v = P._sym[sym].v; return v[v.length - 1].close; };
  const todayISO = new Date().toISOString().slice(0, 10);
  // Donmuş açılışları tarihe göre indexle — o gün geldiğinde AYNEN uygulanır (sinyal yeniden sorgulanmaz)
  const frozenByDate = {};
  for (const t of P._frozen.values()) (frozenByDate[t.date] ||= []).push(t);
  for (const d of dates) {
    const regime = chRegimeAt(d);
    const defensive = regime === "off"; // piyasa kötü → savunma: iz süren EMA8'e sıkışır, kâr başa-başa kilitlenir
    for (const p of positions.filter((x) => x.open)) {
      const s = P._sym[p.sym], i = s.idx[d]; if (i == null) continue; const c = s.v[i];
      const te = P.trailEma === "EMA8" ? s.ema8[i] : s.ema21[i];
      const effStop = p.tp1hit ? p.entry : p.stop;
      if (c.low <= effStop) { const fr = p.rem, px = effStop, pnl = fr * p.shares * (px - p.entry); cash += fr * p.shares * px; p.realized += pnl; p.events.push({ d, k: (p.stop >= p.entry && !p.tp1hit) ? "def" : p.tp1hit ? "be" : "stop", px, fr, pnl }); p.rem = 0; p.open = false; p.exitDate = d; continue; }
      if (!p.tp1hit && c.high >= p.tp1) { const fr = 0.25, pnl = fr * p.shares * (p.tp1 - p.entry); cash += fr * p.shares * p.tp1; p.realized += pnl; p.rem -= fr; p.tp1hit = true; p.events.push({ d, k: "tp1", px: p.tp1, fr, pnl }); }
      if (p.tp1hit && !p.tp2hit && c.high >= p.tp2) { const fr = 0.25, pnl = fr * p.shares * (p.tp2 - p.entry); cash += fr * p.shares * p.tp2; p.realized += pnl; p.rem -= fr; p.tp2hit = true; p.events.push({ d, k: "tp2", px: p.tp2, fr, pnl }); }
      if (p.open && p.rem > 0 && c.close < te) { const fr = p.rem, pnl = fr * p.shares * (c.close - p.entry); cash += fr * p.shares * c.close; p.realized += pnl; p.events.push({ d, k: "trail", px: c.close, fr, pnl }); p.rem = 0; p.open = false; p.exitDate = d; }
      // Savunma modu (rejim off): kârdaki pozisyonun stopu başa-başa ratchet'lenir (bar sonu, tek yön yukarı)
      if (defensive && p.open && !p.tp1hit && c.close > p.entry) p.stop = Math.max(p.stop, p.entry);
    }
    const held = new Set(positions.filter((x) => x.open).map((x) => x.sym));
    // 1) O günün DONMUŞ açılışları — plan aynen uygulanır (immutable; evren değişse de kaymaz)
    for (const f of frozenByDate[d] || []) {
      if (held.has(f.sym) || positions.some((p) => p.id === f.id)) continue;
      const s = P._sym[f.sym]; const i = s ? s.idx[d] : null;
      const disp = (s && i != null ? chSignal(f.sym, i) : null) || {}; // sadece gerekçe metni için analitik
      cash -= f.notional;
      positions.push({ ...disp, id: f.id, sym: f.sym, date: f.date, entry: f.entry, stop: f.stop, tp1: f.tp1, tp2: f.tp2, notional: f.notional, shares: f.shares, frozen: true, rem: 1, tp1hit: false, tp2hit: false, realized: 0, open: true, events: [] });
      held.add(f.sym);
    }
    // 2) Yeni sinyaller — açılır açılmaz sunucu defterine dondurulur (kapanmış barlar)
    // Rejim kapısı: off ise O GÜN yeni giriş YOK (açıklar savunma modunda yönetilmeye devam eder)
    if (regime === "off") { let mtm0 = 0; for (const p of positions.filter((x) => x.open)) { const s = P._sym[p.sym]; mtm0 += p.rem * p.shares * s.v[s.idx[d]].close; } equity.push({ d, v: +(cash + mtm0).toFixed(2) }); continue; }
    const raiD = chRaiAt(d);
    const sigs = P.watch.filter((sym) => P._sym[sym] && P._sym[sym].idx[d] != null && !held.has(sym)).map((sym) => chSignal(sym, P._sym[sym].idx[d])).filter(Boolean)
      .sort((a, b) => chRS(P._sym[b.sym], b.i) - chRS(P._sym[a.sym], a.i) || b.volRatio - a.volRatio); // önce göreli güç (QM), eşitse hacim
    for (const sig of sigs) {
      const id = `${sig.date}-${sig.sym}`;
      if (P._frozen.has(id)) continue; // donmuşsa 1. adımda zaten açıldı
      if (chEarnBlockedC(sig.sym, d)) continue; // bilanço karartması (≤3 gün)
      const sct = (P._sect || {})[sig.sym];
      if (sct && positions.some((p) => p.open && (P._sect || {})[p.sym] === sct)) continue; // sektör tavanı
      let notional = chSize(sig.entry, sig.stop);
      if (regime === "caution") notional = Math.max(280, +(notional / 2).toFixed(0)); // erken uyarı → yarım boyut
      if (cash < notional) continue;
      cash -= notional;
      const t = { ...sig, id, notional, shares: notional / sig.entry, tp1: sig.entry * (1 + P.tp1 / 100), tp2: sig.entry * (1 + P.tp2 / 100), rai: raiD ? raiD.score : null, rem: 1, tp1hit: false, tp2hit: false, realized: 0, open: true, events: [] };
      positions.push(t);
      held.add(sig.sym);
      if (d < todayISO) chFreeze(t); // gün kapanmışsa karar kesindir → dondur (bugünün barı hâlâ oluşuyor olabilir)
    }
    let mtm = 0; for (const p of positions.filter((x) => x.open)) { const s = P._sym[p.sym]; mtm += p.rem * p.shares * s.v[s.idx[d]].close; }
    equity.push({ d, v: +(cash + mtm).toFixed(2) });
  }
  for (const p of positions) { p.initRisk = p.shares * (p.entry - p.stop); p.R = p.initRisk > 0 ? +(p.realized / p.initRisk).toFixed(2) : 0; if (p.open) { p.mark = lastClose(p.sym); p.unreal = +(p.rem * p.shares * (p.mark - p.entry)).toFixed(2); } }
  return { positions, equity, cash };
}

// İzleme listesi: bugün her sembol tetiğe ne kadar yakın (kurulum oluşuyor mu?)
// openSyms: açık pozisyonlar — "neden girilmedi?" gerekçesi için
function chWatch(openSyms) {
  const P = CHALLENGE, out = [], held = openSyms || new Set();
  const fmtD = chFmtD;
  const reg = chRegimeToday();
  for (const sym of P.watch) {
    const s = P._sym[sym]; if (!s) continue;
    const v = s.v, i = v.length - 1, c = v[i];
    const up = c.close > s.ema50[i] && s.ema21[i] > s.ema50[i] && s.ema50[i] > s.ema50[i - 10];
    const hi60 = Math.max(...v.slice(i - 60, i + 1).map((x) => x.high));
    const nearHigh = c.close >= 0.82 * hi60;
    const adr = chADR(v, i);
    const low7 = Math.min(...v.slice(i - 6, i + 1).map((x) => x.low));
    const pulled = low7 <= s.ema8[i] * 1.02;
    const trig = s.ema8[i];                       // tetik = EMA8'i hacimle geri al
    const distPct = (trig - c.close) / c.close * 100;   // + ise fiyat bu kadar yükselip EMA8'i almalı
    const above = c.close > trig;
    let status;
    if (!up) status = "off";                      // trend dışı — aday değil
    else if (above && pulled) status = "ready";   // EMA8 üstünde + yeni geri çekilmeden döndü → tetik bölgesi
    else if (nearHigh && pulled && distPct <= 4) status = "forming"; // EMA8'e yakın, kırılım yaklaşıyor
    else status = "watch";                         // trendde ama uzak
    const entry = above ? c.close : trig;
    const stop = Math.max(Math.min(c.low, v[i - 1].low), entry - 1.2 * (adr / 100) * entry);
    const notional = chSize(entry, stop);
    // ── "Neden girilmedi?" — SON EMA8 kırılım gününü bul ve o günün koşullarını değerlendir ──
    let why = "";
    if (held.has(sym)) why = "pozisyon zaten açık";
    else if (status === "off") why = "trend filtresi dışı (EMA dizilimi bozuk)";
    else if (!above) why = `tetik bekleniyor: EMA8 ${fmtUSD(trig)} hacimle geri alınmalı (+%${Math.max(0, distPct).toFixed(1)})`;
    else {
      let cross = null;
      for (let j = i; j > Math.max(60, i - 45); j--) {
        if (v[j].close > s.ema8[j] && v[j - 1].close <= s.ema8[j - 1]) {
          const volOkJ = s.vma[j] != null && v[j].volume > s.vma[j];
          const hi60J = Math.max(...v.slice(j - 60, j + 1).map((x) => x.high));
          const upJ = v[j].close > s.ema50[j] && s.ema21[j] > s.ema50[j] && s.ema50[j] > s.ema50[j - 10];
          cross = { date: v[j].time, volOk: volOkJ, nearHigh: v[j].close >= 0.8 * hi60J, up: upJ, isToday: j === i && v[j].time >= new Date().toISOString().slice(0, 10) };
          break;
        }
      }
      if (!cross) why = "uzun süredir EMA8 üstünde — giriş için yeni geri çekilme → kırılım döngüsü gerek";
      else if (cross.date < P.startDate) why = `kırılım ${fmtD(cross.date)}'de, hesap başlamadan önce — geçmişe girilmez; sıradaki döngü beklenir`;
      else if (cross.isToday) why = "kırılım BUGÜN — bar kapanınca (gün sonu) koşullar tutuyorsa otomatik açılır";
      else if (!cross.volOk) why = `${fmtD(cross.date)} kırılımı hacimsizdi (20g ort. altı) — hacimsiz kırılıma girilmez`;
      else if (!cross.nearHigh) why = `${fmtD(cross.date)} kırılımında fiyat 6-ay zirvesinden çok uzaktı — QM filtresi pas dedi`;
      else if (!cross.up) why = `${fmtD(cross.date)} kırılımında trend filtresi (EMA50 eğimi) sağlanmadı`;
      else why = `${fmtD(cross.date)} kırılımında nakit/eşzamanlılık ya da rejim filtresi (endeks/risk iştahı) müsait değildi`;
    }
    // Bilanço karartması / sektör tavanı — bekleme sebebi olarak açıkça yazılır
    if (!held.has(sym) && status !== "off") {
      const eDate = (P._earn || {})[sym];
      if (eDate && chEarnBlockedC(sym, new Date().toISOString().slice(0, 10)))
        why = `📊 bilanço karartması: bilanço ${fmtD(eDate)} (≤3 gün) — bilanço gecesine pozisyon taşınmaz` + (why ? ` · ${why}` : "");
      else {
        const sct = (P._sect || {})[sym];
        const clash = sct && [...held].find((h) => (P._sect || {})[h] === sct);
        if (clash) why = `sektör tavanı: ${clash} aynı sektörde açık (${sct}) — sektör başına 1 pozisyon` + (why ? ` · ${why}` : "");
      }
    }
    if (reg.state === "off" && !held.has(sym) && status !== "off") why = `⛔ REJİM KAPALI: ${reg.txt}` + (why ? ` · ayrıca: ${why}` : "");
    out.push({ sym, status, close: c.close, trig, distPct, adr, nearHigh, up, entry, stop, tp2: entry * (1 + P.tp2 / 100), notional, riskUSD: (notional * (entry - stop) / entry), why });
  }
  const rank = { ready: 0, forming: 1, watch: 2, off: 3 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || a.distPct - b.distPct);
}

function chEntryWhy(p) {
  const riskPct = ((p.entry - p.stop) / p.entry) * 100;
  const plan = `→ Giriş $${p.entry.toFixed(2)}, stop $${p.stop.toFixed(2)} (−%${riskPct.toFixed(1)}, risk ${fmtUSD0(p.initRisk || (p.shares * (p.entry - p.stop)))}), TP1 +%${CHALLENGE.tp1}, TP2 +%${CHALLENGE.tp2}, kalan ${CHALLENGE.trailEma} iz süren stop. Pozisyon ~${fmtUSD0(p.notional)}.${p.rai != null ? ` Girişte risk iştahı <b>${p.rai}/100</b>.` : ""}${p.frozen ? ` <span class="ch-frozen" title="Sunucu defterine yazıldı — evren değişse de bu karar değişmez">🔒 defterde</span>` : ""}`;
  if (p.ema50 == null || p.ema8 == null) // donmuş kayıt (analitik yeniden üretilemedi) — plan yine de kesin
    return `<b>Giriş — neden?</b> Strateji tetiği gününde koşullar sağlandı (yükseliş trendi + geri çekilme + hacimli EMA8 kırılımı + QM teyidi); plan sunucu defterinden aynen uygulanıyor. ${plan}`;
  return `<b>Giriş — neden?</b> Yükseliş trendi: fiyat $${p.entry.toFixed(2)} &gt; EMA50 $${p.ema50.toFixed(2)}; EMA21 &gt; EMA50. Geri çekilme sonrası EMA8'i ($${p.ema8.toFixed(2)}) <b>hacimle</b> geri aldı (hacim 20g ort. <b>${(p.volRatio ?? 1).toFixed(1)}×</b>). QM: 6-ay zirvesine %${Math.abs(p.nearHighPct ?? 0).toFixed(0)} yakın, önceki bacak <b>+%${(p.priorLeg ?? 0).toFixed(0)}</b>, ADR %${(p.adr ?? 0).toFixed(1)}. ${plan}`;
}
function chExitWhy(p) {
  const li = (t) => `<li>${t}</li>`;
  const evs = p.events.map((e) => {
    if (e.k === "tp1") return li(`<span class="win-c">TP1 (+%${CHALLENGE.tp1})</span> ${chFmtD(e.d)}: %25 kâr alındı (+${fmtUSD0(e.pnl)}); stop <b>başa-baş</b>a çekildi.`);
    if (e.k === "tp2") return li(`<span class="win-c">TP2 (+%${CHALLENGE.tp2})</span> ${chFmtD(e.d)}: %25 daha kâr alındı (+${fmtUSD0(e.pnl)}).`);
    if (e.k === "trail") return li(`İz süren stop ${chFmtD(e.d)}: kalan %${(e.fr * 100).toFixed(0)}, ${CHALLENGE.trailEma} altında $${e.px.toFixed(2)}'de çıktı (${e.pnl >= 0 ? "+" : ""}${fmtUSD0(e.pnl)}).`);
    if (e.k === "def") return li(`<span class="neu-c">🛡 Savunma stopu</span> ${chFmtD(e.d)}: piyasa risk-off'a geçince stop başa-başa çekilmişti, $${e.px.toFixed(2)}'de risksiz kapandı (kâr kilidi korudu, ${e.pnl >= 0 ? "+" : ""}${fmtUSD0(e.pnl)}).`);
    if (e.k === "be") return li(`<span class="neu-c">Başa-baş stop</span> ${chFmtD(e.d)}: kalan %${(e.fr * 100).toFixed(0)} risksiz kapandı (±$0).`);
    return li(`<span class="loss-c">Stop</span> ${chFmtD(e.d)}: stop $${e.px.toFixed(2)} deldi, kapatıldı (${fmtUSD0(e.pnl)}).`);
  }).join("");
  if (p.open) {
    const pct = ((p.mark - p.entry) / p.entry) * 100;
    return `<b>Durum — açık.</b> ${chFmtD(p.date)} girildi, %${(p.rem * 100).toFixed(0)} taşınıyor. Şu an $${p.mark.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%), etkin stop $${(p.tp1hit ? p.entry : p.stop).toFixed(2)}.${evs ? `<ul class="ch-ev">${evs}</ul>` : " "}Hedef/stop gerçek mumlarla otomatik ölçülür.`;
  }
  const pct = p.notional ? (p.realized / p.notional) * 100 : 0;
  const verdict = p.realized > 1 ? `<span class="win-c">KÂR</span>` : p.realized < -1 ? `<span class="loss-c">ZARAR</span>` : `<span class="neu-c">BAŞA-BAŞ</span>`;
  return `<b>Çıkış — neden?</b><ul class="ch-ev">${evs}</ul><b>Sonuç: ${verdict}</b> — net ${p.realized >= 0 ? "+" : ""}${fmtUSD0(p.realized)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% · ${p.R >= 0 ? "+" : ""}${p.R}R).`;
}

async function renderChallenge() {
  const el = $("#challengeBox"); if (!el) return;
  if (!CHALLENGE._loaded) {
    el.innerHTML = `<div class="rk-empty">Alfa Avı — Radar + Swing evreni toplanıyor, kurulumlar gerçek mumlarda taranıyor…</div>`;
    await chLoad(); CHALLENGE._loaded = true;
  }
  const { positions, equity, cash } = chRun();
  const closed = positions.filter((p) => !p.open), open = positions.filter((p) => p.open);
  const realized = positions.reduce((s, p) => s + p.realized, 0);
  const unreal = open.reduce((s, p) => s + (p.unreal || 0), 0);
  const equityNow = CHALLENGE.startCapital + realized + unreal;
  const cashNow = (cash != null ? cash : CHALLENGE.startCapital);
  const wins = closed.filter((p) => p.realized > 1), losses = closed.filter((p) => p.realized < -1);
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const totPct = (equityNow / CHALLENGE.startCapital - 1) * 100;
  const goalPct = Math.max(0, Math.min(100, ((equityNow - CHALLENGE.startCapital) / (CHALLENGE.goal - CHALLENGE.startCapital)) * 100));

  const setup = () => `<span class="ch-setup brk">EMA 8/21/50</span><span class="ch-setup pb">QM</span>`;

  // OPEN kartları
  const openCards = open.length ? open.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).map((p) => `
    <div class="ch-card open" data-chsym="${p.sym}" title="Grafiği aç — ${p.sym}"><div class="ch-card-top"><div class="ch-card-sym"><b>${p.sym}</b> ${setup()}</div>
      <div class="ch-card-r"><span class="ch-pill open">Açık</span><span class="ch-card-pnl ${cls(p.unreal)}">${p.unreal >= 0 ? "+" : ""}${fmtUSD0(p.unreal)}</span><span class="ch-card-rr ${cls(p.R)}">${p.R >= 0 ? "+" : ""}${p.R}R</span></div></div>
    <div class="ch-card-dt">${chFmtD(p.date)} → açık · ~${fmtUSD0(p.notional)} pozisyon</div>
    <div class="ch-why">${chEntryWhy(p)}</div><div class="ch-why">${chExitWhy(p)}</div></div>`).join("") : "";

  // İZLEME LİSTESİ (kurulum oluşuyor mu?) — trend dışılar tek satırda toplanır (evren geniş)
  const wl = chWatch(new Set(open.map((p) => p.sym)));
  const wlAct = wl.filter((w) => w.status !== "off");
  const wlOff = wl.filter((w) => w.status === "off");
  const wpill = (st) => st === "ready" ? `<span class="ch-pill win">Tetik bölgesi</span>` : st === "forming" ? `<span class="ch-pill open">Oluşuyor</span>` : `<span class="ch-pill neu">Trendde</span>`;
  const wlRows = wlAct.map((w) => `<tr class="wl-${w.status}" data-chsym="${w.sym}" title="Grafiği aç — ${w.sym}">
    <td class="l"><b>${w.sym}</b></td><td>${wpill(w.status)}</td><td>${fmtUSD(w.close)}</td>
    <td class="${w.distPct <= 0 ? "win-c" : ""}">${w.distPct <= 0 ? "EMA8 üstü ✓" : `+${w.distPct.toFixed(1)}%`}</td>
    <td>${fmtUSD(w.entry)} · <span class="loss-c">${fmtUSD0(w.stop)}</span> · <span class="win-c">${fmtUSD0(w.tp2)}</span></td>
    <td>~${fmtUSD0(w.notional)} <span class="sw-muted">(risk ${fmtUSD0(w.riskUSD)})</span></td>
    <td class="l wl-why">${w.why || "—"}</td></tr>`).join("")
    || `<tr><td colspan="7" class="ch-none">Şu an trendde aday yok — evren taranmaya devam ediyor.</td></tr>`;
  const wlOffLine = wlOff.length ? `<div class="wl-off-line">Trend dışı (aday değil): ${wlOff.map((w) => w.sym).join(" · ")}</div>` : "";

  const regNow = chRegimeToday();
  const regBadge = regNow.state === "off"
    ? `<div class="ch-regime off">⛔ <b>Rejim filtresi: YENİ GİRİŞ KAPALI.</b> ${regNow.txt}.${open.length ? ` <b>🛡 Savunma modu:</b> açık ${open.length} pozisyonda kârdakilerin stopu başa-başa kilitlendi (hedeften önce zorla çıkış yok, ama piyasa dönerse kâr korunuyor).` : ""} Koşullar düzelince girişler otomatik açılır.</div>`
    : regNow.state === "caution"
      ? `<div class="ch-regime warn">🟡 <b>Rejim uyarısı:</b> ${regNow.txt}. Yeni girişler yarım boyutla açılır.</div>`
      : `<div class="ch-regime on">🟢 <b>Rejim sağlıklı:</b> ${regNow.txt}.</div>`;
  // ── Risk İştahı Endeksi paneli — 5 bileşen, günlük; kural: <30 giriş yok · 30-44 yarım boyut ──
  const rai = regNow.rai;
  const raiPanel = rai ? (() => {
    const band = chRaiBand(rai.score);
    const [lbl, expl] = chRaiBandTR[band];
    const tone = band === "riskon" ? "on" : band === "notr" ? "neu" : band === "temkin" ? "warn" : "off";
    const compLbl = { trend: "Endeks trendi · QQQ", vol: CHALLENGE._vixSer ? "Volatilite · VIX (FRED)" : "Volatilite · VIXY", credit: "Kredi iştahı · HYG/IEF", rot: "Rotasyon · XLY/XLP", breadth: "Genişlik · evren" };
    const chip = (k) => rai.comps[k] == null ? "" : `<span class="rai-chip ${rai.comps[k] >= 65 ? "pos" : rai.comps[k] >= 45 ? "neu" : rai.comps[k] >= 30 ? "warn" : "neg"}" title="${compLbl[k]}"><i>${compLbl[k]}</i><b>${rai.comps[k]}</b></span>`;
    return `<div class="rai-panel ${tone}">
      <div class="rai-left"><div class="rai-score">${rai.score}</div><div class="rai-score-l">RİSK İŞTAHI<span>/100</span></div></div>
      <div class="rai-main">
        <div class="rai-band"><b>${lbl.toUpperCase()}</b> — ${expl}.</div>
        <div class="rai-bar"><span class="rai-tick" style="left:30%"></span><span class="rai-tick" style="left:45%"></span><span class="rai-tick" style="left:65%"></span><div class="rai-fill" style="width:${rai.score}%"></div></div>
        <div class="rai-comps">${["trend", "vol", "credit", "rot", "breadth"].map(chip).join("")}</div>
        <div class="rai-note">Volatilite (VIX vadelileri = opsiyon piyasasının korku fiyatlaması), kredi ve rotasyon çoğu zaman fiyattan <b>önce</b> bozulur. Kural: <b>&lt;30 giriş yok</b> · <b>30-44 yarım boyut</b> · fiyat kapısıyla birleşik, <b>kötü olan kazanır</b> (RAI asla gevşetmez).</div>
      </div>
    </div>`;
  })() : "";
  el.innerHTML = `
    <div class="ch-strat">Strateji: <b>Swing Momentum (8/21/50 EMA)</b> + <b>Qullamaggie</b> teyidi · <b>bugünden ileri</b> canlı hesap · evren: <b>Radar + Swing defteri (${CHALLENGE.watch.length} hisse)</b> · sadece tetikte açar (asla stop'suz değil) · riske göre ~%${CHALLENGE.riskPct}/işlem · kademeli kâr-al (TP1 +%${CHALLENGE.tp1}/TP2 +%${CHALLENGE.tp2}, sonra ${CHALLENGE.trailEma} iz süren stop) · <b>rejim kapısı: QQQ &lt; EMA21 veya risk iştahı &lt; 30 → giriş yok</b> · aynı gün çok tetikte <b>göreli güç</b> önce · <b>bilanço karartması</b>: bilançoya ≤3 gün kala giriş yok · <b>sektör tavanı</b>: sektör başına 1 pozisyon.</div>
    ${raiPanel}
    ${regBadge}
    <div class="ch-kpis">
      <div class="ch-kpi hero"><div class="ch-k-l">SERMAYE</div><div class="ch-k-v">${fmtUSD0(equityNow)}</div>
        <div class="ch-k-s ${cls(equityNow - CHALLENGE.startCapital)}">${equityNow - CHALLENGE.startCapital >= 0 ? "▲ +" : "▼ "}${fmtUSD0(equityNow - CHALLENGE.startCapital)} · ${totPct >= 0 ? "+" : ""}${totPct.toFixed(1)}% · başlangıç ${fmtUSD0(CHALLENGE.startCapital)}</div></div>
      <div class="ch-kpi"><div class="ch-k-l">NAKİT</div><div class="ch-k-v">${fmtUSD0(cashNow)}</div><div class="ch-k-s">${open.length} açıkta ${fmtUSD0(open.reduce((s, p) => s + (p.notional || 0), 0))}</div></div>
      <div class="ch-kpi"><div class="ch-k-l">REALİZE K/Z</div><div class="ch-k-v ${cls(realized)}">${realized >= 0 ? "+" : ""}${fmtUSD0(realized)}</div><div class="ch-k-s">${closed.length} kapanan${closed.length ? ` · %${winRate.toFixed(0)} isabet` : ""}</div></div>
      <div class="ch-kpi"><div class="ch-k-l">AÇIK POZİSYON</div><div class="ch-k-v">${open.length}</div><div class="ch-k-s">${unreal >= 0 ? "+" : ""}${fmtUSD0(unreal)} açık K/Z</div></div>
    </div>
    <div class="ch-goal"><div class="ch-goal-top"><span>Hedef: <b>${fmtUSD0(CHALLENGE.startCapital)} → ${fmtUSD0(CHALLENGE.goal)}</b></span><span class="ch-goal-pct">%${goalPct.toFixed(0)} yolda</span></div>
      <div class="ch-goalbar"><div class="ch-goalfill" style="width:${goalPct.toFixed(1)}%"></div></div></div>

    <div class="ch-h ch-h-tbl">Açık pozisyonlar <span class="ch-sub">gerçek fiyatla canlı · hedef/stop otomatik</span></div>
    ${open.length ? `<div class="ch-jrnl">${openCards}</div>` : `<div class="ch-empty-box">Şu an açık pozisyon yok. Sistem <b>tetik</b> bekliyor — kural olmadan (stop'suz) girmez. Aşağıdaki izleme listesi hangi hisselerin kuruluma yaklaştığını gösterir.</div>`}

    <div class="ch-h ch-h-tbl">İzleme listesi — kurulum oluşuyor mu? <span class="ch-sub">tetik = EMA8'i hacimle geri almak · sonra otomatik giriş</span></div>
    <div class="tbl-wrap"><table class="ch-table wl-table"><thead><tr><th class="l">Sembol</th><th>Durum</th><th>Fiyat</th><th>Tetiğe Uzaklık</th><th>Plan (giriş·stop·hedef)</th><th>~Pozisyon</th><th class="l">Neden bekliyor?</th></tr></thead><tbody>${wlRows}</tbody></table></div>
    ${wlOffLine}

    ${closed.length ? `<div class="ch-h ch-h-tbl">Kapanan işlemler — gerekçeli <span class="ch-sub">bugünden beri</span></div>
    <div class="ch-jrnl">${closed.slice().sort((a, b) => new Date(b.exitDate) - new Date(a.exitDate)).map((p) => {
      const st = p.realized > 1 ? "win" : p.realized < -1 ? "loss" : "neu";
      const pill = st === "win" ? `<span class="ch-pill win">Kâr</span>` : st === "loss" ? `<span class="ch-pill loss">Zarar</span>` : `<span class="ch-pill neu">Başa-baş</span>`;
      return `<div class="ch-card ${st}"><div class="ch-card-top"><div class="ch-card-sym"><b>${p.sym}</b> ${setup()}</div><div class="ch-card-r">${pill}<span class="ch-card-pnl ${cls(p.realized)}">${p.realized >= 0 ? "+" : ""}${fmtUSD0(p.realized)}</span><span class="ch-card-rr ${cls(p.R)}">${p.R >= 0 ? "+" : ""}${p.R}R</span></div></div><div class="ch-card-dt">${chFmtD(p.date)} → ${chFmtD(p.exitDate)}</div><div class="ch-why">${chEntryWhy(p)}</div><div class="ch-why">${chExitWhy(p)}</div></div>`;
    }).join("")}</div>` : ""}

    <div class="ch-note">Oyun parasıdır, gerçek portföyden bağımsızdır, <b>kâr garantisi değildir</b>. Hesap <b>bugün $${CHALLENGE.startCapital} ile başlar</b> ve ileriye doğru işler: kurallar sağlanınca (tetik) pozisyon açılır, <b>her işlemde stop vardır</b>, riske göre boyutlanır; hedef→sat, stop→kes, nakit serbest kalınca yeni işlem. Kazanç da kayıp da dürüst gösterilir.</div>`;
}

/* ===== Alfa Avı tetik şeridi — ana sayfada kuruluma yaklaşan hisseler (sekmeye girmeden haber) ===== */
let _huntKicked = false;
function renderHuntStrip() {
  const el = $("#huntStrip"); if (!el) return;
  if (!CHALLENGE._loaded) {
    el.hidden = true;
    // Arka planda bir kez yükle (oturum başına); mumlar çoğunlukla sunucu önbelleğinden gelir
    if (!_huntKicked) {
      _huntKicked = true;
      setTimeout(async () => { try { await chLoad(); CHALLENGE._loaded = true; renderHuntStrip(); } catch {} }, 2500);
    }
    return;
  }
  const reg = chRegimeToday();
  const wl = chWatch().filter((w) => w.status === "ready" || w.status === "forming").slice(0, 4);
  if (!wl.length && reg.state === "on") { el.hidden = true; return; }
  el.hidden = false;
  const raiP = reg.rai ? ` · Rİ ${reg.rai.score}` : "";
  const regPill = reg.state === "off"
    ? `<span class="hunt-pill reg-off">⛔ Rejim kapalı — yeni giriş yok${raiP}</span>`
    : reg.state === "caution" ? `<span class="hunt-pill reg-warn">🟡 Temkin — yarım boyut${raiP}</span>`
    : reg.rai && chRaiBand(reg.rai.score) === "riskon" ? `<span class="hunt-pill">Rİ ${reg.rai.score} risk-on</span>` : "";
  el.innerHTML = `<div class="hunt-strip">
    <span class="hunt-ic">${svgIcon("target")}</span>
    <div class="hunt-body"><b>Alfa Avı</b>${regPill}${wl.map((w) => `<button class="hunt-pill${w.status === "ready" ? " rdy" : ""}" data-hunt="1"><b>${w.sym}</b> <span>${w.distPct <= 0 ? "tetik bölgesinde ✓" : `tetiğe +%${w.distPct.toFixed(1)}`}</span></button>`).join("")}</div>
    <button class="btn ghost sm" data-hunt="1">Ava git →</button>
  </div>`;
}
$("#huntStrip")?.addEventListener("click", (e) => { if (e.target.closest("[data-hunt]")) showView("challenge"); });

function renderAnaliz() {
  renderAnalizSummary();
  renderProRisk();
  renderRealizeSummary();
  renderRisk();
  renderPosTech();
  renderHeatmap();
  renderSector();
  renderAiDesk();
  renderWeekly();
  // Sinyal Karnesi + Sinyal İsabeti kaldırıldı (3 Tem 2026) — Alfa Avı aynı işi yapıyor
  // (sinyal üretimi + gerçek stop/hedef sonucu takibi). Backend endpoint'leri dormant kalır.
}

/* ====================== Portföy Önerileri (akıllı öneri akışı) ====================== */
const RI_KIND = {
  risk:    { icon: "🛑", lbl: "Risk",    cls: "ri-risk" },
  "kar-al":{ icon: "✂️", lbl: "Kâr-al",  cls: "ri-kar" },
  firsat:  { icon: "📈", lbl: "Fırsat",  cls: "ri-firsat" },
  denge:   { icon: "⚖️", lbl: "Denge",   cls: "ri-denge" },
  rejim:   { icon: "🌡️", lbl: "Rejim",   cls: "ri-rejim" },
};
function renderRule1() { // panel: "Portföy Önerileri" (#rule1Panel id'si korunur)
  const el = $("#rule1Panel");
  if (!el) return;
  const ins = STATE?.insights;
  if (!ins || !ins.items) { el.innerHTML = ""; return; }
  const rows = ins.items.map((x) => {
    const k = RI_KIND[x.kind] || RI_KIND.denge;
    return `<li class="ri-row ${k.cls}">
      <span class="ri-tag">${k.icon} ${k.lbl}</span>
      <span class="ri-body"><b class="ri-title">${x.title}</b>${x.detail ? `<span class="ri-detail">${x.detail}</span>` : ""}</span>
      ${x.action ? `<span class="ri-act">→ ${x.action}</span>` : ""}
    </li>`;
  }).join("");
  const tone = ins.grade === "saglam" ? "pos" : ins.grade === "dikkat" ? "mid" : "neg";
  const collapsed = collapseSavedCollapsed("insightsPanel");
  el.innerHTML = `
    <section class="panel insights collapsible${collapsed ? " is-collapsed" : ""}" id="insightsPanel">
      <div class="panel-head">
        <div class="panel-toggle" data-collapse role="button" tabindex="0" aria-label="Portföy Önerileri'ni aç/kapat">
          <span class="collapse-chev" aria-hidden="true">▸</span>
          <div>
            <h2>${svgIcon("lightbulb", "h2-ic")}Portföy Önerileri ${tipIcon("Portföyünden derlenen, önceliklendirilmiş eylem önerileri: önce sermayeyi koruyan riskler, sonra kâr-al, fırsat ve denge. Skor sermaye sağlığını özetler (yüksek = düşük risk). Öneridir, emir değildir — kararı sen verirsin.")}</h2>
            <span class="chart-sub">Önce risk, sonra fırsat — portföyüne özel ${ins.items.length} öneri</span>
          </div>
        </div>
        <div class="r1-score ${tone}"><span class="r1-num">${ins.score}</span><span class="r1-lbl">/100</span></div>
      </div>
      <div class="panel-body">
      ${ins.items.length
        ? `<ul class="ri-list">${rows}</ul>`
        : `<div class="r1-clean">✓ Belirgin bir aksiyon yok — pozisyonların stop'lu ve dengeli. İzlemede kal.</div>`}
      </div>
    </section>`;
}

/* ====================== En Büyük 3 Pozisyon (olumlu/olumsuz + haber) ============ */
const RECO_LBL = { strong_buy: "Güçlü Al", buy: "Al", hold: "Tut", sell: "Sat", strong_sell: "Güçlü Sat" };
function renderTopPicks() {
  const el = $("#topInsights");
  if (!el) return;
  const picks = STATE?.topPicks;
  if (!picks || !picks.length) { el.innerHTML = ""; return; }
  const card = (p) => {
    const dc = p.dayChangePct;
    const recoCls = /buy/.test(p.reco || "") ? "pos" : /sell/.test(p.reco || "") ? "neg" : "mid";
    const recoLbl = RECO_LBL[p.reco] || "—";
    const pros = (p.pros || []).map((t) => `<li class="tp-pro">＋ ${t}</li>`).join("") || `<li class="tp-na">belirgin artı yok</li>`;
    const cons = (p.cons || []).map((t) => `<li class="tp-con">− ${t}</li>`).join("") || `<li class="tp-na">belirgin eksi yok</li>`;
    const newsBody = p.newsSummary
      ? `<p class="tp-news-summary">${p.newsSummary}</p>`
      : (p.news && p.news.length
          ? `<p class="tp-news-summary">${(p.news || []).map((n) => n.headline.replace(/\.+$/, "")).join(". ")}.</p>`
          : `<span class="tp-na">Güncel haber yok</span>`);
    return `<div class="tp-card">
      <div class="tp-head">
        <div><span class="tp-sym">${p.symbol}</span> <span class="tp-w">%${p.weightPct} portföy</span></div>
        <div class="tp-price">${fmtUSD(p.priceUSD)}${dc != null ? ` <span class="chip ${cls(dc)}">${fmtPct(dc)}</span>` : ""}</div>
      </div>
      <div class="tp-meta"><span class="chip ${recoCls}">Analist: ${recoLbl}${p.recoTotal ? ` · ${p.recoTotal}` : ""}</span>${p.rsi != null ? `<span class="tp-rsi">RSI ${p.rsi}</span>` : ""}</div>
      <div class="tp-cols">
        <ul class="tp-list tp-pros"><li class="tp-h">Olumlu</li>${pros}</ul>
        <ul class="tp-list tp-cons"><li class="tp-h">Olumsuz</li>${cons}</ul>
      </div>
      <div class="tp-newswrap"><div class="tp-h">Son haberler</div>${newsBody}</div>
    </div>`;
  };
  const collapsed = collapseSavedCollapsed("toppicksPanel");
  el.innerHTML = `
    <section class="panel toppicks collapsible${collapsed ? " is-collapsed" : ""}" id="toppicksPanel">
      <div class="panel-head">
        <div class="panel-toggle" data-collapse role="button" tabindex="0" aria-label="En Büyük 3 Pozisyon'u aç/kapat">
          <span class="collapse-chev" aria-hidden="true">▸</span>
          <div>
            <h2>${svgIcon("search", "h2-ic")}En Büyük 3 Pozisyon ${tipIcon("Portföyünün en büyük 3 hissesi için olumlu/olumsuz yönlerin ve son haberlerin özeti. Teknik + analist verisinden derlenir; haberler saatlik tazelenir. Bilgilendirme amaçlıdır, yatırım tavsiyesi değildir.")}</h2>
            <span class="chart-sub">Olumlu / olumsuz yönler + son haberler · saatlik güncellenir</span>
          </div>
        </div>
      </div>
      <div class="tp-grid panel-body">${picks.map(card).join("")}</div>
    </section>`;
}

/* ============================ Swing Defteri ============================
 * Açtığın gerçek swing pozisyonlarını stop + hedef fiyatla kaydeder; aylık
 * realize kazancı 12 ay boyunca aylık hedefe ($600-700) karşı izler. Amaç:
 * disiplin + kazanç hedefi takibi. Holdings/işlem geçmişinden bilinçli ayrı. */
let SWINGDECK = { trades: [], live: {}, goal: { min: 600, max: 700 }, _loaded: false };
const SW_MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
// Aylık takip Haziran 2026'dan SABİT 12 ay başlar (sene filtresi yok, not defteri mantığı).
// Yeni yıla geçişi olan ay etiketine yıl eklenir (Oca '27 gibi) — tarih karışmasın.
const TRACK_START_Y = 2026, TRACK_START_M = 5; // 5 = Haziran (0-indeksli)
function trackMonths() {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(TRACK_START_Y, TRACK_START_M + i, 1);
    const label = SW_MONTHS[d.getMonth()] + (d.getMonth() === 0 ? ` '${String(d.getFullYear()).slice(2)}` : "");
    out.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label, year: d.getFullYear(), month: d.getMonth() });
  }
  return out;
}

async function loadSwingDeck() {
  const el = $("#swingDeck");
  if (el && !SWINGDECK._loaded) el.innerHTML = `<div class="radar-empty">↻ Swing defteri yükleniyor…</div>`;
  try {
    const d = await (await fetch("/api/swing-trades")).json();
    SWINGDECK = { trades: d.trades || [], live: d.live || {}, goal: d.goal || { min: 600, max: 700 }, _loaded: true };
  } catch { SWINGDECK._loaded = true; }
  renderSwingDeck();
  renderDailyBoard(); // home "Swing Nöbeti" şeridi güncel swing verisiyle yenilensin
}

// Tek pozisyon için türetilmiş metrikler
function swEnrich(t) {
  const live = t.status === "open" ? (SWINGDECK.live[t.symbol]?.price ?? null) : null;
  const stale = t.status === "open" ? !!SWINGDECK.live[t.symbol]?.stale : false;
  const ref = t.status === "closed" ? t.exitPrice : (live ?? t.entry);
  const pnl = ref != null ? (ref - t.entry) * t.qty : null;        // $ K/Z
  const pnlPct = ref != null && t.entry ? ((ref - t.entry) / t.entry) * 100 : null;
  const riskPS = t.stop != null ? t.entry - t.stop : null;          // hisse başı risk
  const rewardPS = t.target != null ? t.target - t.entry : null;
  const rr = riskPS && riskPS > 0 && rewardPS != null ? rewardPS / riskPS : null;
  const riskAmt = riskPS != null ? riskPS * t.qty : null;           // toplam planlı risk ($)
  // hedefe / stopa mesafe (açık pozisyon, canlı fiyata göre)
  const toTarget = live != null && t.target != null && t.target !== t.entry
    ? ((t.target - live) / Math.abs(t.target - t.entry)) * 100 : null;
  const toStop = live != null && t.stop != null && t.entry !== t.stop
    ? ((live - t.stop) / Math.abs(t.entry - t.stop)) * 100 : null;
  // tetiklenme uyarısı (canlı fiyat stop/hedefi geçti mi) — Kural 1 disiplini
  let alert = null;
  if (live != null) {
    if (t.stop != null && live <= t.stop) alert = "stop";
    else if (t.target != null && live >= t.target) alert = "target";
    else if (t.stop != null && riskPS > 0 && toStop != null && toStop <= 20) alert = "near-stop";
  }
  // gerçekleşen R katsayısı (kapanmış işlemlerde) = (çıkış−giriş)/(giriş−stop)
  const rReal = t.status === "closed" && riskPS && riskPS > 0
    ? (t.exitPrice - t.entry) / riskPS : null;
  // kısmi satışlardan (ana para çekme) realize edilen swing kârı + satılan adet
  const lots = t.realizedLots || [];
  const realizedSoFar = lots.reduce((a, l) => a + (l.pnlUSD || 0), 0);
  const soldShares = lots.reduce((a, l) => a + (l.shares || 0), 0);
  // ---- NET fiyat-hareketi metrikleri (kullanıcı dostu: "hedef için +%X yükselmeli") ----
  const valueUSD = live != null ? live * t.qty : null;
  const costUSD = t.entry * t.qty;
  const toTargetPct = live != null && t.target != null && live > 0 ? ((t.target - live) / live) * 100 : null; // hedefe gereken fiyat artışı %
  const stopCushionPct = live != null && t.stop != null && live > 0 ? ((live - t.stop) / live) * 100 : null;  // stop'a düşüş payı %
  const targetGainUSD = t.target != null ? (t.target - t.entry) * t.qty : null; // hedefte (girişe göre) toplam kazanç
  const stopLossUSD = t.stop != null ? (t.stop - t.entry) * t.qty : null;       // stop'ta toplam zarar (negatif)
  const days = t.openedAt ? Math.max(0, Math.round((Date.now() - new Date(t.openedAt)) / 864e5)) : null;
  // fiyatın stop↔hedef bandındaki konumu (0=stop, 100=hedef)
  const bandPos = (live != null && t.stop != null && t.target != null && t.target > t.stop)
    ? Math.max(0, Math.min(100, ((live - t.stop) / (t.target - t.stop)) * 100)) : null;
  return { live, stale, ref, pnl, pnlPct, riskPS, rewardPS, rr, riskAmt, toTarget, toStop, alert, rReal, realizedSoFar, soldShares,
    valueUSD, costUSD, toTargetPct, stopCushionPct, targetGainUSD, stopLossUSD, days, bandPos };
}

// Verilen ay (yyyy-mm) için realize swing kazancı — renderSwingDeck aylık hesabıyla AYNI mantık (home hedef barı tutarlı kalsın)
function swingMonthRealize(ymKey) {
  let total = 0;
  for (const t of (SWINGDECK.trades || [])) {
    if (t.status === "closed" && String(t.closedAt || "").slice(0, 7) === ymKey) total += swEnrich(t).pnl || 0;
    for (const lot of (t.realizedLots || [])) if (String(lot.date || "").slice(0, 7) === ymKey) total += lot.pnlUSD || 0;
  }
  return total;
}

/* Swing derin istatistik — kapanan işlemlerden profit factor, payoff, expectancy,
 * R-dağılımı, ort. tutuş günü, en iyi/kötü, kazanç/kayıp serisi. Kısmi satış (lot)
 * realize'ları da toplam kâra/R'ye katılır. */
function swingStats(closed) {
  if (!closed.length) return null;
  const recs = closed.map((t) => {
    const m = swEnrich(t);
    const lots = t.realizedLots || [];
    const lotSum = lots.reduce((a, l) => a + (l.pnlUSD || 0), 0);
    const lotShares = lots.reduce((a, l) => a + (l.shares || 0), 0);
    const realized = (m.pnl || 0) + lotSum;                 // toplam $ K/Z (kapanış + kısmi)
    const origQty = (t.qty || 0) + lotShares;               // başlangıç adedi
    const riskPS = t.stop != null ? t.entry - t.stop : null;
    const rMul = riskPS && riskPS > 0 && origQty > 0 ? realized / (riskPS * origQty) : null;
    const days = t.openedAt && t.closedAt
      ? Math.max(0, Math.round((new Date(t.closedAt) - new Date(t.openedAt)) / 864e5)) : null;
    return { sym: t.symbol, realized, rMul, days, closedAt: t.closedAt };
  });
  const wins = recs.filter((r) => r.realized > 0), losses = recs.filter((r) => r.realized < 0);
  const grossWin = wins.reduce((a, r) => a + r.realized, 0);
  const grossLoss = Math.abs(losses.reduce((a, r) => a + r.realized, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : null);
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const payoff = avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? Infinity : null);
  const expectancyUSD = recs.reduce((a, r) => a + r.realized, 0) / recs.length;
  const rVals = recs.map((r) => r.rMul).filter((v) => v != null && isFinite(v));
  const expectancyR = rVals.length ? rVals.reduce((a, v) => a + v, 0) / rVals.length : null;
  const dayVals = recs.map((r) => r.days).filter((v) => v != null);
  const avgDays = dayVals.length ? dayVals.reduce((a, v) => a + v, 0) / dayVals.length : null;
  const sorted = [...recs].sort((a, b) => a.realized - b.realized);
  const worst = sorted[0], best = sorted[sorted.length - 1];
  // en uzun kazanç / kayıp serisi (kapanış tarihine göre)
  const chrono = [...recs].sort((a, b) => String(a.closedAt).localeCompare(String(b.closedAt)));
  let maxW = 0, maxL = 0, cw = 0, cl = 0;
  for (const r of chrono) {
    if (r.realized > 0) { cw++; cl = 0; } else if (r.realized < 0) { cl++; cw = 0; } else { cw = 0; cl = 0; }
    maxW = Math.max(maxW, cw); maxL = Math.max(maxL, cl);
  }
  // R histogramı kovaları
  const buckets = [
    { lbl: "≤−1R", min: -Infinity, max: -1, n: 0, tone: "neg" },
    { lbl: "−1..0", min: -1, max: 0, n: 0, tone: "neg" },
    { lbl: "0..1R", min: 0, max: 1, n: 0, tone: "pos" },
    { lbl: "1..2R", min: 1, max: 2, n: 0, tone: "pos" },
    { lbl: "2..3R", min: 2, max: 3, n: 0, tone: "pos" },
    { lbl: "3R+", min: 3, max: Infinity, n: 0, tone: "pos" },
  ];
  rVals.forEach((v) => { const b = buckets.find((x) => v > x.min && v <= x.max) || buckets[0]; b.n++; });
  // Plan-uyum / stop disiplini (Faz 3): zarar eden + stop'lu işlemlerde kaybı 1R içinde
  // tuttun mu? rMul ≥ −1.1 → stop'a uyuldu; çok aşıldıysa (< −1.5R) stop ihlali.
  const lossR = losses.map((r) => r.rMul).filter((v) => v != null && isFinite(v));
  const stopHonored = lossR.filter((v) => v >= -1.1).length;
  const stopViol = lossR.filter((v) => v < -1.5).length;
  const avgLossR = lossR.length ? lossR.reduce((a, v) => a + v, 0) / lossR.length : null;
  const disciplinePct = lossR.length ? (stopHonored / lossR.length) * 100 : null;
  return { n: recs.length, winCount: wins.length, lossCount: losses.length,
    winRate: (wins.length / recs.length) * 100, profitFactor, payoff, avgWin, avgLoss,
    expectancyUSD, expectancyR, avgDays, best, worst, maxW, maxL, rBuckets: buckets, rN: rVals.length,
    disciplinePct, stopViol, avgLossR, lossRN: lossR.length };
}

function swingStatsPanel(closed) {
  const s = swingStats(closed);
  if (!s) return "";
  const fmtPF = (v) => v == null ? "—" : v === Infinity ? "∞" : v.toFixed(2);
  const cls2 = (v, good) => v == null ? "" : good ? "pos" : "neg";
  const maxBucket = Math.max(1, ...s.rBuckets.map((b) => b.n));
  const histo = s.rBuckets.map((b) =>
    `<div class="sx-bar"><div class="sx-bar-fill ${b.tone}" style="height:${Math.round((b.n / maxBucket) * 100)}%"></div>
      <span class="sx-bar-n">${b.n}</span><span class="sx-bar-l">${b.lbl}</span></div>`).join("");
  const stat = (lbl, val, tone = "", sub = "") =>
    `<div class="sx-stat"><span class="sx-lbl">${lbl}</span><b class="${tone}">${val}</b>${sub ? `<span class="sx-sub">${sub}</span>` : ""}</div>`;
  return `
    <section class="panel sx-panel">
      <div class="panel-head"><div><h2>📊 Swing Karnesi <span class="sw-chip">${s.n} işlem</span></h2>
        <span class="chart-sub">Qullamaggie'yi ne kadar iyi uyguluyorsun — profit factor, payoff, beklenti, R-dağılımı</span></div></div>
      <div class="sx-grid">
        ${stat("İsabet", s.winRate.toFixed(0) + "%", s.winRate >= 50 ? "pos" : "", `${s.winCount}K / ${s.lossCount}Z`)}
        ${stat("Profit Factor", fmtPF(s.profitFactor), cls2(s.profitFactor, s.profitFactor >= 1), "kâr ÷ zarar")}
        ${stat("Payoff", fmtPF(s.payoff), cls2(s.payoff, s.payoff >= 1), "ort kazanç ÷ kayıp")}
        ${stat("Beklenti", fmtUSD0(s.expectancyUSD), s.expectancyUSD >= 0 ? "pos" : "neg", s.expectancyR != null ? `${s.expectancyR >= 0 ? "+" : ""}${s.expectancyR.toFixed(2)}R / işlem` : "işlem başı")}
        ${stat("Ort. Kazanç", fmtUSD0(s.avgWin), "pos", `${s.winCount} kârlı`)}
        ${stat("Ort. Kayıp", "−" + fmtUSD0(s.avgLoss), "neg", `${s.lossCount} zararlı`)}
        ${stat("Ort. Tutuş", s.avgDays != null ? Math.round(s.avgDays) + " gün" : "—", "", "açılış→kapanış")}
        ${stat("Seri", `${s.maxW}K / ${s.maxL}Z`, "", "en uzun üst üste")}
        ${stat("En İyi", fmtUSD0(s.best.realized), "pos", s.best.sym)}
        ${stat("En Kötü", fmtUSD0(s.worst.realized), "neg", s.worst.sym)}
        ${s.disciplinePct != null ? stat("Stop Disiplini", Math.round(s.disciplinePct) + "%", s.disciplinePct >= 80 ? "pos" : s.disciplinePct >= 50 ? "" : "neg", `${s.lossRN - s.stopViol}/${s.lossRN} kayıp 1R içinde`) : ""}
        ${s.avgLossR != null ? stat("Ort. Kayıp (R)", s.avgLossR.toFixed(2) + "R", s.avgLossR >= -1.1 ? "pos" : "neg", "ideal ≈ −1R") : ""}
      </div>
      ${s.disciplinePct != null ? `<div class="sx-disc ${s.disciplinePct >= 80 ? "ok" : "warn"}">
        ${s.disciplinePct >= 80
          ? `✓ Stop disiplinin güçlü — kayıplarının ${Math.round(s.disciplinePct)}%'i planlı 1R riski içinde kaldı. "En az zararla çık" tezini uyguluyorsun.`
          : `⚠️ Kayıplarının yalnız ${Math.round(s.disciplinePct)}%'i 1R içinde${s.stopViol ? ` · ${s.stopViol} işlemde stop &gt;1.5R aşıldı` : ""}. Stop'a zamanında uy — büyük kayıp birikimi sistemi bozar (Kural 1).`}</div>` : ""}
      ${s.rN ? `<div class="sx-histo-wrap"><div class="sx-histo-h">R-katsayısı dağılımı <span class="sw-muted">${s.rN} stop'lu işlem · küçük zararlar, büyük kazançlar mı?</span></div>
        <div class="sx-histo">${histo}</div></div>` : `<div class="sw-muted" style="font-size:12px;margin-top:6px">R-dağılımı için stop girilmiş kapanmış işlem gerek.</div>`}
    </section>`;
}

function renderSwingDeck() {
  const el = $("#swingDeck");
  if (!el) return;
  const trades = SWINGDECK.trades;
  const goal = SWINGDECK.goal || { min: 600, max: 700 };
  const open = trades.filter((t) => t.status === "open");
  const closed = trades.filter((t) => t.status === "closed");

  // --- aylık realize toplamı (Haziran 2026'dan sabit 12 ay) ---
  const now = new Date();
  const months = trackMonths().map((m) => ({ ...m, total: 0, count: 0 }));
  const mIndex = Object.fromEntries(months.map((m, i) => [m.key, i]));
  for (const t of closed) {
    const key = String(t.closedAt || "").slice(0, 7);
    if (key in mIndex) {
      const m = months[mIndex[key]];
      m.total += swEnrich(t).pnl || 0; // kısmi satışla kapananlarda qty=0 → bu 0, lot'lar aşağıda sayılır
      m.count++;
    }
  }
  // Kısmi satışlar (ana para çekme): her lot kendi ayında swing getirisine yansır
  for (const t of trades) {
    for (const lot of (t.realizedLots || [])) {
      const key = String(lot.date || "").slice(0, 7);
      if (key in mIndex) { months[mIndex[key]].total += lot.pnlUSD || 0; months[mIndex[key]].count++; }
    }
  }
  const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const thisMonth = months[mIndex[curKey]]?.total || 0;
  const total12 = months.reduce((a, m) => a + m.total, 0);
  const openPnl = open.reduce((a, t) => a + (swEnrich(t).pnl || 0), 0);
  // hedefi tutturan ay sayısı (en az min)
  const hitMonths = months.filter((m) => m.total >= goal.min).length;
  const activeMonths = months.filter((m) => m.count > 0).length;

  // --- hero kartları ---
  const pct = goal.min ? Math.max(0, Math.min(120, (thisMonth / goal.min) * 100)) : 0;
  const goalTone = thisMonth >= goal.min ? "ok" : thisMonth > 0 ? "warm" : "zero";
  const pnlCls = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "");
  const hero = `
    <div class="sw-hero">
      <div class="sw-goal-card">
        <div class="sw-goal-head">
          <div>
            <div class="sw-goal-lbl">Bu Ay Realize Kazanç</div>
            <div class="sw-goal-val ${pnlCls(thisMonth)}">${fmtUSD0(thisMonth)}</div>
          </div>
          <button class="sw-goal-target" id="swGoalEditBtn" title="Aylık hedefi düzenle">
            Hedef ⚙<br><b>$${goal.min}–${goal.max}</b><span>/ay</span>
          </button>
        </div>
        <div class="sw-goal-bar">
          <div class="sw-goal-band" style="left:${((goal.min / goal.max) * 100).toFixed(1)}%;right:0"></div>
          <div class="sw-goal-fill ${goalTone}" style="width:${Math.max(0, Math.min(100, (thisMonth / goal.max) * 100)).toFixed(1)}%"></div>
        </div>
        <div class="sw-goal-foot">
          ${thisMonth >= goal.min
            ? `<span class="pos">✓ Aylık hedef tutturuldu</span>`
            : `<span>Hedefe <b>${fmtUSD0(Math.max(0, goal.min - thisMonth))}</b> kaldı</span>`}
          <span class="sw-muted">${pct.toFixed(0)}% · alt hedef</span>
        </div>
      </div>
      <div class="sw-mini">
        <div class="sw-mini-lbl">Açık Pozisyon K/Z</div>
        <div class="sw-mini-val ${pnlCls(openPnl)}">${fmtUSD0(openPnl)}</div>
        <div class="sw-mini-sub">${open.length} açık pozisyon</div>
      </div>
      <div class="sw-mini">
        <div class="sw-mini-lbl">Son 12 Ay Toplam</div>
        <div class="sw-mini-val ${pnlCls(total12)}">${fmtUSD0(total12)}</div>
        <div class="sw-mini-sub">${closed.length} kapanmış işlem</div>
      </div>
      <div class="sw-mini">
        <div class="sw-mini-lbl">Hedefi Tutturan Ay</div>
        <div class="sw-mini-val">${hitMonths}<span class="sw-mini-den"> / ${activeMonths || 0}</span></div>
        <div class="sw-mini-sub">işlem yapılan ${activeMonths} ayda</div>
      </div>
    </div>`;

  // --- 12 ay bar grafik ---
  const maxAbs = Math.max(goal.max, ...months.map((m) => Math.abs(m.total)), 1);
  const scale = maxAbs * 1.12;
  const goalTopPct = (1 - goal.max / scale) * 100;   // band üst kenarı (yukarıdan %)
  const goalBotPct = (1 - goal.min / scale) * 100;   // band alt kenarı
  const zeroFromTop = 100;                             // 0 çizgisi en altta (pozitif veriler)
  const bars = months.map((m) => {
    const h = Math.max(0, (Math.max(0, m.total) / scale) * 100);
    const negH = Math.max(0, (Math.max(0, -m.total) / scale) * 100);
    const hit = m.total >= goal.min;
    const cls = m.total < 0 ? "neg" : m.total >= goal.min ? "hit" : m.total > 0 ? "pos" : "empty";
    const cur = m.key === curKey ? " cur" : "";
    return `
      <div class="sw-bar-col${cur}" data-swm-lbl="${m.label} ${m.year}" data-swm-total="${fmtUSD0(m.total)}" data-swm-count="${m.count}" data-swm-hit="${hit ? 1 : 0}">
        <div class="sw-bar-track">
          <div class="sw-bar ${cls}" style="height:${m.total >= 0 ? h : negH}%">
            ${m.total !== 0 ? `<span class="sw-bar-tag">${fmtUSD0(m.total)}</span>` : ""}
          </div>
        </div>
        <div class="sw-bar-x${cur}">${m.label}</div>
      </div>`;
  }).join("");

  const chart = `
    <section class="panel sw-chart-panel">
      <div class="panel-head">
        <div>
          <h2>Aylık Swing Kazancı <span class="sw-chip">12 ay</span></h2>
          <span class="chart-sub">Her ay realize ettiğin kâr · yeşil bant = aylık kazanç hedefi ($${goal.min}–${goal.max})</span>
        </div>
        <button class="btn primary sm" id="swAddBtn">+ Swing Seç</button>
      </div>
      <div class="sw-chart">
        <div class="sw-goalband" style="top:${goalTopPct}%;height:${goalBotPct - goalTopPct}%">
          <span class="sw-goalband-lbl">hedef $${goal.min}–${goal.max}</span>
        </div>
        <div class="sw-bars">${bars}</div>
      </div>
    </section>`;

  // --- açık pozisyonlar ---
  const openCards = open.length ? open.map((t) => {
    const m = swEnrich(t);
    const liveTxt = m.live != null
      ? `$${fmtNum(m.live, 2)}${m.stale ? " <i class='sw-stale'>(bayat)</i>" : ""}`
      : "<span class='sw-muted'>fiyat yok</span>";
    const alertBar = m.alert === "stop"
      ? `<div class="sw-alert stop">⛔ Stop tetiklendi — planını uygula, sermayeyi koru</div>`
      : m.alert === "target"
      ? `<div class="sw-alert target">🎯 Hedefe ulaştı — kâr-al / stop yukarı taşı</div>`
      : m.alert === "near-stop"
      ? `<div class="sw-alert near">⚠ Stop'a yakın (fiyat %${m.stopCushionPct != null ? m.stopCushionPct.toFixed(1) : "—"} pay)</div>`
      : "";
    // Stop ↔ Hedef bandı (canlı fiyat konumu)
    const band = (m.bandPos != null) ? `
      <div class="swp-band">
        <div class="swp-band-track"><div class="swp-band-fill" style="width:${m.bandPos.toFixed(0)}%"></div><div class="swp-band-dot" style="left:${m.bandPos.toFixed(0)}%"></div></div>
        <div class="swp-band-ends"><span class="neg">⛔ ${fmtUSD0(t.stop)}</span><span class="swp-band-live">${fmtUSD(m.live)}</span><span class="pos">🎯 ${fmtUSD0(t.target)}</span></div>
      </div>` : "";
    // Hedef / Stop satırları — NET dil: "hedef için +%X yükselmeli"
    const tgtLine = t.target != null
      ? `<div class="swp-lvl tgt"><span class="swp-lvl-k">🎯 Hedef</span><b>${fmtUSD(t.target)}</b>${m.toTargetPct != null ? `<span class="swp-need ${m.toTargetPct >= 0 ? "pos" : "muted"}">${m.toTargetPct >= 0 ? `+${m.toTargetPct.toFixed(2)}% yükselmeli` : "ulaşıldı ✓"}</span>` : ""}${m.targetGainUSD != null ? `<span class="swp-proj pos" title="Hedefe ulaşırsa girişe göre toplam kazanç">→ ${fmtUSD0(m.targetGainUSD)}</span>` : ""}</div>`
      : `<div class="swp-lvl tgt"><span class="swp-lvl-k">🎯 Hedef</span><span class="sw-muted">yok</span></div>`;
    const stopLine = t.stop != null
      ? `<div class="swp-lvl stp"><span class="swp-lvl-k">⛔ Stop</span><b>${fmtUSD(t.stop)}</b>${m.stopCushionPct != null ? `<span class="swp-need ${m.stopCushionPct >= 0 ? "neg" : "muted"}">${m.stopCushionPct >= 0 ? `−${m.stopCushionPct.toFixed(2)}% pay` : "tetiklendi"}</span>` : ""}${m.stopLossUSD != null ? `<span class="swp-proj neg" title="Stop tetiklenirse girişe göre zarar">→ ${fmtUSD0(m.stopLossUSD)}</span>` : ""}</div>`
      : `<div class="swp-lvl stp"><span class="swp-lvl-k">⛔ Stop</span><span class="sw-muted">yok — riski sınırla (Kural 1)</span></div>`;
    const valCls = (m.valueUSD != null && m.costUSD != null) ? (m.valueUSD >= m.costUSD ? "up" : "down") : "";
    const grid = `<div class="swp-grid">
      <div class="swp-cell"><span>Adet</span><b>${fmtNum(t.qty, 4)}</b></div>
      <div class="swp-cell hl-cost"><span>Maliyet</span><b>${fmtUSD0(m.costUSD)}</b></div>
      <div class="swp-cell hl-val ${valCls}"><span>Değer</span><b>${m.valueUSD != null ? fmtUSD0(m.valueUSD) : "—"}</b></div>
      <div class="swp-cell"><span>R/Ö</span><b>${m.rr != null ? m.rr.toFixed(1) : "—"}</b></div>
      <div class="swp-cell"><span>Tutuş</span><b>${m.days != null ? m.days + "g" : "—"}</b></div>
      <div class="swp-cell"><span>Risk</span><b class="swp-risk">${m.riskAmt != null ? fmtUSD0(m.riskAmt) : "—"}</b></div>
    </div>`;
    return `
      <div class="sw-pos${m.alert ? " a-" + m.alert : ""}${m.pnl > 0 ? " pnl-pos" : m.pnl < 0 ? " pnl-neg" : ""}">
        ${alertBar}
        <div class="sw-pos-top">
          <div class="sw-pos-id">
            <b>${t.symbol}</b>
            <span class="sw-muted">${fmtNum(t.qty, 4)} × ${fmtUSD(t.entry)}</span>
          </div>
          <div class="sw-pos-pnl ${pnlCls(m.pnl)}">
            ${m.pnl != null ? fmtUSD(m.pnl) : "—"}
            <span class="sw-pos-pct">${m.pnlPct != null ? fmtPct(m.pnlPct) : ""}</span>
          </div>
        </div>
        <div class="sw-pos-live">Canlı: <b>${liveTxt}</b> · açılış ${fmtDate(t.openedAt)}${m.days != null ? ` · ${m.days}g önce` : ""}</div>
        ${band}
        <div class="swp-lvls">${tgtLine}${stopLine}</div>
        ${grid}
        ${m.realizedSoFar > 0 ? `<div class="sw-pos-realized">💵 Çekilen kâr: <b>${fmtUSD(m.realizedSoFar)}</b> · ${fmtNum(m.soldShares, 2)} adet satıldı (swing getirisine + vergiye işlendi)</div>` : ""}
        ${t.note ? `<div class="sw-pos-note">“${t.note}”</div>` : ""}
        <div class="sw-pos-acts">
          <button class="btn ghost sm" data-sw-edit="${t.id}">Düzenle</button>
          <button class="btn ghost sm" data-sw-del="${t.id}">Sil</button>
          <button class="btn primary sm" data-sw-sell="${t.id}">💵 Sat / Ana Para Çek</button>
        </div>
      </div>`;
  }).join("") : `<div class="sw-empty">Henüz açık swing pozisyonu yok. <b>+ Swing Seç</b> ile portföydeki bir pozisyonu swing olarak işaretle — stop ve hedef opsiyonel.</div>`;

  const openPanel = `
    <section class="panel">
      <div class="panel-head">
        <div><h2>Açık Pozisyonlar <span class="sw-chip">${open.length}</span></h2>
        <span class="chart-sub">Canlı fiyatla anlık K/Z · stop &amp; hedefe mesafe</span></div>
        <button class="btn ghost sm" id="swRefreshBtn">↻ Fiyat yenile</button>
      </div>
      <div class="sw-pos-grid">${openCards}</div>
    </section>`;

  // --- kapanmış işlemler ---
  const closedSorted = [...closed].sort((a, b) => String(b.closedAt).localeCompare(String(a.closedAt)));
  const closedRows = closedSorted.map((t) => {
    const m = swEnrich(t);
    const days = t.openedAt && t.closedAt
      ? Math.max(0, Math.round((new Date(t.closedAt) - new Date(t.openedAt)) / 864e5)) : null;
    // Kısmi satış (ana para çekme) realize'larını da kat → satır gerçek toplam kârı göstersin
    const lots = t.realizedLots || [];
    const lotSum = lots.reduce((a, l) => a + (l.pnlUSD || 0), 0);
    const lotShares = lots.reduce((a, l) => a + (l.shares || 0), 0);
    const archived = t.archived || (lots.length > 0 && (t.qty === 0 || t.qty == null) && t.exitPrice == null);
    const realized = (m.pnl || 0) + lotSum;
    const qtyCell = archived ? `${fmtNum(lotShares, 2)} <span class="sw-muted">kısmi</span>` : t.qty;
    const exitCell = t.exitPrice != null ? `$${fmtNum(t.exitPrice, 2)}` : (lots.length ? `<span class="sw-muted">kısmi</span>` : "—");
    // Pozisyon başına R sonucu (Faz 3): realize ÷ (1R × başlangıç adedi)
    const origQty = (t.qty || 0) + lotShares;
    const riskPS = t.stop != null ? t.entry - t.stop : null;
    const rMul = riskPS && riskPS > 0 && origQty > 0 ? realized / (riskPS * origQty) : null;
    const rCell = rMul != null ? `<span class="sw-rbadge ${rMul >= 0 ? "pos" : "neg"}">${rMul >= 0 ? "+" : ""}${rMul.toFixed(1)}R</span>` : `<span class="sw-muted">—</span>`;
    return `
      <tr>
        <td class="l">${fmtDate(t.closedAt)}</td>
        <td class="l"><b>${t.symbol}</b>${archived ? ` <span class="sw-arch" title="Ana portföyde tutuluyor; kısmi swing kârı korundu">arşiv</span>` : ""}</td>
        <td>${qtyCell}</td>
        <td>$${fmtNum(t.entry, 2)}</td>
        <td>${exitCell}</td>
        <td class="${pnlCls(realized)}"><b>${fmtUSD(realized)}</b></td>
        <td class="${pnlCls(m.pnlPct)}">${t.exitPrice != null ? fmtPct(m.pnlPct) : "—"}</td>
        <td>${rCell}</td>
        <td class="sw-muted">${days != null ? days + "g" : "—"}</td>
        <td><button class="btn ghost sm" data-sw-del="${t.id}">×</button></td>
      </tr>`;
  }).join("");
  // İsabet/beklenti/R — swingStats ile (arşiv/kısmi kapananlarda realizedLots'u sayar; m.pnl=0 hatası giderildi)
  const cst = swingStats(closed);
  const closedPanel = closed.length ? `
    <section class="panel">
      <div class="panel-head">
        <div><h2>Kapanmış İşlemler <span class="sw-chip">${closed.length}</span></h2>
        <span class="chart-sub">İsabet ${cst ? cst.winRate.toFixed(0) + "%" : "—"} · ${cst ? cst.winCount : 0}/${closed.length} kârlı · işlem başı beklenti ${fmtUSD0(cst ? cst.expectancyUSD : 0)}${cst && cst.expectancyR != null ? ` · ort. ${cst.expectancyR >= 0 ? "+" : ""}${cst.expectancyR.toFixed(2)}R` : ""}</span></div>
      </div>
      <div class="trade-list-wrap">
        <table class="trade-table sw-closed">
          <thead><tr>
            <th class="l">Kapanış</th><th class="l">Sembol</th><th>Adet</th>
            <th>Giriş $</th><th>Çıkış $</th><th>Realize K/Z</th><th>%</th><th>R</th><th>Süre</th><th></th>
          </tr></thead>
          <tbody>${closedRows}</tbody>
        </table>
      </div>
    </section>` : "";

  el.innerHTML = hero + swRegimeLine() + chart + swAnalyticsPanel(trades) + swingStatsPanel(closed) + openPanel + closedPanel;
}

/* Defter analitiği: kümülatif realize eğrisi + sembol bazlı K/Z barları.
 * Olaylar aylık grafikle AYNI kaynaktan: kısmi lot'lar kendi tarihinde, tam kapanışlar
 * exitPrice'la kapanış tarihinde (çifte sayım yok — aylık toplamla birebir tutar). */
function swAnalyticsPanel(trades) {
  const events = [];
  for (const t of trades) {
    for (const lot of (t.realizedLots || [])) if (lot.date) events.push({ d: String(lot.date).slice(0, 10), sym: t.symbol, pnl: lot.pnlUSD || 0 });
    if (t.status === "closed" && t.exitPrice != null && t.closedAt) events.push({ d: String(t.closedAt).slice(0, 10), sym: t.symbol, pnl: swEnrich(t).pnl || 0 });
  }
  if (!events.length) return "";
  events.sort((a, b) => a.d.localeCompare(b.d));
  // — kümülatif eğri —
  let cum = 0;
  const pts = events.map((e) => ({ d: e.d, v: (cum += e.pnl) }));
  const W = 720, H = 170, PAD = 8;
  const vMin = Math.min(0, ...pts.map((p) => p.v)), vMax = Math.max(0, ...pts.map((p) => p.v));
  const span = Math.max(1, vMax - vMin);
  const X = (i) => PAD + (i / Math.max(1, pts.length - 1)) * (W - 2 * PAD);
  const Y = (v) => PAD + (1 - (v - vMin) / span) * (H - 2 * PAD);
  const P = pts.map((p, i) => [X(i), Y(p.v)]);
  const line = smoothPath(P);
  const area = `${line} L ${X(pts.length - 1).toFixed(1)} ${Y(Math.max(0, vMin)).toFixed(1)} L ${X(0).toFixed(1)} ${Y(Math.max(0, vMin)).toFixed(1)} Z`;
  const zeroY = Y(0);
  const last = pts[pts.length - 1];
  const curve = `
    <div class="sw-an-card">
      <div class="sw-an-h">Kümülatif Swing Kârı <span class="sw-an-val ${last.v >= 0 ? "pos" : "neg"}">${fmtUSD0(last.v)}</span></div>
      <div class="sw-an-sub">${fmtDate(pts[0].d)} → ${fmtDate(last.d)} · ${events.length} realize olayı — her satış eğriye işlenir</div>
      <svg viewBox="0 0 ${W} ${H}" class="sw-an-svg" preserveAspectRatio="none" aria-label="Kümülatif swing kârı">
        ${vMin < 0 ? `<line x1="0" x2="${W}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}" class="sw-an-zero"/>` : ""}
        <path d="${area}" class="sw-an-area"/>
        <path d="${line}" class="sw-an-line"/>
        <circle cx="${X(pts.length - 1).toFixed(1)}" cy="${Y(last.v).toFixed(1)}" r="3.5" class="sw-an-dot"/>
      </svg>
    </div>`;
  // — sembol bazlı K/Z —
  const bySym = {};
  for (const e of events) bySym[e.sym] = (bySym[e.sym] || 0) + e.pnl;
  const rows = Object.entries(bySym).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8);
  const mx = Math.max(...rows.map(([, v]) => Math.abs(v)), 1);
  const barRows = rows.map(([sym, v]) => `
    <div class="sw-sb-row">
      <span class="sw-sb-sym">${sym}</span>
      <span class="sw-sb-track"><span class="sw-sb-bar ${v >= 0 ? "pos" : "neg"}" style="width:${Math.max(3, Math.abs(v) / mx * 100).toFixed(1)}%"></span></span>
      <span class="sw-sb-val ${v >= 0 ? "pos" : "neg"}">${v >= 0 ? "+" : ""}${fmtUSD0(v)}</span>
    </div>`).join("");
  const wl = rows.filter(([, v]) => v > 0).length, ll = rows.length - wl;
  const symCard = `
    <div class="sw-an-card">
      <div class="sw-an-h">Sembol Bazlı K/Z</div>
      <div class="sw-an-sub">${wl} kazandıran · ${ll} kaybettiren — zararlar da dürüstçe burada</div>
      <div class="sw-sb-list">${barRows}</div>
    </div>`;
  return `<section class="panel sw-an-panel"><div class="sw-an-grid">${curve}${symCard}</div></section>`;
}

/* Swing Defteri endeks önerisi — QQQ rejimine göre "girmek için iyi zaman mı?" satırı.
 * Endeks bazlı satış her hisseye yansır: QQQ < EMA21 iken yeni swing girişi önerilmez. */
let _swRegimeKick = false;
function swRegimeLine() {
  const q = CHALLENGE._sym[CHALLENGE.indexSym];
  if (!q) {
    if (!_swRegimeKick) { _swRegimeKick = true; chLoadIndex().then(() => { if ($("#view-swingdefteri")?.classList.contains("active")) renderSwingDeck(); }).catch(() => {}); }
    return "";
  }
  const r = chRegimeToday();
  const advice = r.state === "off" ? " — <b>şu an yeni swing girişi için iyi bir zaman değil; mevcutları kurallarınla yönet.</b>"
    : r.state === "caution" ? " — yeni girişte temkinli ol, boyutu küçült." : " — yeni girişler için ortam uygun.";
  return `<div class="sw-regime ${r.state}">${r.state === "off" ? "⛔" : r.state === "caution" ? "🟡" : "🟢"} <b>Rejim (QQQ + risk iştahı):</b> ${r.txt}${advice}</div>`;
}

/* ===== Günlük İşlem Analizi — o günün HER işlemi kendi verisiyle değerlendirilir =====
 * Şablon nasihat yok: her karar o hissenin EMA konumu, ADR'si, satış-sonrası hareketi,
 * endeks rejimi ve plan uyumuyla puanlanır. Swing (src=swing) ve uzun vade AYRI etiketlenir. */
const DA = { _sym: {} };
async function daCandles(sym) {
  sym = String(sym).toUpperCase();
  if (DA._sym[sym]) return DA._sym[sym];
  if (CHALLENGE._sym[sym]) return (DA._sym[sym] = CHALLENGE._sym[sym]); // Alfa Avı yüklediyse yeniden çekme
  try {
    const d = await (await fetch(`/api/chart?symbol=${encodeURIComponent(sym)}`)).json();
    const v = Array.isArray(d.candles) ? d.candles : [];
    if (v.length < 30) return null;
    return (DA._sym[sym] = { v, ema8: chEMA(v, 8), ema21: chEMA(v, 21), ema50: chEMA(v, 50), vma: chVMA(v, 20), idx: Object.fromEntries(v.map((c, i) => [c.time, i])) });
  } catch { return null; }
}
function daAnalyzeTrade(t, s, ctx) {
  const F = []; // bulgular: {tone: pos|warn|neg, txt}
  const add = (tone, txt) => F.push({ tone, txt });
  const isSell = t.kind === "sell";
  const isSwing = t.src === "swing" || /swing/i.test(t.note || "");
  let i = s ? (s.idx[t.date] ?? s.v.length - 1) : null;
  const e8 = s ? s.ema8[i] : null, e21 = s ? s.ema21[i] : null, e50 = s ? s.ema50[i] : null;
  const adr = s ? chADR(s.v, i) : null;
  const dayClose = s ? s.v[i].close : null;
  const lastClose = s ? s.v[s.v.length - 1].close : null;

  if (isSell) {
    const px = Number(t.sellUSD) || 0, cost = Number(t.buyUSD) || 0;
    const pnl = t.shares * (px - cost);
    const pct = cost ? ((px - cost) / cost) * 100 : null;
    if (pct != null && pnl < 0 && adr) {
      const rOran = Math.abs(pct) / adr;
      if (rOran <= 1.3) add("pos", `Zarar küçükken kesildi: −%${Math.abs(pct).toFixed(1)} ≈ ${rOran.toFixed(1)}×ADR (%${adr.toFixed(1)}) — ~1R disiplini, Kural 1'e uygun.`);
      else if (rOran <= 2) add("warn", `Zarar −%${Math.abs(pct).toFixed(1)} = ${rOran.toFixed(1)}×ADR — stop biraz geç; 1×ADR civarında kesmek sistemin varsayımı.`);
      else add("neg", `Zarar −%${Math.abs(pct).toFixed(1)} = ${rOran.toFixed(1)}×ADR — stop belirgin geç basılmış. Stop seviyen tetiklendiğinde beklemeden kes.`);
    }
    if (pct != null && pnl > 0) add("pos", `+%${pct.toFixed(1)} kârla realize (${fmtUSD(pnl)}) — kâr almak pozisyonu riske etmekten iyidir.`);
    if (lastClose != null && px > 0) {
      const after = ((lastClose - px) / px) * 100;
      if (after <= -1.5) add("pos", `Satış sonrası fiyat %${Math.abs(after).toFixed(1)} daha düştü ($${lastClose.toFixed(2)}) — çıkış seni korudu.`);
      else if (after >= 1.5) add("warn", `Satış sonrası fiyat +%${after.toFixed(1)} toparladı ($${lastClose.toFixed(2)}) — erken görünebilir; AMA plan stop'uysa doğru karardı (plan > his).`);
      else add("pos", `Satış sonrası fiyat yatay (${after >= 0 ? "+" : ""}%${after.toFixed(1)}) — zamanlama makul.`);
    }
    if (dayClose != null && e21 != null) {
      if (dayClose < e21) add("pos", `Satış günü fiyat EMA21 ($${e21.toFixed(2)}) altındaydı — trend kırılımında çıkmak sistemle uyumlu.`);
      else if (pnl < 0 && dayClose > e8) add("warn", `Fiyat hâlâ EMA8 ($${e8.toFixed(2)}) üstündeyken zararına satış — stop'a değmeden panik satışı olabilir; planındaki stop neredeydi?`);
    }
    if (isSwing) add("pos", "Swing satışı olarak etiketlendi — uzun vade payına dokunulmadı (ayrı değerlendirme, toplam K/Z'ye dahil).");
  } else {
    const px = Number(t.buyUSD) || 0;
    if (px > 0 && e8 != null && adr) {
      const ext = ((px - e8) / px) * 100;
      if (ext > 0.6 * adr) add("warn", `Giriş EMA8'in %${ext.toFixed(1)} üzerinde (ADR %${adr.toFixed(1)}) — kovalama bölgesi; geri çekilmede girmek stopu yaklaştırır.`);
      else if (ext >= -0.5) add("pos", `Giriş EMA8'e yakın (%${ext.toFixed(1)}) — tabandan disiplinli alım, stop mesafesi makul.`);
      else add("warn", `Giriş EMA8'in altında — düşen bıçak riski; kırılım teyidi (EMA8 üstü kapanış) beklemek daha güvenli.`);
    }
    if (dayClose != null && e50 != null && e21 != null) {
      if (dayClose > e50 && e21 > e50) add("pos", "Trend yönünde alım: fiyat EMA50 üstü, EMA21 > EMA50.");
      else add("neg", `Trend filtresi sağlanmadan alım (fiyat/EMA dizilimi bozuk) — sistem bu koşulda 'girme' der.`);
    }
    if (ctx.regime === "off") add("neg", "Endeks (QQQ) EMA21 altındayken giriş — endeks satışı her hisseye yansır; sistem bu günlerde yeni giriş kapatır.");
    else if (ctx.regime === "caution") add("warn", "Endeks (QQQ) EMA8 altında — giriş yaptıysan boyutu küçük tutmak doğru.");
    const h = (STATE?.holdings || []).find((x) => String(x.symbol).toUpperCase() === String(t.symbol).toUpperCase());
    if (h && h.planStop == null) add("neg", "Bu pozisyonda plan stop girilmemiş — Kural 1: stop'suz pozisyon tutma (Varlıklar → Düzenle → stop).");
    else if (h && h.planStop != null) add("pos", `Plan stop tanımlı ($${Number(h.planStop).toFixed(2)}) — risk sınırlı.`);
    if (ctx.totalUSD > 0 && px > 0) {
      const sizePct = (t.shares * px / ctx.totalUSD) * 100;
      if (sizePct > 25) add("warn", `Bu alım portföyün ~%${sizePct.toFixed(0)}'i — tek karara büyük ağırlık; %15-20 üstü yoğunlaşma tek haberle sarsar.`);
    }
  }
  const negN = F.filter((f) => f.tone === "neg").length, warnN = F.filter((f) => f.tone === "warn").length;
  const verdict = negN ? "neg" : warnN ? "warn" : "pos";
  return { findings: F, verdict, isSwing };
}
async function renderDayAnalysis(dateStr) {
  const el = $("#dayAnalysisBox"); if (!el) return;
  const today = new Date().toISOString().slice(0, 10);
  const d = dateStr || $("#daDate")?.value || today;
  const inp = $("#daDate"); if (inp && !inp.value) inp.value = d;
  const all = (STATE?.trades || []).filter((t) => String(t.date).slice(0, 10) === d);
  if (!all.length) {
    const lastDay = [...new Set((STATE?.trades || []).map((t) => String(t.date).slice(0, 10)))].sort().reverse()[0];
    el.innerHTML = `<div class="ch-empty-box">${d === today ? "Bugün" : chFmtD(d)} işlem yok — analiz edilecek karar yok.${lastDay ? ` Son işlemli gün: <button class="btn ghost sm" data-da-jump="${lastDay}">${chFmtD(lastDay)} analizine bak →</button>` : ""}</div>`;
    return;
  }
  el.innerHTML = `<div class="rk-empty">${all.length} işlem kendi verisiyle değerlendiriliyor…</div>`;
  await chLoadIndex().catch(() => {});
  await Promise.all([...new Set(all.map((t) => t.symbol))].map(daCandles));
  const regime = chRegimeAt(d);
  const totalUSD = (STATE?.holdings || []).reduce((a, h) => a + (h?.live?.marketValueUSD || 0), 0) + (Number(STATE?.cash?.usd) || 0);
  const ctx = { regime, totalUSD };
  const cards = [];
  const aiTrades = []; // Claude gün denetimi için motor bulguları (kanıt paketi)
  let net = 0, posN = 0, warnN = 0, negN = 0;
  for (const t of all) {
    const s = DA._sym[String(t.symbol).toUpperCase()] || null;
    const a = daAnalyzeTrade(t, s, ctx);
    aiTrades.push({
      symbol: t.symbol, tur: t.kind, adet: t.shares, alisUSD: t.buyUSD, satisUSD: t.sellUSD ?? null,
      not: t.note || "", kaynak: t.kind === "sell" ? (a.isSwing ? "swing satışı" : "uzun vade satışı") : "alım",
      motorKarari: a.verdict === "pos" ? "DOGRU" : a.verdict === "warn" ? "TARTISMALI" : "HATALI",
      bulgular: (a.findings || []).map((f) => `${f.tone === "pos" ? "✅" : f.tone === "warn" ? "⚠️" : "❌"} ${f.txt}`),
    });
    if (t.kind === "sell") net += t.shares * ((t.sellUSD || 0) - (t.buyUSD || 0));
    if (a.verdict === "pos") posN++; else if (a.verdict === "warn") warnN++; else negN++;
    const pill = a.verdict === "pos" ? `<span class="ch-pill win">Doğru</span>` : a.verdict === "warn" ? `<span class="ch-pill neu">Tartışmalı</span>` : `<span class="ch-pill loss">Hatalı</span>`;
    const srcTag = t.kind === "sell" ? (a.isSwing ? `<span class="ch-setup pb">⚡ swing satışı</span>` : `<span class="ch-setup brk">uzun vade satışı</span>`) : `<span class="ch-setup brk">alım</span>`;
    const head = t.kind === "sell"
      ? `${fmtNum(t.shares, 4)} adet · $${(+t.buyUSD).toFixed(2)} → $${(+t.sellUSD).toFixed(2)} · <b class="${cls(t.shares * (t.sellUSD - t.buyUSD))}">${fmtUSD(t.shares * (t.sellUSD - t.buyUSD))}</b>`
      : `${fmtNum(t.shares, 4)} adet · $${(+t.buyUSD).toFixed(2)} · maliyet ${fmtUSD(t.shares * t.buyUSD)}`;
    cards.push(`<div class="ch-card ${a.verdict === "pos" ? "win" : a.verdict === "warn" ? "neu" : "loss"}">
      <div class="ch-card-top"><div class="ch-card-sym"><b>${t.symbol}</b> ${srcTag}</div><div class="ch-card-r">${pill}</div></div>
      <div class="ch-card-dt">${head}${t.note ? ` · “${t.note}”` : ""}</div>
      <div class="ch-why"><ul class="ch-ev">${a.findings.map((f) => `<li class="da-${f.tone}">${f.tone === "pos" ? "✅" : f.tone === "warn" ? "⚠️" : "❌"} ${f.txt}</li>`).join("") || "<li>Veri yetersiz — mum geçmişi alınamadı.</li>"}</ul></div>
    </div>`);
  }
  const sums = [`${all.length} işlem`, `${posN} doğru`, warnN ? `${warnN} tartışmalı` : null, negN ? `${negN} hatalı` : null, `net realize <b class="${cls(net)}">${fmtUSD(net)}</b>`].filter(Boolean).join(" · ");
  const coach = negN === 0 && warnN === 0 ? "Bugünkü kararların veriyle uyumlu — disiplin yerinde." : negN > 0 ? "Kırmızı maddeler sistematik hata — bir sonraki işlemden önce o kuralı yaz, ekrana yapıştır." : "Sarı maddeler gri bölge — plana sadıksan sorun değil, plansızsa sinyaldir.";
  el.innerHTML = `<div class="da-summary">${sums}<span class="da-coach">${coach}</span></div><div class="ch-jrnl">${cards.join("")}</div><div id="daAi"></div>`;
  DA_AI_PAYLOAD = {
    date: d,
    ozet: `${all.length} işlem, ${posN} doğru, ${warnN} tartışmalı, ${negN} hatalı, net realize ${fmtUSD(net)}`,
    rejim: regime ?? null,
    islemler: aiTrades,
  };
  daRenderAiSlot(d);
}
$("#daDate")?.addEventListener("change", () => renderDayAnalysis($("#daDate").value));
$("#dayAnalysisBox")?.addEventListener("click", (e) => { const b = e.target.closest("[data-da-jump]"); if (b) { const inp = $("#daDate"); if (inp) inp.value = b.dataset.daJump; renderDayAnalysis(b.dataset.daJump); } });

/* ---- Swing Defteri: olay delegasyonu (yeniden çizime dayanıklı) ---- */
$("#swingDeck")?.addEventListener("click", (e) => {
  const add = e.target.closest("#swAddBtn");
  if (add) return openSwingModal();
  const goal = e.target.closest("#swGoalEditBtn");
  if (goal) return openSwingGoal();
  const ref = e.target.closest("#swRefreshBtn");
  if (ref) { ref.disabled = true; ref.textContent = "↻ …"; loadSwingDeck().finally(() => { ref.disabled = false; ref.textContent = "↻ Fiyat yenile"; }); return; }
  const ed = e.target.closest("[data-sw-edit]");
  if (ed) return openSwingModal(ed.dataset.swEdit);
  const cl = e.target.closest("[data-sw-sell]");
  if (cl) return openSwingSell(cl.dataset.swSell);
  const del = e.target.closest("[data-sw-del]");
  if (del) return delSwing(del.dataset.swDel);
});

/* ---- Aylık kazanç grafiği: bar üstüne gelince o ayın $ kazancını gösteren balon ---- */
(function () {
  const deck = $("#swingDeck"); if (!deck || deck._swBarTip) return; deck._swBarTip = true;
  let tip = null;
  const show = (col) => {
    if (!tip) { tip = document.createElement("div"); tip.className = "sw-bartip"; document.body.appendChild(tip); }
    const cnt = +(col.dataset.swmCount || 0), hit = col.dataset.swmHit === "1";
    const cCls = String(col.dataset.swmTotal).includes("-") ? "neg" : cnt > 0 ? "pos" : "muted";
    tip.innerHTML = `<div class="sw-bartip-d">${col.dataset.swmLbl}</div>
      <div class="sw-bartip-v ${cCls}">${col.dataset.swmTotal}</div>
      <div class="sw-bartip-c">${cnt > 0 ? `${cnt} işlem realize${hit ? " · hedef tuttu 🎯" : ""}` : "işlem yok"}</div>`;
    tip.style.display = "block";
  };
  const move = (e) => { if (tip && tip.style.display === "block") { tip.style.left = e.clientX + "px"; tip.style.top = (e.clientY - 14) + "px"; } };
  deck.addEventListener("mouseover", (e) => { const col = e.target.closest(".sw-bar-col"); if (col) { show(col); move(e); } });
  deck.addEventListener("mousemove", move);
  deck.addEventListener("mouseout", (e) => { if (e.target.closest(".sw-bar-col") && tip) tip.style.display = "none"; });
})();

/* ---- Swing modal: ekle / düzenle ---- */
const swingModalBg = $("#swingModalBg");
const swingForm = $("#swingForm");
let swSelectedHolding = null; // "Portföyden seç" ile bağlanan holding
let swCostMode = "unit";      // unit | total | auto
function swPopulatePicker() {
  const sel = $("#swPick");
  if (!sel) return;
  const stocks = (STATE?.holdings || []).filter((h) => h.type === "stock");
  sel.innerHTML = `<option value="">— Portföy pozisyonu seç (veya aşağıya elle sembol gir) —</option>` +
    stocks.map((h) => `<option value="${h.id}">${h.symbol}${h.name ? " — " + h.name.replace(/"/g, "") : ""} · ${fmtNum(h.quantity, 2)} adet${Number(h.costUSD) > 0 ? " · ort $" + fmtNum(h.costUSD, 2) : ""}</option>`).join("");
}
function setSwCostMode(mode) {
  swCostMode = mode;
  $("#swCostMode")?.querySelectorAll(".segm").forEach((x) => x.classList.toggle("active", x.dataset.cm === mode));
  $("#swEntryWrap").hidden = mode !== "unit";
  $("#swTotalWrap").hidden = mode !== "total";
  swingRiskHint(); swingSizeCalc();
}
// Maliyet moduna göre etkin birim maliyet ($/hisse)
function swEffectiveEntry() {
  const qty = Number(swingForm.qty.value);
  if (swCostMode === "total") {
    const tc = Number(swingForm.totalCost.value);
    return tc > 0 && qty > 0 ? tc / qty : NaN;
  }
  if (swCostMode === "auto") {
    return swSelectedHolding && Number(swSelectedHolding.costUSD) > 0 ? Number(swSelectedHolding.costUSD) : NaN;
  }
  return Number(swingForm.entry.value);
}
function openSwingModal(id, prefill) {
  swingForm.reset();
  swingForm.id.value = "";
  $("#swRiskPct").value = SWINGDECK.goal?.riskPct || 1;
  $("#swAvail").textContent = "";
  swSelectedHolding = null;
  swPopulatePicker();
  setSwCostMode("unit");
  const t = id ? SWINGDECK.trades.find((x) => x.id === id) : null;
  if (t) {
    $("#swingModalTitle").textContent = "Swing Pozisyonu Düzenle";
    swingForm.id.value = t.id;
    swingForm.symbol.value = t.symbol;
    swingForm.qty.value = t.qty;
    swingForm.entry.value = t.entry;
    swingForm.openedAt.value = t.openedAt || "";
    swingForm.stop.value = t.stop ?? "";
    swingForm.target.value = t.target ?? "";
    swingForm.note.value = t.note || "";
  } else {
    $("#swingModalTitle").textContent = prefill ? `${prefill.symbol} — Swing Pozisyonu Aç` : "Swing Pozisyonu Aç";
    swingForm.openedAt.value = new Date().toISOString().slice(0, 10);
    if (prefill) {
      // Radar/Haftalık sinyal kartından gelen kurulum: sembol + stop + hedef ön-dolu
      if (prefill.symbol) swingForm.symbol.value = prefill.symbol;
      if (prefill.entry != null) swingForm.entry.value = prefill.entry;
      if (prefill.stop != null) swingForm.stop.value = prefill.stop;
      if (prefill.target != null) swingForm.target.value = prefill.target;
      if (prefill.note) swingForm.note.value = prefill.note;
      // Sinyal sembolü portföyde varsa picker'ı da eşle (ort. maliyet/plan erişimi için)
      const h = (STATE?.holdings || []).find((x) => x.type === "stock" && x.symbol === String(prefill.symbol || "").toUpperCase());
      if (h) { $("#swPick").value = h.id; swSelectedHolding = h; $("#swAvail").textContent = `Portföyde ${fmtNum(h.quantity, 2)} adet`; }
    }
  }
  swingRiskHint();
  swingSizeCalc();
  swQmSym = ""; $("#swQmCheck") && ($("#swQmCheck").hidden = true);  // QM kapısını sıfırla
  scheduleSwQmCheck();                                              // sembol ön-doluysa hemen tara
  swingModalBg.hidden = false;
  // Portföyden seçim akışı birincil → seçiciye odaklan; ön-dolu/düzenlemede adede
  setTimeout(() => ((prefill || t) ? swingForm.qty : $("#swPick")).focus(), 50);
}
// "Portföyden seç" → holding'i swing alanlarına bağla (adet=tam, maliyet=ort, plan stop/hedef)
$("#swPick")?.addEventListener("change", (e) => {
  const h = (STATE?.holdings || []).find((x) => x.id === e.target.value);
  swSelectedHolding = h || null;
  if (!h) { $("#swAvail").textContent = ""; return; }
  swingForm.symbol.value = h.symbol;
  swingForm.qty.value = h.quantity;            // varsayılan: tüm pozisyon (kullanıcı azaltabilir)
  if (Number(h.costUSD) > 0) swingForm.entry.value = h.costUSD;
  if (Number(h.planStop) > 0) swingForm.stop.value = h.planStop;
  if (Number(h.planTarget) > 0) swingForm.target.value = h.planTarget;
  $("#swAvail").textContent = `Portföyde ${fmtNum(h.quantity, 2)} adet${Number(h.costUSD) > 0 ? ` · ort. maliyet $${fmtNum(h.costUSD, 2)}` : ""}`;
  swingRiskHint(); swingSizeCalc();
});
// Elle sembol değişti → picker bağını kopar
swingForm?.symbol?.addEventListener("input", () => {
  if (swSelectedHolding && swingForm.symbol.value.toUpperCase() !== swSelectedHolding.symbol) {
    $("#swPick").value = ""; swSelectedHolding = null; $("#swAvail").textContent = "";
  }
});
$("#swCostMode")?.addEventListener("click", (e) => {
  const b = e.target.closest(".segm"); if (b) setSwCostMode(b.dataset.cm);
});
// Radar/Haftalık sinyal kartından tek tıkla swing aç → sekmeye geç + modalı ön-dolu aç
function openSwingFromPlan(p) {
  showView("swingdefteri");
  openSwingModal(null, p);
}
// Sinyal kartlarına eklenen "Swing aç" butonu (entry yoksa gösterilmez)
function swFromBtn(p) {
  if (p.entry == null) return "";
  const enc = encodeURIComponent(JSON.stringify({ symbol: p.symbol, entry: p.entry, stop: p.stop ?? null, target: p.target ?? null, note: p.note || "" }));
  return `<button type="button" class="btn ghost sm sw-from" data-swfrom="${enc}" title="Bu kurulumu Swing Defteri'ne aktar">📈 Swing aç</button>`;
}
// Capture-fazı: kart/satırın kendi tıklama (grafik) handler'ından önce yakala
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-swfrom]");
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  try { openSwingFromPlan(JSON.parse(decodeURIComponent(b.dataset.swfrom))); } catch {}
}, true);

/* ---- Pozisyon boyutu hesaplayıcı (sermayenin %X'i riske) ---- */
let swCalcShares = null;
function swingSizeCalc() {
  const body = $("#swCalcBody");
  if (!body) return;
  const entry = swEffectiveEntry();
  const stop = Number(swingForm.stop.value);
  const riskPct = Number($("#swRiskPct").value) || 1;
  const goal = SWINGDECK.goal || {};
  const portUSD = ALLOC.usdtry && ALLOC.grandTotalTRY ? ALLOC.grandTotalTRY / ALLOC.usdtry : null;
  const capital = goal.capital > 0 ? goal.capital : portUSD; // özel risk sermayesi yoksa canlı portföy
  swCalcShares = null;
  const useBtn = $("#swCalcUse");
  if (useBtn) useBtn.disabled = true;
  if (!capital) { body.innerHTML = `<div class="sw-calc-warn">Portföy değeri henüz yüklenmedi — önce “Genel Bakış”ı aç, ya da ayarlardan (⚙ Hedef) risk sermayesi gir.</div>`; return; }
  if (!(entry > 0) || !(stop > 0 && entry > stop)) {
    body.innerHTML = `<div class="sw-calc-hint">Giriş ve stop (giriş'in altında) gir → riske ${riskPct}% ile önerilen adet otomatik gelir.</div>`;
    return;
  }
  const riskAmt = capital * (riskPct / 100);
  const perShare = entry - stop;
  let shares = riskAmt / perShare;
  const maxShares = (capital * 0.25) / entry; // tek pozisyon %25 sınırı (kaldıraçsız)
  let capped = false;
  if (shares > maxShares) { shares = maxShares; capped = true; }
  const posVal = shares * entry;
  swCalcShares = Math.round(shares * 100) / 100;
  if (useBtn) useBtn.disabled = false;
  body.innerHTML = `
    <div class="sw-calc-row"><span>Risk sermayesi${goal.capital > 0 ? "" : " (portföy)"}</span><b>${fmtUSD0(capital)}</b></div>
    <div class="sw-calc-row"><span>Riske attığın (${riskPct}%)</span><b>${fmtUSD0(riskAmt)}</b></div>
    <div class="sw-calc-row hi"><span>Önerilen adet</span><b>${fmtNum(swCalcShares, 2)}${capped ? " <i>· %25 sınırı</i>" : ""}</b></div>
    <div class="sw-calc-row"><span>Pozisyon tutarı</span><b>${fmtUSD0(posVal)} · %${((posVal / capital) * 100).toFixed(1)} portföy</b></div>`;
}
// Risk/ödül canlı ipucu
function swingRiskHint() {
  const entry = swEffectiveEntry();
  const stop = Number(swingForm.stop.value);
  const target = Number(swingForm.target.value);
  const qty = Number(swingForm.qty.value);
  const note = $("#swingRiskNote");
  if (!(entry > 0)) {
    note.textContent = swCostMode === "auto" && !swSelectedHolding
      ? "“Portföyden al” modu: önce yukarıdan bir pozisyon seç (ort. maliyeti kullanılır) ya da Birim/Toplam'a geç."
      : "Stop ve hedef opsiyonel — girersen risk/ödül ve pozisyon riskini otomatik hesaplarım. Planı olmayan işleme girme.";
    return;
  }
  const parts = [];
  if (stop > 0 && qty > 0) parts.push(`Planlı risk ${fmtUSD0((entry - stop) * qty)}`);
  if (stop > 0 && target > 0 && entry - stop > 0) parts.push(`R/Ö ${((target - entry) / (entry - stop)).toFixed(1)}`);
  if (target > 0 && qty > 0) parts.push(`Hedef kazanç ${fmtUSD0((target - entry) * qty)}`);
  note.innerHTML = parts.length ? parts.join(" · ") : "Stop ve hedef gir → risk/ödül otomatik hesaplanır.";
  // Kademeli çıkış planı (Faz 1: en az zararla çık) — giriş+stop varsa R seviyeleri
  const planBox = $("#swExitPlan");
  if (planBox) {
    if (stop > 0 && entry > stop) {
      const R = entry - stop;
      const r2 = entry + 2 * R, r3 = entry + 3 * R;
      planBox.innerHTML = `<div class="sw-plan-h">📐 Kademeli çıkış planı <span class="muted">(1R = ${fmtUSD(R)})</span></div>
        <ul class="sw-plan">
          <li><b class="neg">Stop ${fmtUSD(stop)}</b> — kapanış altına inerse ÇIK. "Belki döner" deme. ${qty > 0 ? `Max kayıp ${fmtUSD0((entry - stop) * qty)}.` : ""}</li>
          <li><b class="pos">+2R ${fmtUSD(r2)}</b> — yarısını sat, stop'u <b>girişe (breakeven ${fmtUSD(entry)})</b> çek → risk sıfırlanır, kalan bedava pozisyon.</li>
          <li><b class="pos">Kalan</b> — 10/20 günlük ortalama ile sürükle; MA altına kapanışta sat${target > 0 ? ` (ya da hedef ${fmtUSD(target)})` : ""}.</li>
          <li class="muted">⏳ Zaman-stop: kırılımdan 7+ gün geçti ama &lt;1R ise kurulum çalışmadı → çık.</li>
        </ul>`;
      planBox.hidden = false;
    } else { planBox.hidden = true; }
  }
}
["input", "change"].forEach((ev) => swingForm?.addEventListener(ev, () => { swingRiskHint(); swingSizeCalc(); }));

/* ---- Faz 2: QM giriş-kalitesi kapısı (sembol girilince checklist + ADR + extended) ---- */
let swQmTimer = null, swQmSym = "";
function scheduleSwQmCheck() {
  const sym = String(swingForm?.symbol?.value || "").toUpperCase().trim().split(/\s/)[0];
  const box = $("#swQmCheck");
  if (!box) return;
  if (!sym || sym.length < 1) { box.hidden = true; swQmSym = ""; return; }
  if (sym === swQmSym) return;             // aynı sembol → tekrar çekme
  swQmSym = sym;
  clearTimeout(swQmTimer);
  box.hidden = false;
  box.innerHTML = `<div class="sw-qm-load">↻ ${sym} kurulum kalitesi taranıyor…</div>`;
  swQmTimer = setTimeout(() => loadSwQmCheck(sym), 450);
}
async function loadSwQmCheck(sym) {
  const box = $("#swQmCheck");
  if (!box) return;
  let d;
  try { const r = await fetch(`/api/qm/${encodeURIComponent(sym)}`); d = await r.json(); }
  catch { box.hidden = true; return; }
  if (swQmSym !== sym) return;              // kullanıcı sembolü değiştirdi → bayat
  if (!d || d.error || d.ok === false) {
    box.innerHTML = `<div class="sw-qm-h"><span class="sw-qm-bad">⚠️ ${sym}</span> <span class="muted">${d?.reason || "kurulum verisi yok"} — yine de plan (stop/hedef) ile girebilirsin.</span></div>`;
    return;
  }
  const passN = d.passN || 0, total = d.passTotal || 8;
  const gateOk = passN >= 6;
  const adrOk = d.adrPct != null && d.adrPct >= 4;
  const liqOk = d.liquidity?.ok;
  const ext = d.extendedOverMA10 != null && d.extendedOverMA10 > 4;
  const stageLbl = { "breaking-out": "🚀 Kırılımda", "setting-up": "🎯 Kuruluyor (1-2 ay adayı)", "early": "⏳ Erken", "extended": "🔥 Gergin (kovalama)", "none": "—" }[d.stage] || d.stage;
  const checks = (d.checklist || []).map((c) =>
    `<li class="${c.pass ? "ok" : "no"}"><span>${c.pass ? "✓" : "✕"}</span> ${c.k} <b>${c.val ?? ""}</b></li>`).join("");
  box.innerHTML = `
    <div class="sw-qm-h">
      <span class="sw-qm-gate ${gateOk ? "ok" : "warn"}">${gateOk ? "✓ Giriş kalitesi" : "⚠️ Zayıf kurulum"} ${passN}/${total}</span>
      <span class="sw-qm-stage">${stageLbl}${d.score != null ? ` · skor ${d.score}` : ""}</span>
    </div>
    <div class="sw-qm-badges">
      <span class="sw-qm-b ${adrOk ? "ok" : "no"}" title="Qullamaggie: ADR ≥ %4 (yeterli günlük hareket)">ADR ${d.adrPct != null ? "%" + d.adrPct.toFixed(1) : "—"}</span>
      <span class="sw-qm-b ${liqOk ? "ok" : "no"}" title="Fiyat ≥ $5 ve 20g ort. hacim ≥ 500k">${liqOk ? "Likit ✓" : "Likidite düşük"}</span>
      ${ext ? `<span class="sw-qm-b no" title="Fiyat 10MA'dan ${d.extendedOverMA10}× ADR uzakta — geri çekilme bekle">🔥 Gergin ${d.extendedOverMA10}×</span>` : ""}
      ${d.priorMovePct != null ? `<span class="sw-qm-b ${d.priorMovePct >= 30 ? "ok" : "no"}" title="Kurulum öncesi hamle (momentum)">Önceki hamle %${Math.round(d.priorMovePct)}</span>` : ""}
    </div>
    <ul class="sw-qm-list">${checks}</ul>
    ${d.entryTrigger != null ? `<div class="sw-qm-sugg">
      <span>Önerilen kurulum: giriş <b>${fmtUSD(d.entryTrigger)}</b> · stop <b class="neg">${fmtUSD(d.stop)}</b>${d.stopPct != null ? ` <span class="muted">(−%${d.stopPct.toFixed(1)})</span>` : ""} · hedef <b class="pos">${fmtUSD(d.rTargets?.r2)}</b>/<b class="pos">${fmtUSD(d.rTargets?.r3)}</b></span>
      <button type="button" class="btn ghost sm" id="swQmApply" data-e="${d.entryTrigger}" data-s="${d.stop}" data-t="${d.rTargets?.r2 ?? ""}">↧ Uygula</button>
    </div>` : ""}
    ${!gateOk ? `<div class="sw-qm-warn">Kontrol listesi ${passN}/${total} — kriterlerin çoğu sağlanmıyor. Qullamaggie: zayıf kurulumu zorlama, daha iyi aday bekle (Kural 1: para kaybetme).</div>` : ""}`;
  $("#swQmApply")?.addEventListener("click", (e) => {
    const b = e.currentTarget;
    if (b.dataset.e) swingForm.entry.value = b.dataset.e;
    if (b.dataset.s) swingForm.stop.value = b.dataset.s;
    if (b.dataset.t) swingForm.target.value = b.dataset.t;
    setSwCostMode("unit");
    swingRiskHint(); swingSizeCalc();
    toast("QM kurulumu uygulandı: giriş/stop/hedef dolduruldu");
  });
}
swingForm?.symbol?.addEventListener("input", scheduleSwQmCheck);

$("#swCalcUse")?.addEventListener("click", () => {
  if (swCalcShares == null) return;
  swingForm.qty.value = swCalcShares;
  swingRiskHint();
  toast(`Önerilen adet uygulandı: ${fmtNum(swCalcShares, 2)}`);
});
$("#swingCancelBtn")?.addEventListener("click", () => (swingModalBg.hidden = true));
swingModalBg?.addEventListener("click", (e) => { if (e.target === swingModalBg) swingModalBg.hidden = true; });
swingForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(swingForm).entries());
  const id = fd.id;
  // Maliyet moduna göre gövde: birim→entry, toplam→totalCost, portföyden al→ikisi de boş
  // (sunucu eşleşen holding'in ort. maliyetini kullanır). entry hiçbir modda zorunlu değil.
  const body = {
    symbol: fd.symbol, qty: fd.qty,
    stop: fd.stop || null, target: fd.target || null,
    openedAt: fd.openedAt, note: fd.note || "",
  };
  if (swCostMode === "unit" && fd.entry) body.entry = fd.entry;
  else if (swCostMode === "total" && fd.totalCost) body.totalCost = fd.totalCost;
  // auto modunda entry/totalCost gönderilmez → sunucu holding ort. maliyetini kullanır
  const method = id ? "PUT" : "POST";
  const url = id ? `/api/swing-trades/${id}` : "/api/swing-trades";
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.error || "Kaydedilemedi", "err"); return; }
  swingModalBg.hidden = true;
  toast(id ? "Pozisyon güncellendi" : `${(fd.symbol || "").toUpperCase()} swing açıldı · portföyde de görünür`);
  loadSwingDeck();
  load(); // ana portföy "swing" rozetini tazele
});

/* ---- Swing modal: sat / ana para çek (kısmi veya tam, gerçek satış) ---- */
const swingCloseBg = $("#swingCloseBg");
const swingCloseForm = $("#swingCloseForm");
let swSellTrade = null;
function openSwingSell(id, full = false) {
  const t = SWINGDECK.trades.find((x) => x.id === id);
  if (!t) return;
  swSellTrade = t;
  swingCloseForm.reset();
  swingCloseForm.id.value = t.id;
  $("#swingCloseTitle").textContent = full ? `${t.symbol} — Pozisyonu Kapat` : `${t.symbol} — Sat / Ana Para Çek`;
  const price = SWINGDECK.live[t.symbol]?.price ?? t.entry;
  swingCloseForm.exitPrice.value = SWINGDECK.live[t.symbol]?.price ?? "";
  swingCloseForm.closedAt.value = new Date().toISOString().slice(0, 10);
  // full → tüm pozisyon (kapat); değilse ana parayı çekmek için önerilen adet = (kalan giriş maliyeti) / güncel fiyat
  const principalShares = price > 0 ? Math.min(t.qty, (t.entry * t.qty) / price) : t.qty;
  swingCloseForm.shares.value = full ? +Number(t.qty).toFixed(4) : +principalShares.toFixed(2);
  swingCloseForm.shares.max = t.qty;
  swSellHint();
  swingCloseBg.hidden = false;
  setTimeout(() => swingCloseForm.shares.focus(), 50);
}
// Satış önizleme: kâr + kalan adet + tam satış uyarısı
function swSellHint() {
  const t = swSellTrade; if (!t) return;
  const sh = Math.min(Number(swingCloseForm.shares.value) || 0, t.qty);
  const px = Number(swingCloseForm.exitPrice.value) || 0;
  const note = $("#swingCloseNote");
  if (!(sh > 0) || !(px > 0)) { note.textContent = `Toplam ${fmtNum(t.qty, 2)} adet · giriş $${fmtNum(t.entry, 2)}. Satılacak adet + çıkış fiyatı gir.`; return; }
  const MIDAS_FEE = 1.5;
  const gross = (px - t.entry) * sh;
  const pnl = gross - MIDAS_FEE;               // Midas $1.5 satış komisyonu düşülü net
  const remain = t.qty - sh;
  note.innerHTML = `Satılacak <b>${fmtNum(sh, 2)}</b> adet → net kâr <b>${fmtUSD(pnl)}</b> <span class="muted">(brüt ${fmtUSD(gross)} − $1.5 Midas)</span> · kalan <b>${fmtNum(remain, 2)}</b> adet${remain <= 1e-6 ? " (pozisyon kapanır)" : ""}.<br>Bu net kâr <b>swing getirisine</b> + <b>vergiye (Realize 2026)</b> + <b>işlem geçmişine</b> işlenir, holding adedi düşer.`;
}
["input", "change"].forEach((ev) => swingCloseForm?.addEventListener(ev, swSellHint));
$("#swingCloseCancelBtn")?.addEventListener("click", () => (swingCloseBg.hidden = true));
swingCloseBg?.addEventListener("click", (e) => { if (e.target === swingCloseBg) swingCloseBg.hidden = true; });
swingCloseForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(swingCloseForm).entries());
  const r = await fetch(`/api/swing-trades/${fd.id}/sell`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shares: fd.shares, exitPrice: fd.exitPrice, date: fd.closedAt }),
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.error || "Satılamadı", "err"); return; }
  swingCloseBg.hidden = true;
  toast("Satıldı · swing getirisi + vergi + işlem geçmişi güncellendi");
  loadSwingDeck();
  load(); // ana portföy (holding adedi, sıfır-maliyet sütunu, realize) tazelensin
});

/* ---- Swing aylık hedef düzenle ---- */
const swingGoalBg = $("#swingGoalBg");
const swingGoalForm = $("#swingGoalForm");
function openSwingGoal() {
  const g = SWINGDECK.goal || { min: 600, max: 700 };
  swingGoalForm.min.value = g.min;
  swingGoalForm.max.value = g.max;
  swingGoalForm.capital.value = g.capital || "";
  swingGoalForm.riskPct.value = g.riskPct || 1;
  swingGoalBg.hidden = false;
  setTimeout(() => swingGoalForm.min.focus(), 50);
}
$("#swingGoalCancelBtn")?.addEventListener("click", () => (swingGoalBg.hidden = true));
swingGoalBg?.addEventListener("click", (e) => { if (e.target === swingGoalBg) swingGoalBg.hidden = true; });
swingGoalForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(swingGoalForm).entries());
  const r = await fetch("/api/swing-goal", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ min: fd.min, max: fd.max, capital: fd.capital, riskPct: fd.riskPct }) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.error || "Hedef kaydedilemedi", "err"); return; }
  SWINGDECK.goal = await r.json();
  swingGoalBg.hidden = true;
  toast("Aylık hedef güncellendi");
  renderSwingDeck();
});

async function delSwing(id) {
  const t = SWINGDECK.trades.find((x) => x.id === id);
  const lbl = t ? t.symbol : "Pozisyon";
  const ok = await confirmDialog({ title: `${lbl} kaydı silinsin mi?`, message: "Bu swing kaydı defterden kaldırılacak.", confirmText: "Sil", danger: true });
  if (!ok) return;
  await fetch(`/api/swing-trades/${id}`, { method: "DELETE" });
  toast(`${lbl} silindi`);
  loadSwingDeck();
}

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
  if (name === "challenge") renderChallenge();
  if (name === "raporlar") renderDayAnalysis();
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
  const blocks = [...view.children].filter((el) =>
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
loadSentiment(); // duygu kartları anında gelsin (ağır portföy çağrısını beklemeden)
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
      ${n.url ? `<a class="note-src" href="${noteEsc(n.url)}" target="_blank" rel="noopener noreferrer">🔗 kaynak</a>` : ""}
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
