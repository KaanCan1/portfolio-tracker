/* 06-analiz.js — Analiz görünümü · ısı haritası/sektör · Profesyonel Risk Masası · Risk & Performans Karnesi · pozisyon teknikleri
 * app.js'in SIRALI dilimi (bölme: 15 Tem 2026). Dosyalar index.html'deki sırayla yüklenir;
 * klasik script'ler global kapsamı paylaşır — sıra değiştirme, dosyayı IIFE'ye sarma. */
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
  const PALETTE = ["#2f8f57", "#3fa7b8", "#d9a92b", "#8b7fd6", "#cf7a3d", "#5b8def", "#9aa394"];
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
  // TEK KAYNAK: realizedBySym (USD) — yalnız portföy kuruluşundan (8 Haz 2026) itibaren işlem geçmişi.
  const calc = STATE?.realizedBySym || {};
  const list = Object.entries(calc)
    .map(([sym, usd]) => ({ sym, usd: +usd, tl: (+usd) * usdtry }))
    .filter((r) => Math.abs(r.usd) >= 0.005)   // sıfır realize'leri gizle
    .sort((a, b) => b.usd - a.usd);
  if (!list.length) { el.innerHTML = `<div class="radar-empty">Portföy kuruluşundan (8 Haz 2026) bu yana realize edilmiş işlem yok.</div>`; return; }
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
          <span class="rz-sym">${r.sym}</span>
          <span class="rz-amt ${cls(r.tl)}">${r.tl >= 0 ? "+" : ""}${fmtTRY0(r.tl)}${usd(r.tl)}</span>
        </div>`).join("")}
    </div>
    <div class="rz-foot">Portföy kuruluşundan (8 Haz 2026) bu yana · İşlem Geçmişi'ndeki satışlardan hesaplanır.</div>`;
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

  // ---- Panel 5: What-if simülatörü — "şunu yapsam risk nasıl değişir?" ----
  const wiSyms = pos.map((p) => p.symbol);
  const panel5 = `<div class="pr-block">
    <div class="pr-h2">⚖️ What-if Simülatörü <span class="tip" data-tip="Kademeli satış / ekleme planını uygulamadan ÖNCE portföy riskine etkisini gör. Hesap mevcut risk verisinden (volatilite + korelasyon) yaklaşık türetilir; boşalan para nakit sayılır. Tahmindir, garanti değil.">?</span></div>
    <form class="lab-form" id="wiForm">
      <label class="lab-f"><i>Pozisyon</i><select name="sym">${wiSyms.map((s) => `<option>${s}</option>`).join("")}</select></label>
      <label class="lab-f"><i>Eylem</i><select name="act">
        <option value="sell25">%25 sat</option><option value="sell50">%50 sat</option><option value="sell100">Tamamını sat</option>
        <option value="add">$ ekle (yeni para)</option></select></label>
      <label class="lab-f" id="wiAmtWrap" hidden><i>Tutar $</i><input name="amt" type="number" value="500" min="50" step="50"></label>
      <button type="submit" class="btn primary sm">Hesapla</button>
    </form>
    <div id="wiRes"><div class="pr-hint">Senaryoyu seç, <b>Hesapla</b>'ya bas — VaR · volatilite · beta · yoğunlaşma öncesi/sonrası kıyaslanır.</div></div>
  </div>`;

  el.innerHTML = panel1 + panel2 + panel3 + panel4 + panel5;

  // What-if bağları (innerHTML her render'da tazelenir → burada bağlanır)
  const wiForm = $("#wiForm");
  wiForm?.querySelector('[name="act"]').addEventListener("change", (e) => { $("#wiAmtWrap").hidden = e.target.value !== "add"; });
  wiForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(wiForm);
    $("#wiRes").innerHTML = whatIf(R, String(f.get("sym")), String(f.get("act")), +f.get("amt") || 0);
  });
}

/* What-if matematiği — mevcut /api/risk verisinden YAKLAŞIK yeniden hesap:
 * σ_port = √(Σᵢ Σⱼ wᵢwⱼσᵢσⱼρᵢⱼ); nakit σ=0. Korelasyon matriste yoksa ort. korelasyon kullanılır. */
