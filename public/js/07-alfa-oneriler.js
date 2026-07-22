/* 07-alfa-oneriler.js — Alfa Avı (RAI · rejim · pano · hedef merdiveni) · tetik şeridi · portföy önerileri · En Büyük 3
 * app.js'in SIRALI dilimi (bölme: 15 Tem 2026). Dosyalar index.html'deki sırayla yüklenir;
 * klasik script'ler global kapsamı paylaşır — sıra değiştirme, dosyayı IIFE'ye sarma. */
/* ====================== Alfa Avı — AI oyun-parası swing challenge (İLERİYE DÖNÜK) ======================
 * BUGÜNDEN itibaren canlı hesap: $1.500 nakit, gerçek portföyden BAĞIMSIZ. Yapay zekâ kuralına göre
 * SADECE tetik oluşunca pozisyon açar (asla stop'suz girmez), riske göre boyutlar (~%3/işlem), hedef/stop
 * ile bekler; hedef → sat (nakde), stop → kes (nakde), sonra yeni işlem. Strateji: Swing Momentum
 * (8/21/50 EMA) + Qullamaggie teyidi. Geçmiş "gir-çık" listesi yok — bugünden ileri gerçek mumlarla işler. */
const CHALLENGE = {
  startCapital: 1500, goal: 2500, startDate: "2026-07-01",
  // TP 22 Tem 2026'da 6/12 → 5/20 (server CH_ENG ile BİREBİR): ilk kârı %5'te al, kalanı trene bindir.
  // Eski işlemler sunucu defterinde donmuş TP'leriyle işler — burası yalnız YENİ girişleri etkiler.
  riskPct: 3, tp1: 5, tp2: 20, trailEma: "EMA21",
  minNotional: 350, maxNotional: 850,
  commission: 1.5, // Midas emir ücreti — alış + her satış emrinde düşülür (server ile birebir; sonuçlar NET)
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
  await chFetchCandles([CHALLENGE.indexSym, ...CHALLENGE.raiSyms]);
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

// TOPLU mum çek — tüm evreni TEK istekte sunucu önbelleğinden (66 gidiş-dönüş → 1).
// Zaten yüklenmiş sembolleri atlar; eksikleri sunucu arka planda ısıtır.
async function chFetchCandles(syms) {
  const need = [...new Set(syms.map((s) => String(s || "").toUpperCase()))].filter((s) => s && !CHALLENGE._sym[s]);
  if (!need.length) return { missing: [] };
  try {
    const r = await (await fetch(`/api/candles?symbols=${need.map(encodeURIComponent).join(",")}`)).json();
    const cand = r.candles || {};
    for (const [sym, v] of Object.entries(cand)) {
      if (!Array.isArray(v) || v.length < 60) continue;
      CHALLENGE._sym[sym] = { v, ema8: chEMA(v, 8), ema21: chEMA(v, 21), ema50: chEMA(v, 50), vma: chVMA(v, 20), idx: Object.fromEntries(v.map((c, i) => [c.time, i])) };
    }
    return { missing: r.missing || need.filter((s) => !cand[s]) };
  } catch { return { missing: need }; }
}

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
  CHALLENGE._universe = universe;
  // Tüm evren + endeks (QQQ) + RAI ETF'leri TEK toplu istekte
  const { missing } = await chFetchCandles([...universe, CHALLENGE.indexSym, ...CHALLENGE.raiSyms]);
  CHALLENGE._credit = chRatioSer(CHALLENGE._sym.HYG, CHALLENGE._sym.IEF);
  CHALLENGE._rot = chRatioSer(CHALLENGE._sym.XLY, CHALLENGE._sym.XLP);
  CHALLENGE.watch = universe.filter((s) => CHALLENGE._sym[s]); // sadece verisi olanlar
  // Soğuk semboller sunucuda ısınıyor (fresh deploy sonrası) → bir kez gecikmeli tazele
  if (missing.length && !CHALLENGE._topupDone) {
    CHALLENGE._topupDone = true;
    setTimeout(async () => {
      await chFetchCandles([...(CHALLENGE._universe || []), CHALLENGE.indexSym, ...CHALLENGE.raiSyms]);
      CHALLENGE._credit = chRatioSer(CHALLENGE._sym.HYG, CHALLENGE._sym.IEF);
      CHALLENGE._rot = chRatioSer(CHALLENGE._sym.XLY, CHALLENGE._sym.XLP);
      CHALLENGE.watch = (CHALLENGE._universe || []).filter((s) => CHALLENGE._sym[s]);
      renderChallenge(); renderHuntStrip();
    }, 9000);
  }
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
  const priorLeg = (c.close / Math.min(...v.slice(i - 40, i - 10).map((x) => x.close)) - 1) * 100;
  // QM giriş kalitesi: konsolidasyon öncesi ≥%10 momentum hamlesi şart (server chSrvSignal ile PARİTE).
  if (!(up && pullback && crossover && volOk && nearHigh && adr >= 3 && priorLeg >= 10)) return null;
  const stop = Math.max(Math.min(c.low, v[i - 1].low), c.close - 1.2 * (adr / 100) * c.close);
  return { sym, i, date: c.time, entry: c.close, stop, ema8: s.ema8[i], ema21: s.ema21[i], ema50: s.ema50[i], volRatio: c.volume / s.vma[i], adr, nearHighPct: (c.close / hi60 - 1) * 100, priorLeg };
}

// BUGÜNDEN ileri: $1.500 nakit ile kronolojik sim (tetikte aç, kademeli çıkış + iz süren stop)
function chRun() {
  const P = CHALLENGE, ts = P._sym[P.watch.find((s) => P._sym[s])];
  if (!ts) return { positions: [], equity: [], cash: P.startCapital };
  const dates = ts.v.map((c) => c.time).filter((d) => d >= P.startDate);
  let cash = P.startCapital; const positions = [], equity = [];
  const FEE = P.commission || 0; // her emirde: alış + her kısmi satış (net muhasebe, server ile aynı)
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
      if (c.low <= effStop) { const fr = p.rem, gap = c.open != null && c.open < effStop, px = gap ? c.open : effStop, pnl = fr * p.shares * (px - p.entry) - FEE; cash += fr * p.shares * px - FEE; p.fees = (p.fees || 0) + FEE; p.events.push({ d, k: gap ? "gap" : (p.stop >= p.entry && !p.tp1hit) ? "def" : p.tp1hit ? "be" : "stop", px, fr, pnl, fee: FEE }); p.realized += pnl; p.rem = 0; p.open = false; p.exitDate = d; continue; }
      if (!p.tp1hit && c.high >= p.tp1) { const fr = 0.25, pnl = fr * p.shares * (p.tp1 - p.entry) - FEE; cash += fr * p.shares * p.tp1 - FEE; p.fees = (p.fees || 0) + FEE; p.realized += pnl; p.rem -= fr; p.tp1hit = true; p.events.push({ d, k: "tp1", px: p.tp1, fr, pnl, fee: FEE }); }
      if (p.tp1hit && !p.tp2hit && c.high >= p.tp2) { const fr = 0.25, pnl = fr * p.shares * (p.tp2 - p.entry) - FEE; cash += fr * p.shares * p.tp2 - FEE; p.fees = (p.fees || 0) + FEE; p.realized += pnl; p.rem -= fr; p.tp2hit = true; p.events.push({ d, k: "tp2", px: p.tp2, fr, pnl, fee: FEE }); }
      if (p.open && p.rem > 0 && c.close < te) { const fr = p.rem, pnl = fr * p.shares * (c.close - p.entry) - FEE; cash += fr * p.shares * c.close - FEE; p.fees = (p.fees || 0) + FEE; p.realized += pnl; p.events.push({ d, k: "trail", px: c.close, fr, pnl, fee: FEE }); p.rem = 0; p.open = false; p.exitDate = d; }
      // Savunma modu (rejim off): kârdaki pozisyonun stopu başa-başa ratchet'lenir (bar sonu, tek yön yukarı)
      if (defensive && p.open && !p.tp1hit && c.close > p.entry) p.stop = Math.max(p.stop, p.entry);
    }
    const held = new Set(positions.filter((x) => x.open).map((x) => x.sym));
    // 1) O günün DONMUŞ açılışları — plan aynen uygulanır (immutable; evren değişse de kaymaz)
    for (const f of frozenByDate[d] || []) {
      if (held.has(f.sym) || positions.some((p) => p.id === f.id)) continue;
      const s = P._sym[f.sym]; const i = s ? s.idx[d] : null;
      const disp = (s && i != null ? chSignal(f.sym, i) : null) || {}; // sadece gerekçe metni için analitik
      cash -= f.notional + FEE;
      positions.push({ ...disp, id: f.id, sym: f.sym, date: f.date, entry: f.entry, stop: f.stop, tp1: f.tp1, tp2: f.tp2, notional: f.notional, shares: f.shares, frozen: true, rem: 1, tp1hit: false, tp2hit: false, realized: -FEE, fees: FEE, open: true, events: [] });
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
      if (cash < notional + FEE) continue;
      cash -= notional + FEE;
      const t = { ...sig, id, notional, shares: notional / sig.entry, tp1: sig.entry * (1 + P.tp1 / 100), tp2: sig.entry * (1 + P.tp2 / 100), rai: raiD ? raiD.score : null, rem: 1, tp1hit: false, tp2hit: false, realized: -FEE, fees: FEE, open: true, events: [] };
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
  const plan = `→ Giriş $${p.entry.toFixed(2)}, stop $${p.stop.toFixed(2)} (−%${riskPct.toFixed(1)}, risk ${fmtUSD0(p.initRisk || (p.shares * (p.entry - p.stop)))}), TP1 +%${CHALLENGE.tp1}, TP2 +%${CHALLENGE.tp2}, kalan ${CHALLENGE.trailEma} iz süren stop. Pozisyon ~${fmtUSD0(p.notional)}.${p.rsPct != null ? ` Göreli güç <b>RS %${p.rsPct}</b>${p.weakRs ? " (lider bandı altı → yarım boyut)" : ""}.` : ""}${p.rai != null ? ` Girişte risk iştahı <b>${p.rai}/100</b>.` : ""}${p.frozen ? ` <span class="ch-frozen" title="Sunucu defterine yazıldı — evren değişse de bu karar değişmez">🔒 defterde</span>` : ""}`;
  if (p.lane === "ep") // EP / haber trade'i — katalizör günü girişi (QM episodic pivot)
    return `<b>Giriş — neden?</b> <b>KATALİZÖR günü</b> (EP/haber şeridi): fiyat ${p.gapPct != null ? `<b>+%${p.gapPct}</b> boşluk/hamle yaptı` : "büyük boşluk/hamle yaptı"}, hacim 20g ortalamanın <b>${p.epVolR ?? "—"}×</b>'i — gün güçlü kapandı (gün içi satılmadı). QM episodic pivot kuralı: giriş kapanıştan, <b>stop günün dibinden</b>.${p.news ? `<br><b>Katalizör:</b> “${p.news}”` : ""} ${plan}`;
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
    if (e.k === "be") return li(`<span class="neu-c">Başa-baş stop</span> ${chFmtD(e.d)}: kalan %${(e.fr * 100).toFixed(0)} risksiz kapandı (${e.pnl != null && Math.abs(e.pnl) > 0.01 ? `${e.pnl >= 0 ? "+" : ""}${fmtUSD0(e.pnl)} — komisyon` : "±$0"}).`);
    if (e.k === "gap") return li(`<span class="loss-c">Gap ile stop</span> ${chFmtD(e.d)}: fiyat açılışta stopun <b>altında boşluk (gap)</b> yaptı — gerçek çıkış stop fiyatından DEĞİL, açılış $${e.px.toFixed(2)}'den (dürüst ölçüm, ${fmtUSD0(e.pnl)}).`);
    return li(`<span class="loss-c">Stop</span> ${chFmtD(e.d)}: stop $${e.px.toFixed(2)} deldi, kapatıldı (${fmtUSD0(e.pnl)}).`);
  }).join("");
  if (p.open) {
    const pct = ((p.mark - p.entry) / p.entry) * 100;
    return `<b>Durum — açık.</b> ${chFmtD(p.date)} girildi, %${(p.rem * 100).toFixed(0)} taşınıyor. Şu an $${p.mark.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%), etkin stop $${(p.tp1hit ? p.entry : p.stop).toFixed(2)}.${evs ? `<ul class="ch-ev">${evs}</ul>` : " "}Hedef/stop gerçek mumlarla otomatik ölçülür.`;
  }
  const pct = p.notional ? (p.realized / p.notional) * 100 : 0;
  const verdict = p.realized > 1 ? `<span class="win-c">KÂR</span>` : p.realized < -1 ? `<span class="loss-c">ZARAR</span>` : `<span class="neu-c">BAŞA-BAŞ</span>`;
  return `<b>Çıkış — neden?</b><ul class="ch-ev">${evs}</ul><b>Sonuç: ${verdict}</b> — net ${p.realized >= 0 ? "+" : ""}${fmtUSD0(p.realized)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% · ${p.R >= 0 ? "+" : ""}${p.R}R${p.fees ? ` · $${(+p.fees).toFixed(2)} komisyon düşülmüş` : ""}).`;
}

