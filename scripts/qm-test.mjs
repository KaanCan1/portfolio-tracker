// qm.js doğrulama betiği (commit edilmez) — sentetik mumlarla giriş/stop/skor sağlaması.
import { qmAnalyze, qmPositionSize } from "../qm.js";

const base = new Date("2026-01-01").getTime();
function toCandles(closes, { adr = 5, vol = 1_000_000, gaps = {} } = {}) {
  const out = []; let prev = closes[0];
  for (let i = 0; i < closes.length; i++) {
    const close = closes[i];
    const open = gaps[i] != null ? prev * (1 + gaps[i] / 100) : (prev + close) / 2;
    const half = close * (adr / 200);
    const high = Math.max(open, close) + half;
    const low = Math.min(open, close) - half;
    out.push({
      time: new Date(base + i * 86400000).toISOString().slice(0, 10),
      open: +open.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2),
      close: +close.toFixed(2), volume: gaps[i] != null ? vol * 3 : vol,
    });
    prev = close;
  }
  return out;
}

function genBreakout() {
  const cl = [];
  for (let i = 0; i < 18; i++) cl.push(70 + Math.sin(i) * 0.6);            // taban ~70
  for (let i = 0; i < 24; i++) cl.push(70 + ((i + 1) / 24) * 32);          // 70→102 (+45%)
  for (let i = 0; i < 24; i++) { const t = i / 23; cl.push(98 + t * 1.5 + Math.sin(i * 1.3) * 3 * (1 - t) * 0.5); } // sıkışma
  return cl;
}
function genEP() {
  const cl = []; for (let i = 0; i < 78; i++) cl.push(50 + Math.sin(i) * 0.4); // yatay ~50
  cl.push(57); cl.push(57.5); cl.push(58);                                    // gap günü + takip
  return cl;
}
function genNone() { const cl = []; for (let i = 0; i < 72; i++) cl.push(60 - (i / 72) * 10 + Math.sin(i) * 0.3); return cl; } // düşüş
function genExtended() {
  const cl = [];
  for (let i = 0; i < 30; i++) cl.push(70 + Math.sin(i) * 0.5);             // uzun taban (≥60 mum için)
  for (let i = 0; i < 24; i++) cl.push(70 + ((i + 1) / 24) * 32);           // 70→102
  let v = 102; for (let i = 0; i < 10; i++) { v *= 1.07; cl.push(+v.toFixed(2)); } // parabolik +7%/gün
  return cl;
}

const cases = [
  { name: "BREAKOUT", c: toCandles(genBreakout(), { adr: 5 }), want: "breakout" },
  { name: "EPISODIC PIVOT", c: toCandles(genEP(), { adr: 5, gaps: { 78: 12 } }), want: "ep" },
  { name: "NON-SETUP", c: toCandles(genNone(), { adr: 2 }), want: "none" },
  { name: "EXTENDED", c: toCandles(genExtended(), { adr: 5 }), want: "breakout/extended" },
];

let fail = 0;
const assert = (cond, msg) => { if (!cond) { console.log("  ❌ FAIL:", msg); fail++; } else console.log("  ✓", msg); };

for (const { name, c, want } of cases) {
  const r = qmAnalyze(c, {});
  console.log(`\n=== ${name} (beklenen: ${want}) ===`);
  console.log(`  setup=${r.setup} stage=${r.stage} score=${r.score} ADR=%${r.adrPct} priorMove=%${r.priorMovePct} nearHigh=%${r.consolidation?.nearHighPct}`);
  console.log(`  giriş=${r.entryTrigger} stop=${r.stop} stopPct=%${r.stopPct} (R2=${r.rTargets?.r2}) extOver10=${r.extendedOverMA10}`);
  console.log(`  reasons: ${r.reasons.join(" | ")}`);
  if (name === "BREAKOUT") {
    assert(r.setup === "breakout", "setup=breakout");
    assert(["setting-up", "breaking-out"].includes(r.stage), "stage setting-up/breaking-out");
    assert(r.score >= 50, "score ≥ 50");
  }
  if (name === "EPISODIC PIVOT") assert(r.setup === "ep", "setup=ep");
  if (name === "NON-SETUP") { assert(r.setup === "none", "setup=none"); assert(r.score < 40, "score < 40"); }
  if (name === "EXTENDED") assert(r.stage === "extended", "stage=extended");
  // EVRENSEL: setup varsa stop genişliği ≤ 1×ADR (+ küçük tolerans)
  if (r.setup !== "none" && r.stopPct != null && r.adrPct != null)
    assert(r.stopPct <= r.adrPct + 0.2, `stopPct(%${r.stopPct}) ≤ 1×ADR(%${r.adrPct})`);
}

// Pozisyon boyutu sağlaması
console.log("\n=== POZİSYON BOYUTU ($10k, %0.5 risk, giriş 102.6 stop 97.5) ===");
const ps = qmPositionSize(10000, 0.5, 102.6, 97.5);
console.log(" ", JSON.stringify(ps));
assert(ps && ps.shares === 9, "9 adet (50$ risk / 5.1$ pay)");
assert(ps && ps.riskAmt === 50, "risk tutarı $50");

console.log(fail ? `\n❌ ${fail} test BAŞARISIZ` : "\n✅ TÜM TESTLER GEÇTİ");
process.exit(fail ? 1 : 0);
