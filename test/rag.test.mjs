/* GERÇEK modülleri import eder: rag.js, rag-hat.js, embeddings.js, eval betiği. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  sozcukle, parcala, bm25Indeks, rrf, ara, alintilariDogrula, belgeleriTopla,
  eksikVektorler, icerikOzeti, retrievalMetrikleri, baglamPaketi,
} from "../rag.js";
import { getir, sor } from "../rag-hat.js";
import { voyageIstemci } from "../embeddings.js";
import { retrievalEval } from "../scripts/rag-eval.mjs";

const fixture = JSON.parse(readFileSync(new URL("../eval/defter-fixture.json", import.meta.url)));
const { sorular } = JSON.parse(readFileSync(new URL("../eval/rag-sorular.json", import.meta.url)));
const belge = (id, metin, ek = {}) => ({ id, kaynak: "not", symbol: "", tarih: "2026-01-01", baslik: "Not", metin, ...ek });

test("sozcukle: Türkçe ekler aynı köke iner, aksanlar katlanır", () => {
  assert.equal(sozcukle("Pozisyonlarımı")[0], sozcukle("pozisyon")[0]);
  assert.equal(sozcukle("ŞİRKET")[0], "sirke");
  assert.deepEqual(sozcukle("ve bu bir"), [], "durak kelimeler düşer");
  assert.deepEqual(sozcukle("%15 nakit"), ["%15", "nakit"]);
});

test("parcala: uzun metin örtüşmeli parçalara bölünür, başlık arama metnine eklenir", () => {
  const uzun = Array.from({ length: 30 }, (_, i) => `Cümle numarası ${i} burada bitiyor.`).join(" ");
  const p = parcala([belge("x", uzun, { baslik: "Tez — MU" })], { maks: 200, ortusme: 40 });
  assert.ok(p.length > 3);
  assert.ok(p.every((x) => x.belgeId === "x" && x.aramaMetni.startsWith("Tez — MU")));
  assert.ok(p.every((x) => x.metin.length <= 260));
  assert.equal(new Set(p.map((x) => x.id)).size, p.length, "parça kimlikleri tekil");
});

test("bm25: terimi içeren belge öne çıkar, eşleşmeyen dönmez", () => {
  const p = parcala([belge("a", "Altın portföyün sigortası"), belge("b", "NVDA bilanço sonrası"), belge("c", "Nakit oranı")]);
  const r = bm25Indeks(p).ara("altın sigortası");
  assert.equal(p[r[0].i].belgeId, "a");
  assert.ok(!r.some((x) => p[x.i].belgeId === "b"));
});

test("rrf: iki listede de üstte olan kazanır", () => {
  const r = rrf([[{ i: 1 }, { i: 2 }, { i: 3 }], [{ i: 2 }, { i: 1 }, { i: 4 }]]);
  assert.deepEqual(r.slice(0, 2).map((x) => x.i).sort(), [1, 2]);
  assert.equal(r.at(-1).i === 3 || r.at(-1).i === 4, true);
});

test("ara: sembol filtresi başka sembolün parçalarını dışlar, genel notları tutar", () => {
  const p = parcala([belge("mu", "stop kuralı", { symbol: "MU" }), belge("ts", "stop kuralı", { symbol: "TSLA" }), belge("g", "stop kuralı")]);
  const r = ara({ sorgu: "stop kuralı", parcalar: p, mod: "bm25", symbol: "mu" });
  assert.deepEqual(r.map((x) => x.belgeId).sort(), ["g", "mu"]);
});

test("alintilariDogrula: uydurma etiket düşer, alıntısız cevap kanıtsız sayılır", () => {
  const bulunan = parcala([belge("a", "x"), belge("b", "y")]);
  const r = alintilariDogrula({ cevap: "...", alintilar: ["K2", "K9", "K2"], yeterli_kanit: true }, bulunan);
  assert.deepEqual(r.kaynaklar.map((x) => x.id), ["b"]);
  assert.equal(r.dusurulenAlinti, 1);
  assert.equal(r.yeterliKanit, true);
  assert.equal(alintilariDogrula({ cevap: "uydurma", alintilar: ["K7"], yeterli_kanit: true }, bulunan).yeterliKanit, false);
  assert.equal(alintilariDogrula({ cevap: "yok", alintilar: [], yeterli_kanit: false }, bulunan).yeterliKanit, false);
});

test("baglamPaketi: modele uzun kimlik değil kısa etiket gider", () => {
  const pk = baglamPaketi("soru?", parcala([belge("gizli-kimlik", "metin")]));
  assert.equal(pk.kaynaklar[0].etiket, "K1");
  assert.ok(!JSON.stringify(pk).includes("gizli-kimlik"));
});

test("belgeleriTopla: not, tez ve denetim belgeleri kararlı kimlikle üretilir", () => {
  const b = belgeleriTopla(fixture);
  assert.equal(b.filter((x) => x.kaynak === "not").length, fixture.notes.length);
  assert.ok(b.some((x) => x.id === "tez:MU" && x.metin.includes("Kırmızı çizgiler")));
  assert.ok(b.some((x) => x.id === "denetim:2026-07-28" && x.metin.includes("Yarının kuralı")));
});

test("retrievalMetrikleri: recall/MRR/nDCG", () => {
  const m = retrievalMetrikleri(["x", "a", "a", "b"], ["a", "b"], 3);
  assert.equal(m.recall, 1);
  assert.equal(m.mrr, 0.5);
  assert.ok(m.ndcg > 0 && m.ndcg < 1);
  assert.equal(retrievalMetrikleri(["x"], ["a"], 3).mrr, 0);
});

/* Sahte Voyage: metindeki anahtar kelimelere göre 3 boyutlu vektör üretir,
 * rerank sırayı ters çevirir. Ağ yok; çağrılar sayılır. */