// Açık pozisyon için görsel fiyat merdiveni — stop · giriş · TP1 · TP2 tek eksende, canlı fiyat işaretçisi kayar.
// Sol (kırmızı) = risk bölgesi (giriş→stop), sağ (yeşil) = ödül bölgesi (giriş→hedefler). Vurulan hedefler ✓ ile işaretli.
function chLadder(p) {
  const lo = Math.min(p.stop, p.entry, p.mark), hi = Math.max(p.tp2, p.mark), span = (hi - lo) || 1;
  const at = (x) => Math.max(1.5, Math.min(98.5, ((x - lo) / span) * 100));
  const sA = at(p.stop), eA = at(p.entry), t1 = at(p.tp1), t2 = at(p.tp2), mA = at(p.mark);
  const up = p.mark >= p.entry, done1 = p.tp1hit, done2 = p.tp2hit;
  return `<div class="chl">
    <div class="chl-bar">
      <div class="chl-seg risk" style="left:${sA}%;width:${(eA - sA).toFixed(1)}%"></div>
      <div class="chl-seg reward" style="left:${eA}%;width:${(t2 - eA).toFixed(1)}%"></div>
      <span class="chl-t stop" style="left:${sA}%"></span>
      <span class="chl-t entry" style="left:${eA}%"></span>
      <span class="chl-t tp ${done1 ? "done" : ""}" style="left:${t1}%"></span>
      <span class="chl-t tp ${done2 ? "done" : ""}" style="left:${t2}%"></span>
      <span class="chl-now ${up ? "up" : "dn"}" style="left:${mA}%"><b>$${p.mark.toFixed(2)}</b></span>
    </div>
    <div class="chl-lg">
      <span class="chl-l stop"><i>🛑 STOP</i><b>${fmtUSD(p.stop)}</b></span>
      <span class="chl-l entry"><i>◆ GİRİŞ</i><b>${fmtUSD(p.entry)}</b></span>
      <span class="chl-l tp"><i>🎯 TP1${done1 ? " ✓" : ` +%${CHALLENGE.tp1}`}</i><b>${fmtUSD(p.tp1)}</b></span>
      <span class="chl-l tp"><i>🎯 TP2${done2 ? " ✓" : ` +%${CHALLENGE.tp2}`}</i><b>${fmtUSD(p.tp2)}</b></span>
    </div>
  </div>`;
}

// Kapanan işlem için KOMPAKT sonuç merdiveni — canlı fiyat yok; onun yerine çıkış işaretleri
// (nerede TP alındı 🟢, nerede stop/gap yendi 🔴, iz süren stop nerede kapandı) bar üzerinde işaretlenir.
function chLadderMini(p) {
  const evs = (p.events || []).filter((e) => e.px != null);
  const pxs = evs.map((e) => e.px);
  const lo = Math.min(p.stop, p.entry, p.tp1, p.tp2, ...pxs), hi = Math.max(p.stop, p.entry, p.tp1, p.tp2, ...pxs), span = (hi - lo) || 1;
  const at = (x) => Math.max(1.5, Math.min(98.5, ((x - lo) / span) * 100));
  const sA = at(p.stop), eA = at(p.entry), t1 = at(p.tp1), t2 = at(p.tp2);
  const evX = evs.map((e) => {
    const cl = (e.k === "tp1" || e.k === "tp2") ? "win" : (e.k === "stop" || e.k === "gap") ? "loss" : e.pnl > 0.5 ? "win" : e.pnl < -0.5 ? "loss" : "neu";
    return `<span class="chlm-x ${cl}" style="left:${at(e.px)}%" title="${e.k} · $${e.px.toFixed(2)} (${e.pnl >= 0 ? "+" : ""}${fmtUSD0(e.pnl)})"></span>`;
  }).join("");
  return `<div class="chl chl-mini">
    <div class="chl-bar">
      <div class="chl-seg risk" style="left:${sA}%;width:${(eA - sA).toFixed(1)}%"></div>
      <div class="chl-seg reward" style="left:${eA}%;width:${(t2 - eA).toFixed(1)}%"></div>
      <span class="chl-t stop" style="left:${sA}%"></span>
      <span class="chl-t entry" style="left:${eA}%"></span>
      <span class="chl-t tp ${p.tp1hit ? "done" : ""}" style="left:${t1}%"></span>
      <span class="chl-t tp ${p.tp2hit ? "done" : ""}" style="left:${t2}%"></span>
      ${evX}
    </div>
    <div class="chl-lg">
      <span class="chl-l stop"><i>🛑 STOP</i><b>${fmtUSD(p.stop)}</b></span>
      <span class="chl-l entry"><i>◆ GİRİŞ</i><b>${fmtUSD(p.entry)}</b></span>
      <span class="chl-l tp"><i>🎯 TP1${p.tp1hit ? " ✓" : ""}</i><b>${fmtUSD(p.tp1)}</b></span>
      <span class="chl-l tp"><i>🎯 TP2${p.tp2hit ? " ✓" : ""}</i><b>${fmtUSD(p.tp2)}</b></span>
    </div>
  </div>`;
}

/* Hedef Yolculuğu — $1.500'den merdiven: 2.500 → 5.000 → 10.000.
 * Varılan basamak tarihiyle kilitlenir (sunucu milestones); aktif basamakta ilerleme çubuğu +
 * mevcut tempoya göre DÜRÜST tahmin (günlük bileşik büyüme; garanti değil, motivasyon pusulası). */
