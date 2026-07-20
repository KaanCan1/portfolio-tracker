/* 08-swing-defteri.js — Swing Defteri · karar kalitesi karnesi · günlük işlem analizi · swing modalları · QM giriş kapısı
 * app.js'in SIRALI dilimi (bölme: 15 Tem 2026). Dosyalar index.html'deki sırayla yüklenir;
 * klasik script'ler global kapsamı paylaşır — sıra değiştirme, dosyayı IIFE'ye sarma. */
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
  loadWeeklyPlan();   // Hafta Sonu Rutini paneli (sekme tepesi) — hafif KV okuması
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

/* ===== Karar Kalitesi karnesi — tez/güven/setup girişi + kapanış plana-uyum self-tag'i.
 * Şans vs beceri 2×2 matrisi, güven kalibrasyonu, setup kırılımı, en sık itiraf.
 * Yalnız kapanmış + alanı dolu işlemlerden; boş alanlı eski işlemler karneyi çarpıtmaz. */
const DJ_MISTAKE = { "early-fear": "korkuyla erken sattım", "moved-stop": "stopu kaydırdım", "no-confirm": "teyitsiz girdim", "target-close": "hedef fazla yakındı", "fomo": "FOMO ile girdim", "oversize": "fazla büyük girdim" };
const DJ_SETUP = { breakout: "Kırılım", ep: "EP", pullback: "Geri-çekilme" };
const DJ_CONF = { A: "A · güçlü", B: "B · orta", C: "C · zayıf" };

function decisionRecs(closed) {
  return closed.map((t) => {
    const m = swEnrich(t);
    const lots = t.realizedLots || [];
    const lotSum = lots.reduce((a, l) => a + (l.pnlUSD || 0), 0);
    const realized = (m.pnl || 0) + lotSum;                       // toplam net $ (kapanış + kısmi)
    const origQty = (t.qty || 0) + lots.reduce((a, l) => a + (l.shares || 0), 0);
    const riskPS = t.stop != null ? t.entry - t.stop : null;
    const rMul = riskPS && riskPS > 0 && origQty > 0 ? realized / (riskPS * origQty) : null;
    return { sym: t.symbol, realized, rMul, win: realized > 0, conf: t.conf || null, setupKind: t.setupKind || null, planFollow: t.planFollow || null, mistakeTag: t.mistakeTag || null, planned: t.planned === true ? true : t.planned === false ? false : null };
  });
}

