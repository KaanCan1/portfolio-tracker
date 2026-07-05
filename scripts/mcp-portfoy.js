#!/usr/bin/env node
/* Portföy MCP sunucusu — panonun /api'sini Claude Code / Claude Desktop'a araç
 * olarak açar: "MU pozisyonum ne durumda, notlarımda ne yazmışım?" gibi sorular
 * doğrudan gerçek portföy verisiyle yanıtlanır.
 *
 * Ortam değişkenleri:
 *   PORTFOY_URL       hedef uygulama (vars: http://localhost:4010; canlı için
 *                     https://portfolio-tracker-k3pd.onrender.com)
 *   PORTFOY_PASSWORD  uygulama şifresi (auth kapalı/lokal mock ise boş bırak)
 *
 * stdio üzerinden çalışır; .mcp.json'daki "portfoy" girdisi bunu başlatır. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.PORTFOY_URL || "http://localhost:4010").replace(/\/+$/, "");
const PASSWORD = process.env.PORTFOY_PASSWORD || "";

/* ---- cookie'li mini istemci: 401'de bir kez login olup tekrar dener ---- */
let cookie = "";
async function login() {
  if (!PASSWORD) return;
  const r = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const set = r.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  if (!r.ok) throw new Error(`giriş başarısız (${r.status}) — PORTFOY_PASSWORD doğru mu?`);
}
async function api(path, opts = {}, retried = false) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) },
    redirect: "manual",
  });
  if ((r.status === 401 || r.status === 302 || r.status === 303) && PASSWORD && !retried) {
    await login();
    return api(path, opts, true);
  }
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
}

/* ---- yardımcılar: LLM'e kompakt, okunur JSON ver ---- */
const asText = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 1).slice(0, 24000) }] });
const num = (v, d = 2) => (v == null || Number.isNaN(+v) ? null : +(+v).toFixed(d));
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));

const server = new McpServer({ name: "portfoy", version: "1.0.0" });

server.tool(
  "portfoy_ozet",
  "Portföyün anlık özeti: toplam değer, gün/hafta/ay/yıl getirisi, nakit, pozisyonlar (ağırlıklarıyla) ve tetiklenen alarmlar.",
  {},
  async () => {
    const p = await api("/api/portfolio");
    const holdings = (p.holdings || []).map((h) => ({
      sembol: h.symbol, tur: h.type, adet: num(h.quantity, 4),
      maliyetUSD: num(h.costUSD), fiyatUSD: num(h?.live?.price ?? h?.live?.priceUSD),
      degerUSD: num(h?.live?.marketValueUSD), gunPct: num(h?.live?.changePct, 2),
      planStop: h.planStop ?? null, planHedef: h.planTarget ?? null,
    }));
    const totUSD = holdings.reduce((a, h) => a + (h.degerUSD || 0), 0);
    holdings.forEach((h) => (h.agirlikPct = totUSD ? num(((h.degerUSD || 0) / totUSD) * 100, 1) : null));
    holdings.sort((a, b) => (b.degerUSD || 0) - (a.degerUSD || 0));
    return asText({
      tarih: new Date().toISOString(),
      ozetMetni: p?.meta?.summaryText || null,
      toplamDegerUSD: num(totUSD),
      nakit: p.cash || null,
      getiri: pick(p?.meta || {}, ["dayPct", "weekPct", "monthPct", "ytdPct"]),
      pozisyonlar: holdings,
      tetiklenenAlarmlar: (p.alerts || []).filter((a) => a.fired || a.triggered).map((a) => pick(a, ["symbol", "type", "value"])),
    });
  },
);

