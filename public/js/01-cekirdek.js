/* 01-cekirdek.js — yardımcılar & durum & veri yükleme (load/render) · tooltip · Sen Yokken akışı · sol menü canlı katman · sparkline · ikon sistemi
 * app.js'in SIRALI dilimi (bölme: 15 Tem 2026). Dosyalar index.html'deki sırayla yüklenir;
 * klasik script'ler global kapsamı paylaşır — sıra değiştirme, dosyayı IIFE'ye sarma. */
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
  option: "#8b7fd6",  // opsiyon — mor
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
  { from: 0,  to: 25,  color: "#d8442f", label: "Aşırı Korku" },
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

  host.innerHTML = (fngCard || regimeCard)
    ? `<div class="sec-label">Piyasa Nabzı</div><div class="cards-mid">${fngCard}${regimeCard}</div>` : "";
}

// Duygu kartlarını ağır portföy çağrısını beklemeden hemen yükle
async function loadSentiment() {
  try {
    const d = await (await fetch("/api/sentiment")).json();
    renderSentiment(d);
  } catch {}
}

/* ---------------- "Sen Yokken" — açılış olay akışı ----------------
 * Sunucudaki olay defteri (bekçi/sinyal/rejim/Alfa) + cihazlar-arası "gördüm"
 * imleci. Yeni olay yoksa kart hiç çizilmez — sayfa temiz kalır. */