function decisionScorecardPanel(closed) {
  const recs = decisionRecs(closed);
  const journaled = recs.filter((r) => r.planFollow || r.conf || r.setupKind);
  if (!journaled.length) {
    return closed.length ? `<section class="panel dj-panel dj-empty"><div class="panel-head"><div><h2>🧭 Karar Kalitesi</h2></div></div>
      <p class="dj-empty-note">Karar defterini doldurmaya başla: yeni swing açarken <b>tez · güven · setup</b> gir, kapatırken <b>“plana uydun mu?”</b> yanıtla. Zamanla <b>şans mı beceri mi</b> ayrışır — Kural 1'in gerçek ölçüsü budur.</p></section>` : "";
  }
  // ── 2×2 şans/beceri matrisi (planFollow gerekir) ──
  const pf = journaled.filter((r) => r.planFollow);
  const q = { skill: 0, lucky: 0, right: 0, mistake: 0 };
  pf.forEach((r) => {
    const followed = r.planFollow === "yes";
    if (r.win && followed) q.skill++; else if (r.win && !followed) q.lucky++;
    else if (!r.win && followed) q.right++; else q.mistake++;
  });
  const followPct = pf.length ? (pf.filter((r) => r.planFollow === "yes").length / pf.length) * 100 : null;
  const mistakes = {};
  pf.filter((r) => r.planFollow !== "yes" && r.mistakeTag).forEach((r) => { mistakes[r.mistakeTag] = (mistakes[r.mistakeTag] || 0) + 1; });
  const mistakeList = Object.entries(mistakes).sort((a, b) => b[1] - a[1]);
  // ── güven kalibrasyonu & setup kırılımı ──
  const agg = (arr) => { const rv = arr.map((r) => r.rMul).filter((v) => v != null && isFinite(v)); return { n: arr.length, wr: arr.length ? (arr.filter((r) => r.win).length / arr.length) * 100 : null, avgR: rv.length ? rv.reduce((a, v) => a + v, 0) / rv.length : null }; };
  const byConf = ["A", "B", "C"].map((c) => ({ k: c, lbl: DJ_CONF[c], ...agg(journaled.filter((r) => r.conf === c)) })).filter((x) => x.n);
  const bySetup = ["breakout", "ep", "pullback"].map((k) => ({ k, lbl: DJ_SETUP[k], ...agg(journaled.filter((r) => r.setupKind === k)) })).filter((x) => x.n);

  const cell = (n, lbl, sub, tone) => `<div class="dj-cell ${tone}"><b>${n}</b><span class="dj-cell-l">${lbl}</span><span class="dj-cell-s">${sub}</span></div>`;
  const matrix = pf.length ? `<div class="dj-matrix">
      ${cell(q.skill, "Beceri", "kazandın · uydun", "skill")}
      ${cell(q.lucky, "Şanslı", "kazandın · uymadın", "lucky")}
      ${cell(q.right, "Doğru karar", "kaybettin · uydun", "right")}
      ${cell(q.mistake, "Hata", "kaybettin · uymadın", "mistake")}
    </div>` : "";
  let insight = "";
  if (pf.length) {
    if (q.lucky > q.skill && q.lucky > 0) insight = `⚠️ Kazançlarının çoğu (<b>${q.lucky}</b>) plana <b>uymadan</b> geldi — bu şans, tekrarlanmaz. Süreç kazançlarını (${q.skill}) büyüt.`;
    else if (q.skill + q.right > 0) insight = `✓ İşlemlerinin çoğu <b>süreç odaklı</b>: ${q.skill} beceri kazancı + ${q.right} disiplinli kayıp (doğru karar, kötü sonuç — hata değil). Bunu koru.`;
  }
  const confA = byConf.find((x) => x.k === "A"), confC = byConf.find((x) => x.k === "C");
  let calNote = "";
  if (confA && confC && confA.avgR != null && confC.avgR != null && confA.avgR < confC.avgR - 0.15)
    calNote = `⚠️ Güven kalibrasyonun <b>ters</b>: A'da (${confA.avgR.toFixed(2)}R) C'den (${confC.avgR.toFixed(2)}R) kötüsün — en emin olduğunda yanılıyorsun. "Güçlü" hissini sorgula.`;
  else if (confA && confA.avgR != null && confA.avgR >= 0.3) calNote = `✓ A-güven işlemlerin gerçekten iyi (${confA.avgR >= 0 ? "+" : ""}${confA.avgR.toFixed(2)}R) — güvenin kalibre. Büyük pozisyonu A'lara ayır.`;
  const bestSetup = bySetup.filter((x) => x.avgR != null).sort((a, b) => b.avgR - a.avgR)[0];

  const rtable = (rows, head) => `<div class="dj-tbl"><div class="dj-tbl-h">${head}</div>
    <table class="dj-table"><thead><tr><th class="l">${rows.axis}</th><th>İşlem</th><th>İsabet</th><th>Ort. R</th></tr></thead><tbody>
    ${rows.data.map((x) => `<tr><td class="l">${x.lbl}</td><td>${x.n}</td><td class="${x.wr != null && x.wr >= 50 ? "pos" : ""}">${x.wr != null ? Math.round(x.wr) + "%" : "—"}</td><td class="${x.avgR == null ? "" : x.avgR >= 0 ? "pos" : "neg"}">${x.avgR != null ? (x.avgR >= 0 ? "+" : "") + x.avgR.toFixed(2) + "R" : "—"}</td></tr>`).join("")}
    </tbody></table></div>`;

  const small = journaled.length < 5;
  return `<section class="panel dj-panel">
    <div class="panel-head"><div><h2>🧭 Karar Kalitesi <span class="sw-chip">${journaled.length} kayıt</span></h2>
      <span class="chart-sub">Şans mı beceri mi — tezine, güvenine ve plana uyumuna göre kendi kararların</span></div></div>
    ${small ? `<div class="dj-small">İlk sinyaller — sağlıklı okuma için ~5+ etiketli kapanış gerek. Yine de biriktikçe netleşir.</div>` : ""}
    ${matrix ? `<div class="dj-block"><div class="dj-block-h">Şans / Beceri matrisi <span class="sw-muted">${pf.length} tam kapanış</span></div>
      ${matrix}${insight ? `<div class="dj-insight">${insight}</div>` : ""}
      ${followPct != null ? `<div class="dj-follow">Plana uyum: <b class="${followPct >= 70 ? "pos" : followPct >= 40 ? "" : "neg"}">${Math.round(followPct)}%</b> <span class="sw-muted">(${pf.filter((r) => r.planFollow === "yes").length}/${pf.length} işlemde "Evet")</span></div>` : ""}
      ${(() => { // Hafta Sonu Rutini disiplini: haftalık planı olan haftalarda açılan işlemler
        const pl = recs.filter((r) => r.planned != null);
        if (!pl.length) return "";
        const inP = pl.filter((r) => r.planned), outP = pl.filter((r) => !r.planned);
        const wr = (a) => a.length ? Math.round(a.filter((r) => r.win).length / a.length * 100) : null;
        const cmp = inP.length >= 2 && outP.length >= 2 ? ` · isabet planlıda %${wr(inP)} vs plan dışında %${wr(outP)}` : "";
        return `<div class="dj-follow">Plan disiplini: <b class="${outP.length === 0 ? "pos" : outP.length > inP.length ? "neg" : ""}">${inP.length}/${pl.length}</b> <span class="sw-muted">işlem haftalık plandan geldi${cmp}</span></div>`;
      })()}
      ${mistakeList.length ? `<div class="dj-mistakes"><span class="dj-mist-l">En sık itiraf:</span> ${mistakeList.map(([k, n]) => `<span class="dj-mist"><b>${n}×</b> ${DJ_MISTAKE[k] || k}</span>`).join("")}</div>` : ""}
    </div>` : ""}
    ${(byConf.length || bySetup.length) ? `<div class="dj-tbls">
      ${byConf.length ? rtable({ axis: "Güven", data: byConf }, "Güven kalibrasyonu") : ""}
      ${bySetup.length ? rtable({ axis: "Setup", data: bySetup }, "Setup kırılımı") : ""}
    </div>` : ""}
    ${calNote ? `<div class="dj-note ${calNote.startsWith("⚠") ? "warn" : "ok"}">${calNote}</div>` : ""}
    ${bestSetup && bySetup.length > 1 ? `<div class="dj-note ok">🎯 En iyi setup'ın <b>${bestSetup.lbl}</b> (${bestSetup.avgR >= 0 ? "+" : ""}${bestSetup.avgR.toFixed(2)}R) — sermayeni buraya yoğunlaştır, zayıf setup'ları ele.</div>` : ""}
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
            ${t.planWeek ? (t.planned ? `<span class="wkp-chip in" title="Açıldığı haftanın planında vardı (${t.planWeek})">📋 planlı</span>` : `<span class="wkp-chip out" title="Açıldığı haftanın planında yoktu (${t.planWeek})">plan dışı</span>`) : ""}
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

  el.innerHTML = hero + swRegimeLine() + chart + swAnalyticsPanel(trades) + swingStatsPanel(closed) + decisionScorecardPanel(closed) + `<section id="planGapBox"></section>` + openPanel + closedPanel;
  renderPlanGap();
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
      <div class="ch-why"><ul class="ch-ev">${a.findings.map((f) => `<li class="da-${f.tone}">${f.txt}</li>`).join("") || "<li>Veri yetersiz — mum geçmişi alınamadı.</li>"}</ul></div>
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
/* ---- Karar defteri pil grupları: tek seçim → gizli input'a yaz ---- */
function setPillGroup(groupId, hiddenInput, dataKey, value) {
  const g = document.getElementById(groupId); if (!g) return;
  g.querySelectorAll(".pill-opt").forEach((x) => x.classList.toggle("on", (x.dataset[dataKey] || "") === (value || "\0")));
  if (hiddenInput) hiddenInput.value = value || "";
}
function bindPillGroup(groupId, hiddenInput, dataKey, onPick) {
  const g = document.getElementById(groupId); if (!g || g._bound) return; g._bound = true;
  g.addEventListener("click", (e) => {
    const b = e.target.closest(".pill-opt"); if (!b) return;
    const already = b.classList.contains("on"), val = already ? "" : (b.dataset[dataKey] || "");
    g.querySelectorAll(".pill-opt").forEach((x) => x.classList.remove("on"));
    if (val) b.classList.add("on");
    if (hiddenInput) hiddenInput.value = val;
    onPick && onPick(val);
  });
}
bindPillGroup("swConf", swingForm.conf, "conf");
bindPillGroup("swSetup", swingForm.setupKind, "setup");

function openSwingModal(id, prefill) {
  swingForm.reset();
  swingForm.id.value = "";
  $("#swRiskPct").value = SWINGDECK.goal?.riskPct || 1;
  $("#swAvail").textContent = "";
  swSelectedHolding = null;
  swPopulatePicker();
  setSwCostMode("unit");
  setPillGroup("swConf", swingForm.conf, "conf", null);
  setPillGroup("swSetup", swingForm.setupKind, "setup", null);
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
    swingForm.thesis.value = t.thesis || "";
    setPillGroup("swConf", swingForm.conf, "conf", t.conf || null);
    setPillGroup("swSetup", swingForm.setupKind, "setup", t.setupKind || null);
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
    thesis: fd.thesis || "", conf: fd.conf || null, setupKind: fd.setupKind || null,
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
  // Karar defteri: plana-uyum bloğunu sıfırla (görünürlük swSellHint'te tam kapanışa göre)
  setPillGroup("swFollow", swingCloseForm.planFollow, "follow", null);
  setPillGroup("swMistakeTags", swingCloseForm.mistakeTag, "mtag", null);
  $("#swMistake").hidden = true;
  swSellHint();
  swingCloseBg.hidden = false;
  setTimeout(() => swingCloseForm.shares.focus(), 50);
}
bindPillGroup("swFollow", swingCloseForm.planFollow, "follow", (v) => {
  const m = $("#swMistake"); if (m) m.hidden = !(v === "partial" || v === "no");
  if (v === "yes" || v === "") setPillGroup("swMistakeTags", swingCloseForm.mistakeTag, "mtag", null);
});
bindPillGroup("swMistakeTags", swingCloseForm.mistakeTag, "mtag");
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
  // Tam kapanışta (kalan ≈ 0) plana-uyum sorusunu göster — kısmi ana-para çekmede sorma
  const pf = $("#swPlanFollow");
  if (pf) pf.hidden = !(sh > 0 && remain <= 1e-6);
}
["input", "change"].forEach((ev) => swingCloseForm?.addEventListener(ev, swSellHint));
$("#swingCloseCancelBtn")?.addEventListener("click", () => (swingCloseBg.hidden = true));
swingCloseBg?.addEventListener("click", (e) => { if (e.target === swingCloseBg) swingCloseBg.hidden = true; });
swingCloseForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(swingCloseForm).entries());
  const r = await fetch(`/api/swing-trades/${fd.id}/sell`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shares: fd.shares, exitPrice: fd.exitPrice, date: fd.closedAt, planFollow: fd.planFollow || null, mistakeTag: fd.mistakeTag || null }),
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


/* ====================== Hafta Sonu Rutini — haftalık plan + sihirbaz ======================
 * Plan sunucuda ISO hafta anahtarıyla durur (/api/weekly-plan). Sihirbaz 3 adım:
 * Rejim (nabız + haftalık not) → Adaylar (fırsat radarından seç / elle ekle) →
 * Seviyeler (giriş/stop/adet — boyut önerisi risk sermayesinden). Kaydedilen plan
 * Swing sekmesinin tepesinde yaşar; hafta içinde açılan swing sembol plandaysa
 * sunucu "planlı" işareti düşer → Karar Defteri plana-uyumu kayıtla ölçer. */
let WKP = { data: null, sent: null, opps: null, step: 1, sel: new Map(), watch: new Set(), noteTxt: "", saving: false };

async function loadWeeklyPlan() {
  try { WKP.data = await (await fetch("/api/weekly-plan")).json(); } catch { WKP.data = null; }
  renderWeeklyPlanBox();
}

function renderWeeklyPlanBox() {
  const el = $("#weeklyPlanBox");
  if (!el) return;
  const d = WKP.data;
  if (!d || d.error) { el.innerHTML = ""; return; }
  const p = d.plan;
  const rb = (typeof RBUD !== "undefined" && RBUD.d && RBUD.d.budget > 0) ? RBUD.d : null;
  const rbChip = rb && (rb.level === "full" || rb.level === "warn")
    ? `<span class="wkp-rb ${rb.level}">${rb.level === "full" ? "🧯 risk bütçesi dolu" : `⚠ bütçe %${Math.round(rb.ratio)}`}</span>` : "";
  if (!p || !((p.candidates || []).length || (p.watch || []).length)) {
    el.innerHTML = `<section class="panel wkp-panel">
      <div class="panel-head"><div><h2>🧭 Haftalık Plan <span class="sw-chip">${d.yw}</span> ${rbChip}</h2>
        <span class="chart-sub">Hafta sonu rutini: rejim → adaylar → seviyeler · plan yazılır, hafta planla oynanır</span></div>
        <button class="btn primary sm" id="wkndStartBtn">🧭 Rutini Başlat</button></div>
      <p class="wkp-none">Bu hafta için plan yok. Pazar akşamı 10 dakika yeter — plan dışı işlem Karar Defteri'nde itiraf ister.</p>
    </section>`;
  } else {
    const rows = (p.candidates || []).map((c) => `<tr>
      <td class="l"><b>${c.sym}</b></td><td class="l">${c.setup || "—"}</td>
      <td>${c.entry != null ? fmtUSD(c.entry) : "—"}</td><td>${c.stop != null ? fmtUSD(c.stop) : "—"}</td>
      <td>${c.qty != null ? fmtNum(c.qty, 2) : "—"}</td><td class="l wkp-cnote">${c.note || ""}</td></tr>`).join("");
    el.innerHTML = `<section class="panel wkp-panel">
      <div class="panel-head"><div><h2>🧭 Haftalık Plan <span class="sw-chip">${d.yw}</span> ${rbChip}</h2>
        <span class="chart-sub">${p.regime?.band ? `Rejim: <b>${p.regime.band}</b>${p.regime.vix != null ? ` · VIX ${fmtNum(p.regime.vix, 1)}` : ""} · ` : ""}${(p.candidates || []).length} aday${(p.watch || []).length ? ` · izleme: ${p.watch.join(", ")}` : ""}</span></div>
        <button class="btn ghost sm" id="wkndStartBtn">Düzenle</button></div>
      ${rows ? `<div class="tbl-wrap wkp-tblwrap"><table class="wkp-table"><thead><tr><th class="l">Sembol</th><th class="l">Setup</th><th>Giriş</th><th>Stop</th><th>Adet</th><th class="l">Not</th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}
      ${p.note ? `<div class="wkp-plannote">“${p.note}”</div>` : ""}
    </section>`;
  }
  const btn = $("#wkndStartBtn");
  if (btn) btn.onclick = openWknd;
}

