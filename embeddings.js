/* embeddings.js — Voyage AI istemcisi (embedding + rerank).
 *
 * Anthropic kendi embedding modeli sunmuyor; dokümanlarında önerilen sağlayıcı
 * Voyage. VOYAGE_API_KEY yoksa istemci null döner ve RAG saf BM25 ile çalışır —
 * diğer AI özellikleri gibi bu da opsiyonel.
 *
 * fetch dışarıdan verilebilir → testler ağsız koşar. */
const TABAN = "https://api.voyageai.com/v1";

export function voyageIstemci({
  anahtar = process.env.VOYAGE_API_KEY,
  model = process.env.VOYAGE_MODEL || "voyage-4-lite",
  rerankModel = process.env.VOYAGE_RERANK_MODEL || "rerank-2.5-lite",
  boyut = 512,
  fetchFn = globalThis.fetch,
} = {}) {
  if (!anahtar) return null;

  async function post(yol, govde) {
    const r = await fetchFn(`${TABAN}${yol}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${anahtar}` },
      body: JSON.stringify(govde),
    });
    if (!r.ok) {
      const e = new Error(`Voyage ${yol} → HTTP ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return r.json();
  }

  return {
    model, rerankModel,

    /* tur: "document" | "query" — Voyage ikisine farklı önek ekler; aynı
     * metni iki türde gömmek farklı vektör verir. Toplu istek: en fazla 128
     * metin/çağrı (API sınırı 1000, ama tek istekte uzun gecikmeyi önler). */
    async gom(metinler, tur = "document") {
      const vektorler = [];
      let token = 0;
      for (let i = 0; i < metinler.length; i += 128) {
        const parti = metinler.slice(i, i + 128);
        const j = await post("/embeddings", { input: parti, model, input_type: tur, output_dimension: boyut });
        for (const d of [...j.data].sort((a, b) => a.index - b.index)) vektorler.push(d.embedding);
        token += j.usage?.total_tokens || 0;
      }
      return { vektorler, token };
    },

    /* Cross-encoder rerank: sorgu ile her adayı BİRLİKTE okur → bi-encoder
     * (embedding) aramasından daha isabetli ama aday başına maliyetli. Bu yüzden
     * yalnız hibrit aramanın ilk ~20 adayına uygulanır. */
    async rerank(sorgu, belgeler, topK) {
      const j = await post("/rerank", { query: sorgu, documents: belgeler, model: rerankModel, top_k: topK });
      return { sira: j.data.map((d) => ({ i: d.index, skor: d.relevance_score })), token: j.usage?.total_tokens || 0 };
    },
  };
}