function chGoalLadder(D, equityNow) {
  const start = new Date(CHALLENGE.startDate);
  const days = Math.max(0, Math.round((Date.now() - start) / 86400_000));
  const goals = (D.goals && D.goals.length ? D.goals : [2500, 5000, 10000]);
  const ms = D.milestones || {};
  const gRate = days >= 5 && equityNow > CHALLENGE.startCapital
    ? Math.pow(equityNow / CHALLENGE.startCapital, 1 / days) - 1 : null;
  let prevGoal = CHALLENGE.startCapital;
  let activeFound = false;
  const rows = goals.map((goal) => {
    const hit = ms[goal] ?? ms[String(goal)];
    if (hit) {
      const dHit = Math.max(1, Math.round((new Date(hit) - start) / 86400_000));
      prevGoal = goal;
      return `<div class="cg-row done"><span class="cg-ic">✓</span>
        <div class="cg-b"><b>${fmtUSD0(goal)}</b><span>${chFmtD(hit)} tarihinde · <b>${dHit} günde</b></span></div>
        <span class="cg-tag done">BAŞARILDI</span></div>`;
    }
    if (!activeFound) {
      activeFound = true;
      const base = prevGoal;
      const pct = Math.max(0, Math.min(100, ((equityNow - base) / (goal - base)) * 100));
      const eta = gRate && equityNow > 0 && equityNow < goal
        ? Math.ceil(Math.log(goal / equityNow) / Math.log(1 + gRate)) : null;
      return `<div class="cg-row active"><span class="cg-ic on">●</span>
        <div class="cg-b"><b>${fmtUSD0(goal)}</b>
          <div class="cg-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
          <span>şu an ${fmtUSD0(equityNow)} · %${pct.toFixed(0)} yolda${eta && eta < 3650 ? ` · bu tempoyla ~${eta} gün (tahmin, garanti değil)` : ""}</span></div>
        <span class="cg-tag on">SIRADAKİ</span></div>`;
    }
    return `<div class="cg-row locked"><span class="cg-ic">○</span>
      <div class="cg-b"><b>${fmtUSD0(goal)}</b><span>önce ${fmtUSD0(goals[goals.indexOf(goal) - 1])}</span></div>
      <span class="cg-tag">KİLİTLİ</span></div>`;
  }).join("");
  return `<div class="ch-goal cg-ladder">
    <div class="ch-goal-top"><span class="cg-t">Hedef Yolculuğu</span><span class="cg-day">Gün <b>${days}</b> · başlangıç ${fmtUSD0(CHALLENGE.startCapital)} (${chFmtD(CHALLENGE.startDate)})</span></div>
    ${rows}
  </div>`;
}

// SUNUCU-PANOSU: tek doğruluk kaynağı. Varsa sunucunun hesabından çizeriz (istemci/sunucu ayrışmaz),
// yoksa yerel motora (chLoad+chRun+chWatch) düşeriz — regresyon riski yok.
async function chLoadBoard() {
  try {
    const r = await fetch("/api/challenge/board");
    if (!r.ok) return null;
    const b = await r.json();
    if (!b || !Array.isArray(b.positions) || !Array.isArray(b.watch) || !b.regime) return null;
    return { positions: b.positions, cash: b.cash, watch: b.watch, regime: b.regime, rai: b.rai, universeCount: b.universeCount, vixReal: !!b.vixReal, goals: b.goals, milestones: b.milestones, rsMin: b.rsMin, commission: b.commission, source: "server" };
  } catch { return null; }
}
async function chLocalBoard(el) {
  if (!CHALLENGE._loaded) {
    el.innerHTML = `<div class="rk-empty">Alfa Avı — Radar + Swing evreni toplanıyor, kurulumlar gerçek mumlarda taranıyor…</div>`;
    await chLoad(); CHALLENGE._loaded = true;
  }
  const { positions, cash } = chRun();
  return { positions, cash, watch: chWatch(new Set(positions.filter((p) => p.open).map((p) => p.sym))), regime: chRegimeToday(), rai: chRaiToday(), universeCount: CHALLENGE.watch.length, vixReal: !!CHALLENGE._vixSer, source: "client" };
}

