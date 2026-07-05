// ===================== Qullamaggie (QM) momentum swing motoru =====================
// Saf, bağımsız modül: günlük mumlardan (eskiden→yeniye) QM kriterlerini çıkarır.
// Breakout + Episodic Pivot setup'larını, giriş tetiğini, stop'u (≤1×ADR), setup/stage
// sınıfını ve 0-100 skoru üretir. MEKANİK kural taraması — yatırım tavsiyesi DEĞİL.
// Referans: qullamaggie.com (3 Timeless Setups; How to master Episodic Pivots).

function sma(arr, n) {
  return arr.length >= n ? arr.slice(-n).reduce((a, b) => a + b, 0) / n : null;
}

// ADR% = son 20 günün ortalaması (High−Low)/Close × 100 (Qullamaggie tanımı)
export function qmADR(candles, n = 20) {
  if (!Array.isArray(candles) || candles.length < n) return null;
  const s = candles.slice(-n);
  let sum = 0, k = 0;
  for (const c of s) { if (c.close > 0) { sum += (c.high - c.low) / c.close; k++; } }
  return k ? (sum / k) * 100 : null;
}

export function qmAnalyze(candles, ctx = {}) {
  const out = { ok: false, setup: "none", stage: "none", score: 0, reasons: [], checklist: [] };
  if (!Array.isArray(candles) || candles.length < 60) { out.reason = "yetersiz mum (≥60 gün gerekir)"; return out; }
  const c = candles.slice();                          // eskiden→yeniye
  const closes = c.map((x) => x.close), vols = c.map((x) => x.volume || 0);
  const N = c.length;
  const price = ctx.price ?? closes[N - 1];

  const adr = qmADR(c, 20);
  const ma10 = sma(closes, 10), ma20 = sma(closes, 20), ma50 = sma(closes, 50), ma200 = sma(closes, 200);
  const ma10Prev = sma(closes.slice(0, -5), 10), ma20Prev = sma(closes.slice(0, -5), 20); // 5 gün önce → eğim
  const rising10 = ma10 != null && ma10Prev != null && ma10 > ma10Prev;
  const rising20 = ma20 != null && ma20Prev != null && ma20 > ma20Prev;
  const avgVol20 = vols.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, vols.length);
  const dollarVol = price * avgVol20;
  out.adrPct = adr != null ? +adr.toFixed(2) : null;
  out.price = price;
  out.ma = { ma10, ma20, ma50, ma200, rising10, rising20 };
  out.avgVol = Math.round(avgVol20);
  out.dollarVol = Math.round(dollarVol);

  // --- Önceki hamle ("the move"): son ~63 günde en büyük up-leg ---
  const win = c.slice(-63);
  let hiIdx = 0; for (let i = 0; i < win.length; i++) if (win[i].high > win[hiIdx].high) hiIdx = i;
  let loIdx = 0; for (let i = 0; i <= hiIdx; i++) if (win[i].low < win[loIdx].low) loIdx = i;
  const moveLow = win[loIdx] ? win[loIdx].low : null, moveHigh = win[hiIdx] ? win[hiIdx].high : null;
  const priorMovePct = (moveLow > 0) ? ((moveHigh - moveLow) / moveLow) * 100 : 0;
  out.priorMovePct = +priorMovePct.toFixed(1);
  out.moveHigh = moveHigh; out.moveLow = moveLow;

  // --- Konsolidasyon / sıkışma (son ~20 gün) ---
  const baseLen = Math.min(20, N - 1);
  const base = c.slice(-baseLen);
  // pivot (kırılım seviyesi) = bugün HARİÇ taban tepesi → taze kırılımda close > pivot olabilsin
  const basePrior = c.slice(-(baseLen + 1), -1);
  const baseHigh = Math.max(...basePrior.map((x) => x.high));
  const baseLow = Math.min(...base.map((x) => x.low));
  const baseDepthPct = baseHigh > 0 ? ((baseHigh - baseLow) / baseHigh) * 100 : 999;
  const last5 = c.slice(-5), prev10 = c.slice(-15, -5);
  const r5 = Math.max(...last5.map((x) => x.high)) - Math.min(...last5.map((x) => x.low));
  const r10 = prev10.length ? (Math.max(...prev10.map((x) => x.high)) - Math.min(...prev10.map((x) => x.low))) : r5;
  const contraction = r10 > 0 ? r5 / r10 : 1;                 // <1 → daralıyor
  const h1 = c.slice(-10, -5), h2 = c.slice(-5);
  const lows1 = h1.length ? Math.min(...h1.map((x) => x.low)) : baseLow;
  const lows2 = Math.min(...h2.map((x) => x.low));
  const higherLows = lows2 >= lows1;
  const nearHigh = baseHigh > 0 ? ((baseHigh - price) / baseHigh) * 100 : 999; // pivot'a uzaklık %
  out.consolidation = {
    weeks: +(baseLen / 5).toFixed(1), depthPct: +baseDepthPct.toFixed(1),
    contraction: +contraction.toFixed(2), higherLows, nearHighPct: +nearHigh.toFixed(1),
  };

  // --- Likidite ---
  const liqOk = price >= 5 && avgVol20 >= 500_000;
  out.liquidity = { price, avgVol: Math.round(avgVol20), dollarVol: Math.round(dollarVol), ok: liqOk };

  // --- Episodic Pivot (EP): son ~10 günde ≥%10 gap + hacim patlaması ---
  let ep = null;
  for (let i = Math.max(1, N - 10); i < N; i++) {
    const gap = ((c[i].open - c[i - 1].close) / c[i - 1].close) * 100;
    const before = vols.slice(Math.max(0, i - 20), i);
    const volAvg = before.length ? before.reduce((a, b) => a + b, 0) / before.length : 0;
    const volMult = volAvg > 0 ? (c[i].volume || 0) / volAvg : 0;
    if (gap >= 10 && volMult >= 1.5) { ep = { gapPct: +gap.toFixed(1), volMult: +volMult.toFixed(1), daysAgo: N - 1 - i, day: c[i].time }; break; }
  }
  out.ep = ep;

  // --- Pivot / giriş tetiği ve stop (stop genişliği ≤ 1×ADR garanti) ---
  const pivotHigh = baseHigh;
  const entry = +(pivotHigh * 1.001).toFixed(2);             // kırılım üstü ufak tampon
  const structStop = baseLow;                                // konsolidasyon dibi
  const adrStop = adr != null ? entry * (1 - adr / 100) : structStop; // 1×ADR altı taban
  const stop = +Math.max(structStop, adrStop).toFixed(2);    // daha yüksek olan → risk ≤ 1×ADR
  const stopPct = entry > 0 ? ((entry - stop) / entry) * 100 : null;
  out.pivotHigh = +pivotHigh.toFixed(2);
  out.entryTrigger = entry;
  out.stop = stop;
  out.stopPct = stopPct != null ? +stopPct.toFixed(2) : null;
  out.rTargets = { r2: +(entry + 2 * (entry - stop)).toFixed(2), r3: +(entry + 3 * (entry - stop)).toFixed(2) };

  // --- Extended (parabolic kovalama riski): 10MA'nın ADR cinsinden çok üstünde ---
  const extOver10 = (ma10 && adr) ? (((price - ma10) / ma10) * 100) / adr : null; // ADR katı
  const extended = extOver10 != null && extOver10 > 4;
  out.extendedOverMA10 = extOver10 != null ? +extOver10.toFixed(1) : null;

  // --- Checklist (grafik paneli) ---
  const aboveAll = ma10 != null && ma20 != null && price >= ma10 && price >= ma20;
  const chk = (k, pass, val) => out.checklist.push({ k, pass: !!pass, val });
  chk("Önceki hamle ≥%30 (1-3 ay)", priorMovePct >= 30, `%${priorMovePct.toFixed(0)}`);
  chk("ADR ≥ %4", adr != null && adr >= 4, adr != null ? `%${adr.toFixed(1)}` : "—");
  chk("Fiyat 10 & 20 MA üstünde", aboveAll, aboveAll ? "evet" : "hayır");
  chk("10/20 MA yükseliyor", rising10 && rising20, rising10 && rising20 ? "evet" : "kısmi/hayır");
  chk("Konsolidasyon daralıyor", contraction <= 0.85, `×${contraction.toFixed(2)}`);
  chk("Yükselen dipler", higherLows, higherLows ? "evet" : "hayır");
  chk("Likidite (≥$5, ≥500k)", liqOk, liqOk ? "evet" : "düşük");
  chk("Pivot'a yakın (≤%5)", nearHigh <= 5, `%${nearHigh.toFixed(1)}`);

  // --- Setup + stage sınıflama ---
  const breakoutBase = priorMovePct >= 30 && aboveAll && adr != null && adr >= 4 && higherLows && liqOk;
  let setup = "none";
  if (ep && liqOk) setup = "ep";
  else if (breakoutBase) setup = "breakout";
  // Tam kurulum yok ama gerçek bir hamle var ve hisse likit → "kısmi eşleşme" (izlemeye değer,
  // henüz giriş sinyali değil). Tarama hiç boş kalmasın diye değil — Qullamaggie evreninde
  // "the move" zaten oldu, geri kalan kriterler (taban/ADR/trend) henüz olgunlaşmadı diye dışlamayalım.
  else if (priorMovePct >= 20 && liqOk) setup = "watch";

  let stage = "none";
  if (setup === "ep") {
    // EP gap'in kendisi kırılımdır → tazeyse aksiyon, eskiyse izleme
    stage = extended ? "extended" : (ep.daysAgo <= 5 ? "breaking-out" : "early");
  } else if (setup === "breakout") {
    if (extended) stage = "extended";                       // gergin → kovalama
    else if (price >= pivotHigh * 0.999) stage = "breaking-out"; // pivotu kırdı (kırılım range'i genişletir, daralma şartı arama)
    else if (nearHigh <= 8) stage = "setting-up";           // pivotun hemen altında, 1-2 ay adayı
    else stage = "early";                                   // hamle var ama pivottan uzak
  } else if (setup === "watch") {
    stage = extended ? "extended" : "early";                // tam taban/ADR/trend şartı yok → asla "kuruluyor/kırılıyor" denmez
  }
  out.setup = setup; out.stage = stage;

  // --- Skor 0-100 (şeffaf bileşenler) ---
  const sc = {};
  sc.move = Math.max(0, Math.min(25, (priorMovePct / 100) * 25));                 // 100% → 25
  sc.adr = adr ? Math.max(0, Math.min(15, (adr / 8) * 15)) : 0;                    // %8 → 15
  sc.trend = (aboveAll ? 8 : 0) + (rising10 && rising20 ? 7 : 0);                  // 15
  sc.base = (higherLows ? 7 : 0) + (contraction <= 0.85 ? 8 : contraction <= 1 ? 4 : 0); // 15
  sc.proximity = Math.max(0, Math.min(15, 15 - nearHigh));                         // pivotta → 15
  sc.liquidity = liqOk ? 8 : 0;                                                    // 8
  sc.ep = ep ? 7 : 0;                                                              // 7
  let score = Object.values(sc).reduce((a, b) => a + b, 0);
  if (extended) score *= 0.6;
  if (setup === "none") score *= 0.4;
  else if (setup === "watch") score *= 0.7;          // kısmi eşleşme — gerçek kurulumdan daha düşük öncelik
  out.score = Math.round(Math.max(0, Math.min(100, score)));
  out.scoreParts = sc;

  // --- Gerekçeler (düz Türkçe) ---
  const R = out.reasons;
  if (setup === "ep") R.push(`Episodic Pivot: ${ep.daysAgo === 0 ? "bugün" : ep.daysAgo + " gün önce"} +%${ep.gapPct} gap, ${ep.volMult}× hacim`);
  if (setup === "breakout") R.push(`Breakout adayı: +%${priorMovePct.toFixed(0)} hamle sonrası ${out.consolidation.weeks} haftalık sıkışma`);
  if (stage === "breaking-out") R.push(`Pivot ${out.pivotHigh} kırılıyor — QM girişi: ORH üstü (gün içi), stop günün dibi`);
  else if (stage === "setting-up") R.push(`Pivot ${out.pivotHigh}'e %${nearHigh.toFixed(1)} — kırarsa 1-2 ay swing adayı`);
  else if (stage === "extended") R.push(`10MA'nın ${out.extendedOverMA10}×ADR üstünde — gergin, kovalama; geri çekilmede izle`);
  if (setup === "watch") {
    // Kısmi eşleşme: hamle gerçek ama tam QM kurulumu için neyin eksik olduğunu somut söyle.
    const eksik = [];
    if (!aboveAll) eksik.push("fiyat 10/20 günlük ortalamaların altında");
    if (!higherLows) eksik.push("dipler yükselmiyor (taban temiz değil)");
    if (adr == null || adr < 4) eksik.push(`ADR %${adr != null ? adr.toFixed(1) : "?"} < %4 (yeterince oynak değil)`);
    if (contraction > 0.85) eksik.push("son 1 hafta hâlâ daralmıyor (sıkışma olgunlaşmadı)");
    R.push(`+%${priorMovePct.toFixed(0)} gerçek hamle var ama tam kurulum yok — ${eksik.length ? eksik.join("; ") : "taban henüz oturmadı"}. Henüz giriş sinyali değil, izlemeye değer.`);
  }
  if (!liqOk) R.push("Likidite düşük — QM eşiğini (≥$5, ≥500k) karşılamıyor");
  if (adr != null && adr < 4) R.push(`ADR %${adr.toFixed(1)} < %4 — yeterince hareketli değil`);

  out.ok = true;
  return out;
}

// Pozisyon boyutu (Qullamaggie): adet = (Hesap × Risk%) / (Giriş − Stop)
export function qmPositionSize(account, riskPct, entry, stop) {
  if (!(account > 0) || !(riskPct > 0) || !(entry > stop)) return null;
  const riskAmt = account * (riskPct / 100);
  const perShare = entry - stop;
  const shares = Math.floor(riskAmt / perShare);
  return { shares, riskAmt: +riskAmt.toFixed(2), perShare: +perShare.toFixed(2), cost: +(shares * entry).toFixed(2), pctOfAccount: +((shares * entry) / account * 100).toFixed(1) };
}
