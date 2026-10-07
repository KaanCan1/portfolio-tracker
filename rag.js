/* rag.js — "Defterime sor": notlar, tezler ve gün denetimleri üzerinde RAG.
 * Saf modül: ağ, pg ve Claude bilmez → testler ve eval GERÇEK kodu import eder.
 *
 * NEDEN VAR: Panoda aylardır biriken notlar/tezler/denetimler yalnız sembole
 * göre listeleniyordu. "Stopsuz pozisyonla ilgili kendime ne kural koymuştum?"
 * gibi bir soru tek tek okumadan cevaplanamıyordu. Bu modül soruya en ilgili
 * parçaları bulur; Claude yalnız o parçalara dayanarak ve KAYNAK GÖSTEREREK
 * cevap verir.
 *
 * Akış:  belgeleriTopla → parcala → (BM25 ∥ vektör) → RRF füzyonu → [rerank]
 *        → bağlam paketi → Claude (json_schema) → alintilariDogrula
 *
 * Tasarım kararları:
 * - HİBRİT arama: BM25 sembol/terim eşleşmesinde ("MU", "ADR") güçlü, vektör
 *   eş anlamlıda ("zarar kes" ↔ "stop") güçlü. İkisi Reciprocal Rank Fusion ile
 *   birleşir — skor ölçekleri farklı olduğu için skor değil SIRA birleştirilir.
 * - Vektör sağlayıcı (Voyage) opsiyonel: anahtar yoksa saf BM25'e düşer, uç
 *   yine çalışır. Eval her iki modu da ölçer.
 * - Türkçe eklemeli bir dil: "stopları", "stopsuz", "stop" aynı köke inmeli.
 *   Tam bir kök bulucu yerine ilk 5 harfe kırpma (prefix stemming) kullanılır —
 *   Türkçe IR literatüründe basit ve şaşırtıcı derecede iyi çalışan yöntem.
 */
import crypto from "node:crypto";

/* ── Belgeler ──────────────────────────────────────────────────────────────
 * Panonun kendi verisinden aranabilir belgeler üretir. Her belgenin kimliği
 * kararlıdır (kaynak:anahtar) → alıntılar ve embedding önbelleği buna bağlanır. */
export function belgeleriTopla(data = {}) {
  const out = [];
  for (const n of data.notes || []) {
    if (!n?.text) continue;
    out.push({
      id: `not:${n.id}`, kaynak: "not", symbol: up(n.symbol), tarih: gun(n.updatedAt || n.createdAt),
      baslik: `Not${n.label ? ` (${n.label})` : ""}${n.symbol ? ` — ${up(n.symbol)}` : ""}`,
      metin: String(n.text),
    });
  }
  for (const [sym, rec] of Object.entries(data.aiTheses || {})) {
    const r = rec?.result;
    if (!r) continue;
    out.push({
      id: `tez:${up(sym)}`, kaynak: "tez", symbol: up(sym), tarih: gun(rec.at),
      baslik: `Yatırım tezi — ${up(sym)} (${r.karar || "?"})`,
      metin: [
        r.ozet,
        liste("Boğa", r.boga_tezi), liste("Ayı", r.ayi_tezi),
        liste("Riskler", r.riskler), liste("Kırmızı çizgiler", r.kirmizi_cizgiler),
        r.seviyeler?.aciklama,
      ].filter(Boolean).join("\n"),
    });
  }
  for (const [tarih, rec] of Object.entries(data.aiDayReviews || {})) {
    const r = rec?.result;
    if (!r) continue;
    out.push({
      id: `denetim:${tarih}`, kaynak: "denetim", symbol: "", tarih: gun(tarih),
      baslik: `Gün denetimi — ${gun(tarih)} (disiplin ${r.disiplin_notu ?? "?"}/100)`,
      metin: [
        r.genel,
        ...(r.islemler || []).map((i) => `${i.symbol}: ${i.karar} — ${i.gerekce} Ders: ${i.ders}`),
        r.yarin_kurali ? `Yarının kuralı: ${r.yarin_kurali}` : "",
      ].filter(Boolean).join("\n"),
    });
  }
  return out;
}

/* ── Parçalama ─────────────────────────────────────────────────────────────
 * Notlar kısa (tek parça); tez ve denetimler uzun olabilir. Cümle sınırında
 * böler, parçalar arası örtüşme bırakır ki bir fikir iki parçanın sınırında
 * kaybolmasın. Başlık her parçanın başına eklenir: "MU" geçmeyen bir tez
 * paragrafı bile MU sorgusunda bulunabilsin (contextual chunking). */
export function parcala(belgeler, { maks = 700, ortusme = 120 } = {}) {
  const out = [];
  for (const b of belgeler) {
    const cumleler = String(b.metin).split(/(?<=[.!?\n])\s+/).filter(Boolean);
    let buf = "", sira = 0;
    const it = () => {
      if (!buf.trim()) return;
      out.push({ ...b, belgeId: b.id, id: `${b.id}#${sira++}`, metin: buf.trim(), aramaMetni: `${b.baslik}\n${buf.trim()}` });
    };
    for (const c of cumleler) {
      if (buf && buf.length + c.length + 1 > maks) {
        it();
        buf = buf.slice(-ortusme);
      }
      buf += (buf ? " " : "") + c;
    }
    it();
  }
  return out;
}