/* ---- sihirbaz ---- */
const wkndBg = $("#wkndBg");
function wkndPaintSteps() {
  const names = ["Rejim", "Adaylar", "Seviyeler"];
  $("#wkndSteps").innerHTML = names.map((n, i) =>
    `<span class="wknd-step${WKP.step === i + 1 ? " on" : ""}${WKP.step > i + 1 ? " done" : ""}">${i + 1}. ${n}</span>`).join(`<i class="wknd-sep">→</i>`);
  $("#wkndPrevBtn").hidden = WKP.step === 1;
  $("#wkndNextBtn").textContent = WKP.step === 3 ? "Planı Kaydet ✓" : "İleri →";
}
async function openWknd() {
  WKP.step = 1;
  WKP.sel = new Map();
  const p = WKP.data?.plan;
  if (p) for (const c of (p.candidates || [])) WKP.sel.set(c.sym, { ...c });
  WKP.watch = new Set(p?.watch || []);
  WKP.noteTxt = p?.note || "";
  $("#wkndYw").textContent = WKP.data?.yw || "";
  wkndBg.hidden = false;
  wkndPaintSteps();
  $("#wkndBody").innerHTML = `<div class="loading"><span class="spin">↻</span> rejim ve fırsatlar okunuyor…</div>`;
  const [sent, opps] = await Promise.all([
    fetch("/api/sentiment").then((r) => r.json()).catch(() => null),
    fetch("/api/opportunities").then((r) => r.json()).catch(() => null),
  ]);
  WKP.sent = sent; WKP.opps = opps;
  wkndPaint();
}
function wkndPaint() {
  wkndPaintSteps();
  const body = $("#wkndBody");
  if (WKP.step === 1) {
    const rg = WKP.sent?.regime, fng = WKP.sent?.fearGreed;
    const rb = (typeof RBUD !== "undefined" && RBUD.d && RBUD.d.budget > 0) ? RBUD.d : null;
    body.innerHTML = `
      <div class="wknd-regime">
        ${rg ? `<div class="wknd-rg"><span class="wknd-rg-l">Piyasa rejimi</span><b>${rg.band || "—"}</b><span class="wknd-rg-s">VIX ${fmtNum(rg.vix, 1)}${rg.note ? ` · ${rg.note}` : ""}</span></div>` : `<div class="wknd-rg"><span class="wknd-rg-l">Piyasa rejimi</span><span class="sw-muted">veri yok</span></div>`}
        ${fng ? `<div class="wknd-rg"><span class="wknd-rg-l">Aç Gözlülük</span><b>${fng.score ?? "—"}/100</b><span class="wknd-rg-s">${fng.band || ""}</span></div>` : ""}
        ${rb ? `<div class="wknd-rg"><span class="wknd-rg-l">Risk bütçesi</span><b class="${rb.level === "full" ? "neg" : rb.level === "warn" ? "" : "pos"}">%${Math.round(rb.ratio)} dolu</b><span class="wknd-rg-s">${fmtUSD0(rb.left)} pay kaldı</span></div>` : ""}
      </div>
      <p class="wknd-hint">${rb && rb.level === "full" ? "🧯 Bütçe dolu — bu hafta plan <b>küçük</b> olsun ya da yalnız izleme yaz." : "Rejim sertse (VIX yüksek / bütçe dolmaya yakın) haftayı küçük planla — Kural 1."}</p>
      <label class="wknd-notelbl">Haftanın notu <i>(niyetin, tek cümle)</i>
        <textarea id="wkndNote" rows="2" maxlength="400" placeholder="ör. Yalnız A-kalite breakout; kazanç sezonu — bilanço günü pozisyon yok">${WKP.noteTxt}</textarea>
      </label>`;
  } else if (WKP.step === 2) {
    const items = WKP.opps?.items || [];
    const opp = items.map((o) => {
      const on = WKP.sel.has(o.symbol);
      const setup = o.setup?.type || null;
      return `<label class="wknd-opp${on ? " on" : ""}">
        <input type="checkbox" data-wsym="${o.symbol}" ${on ? "checked" : ""} />
        <b>${o.symbol}</b><span class="wknd-opp-score">${o.score}</span>
        <span class="wknd-opp-meta">${setup || "—"}${o.rr != null ? ` · R/Ö ${fmtNum(o.rr, 1)}` : ""}${o.entry != null ? ` · giriş ~${fmtUSD(o.entry)}` : ""}</span>
        ${o.owned ? `<span class="wkp-chip in">portföyde</span>` : ""}${o.watched ? `<span class="wkp-chip">izlemede</span>` : ""}
      </label>`;
    }).join("");
    body.innerHTML = `
      ${items.length ? `<div class="wknd-hint">Fırsat radarının bu haftaki sıralaması — en fazla <b>5 aday</b> seç (odak, çeşit değil).</div><div class="wknd-opps">${opp}</div>`
        : `<div class="wknd-hint">Fırsat verisi şu an yok — adayları elle yaz.</div>`}
      <label class="wknd-notelbl">Elle aday ekle <i>(virgülle: NVDA, AMD)</i>
        <input type="text" id="wkndManual" placeholder="sembol, sembol…" /></label>
      <label class="wknd-notelbl">Yalnız izleme listesi <i>(girmeyeceğin ama bakacağın)</i>
        <input type="text" id="wkndWatch" value="${[...WKP.watch].join(", ")}" placeholder="sembol, sembol…" /></label>`;
  } else {
    const goal = SWINGDECK.goal || {};
    const riskCap = Number(goal.capital) > 0 && Number(goal.riskPct) > 0 ? goal.capital * goal.riskPct / 100 : null;
    const rows = [...WKP.sel.values()].map((c) => {
      const sizeHint = riskCap && c.entry > 0 && c.stop > 0 && c.entry > c.stop
        ? Math.floor(riskCap / (c.entry - c.stop)) : null;
      return `<div class="wknd-lvl" data-wrow="${c.sym}">
        <b class="wknd-lvl-sym">${c.sym}</b>
        <label>Giriş <input type="number" step="any" data-wf="entry" value="${c.entry ?? ""}" placeholder="$" /></label>
        <label>Stop <input type="number" step="any" data-wf="stop" value="${c.stop ?? ""}" placeholder="$" /></label>
        <label>Adet <input type="number" step="any" data-wf="qty" value="${c.qty ?? ""}" placeholder="${sizeHint ?? ""}" /></label>
        <label class="wknd-lvl-note">Not <input type="text" maxlength="140" data-wf="note" value="${(c.note || "").replace(/"/g, "&quot;")}" placeholder="tetik/koşul" /></label>
        ${sizeHint ? `<span class="wknd-size" title="Risk sermayesi ${fmtUSD0(goal.capital)} × %${goal.riskPct} = işlem başı ${fmtUSD0(riskCap)} risk">öneri ≈ ${sizeHint} adet</span>` : ""}
      </div>`;
    }).join("");
    body.innerHTML = rows
      ? `<div class="wknd-hint">Her adaya <b>giriş + stop</b> yaz — stopsuz aday plana giremez sayılır. Adet boşsa öneriyi kullan.</div><div class="wknd-lvls">${rows}</div>`
      : `<div class="wknd-hint">Aday seçmedin — yalnız izleme listesiyle de kaydedebilirsin.</div>`;
  }
}
function wkndCollect() {
  // adım 2/3 girdilerini WKP'ye işle (adım değişmeden önce çağrılır)
  if (WKP.step === 1) {
    WKP.noteTxt = $("#wkndNote")?.value || WKP.noteTxt;
  } else if (WKP.step === 2) {
    document.querySelectorAll("#wkndBody [data-wsym]").forEach((cb) => {
      const sym = cb.dataset.wsym;
      if (cb.checked && !WKP.sel.has(sym)) {
        const o = (WKP.opps?.items || []).find((x) => x.symbol === sym);
        WKP.sel.set(sym, { sym, setup: o?.setup?.type || null, entry: o?.entry ?? null, stop: o?.stop ?? null, qty: null, note: "" });
      }
      if (!cb.checked) WKP.sel.delete(sym);
    });
    for (const s of ($("#wkndManual")?.value || "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean))
      if (!WKP.sel.has(s) && WKP.sel.size < 10) WKP.sel.set(s, { sym: s, setup: null, entry: null, stop: null, qty: null, note: "" });
    WKP.watch = new Set(($("#wkndWatch")?.value || "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean).slice(0, 15));
  } else {
    document.querySelectorAll("#wkndBody [data-wrow]").forEach((row) => {
      const c = WKP.sel.get(row.dataset.wrow);
      if (!c) return;
      row.querySelectorAll("[data-wf]").forEach((inp) => {
        const v = inp.value.trim();
        c[inp.dataset.wf] = inp.dataset.wf === "note" ? v : (v === "" ? null : Number(v));
      });
    });
  }
}
async function wkndSave() {
  if (WKP.saving) return;
  WKP.saving = true;
  $("#wkndNextBtn").disabled = true;
  try {
    const body = {
      candidates: [...WKP.sel.values()],
      watch: [...WKP.watch],
      note: WKP.noteTxt,
      regime: WKP.sent?.regime ? { band: WKP.sent.regime.band, vix: WKP.sent.regime.vix, fng: WKP.sent?.fearGreed?.score ?? null } : null,
    };
    const r = await fetch("/api/weekly-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "plan kaydedilemedi");
    WKP.data = { ...(WKP.data || {}), yw: j.yw, plan: j.plan };
    wkndBg.hidden = true;
    toast("Haftalık plan kaydedildi — Pazar akşamı brifingi cebe gelir");
    renderWeeklyPlanBox();
    loadFeed?.();
  } catch (e) { toast(e.message || "plan kaydedilemedi", "err"); }
  WKP.saving = false;
  $("#wkndNextBtn").disabled = false;
}
$("#wkndCancelBtn")?.addEventListener("click", () => (wkndBg.hidden = true));
wkndBg?.addEventListener("click", (e) => { if (e.target === wkndBg) wkndBg.hidden = true; });
$("#wkndPrevBtn")?.addEventListener("click", () => { wkndCollect(); WKP.step = Math.max(1, WKP.step - 1); wkndPaint(); });
$("#wkndNextBtn")?.addEventListener("click", () => {
  wkndCollect();
  if (WKP.step < 3) { WKP.step++; wkndPaint(); return; }
  wkndSave();
});
// adım 2'de tık → kart vurgusu canlı kalsın
$("#wkndBody")?.addEventListener("change", (e) => {
  const cb = e.target.closest("[data-wsym]");
  if (cb) cb.closest(".wknd-opp")?.classList.toggle("on", cb.checked);
});

/* ====================== "Masada bıraktığın para" — plana-uyum karşı-olgusu ======================
 * Karar Defteri "plana uydun mu?" diye SORAR; bu panel cevabı DOLARA çevirir: stop/hedefine
 * harfiyen uysaydın K/Z ne olurdu vs. gerçekte ne oldu. Sunucu mum verisiyle hesaplar
 * (/api/plan-gap); burada yalnız gösterim var. Suçlama değil — disipline fiyat etiketi. */
let PGAP = { d: null, t: 0 };
const PGAP_LBL = {
  uyumlu: { lbl: "Plana uydun", cls: "ok" },
  "erken-cikis": { lbl: "Erken çıktın", cls: "warn" },
  "stop-gecikmesi": { lbl: "Stopu geciktirdin", cls: "bad" },
  "sanslı-sapma": { lbl: "Şanslı sapma", cls: "luck" },
};
async function renderPlanGap(force) {
  const el = $("#planGapBox");
  if (!el) return;
  try {
    if (force || !PGAP.d || Date.now() - PGAP.t > 5 * 60_000) {
      PGAP.d = await (await fetch("/api/plan-gap")).json();
      PGAP.t = Date.now();
    }
  } catch { return; }
  const d = PGAP.d;
  if (!d || d.error) { el.innerHTML = ""; return; }
  if (!d.n) {
    el.innerHTML = `<section class="panel pg-panel"><div class="panel-head"><div><h2>💸 Masada Bıraktığın Para</h2>
      <span class="chart-sub">Stop/hedefine harfiyen uysaydın ne olurdu — disiplinin dolar karşılığı</span></div></div>
      <p class="dj-empty-note">Henüz ölçülebilir işlem yok. Stop <b>ve</b> hedefle açılan swing'ler kapandıkça burada birikir${d.atlanan ? ` (${d.atlanan} işlem planı/mum verisi eksik olduğu için ölçüme girmedi)` : ""}.</p></section>`;
    return;
  }
  const usd = (n) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const net = d.netFark;
  // Ana rakam: net fark. Pozitif = plana uysan daha iyiydin (masada para bıraktın).
  const tone = net > 20 ? "warn" : net < -20 ? "luck" : "ok";
  const basli = net > 20
    ? `Plana harfiyen uysaydın <b>${usd(net)}</b> daha fazla kazanmıştın.`
    : net < -20
    ? `Plandan sapman <b>${usd(-net)}</b> kazandırdı — ama bu <b>şans</b>, süreç değil.`
    : `Gerçek sonucun planınla neredeyse aynı — <b>disiplin çalışıyor.</b>`;
  const rows = (d.rows || []).filter((r) => Math.abs(r.fark) >= 1).slice(0, 8).map((r) => {
    const m = PGAP_LBL[r.sebep] || PGAP_LBL.uyumlu;
    return `<tr>
      <td class="l"><b>${r.sym}</b><span class="pg-date">${fmtDate(r.openedAt)}</span></td>
      <td class="l"><span class="pg-tag ${m.cls}">${m.lbl}</span></td>
      <td>${fmtUSD(r.entry)}</td>
      <td class="pg-plan">${fmtUSD(r.planCikis)}<span class="pg-how">${r.planNasil === "hedef" ? "🎯 hedef" : r.planNasil === "stop" ? "⛔ stop" : "açık"}</span></td>
      <td>${r.gercekCikis != null ? fmtUSD(r.gercekCikis) : "—"}</td>
      <td class="${r.planPnl >= 0 ? "pos" : "neg"}">${usd(r.planPnl)}</td>
      <td class="${r.gercekPnl >= 0 ? "pos" : "neg"}">${usd(r.gercekPnl)}</td>
      <td><b class="${r.fark > 0 ? "neg" : r.fark < 0 ? "pos" : ""}">${r.fark > 0 ? "+" : ""}${usd(r.fark)}</b></td>
    </tr>`;
  }).join("");
  const g = d.dagilim || {};
  el.innerHTML = `
    <section class="panel pg-panel">
      <div class="panel-head"><div>
        <h2>💸 Masada Bıraktığın Para <span class="sw-chip">${d.n} işlem</span></h2>
        <span class="chart-sub">Stop/hedefine harfiyen uysaydın ne olurdu — disiplinin dolar karşılığı</span>
      </div></div>
      <div class="pg-hero ${tone}">
        <div class="pg-hero-main">${basli}</div>
        <div class="pg-hero-split">
          <span>Plana uysaydın <b class="${d.planToplam >= 0 ? "pos" : "neg"}">${usd(d.planToplam)}</b></span>
          <span>Gerçekte <b class="${d.gercekToplam >= 0 ? "pos" : "neg"}">${usd(d.gercekToplam)}</b></span>
          ${d.masada > 0 ? `<span class="pg-sep">·</span><span>erken çıkışların bedeli <b class="neg">${usd(d.masada)}</b></span>` : ""}
        </div>
      </div>
      <div class="pg-dist">
        ${[["uyumlu", g.uyumlu], ["erken-cikis", g.erkenCikis], ["stop-gecikmesi", g.stopGecikmesi], ["sanslı-sapma", g.sansliSapma]]
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `<span class="pg-tag ${PGAP_LBL[k].cls}">${PGAP_LBL[k].lbl} <b>${n}</b></span>`).join("")}
      </div>
      ${rows ? `<div class="tbl-wrap"><table class="pg-table">
        <thead><tr><th class="l">Sembol</th><th class="l">Ne oldu</th><th>Giriş</th><th>Plan çıkış</th><th>Senin çıkış</th><th>Plan K/Z</th><th>Gerçek K/Z</th><th>Fark</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : `<p class="dj-empty-note">Kayda değer sapma yok — çıkışların planınla örtüşüyor.</p>`}
      <div class="pg-note">${d.not}${d.atlanan ? ` <b>${d.atlanan}</b> işlem ölçüme girmedi (plan ya da mum verisi eksik).` : ""}</div>
    </section>`;
}