let FEEDDATA = null;
let FEED_OPENALL = false;
const FEED_ICON = { pos: "shield", sig: "zap", mkt: "activity", alfa: "trophy", plan: "calendar" };
const FEED_NAV = { sig: "radar", alfa: "challenge", plan: "swingdefteri" }; // satır tıklaması ilgili sekmeye götürür
const FEED_SEVR = { crit: 0, warn: 1, info: 2 };
function feedClock(t) { return String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0"); }
function feedAgo(ts) {
  const t = new Date(ts), now = new Date();
  const mins = Math.max(0, (now - t) / 60000);
  if (mins < 1) return "az önce";
  if (mins < 60) return Math.round(mins) + " dk önce";
  const day = t.toLocaleDateString("sv"), today = now.toLocaleDateString("sv");
  const yday = new Date(now - 86400000).toLocaleDateString("sv");
  if (day === today) return feedClock(t);
  if (day === yday) return "dün " + feedClock(t);
  return Math.round(mins / 1440) + " gün önce";
}
function feedSince(iso) {
  const t = new Date(iso), now = new Date();
  const day = t.toLocaleDateString("sv"), today = now.toLocaleDateString("sv");
  const yday = new Date(now - 86400000).toLocaleDateString("sv");
  const lbl = day === today ? feedClock(t) : day === yday ? "dün " + feedClock(t)
    : t.toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
  return lbl + " → şimdi";
}
const FEED_GRP = [ // pencere içindeki grup sırası + etiketleri
  { type: "pos",  lbl: "Pozisyonların" },
  { type: "sig",  lbl: "Sinyaller" },
  { type: "mkt",  lbl: "Piyasa & Skor" },
  { type: "alfa", lbl: "Alfa Avı" },
  { type: "plan", lbl: "Haftalık Plan" }, // Hafta Sonu Rutini olayları — listede olmayan tür pencerede KAYBOLUR, yeni tür eklerken buraya da ekle
];
function feedNewEvents() {
  const f = FEEDDATA;
  return (f?.events || [])
    .filter((e) => !f.seenAt || e.ts > f.seenAt)
    .sort((a, b) => (FEED_SEVR[a.sev] ?? 3) - (FEED_SEVR[b.sev] ?? 3) || (a.ts < b.ts ? 1 : -1));
}
function feedRow(e) {
  const nav = e.sym && e.type === "pos" ? ` data-chsym="${e.sym}" title="Grafiği aç — ${e.sym}"`
    : FEED_NAV[e.type] ? ` data-fdnav="${FEED_NAV[e.type]}" title="${FEED_NAV[e.type] === "radar" ? "Radar'a git" : "Alfa Avı'na git"}"` : "";
  return `<div class="fd-row fd-${e.sev || "info"}"${nav} role="listitem">
    <span class="fd-ic">${svgIcon(FEED_ICON[e.type] || "bell")}</span>
    <span class="fd-body"><b class="fd-tt">${e.title}</b>${e.detail ? `<span class="fd-dd">${e.detail}</span>` : ""}</span>
    <span class="fd-t">${feedAgo(e.ts)}${nav ? '<i class="fd-go">→</i>' : ""}</span>
  </div>`;
}
/* Özet şerit: tek satır — ne kadar önemli, tek bakışta. Detay pencerede. */
function renderFeed() {
  const host = $("#feedStrip"); if (!host) return;
  const evs = feedNewEvents();
  const sig = evs.map((e) => e.id).join(",");
  if (host.dataset.fsig === sig) return; // aynı içerik — poll etkileşimi bozmasın
  host.dataset.fsig = sig;
  if (!evs.length) { host.hidden = true; host.innerHTML = ""; feedDrawerClose(); return; }
  const n = { crit: 0, warn: 0, info: 0 };
  evs.forEach((e) => { n[e.sev in n ? e.sev : "info"]++; });
  const chip = (k, lbl) => n[k] ? `<span class="fdb-c ${k}">${n[k]} ${lbl}</span>` : "";
  const peek = evs[0] ? evs[0].title : "";
  host.hidden = false;
  host.innerHTML = `
    <button class="fdb" data-fdopen type="button" aria-haspopup="dialog" title="Sen yokken olan biteni aç">
      <span class="fdb-ic">${svgIcon("bell")}</span>
      <span class="fdb-t">Sen yokken</span>
      ${chip("crit", "kritik")}${chip("warn", "uyarı")}${chip("info", "yeni")}
      <span class="fdb-peek">${peek}</span>
      <span class="fdb-go">İncele →</span>
    </button>`;
  if (FEED_OPENALL) feedDrawerRender(); // pencere açıkken içerik tazelendiyse yeniden çiz
}
/* Açılır pencere: türe göre gruplu — "hangi birine bakacağım" derdine düzen */
function feedDrawerRender() {
  let bg = $("#fdDrawerBg");
  if (!bg) {
    bg = document.createElement("div");
    bg.id = "fdDrawerBg"; bg.className = "fdd-bg"; bg.hidden = true;
    document.body.appendChild(bg);
    bg.addEventListener("click", async (e) => {
      if (e.target === bg || e.target.closest("[data-fdclose]")) { feedDrawerClose(); return; }
      const nv = e.target.closest("[data-fdnav]");
      if (nv) { feedDrawerClose(); showView(nv.dataset.fdnav); return; }
      if (e.target.closest("[data-chsym]")) { feedDrawerClose(); return; } // grafik global handler'da açılır
      if (!e.target.closest("[data-fdseen]")) return;
      try {
        const r = await (await fetch("/api/feed/seen", { method: "POST" })).json();
        if (FEEDDATA) FEEDDATA.seenAt = r.seenAt || new Date().toISOString();
      } catch { if (FEEDDATA) FEEDDATA.seenAt = new Date().toISOString(); }
      feedDrawerClose();
      delete $("#feedStrip").dataset.fsig;
      renderFeed();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") feedDrawerClose(); });
  }
  const evs = feedNewEvents();
  const f = FEEDDATA;
  const groups = FEED_GRP.map(({ type, lbl }) => {
    const g = evs.filter((e) => e.type === type);
    if (!g.length) return "";
    return `<div class="fdd-sec"><span class="fdd-sec-t">${lbl}</span><span class="fdd-sec-n">${g.length}</span></div>
      <div class="fd-list" role="list">${g.map(feedRow).join("")}</div>`;
  }).join("");
  bg.innerHTML = `
    <aside class="fdd" role="dialog" aria-modal="true" aria-label="Sen yokken">
      <div class="fdd-head">
        <span class="fd-title">${svgIcon("bell", "h2-ic")}Sen yokken</span>
        <span class="fd-count">${evs.length}</span>
        <span class="fd-since">${f?.seenAt ? feedSince(f.seenAt) : "son 14 gün"}</span>
        <button class="fdd-x" data-fdclose type="button" aria-label="Kapat">✕</button>
      </div>
      <div class="fdd-body">${groups || '<div class="fdd-empty">Yeni olay yok — her şey kontrol altında.</div>'}</div>
      <div class="fdd-foot">
        <button class="btn primary sm" data-fdseen type="button" title="'Gördüm' imleci cihazlar arası ortaktır">✓ Tümünü gördüm</button>
      </div>
    </aside>`;
}
function feedDrawerOpen() {
  FEED_OPENALL = true;
  feedDrawerRender();
  const bg = $("#fdDrawerBg");
  bg.hidden = false;
  requestAnimationFrame(() => bg.classList.add("on"));
}
function feedDrawerClose() {
  FEED_OPENALL = false;
  const bg = $("#fdDrawerBg");
  if (!bg || bg.hidden) return;
  bg.classList.remove("on");
  setTimeout(() => { bg.hidden = true; }, 240);
}
async function loadFeed() {
  try { FEEDDATA = await (await fetch("/api/feed")).json(); renderFeed(); } catch {}
}
$("#feedStrip")?.addEventListener("click", (e) => {
  if (e.target.closest("[data-fdopen]")) feedDrawerOpen();
});

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
            `<div class="hc-seg ${s.pct >= 0 ? "up" : "down"}"><span class="hc-k">${s.label}</span><span class="hc-v">${s.pct >= 0 ? "▲" : "▼"} ${fmtPct(s.pct)}</span></div>`
          ).join("")}</div>` : "";
        })()}
        <div class="meta">${healthy ? (fx.usdtry ? `Varlık ${fmtUSD0(totalMarket / fx.usdtry)} + Nakit ${fmtUSD0(cashTL / fx.usdtry)}${optMarket ? ` · içinde Opsiyon ${fmtUSD0(optMarket / fx.usdtry)}` : ""}` : `Varlık ${fmtTRY0(totalMarket)} + Nakit ${fmtTRY0(cashTL)}`) : "↻ Veriler yenileniyor · son bilinen değer"}</div>
        ${meta?.summaryText ? `<div class="hero-note"><b class="hn-l">Günün özeti</b>${meta.summaryText}</div>` : ""}
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
        <span class="mc-ic">${svgIcon("activity")}</span>
        <div class="label">Günün Hareketi ${tipIcon("Bugün açılışa göre portföyündeki en çok yükselen ve düşen pozisyon. Tek günlük oynama trend değildir; ama büyük düşüşü olan pozisyonun stop planını kontrol et.")}</div>
        <div class="mv-body">${best ? moverRow(best, "up") : ""}${worst && worst !== best ? moverRow(worst, "down") : ""}</div>
      </div>`;
  }

  // ---- Metrik kartları ----
  // Okunabilirlik dili: köşede sessiz çizgi-ikon, yüzdeler renkli pill (chip) —
  // renk yalnız anlam taşıyan yerde, kart yüzeyi nötr kalır.
  const pctChip = (p) => p != null && isFinite(p) ? `<span class="chip ${cls(p)}">${fmtPct(p)}</span>` : "";
  $("#cardsMetrics").innerHTML = `<div class="sec-label sl-grid">Portföyün Özeti</div>` + `${moverCard}`+ `
      <div class="card">
        <span class="mc-ic">${svgIcon("trendUp")}</span>
        <div class="label">Toplam Getiri ${tipIcon("İpucu: Açık pozisyonların kâğıt üzerindeki kâr/zararı, USD bazında. Maliyetler işlemlerle otomatik senkrondur. Kâğıt kârı gerçek kâr değildir — realize edene kadar piyasanındır.")}</div>
        <div class="value ${healthy ? cls(profit) : ""}">${healthy ? (fx.usdtry ? fmtUSD(profit / fx.usdtry) : fmtTRY(profit)) : "—"}</div>
        <div class="meta">${healthy ? `${pctChip(profitPct)} Maliyet ${fx.usdtry ? fmtUSD0(totalCost / fx.usdtry) : fmtTRY0(totalCost)}` : `Maliyet ${fx.usdtry ? fmtUSD0(totalCost / fx.usdtry) : fmtTRY0(totalCost)}`}</div>
      </div>
      <div class="card">
        <span class="mc-ic">${svgIcon("receipt")}</span>
        <div class="label">Realize Edilen K/Z ${tipIcon("İpucu: Cebe giren/çıkan gerçek sonuç — yalnızca satışlardan, USD bazında hesaplanır. Kural 1'in karnesi budur: bu sayı negatifleşiyorsa sistemde değil disiplinde sorun var demektir.")}</div>
        <div class="value ${cls(realizedUSD)}">${fmtUSD(realizedUSD)}</div>
        <div class="meta">${trades.filter((t) => t.kind !== "buy").length} satış</div>
      </div>
      ${netInvested > 0 ? `
      <div class="card">
        <span class="mc-ic">${svgIcon("scale")}</span>
        <div class="label">Gerçek Getiri ${tipIcon("İpucu: Bugünkü toplam değer − net yatırdığın para, USD bazında. Piyasa kazancını cebinden eklediğin paradan ayırır; portföyün gerçekten büyüyor mu sorusunun tek dürüst cevabı.")}</div>
        <div class="value ${healthy ? cls(realProfit) : ""}">${healthy ? (fx.usdtry ? fmtUSD(realProfit / fx.usdtry) : fmtTRY(realProfit)) : "—"}</div>
        <div class="meta">${realPct != null ? pctChip(realPct) : "—"} Sermaye ${fx.usdtry ? fmtUSD0(netInvested / fx.usdtry) : fmtTRY0(netInvested)}</div>
      </div>` : ""}
      <div class="card">
        <span class="mc-ic">${svgIcon("dollar")}</span>
        <div class="label">USD / TRY</div>
        <div class="value">${fmtNum(fx.usdtry, 4)}</div>
        <div class="meta">EUR/TRY ${fmtNum(fx.eurtry, 4)}</div>
      </div>
      <div class="card">
        <span class="mc-ic">${svgIcon("coins")}</span>
        <div class="label">Gram Altın</div>
        <div class="value">${fmtTRY(fx.gram)}</div>
        <div class="meta">${holdings.filter((h) => h.type === "gold").reduce((s, h) => s + h.quantity, 0)} gram tutuluyor</div>
      </div>`;

  // ---- Varlık dağılımı hover etkileşimi ----
  bindAlloc();

  // ---- Portföy Önerileri + En Büyük 3 Pozisyon + Risk Bütçesi panelleri ----
  renderRule1();
  renderTopPicks();
  renderRiskBudget();

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

  // Sol menü canlı katmanı: selamlama + NYSE durumu + açık swing sayısı
  sbGreeting(); sbMarket();
  setNavMeta("swingdefteri", (STATE.swingPositions || []).length);

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
  updateSidebarPulse(grandTRY, usdtry, dayPct);
  if (document.body.classList.contains("privacy")) applyMask(true);
}

