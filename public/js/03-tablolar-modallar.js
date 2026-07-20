/* 03-tablolar-modallar.js — hisse/fon/swing/opsiyon/altın tabloları · varlık/opsiyon/nakit modalları · toast + onay diyaloğu
 * app.js'in SIRALI dilimi (bölme: 15 Tem 2026). Dosyalar index.html'deki sırayla yüklenir;
 * klasik script'ler global kapsamı paylaşır — sıra değiştirme, dosyayı IIFE'ye sarma. */
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
    // Pozisyon durumu rozeti — uzun vade ile swing FARKLI yönetilir (Kaan'ın kararı):
    //  • Swing: tam iz süren stop disiplini (stop delindi / hedefte / stopa mesafe).
    //  • Uzun vade (≥1 yıl niyetle tutulur, satılmaz): iz süren stop uyarısı YOK. Sadece ufak
    //    "uzun vade" açıklaması; ancak zarar acaip derinleşirse (≤ −25%) "tez gözden geçir" uyarısı.
    const g = h.guard;
    const isSwingHold = h.horizon === "swing" || !!(STATE.swingOpen || {})[String(h.symbol).toUpperCase()];
    let guardChip = "";
    if (h.type === "stock") {
      if (isSwingHold) {
        guardChip = !g ? "" : g.breached
          ? `<span class="gd-chip gd-stop" title="İz süren stop ${fmtUSD(g.stop)} altına indi — çıkış/azaltma planını uygula">🛑 stop delindi</span>`
          : g.targetHit
            ? `<span class="gd-chip gd-tgt" title="Hedef ${fmtUSD(g.target)} aşıldı — kâr-al planını uygula">🎯 hedefte</span>`
            : g.near
              ? `<span class="gd-chip gd-near" title="İz süren stop ${fmtUSD(g.stop)} (3×ATR) — fiyata %${g.distPct.toFixed(1)} mesafe">⚠️ stopa %${g.distPct.toFixed(1)}</span>`
              : g.distPct != null
                ? `<span class="gd-chip gd-ok" title="İz süren stop ${fmtUSD(g.stop)} (3×ATR) — fiyata %${g.distPct.toFixed(1)} mesafe">🛡 %${g.distPct.toFixed(0)}</span>`
                : "";
      } else {
        guardChip = (profitPct != null && profitPct <= -25)
          ? `<span class="gd-chip gd-thesis" title="Pozisyon %${Math.abs(profitPct).toFixed(0)} zararda — hikâye/tez hâlâ geçerli mi gözden geçir. Bozulduysa uzun vadede bile çık; tez sağlamsa panikle satma, bu bir fırsat olabilir.">⚠️ tez gözden geçir · ${profitPct.toFixed(0)}%</span>`
          : `<span class="gd-chip gd-long" title="Uzun vade pozisyonu — iz süren stop uygulanmaz, ≥1 yıl tutulur. Tez bozulmadıkça (veya zarar %25'i aşmadıkça) satış sinyali verilmez.">🌱 uzun vade</span>`;
      }
    }
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

