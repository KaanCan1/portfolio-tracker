// Geçici önizleme mock'u — yalnızca Swing Defteri sekmesini test etmek için.
// Gerçek server.js'i (Supabase'e yazar) çalıştırmadan statik + sahte API sunar.
import { createServer } from "node:http";
import { readFile, readFile as _rf } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { qmAnalyze, qmADR } from "../qm.js";

const ROOT = join(process.cwd(), "public");
// Gerçek mum önbelleği — Meydan Okuma sekmesi önizlemede de gerçek fiyatlarla ölçülsün
let REAL_CANDLES = {};
try { REAL_CANDLES = JSON.parse(readFileSync(join(process.cwd(), "candle_cache.json"), "utf8")); } catch {}
// RAI ETF'leri + QQQ gerçek mumları (Twelve Data'dan alınmış fixture) — risk iştahı endeksi
// önizlemede de GERÇEK değerlerle hesaplansın (sentetik seri anlamsız RAI üretir)
try {
  const fx = JSON.parse(readFileSync(join(process.cwd(), "scripts", "rai-fixtures.json"), "utf8"));
  for (const [s, v] of Object.entries(fx)) if (!REAL_CANDLES[s]?.candles?.length) REAL_CANDLES[s] = { candles: v };
} catch {}
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

const today = new Date();
const iso = (y, m, d) => new Date(y, m, d).toISOString().slice(0, 10);
const Y = today.getFullYear(), M = today.getMonth();

// Zengin örnek defter: kapanmış (aylık dağılım) + açık pozisyonlar
let trades = [
  { id: "sw-1", symbol: "NVDA", name: "", entry: 118.5, stop: 110, target: 135, qty: 40, openedAt: iso(Y, M - 5, 3), status: "closed", exitPrice: 134.2, closedAt: iso(Y, M - 5, 18), note: "50g üstü kırılım" },
  { id: "sw-2", symbol: "AMD", entry: 142, stop: 134, target: 158, qty: 25, openedAt: iso(Y, M - 4, 2), status: "closed", exitPrice: 151, closedAt: iso(Y, M - 4, 20), note: "" },
  { id: "sw-3", symbol: "TSLA", entry: 240, stop: 225, target: 270, qty: 12, openedAt: iso(Y, M - 4, 6), status: "closed", exitPrice: 232, closedAt: iso(Y, M - 4, 9), note: "stop yedi" },
  { id: "sw-4", symbol: "MSFT", entry: 410, stop: 398, target: 440, qty: 8, openedAt: iso(Y, M - 3, 1), status: "closed", exitPrice: 436, closedAt: iso(Y, M - 3, 22), note: "" },
  { id: "sw-5", symbol: "PLTR", entry: 24.5, stop: 22, target: 31, qty: 200, openedAt: iso(Y, M - 2, 4), status: "closed", exitPrice: 28.1, closedAt: iso(Y, M - 2, 19), note: "" },
  { id: "sw-6", symbol: "AAPL", entry: 188, stop: 181, target: 205, qty: 30, openedAt: iso(Y, M - 1, 7), status: "closed", exitPrice: 197, closedAt: iso(Y, M - 1, 24), note: "" },
  { id: "sw-7", symbol: "SMCI", entry: 42, stop: 38, target: 52, qty: 60, openedAt: iso(Y, M, 2), status: "closed", exitPrice: 46.5, closedAt: iso(Y, M, 8), note: "kısmi" },
  // açık
  { id: "sw-8", symbol: "NVDA", entry: 130, stop: 122, target: 150, qty: 35, openedAt: iso(Y, M, 5), status: "open", note: "trend devam" },
  { id: "sw-8b", symbol: "NVDA", entry: 138, stop: 128, target: 160, qty: 15, openedAt: iso(Y, M, 9), status: "open", note: "2. swing ekleme" },
  { id: "sw-9", symbol: "META", entry: 580, stop: 555, target: 640, qty: 6, openedAt: iso(Y, M, 9), status: "open", note: "" },
  { id: "sw-10", symbol: "GOOGL", entry: 172, stop: 165, target: 190, qty: 20, openedAt: iso(Y, M, 11), status: "open", note: "boğa bayrağı" },
];
// META hedefini geçti (target uyarısı), GOOGL stop'u deldi (stop uyarısı)
const live = { NVDA: { price: 141.2, stale: false }, META: { price: 642, stale: false }, GOOGL: { price: 163.5, stale: false } };
let goal = { min: 600, max: 700, capital: 50000, riskPct: 1 };
const CH_LEDGER = { trades: [] }; // Alfa Avı immutable defter (önizleme: bellek-içi)
// Günlük İşlem Analizi önizlemesi: BUGÜNE tarihli örnek işlemler (1 swing satış, 1 uzun satış, 1 alım)
const _daToday = new Date().toISOString().slice(0, 10);
const DA_TRADES = [
  { id: "t-da1", kind: "sell", symbol: "NVDA", shares: 5, buyUSD: 130, sellUSD: 138.4, date: _daToday, note: "swing ana para çekme", src: "swing" },
  { id: "t-da2", kind: "sell", symbol: "AAPL", shares: 3, buyUSD: 205, sellUSD: 196.8, date: _daToday, note: "", src: "port" },
  { id: "t-da3", kind: "buy",  symbol: "AMD",  shares: 1.2, buyUSD: 521, sellUSD: 0, date: _daToday, note: "kırılım denemesi" },
];

// Üretimle parite için: VIX rejimi + Aç Gözlülük (sentiment) — local önizleme tam görünsün
const REGIME = { vix: 16.78, vixChangePct: 3.58, band: "SAKİN", tone: "calm", note: "Normal piyasa — dengeli pozisyon.", status: "raise-cash", advice: "Nakit az (%1). Hedef %20–25. ~%19 kadar kâr al / nakde geç.", targetCash: [20, 25], currentCashPct: 1, currentInvestedPct: 99, stale: false };
const FNG = { score: 37, band: "Korku", rating: "Korku", prevClose: 38, week: 36, month: 59, year: 54 };

// Portföy holding'leri — "Portföyden seç" akışı + swing rozeti + free-roll testi için
const FX = 41;
const CASH = { tl: 0, usd: 0, eur: 0 }; // satış geliri buraya geçer (nakit testi)
const hold = (id, symbol, name, quantity, costUSD, priceUSD, planStop = null, planTarget = null, prevClose = null) =>
  ({ id, type: "stock", symbol, name, quantity, costUSD, planStop, planTarget,
     live: { priceUSD, prevClose: prevClose ?? +(priceUSD * 0.985).toFixed(2), marketValueTRY: quantity * priceUSD * FX, marketValueUSD: quantity * priceUSD } });
