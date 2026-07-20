/* 02-radar-motoru.js — fırsat radarı analitiği · swing tarayıcı · Cuma Hoca · pozisyon boyutlama · haftalık fırsatlar · grafik modalı + ölçüm aracı
 * app.js'in SIRALI dilimi (bölme: 15 Tem 2026). Dosyalar index.html'deki sırayla yüklenir;
 * klasik script'ler global kapsamı paylaşır — sıra değiştirme, dosyayı IIFE'ye sarma. */
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
    const col = up ? "#2f8f57" : "#d8442f";
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
  const usdtry = STATE?.fx?.usdtry || 0;
  const mvTRY = h.live?.marketValueTRY ?? null;
  const cost = costOf(h);
  const profitTRY = mvTRY != null ? mvTRY - cost : null;
  // USD-native değerler (pozisyon kartı $ gösterir)
  const costUSDtot = h.costUSD != null ? Number(h.costUSD) * Number(h.quantity) : (usdtry ? cost / usdtry : null);
  const mvUSD = h.live?.marketValueUSD ?? (usdtry && mvTRY != null ? mvTRY / usdtry : null);
  const profitUSD = mvUSD != null && costUSDtot != null ? mvUSD - costUSDtot : null;
  openChartModal(h.symbol, {
    qty: h.quantity,
    costUSD: h.costUSD != null ? Number(h.costUSD) : null,
    mvUSD, profitUSD,
    profitPct: costUSDtot && profitUSD != null ? (profitUSD / costUSDtot) * 100 : (cost && profitTRY != null ? (profitTRY / cost) * 100 : null),
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
  let qty = 0, costUSDw = 0, mvUSD = 0, hasMv = false, guard = null;
  let horizon = ctx?.horizon, earnings = ctx?.earnings || null;
  if (h) {
    const q = Number(h.quantity) || 0;
    qty += q;
    const cUSD = h.costUSD != null ? Number(h.costUSD) * q : (fx ? (costOf(h) || 0) / fx : 0);
    costUSDw += cUSD;
    const mvU = h.live?.marketValueUSD ?? (fx && h.live?.marketValueTRY != null ? h.live.marketValueTRY / fx : null);
    if (mvU != null) { mvUSD += mvU; hasMv = true; }
    guard = h.guard || guard;
    horizon = horizon || (h.horizon === "swing" ? "swing" : "long");
    earnings = earnings || h.earnings || null;
  }
  for (const p of sws) {
    const q = Number(p.qty) || 0;
    qty += q; costUSDw += (Number(p.entry) || 0) * q;
    if (p.valueUSD != null) { mvUSD += p.valueUSD; hasMv = true; }
    if (!guard && p.guard) guard = { stop: p.guard.stop, distPct: p.guard.distPct, breached: p.guard.breached, target: p.target ?? null, targetHit: p.guard.targetHit };
    horizon = horizon || "swing";
  }
  const profitUSD = hasMv ? mvUSD - costUSDw : null;
  return {
    qty, costUSD: qty > 0 ? costUSDw / qty : null,
    mvUSD: hasMv ? mvUSD : null, profitUSD,
    profitPct: costUSDw > 0 && profitUSD != null ? (profitUSD / costUSDw) * 100 : null,
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
    // open-design: sıcak kağıt ailesiyle hizalı grafik yüzeyi — ılık ızgara/metin
    layout: { background: { color: "#ffffff" }, textColor: "#4a4f45", fontFamily: "inherit" },
    grid: { vertLines: { color: "#f1efe9" }, horzLines: { color: "#f1efe9" } },
    rightPriceScale: { borderColor: "#e5e2d9" },
    timeScale: { borderColor: "#e5e2d9", timeVisible: false },
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
    const cloudCol = bull ? "rgba(16,185,129,.16)" : "rgba(216,68,47,.14)";
    const lo = [], hi = [];
    for (const p of d.ema8) { const v21 = tmap21.get(p.time); if (v21 == null) continue; lo.push({ time: p.time, value: Math.min(p.value, v21) }); hi.push({ time: p.time, value: Math.max(p.value, v21) }); }
    // hi: bulut rengiyle scale-altına kadar dolu · lo: arka plan rengiyle üstünü kapatır → sadece 8↔21 arası renkli kalır
    chart.addAreaSeries({ lineWidth: 0, topColor: cloudCol, bottomColor: cloudCol, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }).setData(hi);
    chart.addAreaSeries({ lineWidth: 0, topColor: "#ffffff", bottomColor: "#ffffff", priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }).setData(lo);
    emaCloud = { bull };
  }

  const candle = chart.addCandlestickSeries({
    upColor: "#2f8f57", downColor: "#d8442f", borderVisible: false,
    wickUpColor: "#2f8f57", wickDownColor: "#d8442f",
  });
  candle.setData(d.candles);
  cmCandle = candle; cmCandles = d.candles; resetMeasure(); // ölçüm aracı için referanslar
  initDrawings(chartEl, chart, candle, d.candles, sym);      // kalıcı trend/yatay çizim katmanı
  // MA paleti — sakin veri tonları (aksan değil): SMA'lar ince/soluk, EMA'lar işlevsel vurgulu
  if (d.sma20?.length) chart.addLineSeries({ color: "#7fa8c9", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(d.sma20);
  if (d.sma50?.length) chart.addLineSeries({ color: "#cfa143", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(d.sma50);
  if (d.sma200?.length) chart.addLineSeries({ color: "#9a8fd8", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(d.sma200);
  // EMA çizgileri EN ÜSTTE (bulutun ve mumların üstünde)
  if (d.ema21?.length) chart.addLineSeries({ color: "#e0940f", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }).setData(d.ema21);
  if (d.ema8?.length) chart.addLineSeries({ color: "#0f9d8f", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }).setData(d.ema8);

  // Hacim histogramı (alt %18'lik bantta)
  const volData = d.candles.filter((c) => c.volume != null).map((c) => ({
    time: c.time, value: c.volume,
    color: c.close >= c.open ? "rgba(47,143,87,.35)" : "rgba(216,68,47,.32)",
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
  if (d.stats?.w52High != null) line(d.stats.w52High, "#d8442f", DS.Dashed, "52h Zirve", 1);
  if (d.stats?.w52Low != null) line(d.stats.w52Low, "#5a8fb0", DS.Dashed, "52h Dip", 1);
  // ── SWING (Qullamaggie) — tek giriş otoritesi: pivot kırılımı + stop + R hedef
  if (d.qm?.ok && d.qm.setup !== "none") {
    line(d.qm.entryTrigger, "#0a8f6e", DS.Solid, "Swing Giriş", 2);
    line(d.qm.stop, "#ab272c", DS.Dashed, "Swing Stop", 2);
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
  if (pos?.costUSD != null && isFinite(pos.costUSD)) line(pos.costUSD, "#8b7fd6", DS.Solid, "Maliyet", 1);
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
    const col = pt === "bull" ? "#1f7a48" : pt === "bear" ? "#d8442f" : "#8b7fd6";
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
      ${row("Değer", pos.mvUSD != null ? fmtUSD(pos.mvUSD) : "—")}
      ${row("K/Z", pos.profitUSD != null ? `${fmtUSD(pos.profitUSD)} <span class="muted">${fmtPct(pos.profitPct)}</span>` : "—", pos.profitUSD != null ? cls(pos.profitUSD) : "")}
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
    <span class="lg"><i style="background:#ab272c"></i> Swing Stop</span>
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
    <span class="lg"><i style="background:#8b7fd6"></i> Maliyet</span>`;
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

