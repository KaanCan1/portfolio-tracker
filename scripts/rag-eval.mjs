#!/usr/bin/env node
/* RAG eval — "Defterime sor" hattını altın soru setiyle ölçer.
 *
 *   node scripts/rag-eval.mjs            → yalnız retrieval (ücretsiz, deterministik
 *                                          BM25; VOYAGE_API_KEY varsa vektör/hibrit/rerank da)
 *   node scripts/rag-eval.mjs --llm      → + Claude cevapları (ANTHROPIC_API_KEY gerekir,
 *                                          PARA HARCAR — 24 çağrı)
 *   --k 5        retrieval kesme noktası
 *   --kaydet     sonucu eval/sonuclar/<tarih>.json'a yazar (sürümler arası kıyas için)
 *
 * Ölçülenler
 *   Retrieval : recall@k, MRR, nDCG@k — soru türüne göre kırılımlı
 *               (sozcuk / anlam / sembol / coklu). "anlam" satırı BM25 ile vektör
 *               aramanın farkını gösteren satırdır.
 *   Cevap     : olgu isabeti (beklenen ifadeler cevapta geçiyor mu),
 *               alıntı kesinliği (alıntılanan belge beklenenlerden mi),
 *               çekimser kalma doğruluğu (defterde olmayan soruda "bulamadım"),
 *               yanlış çekimserlik (cevabı olan soruda "bulamadım"),
 *               düşürülen (uydurma) alıntı sayısı
 *   İşletim   : gecikme p50/p95, token, tahmini $ maliyet
 *
 * Neden LLM-hakem değil: olgu ifadeleri ve alıntı kimlikleri deterministik
 * kontrol edilebiliyor — hakem modelin kendi gürültüsü ve maliyeti olmadan.
 * Not: veri sentetik ve küçük (24 soru); amaç regresyon yakalamak, kesin
 * mutlak kalite iddiası değil. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getir, sor } from "../rag-hat.js";
import { belgeleriTopla, retrievalMetrikleri } from "../rag.js";
import { voyageIstemci } from "../embeddings.js";

const KOK = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (ad, vars) => { const i = process.argv.indexOf(ad); return i < 0 ? vars : process.argv[i + 1]; };
const bayrak = (ad) => process.argv.includes(ad);
const K = Number(arg("--k", 5));

// $ / 1M token (girdi, çıktı) — bilinmeyen modelde maliyet "?" yazılır.
const FIYAT = {
  "claude-opus-5-5": [4, 20], "claude-opus-4-8": [5, 25], "claude-opus-5": [5, 25],
  "claude-sonnet-5-5": [2, 10], "claude-haiku-4-5": [1, 5],
};

const ort = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const yuzde = (x) => (x == null ? "  —  " : `${(x * 100).toFixed(1).padStart(5)}%`);
const sirali = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };

/* ── Retrieval ─────────────────────────────────────────────────────────── */
export async function retrievalEval({ data, sorular, voyage = null, mod, rerank = false, k = K }) {
  const belgeler = belgeleriTopla(data);
  const onbellek = {};
  const satirlar = [];
  for (const q of sorular.filter((x) => x.beklenen.length)) {
    const { bulunan } = await getir({ belgeler, soru: q.soru, symbol: q.symbol, voyage, onbellek, mod, rerank, k });
    satirlar.push({ id: q.id, tur: q.tur, ...retrievalMetrikleri(bulunan.map((p) => p.belgeId), q.beklenen, k) });
  }
  const ozet = (xs) => ({ n: xs.length, recall: ort(xs.map((x) => x.recall)), mrr: ort(xs.map((x) => x.mrr)), ndcg: ort(xs.map((x) => x.ndcg)) });
  const turler = [...new Set(satirlar.map((x) => x.tur))];
  return { genel: ozet(satirlar), tur: Object.fromEntries(turler.map((t) => [t, ozet(satirlar.filter((x) => x.tur === t))])), satirlar };
}