async function renderChallenge() {
  const el = $("#challengeBox"); if (!el) return;
  const D = (await chLoadBoard()) || (await chLocalBoard(el));
  const positions = D.positions, cash = D.cash;
  const closed = positions.filter((p) => !p.open), open = positions.filter((p) => p.open);
  const realized = positions.reduce((s, p) => s + p.realized, 0);
  const unreal = open.reduce((s, p) => s + (p.unreal || 0), 0);
  const equityNow = CHALLENGE.startCapital + realized + unreal;
  const cashNow = (cash != null ? cash : CHALLENGE.startCapital);
  const wins = closed.filter((p) => p.realized > 1), losses = closed.filter((p) => p.realized < -1);
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const totPct = (equityNow / CHALLENGE.startCapital - 1) * 100;

  const setup = (p) => p?.lane === "ep"
    ? `<span class="ch-setup ep" title="Episodic pivot / haber trade'i — katalizör günü girişi (QM)">EP · HABER</span>`
    : `<span class="ch-setup brk">EMA 8/21/50</span><span class="ch-setup pb">QM</span>`;

  // OPEN kartları — görsel fiyat merdiveni + belirgin seviyeler + katlanır gerekçe
  const openCards = open.length ? open.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).map((p) => {
    const pct = ((p.mark - p.entry) / p.entry) * 100;
    const nextTgt = p.tp1hit ? p.tp2 : p.tp1, nextLbl = p.tp1hit ? `TP2 +%${CHALLENGE.tp2}` : `TP1 +%${CHALLENGE.tp1}`;
    const effStop = p.tp1hit ? p.entry : p.stop;
    const toTgt = ((nextTgt - p.mark) / p.mark) * 100, toStop = ((effStop - p.mark) / p.mark) * 100;
    return `
    <div class="ch-card open ch-pos" data-chsym="${p.sym}" title="Grafiği aç — ${p.sym}">
      <div class="ch-card-top"><div class="ch-card-sym"><b>${p.sym}</b> ${setup(p)}</div>
        <div class="ch-card-r"><span class="ch-pill open">Açık</span><span class="ch-card-pnl ${cls(p.unreal)}">${p.unreal >= 0 ? "+" : ""}${fmtUSD0(p.unreal)}</span><span class="ch-card-rr ${cls(p.R)}">${p.R >= 0 ? "+" : ""}${p.R}R</span></div></div>
      <div class="ch-card-dt">${chFmtD(p.date)} → açık · ~${fmtUSD0(p.notional)} pozisyon · %${(p.rem * 100).toFixed(0)} taşınıyor${p.initRisk ? ` · risk ${fmtUSD0(p.initRisk)}` : ""}${Math.abs(p.realized) > (D.commission ?? 1.5) + 0.5 ? ` · realize <b class="${cls(p.realized)}" title="komisyonlar düşülmüş net">${p.realized >= 0 ? "+" : ""}${fmtUSD0(p.realized)}</b>` : ""}</div>
      ${chLadder(p)}
      <div class="ch-dist">
        <span class="cd now ${pct >= 0 ? "up" : "dn"}">${pct >= 0 ? "▲" : "▼"} Şimdi <b>${fmtUSD(p.mark)}</b> · ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%</span>
        <span class="cd tp">🎯 ${nextLbl} <s>+${Math.max(0, toTgt).toFixed(1)}% uzak</s></span>
        <span class="cd stop">🛑 stop <s>${toStop.toFixed(1)}% uzak</s></span>
      </div>
      ${(() => { // detaylı canlı durum: değer · anlık K/Z · canlı R · gün · stop/TP2 senaryoları
        const fee = D.commission ?? CHALLENGE.commission ?? 0; // son satış emrinin komisyonu senaryoya dahil
        const posVal = p.rem * p.shares * p.mark;
        const costRem = p.rem * p.shares * p.entry;
        const upct = costRem ? (p.unreal / costRem) * 100 : 0;
        const liveR = p.initRisk ? (p.realized + p.unreal) / p.initRisk : null;
        const days = Math.max(0, Math.round((Date.now() - new Date(p.date)) / 86400000));
        const wc = p.realized + p.rem * p.shares * (effStop - p.entry) - fee; // stopta kapanırsa net sonuç
        const bc = p.realized + p.rem * p.shares * (p.tp2 - p.entry) - fee;   // kalan TP2'den satılırsa net
        const cell = (l, v, c) => `<span class="cs"><i>${l}</i><b class="${c || ""}">${v}</b></span>`;
        return `<div class="ch-stats">
          ${cell("Değer", fmtUSD0(posVal))}
          ${cell("Anlık K/Z", `${p.unreal >= 0 ? "+" : ""}${fmtUSD0(p.unreal)} · ${upct >= 0 ? "+" : ""}${upct.toFixed(1)}%`, cls(p.unreal))}
          ${cell("Canlı R", liveR != null ? `${liveR >= 0 ? "+" : ""}${liveR.toFixed(2)}R` : "—", liveR != null ? cls(liveR) : "")}
          ${cell("Gün", String(days))}
          ${p.rsPct != null ? cell("RS", `%${p.rsPct}${p.weakRs ? " · yarım" : ""}`, p.weakRs ? "" : p.rsPct >= 70 ? "win-c" : "") : ""}
          ${cell("Stop senaryosu", `${wc >= 0 ? "+" : ""}${fmtUSD0(wc)}`, cls(wc))}
          ${cell("TP2 senaryosu", `${bc >= 0 ? "+" : ""}${fmtUSD0(bc)}`, cls(bc))}
        </div>`;
      })()}
      <details class="ch-det"><summary>Gerekçe & durum <span class="ch-det-h">giriş nedeni · olaylar · plan</span></summary>
        <div class="ch-why">${chEntryWhy(p)}</div><div class="ch-why">${chExitWhy(p)}</div></details>
    </div>`;
  }).join("") : "";

  // İZLEME LİSTESİ (kurulum oluşuyor mu?) — trend dışılar tek satırda toplanır (evren geniş)
  const wl = D.watch;
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

  const regNow = D.regime;
  const regBadge = regNow.state === "off"
    ? `<div class="ch-regime off">⛔ <b>Rejim filtresi: YENİ GİRİŞ KAPALI.</b> ${regNow.txt}. <b>İstisna:</b> güçlü katalizör günü (EP/haber şeridi) yarım boyutla girebilir — zayıf piyasada göreli güç en net orada görünür.${open.length ? ` <b>🛡 Savunma modu:</b> açık ${open.length} pozisyonda kârdakilerin stopu başa-başa kilitlendi (hedeften önce zorla çıkış yok, ama piyasa dönerse kâr korunuyor).` : ""} Koşullar düzelince girişler otomatik açılır.</div>`
    : regNow.state === "caution"
      ? `<div class="ch-regime warn">🟡 <b>Rejim uyarısı:</b> ${regNow.txt}. Yeni girişler yarım boyutla açılır.</div>`
      : `<div class="ch-regime on">🟢 <b>Rejim sağlıklı:</b> ${regNow.txt}.</div>`;
  // ── Risk İştahı Endeksi paneli — 5 bileşen, günlük; kural: <30 giriş yok · 30-44 yarım boyut ──
  const rai = regNow.rai;
  const raiPanel = rai ? (() => {
    const band = chRaiBand(rai.score);
    const [lbl, expl] = chRaiBandTR[band];
    const tone = band === "riskon" ? "on" : band === "notr" ? "neu" : band === "temkin" ? "warn" : "off";
    const compLbl = { trend: "Endeks trendi · QQQ", vol: D.vixReal ? "Volatilite · VIX (FRED)" : "Volatilite · VIXY", credit: "Kredi iştahı · HYG/IEF", rot: "Rotasyon · XLY/XLP", breadth: "Genişlik · evren" };
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
    <div class="ch-strat">Strateji: <b>Swing Momentum (8/21/50 EMA)</b> + <b>Qullamaggie</b> teyidi · <b>bugünden ileri</b> canlı hesap · evren: <b>Radar + Swing defteri (${D.universeCount} hisse)</b> · sadece tetikte açar (asla stop'suz değil) · riske göre ~%${CHALLENGE.riskPct}/işlem · kademeli kâr-al (TP1 +%${CHALLENGE.tp1}/TP2 +%${CHALLENGE.tp2}, sonra ${CHALLENGE.trailEma} iz süren stop) · <b>rejim kapısı: QQQ &lt; EMA21 veya risk iştahı &lt; 30 → giriş yok</b> · aynı gün çok tetikte <b>göreli güç</b> önce · <b>bilanço karartması</b>: bilançoya ≤3 gün kala giriş yok · <b>sektör tavanı</b>: sektör başına 1 pozisyon · <b>komisyon</b>: emir başına $${(D.commission ?? CHALLENGE.commission).toFixed(2)} (alış + her satış, Midas) — tüm rakamlar net.</div>
    ${raiPanel}
    ${regBadge}
    <div class="ch-kpis">
      <div class="ch-kpi hero"><div class="ch-k-l">SERMAYE</div><div class="ch-k-v">${fmtUSD0(equityNow)}</div>
        <div class="ch-k-s ${cls(equityNow - CHALLENGE.startCapital)}">${equityNow - CHALLENGE.startCapital >= 0 ? "▲ +" : "▼ "}${fmtUSD0(equityNow - CHALLENGE.startCapital)} · ${totPct >= 0 ? "+" : ""}${totPct.toFixed(1)}% · başlangıç ${fmtUSD0(CHALLENGE.startCapital)}</div></div>
      <div class="ch-kpi"><div class="ch-k-l">NAKİT</div><div class="ch-k-v">${fmtUSD0(cashNow)}</div><div class="ch-k-s">${open.length} açıkta ${fmtUSD0(open.reduce((s, p) => s + (p.notional || 0), 0))}</div></div>
      <div class="ch-kpi"><div class="ch-k-l">REALİZE K/Z</div><div class="ch-k-v ${cls(realized)}">${realized >= 0 ? "+" : ""}${fmtUSD0(realized)}</div><div class="ch-k-s">${closed.length} kapanan${closed.length ? ` · %${winRate.toFixed(0)} isabet` : ""}</div></div>
      <div class="ch-kpi"><div class="ch-k-l">AÇIK POZİSYON</div><div class="ch-k-v">${open.length}</div><div class="ch-k-s">${unreal >= 0 ? "+" : ""}${fmtUSD0(unreal)} açık K/Z</div></div>
    </div>
    ${chGoalLadder(D, equityNow)}

    <div class="ch-h ch-h-tbl">Açık pozisyonlar <span class="ch-sub">gerçek fiyatla canlı · hedef/stop otomatik</span></div>
    ${open.length ? `<div class="ch-jrnl">${openCards}</div>` : `<div class="ch-empty-box">Şu an açık pozisyon yok. Sistem <b>tetik</b> bekliyor — kural olmadan (stop'suz) girmez. Aşağıdaki izleme listesi hangi hisselerin kuruluma yaklaştığını gösterir.</div>`}

    <div class="ch-h ch-h-tbl">İzleme listesi — kurulum oluşuyor mu? <span class="ch-sub">tetik = EMA8'i hacimle geri almak · sonra otomatik giriş</span></div>
    <div class="tbl-wrap"><table class="ch-table wl-table"><thead><tr><th class="l">Sembol</th><th>Durum</th><th>Fiyat</th><th>Tetiğe Uzaklık</th><th>Plan (giriş·stop·hedef)</th><th>~Pozisyon</th><th class="l">Neden bekliyor?</th></tr></thead><tbody>${wlRows}</tbody></table></div>
    ${wlOffLine}

    ${closed.length ? `<div class="ch-h ch-h-tbl">Kapanan işlemler — gerekçeli <span class="ch-sub">bugünden beri</span></div>
    <div class="ch-jrnl">${closed.slice().sort((a, b) => new Date(b.exitDate) - new Date(a.exitDate)).map((p) => {
      const st = p.realized > 1 ? "win" : p.realized < -1 ? "loss" : "neu";
      const pill = st === "win" ? `<span class="ch-pill win">Kâr</span>` : st === "loss" ? `<span class="ch-pill loss">Zarar</span>` : `<span class="ch-pill neu">Başa-baş</span>`;
      const pct = p.notional ? (p.realized / p.notional) * 100 : 0;
      return `<div class="ch-card ${st} ch-pos" data-chsym="${p.sym}" title="Grafiği aç — ${p.sym}">
        <div class="ch-card-top"><div class="ch-card-sym"><b>${p.sym}</b> ${setup(p)}</div><div class="ch-card-r">${pill}<span class="ch-card-pnl ${cls(p.realized)}">${p.realized >= 0 ? "+" : ""}${fmtUSD0(p.realized)}</span><span class="ch-card-rr ${cls(p.R)}">${p.R >= 0 ? "+" : ""}${p.R}R</span></div></div>
        <div class="ch-card-dt">${chFmtD(p.date)} → ${chFmtD(p.exitDate)} · ~${fmtUSD0(p.notional)} pozisyon · sonuç ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%</div>
        ${chLadderMini(p)}
        <details class="ch-det"><summary>Gerekçe & durum <span class="ch-det-h">giriş nedeni · çıkış olayları</span></summary>
          <div class="ch-why">${chEntryWhy(p)}</div><div class="ch-why">${chExitWhy(p)}</div></details></div>`;
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
// Sade dille "bu ne demek?" açıklaması — tür + başlık kalıbına göre (karta tıklayınca açılır)
const RI_EXPLAIN = {
  risk: "Sermayeni tehdit eden bir durum. Kural 1 (para kaybetme) burada devreye girer: planını uygula — ya çık ya küçült. Borsada en pahalı cümle 'belki döner'dir; zarar büyümeden aksiyon al.",
  "kar-al": "Pozisyon kâr-al bölgesine geldi. Bir kısmını (%25–33) satıp kârı cebe koy, kalanı trende bırak. Böylece hem kazancı realize edersin hem yukarı potansiyeli kaçırmazsın (ana parayı çek, kârı bedava bırak felsefen).",
  firsat: "Teknik bir alım/ekleme sinyali — fırsat OLABİLİR, garanti değil. Fiyat kısa vadede aşırı düşmüş olabilir ve bir tepki yükselişi gelebilir. Girersen mutlaka stop ile gir; olasılık oynuyoruz, kesinlik değil.",
  denge: "Portföyünün çok büyük kısmı tek bir hisseye bağlı. O hisse kötü bir haber alırsa TÜM portföyün sarsılır — 'çok hisse ama tek bahis' tuzağı. Kademeli azaltıp riski birkaç pozisyona yay.",
  rejim: "Piyasanın genel havası (VIX = korku endeksi). Sakinken (düşük VIX) nakit oranın düşük olabilir; gerginken nakit hem sigorta hem alım gücüdür. Öneri: hedef nakit bandına göre pozisyonunu ayarla.",
};
function riExplain(x) {
  const t = (x.title || "").toLowerCase();
  if (/iz süren stop/.test(t)) return "Fiyat, kârını koruyan 'iz süren stop' çizgisinin altına indi. Bu çizgi kâr arttıkça yukarı taşınan otomatik bir koruma seviyesidir; altına inmesi trendin zayıfladığına işarettir. Planına göre azalt ya da çık — kazandığın kârı geri verme.";
  if (/zararda/.test(t)) return "Pozisyon, maliyetine göre derin zararda. Kendine sor: bu hisseyi neden aldın (tezin) hâlâ geçerli mi? Bozulduysa çık; bozulmadıysa net bir stop belirle ve ZARARDAYKEN ekleme yapma (ortalama düşürme tuzağı).";
  if (/aşırı sat|sıçrama/.test(t)) return "RSI göstergesi çok düşük — hisse kısa vadede aşırı satılmış. Böyle noktalardan genelde teknik bir tepki (sıçrama) gelebilir. Bu bir OLASILIK, kesinlik değil; girersen stop ile gir, küçük başla.";
  if (/kurulum/.test(t)) return "Teknik bir alım kurulumu oluşmuş (parantez içindeki harf güven derecesi: A en güçlü, C zayıf). Trend + geri çekilme + kırılım gibi şartların hizalandığı anlamına gelir. Yine de tetik ve stop ile hareket et.";
  if (/yoğunlaş|portföyün %/.test(t)) return RI_EXPLAIN.denge;
  if (/kâr-al|kar al|azalt/.test(t)) return RI_EXPLAIN["kar-al"];
  return RI_EXPLAIN[x.kind] || "";
}
function renderRule1() { // panel: "Portföy Önerileri" (#rule1Panel id'si korunur)
  const el = $("#rule1Panel");
  if (!el) return;
  const ins = STATE?.insights;
  if (!ins || !ins.items) { el.innerHTML = ""; return; }
  const cards = ins.items.map((x) => {
    const k = RI_KIND[x.kind] || RI_KIND.denge;
    const exp = riExplain(x);
    return `<div class="ri-card ${k.cls}" role="button" tabindex="0" aria-expanded="false">
      <div class="ri-card-top"><span class="ri-tag">${k.lbl}</span>${exp ? `<span class="ri-q" aria-hidden="true">ⓘ ne demek?</span>` : ""}</div>
      <b class="ri-title">${x.title}</b>
      ${x.detail ? `<span class="ri-detail">${x.detail}</span>` : ""}
      ${x.action ? `<span class="ri-act">→ ${x.action}</span>` : ""}
      ${exp ? `<div class="ri-explain"><b>Bu ne demek?</b> ${exp}</div>` : ""}
    </div>`;
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
            <span class="chart-sub">Önce risk, sonra fırsat · her kartın üstüne tıkla → ne demek olduğunu açar</span>
          </div>
        </div>
        <div class="r1-score ${tone}"><span class="r1-num">${ins.score}</span><span class="r1-lbl">/100</span></div>
      </div>
      <div class="panel-body">
      ${ins.items.length
        ? `<div class="ri-grid">${cards}</div>`
        : `<div class="r1-clean">✓ Belirgin bir aksiyon yok — pozisyonların stop'lu ve dengeli. İzlemede kal.</div>`}
      </div>
    </section>`;
  // Karta tıkla → açıklamayı aç/kapat (bir kez delege; re-render'da innerHTML değişse de el sabit)
  if (!el._riBound) {
    el._riBound = true;
    el.addEventListener("click", (ev) => {
      const c = ev.target.closest(".ri-card");
      if (!c || !c.querySelector(".ri-explain")) return;
      const open = c.classList.toggle("open");
      c.setAttribute("aria-expanded", open ? "true" : "false");
    });
    el.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      const c = ev.target.closest(".ri-card");
      if (!c || !c.querySelector(".ri-explain")) return;
      ev.preventDefault();
      const open = c.classList.toggle("open");
      c.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }
}

/* ====================== Risk Bütçesi — aylık zarar freni (Genel Bakış) ============
 * Sunucu hesaplar (/api/risk-budget): bütçe = ay başı sermayenin %X'i; tüketim =
 * ay içi net realize zarar + stoplu pozisyonların açık riski. Burada yalnız gösterim
 * + yüzde ayarı vardır. Dolunca "yeni giriş yok" freni görünür (öneri, emir değil). */
let RBUD = { d: null, t: 0 };
async function renderRiskBudget(force) {
  const el = $("#riskBudgetPanel");
  if (!el) return;
  try {
    if (force || !RBUD.d || Date.now() - RBUD.t > 5 * 60_000) {
      RBUD.d = await (await fetch("/api/risk-budget")).json();
      RBUD.t = Date.now();
    }
  } catch { return; }
  const r = RBUD.d;
  if (!r || r.error || !(r.budget > 0)) { el.innerHTML = ""; return; }
  const pctFill = Math.max(0, Math.min(100, r.ratio));
  const tone = r.level === "full" ? "full" : r.level === "warn" ? "warn" : r.level === "watch" ? "watch" : "ok";
  const msg = r.level === "full"
    ? `<div class="rbud-brake">🧯 Bütçe doldu — bu ay <b>yeni swing girişi önerilmez</b>. Mevcutları planına göre yönet, stopları koru (Kural 1).</div>`
    : r.level === "warn"
    ? `<div class="rbud-brake soft">⚠ Bütçenin %${Math.round(r.ratio)}'i dolu — yeni girişte pozisyonu küçült ya da bekle.</div>`
    : "";
  const rows = (r.rows || []).slice(0, 5).map((x) =>
    `<span class="rbud-row"><b>${x.sym}</b> ${fmtUSD0(x.risk)}<i>${x.kind === "swing" ? "swing" : "uzun vade"}</i></span>`).join("");
  el.innerHTML = `
    <section class="panel rbud-panel">
      <div class="panel-head">
        <div>
          <h2>${svgIcon("shield", "h2-ic")}Risk Bütçesi <span class="sw-chip">${r.ym}</span> ${tipIcon("Aylık kayıp bütçesi: ay başı sermayenin %" + r.pct + "'i. Tüketim = ay içi net realize zarar + stoplu pozisyonların stopa mesafesi (açık risk). Stopsuz uzun vadeler dahil değildir — onların riski tez bazlıdır. Bütçe dolunca ay sonuna kadar yeni giriş önerilmez: kötü ay felakete dönmesin (Kural 1). Öneridir, emir değil.")}</h2>
          <span class="chart-sub">Kural 1 freni · bütçe ${fmtUSD0(r.budget)} (sermayenin %${r.pct}'i) — <b class="${r.level === "ok" ? "pos" : r.level === "full" ? "neg" : ""}">${fmtUSD0(r.left)} kaldı</b></span>
        </div>
        <button class="btn icon" id="rbudCfgBtn" title="Bütçe yüzdesini değiştir">${svgIcon("settings", "ic-sm") || "⚙"}</button>
      </div>
      <div class="rbud-bar"><i class="rbud-fill ${tone}" style="width:${pctFill.toFixed(1)}%"></i>
        <span class="rbud-mark m80" title="%80 uyarı eşiği"></span></div>
      <div class="rbud-split">
        <span>Realize zarar <b class="${r.lossUsed > 0 ? "neg" : ""}">${fmtUSD0(r.lossUsed)}</b>${r.realizedNet > 0 ? ` <i class="rbud-net">(ay net +${fmtUSD0(r.realizedNet)} — bütçe yemiyor)</i>` : ""}</span>
        <span>Açık stop riski <b>${fmtUSD0(r.openRisk)}</b></span>
        <span class="rbud-pct ${tone}">%${Math.round(r.ratio)}</span>
      </div>
      ${rows ? `<div class="rbud-rows">${rows}</div>` : ""}
      ${msg}
      <form class="rbud-cfg" id="rbudCfgForm" hidden>
        <label>Bütçe (sermayenin %'i) <input type="number" name="pct" min="0.5" max="10" step="0.5" value="${r.pct}" /></label>
        <button class="btn primary sm" type="submit">Kaydet</button>
      </form>
    </section>`;
  if (!el._rbudBound) {
    el._rbudBound = true;
    el.addEventListener("click", (ev) => {
      if (ev.target.closest("#rbudCfgBtn")) {
        const f = $("#rbudCfgForm");
        if (f) f.hidden = !f.hidden;
      }
    });
    el.addEventListener("submit", async (ev) => {
      if (!ev.target.closest("#rbudCfgForm")) return;
      ev.preventDefault();
      const pct = Number(new FormData(ev.target).get("pct"));
      try {
        const rr = await fetch("/api/risk-budget", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pct }) });
        if (!rr.ok) throw new Error((await rr.json()).error || "kaydedilemedi");
        toast("Risk bütçesi güncellendi");
        renderRiskBudget(true);
      } catch (e) { toast(e.message || "kaydedilemedi", "err"); }
    });
  }
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
    const tgtBlock = (() => {
      const price = p.priceUSD;
      if (price == null) return "";
      const tp1 = price * 1.10, tp2 = price * 1.20;
      const hasTgt = p.targetMean != null && p.upsidePct != null;
      return `<div class="tp-target">
        <div class="tp-h">Hedef &amp; kâr-al seviyeleri</div>
        ${hasTgt ? `<div class="tp-trow tp-tgt"><span>Analist hedefi</span><b>${fmtUSD(p.targetMean)} <span class="pill ${cls(p.upsidePct)}" title="analist hedefine potansiyel">${p.upsidePct >= 0 ? "+" : ""}${p.upsidePct.toFixed(0)}%</span></b></div>` : ""}
        <div class="tp-trow"><span>Kâr-al 1 · %25 sat</span><b>${fmtUSD(tp1)} <span class="pill pos">+10%</span></b></div>
        <div class="tp-trow"><span>Kâr-al 2 · %25 sat</span><b>${fmtUSD(tp2)} <span class="pill pos">+20%</span></b></div>
        ${p.costUSD != null
          ? `<div class="tp-tnote">Maliyetin <b>${fmtUSD(p.costUSD)}</b> · şu an <b class="${cls(p.gainPct)}">${p.gainPct >= 0 ? "+" : ""}${(p.gainPct || 0).toFixed(1)}%</b> — kademelerde kısmi sat, kalanı trende bırak (kâr cebe, potansiyel açık).</div>`
          : `<div class="tp-tnote">Kademeli kâr-al: fiyat yükseldikçe bir kısmını sat, kalanı trende bırak — hem kâr realize hem yukarı açık kalır.</div>`}
      </div>`;
    })();
    return `<div class="tp-card">
      <div class="tp-head">
        <div><span class="tp-sym">${p.symbol}</span> <span class="tp-w">%${p.weightPct} portföy</span></div>
        <div class="tp-price">${fmtUSD(p.priceUSD)}${dc != null ? ` <span class="chip ${cls(dc)}">${fmtPct(dc)}</span>` : ""}</div>
      </div>
      <div class="tp-meta"><span class="chip ${recoCls}">Analist: ${recoLbl}${p.recoTotal ? ` · ${p.recoTotal}` : ""}</span>${p.rsi != null ? `<span class="tp-rsi">RSI ${p.rsi}</span>` : ""}</div>
      ${tgtBlock}
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


/* ====================== Strateji Laboratuvarı (Alfa Avı sekmesi) ======================
 * Sunucudaki kum-havuzu backtest'ini sürer (POST /api/lab/backtest). Deftere yazmaz;
 * baseline (canlı kurallar) ile varyant aynı pencerede koşulur, yan yana kıyaslanır. */
let LAB_BUSY = false;
/* Hazır ayarlar — her biri formu doldurur. Canlı kural 22 Tem 2026'dan beri TP 5/20
 * (60-hisse canlı taraması: iki yarıda artı, DD −33→−27; kanıt değil tutarlı eğilim). */
const LAB_PRESETS = {
  canli: { ad: "Canlı kurallar", ikon: "🟢", tip: "Alfa Avı'nın bugünkü kuralları (22 Tem'den beri TP 5/20: ilk kârı erken al, kalanı trene bindir) — kıyas çizgisi.",
    v: { tp1: 5, tp2: 20, riskPct: 3, commission: 1.5, rsMode: "half", rsMin: 30, ep: true, regimeGate: true, regimeBE: true } },
  eski: { ad: "Eski kurallar (6/12)", ikon: "🕰", tip: "22 Tem'e kadar canlı olan TP 6/12 — yeni kural gerçekten önde mi diye ara sıra buna karşı koştur.",
    v: { tp1: 6, tp2: 12, riskPct: 3, commission: 1.5, rsMode: "half", rsMin: 30, ep: true, regimeGate: true, regimeBE: true } },
  koruma: { ad: "Düşüş modu", ikon: "🐢", tip: "Kaybederken oynanan mod: risk küçülür (%2), zayıf hisse eşiği sıkılır. Amaç kazanmak değil, kötü dönemi ucuz atlatmak.",
    v: { tp1: 5, tp2: 12, riskPct: 2, commission: 1.5, rsMode: "half", rsMin: 50, ep: true, regimeGate: true, regimeBE: true } },
  serbest: { ad: "Filtresiz", ikon: "🔬", tip: "Tüm korumalar kapalı — filtrelerin toplam ne kadar iş yaptığını GÖRMEK için. Canlıya almak için değil.",
    v: { tp1: 5, tp2: 20, riskPct: 3, commission: 1.5, rsMode: "off", rsMin: 30, ep: true, regimeGate: false, regimeBE: false } },
};
function labSetForm(v) {
  const f = $("#labForm"); if (!f) return;
  for (const [k, val] of Object.entries(v)) {
    const el = f.elements[k]; if (!el) continue;
    if (el.type === "checkbox") el.checked = !!val; else el.value = val;
  }
}
function labInit() {
  const box = $("#labBox");
  if (!box || box.dataset.ready) return;
  box.dataset.ready = "1";
  const yardim = (t) => `<em class="lab-help">${t}</em>`;
  box.innerHTML = `
    <div class="lab-intro">
      <p><b>Burası kum havuzu:</b> "kural şöyle olsaydı ne olurdu?" sorusunu geçmiş üzerinde dener.
      Deftere yazmaz, canlıyı değiştirmez. Her koşu <b>canlı kurallarla yan yana</b> ölçülür.</p>
      <details class="lab-nasil"><summary>Nasıl okurum? (30 saniye)</summary>
        <ol>
          <li><b>Ortalama R</b> tek önemli sayıdır: işlem başına, riske ettiğinin kaç katı kazanıldı. +0.3R = her işlemde ortalama riskin %30'u kazanılıyor.</li>
          <li>Getiri yüzdesine tek başına inanma — <b>risk %'si büyükse getiri kaldıraçtan da şişer</b>, beceriden değil.</li>
          <li>Alttaki <b>fark aralığı 0'ı içeriyorsa</b> "daha iyi" diyemeyiz; veri yetmiyordur.</li>
          <li><b>Walk-forward</b>: ayar pencerenin iki yarısında da önde mi? Tek yarıda öndeyse büyük olasılıkla o döneme uydurulmuştur.</li>
        </ol>
      </details>
    </div>
    <div class="lab-presets" id="labPresets">
      <span class="lab-preset-lbl">Hazır ayar:</span>
      ${Object.entries(LAB_PRESETS).map(([k, p]) =>
        `<button type="button" class="lab-preset" data-preset="${k}" title="${p.tip}">${p.ikon} ${p.ad}</button>`).join("")}
    </div>
    <div class="lab-preset-tip" id="labPresetTip" hidden></div>
    <form class="lab-form lab-form2" id="labForm">
      <div class="lab-sec"><span class="lab-sec-t">📅 Pencere</span>
        <label class="lab-f"><i>Başlangıç</i>
          <select name="start">
            <option value="2025-07-01">Tem 2025 (12 ay)</option>
            <option value="2025-01-01">Oca 2025 (18 ay)</option>
            <option value="2026-01-01">Oca 2026 (6 ay)</option>
          </select>
          ${yardim("Test dönemi. Bir ayarı tek dönemde değil, en az iki pencerede dene — dönemler farklı piyasalardır.")}</label>
      </div>
      <div class="lab-sec"><span class="lab-sec-t">💰 Kâr alma &amp; risk</span>
        <label class="lab-f"><i>TP1 %</i><input name="tp1" type="number" value="5" min="2" max="20" step="1">
          ${yardim("İlk kâr alma: fiyat bu kadar yükselince pozisyonun ¼'ü satılır. Küçük değer = sık ama ufak kâr; kazananı erken tıraşlar.")}</label>
        <label class="lab-f"><i>TP2 %</i><input name="tp2" type="number" value="20" min="3" max="40" step="1">
          ${yardim("İkinci kâr alma: ¼ daha satılır. Kalan yarı EMA21 iz süren stopla trende bırakılır.")}</label>
        <label class="lab-f"><i>Risk %</i><input name="riskPct" type="number" value="3" min="1" max="6" step="0.5">
          ${yardim("İşlem başına riske edilen sermaye. DİKKAT: edge'i değiştirmez, sadece pozisyonu ve salınımı büyütür — kaybederken artırılmaz.")}</label>
        <label class="lab-f"><i>Komisyon $</i><input name="commission" type="number" value="1.5" min="0" max="5" step="0.5">
          ${yardim("Emir başına ücret (Midas $1.5). Alış + her TP + final ayrı emirdir: bir işlem 3-4 emir tutabilir.")}</label>
      </div>
      <div class="lab-sec"><span class="lab-sec-t">🚦 Filtreler</span>
        <label class="lab-f"><i>RS kuralı</i>
          <select name="rsMode">
            <option value="half">Yarım boyut (canlı)</option>
            <option value="gate">Sert kapı</option>
            <option value="off">Kapalı</option>
          </select>
          ${yardim("Göreli güç: piyasaya göre zayıf hisseye ne yapılır? Yarım boyut = girilir ama küçük; sert kapı = hiç girilmez; kapalı = fark etmez.")}</label>
        <label class="lab-f"><i>RS eşiği</i><input name="rsMin" type="number" value="30" min="5" max="95" step="1">
          ${yardim("Yüzdelik sıra: bunun altındaki hisseler 'zayıf' sayılır. 30 = evrenin en zayıf %30'u.")}</label>
        <label class="lab-f lab-chk"><input name="ep" type="checkbox" checked> EP/haber şeridi
          ${yardim("Kazanç/haber patlaması girişleri. Tarama: edge'in en büyük parçası burası — kapatınca sistem zarara döndü. Kapatma.")}</label>
        <label class="lab-f lab-chk"><input name="regimeGate" type="checkbox" checked> Rejim: giriş bloğu
          ${yardim("Piyasa rejimi 'kapalı'yken yeni teknik giriş alınmaz (EP yarım boyutla devam eder).")}</label>
        <label class="lab-f lab-chk"><input name="regimeBE" type="checkbox" checked> Rejim: başabaş zorlaması
          ${yardim("Kötü piyasada kârdaki pozisyonun stopu girişe çekilir — koruma sağlar ama pozisyonları 'sıyrıkla' tıraşlayabilir.")}</label>
      </div>
      <div class="lab-actions">
        <button type="submit" class="btn primary sm" id="labGo">Koştur</button>
        <button type="button" class="btn sm" id="labScanGo" title="15 hazır varyantı otomatik dener, dürüstlük sırasına dizer — elle tek tek çevirmekten hızlı">🔍 Otomatik tara</button>
      </div>
    </form>
    <details class="lab-tips" open>
      <summary>🎯 Kazanan ayar arayana 6 ipucu <span class="muted">(21-22 Tem taramaları + canlı ders)</span></summary>
      <ol>
        <li><b>Önce dönemi kabul et.</b> Alfa Avı'nın $1500→$1389 düşüşünün ana nedeni ayar değil <b>dönem</b>: 2026 diliminde canlı kuralın kendisi eksi koşuyor. Kötü dönemde en iyi ayar bile kaybettirebilir — hedef, kötü dönemi <i>küçük</i> kaybetmek.</li>
        <li><b>Komisyon gizli vergidir.</b> Komisyonsuz teşhis koşusu ortalama R'yi belirgin yükseltti (~0.17R/işlem fark): $1.5 × 3-4 emir, $350-850'lik pozisyonda %1'e yakın ısırık. Az ve seçici işlem, çok işlemden iyidir.</li>
        <li><b>EP şeridini kapatma.</b> Taramada en net bulgu: EP girişleri kapatılınca sistem zarara döndü (fark −0.78R). Edge'in en büyük parçası haber/kazanç patlamaları.</li>
        <li><b>Risk %'si edge değildir.</b> %3→%4 yapmak kazandırmaz, salınımı büyütür; kötü seride aynı oranda acıtır. Edge kıyaslarken riski %3'te sabit tut.</li>
        <li><b>"En iyi görünen"i değil, "iki yarıda da tutan"ı al.</b> Walk-forward ✓ + fark aralığı 0'ın dışında → ancak o zaman ciddiye al. Tek pencerede parlayanların çoğu uydurmadır (taramada 4 varyant böyle elendi).</li>
        <li><b>Canlı kural neden TP 5/20?</b> 22 Tem'de 60-hisse canlı taramasında en tutarlı satır buydu: ort R +0.28→+0.44, iki yarıda da artı (+0.27/+0.01), maks düşüş −33→−27. Ama fark aralığı 0'ı içeriyordu — yani bu bir <i>kanıt değil, tutarlı eğilim</i>. Eski işlemler defterde kendi TP'leriyle donuk; kural yalnız yeni girişlere işler. 3 ayda bir "🕰 Eski kurallar" hazır ayarıyla kıyası tazele.</li>
      </ol>
    </details>
    <div id="labRes"><div class="rk-empty">Hazır ayar seç veya değerleri elle değiştir, <b>Koştur</b>'a bas — canlı kurallarla yan yana ölçülür. <b>🔍 Otomatik tara</b> ise 15 varyantı senin yerine dener (~1-3 dk).</div></div>`;
  // Hazır ayar pill'leri: formu doldur + açıklamayı göster
  $("#labPresets").addEventListener("click", (e) => {
    const b = e.target.closest("[data-preset]"); if (!b) return;
    const p = LAB_PRESETS[b.dataset.preset]; if (!p) return;
    labSetForm(p.v);
    document.querySelectorAll(".lab-preset").forEach((x) => x.classList.toggle("on", x === b));
    const tip = $("#labPresetTip"); tip.hidden = false;
    tip.innerHTML = `${p.ikon} <b>${p.ad}:</b> ${p.tip}`;
  });
  $("#labScanGo").addEventListener("click", labScanStart);
  // Güvenlik ağı: bir alan HTML5 doğrulamasına takılırsa tarayıcı formu SESSİZCE reddeder
  // (baloncuk görünmeyebilir / alan ekran dışında olabilir). Sebebi ekrana yaz — bir daha
  // "düğmeye basıyorum, hiçbir şey olmuyor" yaşanmasın.
  $("#labForm").addEventListener("invalid", (e) => {
    const el = e.target;
    const ad = el.closest(".lab-f")?.querySelector("i")?.textContent || el.name;
    $("#labRes").innerHTML = `<div class="rk-empty"><b>“${ad}” değeri kabul edilmedi:</b> ${el.validationMessage}
      <span class="muted">(izin verilen aralık ${el.min}–${el.max}${el.step && el.step !== "1" ? `, ${el.step} adımlarla` : ""})</span></div>`;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, true); // capture: invalid olayı baloncuklanmaz

  $("#labForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (LAB_BUSY) return;
    LAB_BUSY = true;
    const btn = $("#labGo"); btn.disabled = true; btn.textContent = "Koşuyor…";
    const f = new FormData(e.target);
    const body = {
      start: f.get("start"), tp1: +f.get("tp1"), tp2: +f.get("tp2"), riskPct: +f.get("riskPct"),
      commission: +f.get("commission"), rsMode: f.get("rsMode"), rsMin: +f.get("rsMin"),
      ep: f.get("ep") === "on", regimeGate: f.get("regimeGate") === "on", regimeBE: f.get("regimeBE") === "on",
    };
    try {
      const r = await fetch("/api/lab/backtest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || "backtest başarısız");
      labPaint(d);
    } catch (err) { $("#labRes").innerHTML = `<div class="rk-empty">Koşu başarısız: ${err.message}</div>`; }
    finally { LAB_BUSY = false; btn.disabled = false; btn.textContent = "Koştur"; }
  });
}
function labPaint(d) {
  const rows = [
    ["Kapanan işlem", "islem", (v) => v],
    ["İsabet", "isabet", (v) => v != null ? `%${v}` : "—"],
    ["Ortalama R", "ortR", (v) => v != null ? `${v >= 0 ? "+" : ""}${v}R` : "—"],
    ["Getiri", "getiriPct", (v) => `${v >= 0 ? "+" : ""}%${v}`],
    ["Maks. düşüş", "maksDususPct", (v) => `%${v}`],
    ["Son sermaye", "sermaye", (v) => `$${Number(v).toLocaleString("en-US")}`],
    ["Toplam komisyon", "komisyon", (v) => `$${v}`],
  ];
  const num = (k, v) => (v == null ? null : Number(v));
  const better = (k, b, x) => { // hangi yön iyi: maksDüşüş/komisyonda küçük, diğerlerinde büyük
    if (b == null || x == null || b === x) return "";
    const smallGood = k === "maksDususPct" ? Math.abs(x) < Math.abs(b) : k === "komisyon" ? x < b : null;
    const ok = smallGood != null ? smallGood : x > b;
    return ok ? "win-c" : "loss-c";
  };
  // Bootstrap kıyası — nokta tahminine değil ARALIĞA bak; asıl karar burada verilir
  const c = d.ci?.kiyas;
  const ciCell = (o) => o ? `<span class="lab-ci">${o.lo >= 0 ? "+" : ""}${o.lo} … ${o.hi >= 0 ? "+" : ""}${o.hi}R</span>` : "";
  const verdict = !c ? "" : !c.yeterli
    ? `<div class="lab-ci-box thin"><b>Güven aralığı hesaplanamadı</b> — ${c.not}</div>`
    : `<div class="lab-ci-box ${c.anlamli ? (c.yon === "varyant" ? "ok" : "warn") : "noise"}">
        <div class="lab-ci-h">${c.anlamli ? "✓ Fark anlamlı" : "≈ Fark gürültü sayılır"}
          <span class="lab-ci-n">${c.n.baseline} vs ${c.n.varyant} işlem${c.kucukOrneklem ? " · küçük örneklem" : ""}</span></div>
        <div class="lab-ci-t">${c.verdict}</div>
        <div class="lab-ci-bar" title="%90 güven aralığı — 0 çizgisini kesiyorsa fark kanıtlanamıyor">
          ${(() => { const lo = c.lo, hi = c.hi, span = Math.max(Math.abs(lo), Math.abs(hi), 0.3) * 1.15;
            const px = (v) => ((v + span) / (2 * span)) * 100;
            return `<i class="lci-zero" style="left:50%"></i><i class="lci-range" style="left:${px(lo).toFixed(1)}%;width:${(px(hi) - px(lo)).toFixed(1)}%"></i><i class="lci-med" style="left:${px(c.farkR).toFixed(1)}%"></i>`; })()}
        </div>
        <div class="lab-ci-legend"><span>varyant kötü ←</span><span>0</span><span>→ varyant iyi</span></div>
      </div>`;
  $("#labRes").innerHTML = `
    <div class="tbl-wrap lab-tbl"><table>
      <thead><tr><th class="l">Metrik</th><th>Canlı kurallar</th><th>Varyantın</th></tr></thead>
      <tbody>${rows.map(([lbl, k, fmt]) => {
        const b = num(k, d.baseline?.[k]), x = num(k, d.variant?.[k]);
        const ci = k === "ortR" ? { b: ciCell(d.ci?.baseline), x: ciCell(d.ci?.varyant) } : { b: "", x: "" };
        return `<tr><td class="l">${lbl}</td><td>${fmt(d.baseline?.[k])}${ci.b}</td><td class="${better(k, b, x)}"><b>${fmt(d.variant?.[k])}</b>${ci.x}</td></tr>`;
      }).join("")}</tbody>
    </table></div>
    ${verdict}
    ${labWF(d)}
    ${labDiag(d)}
    <div class="bm-note">${d.start} → bugün · evren ${d.universe} hisse · ${d.not || ""}</div>`;
}

/* Walk-forward hükmü — "bu ayarlar gerçek mi, bu pencereye mi uydurulmuş?"
 * Parametre çevirerek getiri yükseltmek kolaydır; asıl soru avantajın pencerenin
 * her iki yarısında da durup durmadığıdır. Bu kutu tabloya İNANMADAN ÖNCE okunur. */
function labWF(d) {
  const w = d.wf;
  const kal = d.kaldirac
    ? `<div class="wf-lev">⚖️ <b>Kaldıraç uyarısı:</b> risk %${d.kaldirac.varyant} kullandın, canlı kural %${d.kaldirac.canli} — pozisyonlar <b>${d.kaldirac.kat}×</b> büyük.
       Risk yüzdesi işlem-başı R'yi <b>değiştirmez</b>; getiri farkının bir kısmı beceri değil <b>kaldıraçtır</b> (ve kötü seride aynı oranda acıtır). Edge'i kıyaslamak için risk %${d.kaldirac.canli}'te koştur.</div>`
    : "";
  if (!w) return kal;
  const cell = (o, k, fmt) => `${fmt(o[k].baseline)} → <b>${fmt(o[k].varyant)}</b>`;
  const pct = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}%${v}`);
  const r = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v}R`);
  const row = (b) => `<tr>
      <td class="l"><b>${b.donem}</b><span class="wf-n">${b.islem.baseline} vs ${b.islem.varyant} işlem${b.yeterli ? "" : " · az"}</span></td>
      <td>${cell(b, "ortR", r)}</td>
      <td>${cell(b, "getiriPct", pct)}</td>
      <td class="${b.farkR > 0 ? "pos" : b.farkR < 0 ? "neg" : ""}"><b>${r(b.farkR)}</b></td>
    </tr>`;
  return `${kal}
    <div class="wf-box ${w.durum}">
      <div class="wf-h">${w.durum === "tutarli" ? "✓ Her iki yarıda da tutuyor" : w.durum === "uydurma" ? "⚠ Uydurma şüphesi" : w.durum === "kotu" ? "✗ Varyant geride" : "· Walk-forward"}
        <span class="wf-sub">pencere ${w.kesim} tarihinden ikiye bölündü</span></div>
      <div class="wf-t">${w.verdict}</div>
      <div class="tbl-wrap"><table class="wf-table">
        <thead><tr><th class="l">Dönem</th><th>Ort. R (canlı→varyant)</th><th>Getiri</th><th>Fark</th></tr></thead>
        <tbody>${row(w.bolum1)}${row(w.bolum2)}</tbody></table></div>
    </div>`;
}

