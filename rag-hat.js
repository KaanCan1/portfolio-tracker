/* rag-hat.js — RAG hattının orkestrasyonu. Ağ istemcileri DIŞARIDAN verilir
 * (voyage, llm) → sunucu, eval betiği ve testler aynı hattı koşar.
 *
 * Her çağrı bir "iz" (trace) döner: aşama başına süre, token, aday sayısı,
 * düşürülen alıntı. Sunucu bunu loglar ve son N izi saklar → kalite, gecikme
 * ve maliyet sonradan ölçülebilir (observability). */
import {
  belgeleriTopla, parcala, bm25Indeks, ara, baglamPaketi, alintilariDogrula,
  eksikVektorler, vektorleriEslestir, icerikOzeti, RAG_SCHEMA, RAG_SYSTEM,
} from "./rag.js";

const simdi = () => performance.now();
const ms = (t0) => Math.round(simdi() - t0);

/* Yalnız arama (LLM yok) — eval'in retrieval kısmı ve /api/ai/ask'ın ilk yarısı.
 * onbellek: { [icerikOzeti]: vektor } — yeni parçalar gömülünce GÜNCELLENİR;
 * çağıran kalıcı hale getirir (yeniVektorSayisi > 0 ise). */
export async function getir({ data, belgeler, soru, symbol = "", voyage = null, onbellek = {}, mod, k = 6, rerank = true }) {
  const iz = { asamalar: {}, token: { embed: 0, rerank: 0 } };
  let t = simdi();
  const parcalar = parcala(belgeler || belgeleriTopla(data));
  const indeks = bm25Indeks(parcalar);
  iz.asamalar.indeks = ms(t);
  iz.parcaSayisi = parcalar.length;

  const aktifMod = mod || (voyage ? "hibrit" : "bm25");
  let vektorler = null, sorguVektoru = null, yeniVektorSayisi = 0;
  if (voyage && aktifMod !== "bm25" && parcalar.length) {
    t = simdi();
    const eksik = eksikVektorler(parcalar, onbellek);
    if (eksik.length) {
      const { vektorler: v, token } = await voyage.gom(eksik.map((p) => p.aramaMetni), "document");
      eksik.forEach((p, n) => { onbellek[icerikOzeti(p.aramaMetni)] = v[n]; });
      iz.token.embed += token;
      yeniVektorSayisi = eksik.length;
    }
    vektorler = vektorleriEslestir(parcalar, onbellek);
    const q = await voyage.gom([soru], "query");
    sorguVektoru = q.vektorler[0];
    iz.token.embed += q.token;
    iz.asamalar.embed = ms(t);
  }

  t = simdi();
  const aday = rerank && voyage ? 20 : k;
  let bulunan = ara({ sorgu: soru, parcalar, indeks, vektorler, sorguVektoru, k: aday, mod: aktifMod, symbol });
  iz.asamalar.arama = ms(t);

  if (rerank && voyage && bulunan.length > 1) {
    t = simdi();
    const r = await voyage.rerank(soru, bulunan.map((p) => p.aramaMetni), Math.min(k, bulunan.length));
    bulunan = r.sira.map((x) => ({ ...bulunan[x.i], skor: +x.skor.toFixed(4) }));
    iz.token.rerank += r.token;
    iz.asamalar.rerank = ms(t);
  }
  bulunan = bulunan.slice(0, k);
  iz.mod = aktifMod + (rerank && voyage ? "+rerank" : "");
  iz.bulunan = bulunan.map((p) => ({ id: p.id, skor: p.skor }));
  return { bulunan, iz, yeniVektorSayisi };
}

/* Tam hat: getir → Claude → alıntı doğrulama.
 * llm: ({system, payload, schema}) => {result, model, usage} — server.js'teki
 * askClaude ile aynı imza. Hiç parça bulunamazsa LLM ÇAĞRILMAZ: kanıtsız
 * soruya para ödemenin ve modelin boşluğu doldurmaya zorlanmasının anlamı yok. */
export async function sor({ llm, ...opts }) {
  const t0 = simdi();
  const { bulunan, iz, yeniVektorSayisi } = await getir(opts);
  if (!bulunan.length) {
    iz.asamalar.toplam = ms(t0);
    return {
      cevap: "Defterde bununla ilgili kayıt bulamadım.", yeterliKanit: false, kaynaklar: [],
      dusurulenAlinti: 0, iz, yeniVektorSayisi,
    };
  }
  const t = simdi();
  const { result, model, usage } = await llm({ system: RAG_SYSTEM, payload: baglamPaketi(opts.soru, bulunan), schema: RAG_SCHEMA });
  iz.asamalar.llm = ms(t);
  iz.asamalar.toplam = ms(t0);
  iz.model = model;
  iz.token.llmGirdi = usage?.in ?? null;
  iz.token.llmCikti = usage?.out ?? null;
  const dogrulanmis = alintilariDogrula(result, bulunan);
  iz.dusurulenAlinti = dogrulanmis.dusurulenAlinti;
  return { ...dogrulanmis, iz, yeniVektorSayisi };
}
