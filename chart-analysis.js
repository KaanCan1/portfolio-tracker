/* 12 Eki 2026: günlük grafik bir ORH emri değildir; kaynak ve teyit aynı senaryoda okunur. */
import { nySaat } from './alfa-clock.js';
import { kurulumKapisi, oynaklikPct, goreliGuc, KAPI } from './signal-gates.js';
const positive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const round = (n) => Math.round(n * 10000) / 10000;
export function normalizeChartCandles(input, now = new Date()) {
  const today = nySaat(now).gun;
  const dates = new Map(); let rejected = 0, duplicates = 0;
  for (const bar of Array.isArray(input) ? input : []) {
    const time = bar?.time;
    const date = typeof time === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(time) ? new Date(`${time}T12:00:00Z`) : null;
    if (!date || !Number.isFinite(+date) || date.toISOString().slice(0, 10) !== time || time > today ||
      !['open','high','low','close'].every((key) => positive(bar[key])) || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.low > bar.high) { rejected++; continue; }
    if (dates.has(time)) duplicates++;
    dates.set(time, { ...bar, volume: typeof bar.volume === 'number' && Number.isFinite(bar.volume) && bar.volume >= 0 ? bar.volume : null });
  }
  return { candles: [...dates.values()].sort((a,b) => a.time.localeCompare(b.time)), rejected, duplicates };
}
export function closedChartCandles(candles, now = new Date()) {
  const clock = nySaat(now);
  // Kapanış sonrası beş dakika tampon; açık günlük mumun high/low'u teyit sayılmaz.
  return candles.filter((bar) => bar.time < clock.gun || (bar.time === clock.gun && clock.dakika >= 16 * 60 + 5));
}
// 12 Eki: iki serinin farklı tarihlerdeki sonlarını karşılaştırmak RS teyidi değildir.
export function chartRelativeStrength(candles, benchmark, now = new Date()) {
  const own = closedChartCandles(candles, now), index = closedChartCandles(normalizeChartCandles(benchmark, now).candles, now);
  if (!own.length || own.at(-1)?.time !== index.at(-1)?.time) return null;
  const reference = new Map(index.map(bar => [bar.time, bar.close]));
  const shared = own.filter(bar => reference.has(bar.time)).slice(-KAPI.rsUfukGun - 1);
  if (shared.length < KAPI.rsUfukGun + 1) return null;
  return goreliGuc(shared.map(bar => bar.close), shared.map(bar => reference.get(bar.time)), KAPI.rsUfukGun);
}
// 12 Eki: eksik son hacim önceki işlem gününün hacmiyle teyit edilmesin.
export function chartVolumeSummary(candles) {
  const window = candles.slice(-20), last = candles.at(-1)?.volume;
  const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  return {
    avgVol: window.length === 20 && window.every(bar => valid(bar.volume)) ? window.reduce((sum,bar)=>sum+bar.volume,0)/20 : null,
    lastVol: valid(last) ? last : null,
  };
}
export function chartEntryAnalysis({ candles = [], qm = {}, plan = {}, atr = null, rsFark = null, support = [], resistance = [], rejected = 0, fetchedAt = null, now = new Date() }) {
  const closed = closedChartCandles(candles, now);
  const last = closed.at(-1), previous = closed.at(-2);
  const today = nySaat(now).gun;
  const ageDays = last ? Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${last.time}T12:00:00Z`)) / 86400000) : null;
  const current = last?.close ?? null;
  const gate = kurulumKapisi({ atrPct: oynaklikPct(atr, current), rsFark });
  const reasons = [];
  const quality = { timeframe: '1D', barDate: last?.time ?? null, chartDate: candles.at(-1)?.time ?? null, partialBar: candles.length !== closed.length, ageDays, stale: ageDays == null || ageDays > 5, rejected, fetchedAt, intradayVerified: false };
  const base = { version: 1, quality, currentPrice: current, state: 'none', label: 'Giriş kurulumu yok', reasons, levels: null, gate, evidence: 'Günlük mumlarla koşullu senaryo; gün içi tetik ve gerçekleşen işlem doğrulanmaz.' };
  if (!last || closed.length < 60) return { ...base, state: 'insufficient', label: 'Günlük veri yetersiz', reasons: ['En az 60 kapanmış günlük mum gerekir.'] };
  if (quality.stale || rejected > 0) reasons.push(quality.stale ? 'Son kapanış eski; seviyeler yenilenmeden giriş teyidi değerlendirilemez.' : 'Geçersiz mumlar elendi; veri kalitesi doğrulanmalı.');
  if (!qm.ok || !['breakout','ep'].includes(qm.setup)) return { ...base, reasons: [...reasons, qm.setup === 'watch' ? 'Kısmi eşleşme giriş tetiği değildir; kurulumun olgunlaşması beklenir.' : 'Tam kırılım veya EP kurulumu bulunmadı.'] };
  const entry = qm.entryTrigger, stop = qm.stop;
  if (!positive(entry) || !positive(stop) || stop >= entry) return { ...base, state: 'invalid', label: 'Seviye geometrisi geçersiz', reasons: [...reasons, 'Stop giriş fiyatının altında olmalı; bu plan çizilmez.'] };
  const risk = entry - stop, target2 = round(entry + 2 * risk), target3 = round(entry + 3 * risk);
  const barrier = resistance.filter((v) => positive(v) && v > entry).sort((a,b) => a-b)[0] ?? null;
  const levels = { entry, stop, target2, target3, risk: round(risk), riskPct: round(risk / entry * 100), distancePct: round((entry / current - 1) * 100), nearestResistance: barrier, roomR: barrier ? round((barrier - entry) / risk) : null };
  let state = 'waiting', label = 'Tetik seviyesi bekleniyor';
  if (last.low <= stop && last.high >= entry) { state = 'ambiguous'; label = 'Aynı mumda tetik ve stop'; reasons.push('Günlük OHLC temas sırasını göstermez; gerçekleşmiş başarılı giriş olarak sayılmaz.'); }
  else if (current <= stop) { state = 'invalidated'; label = 'Stop koşulu ihlal edildi'; }
  else if (qm.stage === 'extended' || current >= entry + risk) { state = 'extended'; label = 'Tetik geride kaldı'; reasons.push('Mevcut fiyatla giriş, ilk planın riskini değiştirir; yeniden kurulum beklenir.'); }
  else if (current >= entry) { state = 'close-confirmed'; label = 'Kapanış tetik üstünde'; reasons.push(previous?.close < entry ? 'Son kapanış tetik seviyesini geçti; bu bir gün içi emir teyidi değildir.' : 'Fiyat tetik üstünde; ilk temas ve dolum fiyatı bu grafikten bilinmez.'); }
  else if (last.high >= entry) { state = 'rejected'; label = 'Temas var, kapanış teyidi yok'; }
  if (!gate.gecti || plan.kapi) { state = 'blocked'; label = 'Giriş filtresi geçilmedi'; reasons.push(gate.sebep || plan.kapi.sebep); }
  if (rsFark == null || oynaklikPct(atr, current) == null) { reasons.push('Göreli güç veya oynaklık verisi eksik; filtrelerin tamamı doğrulanmadı.'); if (state === 'close-confirmed') { state = 'unverified'; label = 'Tetik üstü · filtre teyidi eksik'; } }
  if (quality.stale || rejected > 0) { state = 'data-warning'; label = 'Giriş için veri teyidi gerekli'; }
  if (barrier && barrier < target2) reasons.push(`Yakın direnç ${round(barrier)}: varsayımsal 2R hedefinden önce. 2R/3R çizgileri fiyat tahmini değildir.`);
  if (quality.partialBar) reasons.push('Bugünün günlük mumu henüz kapanmadı; senaryo son kapanmış muma göre hesaplandı.');
  return { ...base, state, label, levels, reasons, support: support.filter(positive).filter(v=>v<current).sort((a,b)=>b-a).slice(0,2) };
}