/* Teşhis şeridi: farkın MEKANİZMASI. Rejim kaç gün kapalıydı, kaç giriş engellendi,
 * kaç kez stop başabaşa çekildi, kaç işlem "sıyrık" (|R|<0.15) ile kapandı.
 * Sonuç tablosu NE olduğunu söyler; bu satır NEDEN olduğunu söyler. */
function labDiag(d) {
  const b = d.baseline?.diag, v = d.variant?.diag;
  if (!b || !v) return "";
  const g = b.rejimGun || {};
  const gun = (g.on || 0) + (g.caution || 0) + (g.off || 0);
  const row = (lbl, bv, vv, ipucu) => {
    const fark = vv - bv;
    return `<tr><td class="l" title="${ipucu}">${lbl}</td><td>${bv}</td><td><b>${vv}</b>${fark ? `<span class="ld-delta ${fark > 0 ? "up" : "down"}">${fark > 0 ? "+" : ""}${fark}</span>` : ""}</td></tr>`;
  };
  return `<details class="lab-diag"><summary>🔍 Fark nereden geldi? <span class="muted">rejim ${g.off || 0}/${gun} gün kapalıydı</span></summary>
    <table class="ld-table"><thead><tr><th class="l">Mekanizma</th><th>Canlı</th><th>Varyant</th></tr></thead><tbody>
      ${row("Rejim kapalıyken engellenen giriş", b.engellenenGiris, v.engellenenGiris, "Kapı yüzünden hiç açılmayan teknik pozisyon sayısı")}
      ${row("Stop başabaşa çekildi", b.beZorlama, v.beZorlama, "Rejim kapalıyken kârdaki pozisyonun stopu girişe taşındı")}
      ${row("“Sıyrık” kapanış (|R|<0.15)", b.siyrik, v.siyrik, "Ne kâr ne zarar — başabaş stopun tıraşladığı pozisyonların parmak izi")}
    </tbody></table>
    <div class="ld-note">Rejim günleri: <b>${g.on || 0}</b> açık · <b>${g.caution || 0}</b> temkinli · <b>${g.off || 0}</b> kapalı.
      Kapalı gün sayısı düşükse bu pencerede rejim kuralı zaten az çalışmıştır — sonucu ona göre oku.</div>
  </details>`;
}