function sahteVoyage() {
  const sayac = { embed: 0, gomulen: 0, rerank: 0 };
  const vek = (t) => { const s = t.toLowerCase(); return [+(s.includes("altın")), +(s.includes("nakit")), 0.1]; };
  const fetchFn = async (url, { body }) => {
    const j = JSON.parse(body);
    if (url.endsWith("/embeddings")) {
      sayac.embed++; sayac.gomulen += j.input.length;
      return { ok: true, json: async () => ({ data: j.input.map((t, index) => ({ index, embedding: vek(t) })), usage: { total_tokens: 7 } }) };
    }
    sayac.rerank++;
    return { ok: true, json: async () => ({ data: j.documents.map((_, n) => ({ index: j.documents.length - 1 - n, relevance_score: 1 - n / 10 })).slice(0, j.top_k), usage: { total_tokens: 3 } }) };
  };
  return { sayac, istemci: voyageIstemci({ anahtar: "test", fetchFn }) };
}

test("voyageIstemci: anahtar yoksa null (saf BM25'e düşülür)", () => {
  assert.equal(voyageIstemci({ anahtar: "" }), null);
});

test("getir: vektörler önbellekten gelir, değişmeyen parça yeniden gömülmez", async () => {
  const { sayac, istemci } = sahteVoyage();
  const belgeler = [belge("a", "Altın sigortadır"), belge("b", "Nakit mermidir")];
  const onbellek = {};
  const r1 = await getir({ belgeler, soru: "altın", voyage: istemci, onbellek, rerank: false });
  assert.equal(r1.yeniVektorSayisi, 2);
  assert.equal(r1.bulunan[0].belgeId, "a");
  assert.equal(r1.iz.mod, "hibrit");
  const r2 = await getir({ belgeler, soru: "nakit", voyage: istemci, onbellek, rerank: false });
  assert.equal(r2.yeniVektorSayisi, 0, "ikinci çağrıda belge gömülmemeli");
  assert.equal(sayac.gomulen, 2 + 1 + 1, "2 belge + 2 sorgu");
  assert.ok(onbellek[icerikOzeti(parcala(belgeler)[0].aramaMetni)]);
  assert.equal(eksikVektorler(parcala(belgeler), onbellek).length, 0);
});

test("getir: rerank sırayı yeniden belirler ve izde görünür", async () => {
  const { sayac, istemci } = sahteVoyage();
  const belgeler = [belge("a", "Altın nakit"), belge("b", "Altın"), belge("c", "Nakit")];
  const r = await getir({ belgeler, soru: "altın nakit", voyage: istemci, k: 3 });
  assert.equal(sayac.rerank, 1);
  assert.equal(r.iz.mod, "hibrit+rerank");
  assert.ok(Number.isFinite(r.iz.asamalar.rerank));
});

test("sor: hiç kanıt yoksa LLM ÇAĞRILMAZ", async () => {
  let cagri = 0;
  const r = await sor({ belgeler: [belge("a", "altın")], soru: "bitcoin kriptopara", llm: async () => { cagri++; } });
  assert.equal(cagri, 0);
  assert.equal(r.yeterliKanit, false);
});

test("sor: LLM cevabı doğrulanır, iz token ve süre taşır", async () => {
  const llm = async ({ payload, schema }) => {
    assert.deepEqual(schema.required, ["cevap", "alintilar", "yeterli_kanit"]);
    assert.equal(payload.kaynaklar[0].etiket, "K1");
    return { result: { cevap: "Stopsuz tutmuyorsun [K1]", alintilar: ["K1", "K99"], yeterli_kanit: true }, model: "m", usage: { in: 100, out: 20 } };
  };
  const r = await sor({ data: fixture, soru: "stopsuz pozisyon", llm });
  assert.equal(r.kaynaklar[0].id, "not:n03");
  assert.equal(r.dusurulenAlinti, 1);
  assert.equal(r.iz.token.llmGirdi, 100);
  assert.ok(Number.isFinite(r.iz.asamalar.toplam));
});

/* Regresyon kapısı: BM25 retrieval kalitesi altın sette bu eşiklerin altına
 * inerse (ör. sözcükleyici bozulursa) CI kırmızı yanar. Eşikler ölçülen
 * değerin biraz altında — gürültüye değil gerilemeye tepki versin. */
test("eval kapısı: BM25 recall@5 ve MRR eşiğin üstünde", async () => {
  const r = await retrievalEval({ data: fixture, sorular, mod: "bm25", k: 5 });
  assert.ok(r.genel.recall >= 0.85, `recall@5 = ${r.genel.recall}`);
  assert.ok(r.genel.mrr >= 0.75, `MRR = ${r.genel.mrr}`);
});