const holdings = [
  hold("h-nbis", "NBIS", "Nebius Group", 120, 28.4, 34.1, null, null, 33.0),  // ana paranın ~yarısı geri alınmış
  hold("h-nvda", "NVDA", "NVIDIA", 35, 130, 141.2, 122, 150, 137.0), // realize > maliyet → BEDAVA
  hold("h-aapl", "AAPL", "Apple", 30, 188, 197, null, null, 195.0),  // kârda, henüz geri alım yok
];
// Mock teknik sinyaller — Pozisyon Teknikleri panelini test etmek için (üretimde server.js buildSignal üretir)
const mkSig = (h, rsi, sma50, sma200, w52High, w52Low, targetMean, tone) => {
  const price = h.live.priceUSD, cost = h.costUSD;
  return {
    rsi, sma20: sma50, sma50, sma200, w52High, w52Low, targetMean,
    fromHighPct: ((price - w52High) / w52High) * 100,
    fromLowPct: ((price - w52Low) / w52Low) * 100,
    upsidePct: targetMean ? ((targetMean - price) / price) * 100 : null,
    gainPct: cost ? ((price - cost) / cost) * 100 : null,
    signal: tone === "buy" ? { emoji: "🟢", label: "ALIM BÖLGESİ", tone: "buy" }
      : tone === "sell" ? { emoji: "🔴", label: "AŞIRI ALIM", tone: "sell" }
        : { emoji: "🟡", label: "NÖTR", tone: "neutral" },
    swing: h.planStop ? { stop: h.planStop, target: h.planTarget } : null,
    stale: false,
  };
};
holdings[1].horizon = "swing"; // NVDA → swing (stop/hedef) — uzun-vade/swing ayrımı testi
// Bilanço Nöbeti testi: NVDA(swing) 2 gün sonra, AAPL 6 gün sonra
holdings[1].earnings = { date: iso(Y, M, new Date().getDate() + 2), daysLeft: 2, hour: "amc", expectedMovePct: 8.5 };
holdings[2].earnings = { date: iso(Y, M, new Date().getDate() + 6), daysLeft: 6, hour: "bmo" };
holdings[0].sig = mkSig(holdings[0], 58, 31, 26, 38, 18, 42, "buy");        // NBIS: trend güçlü, hedefe potansiyel
holdings[1].sig = mkSig(holdings[1], 72, 132, 118, 152, 86, 168, "sell");   // NVDA: RSI ısınmış, açık R var (stop 122)
holdings[2].sig = mkSig(holdings[2], 49, 200, 205, 233, 164, 210, "neutral"); // AAPL: SMA altında, karışık trend
// Realize işlemleri (sells) — REALIZED_USD + aylık büyüme barları için (son aylara yayılı)
const monthAgo = (back) => { const d = new Date(); d.setMonth(d.getMonth() - back); return d.toISOString().slice(0, 10); };
const sells = [
  { kind: "sell", symbol: "NBIS", shares: 50, buyUSD: 28.4, sellUSD: 64, date: monthAgo(1) }, // +1780
  { kind: "sell", symbol: "NVDA", shares: 185, buyUSD: 130, sellUSD: 155, date: monthAgo(3) }, // +4625 → NVDA bedava
  { kind: "sell", symbol: "SMCI", shares: 60, buyUSD: 38, sellUSD: 46, date: monthAgo(2) },    // +480
  { kind: "sell", symbol: "PLTR", shares: 100, buyUSD: 24, sellUSD: 30.5, date: monthAgo(0) }, // +650 bu ay
];
// Net değer geçmişi (GÜNLÜK ~45 nokta) — Risk Karnesi (Sharpe/vol/drawdown) test edilebilsin
const history = [];
const gNow0 = holdings.reduce((s, h) => s + (h.live.marketValueTRY || 0), 0); // bugünkü ≈ grandTRY
(() => {
  const N = 45; let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const vals = []; let v = 1;
  for (let i = 0; i < N; i++) {
    const drift = (i >= 18 && i <= 26) ? -0.012 : 0.0035; // ortada ~1 haftalık düşüş
    v *= 1 + drift + (rnd() - 0.5) * 0.018;
    vals.push(v);
  }
  const scale = gNow0 / vals[vals.length - 1]; // bugünü gNow0'a sabitle
  for (let i = 0; i < N; i++) {
    const d = new Date(); d.setDate(d.getDate() - (N - 1 - i));
    history.push({ date: d.toISOString().slice(0, 10), total: Math.round(vals[i] * scale), usdtry: FX });
  }
})();
function swingOpenMap() {
  return trades.reduce((m, t) => {
    if (t.status !== "open") return m;
    const s = String(t.symbol || "").toUpperCase();
    m[s] = { qty: (m[s]?.qty || 0) + (+t.qty || 0), count: (m[s]?.count || 0) + 1 };
    return m;
  }, {});
}
// server.js'in opsiyon zenginleştirme çıktısını taklit eden hazır kayıtlar (USD görüntü testi için)
const MOCK_OPTIONS = [
  { id: "o1", underlying: "SOFI", kind: "call", direction: "long", expiry: "2027-12-17", dte: 543,
    strike: 40, contracts: 1, premiumPaid: 4.15, currentPremium: 2.17, premiumSource: "oto",
    costUSD: 415, valueUSD: 217, plUSD: -198, plPct: -47.71,
    costTRY: 19291.28, valueTRY: 10087.24, plTRY: -9204.03,
    moneyness: "OTM", breakeven: 44.15, pctToBreakeven: 158.2,
    maxProfitInf: true, maxLossInf: false, maxLoss: 4.15, underlyingPrice: 17.10 },
  { id: "o2", underlying: "SOFI", kind: "call", direction: "long", expiry: "2026-09-18", dte: 88,
    strike: 22, contracts: 1, premiumPaid: 2.01, currentPremium: 1.08, premiumSource: "oto",
    costUSD: 201, valueUSD: 108, plUSD: -93, plPct: -46.27,
    costTRY: 9343.48, valueTRY: 5020.38, plTRY: -4323.10,
    moneyness: "OTM", breakeven: 24.01, pctToBreakeven: 40.4,
    maxProfitInf: true, maxLossInf: false, maxLoss: 2.01, underlyingPrice: 17.10 },
];
// Fiyat alarmları (test): NVDA above 140 → tetik · NBIS pct_move 3 → tetik · AAPL below 190 → izliyor
let MOCK_OVR_EDIT = {}; // kullanıcı düzenlemeleri (PUT /api/realize-override testi)
let MOCK_R26_EDITS = {}; // truth kalemi düzeltmeleri (PUT /api/realized2026/:id)
const REALIZED_2026_TRUTH = [
  { symbol: "FLEX", label: "FLEX", amountTRY: -2509.65 }, { symbol: "COPX", label: "COPX", amountTRY: 247.92 },
  { symbol: "META", label: "META", amountTRY: 414.37 }, { symbol: "NBIS", label: "NBIS", amountTRY: 9770.68 },
  { symbol: "MULL", label: "MULL", amountTRY: 30430.23 }, { symbol: "SOFI", label: "SOFI $28 Call 30/01/26", amountTRY: -10213.34, opt: true },
  { symbol: "NASA", label: "NASA", amountTRY: -3800.57 }, { symbol: "MU", label: "MU", amountTRY: 29776.76 },
  { symbol: "SOFI", label: "SOFI $27,5 Call 09/01/26", amountTRY: 0, opt: true }, { symbol: "OUST", label: "OUST", amountTRY: -1967.66 },
  { symbol: "SOFI", label: "SOFI $26,5 Call 09/01/26", amountTRY: 515.58, opt: true }, { symbol: "IREN", label: "IREN", amountTRY: 311.51 },
  { symbol: "QCOM", label: "QCOM", amountTRY: 738.56 }, { symbol: "SOFI", label: "SOFI $26 Put 09/01/26", amountTRY: -558.54, opt: true },
  { symbol: "SOFI", label: "SOFI $28 Call 20/02/26", amountTRY: -28707.16, opt: true }, { symbol: "HOOD", label: "HOOD", amountTRY: -339.40 },
  { symbol: "TSLL", label: "TSLL", amountTRY: 109.49 }, { symbol: "MUU", label: "MUU", amountTRY: -3322.93 },
  { symbol: "AMD", label: "AMD", amountTRY: 4274.16 }, { symbol: "SOFI", label: "SOFI $22 Call 18/06/26", amountTRY: -18796.92, opt: true },
  { symbol: "IONQ", label: "IONQ", amountTRY: 3266.47 }, { symbol: "SLV", label: "SLV $72 Call 15/05/26", amountTRY: 49.24, opt: true },
  { symbol: "CIFR", label: "CIFR", amountTRY: 1224.92 }, { symbol: "TLT", label: "TLT $90 Call 17/04/26", amountTRY: -10057.50, opt: true },
  { symbol: "AMZN", label: "AMZN", amountTRY: -579.37 }, { symbol: "NVDA", label: "NVDA", amountTRY: 3307.33 },
  { symbol: "NKE", label: "NKE $66 Call 23/01/26", amountTRY: 3652.89, opt: true }, { symbol: "SOFI", label: "SOFI $29,5 Call 30/01/26", amountTRY: -1850.41, opt: true },
  { symbol: "APP", label: "APP", amountTRY: 920.63 }, { symbol: "SOFI", label: "SOFI $23 Call 15/05/26", amountTRY: -1694.77, opt: true },
  { symbol: "TSLA", label: "TSLA", amountTRY: 3924.01 }, { symbol: "NKE", label: "NKE $70 Call 20/02/26", amountTRY: 2277.69, opt: true },
  { symbol: "SOFI", label: "SOFI", amountTRY: -12495.88 },
];
let ALERTS = [
  { id: "al-1", symbol: "NVDA", type: "above", value: 140, note: "", createdAt: "2026-06-10" },
  { id: "al-2", symbol: "AAPL", type: "below", value: 190, note: "", createdAt: "2026-06-12" },
  { id: "al-3", symbol: "NBIS", type: "pct_move", value: 3, note: "", createdAt: "2026-06-14" },
];
function evalAlertMock(a) {
  const h = holdings.find((x) => x.symbol === a.symbol);
  const price = h?.live?.priceUSD ?? null;
  const dc = h?.live ? +(((h.live.priceUSD - h.live.prevClose) / h.live.prevClose) * 100).toFixed(2) : null;
  let fired = false, near = false;
  if (price != null) {
    if (a.type === "below") fired = price <= a.value;
    else if (a.type === "above") fired = price >= a.value;
    else if (a.type === "pct_move") fired = dc != null && Math.abs(dc) >= a.value;
    if (!fired) {
      if (a.type === "below") near = price <= a.value * 1.03;
      else if (a.type === "above") near = price >= a.value * 0.97;
      else if (a.type === "pct_move" && dc != null) near = Math.abs(dc) >= a.value * 0.7;
    }
  }
  return { ...a, price, dayChangePct: dc, fired, near };
}
function portfolioPayload() {
  const today = new Date().toISOString().slice(0, 10);
  const swingTRY = trades.filter((t) => t.status === "open" && t.qty > 0).reduce((s, t) => { const h = holdings.find((x) => x.symbol === t.symbol); const live = h?.live?.priceUSD; return live != null ? s + live * t.qty * FX : s; }, 0);
  const grandTRY = holdings.reduce((s, h) => s + (h.live.marketValueTRY || 0), 0) + swingTRY; // swing dahil (hero+grafik tutarlı)
  // Birleşik realize (server mantığını taklit): ana satışlar + swing setup realize'leri (dedupe)
  const realizedBySym = (() => {
    const swIds = new Set(), swReal = {};
    for (const t of trades) {
      const sym = (t.symbol || "").toUpperCase(); if (!sym) continue; let sr = 0;
      for (const lot of t.realizedLots || []) { sr += lot.pnlUSD || 0; if (lot.tradeId) swIds.add(lot.tradeId); }
      if ((!t.realizedLots || !t.realizedLots.length) && t.status === "closed" && t.exitPrice != null && t.qty > 0) sr += (t.exitPrice - t.entry) * t.qty;
      if (sr) swReal[sym] = (swReal[sym] || 0) + sr;
    }
    const out = {};
    for (const tr of sells) { if (tr.kind === "buy" || swIds.has(tr.id)) continue; const sym = (tr.symbol || "").toUpperCase(); const pl = (tr.shares || 0) * ((tr.sellUSD || 0) - (tr.buyUSD || 0)); if (sym) out[sym] = (out[sym] || 0) + pl; }
    for (const [s, v] of Object.entries(swReal)) out[s] = +(((out[s] || 0) + v)).toFixed(2);
    return out;
  })();
  const effOvr = (() => { const o = {}; for (const r of REALIZED_2026_TRUTH.map((x, i) => ({ ...x, id: "r26-truth-" + i }))) { const amt = MOCK_R26_EDITS[r.id] != null ? +MOCK_R26_EDITS[r.id] : r.amountTRY; o[r.symbol] = +(((o[r.symbol] || 0) + amt)).toFixed(2); } return o; })();
  const editedSyms = (() => { const s = {}; REALIZED_2026_TRUTH.forEach((r, i) => { if (MOCK_R26_EDITS["r26-truth-" + i] != null) s[r.symbol] = true; }); return s; })();
  for (const [s, tl] of Object.entries(effOvr)) realizedBySym[s] = +(tl / FX).toFixed(2);
  const truthItems = REALIZED_2026_TRUTH.map((r, i) => { const id = "r26-truth-" + i; return MOCK_R26_EDITS[id] != null ? { id, symbol: r.symbol, label: r.label, amountTRY: +MOCK_R26_EDITS[id], date: null, year: 2026, auto: true, source: "truth", edited: true } : { id, symbol: r.symbol, label: r.label, amountTRY: r.amountTRY, date: null, year: 2026, auto: true, source: "truth" }; });
  return { holdings, options: MOCK_OPTIONS, cash: CASH, flows: [], trades: [...sells, ...DA_TRADES], realized2026: truthItems, watchlist: [], realizedBySym, realizeOverrideTRY: effOvr, realizeOverrideEdited: editedSyms,
    history, fx: { usdtry: FX, eurtry: +(FX * 1.083).toFixed(4), gram: 4500 }, // gram → healthy=true (Toplam Getiri/donut dolsun)
    meta: { totals: { grandTRY }, summaryText: "Portföy bugün +%1,36 yukarıda. 🛡 1 pozisyon ağırlık uyarısı (AAPL). 📈 2 hissede aktif swing." },
    alerts: ALERTS.map(evalAlertMock),
    insights: { score: 78, grade: "saglam", items: [
      { kind: "risk", title: "AAPL ağırlığı yüksek", detail: "Portföyün %40'ı tek pozisyonda", action: "kısmi azalt" },
      { kind: "firsat", title: "NVDA biriktirme bölgesinde", detail: "20g ortalamaya yakın", action: "kademeli ekle" },
    ] },
    topPicks: [
      { symbol: "AAPL", weightPct: 40, priceUSD: 197, dayChangePct: 1.2, reco: "buy", recoTotal: 32, rsi: 58, pros: ["Güçlü nakit akışı"], cons: ["Yüksek değerleme"], newsSummary: "Servis gelirleri rekor." },
      { symbol: "NBIS", weightPct: 28, priceUSD: 283, dayChangePct: -1.1, reco: "strong_buy", recoTotal: 12, rsi: 62, pros: ["AI altyapı talebi"], cons: ["Oynak"], newsSummary: "Yeni veri merkezi anlaşması." },
    ],
    dayOpen: { date: today, total: grandTRY - 8200 }, regime: REGIME, fearGreed: FNG, // dayTRY=+8200 → ~+$200 günlük · regime/fearGreed → render() sentiment satırı (eziyordu)
    swingOpen: swingOpenMap(),
    swingPositions: trades.filter((t) => t.status === "open" && t.qty > 0).map((t) => {
      const h = holdings.find((x) => x.symbol === t.symbol);
      const live = h?.live?.priceUSD ?? null;
      const qty = t.qty, entry = t.entry;
      const stop = t.stop ?? null;
      const riskPerShare = stop != null && entry > stop ? entry - stop : null;
      const currentR = riskPerShare != null && live != null ? +((live - entry) / riskPerShare).toFixed(2) : null;
      // sentetik chandelier iz süren stop: girişin biraz altı, fiyat yükseldikçe yukarı
      const chand = stop != null ? +(Math.max(stop, (live ?? entry) * 0.9)).toFixed(2) : (live ?? entry) * 0.9;
      const gStop = stop != null ? Math.max(chand, stop) : chand;
      const distPct = live != null ? +(((live - gStop) / live) * 100).toFixed(1) : null;
      const ma10 = live != null ? +(live * 0.97).toFixed(2) : null, ma20 = live != null ? +(live * 0.94).toFixed(2) : null;
      const daysOpen = 9; // zaman-stop testi için
      return { id: t.id, symbol: t.symbol, name: h?.name || t.name || null, qty, entry, stop, target: t.target ?? null,
        price: live, dayChangePct: h?.live ? +(((h.live.priceUSD - h.live.prevClose) / h.live.prevClose) * 100).toFixed(2) : null,
        costUSD: entry * qty, valueUSD: live != null ? live * qty : null, plUSD: live != null ? (live - entry) * qty : null, plPct: live != null && entry ? ((live - entry) / entry) * 100 : null,
        guard: live != null ? { stop: +gStop.toFixed(2), chandelier: +chand.toFixed(2), distPct, breached: live <= gStop, near: distPct != null && distPct > 0 && distPct <= 3, targetHit: t.target != null && live >= t.target } : null,
        riskPerShare: riskPerShare != null ? +riskPerShare.toFixed(2) : null,
        currentR, mfeR: currentR != null ? +(currentR + 0.8).toFixed(2) : null, maeR: currentR != null ? +(currentR - 0.6).toFixed(2) : null,
        daysOpen, timeStop: daysOpen >= 7 && currentR != null && currentR < 1,
        ma10, ma20, belowMa10: live != null && ma10 != null ? live < ma10 : null, belowMa20: live != null && ma20 != null ? live < ma20 : null };
    }),
    midasFees: { count: 12, usd: 18, tryTot: +(18 * FX).toFixed(2), perTrade: 1.5 },
    updatedAt: new Date().toISOString() };
}
// ---- Qullamaggie tarayıcı mock'u: gerçek qm.js motorunu sentetik mumlarla çalıştır ----
const QB = new Date("2026-01-01").getTime();
function qCandles(closes, { adr = 5, vol = 1_000_000, gaps = {} } = {}) {
  const out = []; let prev = closes[0];
  for (let i = 0; i < closes.length; i++) {
    const close = closes[i];
    const open = gaps[i] != null ? prev * (1 + gaps[i] / 100) : (prev + close) / 2;
    const half = close * (adr / 200);
    out.push({ time: new Date(QB + i * 86400000).toISOString().slice(0, 10),
      open: +open.toFixed(2), high: +(Math.max(open, close) + half).toFixed(2),
      low: +(Math.min(open, close) - half).toFixed(2), close: +close.toFixed(2),
      volume: gaps[i] != null ? vol * 3 : vol });
    prev = close;
  }
  return out;
}
function qSetup(top) { // setting-up: +%45 hamle + sıkışma, pivotun hemen altında
  const lo = top * 0.69, cl = [];
  for (let i = 0; i < 18; i++) cl.push(lo + Math.sin(i) * lo * 0.008);
  for (let i = 0; i < 24; i++) cl.push(lo + ((i + 1) / 24) * (top - lo));
  for (let i = 0; i < 24; i++) { const t = i / 23; cl.push(top * 0.95 + t * top * 0.012 + Math.sin(i * 1.3) * top * 0.03 * (1 - t) * 0.5); }
  return cl;
}
function qBreak(top) { const cl = qSetup(top); cl.push(top * 1.02); return cl; } // bugün pivotu kırıyor (tek gün)
function qEP2(b) { const cl = []; for (let i = 0; i < 78; i++) cl.push(b + Math.sin(i) * b * 0.006); cl.push(b * 1.14, b * 1.15, b * 1.16); return cl; }
function qExt(top) { const lo = top * 0.69, cl = []; for (let i = 0; i < 30; i++) cl.push(lo + Math.sin(i) * lo * 0.006); for (let i = 0; i < 24; i++) cl.push(lo + ((i + 1) / 24) * (top - lo)); let v = top; for (let i = 0; i < 12; i++) { v *= 1.06; cl.push(+v.toFixed(2)); } return cl; }
const QM_STOCKS = [
  { sym: "NVDA", name: "NVIDIA", cl: qSetup(140), o: { adr: 5, vol: 30e6 } },
  { sym: "SMCI", name: "Super Micro", cl: qBreak(48), o: { adr: 7, vol: 8e6 } },
  { sym: "HIMS", name: "Hims & Hers", cl: qEP2(38), o: { adr: 6, vol: 6e6, gaps: { 78: 14 } } },
  { sym: "CLS", name: "Celestica", cl: qSetup(96), o: { adr: 5, vol: 3e6 } },
  { sym: "RKLB", name: "Rocket Lab", cl: qSetup(27), o: { adr: 8, vol: 12e6 } },
  { sym: "APP", name: "AppLovin", cl: qExt(330), o: { adr: 6, vol: 4e6 } },
];
function qmPayload() {
  const items = QM_STOCKS.map((s) => {
    const candles = qCandles(s.cl, s.o);
    const price = candles[candles.length - 1].close;
    const a = qmAnalyze(candles, { price });
    return {
      symbol: s.sym, name: s.name, theme: null, owned: false, watched: false,
      price, dayChangePct: +(Math.sin(s.sym.length * 3) * 2.4).toFixed(2),
      setup: a.setup, stage: a.stage, score: a.score, adrPct: a.adrPct, priorMovePct: a.priorMovePct,
      entry: a.entryTrigger, stop: a.stop, stopPct: a.stopPct, pivot: a.pivotHigh, rTargets: a.rTargets,
      ep: a.ep, extendedOverMA10: a.extendedOverMA10, consolidation: a.consolidation, ma: a.ma,
      checklist: a.checklist, reasons: a.reasons,
      fromHighPct: a.consolidation ? -a.consolidation.nearHighPct : null,
      rsRating: Math.round(55 + Math.sin(s.sym.length * 2.1) * 35),   // 20-90 arası sentetik
      volConfirm: +(1.2 + Math.abs(Math.sin(s.sym.length)) * 1.4).toFixed(2),
      spark: candles.map((c) => c.close).slice(-40),
    };
  }).filter((x) => x.setup !== "none");
  const rank = { "breaking-out": 3, "setting-up": 2, "early": 1, "extended": 0 };
  items.sort((a, b) => (rank[b.stage] - rank[a.stage]) || (b.score - a.score));
  const ready = items.filter((x) => x.stage === "breaking-out" || x.stage === "setting-up");
  const watch = items.filter((x) => x.stage === "extended" || x.stage === "early");
  return { updated: Date.now(), refreshing: false, total: QM_STOCKS.length, scanned: items.length,
    top: ready, watch };
}
function qmChartPayload(sym) {
  const s = QM_STOCKS.find((x) => x.sym === sym);
  if (!s) return null;
  const candles = qCandles(s.cl, s.o);
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  const smaSeries = (n) => candles.map((c, i) => (i >= n - 1 ? { time: c.time, value: +(closes.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n).toFixed(2) } : null)).filter(Boolean);
  const smaLast = (n) => (closes.length >= n ? closes.slice(-n).reduce((a, b) => a + b, 0) / n : null);
  const qm = qmAnalyze(candles, { price });
  return {
    symbol: sym, name: s.name, price, asOf: Date.now(), candles,
    sma20: smaSeries(20), sma50: smaSeries(50), sma200: smaSeries(200),
    indicators: { sma20: smaLast(20), sma50: smaLast(50), sma200: smaLast(200), atr: price * (qm.adrPct || 5) / 100, rsi: 60, high20: qm.pivotHigh, low20: qm.stop },
    levels: { support: [qm.stop], resistance: [qm.pivotHigh] },
    plan: { entry: null, currentPrice: price, stop: null, target: null, target2: null, trend: "yükseliş", grade: "B", rr: null, riskPct: null, rewardPct: null, verdict: { tone: "warn", label: "İşlem planı için 🏆 QM paneline bak" }, setup: null, note: "",
      longterm: (() => {
        const s20 = smaLast(20), s50 = smaLast(50), s200 = smaLast(200);
        const pctTo = (l) => l ? +(((price - l) / l) * 100).toFixed(1) : null;
        const zones = [];
        if (price <= s20 * 1.03) zones.push({ label: "Şimdi · ortalama yakını", price: +price.toFixed(2), pct: 45, isNow: true });
        if (s50 && s50 < price) zones.push({ label: "50g ortalama", price: +s50.toFixed(2), pct: zones.length ? 35 : 55, isNow: false });
        if (s200 && s200 < price) zones.push({ label: "200g ortalama", price: +s200.toFixed(2), pct: zones.length ? 20 : 45, isNow: false });
        return { verdict: { key: zones[0]?.isNow ? "buy" : "watch", label: zones[0]?.isNow ? "Uygun biriktirme bölgesi" : "Trend sağlam · geri çekilme bekle", tone: zones[0]?.isNow ? "good" : "warn" },
          valuation: { to20: pctTo(s20), to50: pctTo(s50), to200: pctTo(s200) }, zones, reclaim: null,
          note: "Fiyat yükselen ortalama yakınında — kademeli biriktirmeye uygun. Bölgelere bölerek al." };
      })() },
    patterns: {}, weekly: null, why: [{ tone: "good", text: "200g üstünde — yapısal yukarı trend." }], signals: [], qm,
  };
}