/* ── Uçtan uca (LLM) ───────────────────────────────────────────────────── */
async function cevapEval({ data, sorular, voyage, llm }) {
  const belgeler = belgeleriTopla(data);
  const onbellek = {};
  const satirlar = [];
  for (const q of sorular) {
    const r = await sor({ belgeler, soru: q.soru, symbol: q.symbol, voyage, onbellek, llm, k: 6 });
    const cevapli = q.beklenen.length > 0;
    const metin = r.cevap.toLocaleLowerCase("tr");
    const alinan = [...new Set(r.kaynaklar.map((x) => x.id))];
    satirlar.push({
      id: q.id, tur: q.tur, cevap: r.cevap, alinan,
      olgu: cevapli ? (q.ifadeler || []).filter((f) => metin.includes(f.toLocaleLowerCase("tr"))).length / Math.max(1, (q.ifadeler || []).length) : null,
      alintiKesinlik: cevapli && alinan.length ? alinan.filter((id) => q.beklenen.includes(id)).length / alinan.length : null,
      dogruCekimser: !cevapli ? !r.yeterliKanit : null,
      yanlisCekimser: cevapli ? !r.yeterliKanit : null,
      dusen: r.dusurulenAlinti,
      ms: r.iz.asamalar.toplam, tokIn: r.iz.token.llmGirdi || 0, tokOut: r.iz.token.llmCikti || 0, model: r.iz.model,
    });
    process.stdout.write(".");
  }
  process.stdout.write("\n");
  const sure = satirlar.map((x) => x.ms);
  const model = satirlar.find((x) => x.model)?.model || "";
  const fiyat = FIYAT[Object.keys(FIYAT).find((m) => model.startsWith(m))];
  const tokIn = satirlar.reduce((s, x) => s + x.tokIn, 0), tokOut = satirlar.reduce((s, x) => s + x.tokOut, 0);
  return {
    model,
    olguIsabeti: ort(satirlar.map((x) => x.olgu)),
    alintiKesinligi: ort(satirlar.map((x) => x.alintiKesinlik)),
    cekimserDogruluk: ort(satirlar.map((x) => (x.dogruCekimser == null ? null : +x.dogruCekimser))),
    yanlisCekimserOrani: ort(satirlar.map((x) => (x.yanlisCekimser == null ? null : +x.yanlisCekimser))),
    dusurulenAlinti: satirlar.reduce((s, x) => s + x.dusen, 0),
    p50ms: sirali(sure, 0.5), p95ms: sirali(sure, 0.95),
    token: { girdi: tokIn, cikti: tokOut },
    maliyetUSD: fiyat ? +((tokIn * fiyat[0] + tokOut * fiyat[1]) / 1e6).toFixed(4) : null,
    satirlar,
  };
}

/* ── CLI ───────────────────────────────────────────────────────────────── */
async function main() {
  const data = JSON.parse(await readFile(join(KOK, "eval/defter-fixture.json"), "utf8"));
  const { sorular } = JSON.parse(await readFile(join(KOK, "eval/rag-sorular.json"), "utf8"));
  const voyage = voyageIstemci();
  const modlar = [["bm25", "bm25", false]];
  if (voyage) modlar.push(["vektor", "vektor", false], ["hibrit", "hibrit", false], ["hibrit+rerank", "hibrit", true]);
  else console.log("(VOYAGE_API_KEY yok → yalnız BM25 ölçülüyor)\n");

  const rapor = { tarih: new Date().toISOString(), k: K, soruSayisi: sorular.length, retrieval: {} };
  const turler = ["sozcuk", "anlam", "sembol", "coklu"];
  console.log(`Retrieval @${K}`.padEnd(16) + "recall    MRR     nDCG  │ " + turler.map((t) => `${t} R`.padStart(10)).join(""));
  for (const [ad, mod, rerank] of modlar) {
    const r = await retrievalEval({ data, sorular, voyage, mod, rerank });
    rapor.retrieval[ad] = r;
    console.log(ad.padEnd(16) + `${yuzde(r.genel.recall)}  ${yuzde(r.genel.mrr)}  ${yuzde(r.genel.ndcg)} │ ` +
      turler.map((t) => yuzde(r.tur[t]?.recall).padStart(10)).join(""));
  }

  if (bayrak("--llm")) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("--llm için ANTHROPIC_API_KEY gerekir");
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const { askClaudeOlustur } = await import("../claude.js");
    let c; const llm = askClaudeOlustur({ istemci: () => (c ||= new Anthropic()), model: process.env.AI_MODEL || "claude-opus-4-8" });
    console.log(`\nUçtan uca (${sorular.length} soru, ${voyage ? "hibrit+rerank" : "bm25"}) `);
    const c2 = await cevapEval({ data, sorular, voyage, llm });
    rapor.cevap = c2;
    console.log(`  model                 ${c2.model}`);
    console.log(`  olgu isabeti          ${yuzde(c2.olguIsabeti)}`);
    console.log(`  alıntı kesinliği      ${yuzde(c2.alintiKesinligi)}`);
    console.log(`  çekimser doğruluk     ${yuzde(c2.cekimserDogruluk)}   (defterde olmayan soruda "bulamadım")`);
    console.log(`  yanlış çekimserlik    ${yuzde(c2.yanlisCekimserOrani)}   (cevabı olan soruda "bulamadım")`);
    console.log(`  düşürülen alıntı      ${c2.dusurulenAlinti}`);
    console.log(`  gecikme p50 / p95     ${c2.p50ms} / ${c2.p95ms} ms`);
    console.log(`  token girdi / çıktı   ${c2.token.girdi} / ${c2.token.cikti}   ≈ $${c2.maliyetUSD ?? "?"}`);
  }

  if (bayrak("--kaydet")) {
    await mkdir(join(KOK, "eval/sonuclar"), { recursive: true });
    const yol = join(KOK, `eval/sonuclar/${rapor.tarih.slice(0, 19).replace(/[:T]/g, "-")}.json`);
    await writeFile(yol, JSON.stringify(rapor, null, 1));
    console.log(`\nkaydedildi → ${yol}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