/* ---------------- Sol menü canlı katmanı ---------------- */
/* Nabız kartı: portföy USD'ye endeksli olduğu için büyük değer USD, ₺ referans altta */
function updateSidebarPulse(grandTRY, usdtry, dayPct) {
  const box = $("#sbPulse"); if (!box) return;
  box.hidden = false;
  $("#sbVal").textContent = usdtry ? fmtUSD0(grandTRY / usdtry) : fmtTRY0(grandTRY);
  $("#sbUsd").textContent = usdtry ? "≈ " + fmtTRY0(grandTRY) : "";
  const d = $("#sbDay");
  if (dayPct != null && isFinite(dayPct)) { d.textContent = (dayPct >= 0 ? "▲ " : "▼ ") + "%" + Math.abs(dayPct).toFixed(2) + " bugün"; d.className = "sbp-day " + cls(dayPct); }
  else { d.textContent = ""; d.className = "sbp-day"; }
}

function sbGreeting() {
  const el = $("#sbGreet"); if (!el) return;
  const h = new Date().getHours();
  el.textContent = (h < 6 ? "İyi geceler" : h < 12 ? "Günaydın" : h < 18 ? "İyi günler" : "İyi akşamlar") + ", Kaan";
}

/* NYSE seans durumu — yalnız saat hesabı, veri çekmez (resmî tatiller kapsam dışı) */
function sbMarket() {
  const el = $("#sbMkt"); if (!el) return;
  try {
    const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const day = et.getDay(), mins = et.getHours() * 60 + et.getMinutes();
    const wk = day >= 1 && day <= 5;
    const open = wk && mins >= 570 && mins < 960;          // 09:30–16:00
    const pre = wk && mins >= 240 && mins < 570;           // 04:00–09:30
    const aft = wk && mins >= 960 && mins < 1200;          // 16:00–20:00
    const hhmm = String(et.getHours()).padStart(2, "0") + ":" + String(et.getMinutes()).padStart(2, "0");
    el.hidden = false;
    el.className = "sb-mkt " + (open ? "on" : pre || aft ? "half" : "off");
    el.querySelector(".sbm-t").textContent = (open ? "NYSE açık" : pre ? "Pre-market" : aft ? "After-hours" : "NYSE kapalı") + " · " + hhmm + " ET";
  } catch { el.hidden = true; }
}
setInterval(sbMarket, 60000); // poll'dan bağımsız dakikada bir tazele (saat kayması olmasın)

/* Sekme rozetleri: sağa yaslı sessiz sayaç (ör. açık swing pozisyonu) */
function setNavMeta(view, n) {
  const nav = document.querySelector(`#nav .nav-item[data-view="${view}"]`);
  if (!nav) return;
  nav.querySelector(".nav-meta")?.remove();
  if (!n) return;
  const b = document.createElement("span");
  b.className = "nav-meta"; b.textContent = n;
  nav.appendChild(b);
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
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
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
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
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
  const color = up ? "#1f8a4e" : "#d8442f";
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