/* ── Sözcükleme (Türkçe duyarlı) ──────────────────────────────────────────── */
const DURAK = new Set(("ve veya ile de da ki bu şu o bir için gibi daha çok en ne mi mı mu mü " +
  "ama fakat ise kadar sonra önce olan olarak var yok ben sen biz the a an of to in is and or").split(" "));
export function sozcukle(metin) {
  return String(metin || "")
    .toLocaleLowerCase("tr")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")   // ç→c, ş→s, ğ→g, ö→o, ü→u
    .replace(/ı/g, "i")
    .split(/[^a-z0-9%$.]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter((t) => t.length > 1 && !DURAK.has(t))
    .map((t) => (/^\d/.test(t) ? t : t.slice(0, 5)));     // prefix stemming
}

/* ── BM25 ──────────────────────────────────────────────────────────────── */
export function bm25Indeks(parcalar, { k1 = 1.2, b = 0.75 } = {}) {
  const dokuman = parcalar.map((p) => sozcukle(p.aramaMetni ?? p.metin));
  const df = new Map();
  for (const toks of dokuman) for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
  const N = dokuman.length || 1;
  const ort = dokuman.reduce((s, d) => s + d.length, 0) / N || 1;
  const tf = dokuman.map((toks) => {
    const m = new Map();
    for (const t of toks) m.set(t, (m.get(t) || 0) + 1);
    return m;
  });
  return {
    ara(sorgu, k = 10) {
      const q = [...new Set(sozcukle(sorgu))];
      const skor = tf.map((m, i) => {
        let s = 0;
        for (const t of q) {
          const f = m.get(t);
          if (!f) continue;
          const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
          s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * dokuman[i].length / ort));
        }
        return { i, skor: s };
      });
      return skor.filter((x) => x.skor > 0).sort((a, b2) => b2.skor - a.skor).slice(0, k);
    },
  };
}

/* ── Vektör arama ──────────────────────────────────────────────────────── */
export function kosinus(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}
export function vektorAra(sorguVektoru, vektorler, k = 10) {
  return vektorler
    .map((v, i) => ({ i, skor: v ? kosinus(sorguVektoru, v) : -1 }))
    .filter((x) => x.skor > -1)
    .sort((a, b) => b.skor - a.skor)
    .slice(0, k);
}

/* ── Reciprocal Rank Fusion ─────────────────────────────────────────────────
 * score(d) = Σ 1/(k + sıra). k=60 literatürdeki standart (Cormack ve ark. 2009). */
export function rrf(listeler, { k = 60 } = {}) {
  const top = new Map();
  for (const liste of listeler) {
    liste.forEach((x, sira) => top.set(x.i, (top.get(x.i) || 0) + 1 / (k + sira + 1)));
  }
  return [...top.entries()].map(([i, skor]) => ({ i, skor })).sort((a, b) => b.skor - a.skor);
}

/* ── Hibrit arama ───────────────────────────────────────────────────────────
 * mod: "bm25" | "vektor" | "hibrit". Sembol filtresi bir metaveri filtresidir:
 * verilirse yalnız o sembolün parçaları + sembolsüz (genel) parçalar aranır. */
export function ara({ sorgu, parcalar, indeks, vektorler = null, sorguVektoru = null, k = 6, aday = 20, mod = "hibrit", symbol = "" }) {
  const sym = up(symbol);
  const izinli = (i) => !sym || !parcalar[i].symbol || parcalar[i].symbol === sym;
  const lex = mod !== "vektor" ? (indeks || bm25Indeks(parcalar)).ara(sorgu, aday * 2).filter((x) => izinli(x.i)).slice(0, aday) : [];
  const vek = mod !== "bm25" && vektorler && sorguVektoru
    ? vektorAra(sorguVektoru, vektorler, aday * 2).filter((x) => izinli(x.i)).slice(0, aday) : [];
  const birlesik = !vek.length ? lex : !lex.length ? vek : rrf([lex, vek]);
  return birlesik.slice(0, k).map((x) => ({ ...parcalar[x.i], skor: +x.skor.toFixed(5) }));
}

/* ── Bağlam paketi ───────────────────────────────────────────────────────────
 * Claude'a giden kanıt. Her parçanın kısa bir etiketi var ([K1], [K2]...) —
 * model yalnız bu etiketlerle alıntı yapabilir, biz de etiketi gerçek parçaya
 * geri çeviririz. Uzun kimlikleri modele vermemek uydurma alıntıyı zorlaştırır. */