const EMPTY = { "/api/sentiment": { fearGreed: FNG, regime: REGIME }, "/api/reports": [] };

// ---- Birleşik Radar mock'u: skorlu radar item'lar (cuma bayraklı) + swing kurulumları ----
const RADAR_GROUPS_MOCK = [
  { key: "popular", title: "Popüler · Mega-Cap" }, { key: "ai", title: "AI · Yarı İletken & Optik" },
  { key: "tech", title: "Büyüme · Teknoloji & Yazılım" }, { key: "fin", title: "Finans" },
];
const sig = (key, tone, label, text) => ({ key, tone, label, text });
// [sym, name, theme, price, dc, score, tierKey, trend, cuma, story]
const RADAR_MOCK_ROWS = [
  ["NVDA", "NVIDIA Corp", "ai", 194.86, -1.38, 78, "strong", "hot", true, "Yapay zekâ çip talebinin lideri"],
  ["AVGO", "Broadcom Inc", "ai", 360.49, -2.40, 59, "buy", "up", false, "AI özel çip + ağ donanımı"],
  ["GOOGL", "Alphabet Inc", "popular", 359.95, -0.35, 58, "buy", "up", false, "Arama + Gemini AI + bulut"],
  ["HOOD", "Robinhood Markets", "fin", 112.61, 2.10, 55, "buy", "hot", true, "Perakende aracılık büyümesi"],
  ["AAPL", "Apple Inc", "popular", 308.67, 4.85, 52, "buy", "up", false, "iPhone + servis ekosistemi"],
  ["JPM", "JPMorgan Chase", "fin", 334.51, 0.13, 48, "watch", "up", false, "En güçlü ABD bankası"],
  ["SMCI", "Super Micro", "ai", 46.50, 3.20, 43, "watch", "up", true, "AI sunucu üreticisi"],
  ["AMD", "Advanced Micro", "ai", 194.86, -1.38, 44, "watch", "up", false, "GPU/CPU ikinci oyuncu"],
  ["META", "Meta Platforms", "popular", 582.94, -4.89, 41, "watch", "down", false, "Reklam + akıllı gözlük"],
  ["PLTR", "Palantir Tech", "tech", 28.10, 1.90, 62, "buy", "hot", true, "AI veri platformu"],
];
function radarMockItems() {
  return RADAR_MOCK_ROWS.map(([symbol, name, theme, price, dc, score, tierKey, trend, cuma, story]) => {
    const g = RADAR_GROUPS_MOCK.find((x) => x.key === theme);
    const tierLabel = { strong: "GÜÇLÜ AL", buy: "AL", watch: "İZLE", neutral: "NÖTR" }[tierKey];
    const s = (base) => Math.max(0, Math.min(100, Math.round(base)));
    return {
      symbol, name, theme: { key: theme, title: g?.title || theme }, cuma,
      price, dayChangePct: dc, score, tier: { key: tierKey, label: tierLabel },
      trend, story, target: +(price * (1 + (score - 40) / 130)).toFixed(2), upsidePct: Math.round((score - 40) / 1.3),
      signals: [
        sig("mom", score >= 60 ? "good" : score >= 45 ? "warn" : "bad", "Momentum", "3a/6a getiri + 52h zirve"),
        sig("ana", score >= 55 ? "good" : "warn", "Analist", "al/tut konsensüsü"),
        sig("fun", score >= 50 ? "good" : "warn", "Bilanço", "gelir/kâr büyüme"),
        sig("ins", cuma ? "good" : "bad", "Insider", "90g yönetici işlemi"),
      ],
      recoCounts: { strongBuy: s(score / 20), buy: s(score / 12), hold: 3, sell: 1, strongSell: 0 }, recoTotal: s(score / 6),
      insider: { buys: cuma ? 3 : 0, sells: 1, netValue: cuma ? 2.4e6 : -0.3e6 },
      ret1M: dc * 2, ret3M: score - 45, ret6M: score - 30, ret1Y: score, retYTD: score - 20, fromHighPct: -(100 - score) / 4,
      marketCap: 5e11, pe: 28, pegYr: 1.4, beta: 1.2, revenueGrowth: 22, earningsGrowth: 30, grossMargin: 55, profitMargin: 25, roe: 30,
      summaryText: `Skor ${score}: momentum ${score >= 60 ? "güçlü" : "ılımlı"}, ${cuma ? "insider alım var" : "insider nötr"}.`,
    };
  });
}
// Swing kurulumları — bazı semboller radar ile örtüşür (join testi), biri swing-only (PLTR yok → RIVN)
const SWING_MOCK_ROWS = [
  ["NVDA", "NVIDIA Corp", "ai", 194.86, -1.38, "breakout", "Breakout — pivot kırılımı", "breakout", 196.5, 182.3, 232.0, 2.4, 7.2, 18.1, 61, "A", "buy", true],
  ["GOOGL", "Alphabet Inc", "popular", 359.95, -0.35, "pullback", "Pullback — 20g destek", "pullback", 362.0, 344.0, 400.0, 2.1, 5.0, 10.6, 48, "B", "buy", false],
  ["HOOD", "Robinhood Markets", "fin", 112.61, 2.10, "breakout", "Breakout — ORH", "breakout", 113.5, 104.6, 136.0, 2.5, 7.8, 19.8, 58, "A", "buy", true],
  ["SMCI", "Super Micro", "ai", 46.50, 3.20, "pullback", "Pullback — 50g", "pullback", 47.0, 43.0, 55.0, 1.9, 8.5, 17.0, 55, "B", "buy", true],
  ["RIVN", "Rivian Automotive", "tech", 18.57, 1.20, "breakout", "Breakout — pivot", "breakout", 18.9, 17.3, 22.3, 2.0, 8.5, 18.0, 52, "B", "watch", false],
  ["AMD", "Advanced Micro", "ai", 194.86, -1.38, null, null, null, null, null, null, null, null, null, 44, "C", "warn", false],
];
function swingMockItems() {
  return SWING_MOCK_ROWS.map(([symbol, name, theme, price, dc, setupType, setupLabel, entryType, entry, stop, target, rr, riskPct, rewardPct, rsi, grade, vkey, cuma]) => ({
    symbol, name, price, dayChangePct: dc, cuma, owned: false, watched: false,
    setup: setupType ? { type: setupType, label: setupLabel } : null,
    entry, entryType, stop, target, rr, riskPct, rewardPct, rsi, grade,
    verdict: { key: vkey, tone: vkey === "buy" ? "good" : "warn", label: vkey === "buy" ? "AL" : "İZLE" },
  }));
}