server.tool(
  "pozisyon_detay",
  "Tek bir pozisyonun detayı: adet/maliyet/canlı fiyat, stop-hedef planı, açık swing işlemleri ve o sembol için Kaan'ın notları.",
  { sembol: z.string().describe("Hisse sembolü, örn. MU veya NVDA") },
  async ({ sembol }) => {
    const sym = sembol.toUpperCase().trim();
    const [p, notes, swing] = await Promise.all([
      api("/api/portfolio"),
      api("/api/notes").catch(() => []),
      api("/api/swing-trades").catch(() => null),
    ]);
    const h = (p.holdings || []).find((x) => String(x.symbol).toUpperCase() === sym);
    const swings = (swing?.trades || []).filter((t) => String(t.symbol).toUpperCase() === sym);
    return asText({
      sembol: sym,
      pozisyon: h ? {
        adet: num(h.quantity, 4), maliyetUSD: num(h.costUSD),
        fiyatUSD: num(h?.live?.price ?? h?.live?.priceUSD), degerUSD: num(h?.live?.marketValueUSD),
        gunPct: num(h?.live?.changePct, 2), planStop: h.planStop ?? null, planHedef: h.planTarget ?? null,
      } : "portföyde yok",
      acikSwingler: swings.filter((t) => t.status === "open").map((t) => pick(t, ["entry", "stop", "target", "qty", "openedAt", "note"])),
      kapanmisSwingler: swings.filter((t) => t.status === "closed").length,
      notlar: notes.filter((n) => String(n.symbol).toUpperCase() === sym)
        .map((n) => ({ etiket: n.label, tarih: String(n.createdAt || "").slice(0, 10), not: n.text })),
    });
  },
);

server.tool(
  "notlar",
  "Hisse Notları defterini listeler; etikete (alacaklarim/izliyorum/satacaklarim/tez/genel) veya sembole göre süzebilir.",
  {
    etiket: z.string().optional().describe("Etiket süzgeci: alacaklarim | izliyorum | satacaklarim | tez | genel"),
    sembol: z.string().optional().describe("Sembol süzgeci, örn. MU"),
  },
  async ({ etiket, sembol }) => {
    let list = await api("/api/notes");
    if (etiket) list = list.filter((n) => n.label === etiket.toLowerCase().trim());
    if (sembol) list = list.filter((n) => String(n.symbol).toUpperCase() === sembol.toUpperCase().trim());
    return asText(list.map((n) => ({ etiket: n.label, sembol: n.symbol || null, tarih: String(n.createdAt || "").slice(0, 10), not: n.text })));
  },
);

server.tool(
  "not_ekle",
  "Hisse Notları defterine yeni not ekler (panoda Notlar sekmesinde görünür, kalıcıdır).",
  {
    metin: z.string().describe("Not metni"),
    sembol: z.string().optional().describe("İlgili sembol, örn. MU"),
    etiket: z.string().optional().describe("alacaklarim | izliyorum | satacaklarim | tez | genel (vars: genel)"),
  },
  async ({ metin, sembol, etiket }) => {
    const n = await api("/api/notes", {
      method: "POST",
      body: JSON.stringify({ text: metin, symbol: sembol || "", label: (etiket || "genel").toLowerCase() }),
    });
    return asText({ eklendi: true, id: n.id, etiket: n.label, sembol: n.symbol || null });
  },
);

server.tool(
  "radar_tara",
  "Hisse radarını tarar: birleşik 0-100 skor, karar ve swing kurulumu (giriş/stop) olan adaylar. Skor eşiği ve yalnız-swing süzgeci alır.",
  {
    minSkor: z.number().optional().describe("En düşük birleşik skor (vars: 50)"),
    sadeceSwing: z.boolean().optional().describe("true → yalnız taze swing kurulumu (giriş/stop planı) olanlar"),
  },
  async ({ minSkor, sadeceSwing }) => {
    const r = await api("/api/radar");
    const rows = Array.isArray(r) ? r : r.stocks || r.rows || [];
    const min = minSkor ?? 50;
    const out = rows
      .filter((x) => (Number(x.score) || 0) >= min)
      .filter((x) => !sadeceSwing || x.swing)
      .map((x) => ({
        sembol: x.symbol, isim: x.name || null, skor: num(x.score, 0),
        fiyatUSD: num(x.price), hedefUSD: num(x.target), potansiyelPct: num(x.upside, 0),
        tema: x.theme || null,
        swing: x.swing ? pick(x.swing, ["type", "entry", "stop", "target", "why"]) : null,
      }))
      .sort((a, b) => (b.skor || 0) - (a.skor || 0))
      .slice(0, 25);
    return asText({ esik: min, aday: out.length, hisseler: out });
  },
);

server.tool(
  "risk_ozet",
  "Profesyonel risk masası özeti: VaR, beta, volatilite, korelasyon uyarıları ve pozisyon başına risk katkısı.",
  {},
  async () => {
    const r = await api("/api/risk");
    return asText(r);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`portfoy MCP hazır → ${BASE}${PASSWORD ? " (şifreli)" : ""}`);
