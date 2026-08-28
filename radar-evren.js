/* radar-evren.js — radar tarama evreni ve tema haritası.
 *
 * 28 Ağu 2026: server.js'ten çıkarıldı. Sebep: tema momentum ölçümü
 * (scripts/olcum-tema.mjs) aynı gruplara ihtiyaç duyuyor ve server.js'i import
 * etmek sunucuyu ayağa kaldırır. Alternatif listeyi script'te tekrarlamaktı —
 * o an aynı, iki hafta sonra farklı olurdu ve ölçüm, panelin ölçmediği bir
 * evreni ölçerdi. Tek kaynak burası.
 *
 * Saf veri: import etmek yan etki üretmez. */

export const RADAR_GROUPS = [
  { key: "popular", title: "Popüler · Mega-Cap",
    symbols: ["AAPL","TSLA","NVDA","MSFT","AMZN","META","GOOGL","NFLX","AMD","AVGO",
              "COST","JPM","WMT","DIS","UBER","BRK.B"] },
  { key: "ai", title: "AI · Yarı İletken & Optik",
    symbols: ["MU","TSM","ARM","LRCX","KLAC","ADI","ANET",
              "COHR","LITE","FN","GLW","APH","AAOI","AXTI","MTSI","SNDK","TSEM","KEYS"] },
  { key: "tech", title: "Büyüme · Teknoloji & Yazılım",
    symbols: ["NOW","CRM","ORCL","ADBE","CDNS","TTD","SHOP","INOD","IBM"] },
  { key: "story", title: "Hikaye · Yüksek Beklenti & Tema",
    symbols: ["PLTR","SMCI","COIN","RKLB","IONQ","RGTI","OKLO","SMR","ASTS",
              "CRWD","SNOW","NET","DDOG","MDB","CELH","SOFI","AFRM","RIVN","RDDT","DKNG"] },
  { key: "fin", title: "Finans",
    symbols: ["MA","V","AXP","KKR","BLK","HOOD","MCO","CME","NDAQ"] },
  { key: "other", title: "Sağlık · Sanayi & Diğer",
    symbols: ["LLY","ISRG","JNJ","HWM","ETN","AME","WM","BWXT","HEI","NEE","ETR","AEP"] },
];
// İlk eşleştiren grup hisseye temasını verir (mega-cap bir hisse hem popüler hem AI
// olabilir → "Popüler" grubu öne alındığı için orada görünür, çift sayılmaz).
export const RADAR_THEME = {};
for (const g of RADAR_GROUPS) for (const s of g.symbols) if (!RADAR_THEME[s]) RADAR_THEME[s] = { key: g.key, title: g.title };
export const RADAR_SYMBOLS = [...new Set(RADAR_GROUPS.flatMap((g) => g.symbols))];

/** Sembolün tema başlığı — yoksa null (Cuma listesi sembolleri tema taşımaz). */
export const temaBasligi = (sym) => RADAR_THEME[String(sym || "").toUpperCase()]?.title || null;

/** {SYM: "tema başlığı"} düz haritası — ölçüm modüllerinin beklediği biçim. */
export const temaHaritasi = () =>
  Object.fromEntries(Object.entries(RADAR_THEME).map(([s, t]) => [s, t.title]));