/* ====================== Otomatik tarama (istemci) ======================
 * POST /api/lab/scan işi başlatır, GET ile ~3 sn'de bir ilerleme çekilir.
 * Sonuç dürüstlük sırasıyla listelenir; satıra tıklayınca ayarlar forma
 * dolar — oradan tam koşu (bootstrap + walk-forward + teşhis) yapılır. */
let LAB_SCAN_TIMER = null;
async function labScanStart() {
  if (LAB_BUSY) return;
  const start = $("#labForm")?.elements.start?.value || "2025-07-01";
  const btn = $("#labScanGo");
  try {
    const r = await fetch("/api/lab/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ start }) });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || "tarama başlatılamadı");
    btn.disabled = true;
    $("#labRes").innerHTML = `<div class="rk-empty" id="labScanWait">🔍 Tarama koşuyor… <b id="labScanPct">hazırlanıyor</b><div class="lab-scan-bar"><i id="labScanFill" style="width:2%"></i></div><span class="muted">15 varyant × 3 koşu — ilk yarım dakika veri hazırlığıdır, çubuk sonra akar.</span></div>`;
    LAB_SCAN_TIMER = setInterval(labScanPoll, 3000);
  } catch (e) { $("#labRes").innerHTML = `<div class="rk-empty">Tarama başlatılamadı: ${e.message}</div>`; }
}
async function labScanPoll() {
  try {
    const d = await (await fetch("/api/lab/scan")).json();
    if (d.running) {
      const p = d.progress || {};
      if (p.total) {
        const pct = Math.max(2, Math.round((p.done / p.total) * 100));
        const el = $("#labScanPct"); if (el) el.textContent = `${p.done}/${p.total} koşu`;
        const f = $("#labScanFill"); if (f) f.style.width = pct + "%";
      }
      return;
    }
    clearInterval(LAB_SCAN_TIMER); LAB_SCAN_TIMER = null;
    const btn = $("#labScanGo"); if (btn) btn.disabled = false;
    if (d.error) { $("#labRes").innerHTML = `<div class="rk-empty">Tarama hata verdi: ${d.error}</div>`; return; }
    if (d.results) labScanPaint(d.results);
  } catch { /* geçici ağ hatası — sıradaki poll dener */ }
}
const LAB_HUKUM = {
  saglam:  { et: "✓ sağlam",        tip: "İki yarıda da önde VE fark aralığı 0'ın dışında — bulunabilecek en güçlü sinyal (yine de garanti değil)." },
  umutlu:  { et: "~ iki yarıda artı", tip: "İki yarıda da önde ama fark istatistiksel olarak kanıtlanamıyor (aralık 0'ı içeriyor). Eğilim, kanıt değil." },
  gurultu: { et: "≈ gürültü",       tip: "Fark var gibi görünse de ne walk-forward ne aralık destekliyor — şans olabilir." },
  "veri-az": { et: "· veri az",     tip: "Kıyas için yeterli kapanmış işlem yok." },
  uydurma: { et: "⚠ uydurma",       tip: "Avantaj yalnız tek yarıda — o döneme uydurulmuş görünüyor. Canlıya alma." },
  kotu:    { et: "✗ kötü",          tip: "Canlı kurallardan geride — bu ayarı alma." },
  teshis:  { et: "🧪 teşhis",       tip: "Gerçek bir seçenek değil; bir maliyetin/filtrenin toplam etkisini ölçmek için koşulur." },
};
function labScanPaint(r) {
  const fR = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v}R`);
  const rows = r.varyantlar.map((v, i) => {
    const h = LAB_HUKUM[v.hukum] || { et: v.hukum, tip: "" };
    const wf = v.wf ? `${fR(v.wf.f1)} / ${fR(v.wf.f2)}` : "—";
    return `<tr class="ls-row${v.teshis ? " ls-teshis" : ""}" data-lsvar="${i}" title="${v.not} — tıkla: ayarları forma doldur">
      <td class="l"><span class="ls-hukum h-${v.hukum}" title="${h.tip}">${h.et}</span></td>
      <td class="l"><b>${v.ad}</b><span class="ls-not">${v.not}</span></td>
      <td>${v.islem}</td>
      <td class="${v.ortR > (r.baseline.ortR ?? 0) ? "pos" : ""}">${fR(v.ortR)}</td>
      <td>${v.farkR == null ? "—" : `<b class="${v.farkR > 0 ? "pos" : v.farkR < 0 ? "neg" : ""}">${fR(v.farkR)}</b> <span class="lab-ci">${fR(v.ciLo)}…${fR(v.ciHi)}</span>`}</td>
      <td title="pencerenin 1. / 2. yarısında canlıya karşı fark">${wf}</td>
      <td class="${v.getiriPct >= 0 ? "pos" : "neg"}">%${v.getiriPct}</td>
      <td>%${v.maksDususPct}</td>
    </tr>`;
  }).join("");
  $("#labRes").innerHTML = `
    <div class="ls-head"><b>🔍 Tarama sonucu</b> — ${r.start} → bugün · evren ${r.universe} hisse · ${r.sureSn} sn
      <span class="ls-base">Canlı kurallar: ${r.baseline.islem} işlem · ort ${fR(r.baseline.ortR)} · getiri %${r.baseline.getiriPct} · maks düşüş %${r.baseline.maksDususPct}</span></div>
    <div class="tbl-wrap"><table class="ls-table">
      <thead><tr><th class="l">Hüküm</th><th class="l">Varyant</th><th>İşlem</th><th>Ort R</th><th>Fark (aralık)</th><th>WF ½/½</th><th>Getiri</th><th>Düşüş</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="bm-note">${r.not} Satıra tıkla → ayarlar forma dolar; oradan <b>Koştur</b> ile tam rapor (güven aralığı + walk-forward + teşhis) alırsın.</div>`;
  // Satır tıklama: varyant parametrelerini forma doldur (canlı taban + fark)
  document.querySelectorAll("[data-lsvar]").forEach((tr) => tr.addEventListener("click", () => {
    const v = r.varyantlar[+tr.dataset.lsvar]; if (!v || v.teshis) return;
    labSetForm({ ...LAB_PRESETS.canli.v, ...v.params });
    document.querySelectorAll(".lab-preset").forEach((x) => x.classList.remove("on"));
    const tip = $("#labPresetTip"); tip.hidden = false;
    tip.innerHTML = `🔍 <b>${v.ad}</b> forma dolduruldu — <b>Koştur</b> ile tam raporu al.`;
    $("#labForm").scrollIntoView({ block: "start", behavior: "smooth" });
  }));
}