export function baglamPaketi(soru, bulunan) {
  return {
    soru: String(soru).slice(0, 500),
    kaynaklar: bulunan.map((p, n) => ({
      etiket: `K${n + 1}`, tur: p.kaynak, baslik: p.baslik, tarih: p.tarih, metin: p.metin,
    })),
  };
}

/* ── Alıntı doğrulama (guardrail) ───────────────────────────────────────────
 * Model şemaya uysa bile var olmayan bir etiketi alıntılayabilir. Geçersiz
 * alıntılar düşülür ve sayılır; hiç geçerli alıntı kalmayan "cevap" ise
 * kanıtsız sayılır → kullanıcıya bunu açıkça söyleriz. */
export function alintilariDogrula(sonuc, bulunan) {
  const gecerli = new Map(bulunan.map((p, n) => [`K${n + 1}`, p]));
  const alintilar = [...new Set(sonuc?.alintilar || [])];
  const tutulan = alintilar.filter((e) => gecerli.has(e));
  const kanitYok = sonuc?.yeterli_kanit === false || (!tutulan.length && !!sonuc?.cevap);
  return {
    cevap: sonuc?.cevap || "",
    yeterliKanit: !kanitYok,
    kaynaklar: tutulan.map((e) => {
      const p = gecerli.get(e);
      return { etiket: e, id: p.belgeId, parca: p.id, baslik: p.baslik, tarih: p.tarih };
    }),
    dusurulenAlinti: alintilar.length - tutulan.length,
  };
}

/* ── Embedding önbelleği ───────────────────────────────────────────────────
 * Parça metninin özeti değişmediyse vektör yeniden hesaplanmaz → maliyet her
 * istekte değil yalnız yeni/değişen not için ödenir. */
export const icerikOzeti = (metin) => crypto.createHash("sha256").update(String(metin)).digest("hex").slice(0, 16);
export function eksikVektorler(parcalar, onbellek = {}) {
  return parcalar.filter((p) => !onbellek[icerikOzeti(p.aramaMetni)]);
}
export function vektorleriEslestir(parcalar, onbellek = {}) {
  return parcalar.map((p) => onbellek[icerikOzeti(p.aramaMetni)] || null);
}

/* ── Retrieval metrikleri (eval) ────────────────────────────────────────── */
export function retrievalMetrikleri(bulunanBelgeIdleri, beklenen, k) {
  const ilkK = [...new Set(bulunanBelgeIdleri)].slice(0, k);
  const hedef = new Set(beklenen);
  const isabet = ilkK.filter((id) => hedef.has(id)).length;
  const ilk = ilkK.findIndex((id) => hedef.has(id));
  let dcg = 0, idcg = 0;
  ilkK.forEach((id, n) => { if (hedef.has(id)) dcg += 1 / Math.log2(n + 2); });
  for (let n = 0; n < Math.min(hedef.size, k); n++) idcg += 1 / Math.log2(n + 2);
  return {
    recall: hedef.size ? isabet / hedef.size : null,
    mrr: ilk < 0 ? 0 : 1 / (ilk + 1),
    ndcg: idcg ? dcg / idcg : null,
  };
}

/* ── Claude sözleşmesi ───────────────────────────────────────────────────── */
export const RAG_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["cevap", "alintilar", "yeterli_kanit"],
  properties: {
    cevap: { type: "string", description: "Kaynaklara dayanan kısa cevap; cümle sonlarında [K1] gibi etiketlerle" },
    alintilar: { type: "array", items: { type: "string" }, description: "Cevapta kullanılan kaynak etiketleri (ör. K1, K3)" },
    yeterli_kanit: { type: "boolean", description: "Kaynaklar soruyu cevaplamaya yetiyor mu" },
  },
};
export const RAG_SYSTEM = `Kaan'ın kişisel yatırım defterinden (notlar, yatırım tezleri, gün denetimleri) soru cevaplıyorsun.

Kurallar:
- YALNIZ "kaynaklar" listesindeki metinlere dayan. Genel piyasa bilgisi, tahmin veya yorum ekleme.
- Her iddianın sonuna dayandığı kaynağın etiketini koy: [K1], [K2]. alintilar alanına kullandığın etiketleri yaz.
- Kaynaklar soruyu cevaplamaya yetmiyorsa yeterli_kanit=false yap, cevapta "Defterde bununla ilgili kayıt bulamadım" de ve en yakın ilgili kaydı varsa belirt. Boşluğu tahminle doldurma.
- Kaynaklar çelişiyorsa tarihleriyle birlikte ikisini de söyle; yeni tarihli olanı öne al.
- Türkçe, kısa ve net yaz. Yatırım tavsiyesi verme; Kaan'ın kendi yazdıklarını hatırlat.`;

/* ── yardımcılar ─────────────────────────────────────────────────────────── */
function up(s) { return String(s || "").toUpperCase().trim(); }
function gun(s) { return String(s || "").slice(0, 10); }
function liste(ad, xs) { return Array.isArray(xs) && xs.length ? `${ad}: ${xs.join("; ")}` : ""; }