function whatIf(R, sym, act, amt) {
  const pos = R.positions || [], P = R.portfolio, cm = R.correlation || { syms: [], matrix: [] };
  const me = pos.find((p) => p.symbol === sym);
  if (!me) return `<div class="pr-hint">Pozisyon bulunamadı.</div>`;
  const delta = act === "add" ? Math.max(0, amt) : -me.valueUSD * (act === "sell25" ? 0.25 : act === "sell50" ? 0.5 : 1);
  const rho = (a, b) => {
    if (a === b) return 1;
    const i = cm.syms.indexOf(a), j = cm.syms.indexOf(b);
    return i >= 0 && j >= 0 && cm.matrix[i] ? cm.matrix[i][j] : (P.avgCorr ?? 0.5);
  };
  const calc = (vals) => { // vals: {sym → USD değer}; toplam = yatırılan + nakit (satıştan boşalan)
    const totInv = Object.values(vals).reduce((a, b) => a + b, 0);
    const tot = totInv + Math.max(0, -delta); // satılan kısım nakit olarak portföyde kalır
    let varSum = 0, beta = 0, hhi = 0, topW = 0, topS = "";
    for (const a of Object.keys(vals)) {
      const pa = pos.find((p) => p.symbol === a); const wa = vals[a] / tot;
      const va = (pa.volAnnPct ?? 30) / 100;
      beta += wa * (pa.beta ?? 1);
      const wInv = totInv ? vals[a] / totInv : 0; hhi += wInv * wInv;
      if (wa * 100 > topW) { topW = wa * 100; topS = a; }
      for (const b of Object.keys(vals)) {
        const pb = pos.find((p) => p.symbol === b); const wb = vals[b] / tot;
        varSum += wa * wb * va * ((pb.volAnnPct ?? 30) / 100) * rho(a, b);
      }
    }
    const volAnn = Math.sqrt(Math.max(0, varSum));
    return { volAnnPct: volAnn * 100, var95USD: 1.645 * (volAnn / Math.sqrt(252)) * tot, beta, effN: hhi > 0 ? 1 / hhi : 0, topW, topS, tot };
  };
  const before = {}; for (const p of pos) before[p.symbol] = p.valueUSD;
  const after = { ...before };
  after[sym] = Math.max(0, before[sym] + delta);
  if (after[sym] === 0) delete after[sym];
  const A = calc(before), B = calc(after);
  const row = (l, b, a, fmt, smallGood = true) => {
    const chg = a - b; const good = smallGood ? chg < -0.001 : chg > 0.001;
    const c = Math.abs(chg) < 0.005 ? "" : good ? "win-c" : "loss-c";
    return `<tr><td class="l">${l}</td><td>${fmt(b)}</td><td class="${c}"><b>${fmt(a)}</b></td></tr>`;
  };
  const actTxt = act === "add" ? `${sym}'e $${amt} ekle` : `${sym} pozisyonunun ${act === "sell25" ? "%25'ini" : act === "sell50" ? "%50'sini" : "tamamını"} sat`;
  return `<div class="tbl-wrap lab-tbl"><table>
      <thead><tr><th class="l">Metrik</th><th>Şimdi</th><th>Senaryo sonrası</th></tr></thead>
      <tbody>
        ${row("VaR %95 (1 gün)", A.var95USD, B.var95USD, (v) => fmtUSD0(v))}
        ${row("Yıllık volatilite", A.volAnnPct, B.volAnnPct, (v) => `%${v.toFixed(1)}`)}
        ${row("Beta (SPY)", A.beta, B.beta, (v) => v.toFixed(2))}
        ${row("Etkin pozisyon sayısı", A.effN, B.effN, (v) => v.toFixed(1), false)}
        ${row("En ağır pozisyon", A.topW, B.topW, (v) => `%${v.toFixed(0)}`)}
      </tbody></table></div>
    <div class="bm-note">Senaryo: <b>${actTxt}</b> — en ağır pozisyon senaryo sonrası <b>${B.topS || "—"}</b>. ${act !== "add" ? "Boşalan tutar nakit sayıldı (σ=0)." : "Eklenen tutar yeni para varsayıldı."} Yaklaşık hesaptır; korelasyonlar geçmişten gelir, garanti değildir.</div>`;
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