// Hisse Notları önizleme defteri (bellek-içi) — server.js data.notes ile aynı şekil
let notes = [
  { id: "note-a", symbol: "MU", label: "alacaklarim", text: "MU'ya bu hafta 300-500$ arası eklemeyi düşünüyorum — HBM talebi güçlü, 20MA'da tutuyor.", title: "HBM döngüsü tezi", targetUSD: 130, stopUSD: 88, conviction: 4, url: "https://example.com/hbm-rapor", pinned: true, priceAtUSD: 95.4, createdAt: iso(Y, M, 2), updatedAt: iso(Y, M, 2) },
  { id: "note-b", symbol: "NVDA", label: "izliyorum", text: "Kırılım öncesi konsolidasyon. ORH 145 üstünü bekle, erken girme.", createdAt: iso(Y, M, 3), updatedAt: iso(Y, M, 3) },
  { id: "note-c", symbol: "AAPL", label: "satacaklarim", text: "Ağırlık %40'a çıktı — 205 civarı kısmi azalt, tek pozisyon riskini düşür.", createdAt: iso(Y, M, 1), updatedAt: iso(Y, M, 1) },
  { id: "note-d", symbol: "", label: "tez", text: "Genel tez: kâra geçince ana parayı çek, kârı bedava bindir. Nakit hedefi %20-25.", createdAt: iso(Y, M - 1, 20), updatedAt: iso(Y, M - 1, 20) },
];
const readBody = async (req) => { let b = ""; for await (const c of req) b += c; return JSON.parse(b || "{}"); };
const AI_THESES = {}; // Claude AI mock önbelleği (tez / gün denetimi)
const AI_DAYS = {};
const normNote = (b, id) => {
  const num = (v) => (v === "" || v == null || Number.isNaN(+v) ? null : +v);
  const symbol = String(b.symbol || "").trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
  return {
    id: id || ("note-" + Date.now().toString(36)),
    symbol,
    label: String(b.label || "genel").trim().slice(0, 24) || "genel",
    text: String(b.text || "").trim().slice(0, 4000),
    title: String(b.title || "").trim().slice(0, 120),
    targetUSD: num(b.targetUSD), stopUSD: num(b.stopUSD),
    conviction: Math.min(5, Math.max(0, Math.round(num(b.conviction) || 0))) || null,
    url: String(b.url || "").trim().slice(0, 300),
    pinned: !!b.pinned,
    priceAtUSD: num(b.priceAtUSD) ?? (symbol ? num(holdings.find((h) => h.symbol === symbol)?.live?.priceUSD) : null),
    createdAt: b.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};
// Profil önizleme kaydı (bellek-içi)
let mockProfile = { name: "Demo Kullanıcı", title: "Bireysel yatırımcı", email: "demo@example.com", phone: "", address: "", broker: "Midas", baseCurrency: "TRY", about: "Kural 1: önce sermayeyi koru.", updatedAt: new Date().toISOString() };

const server = createServer(async (req, res) => {
  const url = req.url.split("?")[0];
  // Hisse Notları API
  if (url === "/api/notes" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(notes)); return;
  }
  if (url === "/api/notes" && req.method === "POST") {
    const b = await readBody(req);
    if (!String(b.text || "").trim()) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "not metni boş olamaz" })); return; }
    const n = normNote(b); notes.unshift(n);
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(n)); return;
  }
  if (url.startsWith("/api/notes/") && req.method === "PUT") {
    const id = url.split("/").pop(); const b = await readBody(req);
    const i = notes.findIndex((x) => x.id === id);
    if (i < 0) { res.writeHead(404); res.end("{}"); return; }
    notes[i] = normNote({ ...notes[i], ...b }, id);
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(notes[i])); return;
  }
  if (url.startsWith("/api/notes/") && req.method === "DELETE") {
    const id = url.split("/").pop(); notes = notes.filter((x) => x.id !== id);
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true })); return;
  }
  // Profil API mock
  if (url === "/api/profile") {
    if (req.method === "PUT") { const b = await readBody(req); mockProfile = { ...mockProfile, ...b, updatedAt: new Date().toISOString() }; }
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(mockProfile)); return;
  }
  // Claude AI mock — üretim akışıyla aynı şekil (600ms gecikme, bellek-içi önbellek)
  if (url === "/api/ai/status") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ enabled: true, model: "claude-opus-4-8 (mock)" })); return;
  }
  if (url.startsWith("/api/ai/thesis")) {
    if (req.method === "POST") {
      const b = await readBody(req);
      const sym = String(b.symbol || "NVDA").toUpperCase();
      const rec = {
        symbol: sym, at: new Date().toISOString(), model: "claude-opus-4-8 (mock)",
        result: {
          karar: "TUT", guven: 68,
          ozet: `${sym} trendi sağlam ama pozisyon ağırlığı yüksek — yeni ekleme için kırılım teyidi bekle, mevcut planı koru. (MOCK yanıt — gerçek Claude çıktısı değil.)`,
          boga_tezi: ["Fiyat 50 günlük ortalamanın üstünde, RS güçlü", "Sektör momentumu pozitif, son bilanço beklentiyi aştı"],
          ayi_tezi: ["Portföy ağırlığı %30 üstü — tek hisse riski", "Zirveye çok yakın, risk/ödül girişte aleyhte"],
          riskler: ["Bilanço 8 gün sonra — pozisyon taşıma riski", "Rejim kapalıyken ekleme disiplin ihlali olur"],
          kirmizi_cizgiler: ["Haftalık kapanış 50g ortalamanın altına inerse", "Bilançoda gelir büyümesi %20'nin altına düşerse"],
          seviyeler: { stop: 128.0, hedef: 160.0, aciklama: "Stop: son swing dibi; hedef: ölçülü hamle projeksiyonu" },
          kontrol_listesi: ["Bilanço tarihi öncesi pozisyonu gözden geçir", "Hacimli kırılım olursa kademeli ekle"],
        },
      };
      AI_THESES[sym] = rec;
      setTimeout(() => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(rec)); }, 600);
      return;
    }
    const sym = String(new URL(req.url, "http://x").searchParams.get("symbol") || "").toUpperCase();
    if (AI_THESES[sym]) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ...AI_THESES[sym], cached: true })); }
    else { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "kayıtlı tez yok" })); }
    return;
  }
  if (url.startsWith("/api/ai/day-review")) {
    if (req.method === "POST") {
      const b = await readBody(req);
      const rec = {
        date: String(b.date || "").slice(0, 10), at: new Date().toISOString(), model: "claude-opus-4-8 (mock)",
        result: {
          genel: "Gün genel olarak disiplinli: iki satış planlıydı, ama AMD alımı rejim kapalıyken yapıldı — motorla aynı fikirdeyim. (MOCK yanıt.)",
          disiplin_notu: 72,
          islemler: (b.islemler || []).map((t) => ({
            symbol: t.symbol, karar: t.motorKarari || "TARTISMALI",
            gerekce: "Motor bulgularıyla tutarlı: " + ((t.bulgular || [])[0] || "veri sınırlı."),
            ders: t.motorKarari === "HATALI" ? "Rejim kapalıyken giriş yok — kuralı ekrana yapıştır." : "Planlı işlem — aynı disiplinle devam.",
          })),
          yarin_kurali: "QQQ EMA21 altındayken hiçbir yeni pozisyon açma — önce rejim, sonra hisse.",
        },
      };
      AI_DAYS[rec.date] = rec;
      setTimeout(() => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(rec)); }, 600);
      return;
    }
    const dt = String(new URL(req.url, "http://x").searchParams.get("date") || "").slice(0, 10);
    if (AI_DAYS[dt]) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ...AI_DAYS[dt], cached: true })); }
    else { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "kayıtlı denetim yok" })); }
    return;
  }
  // Aylık hedef
  if (url === "/api/swing-goal" && req.method === "PUT") {
    let body = ""; for await (const c of req) body += c;
    const b = JSON.parse(body || "{}");
    const min = Math.max(0, Math.round(+b.min || 0));
    goal = { min, max: Math.max(min, Math.round(+b.max || 0)), capital: +b.capital || goal.capital, riskPct: +b.riskPct || goal.riskPct };
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(goal)); return;
  }
  // Swing API
  if (url === "/api/swing-trades") {
    if (req.method === "POST" || req.method === "PUT") {
      let body = ""; for await (const c of req) body += c;
      const b = JSON.parse(body || "{}");
      if (req.method === "POST") {
        // sunucu mantığını yansıt: entry yoksa totalCost/qty, o da yoksa holding ort. maliyeti
        const qty = +b.qty || 0;
        let entry = +b.entry;
        if (!(entry > 0) && +b.totalCost > 0 && qty > 0) entry = +b.totalCost / qty;
        if (!(entry > 0)) { const h = holdings.find((x) => x.symbol === String(b.symbol).toUpperCase()); if (h && +h.costUSD > 0) entry = +h.costUSD; }
        if (!(entry > 0)) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "giriş maliyeti bulunamadı" })); return; }
        trades.push({ id: "sw-" + Date.now().toString(36), status: "open", symbol: String(b.symbol).toUpperCase(), qty, entry, stop: b.stop ? +b.stop : null, target: b.target ? +b.target : null, openedAt: b.openedAt || new Date().toISOString().slice(0, 10), note: b.note || "" });
      }
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true })); return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ trades, live, goal })); return;
  }
  // Swing kısmi satış (ana para çek) — gerçek satışı simüle et
  if (/^\/api\/swing-trades\/[^/]+\/sell$/.test(url) && req.method === "POST") {
    let body = ""; for await (const c of req) body += c;
    const b = JSON.parse(body || "{}");
    const id = url.split("/")[3];
    const t = trades.find((x) => x.id === id);
    if (!t) { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "yok" })); return; }
    const sell = Math.min(+b.shares || 0, t.qty), px = +b.exitPrice || 0;
    const date = b.date || new Date().toISOString().slice(0, 10);
    const pnl = +((px - t.entry) * sell).toFixed(2);
    t.realizedLots = t.realizedLots || []; t.realizedLots.push({ shares: sell, exitPrice: px, pnlUSD: pnl, date });
    t.qty = +(t.qty - sell).toFixed(4);
    if (t.qty <= 1e-6) { t.status = "closed"; t.closedAt = date; t.exitPrice = px; }
    // holding düş + trade + realize ekle (zero-cost sütunu güncellensin)
    const h = holdings.find((x) => x.symbol === t.symbol);
    if (h) { h.quantity = +(h.quantity - sell).toFixed(4); if (h.quantity <= 1e-6) holdings.splice(holdings.indexOf(h), 1); }
    sells.push({ kind: "sell", symbol: t.symbol, shares: sell, buyUSD: t.entry, sellUSD: px, date });
    CASH.usd = +((CASH.usd + sell * px)).toFixed(2); // satış geliri nakde (server.js applyTrade ile aynı)
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, swing: t })); return;
  }
  if (url.startsWith("/api/swing-trades/")) {
    const id = url.split("/").pop();
    if (req.method === "DELETE") {
      const sw = trades.find((t) => t.id === id);
      if (sw && Array.isArray(sw.realizedLots) && sw.realizedLots.length) {
        // realize edilmiş kâr var → silme, arşivle (server.js ile aynı): hedef sabit kalır
        sw.status = "closed"; sw.qty = 0; sw.exitPrice = null; sw.archived = true;
        sw.closedAt = sw.closedAt || sw.realizedLots[sw.realizedLots.length - 1].date || new Date().toISOString().slice(0, 10);
      } else { trades = trades.filter((t) => t.id !== id); }
    }
    else if (req.method === "PUT") { let body = ""; for await (const c of req) body += c; const b = JSON.parse(body || "{}"); const t = trades.find((x) => x.id === id); if (t) Object.assign(t, b, { entry: b.entry != null ? +b.entry : t.entry }); }
    res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); return;
  }
  if (url.startsWith("/api/holdings/") && (req.method === "PUT" || req.method === "DELETE")) {
    const id = url.split("/").pop();
    const h = holdings.find((x) => x.id === id);
    if (req.method === "PUT") { let body = ""; for await (const c of req) body += c; const b = JSON.parse(body || "{}"); if (h) Object.assign(h, b); }
    else { const i = holdings.findIndex((x) => x.id === id); if (i >= 0) holdings.splice(i, 1); }
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(h || { ok: true })); return;
  }
  if (url === "/api/realize-override" && req.method === "PUT") {
    let body = ""; for await (const c of req) body += c; const b = JSON.parse(body || "{}");
    const sym = String(b.symbol || "").toUpperCase().trim(); const amt = Number(b.amountTRY);
    if (sym && isFinite(amt)) MOCK_OVR_EDIT[sym] = +amt.toFixed(2);
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(MOCK_OVR_EDIT)); return;
  }
  if (url.startsWith("/api/realize-override/") && req.method === "DELETE") {
    const sym = decodeURIComponent(url.split("/").pop()).toUpperCase().trim(); delete MOCK_OVR_EDIT[sym];
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(MOCK_OVR_EDIT)); return;
  }
  if (url.startsWith("/api/realized2026/") && req.method === "PUT") {
    const id = decodeURIComponent(url.split("/").pop());
    let body = ""; for await (const c of req) body += c; const b = JSON.parse(body || "{}");
    const amt = Number(b.amountTRY);
    if (id.startsWith("r26-truth-") && isFinite(amt)) MOCK_R26_EDITS[id] = +amt.toFixed(2);
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true })); return;
  }
  if (url.startsWith("/api/realized2026/") && req.method === "DELETE") {
    const id = decodeURIComponent(url.split("/").pop());
    if (id.startsWith("r26-truth-")) delete MOCK_R26_EDITS[id];
    res.writeHead(200, { "content-type": "application/json" }); res.end("[]"); return;
  }
  if (url === "/api/risk") {
    const pf = portfolioPayload();
    const stocks = (pf.holdings || []).filter((h) => h.type === "stock" && (h.live?.marketValueTRY || 0) > 0);
    const seed = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 997; return h / 997; };
    const totV = stocks.reduce((s, h) => s + (h.live.marketValueTRY / FX), 0) || 1;
    const pos = stocks.map((h) => {
      const sym = h.symbol.toUpperCase(); const s = seed(sym);
      const valueUSD = h.live.marketValueTRY / FX; const weightPct = +(valueUSD / totV * 100).toFixed(1);
      const vol = +(22 + s * 46).toFixed(1); const adr = +(3 + s * 5).toFixed(1); const beta = +(0.75 + s * 1.0).toFixed(2);
      const maxRiskUSD = Math.round(totV * 0.01); const suggestUSD = Math.round(maxRiskUSD / (adr / 100));
      return { symbol: sym, weightPct, valueUSD: Math.round(valueUSD), volAnnPct: vol, adrPct: adr, beta,
        rcPct: +(weightPct * (0.7 + s * 0.8)).toFixed(1), momo3mPct: +((s - 0.4) * 70).toFixed(1), momo6mPct: +((s - 0.35) * 120).toFixed(1),
        suggestUSD, suggestPct: +(suggestUSD / totV * 100).toFixed(1), maxRiskUSD };
    });
    const rcTot = pos.reduce((s, p) => s + p.rcPct, 0) || 1; pos.forEach((p) => p.rcPct = +(p.rcPct / rcTot * 100).toFixed(1));
    const syms = pos.map((p) => p.symbol);
    const matrix = syms.map((a, i) => syms.map((b, j) => i === j ? 1 : +(0.25 + seed(a < b ? a + b : b + a) * 0.55).toFixed(2)));
    let cs = 0, ck = 0; for (let i = 0; i < syms.length; i++) for (let j = i + 1; j < syms.length; j++) { cs += matrix[i][j]; ck++; }
    const avgCorr = ck ? +(cs / ck).toFixed(2) : 0; const portVolD = 0.018;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ asOf: new Date().toISOString(), lookback: 90, hasBenchmark: true,
      portfolio: { valueUSD: Math.round(totV), volAnnPct: +(portVolD * Math.sqrt(252) * 100).toFixed(1), beta: 1.18,
        var95USD: Math.round(1.645 * portVolD * totV), var95Pct: +(1.645 * portVolD * 100).toFixed(1), var99USD: Math.round(2.326 * portVolD * totV),
        histVar95USD: Math.round(1.8 * portVolD * totV), avgCorr, diversification: Math.round((1 - Math.max(0, avgCorr)) * 100) },
      positions: pos.sort((a, b) => b.rcPct - a.rcPct), correlation: { syms, matrix } }));
    return;
  }
  if (url.startsWith("/api/chart")) {
    const sym = ((req.url.split("symbol=")[1] || "NVDA").split("&")[0] || "NVDA").toUpperCase();
    let candles;
    if (REAL_CANDLES[sym]?.candles?.length) {
      candles = REAL_CANDLES[sym].candles;   // gerçek mumlar (Meydan Okuma doğru ölçülsün)
    } else {
      const closes = []; let p = 80; for (let i = 0; i < 150; i++) { p += p * (Math.sin(i / 9) * 0.012 + (Math.random() - 0.44) * 0.02); closes.push(+p.toFixed(2)); }
      candles = qCandles(closes, { adr: 5 });
    }
    const cl = candles.map((c) => c.close), price = cl[cl.length - 1];
    const smaS = (n) => candles.map((c, i) => i >= n - 1 ? { time: c.time, value: +(cl.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n).toFixed(2) } : null).filter(Boolean);
    const emaS = (n) => { const k = 2 / (n + 1); let e = null, s = 0; const o = []; candles.forEach((c, i) => { if (i < n) { s += c.close; if (i === n - 1) { e = s / n; o.push({ time: c.time, value: +e.toFixed(2) }); } } else { e = c.close * k + e * (1 - k); o.push({ time: c.time, value: +e.toFixed(2) }); } }); return o; };
    const payload = { symbol: sym, name: sym, price, asOf: Date.now(), candles,
      sma20: smaS(20), sma50: smaS(50), sma200: smaS(200), ema8: emaS(8), ema21: emaS(21),
      indicators: { sma20: smaS(20).at(-1)?.value, sma50: smaS(50).at(-1)?.value, sma200: smaS(200).at(-1)?.value, rsi: 58, atr: +(price * 0.03).toFixed(2), macd: {}, adx: {}, bb: {}, high20: Math.max(...cl.slice(-20)), low20: Math.min(...cl.slice(-20)), avgVol: 1e6, lastVol: 1.1e6 },
      levels: { support: [+(price * 0.95).toFixed(2)], resistance: [+(price * 1.05).toFixed(2)] },
      plan: { currentPrice: price }, patterns: {}, weekly: {}, why: [], signals: [], qm: qmAnalyze(candles, { price }),
      stats: { marketCap: 27.7e9, industry: "Specialty Telecommunications", exchange: "NASDAQ",
        adrPct: +(qmADR(candles, 20) || 5).toFixed(2), rsRating: 89,
        w52High: +Math.max(...cl).toFixed(2), w52Low: +Math.min(...cl).toFixed(2),
        dollarVol: price * 1e6, fromHighPct: +(((price - Math.max(...cl)) / Math.max(...cl)) * 100).toFixed(1) } };
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); return;
  }
  if (url === "/api/portfolio") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(portfolioPayload())); return; }
  if (url === "/api/qm") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(qmPayload())); return; }
  if (url.startsWith("/api/qm/") && url !== "/api/qm/history") {           // tek sembol giriş-kalitesi (Faz 2)
    const sym = url.split("/api/qm/")[1].toUpperCase();
    const candles = qCandles(qSetup(sym === "ZZZ" ? 200 : 50), { adr: 5, vol: 2e6 }); // ZZZ→zayıf testi
    const price = candles[candles.length - 1].close;
    const a = qmAnalyze(candles, { price });
    const passN = (a.checklist || []).filter((c) => c.pass).length;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ symbol: sym, name: sym, price, ok: a.ok, setup: a.setup, stage: a.stage, score: a.score,
      adrPct: a.adrPct, liquidity: a.liquidity, priorMovePct: a.priorMovePct, entryTrigger: a.entryTrigger,
      stop: a.stop, stopPct: a.stopPct, rTargets: a.rTargets, extendedOverMA10: a.extendedOverMA10,
      consolidation: a.consolidation, checklist: a.checklist || [], passN, passTotal: (a.checklist || []).length, reasons: a.reasons || [] }));
    return;
  }
  if (url === "/api/alerts" && req.method === "POST") {
    let body = ""; for await (const c of req) body += c; const b = JSON.parse(body || "{}");
    ALERTS.push({ id: "al-" + Date.now().toString(36), symbol: String(b.symbol || "").toUpperCase(), type: b.type, value: +b.value, note: "", createdAt: new Date().toISOString().slice(0, 10) });
    res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); return;
  }
  if (url.startsWith("/api/alerts/") && req.method === "DELETE") {
    const id = url.split("/").pop(); ALERTS = ALERTS.filter((x) => x.id !== id);
    res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); return;
  }
  if (url === "/api/alerts") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(ALERTS)); return; }
  if (url === "/api/benchmark") {
    const today = new Date();
    const mk = (start, end) => { const out = [], days = 70; for (let i = days; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); out.push({ date: d.toISOString().slice(0, 10), close: +(start + (end - start) * ((days - i) / days)).toFixed(2) }); } return out; };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ SPY: mk(560, 588), QQQ: mk(480, 516) })); // SPY +5%, QQQ +7.5%
    return;
  }
  if (url === "/api/qm/history") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ days: 21, firstDate: "2026-06-01", lastDate: "2026-06-22", totalPicks: 38,
      realized: { n: 14, winRate: 57, avgRet: 6.2, avgR: 0.84, target: 8, stop: 6 },
      open: { n: 9, avgRet: 3.1 }, expired: 15,
      recent: [
        { symbol: "SMCI", date: "2026-06-18", qmSetup: "breakout", status: "target", ret: 14.2, r: 2.0, exitDate: "2026-06-22" },
        { symbol: "APP", date: "2026-06-15", qmSetup: "ep", status: "target", ret: 11.8, r: 2.0, exitDate: "2026-06-20" },
        { symbol: "RKLB", date: "2026-06-12", qmSetup: "breakout", status: "stop", ret: -5.1, r: -1.0, exitDate: "2026-06-16" },
        { symbol: "HIMS", date: "2026-06-10", qmSetup: "breakout", status: "target", ret: 9.4, r: 2.0, exitDate: "2026-06-19" },
        { symbol: "NVDA", date: "2026-06-08", qmSetup: "breakout", status: "stop", ret: -4.7, r: -1.0, exitDate: "2026-06-11" },
      ] }));
    return;
  }
  if (url === "/api/chart") {
    const sym = (req.url.split("symbol=")[1] || "").split("&")[0].toUpperCase();
    const p = qmChartPayload(sym);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(p || { error: "mock: yalnız QM sembolleri (NVDA/SMCI/HIMS/CLS/RKLB/APP)" }));
    return;
  }
  if (url === "/api/radar") {
    const items = radarMockItems().sort((a, b) => b.score - a.score);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ updated: Date.now(), refreshing: false, groups: RADAR_GROUPS_MOCK, count: items.length, total: items.length, items })); return;
  }
  if (url === "/api/swing") {
    const items = swingMockItems();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ updated: Date.now(), refreshing: false, count: items.length, total: items.length, setups: items.filter((i) => i.setup).length, items })); return;
  }
  if (url === "/api/cuma") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(RADAR_MOCK_ROWS.filter((r) => r[8]).map((r) => ({ symbol: r[0], name: r[1] })))); return;
  }
  if (url in EMPTY) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(EMPTY[url])); return; }
  if (url === "/api/challenge" && req.method === "GET") {
    // Üretim paritesi: bilanço takvimi (AMD 2 gün sonra → karartma testi), sektörler
    // (yarıiletken kümesi → tavan testi), gerçek VIX (fixture) — client RAI/kural akışı tam görünür
    let vixArr = null;
    try { vixArr = JSON.parse(readFileSync(join(process.cwd(), "scripts", "rai-fixtures.json"), "utf8"))["^VIX"] || null; } catch {}
    const in2d = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ...CH_LEDGER,
      earnings: { AMD: in2d },
      sectors: { NVDA: "Semiconductors", AMD: "Semiconductors", MU: "Semiconductors", INTC: "Semiconductors", SNDK: "Semiconductors", TSLA: "Automobiles", SOFI: "Financial Services", NOW: "Technology" },
      vix: vixArr })); return;
  }
  if (url === "/api/challenge/open" && req.method === "POST") {
    let body = ""; for await (const c of req) body += c;
    const t = JSON.parse(body || "{}");
    if (t.id && !CH_LEDGER.trades.some((x) => x.id === t.id)) CH_LEDGER.trades.push(t);
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true })); return;
  }
  if (url.startsWith("/api/")) { res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); return; }
  // statik
  try {
    const f = url === "/" ? "/index.html" : url;
    const buf = await readFile(join(ROOT, f));
    res.writeHead(200, { "content-type": MIME[extname(f)] || "text/plain", "cache-control": "no-store" });
    res.end(buf);
  } catch { res.writeHead(404); res.end("not found"); }
});
server.listen(4321, () => console.log("mock on http://localhost:4321"));
