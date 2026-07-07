import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import http2 from "node:http2";
import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { qmAnalyze } from "./qm.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, "portfolio.json");

/* ----------------------------- .env yükleyici -----------------------------
 * Bağımlılıksız: kök dizindeki .env satırlarını (KEY=VALUE) process.env'e
 * basar (zaten tanımlı olanları ezmez). Render'da env panelinden gelir. */
(() => {
  try {
    const txt = readFileSync(join(__dirname, ".env"), "utf8");
    for (const line of txt.split("\n")) {
      const s = line.trim();
      if (!s || s.startsWith("#")) continue;
      const i = s.indexOf("=");
      if (i < 0) continue;
      const k = s.slice(0, i).trim();
      let v = s.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (k && process.env[k] === undefined) process.env[k] = v;
    }
  } catch {}
})();

const PORT = process.env.PORT || 3000;
const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";
const TD_KEY = process.env.TWELVEDATA_API_KEY || "";

const app = express();
app.use(express.json());

/* ============================== Kimlik doğrulama ==============================
 * Tek şifre kapısı. Şifre düz metin saklanmaz: auth.json içinde salt+SHA-256.
 * Oturum, sunucu sırrıyla HMAC imzalı çerez (durumsuz, restart'a dayanıklı).
 * Render gibi ortamlarda AUTH_PASSWORD / AUTH_SECRET env ile geçersiz kılınır. */
const AUTH = (() => {
  let cfg = {};
  try { cfg = JSON.parse(readFileSync(join(__dirname, "auth.json"), "utf8")); } catch {}
  const secret = process.env.AUTH_SECRET || cfg.secret || crypto.randomBytes(32).toString("hex");
  if (process.env.AUTH_PASSWORD) {
    const salt = process.env.AUTH_SALT || "static-env-salt";
    cfg = { salt, hash: crypto.createHash("sha256").update(salt + process.env.AUTH_PASSWORD).digest("hex"), secret };
  }
  cfg.secret = secret;
  return cfg;
})();
const SESSION_DAYS = 30;

function checkPassword(pw) {
  if (!AUTH.hash || !AUTH.salt || typeof pw !== "string") return false;
  const h = crypto.createHash("sha256").update(AUTH.salt + pw).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(AUTH.hash)); } catch { return false; }
}
function signSession() {
  const exp = Date.now() + SESSION_DAYS * 86400_000;
  const sig = crypto.createHmac("sha256", AUTH.secret).update(String(exp)).digest("hex");
  return `${exp}.${sig}`;
}
function verifySession(tok) {
  if (!tok || typeof tok !== "string") return false;
  const i = tok.indexOf(".");
  if (i < 0) return false;
  const exp = tok.slice(0, i), sig = tok.slice(i + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const good = crypto.createHmac("sha256", AUTH.secret).update(exp).digest("hex");
  try { return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good)); } catch { return false; }
}
function parseCookies(header) {
  const out = {};
  (header || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function isAuthed(req) { return verifySession(parseCookies(req.headers.cookie).sid); }

// Kapı: korunmayan yollar dışında her şey geçerli oturum ister
const OPEN_PATHS = new Set(["/login", "/login.html", "/style.css", "/api/login", "/healthz", "/brand.svg", "/panda.svg"]);
app.use((req, res, next) => {
  if (!AUTH.hash) return next(); // şifre yapılandırılmamış → açık mod (lokal/demo; canlıda AUTH_PASSWORD ayarla)
  if (OPEN_PATHS.has(req.path) || isAuthed(req)) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "auth_required" });
  return res.redirect("/login");
});

// Keep-alive / sağlık ucu (auth'suz) — uptime ping'i Render'ı uyutmaz, böylece
// gün içi 15dk'lık portföy noktaları birikir ve TD taraması her restart'ta
// baştan yapılmaz (kota korunur).
// storage: "postgres" → Supabase/Postgres kalıcı depolama aktif (veri deploy/uykuda
// kaybolmaz). "file" → eski dosya modu (Render free diskte GEÇİCİ). dbPool yalnızca
// DATABASE_URL ayarlı VE bağlantı başarılıysa dolu olur; sessiz fallback'i ele verir.
app.get("/healthz", (_req, res) =>
  res.json({ ok: true, t: Date.now(), storage: dbPool ? "postgres" : "file", db: !!dbPool }));

app.get("/login", (_req, res) => res.sendFile(join(__dirname, "public", "login.html")));

app.post("/api/login", (req, res) => {
  if (!checkPassword(req.body?.password)) {
    return res.status(401).json({ ok: false, error: "Şifre hatalı" });
  }
  const secure = req.headers["x-forwarded-proto"] === "https";
  res.setHeader("Set-Cookie",
    `sid=${signSession()}; HttpOnly; Path=/; Max-Age=${SESSION_DAYS * 86400}; SameSite=Lax${secure ? "; Secure" : ""}`);
  res.json({ ok: true });
});

app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
  res.json({ ok: true });
});

// Asset cache-busting: index.html sunulurken style.css/app.js'e dosya mtime'ından sürüm
// eklenir (her deploy'da değişir → tarayıcı/Render CDN eski CSS/JS'i önbellekten vermez).
// HTML'in kendisi no-cache → sürüm sorgusu her zaman taze okunur.
const assetVer = (f) => { try { return Math.floor(statSync(join(__dirname, "public", f)).mtimeMs).toString(36); } catch { return "1"; } };
app.get(["/", "/index.html"], (_req, res) => {
  try {
    const html = readFileSync(join(__dirname, "public", "index.html"), "utf8")
      .replace('href="style.css"', `href="style.css?v=${assetVer("style.css")}"`)
      .replace('src="app.js"', `src="app.js?v=${assetVer("app.js")}"`);
    res.set("Cache-Control", "no-cache").type("html").send(html);
  } catch { res.sendFile(join(__dirname, "public", "index.html")); }
});

app.use(express.static(join(__dirname, "public")));

/* ----------------------------- Veri deposu ----------------------------- */
/* ----------------------------- Kalıcı depolama -----------------------------
 * DATABASE_URL tanımlıysa Postgres kullanılır (Supabase / Neon / herhangi bir
 * Postgres) — Render free planın GEÇİCİ diskinde veri kaybını önler. Tanımsızsa
 * yerel JSON dosyası (geliştirme). Tüm uygulama verisi tek bir JSON belgesi
 * olarak app_data tablosunda 'portfolio' anahtarında tutulur; boş DB ilk
 * açılışta dosyadan tohumlanır (commit'li portfolio.json = başlangıç verisi).
 * Supabase için "Session pooler" bağlantı dizesini kullan (IPv4 + tam uyumlu). */
const DB_URL = process.env.DATABASE_URL || "";
const STORE_KEY = "portfolio";
let dbPool = null;
if (DB_URL) {
  try {
    const pg = await import("pg");
    // SSL: barındırılan DB (Supabase/Neon) ister; yerel/localhost istemez.
    const needSsl = !/localhost|127\.0\.0\.1|sslmode=disable/.test(DB_URL);
    dbPool = new pg.default.Pool({
      connectionString: DB_URL,
      ssl: needSsl ? { rejectUnauthorized: false } : false,
      max: 4, keepAlive: true, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 12_000,
    });
    // Boştaki bağlantı kopması (pooler timeout) süreci ÇÖKERTMESİN
    dbPool.on("error", (e) => console.error("  DB havuz hatası (yoksayıldı):", e.message));
    await dbPool.query("CREATE TABLE IF NOT EXISTS app_data (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz DEFAULT now())");
    console.log("  Kalıcı depolama → Postgres ✓");
  } catch (e) {
    console.error("  ⚠️ DB bağlanamadı, dosya moduna düşülüyor:", e.message);
    dbPool = null;
  }
}
async function loadData() {
  if (dbPool) {
    const r = await dbPool.query("SELECT value FROM app_data WHERE key=$1", [STORE_KEY]);
    if (r.rows.length) return r.rows[0].value;
    let seed = {};
    try { seed = JSON.parse(await readFile(DATA_FILE, "utf8")); } catch {}
    await dbPool.query("INSERT INTO app_data(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING", [STORE_KEY, seed]);
    return seed;
  }
  return JSON.parse(await readFile(DATA_FILE, "utf8"));
}
async function saveData(data) {
  if (dbPool) {
    await dbPool.query(
      "INSERT INTO app_data(key,value,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()",
      [STORE_KEY, data]);
    return;
  }
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

/* Genel anahtar-değer kalıcılığı (app_data tablosu) — Render free diskinin
 * GEÇİCİ olması yüzünden restart'ta kaybolan önbellekler (radar taraması,
 * mum önbelleği) Postgres'te de saklanır → uyanınca radar ANINDA dolu gelir,
 * arka plan taraması sadece tazelemek için çalışır. Dosya modu etkilenmez. */
async function kvLoad(key) {
  if (!dbPool) return null;
  try {
    const r = await dbPool.query("SELECT value FROM app_data WHERE key=$1", [key]);
    return r.rows.length ? r.rows[0].value : null;
  } catch { return null; }
}
async function kvSave(key, value) {
  if (!dbPool) return;
  try {
    await dbPool.query(
      "INSERT INTO app_data(key,value,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()",
      [key, value]);
  } catch {}
}

/* ===== Alfa Avı challenge defteri — SADECE-EKLE (immutable açılışlar) =====
 * Client stratejiyi similar; açılan her plan buraya bir kez yazılır ve bir daha
 * DEĞİŞMEZ. Böylece Radar/Swing evreni değişse de geçmiş kararlar kaymaz
 * (%100 dürüst kayıt). Çıkışlar frozen parametrelerden deterministik hesaplanır. */
const CH_KEY = "challenge_ledger";
const CH_FILE = join(__dirname, "challenge_ledger.json");
async function chLoadLedger() {
  if (dbPool) {
    const r = await dbPool.query("SELECT value FROM app_data WHERE key=$1", [CH_KEY]);
    return r.rows.length ? r.rows[0].value : { trades: [] };
  }
  try { return JSON.parse(await readFile(CH_FILE, "utf8")); } catch { return { trades: [] }; }
}
async function chSaveLedger(led) {
  if (dbPool) {
    await dbPool.query(
      "INSERT INTO app_data(key,value,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()",
      [CH_KEY, led]);
    return;
  }
  await writeFile(CH_FILE, JSON.stringify(led, null, 1), "utf8");
}
app.get("/api/challenge", async (_req, res) => {
  try {
    const led = await chLoadLedger();
    // Client paritesi için ek bağlam (deftere YAZILMAZ): bilanço takvimi, sektörler, gerçek VIX.
    // Soğuk açılışta boş olabilirler — motor 90 sn sonra doldurur; client zarifçe VIXY'ye/filtresize düşer.
    res.json({ ...led, earnings: CH_EARN.map, sectors: CH_SECT.map, vix: vixCache.v ? vixCache.v.slice(-260) : null });
  }
  catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});
app.post("/api/challenge/open", async (req, res) => {
  try {
    const b = req.body || {};
    const num = (x) => { const v = +x; return isFinite(v) ? v : null; };
    const t = {
      id: String(b.id || "").slice(0, 80),
      sym: String(b.sym || "").toUpperCase().slice(0, 12),
      date: String(b.date || "").slice(0, 10),
      entry: num(b.entry), stop: num(b.stop), tp1: num(b.tp1), tp2: num(b.tp2),
      notional: num(b.notional), shares: num(b.shares),
      rai: num(b.rai), // girişteki risk iştahı (0-100, denetim izi; yoksa null)
      frozenAt: new Date().toISOString(),
    };
    if (!t.id || !t.sym || !/^\d{4}-\d{2}-\d{2}$/.test(t.date) ||
        !(t.entry > 0) || !(t.stop > 0) || !(t.entry > t.stop) || !(t.shares > 0))
      return res.status(400).json({ error: "eksik/geçersiz plan" });
    const led = await chLoadLedger();
    if (!Array.isArray(led.trades)) led.trades = [];
    if (led.trades.some((x) => x.id === t.id)) return res.json({ ok: true, dup: true }); // idempotent — asla üzerine yazmaz
    led.trades.push(t);
    await chSaveLedger(led);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

/* ===== Alfa Avı OTONOM MOTOR — sunucu tarafında tarar, tetikte açar, e-posta atar =====
 * Client açık olmasa da 30 dk'da bir çalışır. Client'la AYNI deterministik kurallar:
 * EMA 8/21/50 + QM teyidi, QQQ endeks kapısı (EMA21 altı → giriş yok, EMA8 altı → yarım boyut),
 * kademeli çıkış (TP1 %25→başa-baş, TP2 %25, kalan EMA21 iz süren), ~%3 risk boyutlama.
 * Mumlar SADECE candleCache'ten okunur (ek API maliyeti yok) — QQQ hariç (getCandles, önbellekli).
 * E-posta: RESEND_API_KEY varsa Resend ile (NOTIFY_EMAIL'e); yoksa sadece log. */
const CH_ENG = {
  core: ["NVDA", "AMD", "MU", "NBIS", "INTC", "SNDK", "TSLA", "SOFI", "NOW"],
  startDate: "2026-07-01", startCapital: 1500, riskPct: 3, tp1: 6, tp2: 12,
  minNotional: 350, maxNotional: 850, maxSyms: 60, indexSym: "QQQ", // 40→60: QM evreni bağlandı
  _running: false, lastRun: null, lastSummary: null,
};
const chEmaArr = (v, p) => { const k = 2 / (p + 1); let e = null; return v.map((c) => (e = e == null ? c.close : c.close * k + e * (1 - k))); };
const chVmaArr = (v, p) => v.map((c, i) => i < p - 1 ? null : v.slice(i - p + 1, i + 1).reduce((a, b) => a + b.volume, 0) / p);
const chAdrAt = (v, i, p = 20) => { let s = 0, k = 0; for (let j = i - p + 1; j <= i; j++) { if (j < 0) continue; s += (v[j].high - v[j].low) / v[j].close; k++; } return k ? (s / k) * 100 : null; };
const chSizeSrv = (entry, stop) => { const frac = (entry - stop) / entry; const riskUSD = CH_ENG.startCapital * CH_ENG.riskPct / 100; return Math.max(CH_ENG.minNotional, Math.min(CH_ENG.maxNotional, riskUSD / Math.max(0.001, frac))); };

/* ---- RİSK İŞTAHI ENDEKSİ (RAI, 0-100) ------------------------------------
 * Fiyat kapısı (QQQ EMA) tek başına "endeks ne yapıyor"u görür; RAI piyasanın
 * genel risk iştahını 5 bileşenden ölçer ve fiyattan ÖNCE kırılan sinyalleri
 * (volatilite/kredi) yakalar:
 *   trend   .30 — QQQ EMA8/21/50 dizilimi
 *   vol     .20 — VIXY (VIX vadelileri = opsiyon piyasasının korku fiyatlaması; SPX
 *                 opsiyonlarından türetilir). Ücretsiz planda put/call verisi yok,
 *                 VIXY bunun likit vekilidir. Mutlak seviyesi contango ile eridiği
 *                 için SADECE kendi EMA21'ine göre sapma kullanılır.
 *   credit  .20 — HYG/IEF oranı (kredi iştahı; daralma erken uyarıdır)
 *   rot     .10 — XLY/XLP oranı (harcama iştahı rotasyonu)
 *   breadth .20 — kendi evrenimizde EMA21 üstü % + 20g yeni zirve−dip farkı
 * Eksik bileşenin ağırlığı kalanlara dağıtılır; hepsi yoksa RAI=null → filtre pasif.
 * Bant: ≥65 risk-on · 45-64 nötr · 30-44 temkin (yarım boyut) · <30 risk-off (giriş yok).
 * Nihai rejim = fiyat kapısı ile RAI bandından KÖTÜ olanı (asimetrik muhafazakâr:
 * RAI asla gevşetmez, sadece ek fren/erken uyarı ekler).
 * DİKKAT: formüller public/app.js chRaiAt ile BİREBİR aynı olmalı (client parite).
 * Kalibrasyon (2025-04→2026-07): 7 Nis 2025 çöküşü=2 · Haz 2026 rallisi=86 · ort 66. */
const RAI_ETFS = ["VIXY", "HYG", "IEF", "XLY", "XLP"];
const chClamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));
const chNear = (ser, d) => { if (!ser) return null; let i = ser.idx[d]; if (i == null) { for (i = ser.v.length - 1; i >= 0 && ser.v[i].time > d; i--); } return i != null && i >= 0 ? i : null; };
const chMkSeries = (v) => v && v.length >= 30 ? { v, ema8: chEmaArr(v, 8), ema21: chEmaArr(v, 21), ema50: chEmaArr(v, 50), idx: Object.fromEntries(v.map((c, i) => [c.time, i])) } : null;
const chRatioSeries = (a, b) => { if (!a || !b) return null; const v = []; for (let i = 0; i < a.v.length; i++) { const j = chNear(b, a.v[i].time); if (j == null) continue; v.push({ time: a.v[i].time, close: a.v[i].close / b.v[j].close }); } return v.length >= 30 ? { v, ema21: chEmaArr(v, 21), idx: Object.fromEntries(v.map((c, i) => [c.time, i])) } : null; };
const chRaiBand = (s) => s == null ? null : s >= 65 ? "riskon" : s >= 45 ? "notr" : s >= 30 ? "temkin" : "riskoff";
const chWorse = (a, b) => { const r = { on: 0, caution: 1, off: 2 }; return (r[a] ?? 0) >= (r[b] ?? 0) ? a : b; };
// ctx = { Q, vol, credit, rot, S } — S: evren hisse serileri (genişlik için)
function chRaiAt(ctx, d) {
  const comps = {}, w = {};
  { const Q = ctx.Q, i = chNear(Q, d);
    if (i != null && i >= 50) { const c = Q.v[i].close; let s = 50;
      s += c > Q.ema21[i] ? 18 : -28; s += c > Q.ema8[i] ? 12 : -8;
      if (Q.ema21[i] > Q.ema50[i]) s += 10; if (i >= 10 && Q.ema50[i] > Q.ema50[i - 10]) s += 10;
      comps.trend = chClamp(s); w.trend = 0.30; } }
  { const V = ctx.vol, i = V ? chNear(V.ser, d) : null;
    if (i != null && i >= 21) {
      const x = V.ser.v[i].close, pct = x / V.ser.ema21[i] - 1;
      // "vix": gerçek VIX seviye+sapma (FRED) · "vixy": yalnız EMA21 sapması (contango nedeniyle seviye anlamsız)
      comps.vol = chClamp(Math.round(V.kind === "vix" ? 140 - 4.2 * x - pct * 80 : 55 - pct * 550));
      w.vol = 0.20; } }
  { const C = ctx.credit, i = chNear(C, d);
    if (i != null && i >= 21) { const r = C.v[i].close, pct = r / C.ema21[i] - 1, sl = i >= 10 ? r / C.v[i - 10].close - 1 : 0;
      comps.credit = chClamp(Math.round(50 + pct * 4000 + sl * 1500)); w.credit = 0.20; } }
  { const R = ctx.rot, i = chNear(R, d);
    if (i != null && i >= 21) { const r = R.v[i].close, pct = r / R.ema21[i] - 1, sl = i >= 10 ? r / R.v[i - 10].close - 1 : 0;
      comps.rot = chClamp(Math.round(50 + pct * 1500 + sl * 800)); w.rot = 0.10; } }
  { let n = 0, ab = 0, nh = 0, nl = 0;
    for (const sym of Object.keys(ctx.S || {})) {
      const s = ctx.S[sym], i = chNear(s, d);
      if (i == null || i < 21) continue;
      n++;
      if (s.v[i].close > s.ema21[i]) ab++;
      const cs = s.v.slice(i - 19, i + 1).map((x) => x.close);
      if (s.v[i].close >= Math.max(...cs)) nh++;
      if (s.v[i].close <= Math.min(...cs)) nl++;
    }
    if (n >= 5) { const above = (ab / n) * 100, nhl = ((nh - nl) / n) * 100;
      comps.breadth = chClamp(Math.round(0.7 * above + 0.3 * chClamp(50 + nhl * 1.2))); w.breadth = 0.20; } }
  const wSum = Object.values(w).reduce((a, b) => a + b, 0);
  if (!wSum) return null;
  let s = 0; for (const k of Object.keys(comps)) s += comps[k] * w[k];
  return { score: Math.round(s / wSum), comps };
}
// RS (göreli güç) — aynı gün birden çok tetik varsa güçlü olan önce alınır (QM: en güçlü ata bin)
const chRsAt = (s, i) => { const v = s.v, ret = (n) => i >= n && v[i - n] ? v[i].close / v[i - n].close - 1 : 0; return 0.5 * ret(63) + 0.3 * ret(21) + 0.2 * ret(126); };

/* ---- Gerçek VIX (FRED VIXCLS — anahtarsız CSV, St. Louis Fed) ----------------
 * VIX seviyesi anlamlıdır (VIXY contango ile erir): 12→~90, 20→~56, 30→~14, 45+→0.
 * ~1-2 gün gecikmeli yayınlanır — kararlar zaten kapanmış barda alındığı için yeterli.
 * Çekilemezse null döner → RAI volatilite bileşeni VIXY sapmasına düşer (zarif bozulma). */
const vixCache = { v: null, t: 0 };
async function getFredVix() {
  if (vixCache.v && Date.now() - vixCache.t < 12 * 3600_000) return vixCache.v;
  try {
    const cosd = new Date(Date.now() - 400 * 86400_000).toISOString().slice(0, 10);
    const r = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=VIXCLS&cosd=${cosd}`,
      { headers: { "User-Agent": UA, Accept: "text/csv" }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return vixCache.v;
    const rows = (await r.text()).trim().split("\n").slice(1);
    const v = rows.map((row) => { const [d, x] = row.split(","); const c = +x; return isFinite(c) && c > 0 ? { time: d, close: c } : null; }).filter(Boolean);
    if (v.length >= 60) { vixCache.v = v; vixCache.t = Date.now(); }
    return vixCache.v;
  } catch { return vixCache.v; }
}

/* ---- Bilanço karartması — bilançoya ≤3 gün kala YENİ giriş yok --------------
 * Kendi küçük önbelleği (Bilanço Nöbetçisi'nin earnCache'ine dokunmaz — o harita
 * her tazelemede TÜMDEN değişir, evren sembollerimiz sessizce düşerdi). */
const CH_EARN = { t: 0, map: {}, busy: false }; // sym -> "YYYY-MM-DD" (30 gün içindeki en yakın)
async function chRefreshEarnings(universe) {
  if (CH_EARN.busy || !FINNHUB_KEY || !universe.length) return;
  if (Object.keys(CH_EARN.map).length && Date.now() - CH_EARN.t < 12 * 3600_000) return;
  CH_EARN.busy = true;
  try {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    const map = {};
    await pool(universe, 4, async (sym) => {
      const j = await finnhub("/calendar/earnings", { symbol: sym, from, to }, { bg: true });
      const list = Array.isArray(j?.earningsCalendar) ? j.earningsCalendar : [];
      let best = null;
      for (const e of list) if (e?.date && (!best || e.date < best)) best = e.date;
      if (best) map[sym] = best;
    });
    CH_EARN.map = map;
    CH_EARN.t = Date.now();
  } finally { CH_EARN.busy = false; }
}
const chEarnBlocked = (sym, d) => {
  const e = CH_EARN.map[sym]; if (!e) return false; // veri yoksa engelleme (dürüst varsayılan)
  const diff = (Date.parse(e) - Date.parse(d)) / 86400_000;
  return diff >= 0 && diff <= 3;
};

/* ---- Sektör tavanı — aynı sektörden en fazla 1 eşzamanlı pozisyon ------------ */
const CH_SECT = { t: 0, map: {}, busy: false }; // sym -> finnhubIndustry|null (7 gün TTL)
async function chRefreshSectors(universe) {
  if (CH_SECT.busy || !FINNHUB_KEY) return;
  const missing = universe.filter((s) => !(s in CH_SECT.map));
  if (!missing.length && Date.now() - CH_SECT.t < 7 * 86400_000) return;
  CH_SECT.busy = true;
  try {
    const need = missing.length ? missing : universe;
    await pool(need, 4, async (sym) => {
      const p = await fhProfile(sym, { bg: true }).catch(() => ({}));
      CH_SECT.map[sym] = p.industry || null; // null da yazılır → tekrar tekrar sorulmaz
    });
    CH_SECT.t = Date.now();
  } finally { CH_SECT.busy = false; }
}

// Bildirim alıcısı: NOTIFY_EMAIL env > sabit yedek
const NOTIFY_FALLBACK = "";
async function notifyTo() {
  return process.env.NOTIFY_EMAIL || NOTIFY_FALLBACK;
}
async function chSendMail(subject, html) {
  const to = await notifyTo();
  if (!process.env.RESEND_API_KEY) { console.log(`[Alfa Avı mail — RESEND_API_KEY yok, atlanıyor] ${subject}`); return false; }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.NOTIFY_FROM || "Portföy Takip <onboarding@resend.dev>", to: [to], subject, html }),
    });
    if (!r.ok) console.error("Alfa Avı mail hatası:", r.status, await r.text().catch(() => ""));
    return r.ok;
  } catch (e) { console.error("Alfa Avı mail hatası:", e.message); return false; }
}

function chSrvSignal(S, sym, i) {
  const s = S[sym]; if (!s || i < 60) return null;
  const v = s.v, c = v[i];
  const up = c.close > s.ema50[i] && s.ema21[i] > s.ema50[i] && s.ema50[i] > s.ema50[i - 10];
  const low5 = Math.min(...v.slice(i - 4, i + 1).map((x) => x.close));
  const pullback = low5 < s.ema8[i - 1];
  const crossover = c.close > s.ema8[i] && v[i - 1].close <= s.ema8[i - 1];
  const volOk = s.vma[i] != null && c.volume > s.vma[i];
  const hi60 = Math.max(...v.slice(i - 60, i + 1).map((x) => x.high));
  const nearHigh = c.close >= 0.8 * hi60;
  const adr = chAdrAt(v, i);
  if (!(up && pullback && crossover && volOk && nearHigh && adr >= 3)) return null;
  const stop = Math.max(Math.min(c.low, v[i - 1].low), c.close - 1.2 * (adr / 100) * c.close);
  return { sym, date: c.time, entry: c.close, stop, volRatio: c.volume / s.vma[i], adr };
}

async function chEngineTick(trigger = "timer") {
  if (CH_ENG._running) return { skipped: "already running" };
  CH_ENG._running = true;
  try {
    // 1) Evren + mumlar (yalnız önbellek) + QQQ
    const data = await loadData().catch(() => ({}));
    const syms = new Set(CH_ENG.core);
    (RADAR_SYMBOLS || []).forEach((s) => syms.add(String(s).toUpperCase()));
    (data.swingTrades || []).forEach((t) => t?.symbol && syms.add(String(t.symbol).toUpperCase()));
    // QM tarayıcı evreni bağlantısı (görünüm kaldırıldı): Cuma Hoca + portföy + izleme listesi
    (CUMA_SYMBOLS || []).forEach((s) => syms.add(String(s).toUpperCase()));
    (data.holdings || []).forEach((h) => { if (h?.type === "stock" && h.symbol) syms.add(String(h.symbol).toUpperCase()); });
    (data.watchlist || []).forEach((w) => { const s = String(typeof w === "string" ? w : w?.symbol || "").toUpperCase(); if (s) syms.add(s); });
    const led = await chLoadLedger();
    if (!Array.isArray(led.trades)) led.trades = [];
    led.notified = led.notified || {};
    for (const t of led.trades) syms.add(t.sym);
    const universe = [...syms].slice(0, CH_ENG.maxSyms);
    const S = {};
    for (const sym of universe) {
      const v = candleCache[sym]?.candles;
      if (v && v.length >= 60) S[sym] = { v, ema8: chEmaArr(v, 8), ema21: chEmaArr(v, 21), ema50: chEmaArr(v, 50), vma: chVmaArr(v, 20), idx: Object.fromEntries(v.map((c, i) => [c.time, i])) };
    }
    let Q = null;
    try { const qv = await getCandles(CH_ENG.indexSym); Q = chMkSeries(qv); } catch {}
    // RAI ETF'leri — getCandles 18 saat önbellekli, günde 1 kez gerçek çağrı olur (kota dostu)
    const E = {};
    for (const s of RAI_ETFS) { try { E[s] = chMkSeries(await getCandles(s)); } catch {} }
    // Gerçek VIX (FRED) — varsa volatilite bileşeni buna geçer, yoksa VIXY sapması
    let VIXSER = null;
    try { VIXSER = chMkSeries(await getFredVix()); } catch {}
    const RAIX = { Q, vol: VIXSER ? { ser: VIXSER, kind: "vix" } : E.VIXY ? { ser: E.VIXY, kind: "vixy" } : null, credit: chRatioSeries(E.HYG, E.IEF), rot: chRatioSeries(E.XLY, E.XLP), S };
    const raiAt = (d) => chRaiAt(RAIX, d);
    // Bilanço takvimi + sektörler (kendi önbellekleri; eksikse filtreler pasif kalır — dürüst varsayılan)
    await chRefreshEarnings(universe).catch(() => {});
    await chRefreshSectors(universe).catch(() => {});
    const emaGateAt = (d) => {
      if (!Q) return "on";
      const i = chNear(Q, d);
      if (i == null || i < 21) return "on";
      const c = Q.v[i].close;
      return c < Q.ema21[i] ? "off" : c < Q.ema8[i] ? "caution" : "on";
    };
    // Nihai rejim = fiyat kapısı ∨ RAI bandı (kötü olan kazanır — RAI asla gevşetmez)
    const regimeAt = (d) => {
      const g = emaGateAt(d);
      const rb = chRaiBand(raiAt(d)?.score);
      return chWorse(g, rb === "riskoff" ? "off" : rb === "temkin" ? "caution" : "on");
    };
    const watch = universe.filter((s) => S[s]);
    const ref = S[watch[0]];
    if (!ref) return (CH_ENG.lastSummary = { trigger, note: "önbellekte mum yok — tarama sonrası tekrar dener" });

    // 2) Kronolojik replay — client chRun ile birebir aynı kurallar
    const todayISO = new Date().toISOString().slice(0, 10);
    const dates = ref.v.map((c) => c.time).filter((d) => d >= CH_ENG.startDate);
    const frozenByDate = {};
    for (const t of led.trades) (frozenByDate[t.date] ||= []).push(t);
    let cash = CH_ENG.startCapital, dirty = false;
    const positions = [];
    const mails = [];
    let prevRegime = "on";
    for (const d of dates) {
      const regime = regimeAt(d);
      const defensive = regime === "off"; // piyasa kötü → stopları sıkılaştır (savunma modu)
      for (const p of positions.filter((x) => x.open)) {
        const s = S[p.sym], i = s ? s.idx[d] : null; if (i == null) continue; const c = s.v[i];
        // Savunma modu (rejim off): kârdaki pozisyonun stopu bar SONUNDA başa-başa RATCHET'lenir
        // (bir sonraki barı etkiler — aynı bar içi lookahead yok). Backtest: iz süren EMA'yı
        // EMA8'e sıkıştırmak choppy off-günlerinde whipsaw → DD arttı; sadece stop-yukarı korur+getiriyi artırır.
        const effStop = p.tp1hit ? p.entry : p.stop;
        if (c.low <= effStop) { const fr = p.rem, px = effStop, pnl = fr * p.shares * (px - p.entry); cash += fr * p.shares * px; p.realized += pnl; p.rem = 0; p.open = false; p.exitDate = d; p.exitKind = (p.stop >= p.entry && !p.tp1hit) ? "savunma stopu (başa-baş kilidi)" : p.tp1hit ? "başa-baş stop" : "stop"; continue; }
        if (!p.tp1hit && c.high >= p.tp1) { const fr = 0.25; cash += fr * p.shares * p.tp1; p.realized += fr * p.shares * (p.tp1 - p.entry); p.rem -= fr; p.tp1hit = true; }
        if (p.tp1hit && !p.tp2hit && c.high >= p.tp2) { const fr = 0.25; cash += fr * p.shares * p.tp2; p.realized += fr * p.shares * (p.tp2 - p.entry); p.rem -= fr; p.tp2hit = true; }
        if (p.open && p.rem > 0 && c.close < s.ema21[i]) { const fr = p.rem, pnl = fr * p.shares * (c.close - p.entry); cash += fr * p.shares * c.close; p.realized += pnl; p.rem = 0; p.open = false; p.exitDate = d; p.exitKind = "EMA21 iz süren stop"; }
        if (defensive && p.open && !p.tp1hit && c.close > p.entry) p.stop = Math.max(p.stop, p.entry); // bar sonu başa-baş ratchet
      }
      const held = new Set(positions.filter((x) => x.open).map((x) => x.sym));
      for (const f of frozenByDate[d] || []) {
        if (held.has(f.sym) || positions.some((p) => p.id === f.id)) continue;
        cash -= f.notional;
        positions.push({ ...f, rem: 1, tp1hit: false, tp2hit: false, realized: 0, open: true });
        held.add(f.sym);
      }
      // Savunma modu bildirimi — rejim İLK kez off'a geçtiği barda açık pozisyon varsa (idempotent)
      if (defensive && prevRegime !== "off" && d >= CH_ENG.startDate) {
        const openNow = positions.filter((x) => x.open);
        if (openNow.length && !led.notified[`defense:${d}`]) {
          led.notified[`defense:${d}`] = new Date().toISOString(); dirty = true;
          const rows = openNow.map((p) => { const s = S[p.sym], i = s?.idx[d]; const mk = i != null ? s.v[i].close : null; const pct = mk ? ((mk / p.entry - 1) * 100).toFixed(1) : "—"; const prof = mk != null && mk > p.entry; return `<li><b>${p.sym}</b> ${mk ? `$${mk.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct}%)` : ""} → ${prof ? "stop <b>başa-başa çekiliyor</b> (kâr kilidi)" : `stop $${p.stop.toFixed(2)} korunuyor`}</li>`; }).join("");
          const rai = raiAt(d);
          mails.push({
            subject: `🛡 Alfa Avı SAVUNMA MODU — piyasa risk-off, kâr kilitleniyor`,
            html: `<h2>🛡 Savunma modu devrede</h2><p>Rejim kapısı <b>off</b>'a geçti (${d}${rai ? ` · risk iştahı ${rai.score}/100` : ""}). Açık pozisyonlarda <b>yeni giriş yok</b>; kârdaki pozisyonların stopu <b>başa-başa çekildi</b> (kâr kilidi) — hedeften önce zorla çıkış yok, ama piyasa dönerse kazanç korunuyor.</p><ul>${rows}</ul><p>Stop tek yön yukarı hareket eder — piyasa toparlasa da geri gevşemez (Kural 1). Bu oyun parasıdır, yatırım tavsiyesi değildir.</p>`,
          });
        }
      }
      prevRegime = regime;
      if (regime === "off") continue;
      if (d >= todayISO) continue; // bugünün barı oluşuyor — sadece KAPANMIŞ barda karar
      const raiD = raiAt(d);
      const sigs = watch.filter((sym) => S[sym].idx[d] != null && !held.has(sym))
        .map((sym) => { const i = S[sym].idx[d]; const g = chSrvSignal(S, sym, i); return g ? { ...g, rs: chRsAt(S[sym], i) } : null; })
        .filter(Boolean).sort((a, b) => b.rs - a.rs || b.volRatio - a.volRatio); // önce göreli güç (QM), eşitse hacim
      for (const sig of sigs) {
        const id = `${sig.date}-${sig.sym}`;
        if (led.trades.some((x) => x.id === id)) continue;
        if (chEarnBlocked(sig.sym, d)) continue; // bilanço karartması: bilançoya ≤3 gün kala giriş yok
        const sct = CH_SECT.map[sig.sym];
        if (sct && positions.some((p) => p.open && CH_SECT.map[p.sym] === sct)) continue; // sektör tavanı: aynı sektörden 1 açık
        let notional = chSizeSrv(sig.entry, sig.stop);
        if (regime === "caution") notional = Math.max(280, +(notional / 2).toFixed(0));
        if (cash < notional) continue;
        cash -= notional;
        const t = { id, sym: sig.sym, date: sig.date, entry: +sig.entry.toFixed(4), stop: +sig.stop.toFixed(4), tp1: +(sig.entry * (1 + CH_ENG.tp1 / 100)).toFixed(4), tp2: +(sig.entry * (1 + CH_ENG.tp2 / 100)).toFixed(4), notional: +notional.toFixed(2), shares: +(notional / sig.entry).toFixed(6), rai: raiD ? raiD.score : null, frozenAt: new Date().toISOString(), by: "server" };
        led.trades.push(t); (frozenByDate[t.date] ||= []).push(t);
        positions.push({ ...t, rem: 1, tp1hit: false, tp2hit: false, realized: 0, open: true });
        held.add(t.sym); dirty = true;
        if (!led.notified[`open:${id}`]) {
          led.notified[`open:${id}`] = new Date().toISOString();
          const raiLine = raiD ? `<li>Risk iştahı (RAI): <b>${raiD.score}/100</b> — trend ${raiD.comps.trend ?? "—"} · volatilite ${raiD.comps.vol ?? "—"} · kredi ${raiD.comps.credit ?? "—"} · rotasyon ${raiD.comps.rot ?? "—"} · genişlik ${raiD.comps.breadth ?? "—"}</li>` : "";
          mails.push({
            subject: `🏹 Alfa Avı: ${t.sym} pozisyonu AÇILDI — $${t.entry}`,
            html: `<h2>🏹 Alfa Avı — yeni pozisyon</h2><p><b>${t.sym}</b> · ${t.date} kapanışında tetik oluştu (EMA8'i hacimle geri aldı, trend + QM teyitli${regime === "caution" ? ", endeks/risk-iştahı uyarısı nedeniyle YARIM boyut" : ""}).</p><ul><li>Giriş: <b>$${t.entry}</b></li><li>Stop: <b>$${t.stop}</b></li><li>TP1 (+%${CH_ENG.tp1}): $${t.tp1} · TP2 (+%${CH_ENG.tp2}): $${t.tp2}</li><li>Pozisyon: ~$${t.notional} (${t.shares} adet)</li>${raiLine}</ul><p>Plan sunucu defterine kilitlendi — hedef/stop gerçek mumlarla otomatik ölçülür. Bu oyun parasıdır, yatırım tavsiyesi değildir.</p>`,
          });
        }
      }
    }
    // 3) Kapanan pozisyon bildirimleri
    for (const p of positions.filter((x) => !x.open && x.exitDate)) {
      const key = `close:${p.id}`;
      if (led.notified[key]) continue;
      led.notified[key] = new Date().toISOString(); dirty = true;
      const pnl = +p.realized.toFixed(2);
      mails.push({
        subject: `Alfa Avı: ${p.sym} kapandı — ${pnl >= 0 ? "KÂR" : "ZARAR"} ${pnl >= 0 ? "+" : ""}$${pnl}`,
        html: `<h2>Alfa Avı — pozisyon kapandı</h2><p><b>${p.sym}</b> (${p.date} girişi) ${p.exitDate} tarihinde <b>${p.exitKind}</b> ile kapandı.</p><p>Net sonuç: <b>${pnl >= 0 ? "+" : ""}$${pnl}</b></p>`,
      });
    }
    // Günlük RAI denetim izi — defterde sadece-ekle (o günün değeri bir kez yazılır, değişmez)
    const raiToday = raiAt(todayISO);
    CH_ENG.lastRai = raiToday ? { score: raiToday.score, band: chRaiBand(raiToday.score), comps: raiToday.comps } : null;
    led.raiLog = led.raiLog || {};
    if (raiToday && !led.raiLog[todayISO]) {
      led.raiLog[todayISO] = { s: raiToday.score, c: raiToday.comps };
      const ks = Object.keys(led.raiLog).sort();
      while (ks.length > 400) delete led.raiLog[ks.shift()];
      dirty = true;
    }
    // Haftalık RAI özeti — Pazar 15:00 UTC (18:00 TR) sonrası ilk tik, haftada bir (idempotent)
    const nowD = new Date();
    if (nowD.getUTCDay() === 0 && nowD.getUTCHours() >= 15 && raiToday && !led.notified[`weekly:${todayISO}`]) {
      led.notified[`weekly:${todayISO}`] = new Date().toISOString(); dirty = true;
      const wkKeys = Object.keys(led.raiLog).sort().slice(-7);
      const wk = wkKeys.map((k) => led.raiLog[k].s);
      const dir = wk.length >= 2 ? (wk[wk.length - 1] > wk[0] ? "↑ iyileşiyor" : wk[wk.length - 1] < wk[0] ? "↓ bozuluyor" : "→ yatay") : "→";
      const band = chRaiBand(raiToday.score);
      const bandTxt = { riskon: "RİSK-ON — iştah yerinde, plan normal boyutta işler", notr: "NÖTR — fiyat kapısı belirleyici, normal kurallar", temkin: "TEMKİN — yeni girişler yarım boyut", riskoff: "RİSK-OFF — yeni giriş kapalı, mevcutlar kurallarıyla yönetilir" }[band];
      const openRows = positions.filter((x) => x.open).map((p) => {
        const s = S[p.sym]; const mark = s ? s.v[s.v.length - 1].close : null;
        const pct = mark ? ((mark / p.entry - 1) * 100).toFixed(1) : "—";
        return `<li><b>${p.sym}</b> giriş $${p.entry} → ${mark ? `$${mark.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct}%)` : "—"} · etkin stop $${(p.tp1hit ? p.entry : p.stop).toFixed(2)}</li>`;
      }).join("") || "<li>Açık pozisyon yok — sistem tetik bekliyor.</li>";
      const c = raiToday.comps;
      mails.push({
        subject: `🧭 Alfa Avı haftalık — risk iştahı ${raiToday.score}/100 (${band})`,
        html: `<h2>🧭 Haftaya girerken risk iştahı</h2>
<p style="font-size:22px;margin:6px 0"><b>${raiToday.score}/100</b> — ${bandTxt}.</p>
<p>Bileşenler: trend ${c.trend ?? "—"} · volatilite ${c.vol ?? "—"}${VIXSER ? " (gerçek VIX)" : " (VIXY)"} · kredi ${c.credit ?? "—"} · rotasyon ${c.rot ?? "—"} · genişlik ${c.breadth ?? "—"}</p>
<p>Geçen hafta: ${wk.length ? `${Math.min(...wk)}–${Math.max(...wk)} bandı, ${dir}` : "kayıt yok"}. Bugünkü rejim kapısı: <b>${regimeAt(todayISO)}</b>.</p>
<h3>Açık pozisyonlar</h3><ul>${openRows}</ul>
<p>Defter: ${led.trades.length} işlem · nakit ~$${cash.toFixed(0)}. Bu oyun parasıdır, yatırım tavsiyesi değildir; iştah düşerse sistem boyutu kendiliğinden kısar.</p>`,
      });
    }
    if (dirty) await chSaveLedger(led);
    for (const m of mails) await chSendMail(m.subject, m.html);
    const openN = positions.filter((x) => x.open).length;
    CH_ENG.lastRun = new Date().toISOString();
    CH_ENG.lastSummary = { trigger, universe: watch.length, ledger: led.trades.length, open: openN, cash: +cash.toFixed(2), mailsSent: mails.length, regimeToday: regimeAt(todayISO), rai: raiToday ? raiToday.score : null };
    console.log("Alfa Avı motor:", JSON.stringify(CH_ENG.lastSummary));
    return CH_ENG.lastSummary;
  } catch (e) {
    console.error("Alfa Avı motor hatası:", e.message);
    return (CH_ENG.lastSummary = { trigger, error: String(e.message || e) });
  } finally { CH_ENG._running = false; }
}
setTimeout(() => chEngineTick("startup").catch(() => {}), 90_000);
setInterval(() => chEngineTick("timer").catch(() => {}), 30 * 60_000);
// Elle tetikleme + durum (test için): POST tarar, GET son özeti döner
app.post("/api/challenge/scan", async (_req, res) => res.json(await chEngineTick("manual")));
app.get("/api/challenge/status", (_req, res) => res.json({ lastRun: CH_ENG.lastRun, lastSummary: CH_ENG.lastSummary, rai: CH_ENG.lastRai || null, mailConfigured: !!process.env.RESEND_API_KEY }));
// Elle test maili — RESEND_API_KEY doğru mu anında gör (girişli kullanıcıdan çağrılır)
app.post("/api/challenge/testmail", async (_req, res) => {
  const sent = await chSendMail("🧪 Alfa Avı test maili", "<p>Resend bağlantısı çalışıyor — pozisyon açılınca/kapanınca bildirim bu adrese gelecek.</p>");
  res.json({ sent, configured: !!process.env.RESEND_API_KEY, to: await notifyTo() });
});

/* ===== Portföy Bekçisi — ani hareket / risk uyarı e-postaları =====================
 * Saatte bir gerçek portföyü tarar (Alfa Avı'ndan bağımsız). Amaç: kârı KORU + uzun
 * vadeleri kademeli realize ile bedavaya çek (Kaan'ın tezi). 3 tetik:
 *  (a) KÂR SIÇRAMASI: günlük değişim ≥ max(%6, 1.2×ADR) ve kârda → "kârı koru" + sıfır-maliyet önerisi
 *  (b) RİSK: fiyat ≤ planStop → stop maili
 *  (c) YOĞUNLAŞMA: ağırlık >%35 ve stopsuz → günde 1 uyarı
 * İdempotensi: app_data guard_notified (tip:sym:gün); günde en çok 1 mail/tip/sembol. */
const GUARD_KEY = "guard_notified";
const GUARD_FILE = join(__dirname, "guard_notified.json");
async function guardLoad() {
  if (dbPool) { const r = await dbPool.query("SELECT value FROM app_data WHERE key=$1", [GUARD_KEY]); return r.rows.length ? r.rows[0].value : {}; }
  try { return JSON.parse(await readFile(GUARD_FILE, "utf8")); } catch { return {}; }
}
async function guardSave(m) {
  if (dbPool) { await dbPool.query("INSERT INTO app_data(key,value,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()", [GUARD_KEY, m]); return; }
  await writeFile(GUARD_FILE, JSON.stringify(m), "utf8");
}
const usd0 = (x) => "$" + Math.round(Number(x) || 0).toLocaleString("en-US");
const GUARD = { busy: false, last: null, lastSummary: null };
async function guardTick(trigger = "timer") {
  if (GUARD.busy) return { skipped: "busy" };
  GUARD.busy = true;
  try {
    const data = await loadData().catch(() => null);
    if (!data) return (GUARD.lastSummary = { trigger, note: "veri yok" });
    const stocks = (data.holdings || []).filter((h) => h.type === "stock" && Number(h.quantity) > 0);
    if (!stocks.length) return (GUARD.lastSummary = { trigger, note: "hisse pozisyonu yok" });
    const syms = [...new Set(stocks.map((h) => String(h.symbol).toUpperCase()))];
    const qmap = await fetchStocks(syms).catch(() => ({}));
    // Kaba sembol-başı realize (satışlar) — sıfır-maliyet önerisinin etkin maliyeti için
    const realizedOf = {};
    for (const t of (data.trades || [])) { if (t.kind !== "sell") continue; const s = String(t.symbol || "").toUpperCase(); realizedOf[s] = (realizedOf[s] || 0) + (Number(t.shares) || 0) * ((Number(t.sellUSD) || 0) - (Number(t.buyUSD) || 0)); }
    const totMV = stocks.reduce((a, h) => { const q = qmap[String(h.symbol).toUpperCase()]; return a + (q?.price ? q.price * Number(h.quantity) : 0); }, 0) || 1;
    const notified = await guardLoad();
    const today = new Date().toISOString().slice(0, 10);
    // Eski kayıtları buda (>12 gün)
    const cutoff = new Date(Date.now() - 12 * 86400_000).toISOString().slice(0, 10);
    for (const k of Object.keys(notified)) if (String(notified[k]) < cutoff) delete notified[k];
    let changed = false;
    const mark = (key) => { if (notified[key]) return false; notified[key] = today; changed = true; return true; };
    const mails = [];
    for (const h of stocks) {
      const sym = String(h.symbol).toUpperCase();
      const q = qmap[sym]; if (!q || !(q.price > 0)) continue;
      const price = q.price, qty = Number(h.quantity), cost = Number(h.costUSD) || null;
      const dc = q.dayChangePct != null ? q.dayChangePct : (q.prevClose ? (price / q.prevClose - 1) * 100 : null);
      const cc = candleCache[sym]?.candles;
      const adr = cc && cc.length >= 21 ? chAdrAt(cc, cc.length - 1) : null;
      const spikeThresh = Math.max(6, adr ? 1.2 * adr : 6);
      const weight = price * qty / totMV * 100;
      const inProfit = cost != null && price > cost;
      // (a) kâr sıçraması → koru + sıfır-maliyet önerisi
      if (dc != null && dc >= spikeThresh && inProfit && mark(`spike:${sym}:${today}`)) {
        const principal = cost * qty, realized = realizedOf[sym] || 0, effCost = principal - realized;
        let sugg;
        if (effCost <= 0) sugg = `Bu pozisyon zaten <b>bedava</b> (ana paranı geri almışsın) — kâr tümüyle risksiz. Stopu yukarı çek, kalanı koştur.`;
        else { const sh = Math.min(qty, effCost / price), remain = qty - sh; sugg = `Kalan ana parayı çekmek için ~<b>${sh.toFixed(2)} adet</b> sat (~${usd0(effCost)} cebe); kalan <b>${remain.toFixed(2)} adet</b> (${usd0(remain * price)}) bedava biner — tezin tam bu.`; }
        mails.push({ subject: `📈 ${sym} +${dc.toFixed(1)}% sıçradı — kârı koru`, html: `<h2>📈 ${sym} bugün +${dc.toFixed(1)}%</h2><p>Günlük hareket ADR eşiğini (${spikeThresh.toFixed(1)}%) aştı; ${sym} <b>${usd0(price)}</b>, girişe göre ${((price / cost - 1) * 100).toFixed(0)}% kârda.</p><p><b>Öneri (sıfır maliyet):</b> ${sugg}</p><p style="color:#888;font-size:12px">Kârı koru + maksimize et: ana parayı çekip kalanı bedava bindirmek riski sıfırlar. Karar senin; bu bir hatırlatmadır, emir değil.</p>` });
      }
      // (b) risk: stop delindi
      const stop = Number(h.planStop) || 0;
      if (stop > 0 && price <= stop && mark(`stop:${sym}:${today}`)) {
        mails.push({ subject: `🛑 ${sym} stop seviyesinde (${usd0(price)})`, html: `<h2>🛑 ${sym} planlı stopunda</h2><p>${sym} <b>${usd0(price)}</b>, plan stopun <b>${usd0(stop)}</b> seviyesine indi/geçti. Kural 1: önce sermayeyi koru — planını uygula, tezini yeniden değerlendir.</p>` });
      }
      // (c) yoğunlaşma: ağırlık >%35 ve stopsuz
      if (weight > 35 && !(stop > 0) && mark(`weight:${sym}:${today}`)) {
        mails.push({ subject: `⚠️ ${sym} portföyün %${weight.toFixed(0)}'i — stop yok`, html: `<h2>⚠️ Yoğunlaşma riski: ${sym}</h2><p>${sym} portföyünün <b>%${weight.toFixed(0)}</b>'i ve <b>plan stopu yok</b>. Tek hisse seni sallayabilir (Kural 1). Bir plan stop gir ya da kademeli azalt.</p>` });
      }
    }
    if (changed) await guardSave(notified);
    for (const m of mails) await chSendMail(m.subject, m.html);
    GUARD.last = new Date().toISOString();
    GUARD.lastSummary = { trigger, holdings: stocks.length, mails: mails.length };
    return GUARD.lastSummary;
  } catch (e) { console.error("Portföy Bekçisi hatası:", e.message); return (GUARD.lastSummary = { trigger, error: String(e.message || e) }); }
  finally { GUARD.busy = false; }
}
setTimeout(() => guardTick("startup").catch(() => {}), 120_000);
setInterval(() => guardTick("timer").catch(() => {}), 60 * 60_000);
app.post("/api/guard/scan", async (_req, res) => res.json(await guardTick("manual")));
app.get("/api/guard/status", (_req, res) => res.json({ last: GUARD.last, lastSummary: GUARD.lastSummary, mailConfigured: !!process.env.RESEND_API_KEY }));

// "YYYY-MM-DD" → vergi yılı (Number); geçersizse içinde bulunduğumuz yıl.
function yearOf(dateStr) {
  const y = Number(String(dateStr || "").slice(0, 4));
  return y >= 2000 && y <= 2100 ? y : new Date().getFullYear();
}

/* ------------------------- Basit önbellek (cache) ---------------------- */
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Geçici ağ hatalarına karşı tekrar deneyen fetch.
// Timeout 6sn + 2 deneme: takılan bir kaynak Promise.all'ı en fazla ~13sn
// bekletir (eski hâlinde 36sn'ydi). Cold start sonrası ilk yükleme hızlanır.
async function fetchRetry(url, opts = {}, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(6_000) });
      if (r.ok) return r;
      last = new Error(`${r.status}`);
    } catch (e) {
      last = e;
    }
    await new Promise((res) => setTimeout(res, 300 * (i + 1)));
  }
  throw last;
}

// Bazı kaynaklar (ör. Truncgil) yanıtın sonunu düzgün kapatmadan bağlantıyı
// resetliyor; bu yüzden Node fetch'i gövdeyi kesiyor. HTTP/2 ile çekip,
// eksik kapanış parantezlerini dengeleyerek JSON'u toparlıyoruz.
function fetchJSON2(urlStr, { timeout = 12_000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const client = http2.connect(u.origin);
    client.on("error", reject);
    const req = client.request({
      ":path": u.pathname + u.search,
      ":method": "GET",
      "user-agent": UA,
      accept: "application/json",
    });
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (data += c));
    const finish = () => {
      try { client.close(); } catch {}
      try { resolve(parseLooseJSON(data)); } catch (e) { reject(e); }
    };
    req.on("end", finish);
    req.on("error", (e) => { try { client.close(); } catch {} reject(e); });
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

// Sondan kesilmiş JSON'u kapanmamış string / parantezleri tamamlayarak parse eder.
function parseLooseJSON(s) {
  try { return JSON.parse(s); } catch {}
  let depth = 0, inStr = false, esc = false;
  for (const ch of s) {
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
  }
  let fixed = s;
  if (inStr) fixed += '"';
  fixed += "}".repeat(Math.max(0, depth));
  return JSON.parse(fixed);
}

/* ====================================================================== *
 *  VERİ SAĞLAYICILAR — anahtar öncelikli (Render/cloud uyumlu)
 *  ────────────────────────────────────────────────────────────────────
 *  Finnhub  (60 istek/dk, ücretsiz): fiyat + bilanço metrikleri + analist
 *           tavsiyesi + insider. Çoklu pencere getiri ile momentum.
 *  TwelveData (8 istek/dk, 800/gün): günlük mum → RSI/SMA/ATR/52h (teknik
 *           + swing kurulumları). Anahtar yoksa teknikler atlanır.
 *  Cloud IP'lerinde Yahoo/Stooq engellendiği için anahtarsız uçlar yedektir.
 * ====================================================================== */

// Eşzamanlılık havuzu: items üzerinde en çok `n` paralel iş çalıştırır.
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

// Dakika-başı token limiti (sliding window). Sağlayıcı kotasını aşmaz.
// softCap: arka plan işleri (radar) düşük tavanla geçer → ön plana (portföy
// fiyatları) headroom kalır, kullanıcı isteği arka plan taramasının arkasında beklemez.
function rateLimiter(maxPerMin) {
  let hits = [];
  return async function gate(softCap = maxPerMin) {
    const cap = Math.min(softCap, maxPerMin);
    for (;;) {
      const now = Date.now();
      hits = hits.filter((t) => now - t < 60_000);
      if (hits.length < cap) { hits.push(now); return; }
      await new Promise((r) => setTimeout(r, Math.max(250, 60_000 - (now - hits[0]) + 50)));
    }
  };
}
const finnhubGate = rateLimiter(55);   // 60/dk limitinde güvenli pay
const tdGate = rateLimiter(7);          // 8/dk
const FH_BG_CAP = 40;                   // periyodik arka plan taraması için yumuşak tavan
const TD_BG_CAP = 5;                     // TD arka plan tavanı → tıkla-aç grafiğe ~2/dk headroom

// Finnhub GET — limit + 429 backoff + JSON. Hata/eksik veride null döner.
// opts.bg=true → arka plan; düşük tavandan geçer (ön plana yer bırakır).
async function finnhub(path, params = {}, opts = {}) {
  if (!FINNHUB_KEY) return null;
  const qs = new URLSearchParams({ ...params, token: FINNHUB_KEY }).toString();
  const url = `https://finnhub.io/api/v1${path}?${qs}`;
  // Ön plan (fiyat) çağrıları 2 deneme × 7sn ile hızlı pes eder; arka plan
  // (radar temelleri) 3 denemeye kadar gider — kullanıcı isteği beklemez.
  const maxAttempts = opts.bg ? 3 : 2;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await finnhubGate(opts.bg ? FH_BG_CAP : 55);
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(7_000) });
      if (r.status === 429) { await new Promise((x) => setTimeout(x, 1500 * (attempt + 1))); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await new Promise((x) => setTimeout(x, 500 * (attempt + 1))); }
  }
  return null;
}

// Finnhub: anlık fiyat + önceki kapanış + günlük %
async function fhQuote(sym, opts) {
  const j = await finnhub("/quote", { symbol: sym }, opts);
  const price = Number(j?.c);
  if (!isFinite(price) || price === 0) return null;
  const pc = Number(j?.pc) || null;
  return {
    price,
    prevClose: pc,
    dayChangePct: isFinite(Number(j?.dp)) ? Number(j.dp) : (pc ? ((price - pc) / pc) * 100 : null),
    currency: "USD",
  };
}

// Finnhub: temel metrikler (bilanço + çoklu pencere getiri + 52h)
async function fhMetric(sym, opts) {
  const j = await finnhub("/stock/metric", { symbol: sym, metric: "all" }, opts);
  const m = j?.metric;
  if (!m) return {};
  const pct = (v) => (isFinite(Number(v)) ? Number(v) : null); // Finnhub yüzdeleri zaten % (ör. 12.3)
  const ret = (v) => (isFinite(Number(v)) ? Number(v) : null);
  return {
    w52High: pct(m["52WeekHigh"]),
    w52Low: pct(m["52WeekLow"]),
    ret1M: ret(m.monthToDatePriceReturnDaily) ?? ret(m["1MonthPriceReturnDaily"]) ?? null,
    ret3M: ret(m["13WeekPriceReturnDaily"]),
    ret6M: ret(m["26WeekPriceReturnDaily"]),
    ret1Y: ret(m["52WeekPriceReturnDaily"]),
    retYTD: ret(m.yearToDatePriceReturnDaily),
    beta: pct(m.beta),
    pe: pct(m.peNormalizedAnnual ?? m.peTTM ?? m.peExclExtraTTM),
    pegYr: pct(m.pegRatioTTM ?? m.pegRatio),
    revenueGrowth: pct(m.revenueGrowthTTMYoy ?? m.revenueGrowthQuarterlyYoy),
    earningsGrowth: pct(m.epsGrowthTTMYoy ?? m.epsGrowthQuarterlyYoy),
    grossMargin: pct(m.grossMarginTTM ?? m.grossMarginAnnual),
    profitMargin: pct(m.netProfitMarginTTM ?? m.netProfitMarginAnnual),
    roe: pct(m.roeTTM ?? m.roeRfy),
  };
}

// Finnhub: analist tavsiye konsensüsü (en güncel dönem)
async function fhRecommendation(sym, opts) {
  const arr = await finnhub("/stock/recommendation", { symbol: sym }, opts);
  if (!Array.isArray(arr) || !arr.length) return {};
  const r = arr[0]; // en yeni
  const sb = r.strongBuy || 0, b = r.buy || 0, h = r.hold || 0, s = r.sell || 0, ss = r.strongSell || 0;
  const total = sb + b + h + s + ss;
  if (!total) return {};
  // Ağırlıklı skor 1(strong sell)–5(strong buy)
  const wAvg = (5 * sb + 4 * b + 3 * h + 2 * s + 1 * ss) / total;
  let reco;
  if (wAvg >= 4.5) reco = "strong_buy";
  else if (wAvg >= 3.5) reco = "buy";
  else if (wAvg >= 2.5) reco = "hold";
  else if (wAvg >= 1.5) reco = "underperform";
  else reco = "sell";
  return { reco, recoCounts: { strongBuy: sb, buy: b, hold: h, sell: s, strongSell: ss }, recoTotal: total, recoScore: wAvg };
}

// Finnhub: son ~90 gün insider (Form 4) alım/satım özeti
async function fhInsider(sym, opts) {
  const from = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const j = await finnhub("/stock/insider-transactions", { symbol: sym, from, to }, opts);
  const rows = j?.data;
  if (!Array.isArray(rows)) return { buys: 0, sells: 0, buyValue: 0, netValue: 0, lastBuy: null };
  let buys = 0, sells = 0, buyValue = 0, netValue = 0, lastBuy = null;
  for (const t of rows) {
    const change = Number(t.change) || 0;     // +alım / −satım (adet)
    const price = Number(t.transactionPrice) || 0;
    const val = Math.abs(change) * price;
    // Yalnızca açık piyasa alım/satımı (P/S); ödül/exercise (A/M/F/G...) hariç
    const code = (t.transactionCode || "").toUpperCase();
    if (code === "P" || (change > 0 && code !== "A" && code !== "M")) {
      buys++; buyValue += val; netValue += val;
      if (!lastBuy && t.transactionDate) lastBuy = t.transactionDate;
    } else if (code === "S" || change < 0) {
      sells++; netValue -= val;
    }
  }
  return { buys, sells, buyValue, netValue, lastBuy };
}

/* ----------- Canlı veri: ABD hisseleri (Yahoo Finance, anahtarsız) ----- */
// Stooq, cloud/datacenter IP'lerine anti-bot (JS proof-of-work) ekranı
// gösterdiği için sunucuda (ör. Render) fiyat çekemiyordu. Yahoo'ya geçtik.
// Yahoo'nun query API'si cookie + crumb istiyor; bunu bir kez alıp ~25 dk
// saklıyoruz, sonra tek batch istekle (v7 quote) tüm sembolleri çekiyoruz.
let yahooAuth = { cookie: null, crumb: null, t: 0 };
const YAHOO_AUTH_TTL = 25 * 60_000;

async function getYahooAuth(force = false) {
  if (!force && yahooAuth.crumb && Date.now() - yahooAuth.t < YAHOO_AUTH_TTL) {
    return yahooAuth;
  }
  // 1) Cookie al (fc.yahoo.com 404 dönse de set-cookie verir)
  let cookie = null;
  for (const u of ["https://fc.yahoo.com", "https://finance.yahoo.com"]) {
    try {
      const c = await fetch(u, {
        headers: { "User-Agent": UA },
        redirect: "manual",
        signal: AbortSignal.timeout(12_000),
      });
      cookie = (c.headers.get("set-cookie") || "").split(";")[0] || null;
      if (cookie) break;
    } catch {}
  }
  // 2) Crumb al
  const cr = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookie || "", Accept: "text/plain" },
    signal: AbortSignal.timeout(12_000),
  });
  const crumb = (await cr.text()).trim();
  if (!cr.ok || !crumb || crumb.length > 40 || /[<{\s]/.test(crumb)) {
    throw new Error(`crumb alınamadı (${cr.status})`);
  }
  yahooAuth = { cookie, crumb, t: Date.now() };
  return yahooAuth;
}

async function fetchStocksYahoo(uniq) {
  const run = async () => {
    const { cookie, crumb } = await getYahooAuth();
    const url =
      `https://query1.finance.yahoo.com/v7/finance/quote` +
      `?symbols=${uniq.map(encodeURIComponent).join(",")}` +
      `&crumb=${encodeURIComponent(crumb)}`;
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Cookie: cookie || "", Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if ([401, 403, 429].includes(r.status)) {
      const e = new Error(String(r.status));
      e.retryAuth = true;
      throw e;
    }
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    return j?.quoteResponse?.result || [];
  };

  let result;
  try {
    result = await run();
  } catch (e) {
    if (e.retryAuth) {
      await getYahooAuth(true); // crumb'ı tazele ve bir kez daha dene
      result = await run();
    } else {
      throw e;
    }
  }

  const map = {};
  for (const q of result) {
    const price = Number(q.regularMarketPrice);
    if (!isFinite(price) || price === 0) continue;
    const prev = Number(q.regularMarketPreviousClose);
    const prevClose = isFinite(prev) && prev ? prev : null;
    map[(q.symbol || "").toUpperCase()] = {
      price,
      prevClose,
      dayChangePct: prevClose ? ((price - prevClose) / prevClose) * 100 : null,
      currency: "USD",
    };
  }
  return map;
}

/* -------- Disk-kalıcı fiyat/döviz önbelleği (stale-while-revalidate) -----
 * Render uyandığında ya da bir kaynak takıldığında kullanıcı BOŞ ekran
 * görmesin: son başarılı hisse fiyatları ve döviz/altın değeri diske yazılır
 * (price_cache.json), açılışta belleğe ısıtılır. Canlı çekim eksik/başarısız
 * olursa son bilinen değer "stale" işaretiyle döner — toplamlar hesaplanır,
 * ön yüz bunu "son bilinen değer" olarak gösterir. */
const PRICE_FILE = join(__dirname, "price_cache.json");
let lastStocks = {};      // SEMBOL → son başarılı quote
let lastMetals = null;    // son başarılı döviz/altın
let lastFunds = {};       // FON KODU → son başarılı fiyat
(async () => {
  try {
    const j = JSON.parse(await readFile(PRICE_FILE, "utf8"));
    if (j?.stocks && typeof j.stocks === "object") lastStocks = j.stocks;
    if (j?.metals) lastMetals = j.metals;
    if (j?.funds && typeof j.funds === "object") lastFunds = j.funds;
  } catch {}
})();
let priceSaveTimer = null;
function persistPrices() {
  clearTimeout(priceSaveTimer);
  priceSaveTimer = setTimeout(() => {
    writeFile(PRICE_FILE, JSON.stringify({ stocks: lastStocks, metals: lastMetals, funds: lastFunds, savedAt: Date.now() }), "utf8").catch(() => {});
  }, 1500);
  priceSaveTimer.unref?.();
}

/* ----------- Canlı veri: ABD hisseleri (Finnhub, ücretsiz API key) -----
 * Yahoo/Stooq cloud (ör. Render) IP'lerini engellediği için, FINNHUB_API_KEY
 * ortam değişkeni tanımlıysa fiyatlar Finnhub'tan çekilir (dakikada 60 istek
 * ücretsiz). Sembol başına /quote çağrısı yapılır (paralel).               */
async function fetchStocks(symbols) {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()))];
  if (!uniq.length) return {};
  const key = "stocks:" + uniq.sort().join(",");
  return cached(key, 60_000, async () => {
    let map = {};
    // Birincil: Finnhub (anahtarlı, cloud uyumlu, hızlı). Havuzla paralel.
    if (FINNHUB_KEY) {
      const results = await pool(uniq, 8, (sym) => fhQuote(sym).catch(() => null));
      uniq.forEach((sym, i) => { if (results[i]) map[sym] = results[i]; });
    }
    // Yedek (yalnızca yerel/ev IP'sinde çalışır): anahtarsız Yahoo.
    if (!Object.keys(map).length) {
      try { map = await fetchStocksYahoo(uniq); } catch {}
    }
    // Başarılı fiyatları kalıcı sakla
    if (Object.keys(map).length) { Object.assign(lastStocks, map); persistPrices(); }
    // Eksik kalan sembolleri son bilinen değerle (stale) doldur → boş ekran yok
    for (const sym of uniq) {
      if (!map[sym] && lastStocks[sym]) map[sym] = { ...lastStocks[sym], stale: true };
    }
    return map;
  });
}

/* ----------------- Canlı veri: Altın + Döviz (Truncgil) --------------- */
async function fetchMetals() {
  return cached("metals", 60_000, async () => {
    try {
      const j = await fetchJSON2("https://finans.truncgil.com/v4/today.json");
      const pick = (o) =>
        o ? { buying: o.Buying, selling: o.Selling, change: o.Change } : null;
      const out = {
        updated: j.Update_Date,
        gram: pick(j.GRA),
        usd: pick(j.USD),
        eur: pick(j.EUR),
        ceyrek: pick(j.CEY),
        yarim: pick(j.YAR),
        tam: pick(j.TAM),
      };
      if (out.usd?.selling && out.gram?.selling) { lastMetals = out; persistPrices(); }
      return out;
    } catch (e) {
      // Truncgil erişilemezse son bilinen döviz/altın → ₺ toplamları çökmesin
      if (lastMetals) return { ...lastMetals, stale: true };
      throw e;
    }
  });
}

/* --------------------- Canlı veri: TEFAS fonları ---------------------- */
function tefasDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
const FUND_FAIL_TTL = 5 * 60_000; // TEFAS erişilemezse 5 dk yeniden DENEME (her istek 12sn beklemesin)
const fundFailAt = {};            // code → son başarısız deneme zamanı
async function fetchFund(code) {
  const C = code.toUpperCase();
  // 30 dk içinde başarılı değer varsa onu kullan
  const hit = cache.get(`fund:${C}`);
  if (hit && Date.now() - hit.t < 30 * 60_000) return hit.v;
  // Son 5 dk içinde denenip başarısız olduysa, TEKRAR timeout bekleme:
  // elde son bilinen değer varsa stale döndür, yoksa ANINDA hata fırlat —
  // her iki halde de portfolio yanıtı 12sn TEFAS timeout'unda donmaz.
  if (fundFailAt[C] && Date.now() - fundFailAt[C] < FUND_FAIL_TTL) {
    if (lastFunds[C]) return { ...lastFunds[C], stale: true };
    throw new Error(`TEFAS ${C}: geçici erişilemiyor (yeniden denenecek)`);
  }
  try {
    const end = new Date();
    const start = new Date(Date.now() - 15 * 24 * 3600 * 1000);
    const body = {
      fonTipi: "YAT",
      fonKodu: C,
      aramaMetni: null, fonTurKod: null, fonGrubu: null, sfonTurKod: null,
      fonTurAciklama: null, kurucuKod: null,
      basTarih: tefasDate(start),
      bitTarih: tefasDate(end),
      basSira: 1, bitSira: 100000, dil: "TR",
      sFonTurKod: "", fonKod: "", fonGrup: "", fonUnvanTip: "",
    };
    const r = await fetchRetry("https://www.tefas.gov.tr/api/funds/fonGnlBlgSiraliGetir", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "*/*",
        "User-Agent": UA,
        Origin: "https://www.tefas.gov.tr",
        Referer: "https://www.tefas.gov.tr/tr/fon-verileri",
      },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    const rows = j?.resultList || [];
    if (!rows.length) throw new Error(`TEFAS ${code}: veri yok`);
    rows.sort((a, b) => new Date(a.tarih) - new Date(b.tarih)); // eskiden yeniye
    const last = rows[rows.length - 1];
    const prev = rows.length > 1 ? rows[rows.length - 2] : null;
    const v = {
      price: Number(last.fiyat),
      prevClose: prev ? Number(prev.fiyat) : null,
      name: last.fonUnvan,
    };
    cache.set(`fund:${C}`, { t: Date.now(), v });
    lastFunds[C] = v; delete fundFailAt[C];
    persistPrices();
    return v;
  } catch (e) {
    fundFailAt[C] = Date.now();
    if (lastFunds[C]) return { ...lastFunds[C], stale: true };
    throw e;
  }
}

/* --------------------- Canlı veri: VIX (oynaklık) -------------------- */
// Yahoo v8 chart auth gerektirmez; ^VIX'i 10 dk cache ile çekeriz.
// Yahoo sık sık 429 (throttle) döndüğü için son başarılı değeri hem bellekte
// hem de diskte (vix_cache.json) saklarız; böylece sunucu yeniden başlasa bile
// VIX kartı asla kaybolmaz, en fazla "bayat" (stale) gösterir.
const VIX_FILE = join(__dirname, "vix_cache.json");
const VIX_TTL = 10 * 60_000;
let lastVix = null;
let vixRefreshing = false;
(async () => {
  try {
    const j = JSON.parse(await readFile(VIX_FILE, "utf8"));
    if (isFinite(Number(j?.value))) lastVix = j;
  } catch {}
})();

// Yahoo'dan canlı VIX'i çekip belleğe + diske yazar. Hata olursa eldeki
// değeri "bayat" işaretler. Asla throw etmez (arka planda çağrılır).
async function refreshVix() {
  if (vixRefreshing) return lastVix;
  vixRefreshing = true;
  try {
    const url =
      "https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=5d";
    const r = await fetchRetry(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    const j = await r.json();
    const meta = j?.chart?.result?.[0]?.meta;
    const v = Number(meta?.regularMarketPrice);
    if (!isFinite(v) || v <= 0) throw new Error("VIX yok");
    const prev = Number(meta?.chartPreviousClose);
    lastVix = {
      value: v,
      prevClose: isFinite(prev) ? prev : null,
      changePct: prev ? ((v - prev) / prev) * 100 : null,
      fetchedAt: new Date().toISOString(),
      stale: false,
    };
    writeFile(VIX_FILE, JSON.stringify(lastVix), "utf8").catch(() => {});
  } catch {
    if (lastVix) lastVix.stale = true; // throttle/hata: eldeki değeri koru
  } finally {
    vixRefreshing = false;
  }
  return lastVix;
}

// İstek yolunda asla beklemez: eldeki değeri anında verir, bayatsa arka
// planda tazeler. Yalnızca hiç değer yoksa (ilk açılış) çekimi bekler.
async function fetchVix() {
  if (lastVix) {
    const age = Date.now() - new Date(lastVix.fetchedAt || 0).getTime();
    if (age > VIX_TTL) refreshVix(); // fire-and-forget
    return lastVix;
  }
  return refreshVix();
}

/* ============================================================
   Leopold Aschenbrenner — Situational Awareness LP 13F takibi
   ============================================================
   SEC EDGAR'dan fonun çeyreklik 13F-HR bildirimlerini çeker, son iki
   dönemi karşılaştırır (yeni/çıkış/artış/azalış) ve kullanıcının
   portföyüyle kesişimi + önerileri üretir. Bildirimler çeyreklik ve
   ~45 gün gecikmeli yayınlanır; short/nakit pozisyonlar görünmez,
   Put/Call satırları nominal (dayanak) değerle bildirilir. */
const LEO_CIK = "0002045724"; // Situational Awareness LP
const LEO_FILE = join(__dirname, "leopold_cache.json");
const LEO_TTL = 12 * 3600_000; // günde 2 kez kontrol yeter (dosyalar çeyreklik)
const LEO_UA = "PortfolioTracker/1.0 (personal portfolio tracker)";

// CUSIP → sembol. 13F'te ticker yoktur; fonun evreni küçük olduğundan
// statik eşleme en sağlamı. Bilinmeyen CUSIP isimle gösterilir.
const LEO_CUSIP = {
  "007903107": "AMD", "038169207": "APLD", "N07059210": "ASML",
  "05614L209": "BW", "G11448100": "BTDR", "09173B107": "BITF",
  "093712107": "BE", "11135F101": "AVGO", "18452B209": "CLSK",
  "21874A106": "CORZ", "21873S108": "CRWV", "219350105": "GLW",
  "433921103": "HIVE", "456788108": "INFY", "458140100": "INTC",
  "Q4982L109": "IREN", "595112103": "MU", "67066G104": "NVDA",
  "68389X105": "ORCL", "73933G202": "PSIX", "74347M108": "PUMP",
  "767292105": "RIOT", "80004C200": "SNDK", "778920306": "SAIH",
  "83418M103": "SEI", "35834F104": "TE", "874039100": "TSM",
  "92189F676": "SMH", "G96115103": "WYFI",
};

// "Neden almış?" — Situational Awareness tezinden (AGI altyapı yatırımı)
// tema çıkarımı. 13F gerekçe açıklamaz; bu satırlar fonun kamuya açık
// tezine dayalı yorumdur, açıklanmış gerekçe değildir.
const LEO_THEMES = [
  { syms: ["NVDA", "AMD", "AVGO", "TSM", "ASML", "INTC", "SMH"], theme: "AI çip tedarik zinciri",
    why: "AGI'ye giden yolda hesaplama gücü (compute) en kıt kaynak — çip tasarımcıları ve üreticileri talebin merkezinde." },
  { syms: ["MU", "SNDK"], theme: "AI bellek/depolama",
    why: "AI modelleri HBM ve yüksek kapasiteli depolamaya doymuyor; bellek fiyat döngüsü AI talebiyle yapısal olarak değişti tezi." },
  { syms: ["CRWV", "IREN", "CORZ", "APLD", "RIOT", "CLSK", "BITF", "BTDR", "HIVE", "WYFI"], theme: "AI veri merkezi / GPU bulutu",
    why: "Eski BTC madencileri elektrik kapasitesini AI veri merkezine dönüştürüyor; megavat başına değerleme hâlâ ucuz tezi." },
  { syms: ["BE", "SEI", "TE", "PSIX", "BW", "PUMP"], theme: "AI elektrik/güç altyapısı",
    why: "Veri merkezi patlamasının darboğazı elektrik — yakıt hücresi, türbin, güç çözümleri şirketleri talep patlaması yaşıyor." },
  { syms: ["ORCL"], theme: "AI bulut kapasitesi",
    why: "OCI + Stargate veri merkezi anlaşmalarıyla hiperölçekli AI bulut kiralama büyümesi." },
  { syms: ["GLW"], theme: "Optik/fiber bağlantı",
    why: "Veri merkezleri arası ve içi fiber-optik bağlantı talebi." },
];
function leoTheme(sym) {
  for (const t of LEO_THEMES) if (t.syms.includes(sym)) return t;
  return { theme: "Diğer", why: "Fonun tezindeki yeri kamuya açık verilerden net değil." };
}

function leoXmlTag(block, t) {
  const m = block.match(new RegExp(`<(?:\\w+:)?${t}>([\\s\\S]*?)</(?:\\w+:)?${t}>`));
  return m ? m[1].trim() : null;
}

async function leoFetch(url, asJson = true) {
  const r = await fetchRetry(url, { headers: { "User-Agent": LEO_UA, Accept: asJson ? "application/json" : "*/*" } });
  return asJson ? r.json() : r.text();
}

// Tek bir 13F dosyasının pozisyon tablosunu indirip parse eder
async function leoFetchFiling(accession) {
  const accNoDash = accession.replace(/-/g, "");
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(LEO_CIK)}/${accNoDash}`;
  const idx = await leoFetch(`${base}/index.json`);
  const xmlName = (idx?.directory?.item || [])
    .map((i) => i.name)
    .find((n) => n.endsWith(".xml") && n !== "primary_doc.xml");
  if (!xmlName) throw new Error("13F bilgi tablosu bulunamadı");
  const xml = await leoFetch(`${base}/${xmlName}`, false);
  const blocks = xml.match(/<(?:\w+:)?infoTable>[\s\S]*?<\/(?:\w+:)?infoTable>/g) || [];
  // Aynı sembol + tür (long/put/call) satırlarını birleştir
  const agg = new Map();
  for (const b of blocks) {
    const cusip = leoXmlTag(b, "cusip");
    const sym = LEO_CUSIP[cusip] || null;
    const name = (leoXmlTag(b, "nameOfIssuer") || "").replace(/&amp;/g, "&");
    const kind = (leoXmlTag(b, "putCall") || "long").toLowerCase(); // long | put | call
    const value = Number(leoXmlTag(b, "value")) || 0;               // USD (dolar cinsinden)
    const shares = Number(leoXmlTag(b, "sshPrnamt")) || 0;
    const key = `${sym || name}|${kind}`;
    const cur = agg.get(key) || { sym, name, kind, valueUSD: 0, shares: 0 };
    cur.valueUSD += value; cur.shares += shares;
    agg.set(key, cur);
  }
  return [...agg.values()].sort((a, b) => b.valueUSD - a.valueUSD);
}

let leoRefreshing = false;
async function refreshLeopold() {
  if (leoRefreshing) return null;
  leoRefreshing = true;
  try {
    const sub = await leoFetch(`https://data.sec.gov/submissions/CIK${LEO_CIK}.json`);
    const r = sub?.filings?.recent || {};
    const all = (r.form || []).map((f, i) => ({
      form: f, filedAt: r.filingDate[i], accession: r.accessionNumber[i], period: r.reportDate[i],
    })).filter((f) => f.form === "13F-HR" || f.form === "13F-HR/A");
    // Dönem başına en son dosyalanan (düzeltme varsa o) → son iki dönem
    const byPeriod = new Map();
    for (const f of all) {
      const cur = byPeriod.get(f.period);
      if (!cur || f.filedAt > cur.filedAt) byPeriod.set(f.period, f);
    }
    const periods = [...byPeriod.keys()].sort().reverse();
    if (!periods.length) throw new Error("13F bulunamadı");
    const curF = byPeriod.get(periods[0]);
    const prevF = periods[1] ? byPeriod.get(periods[1]) : null;

    // Önbellek güncelse yeniden indirme (SEC'e nazik ol)
    let old = null;
    try { old = JSON.parse(await readFile(LEO_FILE, "utf8")); } catch {}
    if (old?.current?.accession === curF.accession && old?.positions?.length) {
      old.checkedAt = new Date().toISOString();
      await writeFile(LEO_FILE, JSON.stringify(old, null, 2), "utf8");
      return old;
    }

    const positions = await leoFetchFiling(curF.accession);
    const prevPositions = prevF ? await leoFetchFiling(prevF.accession) : [];
    const out = {
      checkedAt: new Date().toISOString(),
      fund: "Situational Awareness LP (Leopold Aschenbrenner)",
      cik: LEO_CIK,
      current: { period: curF.period, filedAt: curF.filedAt, accession: curF.accession },
      previous: prevF ? { period: prevF.period, filedAt: prevF.filedAt, accession: prevF.accession } : null,
      positions, prevPositions,
    };
    await writeFile(LEO_FILE, JSON.stringify(out, null, 2), "utf8");
    return out;
  } finally {
    leoRefreshing = false;
  }
}

async function getLeopold() {
  let cached = null;
  try { cached = JSON.parse(await readFile(LEO_FILE, "utf8")); } catch {}
  const age = cached ? Date.now() - new Date(cached.checkedAt || 0).getTime() : Infinity;
  if (cached && age < LEO_TTL) return cached;
  try {
    const fresh = await refreshLeopold();
    if (fresh) return fresh;
  } catch {}
  return cached; // ağ hatasında eldekiyle devam
}

/* ----------------- Canlı veri: CNN Fear & Greed Index ---------------- */
// CNN dataviz endpoint'i auth gerektirmez; tarayıcı benzeri UA ister.
const FNG_FILE = join(__dirname, "fng_cache.json");
const FNG_TTL = 30 * 60_000;
let lastFng = null;
let fngRefreshing = false;
(async () => {
  try {
    const j = JSON.parse(await readFile(FNG_FILE, "utf8"));
    if (isFinite(Number(j?.score))) lastFng = j;
  } catch {}
})();

async function refreshFng() {
  if (fngRefreshing) return lastFng;
  fngRefreshing = true;
  try {
    const url = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";
    const r = await fetchRetry(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        Referer: "https://edition.cnn.com/markets/fear-and-greed",
      },
    });
    const j = await r.json();
    const fg = j?.fear_and_greed;
    const score = Number(fg?.score);
    if (!isFinite(score)) throw new Error("F&G yok");
    lastFng = {
      score: Math.round(score),
      rating: fg?.rating || null,
      prevClose: isFinite(Number(fg?.previous_close)) ? Math.round(Number(fg.previous_close)) : null,
      week: isFinite(Number(fg?.previous_1_week)) ? Math.round(Number(fg.previous_1_week)) : null,
      month: isFinite(Number(fg?.previous_1_month)) ? Math.round(Number(fg.previous_1_month)) : null,
      year: isFinite(Number(fg?.previous_1_year)) ? Math.round(Number(fg.previous_1_year)) : null,
      updatedAt: fg?.timestamp || null,
      fetchedAt: new Date().toISOString(),
    };
    writeFile(FNG_FILE, JSON.stringify(lastFng), "utf8").catch(() => {});
  } catch {
    /* throttle/hata: eldeki değeri koru */
  } finally {
    fngRefreshing = false;
  }
  return lastFng;
}

async function fetchFearGreed() {
  if (lastFng) {
    const age = Date.now() - new Date(lastFng.fetchedAt || 0).getTime();
    if (age > FNG_TTL) refreshFng(); // fire-and-forget
    return lastFng;
  }
  return refreshFng();
}

// Fear & Greed skorundan band + ton üret (CNN ölçeği: 0–100)
function fngBand(score) {
  if (score == null || !isFinite(score)) return null;
  if (score < 25) return { band: "Aşırı Korku", tone: "opportunity", note: "Piyasada panik — uzun vade için fırsat bölgesi." };
  if (score < 45) return { band: "Korku", tone: "watch", note: "Tedirginlik hakim — kademeli alım izle." };
  if (score < 55) return { band: "Nötr", tone: "calm", note: "Dengeli duygu — net yön yok." };
  if (score < 75) return { band: "Açgözlülük", tone: "watch", note: "İyimserlik yüksek — kâr-al disiplinine dikkat." };
  return { band: "Aşırı Açgözlülük", tone: "extreme", note: "Aşırı iyimserlik — temkinli ol, kâr realize et." };
}

// VIX bandına göre hedef nakit / portföy oranı (kullanıcının stratejisi)
function vixRegime(vix) {
  if (vix == null || !isFinite(vix)) return null;
  let band, cash, note, tone;
  if (vix < 14) {
    band = "Çok Sakin"; cash = [25, 30]; tone = "calm";
    note = "Düşük oynaklık — temkinli ol, nakit ağırlığını yüksek tut.";
  } else if (vix < 21) {
    band = "Sakin"; cash = [20, 25]; tone = "calm";
    note = "Normal piyasa — dengeli pozisyon.";
  } else if (vix < 25) {
    band = "Tedirgin"; cash = [15, 20]; tone = "watch";
    note = "Oynaklık artıyor — kademeli alım için nakdi kullanmaya başla.";
  } else if (vix < 30) {
    band = "Korku"; cash = [10, 15]; tone = "opportunity";
    note = "Korku yükseliyor — alım fırsatları artıyor.";
  } else if (vix < 40) {
    band = "Yüksek Korku"; cash = [5, 10]; tone = "opportunity";
    note = "Agresif alım bölgesi — nakdin büyük kısmını kullan.";
  } else if (vix < 50) {
    band = "Nadir Fırsat"; cash = [0, 5]; tone = "rare";
    note = "Nadir fırsat! Mümkünse portföye dışarıdan para ekle, agresif ol.";
  } else {
    band = "Piyango"; cash = [0, 5]; tone = "extreme";
    note = "On yılda birkaç kez! Maksimum agresiflik (örn. 5 Ağu 2024 carry-trade).";
  }
  return {
    band,
    targetCash: cash,
    targetInvested: [100 - cash[1], 100 - cash[0]],
    note,
    tone,
  };
}

/* ----------------- Sinyal motoru: RSI / SMA / analist ----------------
 * Teknikler (yavaş değişir) 6 saatte bir arka planda yenilenir; canlı fiyatla
 * birleştirilip her istekte sinyal + kâr-al önerisi üretilir.
 * Yahoo throttle'ına karşı: semboller aralıklı çekilir, eski değer korunur. */
const signalCache = {}; // { SYMBOL: { rsi, sma20, sma50, sma200, w52High, w52Low, targetMean, numAnalysts, reco, t } }
const SIGNAL_TTL = 20 * 3600_000; // günlük mum verisi — ~günde bir tarama yeter (TD 8/dk kotası dar)
let signalsRefreshing = false;

// RSI eşikleri — TEK standart: sinyal motoru, swing planı ve grafik yorumu
// hepsi aynı eşiği kullanır; aynı hisse iki görünümde farklı konuşmaz.
const RSI_OVERSOLD = 35;   // altı: aşırı satım
const RSI_OVERBOUGHT = 72; // üstü: aşırı alım

function sma(arr, n) {
  return arr.length >= n ? arr.slice(-n).reduce((a, b) => a + b, 0) / n : null;
}
function rsiCalc(arr, n = 14) {
  if (arr.length < n + 1) return null;
  let gains = 0, losses = 0;
  for (let i = arr.length - n; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  if (losses === 0) return 100;
  const rs = (gains / n) / (losses / n);
  return 100 - 100 / (1 + rs);
}

function atr14(highs, lows, closes, n = 14) {
  const len = closes.length;
  if (len < n + 1) return null;
  let sum = 0;
  for (let i = len - n; i < len; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    sum += tr;
  }
  return sum / n;
}

// Günlük mum geçmişi. Birincil: TwelveData (anahtarlı, cloud uyumlu).
// Yedek: anahtarsız Yahoo chart (yalnızca ev IP'sinde çalışır).
async function fetchHistory(symbol, opts = {}) {
  // Tek kaynak: birleşik mum önbelleği (getCandles → TwelveData). Tarama bu
  // mumları cache'e yazar, grafik modalı da aynısını okur → çift TD çağrısı yok.
  const candles = await getCandles(symbol, opts);
  if (candles && candles.length) {
    const closes = candles.map((c) => c.close), highs = candles.map((c) => c.high), lows = candles.map((c) => c.low);
    const last = (a) => a.slice(-252);
    return {
      closes, highs, lows,
      w52High: highs.length ? Math.max(...last(highs)) : null,
      w52Low: lows.length ? Math.min(...last(lows)) : null,
    };
  }
  // Yedek: anahtarsız Yahoo chart (yalnızca ev IP'sinde çalışır)
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`;
    const r = await fetchRetry(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    const q = res?.indicators?.quote?.[0] || {};
    const rawC = q.close || [], rawH = q.high || [], rawL = q.low || [];
    const closes = [], highs = [], lows = [];
    for (let i = 0; i < rawC.length; i++) {
      if (rawC[i] != null && rawH[i] != null && rawL[i] != null) {
        closes.push(rawC[i]); highs.push(rawH[i]); lows.push(rawL[i]);
      }
    }
    const m = res?.meta || {};
    return { closes, highs, lows, w52High: m.fiftyTwoWeekHigh ?? null, w52Low: m.fiftyTwoWeekLow ?? null };
  } catch { return { closes: [], highs: [], lows: [], w52High: null, w52Low: null }; }
}

async function fetchAnalystY(symbol) {
  try {
    const { cookie, crumb } = await getYahooAuth();
    const url =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
      `?modules=financialData&crumb=${encodeURIComponent(crumb)}`;
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Cookie: cookie || "", Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) return {};
    const j = await r.json();
    const fd = j?.quoteSummary?.result?.[0]?.financialData || {};
    return {
      targetMean: fd.targetMeanPrice?.raw ?? null,
      numAnalysts: fd.numberOfAnalystOpinions?.raw ?? null,
      reco: fd.recommendationKey ?? null,
    };
  } catch { return {}; }
}

async function refreshSignals(symbols) {
  if (signalsRefreshing || !symbols.length) return;
  signalsRefreshing = true;
  try {
    const uniq = [...new Set(symbols.map((s) => s.toUpperCase()))];
    // Havuz: TD/Finnhub gate'leri kotayı kendi içinde sınırlar, burada paralelize edebiliriz.
    await pool(uniq, 4, async (sym) => {
      try {
        const [hist, analyst] = await Promise.all([
          fetchHistory(sym, { bg: true }),                    // arka plan tavanı
          fhRecommendation(sym, { bg: true }).catch(() => ({})),
        ]);
        if (hist.closes.length) {
          const last20H = hist.highs.slice(-20), last20L = hist.lows.slice(-20);
          const tech = {
            rsi: rsiCalc(hist.closes, 14),
            sma20: sma(hist.closes, 20),
            sma50: sma(hist.closes, 50),
            sma200: sma(hist.closes, 200),
            w52High: hist.w52High,
            w52Low: hist.w52Low,
            atr: atr14(hist.highs, hist.lows, hist.closes, 14),
            high20: last20H.length ? Math.max(...last20H) : null,
            low20: last20L.length ? Math.min(...last20L) : null,
            lastClose: hist.closes[hist.closes.length - 1],
          };
          signalCache[sym] = { ...tech, ...analyst, t: Date.now() };
        }
      } catch { /* eski değeri koru */ }
    });
    // Diske kalıcı yaz (restart sonrası anında gösterim)
    try {
      const data = await loadData();
      data.signals = signalCache;
      await saveData(data);
    } catch {}
    await persistCandleCache(); // grafik mumları da kalıcı olsun
    // Sinyal Karnesi: yeni kurulumları kaydet + açık kayıtları taze mumlarla değerlendir
    try {
      recordSignals(uniq);
      evaluateLedger();
      await persistLedger();
    } catch (e) { console.error("sinyal karnesi:", e.message); }
  } finally {
    signalsRefreshing = false;
  }
}

// Cache stale ise arka planda yenile (isteği bloklamadan)
function maybeRefreshSignals(symbols) {
  const vals = Object.values(signalCache);
  const oldest = vals.length ? Math.min(...vals.map((v) => v.t || 0)) : 0;
  const missing = symbols.some((s) => !signalCache[s.toUpperCase()]);
  if (!signalsRefreshing && (missing || Date.now() - oldest > SIGNAL_TTL)) {
    refreshSignals(symbols); // await yok: arka planda
  }
}

// Swing kurulumu — TEK kaynak: buildPlan (Swing Tarayıcı ile aynı motor).
// Eskiden burada ayrı bir computeSwing vardı; eşikleri farklıydı ve aynı hisse
// portföy kartında başka, tarayıcıda başka konuşuyordu. Artık ikisi de aynı
// planı üretir; bu fonksiyon planın kurulum kısmını eski şemaya indirger.
function swingFromPlan(plan) {
  if (!plan?.setup || plan.entry == null) return null;
  return {
    type: plan.setup.type, label: plan.setup.label,
    entry: plan.entry, entryType: plan.entryType, stop: plan.stop, target: plan.target,
    rr: plan.rr, riskPct: plan.riskPct, rewardPct: plan.rewardPct,
    grade: plan.grade, note: plan.note,
  };
}

/* ---------------- Pozisyon Bekçisi: iz süren stop (Chandelier) ----------------
 * Açık pozisyonlar için 22 günlük zirve − 3×ATR trailing stop'u mum
 * önbelleğinden hesaplar (ek API çağrısı yok). Holding'de manuel planStop /
 * planTarget varsa stop = max(chandelier, manuel) → trailing stop manuel
 * stopun altına asla inmez, sadece yukarı taşır. */
function computeGuard(sym, h, price) {
  const candles = candleCache[sym]?.candles;
  if (price == null || !candles || candles.length < 30) return null;
  const highs = candles.map((c) => c.high), lows = candles.map((c) => c.low), closes = candles.map((c) => c.close);
  const atr = atr14(highs, lows, closes);
  if (!atr) return null;
  const hh22 = Math.max(...highs.slice(-22));
  const chandelier = hh22 - 3 * atr;
  const num = (v) => (v != null && v !== "" && isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const manualStop = num(h.planStop);
  const target = num(h.planTarget);
  const stop = manualStop != null ? Math.max(chandelier, manualStop) : chandelier;
  if (!isFinite(stop) || stop <= 0) return null;
  const distPct = ((price - stop) / price) * 100;
  return {
    stop, chandelier, manualStop, target, atr, hh22, distPct,
    breached: price <= stop,
    near: price > stop && distPct <= 3,
    targetHit: target != null && price >= target,
  };
}

/* ---------------- Bilanço Nöbetçisi: Finnhub earnings calendar ----------------
 * Portföy + izleme listesi sembollerinin yaklaşan bilanço tarihleri.
 * 12 saatte bir arka planda tazelenir; swing pozisyonunu bilanço gecesine
 * taşıma riskine karşı kartlarda/radarda uyarı üretir. */
const EARN_TTL = 12 * 3600_000;
const earnCache = { t: 0, map: {}, refreshing: false };
async function refreshEarnings(symbols) {
  if (earnCache.refreshing || !FINNHUB_KEY || !symbols.length) return;
  // Harita DOLUYSA TTL'e uy; BOŞSA (cold start / restart) TTL'i yoksay, hemen doldur.
  const hasData = Object.keys(earnCache.map).length > 0;
  if (hasData && Date.now() - earnCache.t < EARN_TTL) return;
  earnCache.refreshing = true;
  try {
    const uniq = [...new Set(symbols.map((s) => s.toUpperCase()))];
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    const map = {};
    await pool(uniq, 4, async (sym) => {
      const j = await finnhub("/calendar/earnings", { symbol: sym, from, to }, { bg: true });
      const list = Array.isArray(j?.earningsCalendar) ? j.earningsCalendar : [];
      let best = null;
      for (const e of list) if (e?.date && (!best || e.date < best.date)) best = e;
      if (best) map[sym] = { date: best.date, hour: best.hour || null, epsEstimate: best.epsEstimate ?? null };
    });
    earnCache.map = map;
    earnCache.t = Date.now();
  } finally { earnCache.refreshing = false; }
}
function earningsFor(sym) {
  const e = earnCache.map[String(sym).toUpperCase()];
  if (!e) return null;
  const days = Math.ceil((new Date(e.date + "T00:00:00Z") - Date.now()) / 86400_000);
  if (days < 0) return null;
  return { ...e, daysLeft: days };
}

// Cached teknikler + canlı fiyat → sinyal + kâr-al önerisi.
// Çıktı açıklamalıdır: her puanın gerekçesi `reasons`'ta, hepsinin düz Türkçe
// özeti `summary`'de; verinin yaşı `asOf`/`stale` ile şeffaftır.
function buildSignal(sym, price, costUSD) {
  const t = signalCache[sym];
  if (!t || price == null) return null;
  const out = {
    rsi: t.rsi, sma20: t.sma20, sma50: t.sma50, sma200: t.sma200,
    w52High: t.w52High, w52Low: t.w52Low,
    targetMean: t.targetMean, numAnalysts: t.numAnalysts, reco: t.reco,
    recoCounts: t.recoCounts, recoTotal: t.recoTotal,
    asOf: t.t,
    stale: Date.now() - (t.t || 0) > SIGNAL_TTL * 1.5, // teknikler taranamadı → bayat
  };
  if (t.w52Low && t.w52High && t.w52High > t.w52Low) {
    out.fromLowPct = ((price - t.w52Low) / t.w52Low) * 100;
    out.fromHighPct = ((price - t.w52High) / t.w52High) * 100;
  }
  if (t.targetMean && price) out.upsidePct = ((t.targetMean - price) / price) * 100;

  // --- Alım bölgesi skoru: her bileşen gerekçesiyle yazılır ---
  let score = 0; const reasons = [];
  if (t.rsi != null) {
    if (t.rsi < RSI_OVERSOLD) { score += 2; reasons.push(`RSI ${t.rsi.toFixed(0)} aşırı satım — kısa vadede çok düştü, sıçrama potansiyeli`); }
    else if (t.rsi > RSI_OVERBOUGHT) { score -= 2; reasons.push(`RSI ${t.rsi.toFixed(0)} aşırı alım — kısa vadede çok ısındı, geri çekilme riski`); }
  }
  if (t.sma200 && price < t.sma200) { score += 1; reasons.push("fiyat 200 günlük ortalamanın altında — uzun vadeye göre ucuzlamış"); }
  if (out.fromLowPct != null && out.fromLowPct <= 10) { score += 1; reasons.push(`52 hafta dibine sadece %${out.fromLowPct.toFixed(0)} uzakta`); }
  if (out.upsidePct != null && out.upsidePct >= 20) { score += 1; reasons.push(`analist hedefine +%${out.upsidePct.toFixed(0)} potansiyel`); }
  if (t.reco === "strong_buy") { score += 1; reasons.push(`analist konsensüsü güçlü al${t.recoTotal ? ` (${t.recoTotal} analist)` : ""}`); }
  else if (t.reco === "buy") { reasons.push(`analist konsensüsü al${t.recoTotal ? ` (${t.recoTotal} analist)` : ""}`); }
  else if (t.reco === "sell") { score -= 1; reasons.push("analist konsensüsü sat"); }
  if (score >= 2) out.signal = { emoji: "🟢", label: "ALIM BÖLGESİ", tone: "buy" };
  else if (score <= -2) out.signal = { emoji: "🔴", label: "AŞIRI ALIM", tone: "sell" };
  else out.signal = { emoji: "🟡", label: "NÖTR", tone: "neutral" };
  out.reasons = reasons;
  out.score = score;

  // --- İşlem planı + swing kurulumu: Swing Tarayıcı ile AYNI motor ---
  const plan = (t.atr && t.lastClose) ? buildPlan(planCtxFromCache(t, price)) : null;
  out.plan = plan;
  out.swing = swingFromPlan(plan);

  // --- Kâr-al önerisi (RSI + kazanç) ---
  out.profitTake = null;
  if (costUSD && price) {
    const gainPct = ((price - costUSD) / costUSD) * 100;
    out.gainPct = gainPct;
    const r = t.rsi;
    if (gainPct >= 20 && (r == null || r >= RSI_OVERBOUGHT || gainPct >= 30)) {
      out.profitTake = { trim: "%25-33", level: "strong", text: `+%${gainPct.toFixed(0)} kazanç${r != null ? `, RSI ${r.toFixed(0)}` : ""} → pozisyonun %25-33'ünde kâr al (kalanı trende bırak)` };
    } else if (gainPct >= 15 && r != null && r >= 65) {
      out.profitTake = { trim: "%20", level: "medium", text: `+%${gainPct.toFixed(0)} kazanç, RSI ${r.toFixed(0)} ısınmış → %20 kâr almayı düşün` };
    } else if (gainPct >= 10 && r != null && r >= RSI_OVERBOUGHT) {
      out.profitTake = { trim: "%10-15", level: "light", text: `+%${gainPct.toFixed(0)} kazanç, RSI ${r.toFixed(0)} aşırı alım → %10-15 kısmi kâr al` };
    }
  }

  // --- Düz Türkçe özet: rozetin/tablonun yanında tek cümlede "neden?" ---
  const parts = [];
  parts.push(`${out.signal.label} (skor ${score >= 0 ? "+" : ""}${score})`);
  parts.push(reasons.length ? "Gerekçe: " + reasons.join("; ") : "belirgin sinyal yok, göstergeler nötr bölgede");
  if (out.swing) parts.push(`Kurulum: ${out.swing.label} (not ${out.swing.grade})`);
  if (out.profitTake) parts.push(`Kâr-al: ${out.profitTake.text}`);
  if (out.stale) parts.push("⚠️ teknik veriler bayat (tarama bekleniyor)");
  out.summary = parts.join(". ") + ".";
  return out;
}

/* ------------- Opsiyon zinciri (Yahoo) — güncel prim oto-çek -------------
 * Best-effort: Yahoo throttle ederse boş döner, kullanıcı manuel girebilir.
 * Belirli (sembol, vade) için strike→prim haritası, 10 dk cache. */
async function fetchOptionChain(symbol, expiryISO) {
  return cached(`opt:${symbol}:${expiryISO}`, 10 * 60_000, async () => {
    let auth = {};
    try { auth = await getYahooAuth(); } catch {}
    const base = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`;
    const headers = { "User-Agent": UA, Accept: "application/json", Cookie: auth.cookie || "" };
    const withCrumb = (u) => (auth.crumb ? `${u}${u.includes("?") ? "&" : "?"}crumb=${encodeURIComponent(auth.crumb)}` : u);

    const r1 = await fetch(withCrumb(base), { headers, signal: AbortSignal.timeout(12_000) });
    if (!r1.ok) throw new Error(String(r1.status));
    const root = (await r1.json())?.optionChain?.result?.[0];
    const exps = root?.expirationDates || [];
    const target = Math.floor(new Date(expiryISO + "T00:00:00Z").getTime() / 1000);
    let pick = exps.find((e) => Math.abs(e - target) < 2 * 86400);
    if (pick == null && exps.length) {
      pick = exps.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    }
    let opts = root?.options?.[0];
    if (pick && (!opts || opts.expirationDate !== pick)) {
      const r2 = await fetch(withCrumb(`${base}?date=${pick}`), { headers, signal: AbortSignal.timeout(12_000) });
      if (r2.ok) opts = (await r2.json())?.optionChain?.result?.[0]?.options?.[0];
    }
    const map = {};
    for (const [kind, key] of [["calls", "call"], ["puts", "put"]]) {
      for (const c of opts?.[kind] || []) {
        const mid = c.bid > 0 && c.ask > 0 ? (c.bid + c.ask) / 2 : (c.lastPrice || null);
        if (mid != null && isFinite(mid)) map[`${key}|${c.strike}`] = mid;
      }
    }
    return map;
  });
}

/* Beklenen oynaklık (bilanço): ATM straddle / fiyat. Opsiyon piyasasının
 * bilanço haftası için fiyatladığı ~±% hareket. Bilanço tarihine en yakın
 * vade seçilir; ATM = fiyata en yakın strike; straddle = ATM call + put primi.
 * Yahoo zinciri (bulut IP'lerinde erişilemeyebilir) → en iyi çaba, yoksa null. */
async function expectedEarningsMove(symbol, price, earnDateISO) {
  if (!price || !earnDateISO) return null;
  try {
    const chain = await fetchOptionChain(symbol, earnDateISO);
    const strikes = [...new Set(Object.keys(chain || {}).map((k) => Number(k.split("|")[1])))].filter((s) => s > 0);
    if (!strikes.length) return null;
    const atm = strikes.reduce((a, b) => (Math.abs(b - price) < Math.abs(a - price) ? b : a));
    const call = chain[`call|${atm}`], put = chain[`put|${atm}`];
    if (call == null || put == null) return null;
    const pct = ((call + put) / price) * 100;
    return isFinite(pct) && pct > 0 && pct < 80 ? Math.round(pct * 10) / 10 : null;
  } catch { return null; }
}

/* ====================================================================== *
 *  HİSSE RADARI — momentum + analist + bilanço + insider birleşik skor
 *  Resimlerdeki takip listesi temalara göre gruplanır, arka planda yenilenir.
 * ====================================================================== */
const RADAR_FILE = join(__dirname, "radar.json");
const RADAR_GROUPS = [
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
const RADAR_THEME = {};
for (const g of RADAR_GROUPS) for (const s of g.symbols) if (!RADAR_THEME[s]) RADAR_THEME[s] = { key: g.key, title: g.title };
const RADAR_SYMBOLS = [...new Set(RADAR_GROUPS.flatMap((g) => g.symbols))];

// Hisse hikâyesi / katalizör — neden takipte olduğunu tek cümlede anlatan etiket.
// Skoru etkilemez; yalnızca "bu hissenin hikâyesi ne?" bağlamını verir.
const RADAR_STORY = {
  NVDA: "Yapay zekâ çip talebinin lideri", AMD: "AI/veri merkezi çip ikinci oyuncu",
  AVGO: "AI özel çip + ağ donanımı", MU: "AI bellek (HBM) süper döngüsü",
  TSM: "Tüm gelişmiş çiplerin fabrikası", ARM: "Çip mimarisi lisans modeli",
  ANET: "AI veri merkezi ağ anahtarları", COHR: "Optik bağlantı / AI fiber",
  LITE: "Veri merkezi optik bileşen", AAOI: "AI veri merkezi optik kablo",
  AAPL: "iPhone + servis ekosistemi, AI atağı", TSLA: "Robotaksi + insansı robot Optimus",
  MSFT: "Copilot + Azure AI bulutu", AMZN: "AWS bulut + AI altyapısı",
  META: "Reklam gücü + AI ve akıllı gözlük", GOOGL: "Arama + Gemini AI + bulut",
  NFLX: "Reklamlı abonelik + içerik gücü", COST: "Defansif perakende, üyelik modeli",
  JPM: "En güçlü ABD bankası", WMT: "Perakende + reklam/lojistik büyümesi",
  DIS: "Streaming kârlılığa geçiş + parklar", UBER: "Ulaşım + teslimat kârlılık dönemi",
  PLTR: "Kurumsal + savunma AI yazılımı", SMCI: "AI sunucu üreticisi",
  COIN: "Kripto borsası + stablecoin", RKLB: "Küçük fırlatma + uzay sistemleri",
  IONQ: "Kuantum bilgisayar öncüsü", RGTI: "Kuantum çip üreticisi",
  OKLO: "Küçük modüler nükleer reaktör", SMR: "NuScale modüler nükleer",
  ASTS: "Uydudan doğrudan cep telefonu", CRWD: "Bulut siber güvenlik lideri",
  SNOW: "Veri bulutu + AI analitik", NET: "Cloudflare kenar ağ + AI",
  DDOG: "Bulut gözlemleme platformu", MDB: "Modern veritabanı (AI uygulama)",
  CELH: "Hızlı büyüyen enerji içeceği", SOFI: "Dijital bankacılık süper-app",
  AFRM: "Şimdi al sonra öde (BNPL)", RIVN: "Elektrikli kamyon + VW ortaklığı",
  RDDT: "Reddit reklam + AI veri lisansı", DKNG: "Online spor bahis lideri",
  LLY: "Obezite/diyabet ilacı (GLP-1) patlaması", ISRG: "Robotik cerrahi tekeli",
  BWXT: "Nükleer + savunma reaktörleri", NEE: "Yenilenebilir enerji devi",
  HOOD: "Perakende yatırımcı + kripto platformu", KKR: "Alternatif varlık yönetimi",
  ORCL: "Bulut + AI veri merkezi kapasitesi", NOW: "Kurumsal iş akışı + AI ajan",
  CRM: "CRM + Agentforce AI", SHOP: "E-ticaret altyapısı", TTD: "Bağlantılı TV reklam platformu",
};

let radarCache = {};       // { SYMBOL: {...entry} }
let radarUpdated = 0;
let radarRefreshing = false;
const RADAR_TTL = 6 * 3600_000;
const FUND_TTL = 22 * 3600_000; // temel veriler (bilanço/analist/insider) ~günlük tazelenir

// Temeller tazelenmediğinde cache'ten taşınacak alanlar (fiyat hariç her şey)
const RADAR_METRIC_KEYS = ["w52High", "w52Low", "ret1M", "ret3M", "ret6M", "ret1Y", "retYTD",
  "beta", "pe", "pegYr", "revenueGrowth", "earningsGrowth", "grossMargin", "profitMargin", "roe"];
const RADAR_RECO_KEYS = ["reco", "recoCounts", "recoTotal", "recoScore"];
const pickFund = (obj, keys) => { const o = {}; for (const k of keys) if (obj[k] !== undefined) o[k] = obj[k]; return o; };

// Diskten yükle (restart sonrası anında göster)
(async () => {
  try {
    const raw = JSON.parse(await readFile(RADAR_FILE, "utf8"));
    radarCache = raw.items || {};
    radarUpdated = raw.updated || 0;
  } catch {}
  // Render'da dosya her restart'ta silinir → Postgres kopyası varsa ve daha
  // yeniyse onu kullan (radar uyanır uyanmaz SON TAM taramayla dolu gelir)
  try {
    const db = await kvLoad("radar_cache");
    if (db?.items && (db.updated || 0) > radarUpdated) {
      radarCache = db.items;
      radarUpdated = db.updated || 0;
      console.log(`  Radar önbelleği Postgres'ten yüklendi (${Object.keys(radarCache).length} sembol)`);
    }
  } catch {}
})();

// Yahoo quoteSummary — fiyat + bilanço/temel metrikler tek çağrıda
// Finnhub: şirket adı + piyasa değeri (profil; ad nadiren değişir)
async function fhProfile(sym, opts) {
  const j = await finnhub("/stock/profile2", { symbol: sym }, opts);
  if (!j) return {};
  return {
    name: j.name || null,
    marketCap: isFinite(Number(j.marketCapitalization)) ? Number(j.marketCapitalization) * 1e6 : null,
    industry: j.finnhubIndustry || null,        // sektör/endüstri (grafik stats kutusu)
    exchange: j.exchange || null,               // borsa (NASDAQ/NYSE)
    shares: isFinite(Number(j.shareOutstanding)) ? Number(j.shareOutstanding) * 1e6 : null,
  };
}

/* RS Rating (IBD tarzı 1-99): ağırlıklı çoklu-dönem getiriyi tarama evreninde
 * yüzdelik sıralar. 0.4·3ay + 0.2·6ay + 0.2·9ay + 0.2·12ay. Evren = candleCache. */
function weightedPerf(candles) {
  if (!candles || candles.length < 70) return null;
  const c = candles.map((x) => x.close);
  const n = c.length, last = c[n - 1];
  const at = (d) => (n > d ? c[n - 1 - d] : c[0]);
  const r = (d) => { const p = at(d); return p > 0 ? (last - p) / p : 0; };
  return 0.4 * r(63) + 0.2 * r(126) + 0.2 * r(189) + 0.2 * r(252);
}
function rsRating(sym, candles) {
  const mine = weightedPerf(candles);
  if (mine == null) return null;
  const perfs = [];
  for (const k of Object.keys(candleCache)) {
    const cs = candleCache[k]?.candles;
    const p = weightedPerf(cs);
    if (p != null && isFinite(p)) perfs.push(p);
  }
  if (perfs.length < 8) return null;            // evren çok küçükse anlamsız
  const below = perfs.filter((p) => p < mine).length;
  return Math.max(1, Math.min(99, Math.round((below / perfs.length) * 98) + 1));
}

// OpenInsider — son ~90 günde yönetici alım/satımları (Form 4)
async function fetchInsider(symbol) {
  try {
    const r = await fetchRetry(
      `http://openinsider.com/${encodeURIComponent(symbol)}`,
      { headers: { "User-Agent": UA } }, 2
    );
    const html = await r.text();
    const tbl = html.split('class="tinytable"')[1];
    if (!tbl) return { buys: 0, sells: 0, buyValue: 0, netValue: 0, lastBuy: null };
    const body = (tbl.split("</thead>")[1] || tbl).split("</table>")[0];
    const rows = body.split(/<tr[ >]/).slice(1);
    const now = Date.now(), DAYS90 = 90 * 86400_000;
    let buys = 0, sells = 0, buyValue = 0, netValue = 0, lastBuy = null;
    for (const row of rows.slice(0, 80)) {
      const dates = row.match(/20\d\d-\d\d-\d\d/g);
      const tradeDate = dates ? dates[1] || dates[0] : null;
      if (tradeDate && now - new Date(tradeDate + "T00:00:00Z").getTime() > DAYS90) continue;
      const type = /<td>\s*([PS])\s*-\s*(Purchase|Sale)/i.exec(row);
      const val = /([+\-])\$([\d,]+)/.exec(row); // değer sütunu işaretli ($ + işaretli)
      if (!type) continue;
      const amount = val ? Number(val[2].replace(/,/g, "")) : 0;
      if (/p/i.test(type[1])) {
        buys++; buyValue += amount; netValue += amount;
        if (!lastBuy && tradeDate) lastBuy = tradeDate;
      } else {
        sells++; netValue -= amount;
      }
    }
    return { buys, sells, buyValue, netValue, lastBuy };
  } catch { return { buys: 0, sells: 0, buyValue: 0, netValue: 0, lastBuy: null, err: true }; }
}

// Tek hisse için 4 sinyali birleştirip 0-100 skor + kademe üret.
// ÖNEMLİ: eksik veri 0 sayılmaz — skor yalnızca verisi gelen bileşenler
// üzerinden normalize edilir. Böylece tek bir kaynak boş gelse bile skor çökmez.
function scoreRadar(d) {
  const sig = [];           // { key, label, tone, text, weight }
  let total = 0, maxTotal = 0;
  const add = (key, label, has, raw, max, tone, text) => {
    sig.push({ key, label, tone, text: text || "veri yok", weight: max });
    if (!has) return;
    const pts = Math.max(0, Math.min(max, raw));
    total += pts; maxTotal += max;
    // tonu puana göre netleştir (metin zaten verildi)
    sig[sig.length - 1].tone = pts >= max * 0.6 ? "good" : pts >= max * 0.3 ? "warn" : "bad";
  };

  // 1) Momentum (max 30) — çoklu pencere getiri + 52h zirveye yakınlık (+ varsa RSI/SMA)
  {
    let raw = 0; const r = [];
    let has = d.ret3M != null || d.ret6M != null || d.fromHighPct != null || d.rsi != null;
    if (d.ret3M != null) {
      if (d.ret3M >= 15) { raw += 10; r.push(`3a +%${d.ret3M.toFixed(0)}`); }
      else if (d.ret3M >= 3) { raw += 6; r.push(`3a +%${d.ret3M.toFixed(0)}`); }
      else if (d.ret3M < -5) { raw -= 4; r.push(`3a %${d.ret3M.toFixed(0)}`); }
    }
    if (d.ret6M != null) {
      if (d.ret6M >= 20) { raw += 8; r.push(`6a +%${d.ret6M.toFixed(0)}`); }
      else if (d.ret6M >= 5) { raw += 4; r.push(`6a +%${d.ret6M.toFixed(0)}`); }
      else if (d.ret6M < -8) { raw -= 3; r.push(`6a %${d.ret6M.toFixed(0)}`); }
    }
    if (d.fromHighPct != null) {
      if (d.fromHighPct >= -8) { raw += 8; r.push("52h zirveye yakın"); }
      else if (d.fromHighPct <= -30) { raw -= 4; r.push(`zirveden %${d.fromHighPct.toFixed(0)}`); }
    }
    if (d.rsi != null) {
      if (d.rsi >= 50 && d.rsi <= 68) { raw += 4; r.push(`RSI ${d.rsi.toFixed(0)} sağlıklı`); }
      else if (d.rsi > 78) { raw -= 4; r.push(`RSI ${d.rsi.toFixed(0)} aşırı ısınmış`); }
    }
    if (d.sma200 != null && d.price != null) {
      if (d.price > d.sma200) { raw += 4; r.push("200g üstü"); }
      else { raw -= 3; r.push("200g altı"); }
    }
    add("mom", "Momentum", has, raw, 30, "warn", r.join(" · "));
  }

  // 2) Analist (max 25) — konsensüs (+ varsa hedef yukarı potansiyeli)
  {
    let raw = 0; const r = [];
    const has = !!d.reco;
    const recoMap = { strong_buy: 20, buy: 14, hold: 6, underperform: 2, sell: 0 };
    if (d.reco) {
      raw += recoMap[d.reco] ?? 6;
      const lbl = { strong_buy: "güçlü al", buy: "al", hold: "tut", underperform: "zayıf", sell: "sat" }[d.reco] || d.reco;
      r.push(d.recoTotal ? `${lbl} (${d.recoTotal} analist)` : lbl);
    }
    if (d.upsidePct != null) {
      if (d.upsidePct >= 20) { raw += 5; r.push(`hedefe +%${d.upsidePct.toFixed(0)}`); }
      else if (d.upsidePct >= 8) { raw += 3; r.push(`hedefe +%${d.upsidePct.toFixed(0)}`); }
      else if (d.upsidePct < 0) { raw -= 3; r.push("hedefin üstünde"); }
    }
    add("ana", "Analist", has, raw, 25, "warn", r.join(" · "));
  }

  // 3) Bilanço / büyüme (max 30)
  {
    let raw = 0; const r = [];
    const has = d.revenueGrowth != null || d.earningsGrowth != null || d.profitMargin != null || d.pegYr != null;
    if (d.revenueGrowth != null) {
      if (d.revenueGrowth >= 25) { raw += 11; r.push(`gelir +%${d.revenueGrowth.toFixed(0)}`); }
      else if (d.revenueGrowth >= 10) { raw += 6; r.push(`gelir +%${d.revenueGrowth.toFixed(0)}`); }
      else if (d.revenueGrowth < 0) { raw -= 4; r.push(`gelir %${d.revenueGrowth.toFixed(0)}`); }
    }
    if (d.earningsGrowth != null) {
      if (d.earningsGrowth >= 25) { raw += 8; r.push(`kâr +%${d.earningsGrowth.toFixed(0)}`); }
      else if (d.earningsGrowth >= 8) { raw += 4; r.push(`kâr +%${d.earningsGrowth.toFixed(0)}`); }
      else if (d.earningsGrowth < 0) { raw -= 3; r.push(`kâr %${d.earningsGrowth.toFixed(0)}`); }
    }
    if (d.profitMargin != null && d.profitMargin >= 20) { raw += 5; r.push(`net marj %${d.profitMargin.toFixed(0)}`); }
    if (d.pegYr != null && d.pegYr > 0) {
      if (d.pegYr <= 1) { raw += 6; r.push(`PEG ${d.pegYr.toFixed(2)} ucuz`); }
      else if (d.pegYr <= 1.8) { raw += 3; r.push(`PEG ${d.pegYr.toFixed(2)}`); }
      else if (d.pegYr > 3) { raw -= 2; r.push(`PEG ${d.pegYr.toFixed(1)} pahalı`); }
    }
    add("fun", "Bilanço", has, raw, 30, "warn", r.join(" · "));
  }

  // 4) Insider (max 15) — yalnızca işlem varsa puanlanır (yoksa skora dahil değil)
  {
    const io = d.insider || {};
    const has = (io.buys || 0) > 0 || (io.sells || 0) > 0;
    let raw = 0; let text = "işlem yok";
    if (io.buys > 0) {
      if (io.buys >= 3 || io.buyValue >= 1_000_000) { raw += 15; text = `${io.buys} alım · $${(io.buyValue / 1e6).toFixed(1)}M`; }
      else { raw += 8; text = `${io.buys} alım · $${Math.round(io.buyValue / 1e3)}K`; }
      if (io.sells > io.buys * 2) { raw -= 4; text += " (satış ağırlıklı)"; }
    } else if (io.sells > 0) { raw = 0; text = `${io.sells} satış`; }
    add("ins", "Insider", has, raw, 15, io.sells > 0 && !io.buys ? "bad" : "warn", text);
  }

  const score = maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0;
  let tier;
  if (score >= 68) tier = { key: "strong", label: "GÜÇLÜ AL" };
  else if (score >= 50) tier = { key: "buy", label: "AL" };
  else if (score >= 34) tier = { key: "watch", label: "İZLE" };
  else tier = { key: "neutral", label: "NÖTR" };

  // Düz Türkçe özet: skorun nereden geldiği tek bakışta anlaşılsın.
  // Eksik bileşenler ayrıca yazılır — "0 puan aldı" sanılmasın (skora dahil değiller).
  const have = sig.filter((s) => s.text && s.text !== "veri yok" && s.text !== "işlem yok");
  const missing = sig.filter((s) => !have.includes(s)).map((s) => s.label);
  const summaryText =
    `Skor ${score}/100 → ${tier.label}. ` +
    (have.length ? have.map((s) => `${s.label}: ${s.text}`).join("; ") : "Henüz puanlanabilir veri yok") +
    (missing.length ? `. (${missing.join(", ")} verisi yok — skora dahil edilmedi, ${maxTotal}/100 ağırlık üzerinden normalize edildi)` : ".");

  return { score, tier, signals: sig, coverage: maxTotal, summaryText };
}

// Model 12-aylık hedef fiyat — analist hedefi ücretsiz API'de yok; bunun yerine
// ŞEFFAF bir tahmin üretiriz: temel büyüme + analist eğilimi + momentum + değerleme
// düzeltmeleri. "Analist konsensüsü" DEĞİL, açıkça "model tahmini" olarak gösterilir.
// Dönen upsidePct, beklenen 12 aylık yüzde getiridir (−25…+70 ile sınırlı).
function modelTarget(d) {
  const price = d.price;
  if (!price || !isFinite(price)) return { target: null, upsidePct: null, basis: [] };
  const basis = [];
  // 1) Temel büyüme beklentisi (kâr büyümesi > gelir büyümesi), makul sınırlarda
  let g = null;
  if (d.earningsGrowth != null) g = d.earningsGrowth;
  else if (d.revenueGrowth != null) g = d.revenueGrowth;
  let exp = 0;
  if (g != null) {
    const gAdj = Math.max(-15, Math.min(45, g)) / 100 * 0.55; // büyümenin ~yarısı fiyata yansır
    exp += gAdj;
    basis.push(`büyüme ~%${g.toFixed(0)}`);
  }
  // 2) Analist eğilimi
  const recoAdj = { strong_buy: 0.10, buy: 0.05, hold: 0, underperform: -0.05, sell: -0.10 };
  if (d.reco != null && recoAdj[d.reco] != null) {
    exp += recoAdj[d.reco];
    if (recoAdj[d.reco]) basis.push(`analist ${d.reco === "strong_buy" ? "güçlü al" : d.reco === "buy" ? "al" : d.reco}`);
  }
  // 3) Momentum / trend ayarı
  if (d.sma200 != null && price > d.sma200) { exp += 0.03; basis.push("yükseliş trendi"); }
  else if (d.sma200 != null && price < d.sma200) { exp -= 0.03; basis.push("trend zayıf"); }
  if (d.fromHighPct != null && d.fromHighPct >= -6) { exp += 0.02; basis.push("zirveye yakın"); }
  // 4) Değerleme ayarı (PEG)
  if (d.pegYr != null && d.pegYr > 0) {
    if (d.pegYr <= 1) { exp += 0.04; basis.push("PEG ucuz"); }
    else if (d.pegYr > 3) { exp -= 0.05; basis.push("PEG pahalı"); }
  }
  exp = Math.max(-0.25, Math.min(0.70, exp));
  return { target: price * (1 + exp), upsidePct: exp * 100, basis };
}

// Sıcak trend bayrağı — kısa+orta vade güçlü pozitif ve trend üstündeyse "TREND".
function trendFlag(d) {
  if (d.price == null) return null;
  const above = d.sma200 != null ? d.price > d.sma200 : (d.fromHighPct != null ? d.fromHighPct > -25 : null);
  const m1 = d.ret1M, m3 = d.ret3M;
  if (above && m1 != null && m3 != null && m1 >= 6 && m3 >= 12) return "hot";   // güçlü ralli
  if (above && m3 != null && m3 >= 6) return "up";                              // ılımlı yükseliş
  if (m1 != null && m3 != null && m1 <= -8 && m3 <= -12) return "down";         // düşüş
  return null;
}

async function refreshRadar(fast = false) {
  if (radarRefreshing) return;
  if (!FINNHUB_KEY) return; // anahtar yoksa cache'i bozma (Render'da env'den gelir)
  radarRefreshing = true;
  try {
    // Havuz: gate'ler kotayı sınırlar. Eski sıralı+sleep modeli yerine paralel.
    // fast=true (kullanıcı "↻ Tara" dediğinde) tam hızda; periyodik tarama arka planda.
    await pool(RADAR_SCAN_SYMBOLS, 6, async (sym) => {
      try {
        const cur = radarCache[sym] || {};
        const bg = fast ? {} : { bg: true };
        // Performans: temel veriler (bilanço/analist/insider/profil) gün içinde
        // neredeyse değişmez. Her döngüde 5 Finnhub çağrısı yerine yalnızca FİYAT
        // çekilir; temeller 22 saatte bir (veya kullanıcı "↻ Tara" deyince) tazelenir.
        // Böylece arka plan taraması kotanın ~%75'ini boşaltır → ön plan (portföy
        // fiyatları, grafik) beklemez, veriler hızlı gelir.
        const fundFresh = cur._fundT && Date.now() - cur._fundT < FUND_TTL;
        const refetchFund = fast || !fundFresh;
        const [q, metric, reco, insider, profile] = await Promise.all([
          fhQuote(sym, bg).catch(() => null),
          refetchFund ? fhMetric(sym, bg).catch(() => ({})) : Promise.resolve(null),
          refetchFund ? fhRecommendation(sym, bg).catch(() => ({})) : Promise.resolve(null),
          refetchFund ? fhInsider(sym, bg).catch(() => ({ buys: 0, sells: 0, buyValue: 0, netValue: 0 })) : Promise.resolve(null),
          (refetchFund && !cur.name) ? fhProfile(sym, bg).catch(() => ({})) : Promise.resolve({ name: cur.name, marketCap: cur.marketCap }),
        ]);
        const price = q?.price ?? cur.price ?? null;
        // Temel alanlar: yeni geldiyse onları, gelmediyse cache'tekini kullan.
        const metricF = metric ?? pickFund(cur, RADAR_METRIC_KEYS);
        const recoF = reco ?? pickFund(cur, RADAR_RECO_KEYS);
        const insiderF = insider ?? cur.insider ?? { buys: 0, sells: 0, buyValue: 0, netValue: 0 };
        const d = {
          symbol: sym, theme: RADAR_THEME[sym], cuma: CUMA_SET.has(sym), // ⭐ Cuma Hoca üyeliği (birleşik tabloda rozet+filtre)
          name: profile.name ?? cur.name ?? null,
          marketCap: profile.marketCap ?? cur.marketCap ?? null,
          price, dayChangePct: q?.dayChangePct ?? null,
          ...metricF, ...recoF, insider: insiderF,
        };
        // Mantıklılık koruması: yabancı ADR'lerde (ör. TSM, ARM) Finnhub'ın
        // 52h zirve/dip + piyasa değeri yerel listeleme para biriminde gelir,
        // USD quote fiyatıyla uyuşmaz. Fiyat 52h aralığına uymuyorsa bu fiyat-
        // türevli alanları düşür (getiri %'leri para-bağımsız olduğu için kalır).
        const haveW52 = d.w52High != null && d.w52Low != null && price != null;
        const w52ok = haveW52 && price >= d.w52Low * 0.5 && price <= d.w52High * 1.5;
        if (w52ok) {
          d.fromHighPct = ((price - d.w52High) / d.w52High) * 100;
        } else {
          d.fromHighPct = null;
          if (haveW52) { d.w52High = null; d.w52Low = null; d.marketCap = null; } // yabancı ölçek
        }
        const verdict = scoreRadar(d);
        const tgt = modelTarget(d);
        radarCache[sym] = {
          ...d, ...verdict, t: Date.now(),
          _fundT: refetchFund ? Date.now() : (cur._fundT || Date.now()),
          story: RADAR_STORY[sym] || null,
          target: tgt.target, upsidePct: tgt.upsidePct, targetBasis: tgt.basis,
          trend: trendFlag(d),
        };
      } catch { /* eski değeri koru */ }
    });
    radarUpdated = Date.now();
    try { await writeFile(RADAR_FILE, JSON.stringify({ updated: radarUpdated, items: radarCache }, null, 2)); } catch {}
    await kvSave("radar_cache", { updated: radarUpdated, items: radarCache }); // restart-dayanıklı kopya
  } finally {
    radarRefreshing = false;
  }
}

function maybeRefreshRadar() {
  const missing = RADAR_SCAN_SYMBOLS.some((s) => !radarCache[s]);
  if (!radarRefreshing && (missing || Date.now() - radarUpdated > RADAR_TTL)) refreshRadar();
}

app.get("/api/radar", (_req, res) => {
  maybeRefreshRadar();
  const items = RADAR_SCAN_SYMBOLS.map((s) => radarCache[s]).filter(Boolean)
    .sort((a, b) => (b.score || 0) - (a.score || 0));
  res.json({
    updated: radarUpdated,
    refreshing: radarRefreshing,
    groups: RADAR_GROUPS.map((g) => ({ key: g.key, title: g.title })),
    count: items.length,
    total: RADAR_SCAN_SYMBOLS.length,
    items,
  });
});

app.post("/api/radar/refresh", (_req, res) => {
  refreshRadar(true); // kullanıcı tetikledi → tam hız
  res.json({ ok: true, refreshing: true });
});

/* ====================================================================== *
 *  SWING TARAYICI — radar evreni + izleme listesi üzerinde teknik analiz
 *  Her hisse için kurulum (breakout/pullback/aşırı satım) + giriş/stop/hedef
 *  + R/R + not verir. Tıklayınca /api/chart mum verisini + seviyeleri döner;
 *  ön yüz TradingView Lightweight Charts ile çizip çizgileri otomatik koyar.
 * ====================================================================== */

// Günlük TD bütçesi (800/gün ücretsiz). Arka plan taraması TD_DAY_BG_CAP'te
// durur → tıkla-aç grafik (ön plan) için her gün headroom kalır. Böylece
// tarama kotayı bitirse bile grafik çekimi yapılabilir.
const TD_DAY_BG_CAP = 680;  // arka plana günlük tavan; ~120 ön plan grafik rezervi
let tdDay = { day: "", used: 0 };
function tdDayKey() { return new Date().toISOString().slice(0, 10); }
function tdBudgetOk(bg) {
  const d = tdDayKey();
  if (tdDay.day !== d) tdDay = { day: d, used: 0 };
  return !(bg && tdDay.used >= TD_DAY_BG_CAP);
}
function tdCount() {
  const d = tdDayKey();
  if (tdDay.day !== d) tdDay = { day: d, used: 0 };
  tdDay.used++;
}

// TwelveData: günlük tam OHLC + tarih (mum grafiği için). order=ASC → eskiden yeniye.
async function tdOHLC(sym, outputsize = 200, opts = {}) {
  if (!TD_KEY) return null;
  if (!tdBudgetOk(opts.bg)) return null; // arka plan günlük tavanı aştı → ön plana yer bırak
  await tdGate(opts.bg ? TD_BG_CAP : 7); // grafik (ön plan) tam hızda; tarama (arka plan) yumuşak tavandan
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=1day&outputsize=${outputsize}&order=ASC&apikey=${TD_KEY}`;
  try {
    tdCount();
    const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return null;
    const j = await r.json();
    if (j?.status === "error" || !Array.isArray(j?.values)) return null;
    const out = [];
    for (const v of j.values) {
      const o = +v.open, h = +v.high, l = +v.low, c = +v.close;
      const vol = Number(v.volume);
      if ([o, h, l, c].every(isFinite)) out.push({ time: String(v.datetime).slice(0, 10), open: o, high: h, low: l, close: c, volume: isFinite(vol) ? vol : null });
    }
    return out.length ? out : null;
  } catch { return null; }
}

// Yahoo v8 chart (anahtarsız, crumb gerektirmez) — TD kotası/meşgulken yedek.
// Cloud IP'lerinde her zaman çalışmaz ama ücretsiz bir ikinci şanstır.
async function yahooOHLC(sym, range = "2y") {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${range}`;
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return null;
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    const ts = res?.timestamp || [];
    const q = res?.indicators?.quote?.[0] || {};
    const out = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], v = q.volume?.[i];
      if ([o, h, l, c].every((x) => x != null && isFinite(x))) {
        out.push({ time: new Date(ts[i] * 1000).toISOString().slice(0, 10), open: o, high: h, low: l, close: c, volume: v ?? null });
      }
    }
    return out.length >= 30 ? out : null;
  } catch { return null; }
}

/* ---- Birleşik mum önbelleği ---------------------------------------------
 * Arka plan swing taraması her sembol için tam OHLC mumlarını buraya yazar;
 * grafik modalı (/api/chart) önce buradan okur → TwelveData'ya gitmeden anında
 * açılır. Diske de yazılır (CANDLE_FILE), böylece restart sonrası da hızlı gelir.
 * Bu, "tıkla → 2-3 dk bekle / yeterli mum yok" sorununun asıl çözümüdür:
 * tarama ve grafik aynı TD çağrısını paylaşır, kota iki kat yanmaz. */
const CANDLE_FILE = join(__dirname, "candle_cache.json");
const candleCache = {};             // sym -> { candles:[...], t }
const CANDLE_TTL = 18 * 3600_000;   // günlük mum; tarama periyoduyla uyumlu
let candleDirty = false;

async function loadCandleCache() {
  try { Object.assign(candleCache, JSON.parse(await readFile(CANDLE_FILE, "utf8"))); } catch {}
  // Postgres kopyası: dosya (Render'da geçici) kaybolmuşsa ya da sembol başına
  // daha taze veri varsa DB kazanır → restart sonrası grafik/radar soğuk başlamaz
  try {
    const db = await kvLoad("candle_cache");
    if (db) for (const [sym, v] of Object.entries(db)) {
      if (!candleCache[sym] || (v?.t || 0) > (candleCache[sym].t || 0)) candleCache[sym] = v;
    }
  } catch {}
}
async function persistCandleCache() {
  if (!candleDirty) return;
  candleDirty = false;
  try { await writeFile(CANDLE_FILE, JSON.stringify(candleCache), "utf8"); } catch {}
  await kvSave("candle_cache", candleCache);
}

// Tam OHLC mumları — taze önbellek varsa TD çağrısı yapmaz.
async function getCandles(sym, opts = {}) {
  sym = sym.toUpperCase();
  const hit = candleCache[sym];
  if (!opts.force && hit && Date.now() - hit.t < CANDLE_TTL && (hit.candles?.length || 0) >= 30) {
    return hit.candles;
  }
  let candles = await tdOHLC(sym, 360, opts);
  if (!candles || candles.length < 30) candles = await yahooOHLC(sym); // TD kotası/meşgulken ücretsiz yedek
  if (candles && candles.length >= 30) {
    candleCache[sym] = { candles, t: Date.now() };
    candleDirty = true;
    if (!opts.bg) persistCandleCache(); // ön plan tek çekim → hemen kalıcı yap
    return candles;
  }
  return hit?.candles || null; // çekemezsek (kota/meşgul) bayat veriyi yine de göster
}

/* ---- Şirket haberleri (Haftalık Fırsatlar nöbeti) — Finnhub company-news,
 *      18 saat TTL önbellek (candle cache deseninin aynısı). Anahtar yoksa
 *      sessizce boş döner; Top-10 dışına çağrı yapılmaz (hafif). ------------ */
const NEWS_FILE = join(__dirname, "news_cache.json");
const newsCache = {};               // sym -> { items:[{headline,url,dt,source}], t }
const NEWS_TTL = 18 * 3600_000;
let newsDirty = false;
async function loadNewsCache() {
  try { Object.assign(newsCache, JSON.parse(await readFile(NEWS_FILE, "utf8"))); } catch {}
}
async function persistNewsCache() {
  if (!newsDirty) return;
  newsDirty = false;
  try { await writeFile(NEWS_FILE, JSON.stringify(newsCache), "utf8"); } catch {}
}
async function recentNews(sym, opts = {}) {
  sym = String(sym).toUpperCase();
  const hit = newsCache[sym];
  const ttl = opts.ttl || NEWS_TTL;
  if (!opts.force && hit && Date.now() - hit.t < ttl) return hit.items;
  if (!FINNHUB_KEY) return hit?.items || [];
  const from = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  try {
    const j = await finnhub("/company-news", { symbol: sym, from, to });
    if (Array.isArray(j)) {
      const items = j
        .filter((n) => n && n.headline)
        .sort((a, b) => (b.datetime || 0) - (a.datetime || 0))
        .slice(0, 3)
        .map((n) => ({ headline: String(n.headline).slice(0, 140), url: n.url || "", dt: n.datetime || 0, source: n.source || "" }));
      newsCache[sym] = { items, t: Date.now() };
      newsDirty = true;
      return items;
    }
  } catch {}
  return hit?.items || [];
}

function buildNewsSummary(news) {
  if (!news.length) return null;
  const heads = news.map((n) => n.headline.replace(/\s+/g, " ").trim().replace(/\.+$/, ""));
  if (heads.length === 1) return heads[0] + ".";
  if (heads.length === 2) return `${heads[0]}. Öte yandan ${heads[1].charAt(0).toLowerCase() + heads[1].slice(1)}.`;
  return `${heads[0]}. ${heads[1].charAt(0).toUpperCase() + heads[1].slice(1)}. Ayrıca gündemde: ${heads[2].charAt(0).toLowerCase() + heads[2].slice(1)}.`;
}

/* ---- Ek teknik göstergeler (swing analizi için en işe yarayanlar) ---- */
function emaArr(arr, n) {
  if (!arr.length) return [];
  const k = 2 / (n + 1);
  let e = arr[0]; const out = [e];
  for (let i = 1; i < arr.length; i++) { e = arr[i] * k + e * (1 - k); out.push(e); }
  return out;
}
// MACD (12,26,9) — trend/momentum kesişimi
function macdCalc(closes) {
  if (closes.length < 35) return null;
  const e12 = emaArr(closes, 12), e26 = emaArr(closes, 26);
  const line = closes.map((_, i) => e12[i] - e26[i]);
  const signal = emaArr(line.slice(26), 9);
  const m = line[line.length - 1], s = signal[signal.length - 1];
  return { macd: m, signal: s, hist: m - s };
}
// ADX (14) — trend GÜCÜ (yön değil). >25 güçlü trend, <20 yatay/zayıf.
function adxCalc(highs, lows, closes, n = 14) {
  const len = closes.length;
  if (len < 2 * n + 1) return null;
  const tr = [], pDM = [], mDM = [];
  for (let i = 1; i < len; i++) {
    const up = highs[i] - highs[i - 1], dn = lows[i - 1] - lows[i];
    pDM.push(up > dn && up > 0 ? up : 0);
    mDM.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const smooth = (arr) => {
    let s = arr.slice(0, n).reduce((a, b) => a + b, 0);
    const out = [s];
    for (let i = n; i < arr.length; i++) { s = s - s / n + arr[i]; out.push(s); }
    return out;
  };
  const trS = smooth(tr), pS = smooth(pDM), mS = smooth(mDM);
  const dx = [];
  for (let i = 0; i < trS.length; i++) {
    const pdi = 100 * pS[i] / (trS[i] || 1), mdi = 100 * mS[i] / (trS[i] || 1);
    dx.push({ dxi: 100 * Math.abs(pdi - mdi) / ((pdi + mdi) || 1), pdi, mdi });
  }
  if (dx.length < n) return null;
  let adx = dx.slice(0, n).reduce((a, b) => a + b.dxi, 0) / n;
  for (let i = n; i < dx.length; i++) adx = (adx * (n - 1) + dx[i].dxi) / n;
  const last = dx[dx.length - 1];
  return { adx, plusDI: last.pdi, minusDI: last.mdi };
}
// Bollinger (20,2) — oynaklık + bant içi konum (%B)
function bollinger(closes, n = 20, k = 2) {
  if (closes.length < n) return null;
  const slice = closes.slice(-n);
  const mid = slice.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(slice.reduce((a, b) => a + (b - mid) ** 2, 0) / n);
  const upper = mid + k * sd, lower = mid - k * sd, price = closes[closes.length - 1];
  return { mid, upper, lower, pctB: (price - lower) / ((upper - lower) || 1), bandwidth: (upper - lower) / mid };
}

// Rolling SMA serisi (grafik overlay'i için) — [{time, value}], ilk n-1 boş atlanır.
function smaSeries(candles, n) {
  if (candles.length < n) return [];
  const out = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= n) sum -= candles[i - n].close;
    if (i >= n - 1) out.push({ time: candles[i].time, value: sum / n });
  }
  return out;
}
// Üssel hareketli ortalama serisi (EMA) — ilk n bar SMA ile tohumlanır.
// EMA Cloud için (Ripster 8/21): 8 EMA momentum, 21 EMA trend; 8>21 boğa eğilimi.
function emaSeries(candles, n) {
  if (!candles || candles.length < n) return [];
  const k = 2 / (n + 1);
  const out = [];
  let ema = null, sum = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i].close;
    if (i < n) { sum += c; if (i === n - 1) { ema = sum / n; out.push({ time: candles[i].time, value: +ema.toFixed(4) }); } }
    else { ema = c * k + ema * (1 - k); out.push({ time: candles[i].time, value: +ema.toFixed(4) }); }
  }
  return out;
}

// Pivot (yerel zirve/dip) tabanlı destek/direnç seviyeleri. Yakın seviyeler
// (~%1.5) tek seviyede kümelenir; fiyata göre en yakın 3'er tane döner.
function pivotLevels(highs, lows, price, w = 4) {
  const res = [], sup = [];
  for (let i = w; i < highs.length - w; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - w; j <= i + w; j++) {
      if (highs[j] > highs[i]) isHigh = false;
      if (lows[j] < lows[i]) isLow = false;
    }
    if (isHigh) res.push(highs[i]);
    if (isLow) sup.push(lows[i]);
  }
  const cluster = (arr) => {
    arr.sort((a, b) => a - b);
    const out = [];
    for (const v of arr) {
      if (!out.length || Math.abs(v - out[out.length - 1]) / v > 0.015) out.push(v);
      else out[out.length - 1] = (out[out.length - 1] + v) / 2;
    }
    return out;
  };
  const resistance = cluster(res).filter((v) => v > price * 1.002).sort((a, b) => a - b).slice(0, 3);
  const support = cluster(sup).filter((v) => v < price * 0.998).sort((a, b) => b - a).slice(0, 3);
  return { support, resistance };
}

// Bağlam → işlem planı. p: {price, atr, rsi, sma20/50/200, high20, low20,
// support (en yakın alt), resistance (en yakın üst), resistance2}
/* UZUN VADE — kademeli biriktirme (accumulation) bölgeleri. Swing'den (Qullamaggie)
 * AYRI bir bakış: amaç ucuzdan/yükselen ortalamalardan KADEMELİ biriktirip uzun tutmak.
 * Felsefe: 200g üstü = yapısal yukarı trend → geri çekilmelerde topla; pahalıyken
 * (ortalamalardan uzak/aşırı alım) zorlama; 200g altı → biriktirme aceleye gelmez. */
function buildAccumulation(p) {
  const { price, sma20, sma50, sma200, above200, overbought } = p;
  if (!price || !isFinite(price)) return null;
  const pctTo = (lvl) => (lvl != null && isFinite(lvl)) ? +(((price - lvl) / lvl) * 100).toFixed(1) : null;
  const valuation = { to20: pctTo(sma20), to50: pctTo(sma50), to200: pctTo(sma200) };

  if (above200 == null) {
    return { verdict: { key: "watch", label: "Trend belirsiz", tone: "warn" }, valuation, zones: [], reclaim: null,
      note: "200 günlük ortalama henüz oluşmadı (geçmiş veri kısa) — uzun vade trendi netleşince biriktirme bölgeleri çıkar." };
  }
  if (above200 === false) {
    return { verdict: { key: "wait", label: "Trend zayıf · 200g altı", tone: "bad" }, valuation, zones: [], reclaim: sma200 ?? null,
      note: sma200 != null
        ? `Uzun vade için acele yok. Fiyat 200 günlük ortalamanın (${fmtP(sma200)}) ALTINDA — yapısal trend zayıf. 200g üstüne kalıcı dönüşte kademeli biriktirmeye başla.`
        : "Uzun vade trendi zayıf — 200g üstüne dönüş bekle." };
  }

  // Yukarı trend: fiyatın ALTINDA kalan yükselen ortalamalar = geri çekilince biriktirme bölgeleri
  const cands = [
    { lvl: sma20, label: "20g ortalama" },
    { lvl: sma50, label: "50g ortalama" },
    { lvl: sma200, label: "200g ortalama" },
  ].filter((z) => z.lvl != null && isFinite(z.lvl) && z.lvl < price)
   .sort((a, b) => b.lvl - a.lvl); // fiyata en yakın (en sığ geri çekilme) önce

  const nearMA = (sma20 != null && price <= sma20 * 1.03) || (sma50 != null && price <= sma50 * 1.03);
  const stretched = sma20 != null && price > sma20 * 1.10; // 20g'den >%10 uzak = ısınmış/pahalı

  let verdict, buyNow = false;
  if (overbought || stretched) verdict = { key: "wait", label: "Pahalı · geri çekilmede biriktir", tone: "warn" };
  else if (nearMA) { verdict = { key: "buy", label: "Uygun biriktirme bölgesi", tone: "good" }; buyNow = true; }
  else verdict = { key: "watch", label: "Trend sağlam · geri çekilme bekle", tone: "warn" };

  const zones = [];
  if (buyNow) zones.push({ label: "Şimdi · ortalama yakını", price: +price.toFixed(2), isNow: true });
  cands.slice(0, 3 - zones.length).forEach((z) => zones.push({ label: z.label, price: +z.lvl.toFixed(2), isNow: false }));
  // Dilim %'leri: en sığ bölgeye en çok ağırlık (önce dolma olasılığı yüksek)
  const weights = [45, 35, 20];
  const wsum = weights.slice(0, zones.length).reduce((a, b) => a + b, 0) || 1;
  zones.forEach((z, i) => { z.pct = Math.round((weights[i] / wsum) * 100); });

  const note = verdict.key === "buy"
    ? "Fiyat yükselen ortalama yakınında — kademeli biriktirmeye uygun. Bölgelere bölerek al; tek seferde tüm nakdi kullanma."
    : verdict.key === "wait"
      ? "Fiyat ortalamalardan uzak/ısınmış — uzun vade alımı için geri çekilmeyi bekle (FOMO ile tepeden ekleme)."
      : "Trend sağlam ama fiyat ortalamadan biraz uzak — aşağıdaki bölgelere geri çekilmede biriktir.";

  return { verdict, valuation, zones, reclaim: null, note };
}

// Dönen: trend, setup, entry/stop/target/target2, R/R, risk%, ödül%, grade, longterm, not.
function buildPlan(p) {
  const { price, atr } = p;
  if (!price || !atr || !isFinite(price) || !isFinite(atr)) return null;
  const above200 = p.sma200 != null ? price > p.sma200 : null;
  const above50 = p.sma50 != null ? price > p.sma50 : null;
  const rsi = p.rsi;

  let trend = "yatay";
  if (above200 && above50) trend = "güçlü yükseliş";
  else if (above200) trend = "yükseliş";
  else if (above200 === false && above50 === false) trend = "düşüş";
  else if (above50) trend = "toparlanma";

  // ---- Kurulum tespiti (yalnızca 200g üstü = yükseliş trendi) ----
  let setup = null;
  if (above200) {
    if (p.high20 != null && price >= p.high20 * 0.985) setup = { type: "breakout", label: "Breakout · 20g zirve" };
    else if (p.sma50 != null && price <= p.sma50 * 1.03 && price >= p.sma50 * 0.95 && rsi != null && rsi >= 40 && rsi <= 58)
      setup = { type: "pullback", label: "Pullback · 50g destek" };
    else if (rsi != null && rsi < RSI_OVERSOLD) setup = { type: "oversold", label: "Aşırı satım sıçraması" };
  }
  const overbought = rsi != null && rsi >= RSI_OVERBOUGHT;

  // ---- GİRİŞ seviyesi: şu anki fiyat DEĞİL, kuruluma göre anlamlı seviye ----
  // entryType: now=şimdi al · breakout=kırılımda al · pullback=geri çekilmede al · wait=bekle
  let entry = null, entryType = "wait", entryNote = "";
  if (setup?.type === "breakout") {
    const trig = p.high20 != null ? p.high20 : price;
    if (price >= trig) { entry = trig; entryType = "breakout"; entryNote = `Kırılım gerçekleşti — ${fmtP(trig)} (20g zirve) retestinde al, teyit: kapanış üstte kalsın.`; }
    else { entry = trig; entryType = "breakout"; entryNote = `${fmtP(trig)} (20g zirve) GÜNLÜK kapanışla kırılırsa al.`; }
  } else if (setup?.type === "pullback") {
    const zone = p.sma50 != null ? p.sma50 : (p.support ?? price);
    entry = Math.min(price, zone * 1.01); entryType = "pullback";
    entryNote = `50g ortalama (${fmtP(zone)}) destek bölgesinde al; dönüş mumu (çekiç/yutan) teyit.`;
  } else if (setup?.type === "oversold") {
    entry = price; entryType = "now";
    entryNote = `Aşırı satım (RSI ${rsi?.toFixed(0)}). Yeşil dönüş mumuyla teyitli al — düşen bıçağı tutma.`;
  } else if (above200) {
    // Kurulum yok ama trend yukarı → geri çekilmede al; tetik seviyeyi öner
    const zone = (p.sma20 != null && p.sma20 < price) ? p.sma20 : (p.sma50 ?? p.support ?? null);
    if (zone != null) { entry = zone; entryType = "pullback"; entryNote = `Kurulum yok. ${fmtP(zone)} (geri çekilme bölgesi) civarına sarkmasını bekle; orada al.`; }
    else { entry = price; entryType = "now"; entryNote = "Trend yukarı ama net kurulum yok."; }
  } else {
    entry = null; entryType = "wait";
    entryNote = `Trend zayıf (200g altı). Yeni alım için 200g (${fmtP(p.sma200)}) üstüne dönüş bekle.`;
  }

  // ---- Stop / Hedef: GİRİŞ seviyesine göre (giriş yoksa fiyatı baz al) ----
  const base = entry ?? price;
  let stop = base - 1.5 * atr;
  if (p.support != null && p.support < base) stop = Math.min(stop, p.support * 0.99);
  if (setup?.type === "pullback" && p.sma50) stop = Math.min(stop, p.sma50 * 0.97);
  if (stop >= base) stop = base - 1.5 * atr;
  const risk = base - stop;

  let target, targetBy;
  if (p.resistance != null && p.resistance > base && (p.resistance - base) / risk >= 1.3) { target = p.resistance; targetBy = "direnç"; }
  else { target = base + 2 * risk; targetBy = "2R"; }
  const target2 = Math.max(base + 3 * risk, (p.resistance2 != null && p.resistance2 > target) ? p.resistance2 : 0) || base + 3 * risk;
  const rr = risk > 0 ? (target - base) / risk : null;
  const rp = (risk / base) * 100, wp = ((target - base) / base) * 100;

  // ---- Kalite notu (A–D) ----
  let g = 0;
  if (above200) g += 1;
  if (above50) g += 1;
  if (setup) g += 1;
  if (rr != null && rr >= 2) g += 1; else if (rr != null && rr >= 1.5) g += 0.5;
  if (rsi != null && rsi >= 40 && rsi <= 65) g += 1;
  if (overbought) g -= 1;
  const grade = g >= 4 ? "A" : g >= 3 ? "B" : g >= 2 ? "C" : "D";

  // ---- ÖNERİ (verdict): net karar ----
  let verdict;
  if (overbought) verdict = { key: "wait", label: "BEKLE · aşırı alım", tone: "warn" };
  else if (setup && above200) verdict = { key: "buy", label: "AL · kurulum var", tone: "good" };
  else if (above200) verdict = { key: "watch", label: "İZLE · kuruluma yakın", tone: "warn" };
  else if (trend === "düşüş") verdict = { key: "avoid", label: "KAÇIN · trend zayıf", tone: "bad" };
  else verdict = { key: "watch", label: "İZLE · nötr", tone: "warn" };

  // ---- Özet not ----
  const entryTxt = entry != null ? `${fmtP(entry)} (${{ now: "şimdi", breakout: "kırılımda", pullback: "geri çekilmede", wait: "bekle" }[entryType]})` : "—";
  let note;
  if (verdict.key === "buy") note = `${setup.label}. Giriş ${entryTxt}; stop ${fmtP(stop)} (−%${rp.toFixed(1)}), hedef ${fmtP(target)} (+%${wp.toFixed(1)}, ${rr.toFixed(1)}R). ${entryNote}`;
  else if (verdict.key === "avoid") note = entryNote;
  else note = `${entryNote} Plan kurulduğunda: stop ${fmtP(stop)} (−%${rp.toFixed(1)}), hedef ${fmtP(target)} (+%${wp.toFixed(1)}, ${rr != null ? rr.toFixed(1) + "R" : "—"}).`;

  // ---- UZUN VADE: kademeli biriktirme bölgeleri (swing'den ayrı bakış) ----
  const longterm = buildAccumulation({
    price, sma20: p.sma20, sma50: p.sma50, sma200: p.sma200, above200, overbought,
  });

  return {
    trend, setup, verdict, overbought,
    entry, entryType, entryNote, currentPrice: price,
    stop, target, target2, targetBy,
    rr, riskPct: rp, rewardPct: wp, grade, note, longterm,
  };
}
function fmtP(v) { return v == null ? "—" : "$" + Number(v).toFixed(2); }

// signalCache (TwelveData teknikleri) → buildPlan bağlamı (liste için, TD çağrısı yok)
function planCtxFromCache(t, price) {
  const supCand = [t.low20, t.sma50, t.sma200].filter((v) => v != null && v < price);
  const resCand = [t.high20, t.w52High].filter((v) => v != null && v > price);
  return {
    price, atr: t.atr, rsi: t.rsi, sma20: t.sma20, sma50: t.sma50, sma200: t.sma200,
    high20: t.high20, low20: t.low20,
    support: supCand.length ? Math.max(...supCand) : null,
    resistance: resCand.length ? Math.min(...resCand) : null,
    resistance2: t.w52High,
  };
}

/* ====================================================================== *
 *  SİNYAL KARNESİ — swing planları kaydedilir, sonucu mumlarla ölçülür
 *  Her tarama sonrası üretilen kurulum (giriş/stop/hedef) signal_ledger.json'a
 *  yazılır; sonraki günlük mumlar (candleCache, ek API maliyeti yok) stop mu
 *  hedef mi önce vurdu diye değerlendirir. Çıktı: kurulum tipi başına isabet
 *  oranı + ortalama R → hangi sinyale güvenileceği veriyle görülür.
 * ====================================================================== */
const LEDGER_FILE = join(__dirname, "signal_ledger.json");
const LEDGER_WAIT_BARS = 10; // giriş bu kadar barda tetiklenmezse kurulum bayatlar
const LEDGER_MAX_BARS = 40;  // açık işlem en çok 40 bar izlenir (~2 ay), sonra son kapanıştan kapatılır
let ledger = [];
let ledgerDirty = false;

async function loadLedger() {
  try {
    const j = JSON.parse(await readFile(LEDGER_FILE, "utf8"));
    if (Array.isArray(j)) ledger = j;
  } catch {}
}
async function persistLedger() {
  if (!ledgerDirty) return;
  ledgerDirty = false;
  try { await writeFile(LEDGER_FILE, JSON.stringify(ledger, null, 1), "utf8"); } catch {}
}

// Tarama sonrası: kurulumlu planları karneye yaz (sembol+tip başına tek aktif kayıt)
function recordSignals(symbols) {
  for (const symRaw of symbols) {
    const sym = symRaw.toUpperCase();
    const t = signalCache[sym];
    const candles = candleCache[sym]?.candles;
    if (!t || !t.lastClose || !candles?.length) continue;
    const plan = buildPlan(planCtxFromCache(t, t.lastClose));
    if (!plan?.setup || plan.entry == null || plan.stop == null || !(plan.entry > plan.stop)) continue;
    const type = plan.setup.type;
    const signalDate = candles[candles.length - 1].time; // sinyalin doğduğu mum
    const dup = ledger.some((r) => r.symbol === sym && r.type === type &&
      (r.status === "waiting" || r.status === "open" ||
        // yeni çözülmüş aynı kurulumu hemen yeniden saymayalım (5 gün soğuma)
        (r.signalDate && (new Date(signalDate) - new Date(r.signalDate)) < 5 * 86400_000)));
    if (dup) continue;
    ledger.push({
      id: "s-" + Date.now().toString(36) + "-" + sym.toLowerCase(),
      symbol: sym, type, label: plan.setup.label, grade: plan.grade,
      entryType: plan.entryType, signalDate,
      entry: plan.entry, stop: plan.stop, target: plan.target,
      rr: plan.rr ?? null,
      // "şimdi al" tipi sinyal mum kapanışında dolmuş sayılır; diğerleri tetik bekler
      status: plan.entryType === "now" ? "open" : "waiting",
      entryDate: plan.entryType === "now" ? signalDate : null,
    });
    ledgerDirty = true;
  }
}

// Açık/bekleyen kayıtları sonraki mumlarla değerlendir (tamamen önbellekten)
function evaluateLedger() {
  for (const rec of ledger) {
    if (rec.status !== "waiting" && rec.status !== "open") continue;
    const candles = candleCache[rec.symbol]?.candles;
    if (!candles?.length) continue;
    const risk = rec.entry - rec.stop;
    if (!(risk > 0)) { rec.status = "invalid"; ledgerDirty = true; continue; }
    const startDate = rec.status === "open" && rec.entryDate ? rec.entryDate : rec.signalDate;
    let i = candles.findIndex((c) => c.time > startDate);
    if (i < 0) continue; // sinyalden sonra yeni mum yok
    // Sayaçlar her geçişte sıfırdan: iterasyon zaten giriş/sinyal mumundan başlıyor
    let waitBars = 0;
    let openBars = 0;
    for (; i < candles.length; i++) {
      const c = candles[i];
      if (rec.status === "waiting") {
        waitBars++;
        const filled = rec.type === "breakout" ? c.high >= rec.entry : c.low <= rec.entry;
        if (!filled) {
          if (waitBars >= LEDGER_WAIT_BARS) { rec.status = "expired"; rec.resolvedDate = c.time; ledgerDirty = true; break; }
          continue;
        }
        rec.status = "open"; rec.entryDate = c.time; ledgerDirty = true;
        // dolduğu mumda stop/hedef de görülmüş olabilir → aşağıda aynı mumla kontrol
      }
      openBars++;
      // Aynı mumda ikisi de varsa bilinemez → muhafazakâr: stop sayılır
      if (c.low <= rec.stop) {
        rec.status = "stop"; rec.exit = rec.stop; rec.resolvedDate = c.time;
        rec.r = (rec.stop - rec.entry) / risk; ledgerDirty = true; break;
      }
      if (c.high >= rec.target) {
        rec.status = "target"; rec.exit = rec.target; rec.resolvedDate = c.time;
        rec.r = (rec.target - rec.entry) / risk; ledgerDirty = true; break;
      }
      if (openBars >= LEDGER_MAX_BARS) {
        rec.status = "timeout"; rec.exit = c.close; rec.resolvedDate = c.time;
        rec.r = (c.close - rec.entry) / risk; ledgerDirty = true; break;
      }
    }
  }
}

// İndikatör → düz Türkçe yorum listesi (grafik modalı paneli için)
function chartSignals(ind, price) {
  const out = [];
  const add = (name, value, tone, text) => out.push({ name, value, tone, text });
  if (ind.rsi != null) {
    const r = ind.rsi; let tone, text;
    if (r >= RSI_OVERBOUGHT) { tone = "bad"; text = "Aşırı alım — geri çekilme riski"; }
    else if (r >= 60) { tone = "good"; text = "Güçlü momentum"; }
    else if (r >= 45) { tone = "good"; text = "Sağlıklı / nötr bölge"; }
    else if (r >= RSI_OVERSOLD) { tone = "warn"; text = "Zayıf momentum"; }
    else { tone = "warn"; text = "Aşırı satım — sıçrama olabilir"; }
    add("RSI (14)", r.toFixed(0), tone, text);
  }
  if (ind.macd) {
    const { macd, hist } = ind.macd; let tone, text;
    if (hist > 0 && macd > 0) { tone = "good"; text = "Yükseliş momentumu (sinyal üstü)"; }
    else if (hist > 0) { tone = "warn"; text = "Toparlanma — sıfır altı kesişim"; }
    else if (hist < 0 && macd < 0) { tone = "bad"; text = "Düşüş momentumu"; }
    else { tone = "warn"; text = "Momentum zayıflıyor"; }
    add("MACD (12·26·9)", (hist >= 0 ? "+" : "") + hist.toFixed(2), tone, text);
  }
  if (ind.adx) {
    const { adx, plusDI, minusDI } = ind.adx; const dir = plusDI >= minusDI ? "yukarı" : "aşağı"; let tone, text;
    if (adx >= 25) { tone = plusDI >= minusDI ? "good" : "bad"; text = `Güçlü ${dir} yönlü trend`; }
    else if (adx >= 20) { tone = "warn"; text = `Trend gelişiyor (${dir})`; }
    else { tone = "warn"; text = "Trendsiz / yatay (ADX<20)"; }
    add("ADX (14)", adx.toFixed(0), tone, text);
  }
  if (ind.bb) {
    const { pctB, bandwidth } = ind.bb; let tone, text;
    if (pctB > 1) { tone = "warn"; text = "Üst bant dışı — güçlü ama aşırı"; }
    else if (pctB < 0) { tone = "warn"; text = "Alt bant dışı — aşırı satım"; }
    else if (pctB > 0.8) { tone = "good"; text = "Üst banda yakın — güç"; }
    else if (pctB < 0.2) { tone = "warn"; text = "Alt banda yakın — zayıf/dip"; }
    else { tone = "good"; text = "Bant ortası — dengeli"; }
    const sq = bandwidth != null && bandwidth < 0.08 ? " · sıkışma (kırılım yakın)" : "";
    add("Bollinger %B", (pctB * 100).toFixed(0) + "%", tone, text + sq);
  }
  if (ind.avgVol && ind.lastVol) {
    const ratio = ind.lastVol / ind.avgVol; let tone, text;
    if (ratio >= 1.5) { tone = "good"; text = "Yüksek hacim — hareket teyitli"; }
    else if (ratio >= 0.8) { tone = "warn"; text = "Normal hacim"; }
    else { tone = "warn"; text = "Düşük hacim — teyit zayıf"; }
    add("Hacim / 20g ort.", ratio.toFixed(2) + "×", tone, text);
  }
  return out;
}

/* ====================================================================== *
 *  OTOMATİK ÇİZİM MOTORU — trend çizgileri + formasyon tespiti
 *  Bir teknik analizcinin elle çizdiği şeyleri otomatik üretir:
 *   • pivot zirve/diplerinden geçen EĞİMLİ trend çizgileri (destek/direnç)
 *   • formasyon: boğa bayrağı, yükselen/alçalan/simetrik üçgen, kanal,
 *     çift dip/çift tepe — her biri kırılım seviyesi + ölçülü hedef + düz
 *     Türkçe açıklama ile.
 *  TEMEL KURAL: kriter net karşılanmazsa formasyon = null. "Belki bayraktır"
 *  demez; uydurmaz. Böylece çizilen her çizgi gerçekten oradadır.
 * ====================================================================== */

// Yerel zirve/dip (pivot) noktaları — i. bar, çevresindeki w bara göre en
// yüksek/alçaksa pivottur. Trend çizgileri bu noktalardan geçer.
function findPivots(candles, w = 3) {
  const ph = [], pl = [];
  for (let i = w; i < candles.length - w; i++) {
    let isH = true, isL = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isH = false;
      if (candles[j].low <= candles[i].low) isL = false;
    }
    if (isH) ph.push({ i, time: candles[i].time, price: candles[i].high });
    if (isL) pl.push({ i, time: candles[i].time, price: candles[i].low });
  }
  return { ph, pl };
}

// İki pivot'tan geçen doğruyu son bara kadar uzat. Çıktı grafikte iki uçlu
// eğimli çizgi olarak çizilir. slopePct = bar başına yüzde eğim.
function trendLine(p1, p2, candles, role) {
  const span = p2.i - p1.i || 1;
  const slope = (p2.price - p1.price) / span;
  const endI = candles.length - 1;
  return {
    role, // "resistance" | "support"
    slope, slopePct: (slope / (p1.price || 1)) * 100,
    p1: { time: p1.time, value: +p1.price.toFixed(2) },
    p2: { time: candles[endI].time, value: +(p1.price + slope * (endI - p1.i)).toFixed(2) },
    touches: 2,
  };
}

// Bir trend çizgisine kaç pivotun "değdiği" (~%1.2 tolerans) — çok değme =
// daha güçlü/güvenilir çizgi.
function countTouches(line, pivots, candles) {
  const i1 = candles.findIndex((c) => c.time === line.p1.time);
  let touches = 0;
  for (const p of pivots) {
    const expected = line.p1.value + line.slope * (p.i - i1);
    if (Math.abs(p.price - expected) / (expected || 1) < 0.012) touches++;
  }
  return Math.max(touches, 2);
}

// Ana tespit: {trendlines:[...], pattern:{...}|null}
function detectPatterns(candles) {
  if (!candles || candles.length < 40) return { trendlines: [], pattern: null };
  const n = candles.length;
  const price = candles[n - 1].close;
  const highs = candles.map((c) => c.high), lows = candles.map((c) => c.low), closes = candles.map((c) => c.close);
  const atr = atr14(highs, lows, closes, 14) || price * 0.02;
  const sma50v = sma(closes, 50), sma200v = sma(closes, 200);
  const above50 = sma50v != null ? price > sma50v : null;
  const above200 = sma200v != null ? price > sma200v : null;
  const { ph, pl } = findPivots(candles, 3);

  // ---- Eğimli trend çizgileri (son 3 pivot zirve / dip) ----
  const trendlines = [];
  let resLine = null, supLine = null;
  const recentPH = ph.slice(-3), recentPL = pl.slice(-3);
  if (recentPH.length >= 2) {
    resLine = trendLine(recentPH[0], recentPH[recentPH.length - 1], candles, "resistance");
    resLine.touches = countTouches(resLine, ph, candles);
    trendlines.push(resLine);
  }
  if (recentPL.length >= 2) {
    supLine = trendLine(recentPL[0], recentPL[recentPL.length - 1], candles, "support");
    supLine.touches = countTouches(supLine, pl, candles);
    trendlines.push(supLine);
  }

  const fmt2 = (v) => +Number(v).toFixed(2);
  let pattern = null;

  // ---- 1) BOĞA BAYRAĞI (en güvenilir devam formasyonu) ----
  // Direk: son ~35 barda en sert yükseliş segmenti. Bayrak: direkten sonra
  // sığ, dar bir geri çekilme (direğin %60'ından az retrace, dar bant).
  let pole = null;
  const look = Math.min(35, n - 4);
  for (let a = n - look; a < n - 6; a++) {
    if (a < 0) continue;
    for (let b = a + 5; b <= Math.min(a + 16, n - 3); b++) {
      const rise = (highs[b] - lows[a]) / (lows[a] || 1);
      if (rise > (pole?.rise || 0.12)) pole = { a, b, rise, lo: lows[a], hi: highs[b] };
    }
  }
  if (pole && n - pole.b >= 3 && n - pole.b <= 14) {
    const seg = candles.slice(pole.b);
    const segHigh = Math.max(...seg.map((c) => c.high));
    const segLow = Math.min(...seg.map((c) => c.low));
    const poleH = pole.hi - pole.lo;
    const retrace = (pole.hi - segLow) / (poleH || 1);   // direğin ne kadarı geri verildi
    const tight = (segHigh - segLow) / (poleH || 1);     // bayrak bandı / direk boyu
    if (poleH > 0 && retrace <= 0.6 && tight <= 0.75 && segHigh <= pole.hi * 1.03 && price >= segLow) {
      const breakout = fmt2(segHigh);
      const target = fmt2(breakout + poleH);             // ölçülü hedef = direk boyu kadar
      const conf = Math.round(Math.min(78, 45 + pole.rise * 100 * 0.8 + (0.6 - retrace) * 40));
      pattern = {
        type: "bull_flag", label: "Boğa Bayrağı", tone: "bull", confidence: conf,
        breakout, target,
        description: `Sert bir yükseliş (direk +%${(pole.rise * 100).toFixed(0)}) sonrası dar bir dinlenme. Bu, trendin nefeslenip devam etme ihtimalinin yüksek olduğu klasik bir DEVAM formasyonudur. Bayrağın tepesi ${fmtP(breakout)} GÜNLÜK kapanışla kırılırsa alım teyidi; ölçülü hedef ${fmtP(target)} (direk boyu kadar).`,
        // bayrak kanalı: tepe ve dip boyunca iki paralel çizgi
        lines: [
          { role: "flagTop", p1: { time: candles[pole.b].time, value: fmt2(pole.hi) }, p2: { time: candles[n - 1].time, value: fmt2(segHigh) } },
          { role: "flagBottom", p1: { time: candles[pole.b].time, value: fmt2(pole.lo + poleH * 0.5) }, p2: { time: candles[n - 1].time, value: fmt2(segLow) } },
          { role: "pole", p1: { time: candles[pole.a].time, value: fmt2(pole.lo) }, p2: { time: candles[pole.b].time, value: fmt2(pole.hi) } },
        ],
      };
    }
  }

  // ---- 2) ÇİFT DİP / ÇİFT TEPE (dönüş formasyonu) ----
  // Son ~70 barın BASKIN iki zirvesi/dibi (en uçtakiler) — küçük yerel
  // tümsekleri çift tepe sanmayı önler. Ayrıca: formasyon TAZE olmalı (son
  // tepe/dip son ~30 barda) ve sonradan aşılmamış olmalı.
  const recentLo = n - Math.min(70, n);
  const winPH = ph.filter((p) => p.i >= recentLo);
  const winPL = pl.filter((p) => p.i >= recentLo);
  const winHigh = Math.max(...highs.slice(recentLo));
  const winLow = Math.min(...lows.slice(recentLo));
  const winRange = winHigh - winLow || 1;

  if (!pattern && winPL.length >= 2) {
    // En düşük iki dip (baskın diplere odaklan)
    const lows2 = [...winPL].sort((a, b) => a.price - b.price).slice(0, 3);
    let pair = null;
    for (let x = 0; x < lows2.length; x++) for (let y = x + 1; y < lows2.length; y++) {
      const a = lows2[x], b = lows2[y];
      if (Math.abs(a.price - b.price) / a.price < 0.035 && Math.abs(a.i - b.i) >= 8) { pair = [a, b].sort((p, q) => p.i - q.i); break; }
    }
    if (pair) {
      const [l1, l2] = pair;
      const neck = Math.max(...candles.slice(l1.i, l2.i + 1).map((c) => c.high)); // aradaki tepe = boyun
      const depth = (neck - Math.min(l1.price, l2.price)) / (Math.min(l1.price, l2.price) || 1);
      const fresh = n - 1 - l2.i <= 30;          // ikinci dip son 30 barda
      const dominant = Math.min(l1.price, l2.price) <= winLow + winRange * 0.15; // gerçekten dipte
      const notBroken = lows.slice(l2.i + 1).every((lv) => lv >= Math.min(l1.price, l2.price) * 0.985);
      if (depth > 0.06 && fresh && dominant && notBroken && price > Math.min(l1.price, l2.price)) {
        const breakout = fmt2(neck);
        const target = fmt2(neck + (neck - Math.min(l1.price, l2.price)));
        pattern = {
          type: "double_bottom", label: "Çift Dip (W)", tone: "bull", confidence: 62,
          breakout, target,
          description: `Fiyat ${fmtP(Math.min(l1.price, l2.price))} civarında iki kez dip yapıp tutundu (W). Boyun çizgisi ${fmtP(breakout)} kırılırsa düşüş trendi dönmüş sayılır; ölçülü hedef ${fmtP(target)}. Boyun kırılmadan girmek erkendir.`,
          lines: [{ role: "neck", p1: { time: l1.time, value: breakout }, p2: { time: candles[n - 1].time, value: breakout } }],
        };
      }
    }
  }
  if (!pattern && winPH.length >= 2) {
    // En yüksek iki zirve (baskın tepeler). Güçlü yükseliş trendinde iki eşit
    // zirve genelde devam molasıdır, dönüş değil → o durumda çift tepe deme.
    const highs2 = [...winPH].sort((a, b) => b.price - a.price).slice(0, 3);
    let pair = null;
    for (let x = 0; x < highs2.length; x++) for (let y = x + 1; y < highs2.length; y++) {
      const a = highs2[x], b = highs2[y];
      if (Math.abs(a.price - b.price) / a.price < 0.035 && Math.abs(a.i - b.i) >= 8) { pair = [a, b].sort((p, q) => p.i - q.i); break; }
    }
    if (pair && (above200 === false || above50 === false)) { // sadece zayıf/dönen trendde
      const [h1, h2] = pair;
      const neck = Math.min(...candles.slice(h1.i, h2.i + 1).map((c) => c.low));
      const depth = (Math.max(h1.price, h2.price) - neck) / (neck || 1);
      const fresh = n - 1 - h2.i <= 30;
      const dominant = Math.max(h1.price, h2.price) >= winHigh - winRange * 0.15;
      const notBroken = highs.slice(h2.i + 1).every((hv) => hv <= Math.max(h1.price, h2.price) * 1.015);
      if (depth > 0.06 && fresh && dominant && notBroken && price < Math.max(h1.price, h2.price)) {
        pattern = {
          type: "double_top", label: "Çift Tepe (M)", tone: "bear", confidence: 60,
          breakout: fmt2(neck), target: fmt2(neck - (Math.max(h1.price, h2.price) - neck)),
          description: `Fiyat ${fmtP(Math.max(h1.price, h2.price))} civarında iki kez tepe yapıp geri döndü (M) — yükseliş yorulmuş. Boyun ${fmtP(neck)} aşağı kırılırsa zayıflık teyidi. Yeni alım için uygun değil.`,
          lines: [{ role: "neck", p1: { time: h1.time, value: fmt2(neck) }, p2: { time: candles[n - 1].time, value: fmt2(neck) } }],
        };
      }
    }
  }

  // ---- 3) ÜÇGEN / KANAL (eğimli iki çizgiden) ----
  if (!pattern && resLine && supLine) {
    const rs = resLine.slopePct, ss = supLine.slopePct; // bar başına %
    const flat = 0.05;
    const resAtEnd = resLine.p2.value, supAtEnd = supLine.p2.value;
    const mid = (resAtEnd + supAtEnd) / 2;
    const meas = resAtEnd - supAtEnd; // formasyon yüksekliği → ölçülü hedef
    if (Math.abs(rs) < flat && ss > flat) {
      pattern = { type: "asc_triangle", label: "Yükselen Üçgen", tone: "bull", confidence: 58,
        breakout: fmt2(resAtEnd), target: fmt2(resAtEnd + meas),
        description: `Yatay direnç (${fmtP(resAtEnd)}) + yükselen dipler — alıcılar her geri çekilmede daha erken giriyor. Genelde yukarı kırılır; ${fmtP(resAtEnd)} kapanışla aşılırsa hedef ${fmtP(resAtEnd + meas)}.` };
    } else if (Math.abs(ss) < flat && rs < -flat) {
      pattern = { type: "desc_triangle", label: "Alçalan Üçgen", tone: "bear", confidence: 56,
        breakout: fmt2(supAtEnd), target: fmt2(supAtEnd - meas),
        description: `Yatay destek (${fmtP(supAtEnd)}) + alçalan tepeler — satıcı baskısı artıyor. Genelde aşağı kırılır; destek kırılırsa zayıflık. Yeni alım için beklemeli.` };
    } else if (rs < -flat && ss > flat) {
      pattern = { type: "sym_triangle", label: "Simetrik Üçgen", tone: "neutral", confidence: 50,
        breakout: fmt2(resAtEnd), target: fmt2(price > mid ? resAtEnd + meas : supAtEnd - meas),
        description: `Daralan bant (sıkışma) — kırılım yönü henüz belli değil. ${fmtP(resAtEnd)} üstü kapanış = yukarı kırılım sinyali; ${fmtP(supAtEnd)} altı = aşağı. Kırılımı bekle, tahmin etme.` };
    } else if (rs > flat && ss > flat) {
      pattern = { type: "asc_channel", label: "Yükselen Kanal", tone: "bull", confidence: 54,
        breakout: fmt2(resAtEnd), target: fmt2(resAtEnd + meas),
        description: `Düzenli yükselen kanal — trend sağlam. En iyi alım kanal DİBİNE (${fmtP(supAtEnd)}) yakın; tepeye (${fmtP(resAtEnd)}) yakın almak risklidir (geri çekilme yakın).` };
    } else if (rs < -flat && ss < -flat) {
      pattern = { type: "desc_channel", label: "Alçalan Kanal", tone: "bear", confidence: 52,
        breakout: fmt2(resAtEnd), target: null,
        description: `Düşen kanal — trend aşağı. Kanal üst çizgisi (${fmtP(resAtEnd)}) yukarı kırılana kadar her tepe satış fırsatı sayılır, alım değil.` };
    }
  }

  return { trendlines, pattern };
}

/* ---- Çoklu zaman dilimi: günlük mumlardan HAFTALIK trend (ek API yok) ----
 * Günlük kurulumu haftalık trendle teyit eder. Haftalık da yukarıysa sinyal
 * çok daha güvenilir; haftalık aşağıysa günlük "al" tuzak olabilir. */
function toWeekly(candles) {
  const map = new Map();
  for (const c of candles) {
    const d = new Date(c.time + "T00:00:00Z");
    const day = (d.getUTCDay() + 6) % 7;            // Pazartesi = 0
    const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - day);
    const key = monday.toISOString().slice(0, 10);
    const w = map.get(key);
    if (!w) map.set(key, { time: key, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 });
    else { w.high = Math.max(w.high, c.high); w.low = Math.min(w.low, c.low); w.close = c.close; w.volume += c.volume || 0; }
  }
  return [...map.values()];
}
function weeklyTrend(candles) {
  if (!candles || candles.length < 60) return null;
  const wk = toWeekly(candles);
  if (wk.length < 12) return null;
  const wc = wk.map((c) => c.close);
  const price = wc[wc.length - 1];
  const sma10 = sma(wc, 10);
  const sma30 = wc.length >= 30 ? sma(wc, 30) : null;
  const above10 = sma10 != null ? price > sma10 : null;
  const above30 = sma30 != null ? price > sma30 : null;
  const slopePct = wc.length > 4 ? ((price - wc[wc.length - 5]) / wc[wc.length - 5]) * 100 : 0; // ~4 hafta eğim
  let dir, tone, label;
  if (above10 && above30 !== false && slopePct > 0) { dir = "up"; tone = "good"; label = "Haftalık grafik de yukarı — günlük kurulumu teyit ediyor ✓"; }
  else if (above10 === false && slopePct < 0) { dir = "down"; tone = "bad"; label = "Haftalık grafik AŞAĞI — günlük 'al' haftalıkla çelişiyor, dikkat ✗"; }
  else { dir = "flat"; tone = "warn"; label = "Haftalık grafik yatay/kararsız — güçlü teyit yok"; }
  return { dir, tone, label, above10, above30, slopePct };
}

/* Düz Türkçe "NEDEN bu öneri?" gerekçeleri — plan + göstergeler + formasyon.
 * Kullanıcı "neye göre pozisyona gir anlamıyorum" dediği için: her kararın
 * arkasındaki gerçek sebepleri tek tek, sade dille açar. */
function buildWhy(plan, ind, pattern, weekly) {
  const why = [];
  const add = (tone, text) => why.push({ tone, text });
  if (!plan) return why;
  // 1) Ana trend (50/200 gün)
  if (plan.trend === "güçlü yükseliş") add("good", "Fiyat hem 50 hem 200 günlük ortalamanın üstünde → ana trend güçlü yukarı. Alış tarafında olmak trendle uyumlu.");
  else if (plan.trend === "yükseliş") add("good", "200 günlük ortalamanın üstünde → uzun vadeli trend yukarı, alıma açık.");
  else if (plan.trend === "toparlanma") add("warn", "50g üstünde ama 200g altında → kısa vade toparlıyor, ana trend henüz dönmedi. Temkinli ol.");
  else if (plan.trend === "düşüş") add("bad", "Fiyat 50 ve 200 günlük ortalamanın altında → ana trend aşağı. Yeni alım riskli; trend dönmeden girme.");
  // 2) Kurulum
  if (plan.setup) {
    const m = {
      breakout: "20 günlük zirveyi kırıyor → momentum alıcıları devrede, kırılım sürebilir.",
      pullback: "Yükselen trendde 50g desteğe geri çekilmiş → trendi ucuzlamış fiyattan yakalama fırsatı, risk dar tutulabilir.",
      oversold: "RSI aşırı satım → kısa vadede çok düşmüş, teknik sıçrama potansiyeli (ama düşen bıçak riski, teyit şart).",
    };
    add(plan.setup.type === "oversold" ? "warn" : "good", `Kurulum: ${plan.setup.label}. ${m[plan.setup.type] || ""}`);
  } else if (plan.trend && plan.trend !== "düşüş") {
    add("warn", "Net bir teknik kurulum yok → acele etme; planlanan giriş seviyesine sarkmasını bekle.");
  }
  // 3) RSI
  if (ind?.rsi != null) {
    const r = ind.rsi;
    if (r >= RSI_OVERBOUGHT) add("bad", `RSI ${r.toFixed(0)} aşırı alım → kısa vadede ısınmış; şimdi girersen tepeden alma riski yüksek. Geri çekilme bekle.`);
    else if (r >= 45 && r <= 65) add("good", `RSI ${r.toFixed(0)} sağlıklı bölgede → ne aşırı ısınmış ne bitkin, dengeli momentum.`);
    else if (r < RSI_OVERSOLD) add("warn", `RSI ${r.toFixed(0)} aşırı satım → dipten dönüş olabilir ama yeşil dönüş mumu teyidi şart.`);
  }
  // 4) MACD
  if (ind?.macd) {
    const { macd, hist } = ind.macd;
    if (hist > 0 && macd > 0) add("good", "MACD pozitif ve sinyal çizgisinin üstünde → momentum yukarı dönmüş, hareketi destekliyor.");
    else if (hist < 0 && macd < 0) add("warn", "MACD negatif bölgede → momentum hâlâ zayıf, net dönüş teyidi yok.");
  }
  // 5) Hacim teyidi
  if (ind?.avgVol && ind?.lastVol) {
    const ratio = ind.lastVol / ind.avgVol;
    if (ratio >= 1.5) add("good", `Son hacim 20g ortalamanın ${ratio.toFixed(1)}× üstünde → hareketin arkasında gerçek talep var (teyit).`);
    else if (ratio < 0.7) add("warn", "Hacim 20g ortalamanın altında → hareket zayıf katılımlı, teyidi sınırlı.");
  }
  // 6) Risk/Ödül
  if (plan.rr != null) {
    if (plan.rr >= 2) add("good", `Risk/Ödül ${plan.rr.toFixed(1)}R → kazanırsan kaybedeceğinin ${plan.rr.toFixed(1)} katı. %40 isabetle bile uzun vadede kârda kalırsın.`);
    else if (plan.rr < 1.3) add("warn", `Risk/Ödül sadece ${plan.rr.toFixed(1)}R → ödül riske değmiyor; daha iyi (daha aşağı) giriş seviyesi bekle.`);
  }
  // 7) Formasyon
  if (pattern) {
    const toneMap = { bull: "good", bear: "bad", neutral: "warn" };
    add(toneMap[pattern.tone] || "warn", `Formasyon: ${pattern.label} (güven ~%${pattern.confidence}). ${pattern.description}`);
  }
  // 7b) Haftalık onay (çoklu zaman dilimi)
  if (weekly) add(weekly.tone, weekly.label);
  // 8) Aşırı alım uyarısı (verdict bekle ise net söyle)
  if (plan.overbought && plan.verdict?.key === "wait")
    add("bad", "Sonuç: şu an girmek için ısınmış. Acele etme — sabretmek de bir pozisyondur.");
  return why;
}

// Swing evreni: radar + izleme listesi + portföy hisseleri
/* Cuma hocanın takip listesi — SABİT 28 hisse (TradingView "Strong Uptrend
 * Stocks" ekranı). Kodda sabit tutulur; kullanıcı silemez/kaybedemez. Liste
 * değişirse buradan güncellenir. Pozisyonlar bu evrenden açılacak. */
const CUMA_FIXED = [
  { sym: "BE",   name: "Bloom Energy" },        { sym: "AAOI", name: "Applied Optoelectronics" },
  { sym: "MU",   name: "Micron Technology" },   { sym: "STX",  name: "Seagate Technology" },
  { sym: "MXL",  name: "MaxLinear" },           { sym: "TNGX", name: "Tango Therapeutics" },
  { sym: "TTMI", name: "TTM Technologies" },    { sym: "TER",  name: "Teradyne" },
  { sym: "RLAY", name: "Relay Therapeutics" },  { sym: "AMD",  name: "Advanced Micro Devices" },
  { sym: "LRCX", name: "Lam Research" },        { sym: "ALAB", name: "Astera Labs" },
  { sym: "GLW",  name: "Corning" },             { sym: "CRDO", name: "Credo Technology" },
  { sym: "DELL", name: "Dell Technologies" },   { sym: "COHU", name: "Cohu" },
  { sym: "VELO", name: "Velo3D" },              { sym: "UNIT", name: "Uniti Group" },
  { sym: "SEDG", name: "SolarEdge" },           { sym: "CSTM", name: "Constellium" },
  { sym: "ADEA", name: "Adeia" },               { sym: "RSI",  name: "Rush Street Interactive" },
  { sym: "OUST", name: "Ouster" },              { sym: "WT",   name: "WisdomTree" },
  { sym: "ALGM", name: "Allegro MicroSystems" },{ sym: "VIRT", name: "Virtu Financial" },
  { sym: "TGTX", name: "TG Therapeutics" },     { sym: "VG",   name: "Venture Global" },
];
const CUMA_SYMBOLS = CUMA_FIXED.map((c) => c.sym);
const CUMA_SET = new Set(CUMA_SYMBOLS);
// Radar skorlama evreni = tema grupları ∪ Cuma Hoca listesi (tek birleşik skorlu tablo için).
// TDZ güvenli: refreshRadar/maybeRefreshRadar/api yalnız runtime'da (bu satırdan sonra) çağrılır.
const RADAR_SCAN_SYMBOLS = [...new Set([...RADAR_SYMBOLS, ...CUMA_SYMBOLS])];

async function swingUniverse() {
  let wl = [], port = [];
  try {
    const data = await loadData();
    wl = (data.watchlist || []).map((w) => String(typeof w === "string" ? w : w.symbol).toUpperCase());
    port = (data.holdings || []).filter((h) => h.type === "stock").map((h) => String(h.symbol).toUpperCase());
  } catch {}
  return {
    universe: [...new Set([...RADAR_SYMBOLS, ...wl, ...CUMA_SYMBOLS, ...port])],
    wl: new Set(wl), port: new Set(port), cuma: new Set(CUMA_SYMBOLS),
  };
}

const GRADE_RANK = { A: 4, B: 3, C: 2, D: 1 };

app.get("/api/swing", async (_req, res) => {
  const { universe, wl, port, cuma } = await swingUniverse();
  maybeRefreshSignals(universe); // eksik/eski ise arka planda doldur
  const items = [];
  for (const sym of universe) {
    const t = signalCache[sym];
    if (!t) continue;
    const price = radarCache[sym]?.price ?? t.lastClose ?? null;
    if (price == null) continue;
    const plan = buildPlan(planCtxFromCache(t, price));
    if (!plan) continue;
    items.push({
      symbol: sym, name: radarCache[sym]?.name ?? null, theme: RADAR_THEME[sym] || null,
      price, dayChangePct: radarCache[sym]?.dayChangePct ?? null, rsi: t.rsi,
      owned: port.has(sym), watched: wl.has(sym), cuma: cuma.has(sym), ...plan,
    });
  }
  items.sort((a, b) =>
    (b.setup ? 1 : 0) - (a.setup ? 1 : 0) ||
    (GRADE_RANK[b.grade] || 0) - (GRADE_RANK[a.grade] || 0) ||
    (b.rr || 0) - (a.rr || 0));
  const ts = Object.values(signalCache).map((v) => v.t || 0);
  res.json({
    updated: ts.length ? Math.max(...ts) : 0,
    refreshing: signalsRefreshing,
    total: universe.length, count: items.length,
    setups: items.filter((x) => x.setup).length,
    items,
  });
});

// Tek hisse mum verisi + indikatör serileri + otomatik seviyeler (grafik modalı)
app.get("/api/chart", async (req, res) => {
  const sym = String(req.query.symbol || "").toUpperCase().trim();
  if (!sym) return res.status(400).json({ error: "symbol gerekli" });
  try {
    // "Analizi yenile": 5dk önbelleği atla, en güncel mumla yeniden hesapla.
    // Hesap kural-bazlı/deterministik olduğu için sonuç tutarlıdır.
    if (req.query.fresh) { cache.delete("chart:" + sym); candleCache[sym] && (candleCache[sym].t = 0); }
    const out = await cached("chart:" + sym, 5 * 60_000, async () => {
      // Birleşik önbellek: tarama zaten çektiyse anında döner (TD çağrısı yok).
      // Yoksa tek bir ön plan TD çağrısı yapar (tarama arkasında beklemez).
      const candles = await getCandles(sym); // ~17 ay (SMA200 çizgisi tam çizilsin)
      if (!candles || candles.length < 30) throw new Error("yeterli mum verisi yok (kaynak meşgul, birazdan tekrar dene)");
      const closes = candles.map((c) => c.close), highs = candles.map((c) => c.high), lows = candles.map((c) => c.low);
      const vols = candles.map((c) => c.volume).filter((v) => v != null && isFinite(v));
      const price = radarCache[sym]?.price ?? closes[closes.length - 1];
      const macd = macdCalc(closes), adx = adxCalc(highs, lows, closes), bb = bollinger(closes);
      const avgVol = vols.length >= 20 ? vols.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
      const lastVol = vols.length ? vols[vols.length - 1] : null;
      const ind = {
        sma20: sma(closes, 20), sma50: sma(closes, 50), sma200: sma(closes, 200),
        rsi: rsiCalc(closes, 14), atr: atr14(highs, lows, closes, 14),
        high20: Math.max(...highs.slice(-20)), low20: Math.min(...lows.slice(-20)),
        macd, adx, bb, avgVol, lastVol,
      };
      const piv = pivotLevels(highs, lows, price);
      const nearestSup = piv.support[0] ?? ind.low20 ?? null;
      const nearestRes = piv.resistance[0] ?? ind.high20 ?? null;
      const plan = buildPlan({
        price, atr: ind.atr, rsi: ind.rsi, sma20: ind.sma20, sma50: ind.sma50, sma200: ind.sma200,
        high20: ind.high20, low20: ind.low20,
        support: nearestSup, resistance: nearestRes, resistance2: piv.resistance[1] ?? null,
      });
      const patterns = detectPatterns(candles);                   // eğimli trend çizgileri + formasyon
      const weekly = weeklyTrend(candles);                        // çoklu zaman dilimi onayı
      const why = buildWhy(plan, ind, patterns.pattern, weekly);  // düz Türkçe "neden bu öneri?"
      const qm = qmAnalyze(candles, { price });                   // Qullamaggie setup/giriş/stop analizi
      // ── Grafik üst-bilgi kutusu (TradingView tarzı): piyasa değeri, ADR%, RS, sektör ──
      const profile = await fhProfile(sym).catch(() => ({}));
      const yr = candles.slice(-252);
      const w52High = yr.length ? Math.max(...yr.map((c) => c.high)) : null;
      const w52Low = yr.length ? Math.min(...yr.map((c) => c.low)) : null;
      const dollarVol = (ind.avgVol && price) ? price * ind.avgVol : null;
      const stats = {
        marketCap: profile.marketCap ?? radarCache[sym]?.marketCap ?? null,
        industry: profile.industry ?? null,
        exchange: profile.exchange ?? null,
        adrPct: qm?.adrPct ?? null,
        rsRating: rsRating(sym, candles),
        w52High, w52Low,
        dollarVol,
        fromHighPct: w52High ? +(((price - w52High) / w52High) * 100).toFixed(1) : null,
      };
      return {
        symbol: sym, name: profile.name ?? radarCache[sym]?.name ?? null, theme: RADAR_THEME[sym] || null,
        price, asOf: Date.now(),
        candles,
        sma20: smaSeries(candles, 20), sma50: smaSeries(candles, 50), sma200: smaSeries(candles, 200),
        ema8: emaSeries(candles, 8), ema21: emaSeries(candles, 21), // EMA Cloud (Ripster 8/21)
        indicators: ind, levels: piv, plan, patterns, weekly, why, stats,
        signals: chartSignals(ind, price),
        qm,
      };
    });
    res.json(out);
  } catch (e) {
    res.status(502).json({ error: String(e?.message || e) });
  }
});

/* ----- API: TOPLU mum serisi — Alfa Avı 60+ sembolü TEK istekte yükler -----
 * Mumları YALNIZ önbellekten döndürür (TD çağrısı YOK → anında). 66 gidiş-dönüş → 1.
 * Önbellekte olmayanlar 'missing' listelenir + arka planda ısıtılır (kota-dostu, yanıtı
 * bekletmeden) → sonraki tazelemede dolar. Böylece pano ısınmış sembollerle ANINDA açılır. */
const _warmQ = new Set();
async function queueWarmCandles(syms) {
  const fresh = syms.filter((s) => !_warmQ.has(s)).slice(0, 24); // nazik: turda en fazla 24 soğuk sembol
  if (!fresh.length) return;
  fresh.forEach((s) => _warmQ.add(s));
  try {
    await pool(fresh, 3, async (sym) => { try { await getCandles(sym, { bg: true }); } catch {} });
    await persistCandleCache().catch(() => {});
  } finally { fresh.forEach((s) => _warmQ.delete(s)); }
}
app.get("/api/candles", (req, res) => {
  const syms = String(req.query.symbols || "").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean).slice(0, 80);
  const bars = Math.min(400, Math.max(60, Number(req.query.bars) || 300));
  const out = {}, missing = [];
  for (const sym of syms) {
    const c = candleCache[sym]?.candles;
    if (c && c.length >= 60) out[sym] = c.length > bars ? c.slice(-bars) : c;
    else missing.push(sym);
  }
  res.json({ candles: out, missing, asOf: Date.now() });
  if (missing.length) queueWarmCandles(missing); // yanıttan SONRA, arka planda ısıt (bloklamaz)
});

/* ----- API: piyasa duygusu (VIX + Fear&Greed) — hızlı, hafif endpoint -----
 * Ağır /api/portfolio çağrısını beklemeden duygu kartları anında çizilebilsin
 * diye ayrı tutulur. VIX/F&G zaten bellekten anında döner (SWR). */
app.get("/api/sentiment", async (_req, res) => {
  const [vix, fng] = await Promise.all([safe(fetchVix()), safe(fetchFearGreed())]);
  const fearGreed = fng ? { ...fng, ...(fngBand(fng.score) || {}) } : null;
  let regime = null;
  if (vix && isFinite(vix.value)) {
    const r = vixRegime(vix.value);
    if (r) regime = { vix: vix.value, vixChangePct: vix.changePct, stale: !!vix.stale, ...r };
  }
  res.json({ regime, fearGreed });
});

// Opsiyon türev metrikleri (breakeven, max kar/zarar, BE'ye uzaklık)
function optionMetrics(o, underPrice) {
  const k = Number(o.strike), p = Number(o.premiumPaid) || 0;
  const isLong = (o.direction || "long") === "long";
  const isCall = o.kind === "call";
  const breakeven = isCall ? k + p : k - p;
  let maxProfit = null, maxLoss = null, maxProfitInf = false, maxLossInf = false;
  if (isCall && isLong)      { maxLoss = p;     maxProfitInf = true; }
  else if (isCall && !isLong){ maxProfit = p;   maxLossInf = true; }
  else if (!isCall && isLong){ maxLoss = p;     maxProfit = Math.max(0, k - p); }
  else                       { maxProfit = p;   maxLoss = Math.max(0, k - p); }
  const pctToBreakeven = underPrice ? ((breakeven - underPrice) / underPrice) * 100 : null;
  let moneyness = null;
  if (underPrice) {
    const itm = isCall ? underPrice > k : underPrice < k;
    moneyness = Math.abs(underPrice - k) / k < 0.01 ? "ATM" : itm ? "ITM" : "OTM";
  }
  return { breakeven, maxProfit, maxLoss, maxProfitInf, maxLossInf, pctToBreakeven, moneyness, underlyingPrice: underPrice ?? null };
}

/* --------------------------- API: fiyatlar --------------------------- */
// Tüm portföyü canlı fiyatlarla zenginleştirip döner
app.get("/api/portfolio", async (_req, res) => {
  try {
    const data = await loadData();
    const stockSymbols = data.holdings.filter((h) => h.type === "stock").map((h) => h.symbol);
    const watchSymbols = (data.watchlist || []).map((s) => String(s).toUpperCase());
    maybeRefreshSignals([...stockSymbols.map((s) => s.toUpperCase()), ...watchSymbols]); // arka planda tazele
    // Opsiyon dayanakları + izleme listesi de fiyat çekimine eklenir
    const optUnderlyings = (data.options || []).map((o) => String(o.underlying || "").toUpperCase()).filter(Boolean);
    const alertSymbols = (data.alerts || []).map((a) => String(a.symbol || "").toUpperCase()).filter(Boolean);
    const swingSymbols = (data.swingTrades || []).filter((t) => t.status === "open").map((t) => String(t.symbol || "").toUpperCase()).filter(Boolean);
    const priceSymbols = [...new Set([...stockSymbols.map((s) => s.toUpperCase()), ...optUnderlyings, ...watchSymbols, ...alertSymbols, ...swingSymbols])];
    // Bilanço takvimi: doluysa arka planda tazele; BOŞSA (cold start) bu isteği
    // ~birkaç sn bekletip doldur → kullanıcı "bilanço yok" boş ekranı görmesin.
    { const earnEmpty = !Object.keys(earnCache.map).length;
      const ep = refreshEarnings(priceSymbols);
      if (earnEmpty) await Promise.race([ep, new Promise((r) => setTimeout(r, 5000))]).catch(() => {}); }
    const [metals, stockMap, vix, fng] = await Promise.all([
      safe(fetchMetals()),
      safe(fetchStocks(priceSymbols)),
      safe(fetchVix()),
      safe(fetchFearGreed()),
    ]);
    const fearGreed = fng ? { ...fng, ...(fngBand(fng.score) || {}) } : null;
    // Opsiyon zincirlerini (sembol+vade başına) önceden çek (oto-prim)
    const chainMap = {};
    await Promise.all(
      [...new Set((data.options || []).map((o) => `${String(o.underlying || "").toUpperCase()}__${o.expiry}`))]
        .map(async (key) => {
          const [u, e] = key.split("__");
          if (!u || !e) return;
          try { chainMap[key] = await fetchOptionChain(u, e); } catch {}
        })
    );
    const usdtry = metals?.usd?.selling || null;
    const eurtry = metals?.eur?.selling || null;
    const gram = metals?.gram?.selling || null;

    const enriched = await Promise.all(
      data.holdings.map(async (h) => {
        const out = { ...h, live: null, error: null };
        try {
          if (h.type === "stock") {
            const q = (stockMap || {})[h.symbol.toUpperCase()];
            if (!q) throw new Error(`fiyat bulunamadı (${h.symbol})`);
            const priceTRY = q.price * (usdtry || 0);
            out.live = {
              priceUSD: q.price,
              prevClose: q.prevClose,
              dayChangePct: q.stale ? null : q.dayChangePct, // bayatsa günlük % gösterme
              priceTRY,
              marketValueTRY: h.quantity * priceTRY,
              marketValueUSD: h.quantity * q.price,
              stale: !!q.stale, // son bilinen (canlı değil) fiyat
            };
            out.theme = RADAR_THEME[h.symbol.toUpperCase()] || null; // sektör/tema dağılımı için
            out.sig = buildSignal(h.symbol.toUpperCase(), q.price, h.costUSD);
            out.guard = computeGuard(h.symbol.toUpperCase(), h, q.price); // iz süren stop
            out.earnings = earningsFor(h.symbol); // yaklaşan bilanço
            // Bilanço 16 gün içindeyse opsiyonların fiyatladığı beklenen hareketi ekle
            if (out.earnings && out.earnings.daysLeft != null && out.earnings.daysLeft <= 16) {
              out.earnings.expectedMovePct = await expectedEarningsMove(h.symbol.toUpperCase(), q.price, out.earnings.date);
            }
            // Mini sparkline: son ~30 günlük kapanış (candleCache'ten, ek API yok)
            { const c = candleCache[h.symbol.toUpperCase()]?.candles; out.spark = c && c.length >= 8 ? c.slice(-30).map((x) => x.close) : null; }
          } else if (h.type === "fund") {
            const q = await fetchFund(h.symbol);
            if (q.name) out.name = h.name || q.name;
            out.live = {
              priceTRY: q.price,
              prevClose: q.prevClose,
              dayChangePct: q.stale || !q.prevClose
                ? null
                : ((q.price - q.prevClose) / q.prevClose) * 100,
              marketValueTRY: h.quantity * q.price,
              stale: !!q.stale,
            };
          } else if (h.type === "gold") {
            const ayar = Number(h.ayar) || 24;
            const effGram = h.quantity * (ayar / 24); // 24 ayar saf altın eşdeğeri
            const mvTRY = gram ? effGram * gram : null;
            out.live = {
              priceTRY: gram,
              gramChangePct: metals?.gram?.change != null ? Number(metals.gram.change) : null,
              marketValueTRY: mvTRY,
              marketValueUSD: mvTRY != null && usdtry ? mvTRY / usdtry : null,
            };
          }
        } catch (e) {
          out.error = e.message;
        }
        return out;
      })
    );

    // ---- Opsiyonlar: manuel prim ile K/Z (artık toplam portföye DAHİL) ----
    const MULT = 100; // 1 ABD opsiyon kontratı = 100 hisse
    const options = (data.options || []).map((o) => {
      const contracts = Number(o.contracts) || 0;
      const paid = Number(o.premiumPaid) || 0;       // giriş primi (hisse başı $)
      const und = String(o.underlying || "").toUpperCase();
      // Oto-prim: manuel girilmemişse Yahoo zincirinden
      const manualCur = o.currentPremium == null || o.currentPremium === "" ? null : Number(o.currentPremium);
      const autoPremium = chainMap[`${und}__${o.expiry}`]?.[`${o.kind}|${Number(o.strike)}`] ?? null;
      const cur = manualCur != null ? manualCur : autoPremium;  // güncel prim ($)
      const premiumSource = manualCur != null ? "manuel" : autoPremium != null ? "oto" : null;
      const isLong = (o.direction || "long") === "long";
      const costUSD = paid * contracts * MULT;        // long: ödenen, short: alınan kredi
      const valueUSD = cur == null ? null : cur * contracts * MULT;
      let plUSD = null;
      if (cur != null) {
        plUSD = (isLong ? (cur - paid) : (paid - cur)) * contracts * MULT;
      }
      const plPct = cur != null && paid > 0
        ? (isLong ? (cur - paid) / paid : (paid - cur) / paid) * 100 : null;
      // Vadeye kalan gün
      let dte = null;
      if (o.expiry) {
        dte = Math.ceil((new Date(o.expiry + "T20:00:00Z") - Date.now()) / 86400000);
      }
      const m = optionMetrics(o, stockMap?.[und]?.price ?? null);
      return {
        ...o,
        contracts, premiumPaid: paid, currentPremium: cur, direction: isLong ? "long" : "short",
        autoPremium, premiumSource,
        costUSD,
        costTRY: usdtry ? costUSD * usdtry : null,
        valueUSD,
        valueTRY: valueUSD != null && usdtry ? valueUSD * usdtry : null,
        plUSD,
        plTRY: plUSD != null && usdtry ? plUSD * usdtry : null,
        plPct,
        dte,
        ...m,
      };
    });
    // Toplama eklenecek net opsiyon değeri (long +değer, short -değer = yükümlülük).
    // Yalnızca güncel primi girilmiş opsiyonlar değerlenir.
    const optionsMarketTRY = options.reduce((s, o) => {
      if (o.valueTRY == null) return s;
      return s + (o.direction === "short" ? -o.valueTRY : o.valueTRY);
    }, 0);

    // ---- Toplam piyasa değeri + bugünkü açılış (gün başı) değeri ----
    let totalMarket = 0, totalOpen = 0;
    for (const h of enriched) {
      const lv = h.live;
      if (!lv?.marketValueTRY) continue;
      totalMarket += lv.marketValueTRY;
      // Gün başı (açılış) piyasa değeri tahmini: bugünkü değişimi geri alarak
      let openMV = lv.marketValueTRY;
      if (h.type === "stock" && lv.prevClose != null && usdtry) {
        openMV = h.quantity * lv.prevClose * usdtry;
      } else if (h.type === "fund" && lv.prevClose != null) {
        openMV = h.quantity * lv.prevClose;
      } else if (h.type === "gold" && lv.gramChangePct != null) {
        openMV = lv.marketValueTRY / (1 + lv.gramChangePct / 100);
      }
      totalOpen += openMV;
    }
    // Opsiyonların net değerini hem güncel hem açılış toplamına ekle
    // (açılışa da aynı değeri ekleriz; opsiyonun gün içi salınımı günlük %'yi bozmasın)
    totalMarket += optionsMarketTRY;
    totalOpen += optionsMarketTRY;
    // Swing pozisyonları (Swing Defteri) — ana toplama dahil (hepsi bir portföy; hero + grafik tutarlı)
    for (const t of data.swingTrades || []) {
      if (t.status !== "open" || !(Number(t.qty) > 0)) continue;
      const q = stockMap[String(t.symbol).toUpperCase()];
      if (q?.price == null || !usdtry) continue;
      const qty = Number(t.qty);
      totalMarket += q.price * qty * usdtry;
      totalOpen += (q.prevClose != null ? q.prevClose : q.price) * qty * usdtry; // swing gün-içi hareketi günlük %'ye yansısın
    }
    const c = data.cash || {};
    const cashTL =
      (c.tl || 0) + (c.usd || 0) * (usdtry || 0) + (c.eur || 0) * (eurtry || 0);
    const grandTotal = totalMarket + cashTL;
    const openTotal = totalOpen + cashTL;

    // ---- Piyasa rejimi: VIX bandına göre hedef nakit vs gerçek nakit ----
    let regime = null;
    if (vix && isFinite(grandTotal) && grandTotal > 0) {
      const r = vixRegime(vix.value);
      if (r) {
        const cashPct = (cashTL / grandTotal) * 100;
        const [lo, hi] = r.targetCash;
        let status, advice;
        if (cashPct > hi + 1) {
          status = "deploy";
          advice = `Nakit fazla (%${cashPct.toFixed(0)}). Hedef %${lo}-${hi}. ~%${(cashPct - hi).toFixed(0)} kadar alım yapabilirsin.`;
        } else if (cashPct < lo - 1) {
          status = "raise-cash";
          advice = `Nakit az (%${cashPct.toFixed(0)}). Hedef %${lo}-${hi}. ~%${(lo - cashPct).toFixed(0)} kadar kâr al / nakde geç.`;
        } else {
          status = "ok";
          advice = `Nakit oranın hedefte (%${cashPct.toFixed(0)}). ✓`;
        }
        regime = {
          vix: vix.value,
          vixChangePct: vix.changePct,
          stale: !!vix.stale,
          ...r,
          currentCashPct: cashPct,
          currentInvestedPct: 100 - cashPct,
          status,
          advice,
        };
      }
    }

    // Eksik/hatalı fiyat varsa (kaynak rate-limit vb.) grafiğe yanlış değer yazma
    const anyError = enriched.some((h) => h.error);
    const allValued = enriched.every((h) => h.live?.marketValueTRY != null);

    /* ---- Veri sağlığı + düz Türkçe günlük özet --------------------------
     * Amaç: kullanıcı sayıların NEREDEN geldiğini ve NE KADAR güvenilir
     * olduğunu tek bakışta görsün. Eksik fiyat, bayat sinyal vb. burada
     * açıkça listelenir; ön yüz bunu hero kartında gösterir. */
    const stocksEnriched = enriched.filter((h) => h.type === "stock");
    const missingPrices = enriched.filter((h) => h.error).map((h) => h.symbol);
    const stalePrices = enriched.filter((h) => h.live?.stale).map((h) => h.symbol);
    const metalsStale = !!metals?.stale;
    const staleSignals = stocksEnriched.filter((h) => h.sig?.stale).map((h) => h.symbol);
    const noSignalYet = stocksEnriched.filter((h) => !h.sig).map((h) => h.symbol);
    const meta = {
      healthy: !anyError && allValued && !!usdtry && !!gram,
      missingPrices,                       // fiyatı çekilemeyen semboller (kaynak meşgul olabilir)
      stalePrices,                         // son bilinen (canlı değil) fiyatla gösterilen semboller
      metalsStale,                         // döviz/altın son bilinen değerle (Truncgil erişilemedi)
      staleSignals,                        // teknik verisi 30 saatten eski semboller
      noSignalYet,                         // henüz hiç taranmamış semboller
      sources: {
        prices: FINNHUB_KEY ? "Finnhub (canlı, ~60sn önbellek)" : "Yahoo (anahtarsız yedek)",
        technicals: TD_KEY ? "TwelveData günlük mum (günde ~1 tarama)" : "Yahoo chart (yedek)",
        fx: "Truncgil (USD/EUR/gram altın, ~60sn önbellek)",
        funds: "TEFAS (30dk önbellek)",
      },
      // Sunucunun hesapladığı toplamlar — ön yüz ve rapor aynı sayıyı
      // konuşsun diye tek yerden verilir (TL; USD karşılığı kur ile).
      totals: {
        marketTRY: Math.round(totalMarket),
        cashTRY: Math.round(cashTL),
        grandTRY: Math.round(grandTotal),
        grandUSD: usdtry ? Math.round(grandTotal / usdtry) : null,
        dayOpenTRY: isFinite(totalOpen + cashTL) ? Math.round(totalOpen + cashTL) : null,
      },
    };
    /* ---- Kural 1 Bekçisi: "1. kural para kaybetmemek; 2. kural 1. kuralı
     * asla unutmamak." Sermaye koruma denetimi — her açık pozisyon ve
     * portföy geneli için somut ihlal listesi + 0-100 koruma skoru üretir.
     * Sinyallerden farkı: kazanç aramaz, yalnızca kaybı önlemeye bakar. */
    let rule1 = null;
    {
      const v = []; // ihlaller
      const totMV = totalMarket || 1;
      for (const h of stocksEnriched) {
        const sym = h.symbol.toUpperCase();
        const wPct = ((h.live?.marketValueTRY || 0) / totMV) * 100;
        const gain = h.sig?.gainPct;
        if (h.guard?.breached) {
          v.push({ sym, level: "crit", text: `${sym} iz süren stopun ALTINDA işlem görüyor`,
            action: "Plan neyse onu uygula: çık ya da küçült. 'Biraz daha bekleyeyim' Kural 1 ihlalidir." });
        } else if (gain != null && gain <= -8) {
          v.push({ sym, level: "warn", text: `${sym} maliyete göre %${Math.abs(gain).toFixed(0)} zararda`,
            action: "-%8'den derin zarar disiplin sorunudur: tez bozulduysa çık, bozulmadıysa stop koy ve ekleme yapma." });
        }
        if (!h.guard && !(Number(h.planStop) > 0)) {
          v.push({ sym, level: "warn", text: `${sym} için stop tanımlı değil (Bekçi de hesaplayamadı)`,
            action: "Önce stop, sonra pozisyon: varlık düzenle → planStop gir." });
        }
        if (wPct >= 25) {
          v.push({ sym, level: "warn", text: `${sym} tek başına portföyün %${wPct.toFixed(0)}'i`,
            action: "Tek hisse %25'i geçmesin — fazlasını kâr alarak dengele; tek habere servet emanet etme." });
        }
        if (h.earnings && h.earnings.daysLeft != null && h.earnings.daysLeft <= 3 && wPct >= 15) {
          v.push({ sym, level: "warn", text: `${sym} bilançosu ${h.earnings.daysLeft === 0 ? "bugün" : h.earnings.daysLeft + " gün içinde"} ve pozisyon büyük (%${wPct.toFixed(0)})`,
            action: "Bilanço bir yazı-tura: pozisyonun bir kısmını kapat ya da kârı stopla kilitle." });
        }
      }
      // Tema konsantrasyonu (hisse kitabına göre)
      const tw = {};
      for (const h of stocksEnriched) {
        const k = h.theme?.title || "Diğer";
        tw[k] = (tw[k] || 0) + (h.live?.marketValueTRY || 0);
      }
      const topT = Object.entries(tw).sort((a, b) => b[1] - a[1])[0];
      if (topT && totMV && (topT[1] / totMV) * 100 >= 40) {
        v.push({ sym: null, level: "warn", text: `"${topT[0]}" teması hisse kitabının %${((topT[1] / totMV) * 100).toFixed(0)}'i`,
          action: "Aynı tema aynı gün birlikte düşer — çeşitlendir ya da tema başına stop disiplini kur." });
      }
      // Skor: kritik 25, uyarı 10 puan düşürür; bilgi maddeleri gösterilir ama
      // puan kırmaz — eyleme zorlamaz, farkındalık verir.
      const critN = v.filter((x) => x.level === "crit").length;
      const warnN = v.filter((x) => x.level === "warn").length;
      const score = Math.max(0, 100 - critN * 25 - warnN * 10);
      rule1 = {
        score,
        grade: score >= 85 ? "saglam" : score >= 65 ? "dikkat" : "alarm",
        motto: "1. Kural: Para kaybetme. 2. Kural: 1. kuralı asla unutma.",
        violations: v,
      };
    }

    /* ---- Portföy Önerileri: ham ihlal listesi yerine okunabilir, tekrarsız ve
     * önceliklendirilmiş "ne yapsam" akışı. Önce sermayeyi koruyan riskler,
     * sonra kâr-al / fırsat / denge. Öneridir, emir değil. */
    let insights = null;
    {
      const items = [];
      const totMV = totalMarket || 1;
      const noStop = [];
      for (const h of stocksEnriched) {
        const sym = h.symbol.toUpperCase();
        const sig = h.sig || {};
        const wPct = ((h.live?.marketValueTRY || 0) / totMV) * 100;
        const gain = sig.gainPct, rsi = sig.rsi;
        if (h.guard?.breached) {
          items.push({ pr: 0, kind: "risk", sym, title: `${sym}: iz süren stop kırıldı`,
            detail: `Fiyat stop seviyesinin (${h.guard.stop != null ? "$" + h.guard.stop.toFixed(2) : "—"}) altında.`,
            action: "Planı uygula: çık ya da küçült. Beklemek Kural 1 ihlali." });
        } else if (gain != null && gain <= -8) {
          items.push({ pr: 1, kind: "risk", sym, title: `${sym}: maliyete göre %${Math.abs(gain).toFixed(0)} zararda`,
            detail: "Derin zarar — tez bozulduysa çık, bozulmadıysa stop koy ve ekleme yapma.",
            action: "Tezini gözden geçir; stop tanımla." });
        }
        if (sig.profitTake) {
          items.push({ pr: 2, kind: "kar-al", sym, title: `${sym}: kâr-al bölgesi`,
            detail: sig.profitTake.text || "Kârın bir kısmını realize etmeyi düşün.",
            action: `Pozisyonu ${sig.profitTake.trim || "bir miktar"} azaltmayı düşün.` });
        } else if (gain != null && gain >= 25 && rsi != null && rsi >= 70) {
          items.push({ pr: 2, kind: "kar-al", sym, title: `${sym}: +%${gain.toFixed(0)} kârda ve aşırı alım (RSI ${rsi.toFixed(0)})`,
            detail: "Momentum güçlü ama geri çekilme riski artıyor.",
            action: "Kârın bir kısmını stopla kilitle." });
        }
        if (sig.signal?.tone === "buy" && sig.swing) {
          items.push({ pr: 3, kind: "firsat", sym, title: `${sym}: aktif kurulum (${sig.swing.grade || ""})`,
            detail: sig.swing.label || "Teknik kurulum oluştu.",
            action: (sig.swing.note ? sig.swing.note.split(".")[0] + "." : "Plana göre değerlendir.") });
        }
        if (wPct >= 25) {
          items.push({ pr: 2, kind: "denge", sym, title: `${sym}: portföyün %${wPct.toFixed(0)}'i`,
            detail: "Tek hissede aşırı yoğunlaşma — tek habere çok şey bağlı.",
            action: "%25'in üstünü kademeli azaltıp dengele." });
        }
        if (h.earnings && h.earnings.daysLeft != null && h.earnings.daysLeft <= 3 && wPct >= 12) {
          items.push({ pr: 2, kind: "risk", sym, title: `${sym}: bilanço ${h.earnings.daysLeft === 0 ? "bugün" : h.earnings.daysLeft + " gün içinde"}`,
            detail: `Pozisyon büyük (%${wPct.toFixed(0)}) — bilanço gecelik gap riski taşır.`,
            action: "Pozisyonu hafiflet ya da kârı stopla." });
        }
        if (!h.guard && !(Number(h.planStop) > 0)) noStop.push(sym);
      }
      if (noStop.length) {
        items.push({ pr: 4, kind: "denge", sym: null, title: `${noStop.length} pozisyonda stop tanımlı değil`,
          detail: noStop.join(", "), action: "Önce stop, sonra pozisyon: her biri için planStop gir." });
      }
      const tw = {};
      for (const h of stocksEnriched) { const k = h.theme?.title || "Diğer"; tw[k] = (tw[k] || 0) + (h.live?.marketValueTRY || 0); }
      const topT = Object.entries(tw).sort((a, b) => b[1] - a[1])[0];
      if (topT && (topT[1] / totMV) * 100 >= 40) {
        items.push({ pr: 4, kind: "denge", sym: null, title: `"${topT[0]}" teması kitabın %${((topT[1] / totMV) * 100).toFixed(0)}'i`,
          detail: "Aynı tema aynı gün birlikte düşer.", action: "Çeşitlendir ya da tema başına stop disiplini kur." });
      }
      if (regime?.advice) {
        items.push({ pr: 3, kind: "rejim", sym: null, title: `Piyasa rejimi · VIX ${regime.vix != null ? regime.vix.toFixed(0) : "—"}`,
          detail: `${regime.band || ""}.`, action: regime.advice });
      }
      items.sort((a, b) => a.pr - b.pr);
      const counts = { risk: 0, "kar-al": 0, firsat: 0, denge: 0 };
      items.forEach((x) => { if (counts[x.kind] != null) counts[x.kind]++; });
      insights = { items: items.slice(0, 9), counts, score: rule1.score, grade: rule1.grade };
    }

    /* ---- Genel Bakış: en büyük 3 pozisyon — olumlu/olumsuz yönler + son haberler
     * (haberler saatlik tazelenir). Teknik+analist verisinden derlenir. */
    let topPicks = [];
    {
      const TOP_NEWS_TTL = 3600_000; // 1 saat
      const top3 = stocksEnriched
        .filter((h) => h.live?.marketValueTRY)
        .sort((a, b) => b.live.marketValueTRY - a.live.marketValueTRY)
        .slice(0, 3);
      topPicks = await Promise.all(top3.map(async (h) => {
        const sym = h.symbol.toUpperCase();
        const sig = h.sig || {};
        const wPct = ((h.live?.marketValueTRY || 0) / (totalMarket || 1)) * 100;
        const pros = [], cons = [];
        const rsi = sig.rsi;
        const p = h.live?.priceUSD;
        if (sig.reco === "strong_buy" || sig.reco === "buy") pros.push(`Analist konsensüsü AL (${sig.recoTotal || 0} analist)`);
        else if (sig.reco === "sell" || sig.reco === "strong_sell") cons.push(`Analist konsensüsü SAT (${sig.recoTotal || 0} analist)`);
        if (sig.sma200 && p) { if (p >= sig.sma200) pros.push("200 günlük ortalamanın üstünde — uzun vade trendi yukarı"); else cons.push("200 günlük ortalamanın altında — uzun vade trendi zayıf"); }
        if (rsi != null) { if (rsi >= 70) cons.push(`RSI ${rsi.toFixed(0)} — aşırı alım, geri çekilme riski`); else if (rsi <= 35) pros.push(`RSI ${rsi.toFixed(0)} — aşırı satım, tepki potansiyeli`); }
        if (sig.fromHighPct != null) { if (sig.fromHighPct >= -3) cons.push("52 hafta zirvesine çok yakın — yukarı alan sınırlı"); else if (sig.fromHighPct <= -25) pros.push(`52h zirvesinden %${Math.abs(sig.fromHighPct).toFixed(0)} uzakta — iskontolu`); }
        if (sig.swing) pros.push(`Aktif teknik kurulum (${sig.swing.grade || ""}${sig.swing.label ? ": " + sig.swing.label : ""})`);
        if (sig.gainPct != null) { if (sig.gainPct >= 25) pros.push(`Senin pozisyonun +%${sig.gainPct.toFixed(0)} kârda`); else if (sig.gainPct <= -8) cons.push(`Senin pozisyonun %${Math.abs(sig.gainPct).toFixed(0)} zararda`); }
        if (h.earnings && h.earnings.daysLeft != null && h.earnings.daysLeft <= 7) cons.push(`Bilanço ${h.earnings.daysLeft === 0 ? "bugün" : h.earnings.daysLeft + " gün içinde"} — oynaklık riski`);
        const news = await recentNews(sym, { ttl: TOP_NEWS_TTL }).catch(() => []);
        const newsSummary = buildNewsSummary((news || []).slice(0, 3));
        return {
          symbol: sym, name: h.name || sym,
          weightPct: Math.round(wPct * 10) / 10,
          priceUSD: h.live?.priceUSD ?? null,
          dayChangePct: h.live?.dayChangePct ?? null,
          reco: sig.reco || null, recoTotal: sig.recoTotal || null,
          rsi: rsi != null ? Math.round(rsi) : null,
          pros: pros.slice(0, 4), cons: cons.slice(0, 4),
          news: (news || []).slice(0, 3),
          newsSummary,
        };
      }));
    }

    {
      const dayPct = openTotal > 0 ? ((grandTotal - openTotal) / openTotal) * 100 : null;
      const buyN = stocksEnriched.filter((h) => h.sig?.signal?.tone === "buy").length;
      const sellN = stocksEnriched.filter((h) => h.sig?.signal?.tone === "sell").length;
      const trimN = stocksEnriched.filter((h) => h.sig?.profitTake).length;
      const setupN = stocksEnriched.filter((h) => h.sig?.swing).length;
      const guardBad = stocksEnriched.filter((h) => h.guard?.breached).map((h) => h.symbol);
      const s = [];
      if (dayPct != null && isFinite(dayPct)) {
        s.push(`Portföy bugün ${dayPct >= 0 ? "+" : ""}%${dayPct.toFixed(2)} ${dayPct >= 0.05 ? "yukarıda" : dayPct <= -0.05 ? "aşağıda" : "yatay"} (gün açılışına göre, döviz dahil)`);
      }
      if (guardBad.length) s.push(`🛑 ${guardBad.join(", ")} iz süren stopun altında — çıkış planını uygula`);
      if (rule1 && rule1.score < 85) s.push(`🛡️ Kural 1 skoru ${rule1.score}/100 — ${rule1.violations.filter((x) => x.level !== "info").length} sermaye koruma uyarısı var, panele bak`);
      if (trimN) s.push(`✂️ ${trimN} pozisyonda kâr-al önerisi var`);
      if (buyN) s.push(`🟢 ${buyN} hisse alım bölgesinde`);
      if (sellN) s.push(`🔴 ${sellN} hisse aşırı alımda`);
      if (setupN) s.push(`📈 ${setupN} hissede aktif swing kurulumu`);
      if (!s.length) s.push("Belirgin sinyal yok — pozisyonlar nötr bölgede, izlemede kal");
      if (regime?.advice) s.push(`VIX ${regime.vix.toFixed(0)} (${regime.band}): ${regime.advice}`);
      if (missingPrices.length) s.push(`⚠️ ${missingPrices.join(", ")} için fiyat alınamadı — toplamlar bu kalemler hariç/eski değerle`);
      else if (staleSignals.length) s.push(`⚠️ ${staleSignals.join(", ")} teknik verisi bayat (yeni tarama bekleniyor)`);
      // Parçalar kendi noktasıyla gelebilir (ör. rejim tavsiyesi) → çift nokta olmasın
      meta.summaryText = s.map((x) => x.replace(/\.+\s*$/, "")).join(". ") + ".";
    }

    data.snapshots = data.snapshots || [];
    data.intraday = data.intraday || [];
    const today = new Date().toISOString().slice(0, 10);
    if (isFinite(grandTotal) && grandTotal > 0 && usdtry && gram && !anyError && allValued) {
      const snap = {
        date: today,
        total: Math.round(grandTotal * 100) / 100,
        market: Math.round(totalMarket * 100) / 100,
        cash: Math.round(cashTL * 100) / 100,
        usdtry,
      };
      const i = data.snapshots.findIndex((s) => s.date === today);
      if (i >= 0) data.snapshots[i] = snap;
      else data.snapshots.push(snap);

      // ---- Gün içi (intraday) seyir: 15 dk'lık dilimler, yalnızca bugün ----
      const MS15 = 15 * 60 * 1000;
      const slotISO = (t) =>
        new Date(Math.floor(new Date(t).getTime() / MS15) * MS15).toISOString();
      // Eski (dakikalık) ve yeni tüm bugünkü noktaları 15 dk dilimlere indir
      const buckets = new Map();
      for (const p of data.intraday.filter((p) => p.t.slice(0, 10) === today)) {
        buckets.set(slotISO(p.t), p.total); // dilim içindeki en güncel değer kalır
      }
      buckets.set(slotISO(new Date().toISOString()), Math.round(grandTotal * 100) / 100);
      data.intraday = [...buckets.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([t, total]) => ({ t, total }));
      if (data.intraday.length > 200) data.intraday = data.intraday.slice(-200);

      // ---- Bugünün açılış (gün başı) değeri ----
      if (isFinite(openTotal) && openTotal > 0) {
        data.dayOpen = { date: today, total: Math.round(openTotal * 100) / 100 };
      }

      // ---- Günlük rapor (sinyaller + rejim + kâr-al + swing) ----
      const todayReport = {
        date: today,
        generatedAt: new Date().toISOString(),
        note: meta.summaryText, // günün düz Türkçe özeti — rapor tek başına okunabilsin
        totalTRY: Math.round(grandTotal),
        totalUSD: usdtry ? Math.round(grandTotal / usdtry) : null,
        dayChangePct: openTotal > 0 ? ((grandTotal - openTotal) / openTotal) * 100 : null,
        regime: regime
          ? { vix: regime.vix, band: regime.band, advice: regime.advice, targetCash: regime.targetCash, currentCashPct: regime.currentCashPct }
          : null,
        stocks: enriched
          .filter((h) => h.type === "stock" && h.sig)
          .map((h) => ({
            symbol: h.symbol,
            price: h.live?.priceUSD ?? null,
            dayChangePct: h.live?.dayChangePct ?? null,
            rsi: h.sig.rsi ?? null,
            signal: h.sig.signal || null,
            reasons: h.sig.reasons || [],
            upsidePct: h.sig.upsidePct ?? null,
            gainPct: h.sig.gainPct ?? null,
            profitTake: h.sig.profitTake || null,
            swing: h.sig.swing || null,
          })),
      };
      data.reports = data.reports || [];
      const ri = data.reports.findIndex((r) => r.date === today);
      if (ri >= 0) data.reports[ri] = todayReport;
      else data.reports.push(todayReport);
      if (data.reports.length > 30) data.reports = data.reports.slice(-30);

      await saveData(data);
    }

    res.json({
      cash: data.cash,
      fx: { usdtry, eurtry, gram, metals },
      regime,
      fearGreed,
      alerts: (data.alerts || []).map((a) => evalAlert(a, (stockMap || {})[String(a.symbol).toUpperCase()])), // fiyat alarmları + tetik durumu
      rule1, // Kural 1 Bekçisi: sermaye koruma skoru + ihlal listesi (özet/uyumluluk)
      insights, // Portföy Önerileri: önceliklendirilmiş eylem akışı
      topPicks, // En büyük 3 pozisyon: olumlu/olumsuz + haberler (saatlik)
      meta, // veri sağlığı + kaynaklar + günün düz Türkçe özeti (summaryText)
      watchlist: watchSymbols.map((sym) => {
        const q = (stockMap || {})[sym];
        const price = q?.price ?? null;
        return {
          symbol: sym,
          price,
          dayChangePct: q?.dayChangePct ?? null,
          sig: buildSignal(sym, price, null),
          earnings: earningsFor(sym),
        };
      }),
      holdings: enriched,
      options,
      trades: data.trades || [],
      // Vergi paneli: ground-truth kalemleri (kullanıcı düzeltmeleri uygulanmış) + kullanıcının elle eklediği kayıtlar.
      // Eski otomatik satış kayıtları gizlenir — truth zaten gerçek realize'yi kapsar (çift sayım önlenir).
      realized2026: (() => {
        const edits = data.realized2026Edits || {};
        const truth = realized2026FromTruth().map((r) => edits[r.id] != null ? { ...r, amountTRY: +edits[r.id], edited: true } : r);
        const manual = (data.realized2026 || []).filter((r) => r.source === "manual");
        // Truth anlık görüntüsünden SONRAKİ otomatik realize'ler (yeni satışlar + swing kapanışları) — truth
        // bunları kapsamaz, eklenir. Cutoff ve öncesi otomatik kayıtlar truth'ta zaten var → atlanır (çift sayım yok).
        const newAuto = (data.realized2026 || [])
          .filter((r) => r.source !== "manual" && r.auto && r.date && String(r.date) > REALIZE_TRUTH_CUTOFF);
        return [...truth, ...newAuto, ...manual];
      })(),
      flows: data.flows || [],
      history: data.snapshots,
      intraday: (data.intraday || []).filter((p) => p.t.slice(0, 10) === today),
      dayOpen: data.dayOpen && data.dayOpen.date === today ? data.dayOpen : null,
      // Açık swing pozisyon özeti (sembol→adet/sayı) — Varlıklar tablosundaki "swing" rozeti için
      swingOpen: (data.swingTrades || []).reduce((m, t) => {
        if (t.status !== "open") return m;
        const s = String(t.symbol || "").toUpperCase();
        if (!s) return m;
        m[s] = { qty: (m[s]?.qty || 0) + (Number(t.qty) || 0), count: (m[s]?.count || 0) + 1 };
        return m;
      }, {}),
      // Açık swing pozisyonları (Swing Defteri) — ana sayfa "⚡ Swing" tablosuna canlı K/Z ile
      swingPositions: (data.swingTrades || []).filter((t) => t.status === "open" && Number(t.qty) > 0).map((t) => {
        const sym = String(t.symbol || "").toUpperCase();
        const q = (stockMap || {})[sym];
        const live = q?.price ?? null;
        const qty = Number(t.qty) || 0, entry = Number(t.entry) || 0;
        const valueUSD = live != null ? live * qty : null;
        const costUSD = entry * qty;
        const plUSD = live != null ? (live - entry) * qty : null;
        const plPct = live != null && entry ? ((live - entry) / entry) * 100 : null;
        // İz süren stop (Chandelier) + R-multiple + MA10/20 + zaman-stop (Faz 1: çıkış disiplini)
        const guard = computeGuard(sym, { planStop: t.stop, planTarget: t.target }, live);
        const stop = Number(t.stop) || null;
        const riskPerShare = stop != null && entry > stop ? entry - stop : null;       // 1R ($)
        const currentR = riskPerShare != null && live != null ? +((live - entry) / riskPerShare).toFixed(2) : null;
        const cc = candleCache[sym]?.candles;
        const closesS = cc && cc.length ? cc.map((c) => c.close) : null;
        const sma = (arr, n) => (arr && arr.length >= n ? arr.slice(-n).reduce((a, b) => a + b, 0) / n : null);
        const ma10 = closesS ? sma(closesS, 10) : null, ma20 = closesS ? sma(closesS, 20) : null;
        const daysOpen = t.openedAt ? Math.max(0, Math.round((Date.now() - new Date(t.openedAt).getTime()) / 86400_000)) : null;
        // Zaman-stop: kırılımdan ≥7 gün geçti ama hâlâ <1R ilerleme → kurulum çalışmadı
        const timeStop = daysOpen != null && daysOpen >= 7 && currentR != null && currentR < 1;
        // MFE (en iyi R) ve MAE (en kötü R) — açıldığından bu yana mum önbelleğinden
        let mfeR = null, maeR = null;
        if (cc && cc.length && riskPerShare != null && t.openedAt) {
          const op = new Date(t.openedAt).getTime() / 1000;
          const seg = cc.filter((c) => (c.time || 0) >= op - 86400);
          if (seg.length) {
            const hi = Math.max(...seg.map((c) => c.high)), lo = Math.min(...seg.map((c) => c.low));
            mfeR = +((hi - entry) / riskPerShare).toFixed(2);
            maeR = +((lo - entry) / riskPerShare).toFixed(2);
          }
        }
        return {
          id: t.id, symbol: sym, name: t.name || radarCache[sym]?.name || null,
          qty, entry, stop: t.stop ?? null, target: t.target ?? null,
          price: live, dayChangePct: q?.dayChangePct ?? null, stale: !!q?.stale,
          costUSD, valueUSD, plUSD, plPct, openedAt: t.openedAt || null, note: t.note || "",
          guard: guard ? { stop: +guard.stop.toFixed(2), chandelier: +guard.chandelier.toFixed(2), distPct: +guard.distPct.toFixed(1), breached: guard.breached, near: guard.near, targetHit: guard.targetHit } : null,
          riskPerShare: riskPerShare != null ? +riskPerShare.toFixed(2) : null,
          currentR, mfeR, maeR, daysOpen, timeStop,
          ma10: ma10 != null ? +ma10.toFixed(2) : null, ma20: ma20 != null ? +ma20.toFixed(2) : null,
          belowMa10: ma10 != null && live != null ? live < ma10 : null,
          belowMa20: ma20 != null && live != null ? live < ma20 : null,
        };
      }),
      // Birleşik realize K/Z (sembol başına, USD) — ana satışlar + SWING setup realize'leri (Büyüme için).
      // Çift sayım yok: swing satışı data.trades'e tradeId ile yazıldıysa base'den düşülür, swing tarafında sayılır.
      realizedBySym: (() => {
        const swingTradeIds = new Set();
        const swingReal = {};
        for (const t of data.swingTrades || []) {
          const sym = String(t.symbol || "").toUpperCase(); if (!sym) continue;
          let sr = 0;
          for (const lot of t.realizedLots || []) { sr += Number(lot.pnlUSD) || 0; if (lot.tradeId) swingTradeIds.add(lot.tradeId); }
          if ((!t.realizedLots || !t.realizedLots.length) && t.status === "closed" && t.exitPrice != null && Number(t.qty) > 0)
            sr += (Number(t.exitPrice) - Number(t.entry)) * Number(t.qty);
          if (sr) swingReal[sym] = (swingReal[sym] || 0) + sr;
        }
        // Realize = YALNIZCA portföy kuruluşundan (8 Haz 2026) sonraki işlem geçmişi satışları.
        // Eski aracı-kurum realize geçmişi (REALIZED_2026_TRUTH override) artık UYGULANMAZ — Kaan'ın kararı.
        const out = {};
        for (const tr of data.trades || []) {
          if (tr.kind === "buy" || swingTradeIds.has(tr.id)) continue; // swing-kökenli satışlar swingReal'da sayılır
          if (tr.date && String(tr.date) < PORTFOLIO_START) continue;  // kuruluş öncesi eski realize'ler hariç
          const sym = String(tr.symbol || "").toUpperCase();
          const pl = (Number(tr.shares) || 0) * ((Number(tr.sellUSD) || 0) - (Number(tr.buyUSD) || 0));
          if (sym && isFinite(pl)) out[sym] = (out[sym] || 0) + pl;
        }
        for (const [sym, v] of Object.entries(swingReal)) out[sym] = (out[sym] || 0) + v;
        for (const sym of Object.keys(out)) out[sym] = +out[sym].toFixed(2);
        return out;
      })(),
      // Broker geçmiş override'ı KALDIRILDI — realize artık yalnız işlem geçmişinden (8 Haz'dan itibaren).
      // Boş bırakılır ki Realize Özeti tek kaynaktan (realizedBySym) tutarlı gösterilsin.
      realizeOverrideTRY: {},
      realizeOverrideEdited: {},
      // Midas işlem ücreti özeti (her emir $1.5) — Vergi panelinde bilgi satırı.
      // Yalnız data.trades üzerinden sayılır (her emir bir kez); 2026 ground-truth zaten net.
      midasFees: (() => {
        const fx = usdtry || Number((data.snapshots || []).slice(-1)[0]?.usdtry) || null;
        let count = 0, usd = 0, tryTot = 0;
        for (const t of data.trades || []) {
          const f = Number(t.feeUSD); if (!(f > 0)) continue;
          count++; usd += f; tryTot += f * (Number(t.usdtry) || fx || 0);
        }
        return { count, usd: +usd.toFixed(2), tryTot: +tryTot.toFixed(2), perTrade: MIDAS_FEE };
      })(),
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Ground-truth realize kalemleri (Robinhood "Yatırım geliri", TL) — TEK KAYNAK ──
// Her satır = bir hisse veya opsiyon kontratının net realize K/Z'si. Vergi paneli
// bu kalemleri gösterir; Realize Özeti sembol başına toplar. Kaynak: 27 Haz 2026 ekran görüntüleri.
const REALIZED_2026_TRUTH = []; // kendi aracı-kurum realize kalemlerini buraya (veya UI'dan) girebilirsin
// Ground-truth anlık görüntüsünün tarihi (27 Haz 2026 ekran görüntüleri). Bu tarihten SONRAKİ
// otomatik satış/swing realize'leri truth'a EKLENİR (yeni işlemler); bu tarih ve öncesi truth'ta
// zaten var → çift sayım olmaz. Yeni satış yapıldığında İşlem Geçmişi → 2026 Realize'a düşer.
const REALIZE_TRUTH_CUTOFF = "2026-06-27";
// Portföyün kurulduğu tarih — Realize K/Z YALNIZCA bu tarih ve sonrası işlem geçmişinden hesaplanır.
// Kaan'ın kararı (7 Tem 2026): eski (kuruluş öncesi) aracı-kurum realize geçmişi ARTIK gösterilmez.
const PORTFOLIO_START = "2026-06-08";
// Realize Özeti override'ı bu kalemlerden sembol başına TÜRETİLİR (opsiyonlar underlying'e toplanır)
const REALIZE_OVERRIDE_TRY = (() => {
  const o = {};
  for (const r of REALIZED_2026_TRUTH) o[r.symbol] = +(((o[r.symbol] || 0) + r.amountTRY)).toFixed(2);
  return o;
})();
// Vergi paneli için kalemleri realized2026 kayıt formatına çevir (sabit id → düzenleme/silme stabil)
const realized2026FromTruth = () => REALIZED_2026_TRUTH.map((r, i) => ({
  id: "r26-truth-" + i,
  symbol: r.symbol,
  label: r.label,
  amountTRY: r.amountTRY,
  date: null,
  year: 2026,
  auto: true,
  source: "truth",
}));

function safe(p) {
  return Promise.resolve(p).catch(() => null);
}

// İşlem anındaki USDTRY: önce canlı kur, olmazsa son snapshot'taki kur.
async function currentUsdTry(data) {
  let usdtry = null;
  try { usdtry = Number((await fetchMetals())?.usd?.selling) || null; } catch {}
  if (!usdtry) usdtry = Number((data?.snapshots || []).slice(-1)[0]?.usdtry) || null;
  return usdtry;
}

// Varlık eklemesini İşlem Geçmişi defterine "Alış" olarak yansıt (senkron).
// Yalnızca fiyatı bilinen hisse alımları yazılır; fiyatsız ekleme iz bırakmaz.
function appendBuyTrade(data, { symbol, name, shares, priceUSD, usdtry, note }) {
  if (!(shares > 0) || !(priceUSD > 0)) return null;
  data.trades = data.trades || [];
  const trade = {
    id: "t-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
    kind: "buy",
    symbol: String(symbol).toUpperCase(),
    name: name || "",
    date: new Date().toISOString().slice(0, 10),
    shares: +shares,
    buyUSD: +priceUSD,
    sellUSD: 0,
    usdtry: usdtry || null,
    note: note || "varlık eklemeden otomatik",
    auto: true,
  };
  data.trades.push(trade);
  // Alış nakitten düşer (tam otomatik nakit) — quick-add / varlık ekle yolu
  const spend = (+shares) * (+priceUSD);
  if (spend > 0) { data.cash = data.cash || {}; data.cash.usd = +(((Number(data.cash.usd) || 0) - spend)).toFixed(2); }
  return trade;
}

/* ----------------------- API: holding yönetimi ----------------------- */
app.post("/api/holdings", async (req, res) => {
  try {
    const data = await loadData();
    const h = req.body;
    if (!h.symbol || !h.type) {
      return res.status(400).json({ error: "symbol ve type zorunlu" });
    }
    h.symbol = String(h.symbol).toUpperCase();
    h.quantity = Number(h.quantity) || 0;
    if (h.costUSD != null && h.costUSD !== "") h.costUSD = Number(h.costUSD); else delete h.costUSD;
    if (h.costTRY != null && h.costTRY !== "") h.costTRY = Number(h.costTRY); else delete h.costTRY;
    if (h.ayar != null && h.ayar !== "") h.ayar = Number(h.ayar);
    if (h.planStop != null && h.planStop !== "") h.planStop = Number(h.planStop);
    if (h.planTarget != null && h.planTarget !== "") h.planTarget = Number(h.planTarget);

    // Aynı tür+sembol (altında ayrıca aynı ayar) varsa YENİ satır açma → mevcut
    // pozisyona ekle: adet toplanır, maliyet ağırlıklı ortalama alınır. Böylece
    // "hızlı ekle" ile aynı hisseyi tekrar eklemek pozisyonu büyütür, çoğaltmaz.
    const existing = data.holdings.find((x) =>
      x.type === h.type && String(x.symbol).toUpperCase() === h.symbol &&
      (h.type !== "gold" || (Number(x.ayar) || 24) === (Number(h.ayar) || 24)));
    if (existing && h.quantity > 0) {
      const q0 = Number(existing.quantity) || 0, q1 = h.quantity, qT = q0 + q1;
      if (existing.costUSD != null && h.costUSD != null && qT > 0)
        existing.costUSD = (q0 * existing.costUSD + q1 * h.costUSD) / qT;
      else if (existing.costUSD == null && h.costUSD != null)
        existing.costUSD = h.costUSD;
      if (existing.costTRY != null || h.costTRY != null)
        existing.costTRY = (Number(existing.costTRY) || 0) + (Number(h.costTRY) || 0);
      existing.quantity = qT;
      if (!existing.name && h.name) existing.name = h.name;
      if (h.type === "stock" && h.costUSD > 0)
        appendBuyTrade(data, { symbol: existing.symbol, name: existing.name, shares: q1, priceUSD: h.costUSD, usdtry: await currentUsdTry(data) });
      await saveData(data);
      return res.json({ ...existing, merged: true });
    }

    h.id = h.id || h.symbol.toLowerCase() + "-" + Date.now().toString(36);
    data.holdings.push(h);
    if (h.type === "stock" && h.costUSD > 0)
      appendBuyTrade(data, { symbol: h.symbol, name: h.name, shares: h.quantity, priceUSD: h.costUSD, usdtry: await currentUsdTry(data) });
    await saveData(data);
    res.json(h);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/holdings/:id", async (req, res) => {
  try {
    const data = await loadData();
    const i = data.holdings.findIndex((x) => x.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: "bulunamadı" });
    const upd = { ...data.holdings[i], ...req.body, id: req.params.id };
    upd.quantity = Number(upd.quantity) || 0;
    if (upd.costUSD != null) upd.costUSD = Number(upd.costUSD);
    if (upd.costTRY != null) upd.costTRY = Number(upd.costTRY);
    if (upd.ayar != null && upd.ayar !== "") upd.ayar = Number(upd.ayar);
    if (upd.planStop != null && upd.planStop !== "") upd.planStop = Number(upd.planStop);
    if (upd.planTarget != null && upd.planTarget !== "") upd.planTarget = Number(upd.planTarget);
    data.holdings[i] = upd;
    await saveData(data);
    res.json(upd);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/holdings/:id", async (req, res) => {
  try {
    const data = await loadData();
    data.holdings = data.holdings.filter((x) => x.id !== req.params.id);
    await saveData(data);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ------------- API: Leopold (Situational Awareness LP) 13F ------------- */
// Fonun son iki 13F'ini karşılaştırır, kullanıcının portföyüyle kesişimi
// çıkarır ve "Kural 1: para kaybetme" felsefesiyle öneri üretir.
app.get("/api/leopold", async (_req, res) => {
  try {
    const leo = await getLeopold();
    if (!leo?.positions?.length) {
      return res.status(503).json({ error: "13F verisi henüz alınamadı (SEC erişimi). Birazdan tekrar dene." });
    }
    const data = await loadData();
    const myStocks = (data.holdings || []).filter((h) => h.type === "stock");
    const mySyms = new Set(myStocks.map((h) => String(h.symbol).toUpperCase()));

    const fmtM = (v) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}Mr` : `$${(v / 1e6).toFixed(0)}M`);
    const key = (p) => `${p.sym || p.name}|${p.kind}`;
    const prevMap = new Map((leo.prevPositions || []).map((p) => [key(p), p]));

    // Toplamlar + dönem değişimi (sym|kind bazında adet karşılaştırması)
    let longUSD = 0, putUSD = 0, callUSD = 0;
    const positions = leo.positions.map((p) => {
      if (p.kind === "put") putUSD += p.valueUSD;
      else if (p.kind === "call") callUSD += p.valueUSD;
      else longUSD += p.valueUSD;
      const prev = prevMap.get(key(p));
      let qoq = "new", qoqPct = null;
      if (prev) {
        const d = prev.shares ? ((p.shares - prev.shares) / prev.shares) * 100 : 0;
        qoqPct = Math.round(d);
        qoq = Math.abs(d) < 1 ? "same" : d > 0 ? "up" : "down";
      }
      const th = p.sym ? leoTheme(p.sym) : leoTheme("");
      return { ...p, qoq, qoqPct, theme: th.theme, why: th.why };
    });
    const total = longUSD + putUSD + callUSD;
    positions.forEach((p) => { p.weightPct = total ? +(p.valueUSD / total * 100).toFixed(1) : 0; });

    // Çıkışlar: önceki dönemde olup bu dönemde olmayan satırlar
    const curKeys = new Set(positions.map(key));
    const exited = (leo.prevPositions || []).filter((p) => !curKeys.has(key(p)));

    // ---- Kesişim: senin hisselerin × fonun satırları ----
    const overlap = [];
    for (const h of myStocks) {
      const sym = String(h.symbol).toUpperCase();
      const rows = positions.filter((p) => p.sym === sym);
      const ex = exited.filter((p) => p.sym === sym);
      if (!rows.length && !ex.length) continue;
      overlap.push({
        sym,
        yourQty: h.quantity,
        leoLong: rows.find((p) => p.kind === "long")?.valueUSD || 0,
        leoPut: rows.find((p) => p.kind === "put")?.valueUSD || 0,
        leoCall: rows.find((p) => p.kind === "call")?.valueUSD || 0,
        leoExited: ex.length > 0,
      });
    }

    // ---- Öneri motoru — Kural 1: para kaybetme ----
    const suggestions = [];
    for (const o of overlap) {
      if (o.leoExited && !o.leoLong && !o.leoCall) {
        suggestions.push({ level: "warn", sym: o.sym,
          text: `Leopold ${o.sym} pozisyonundan tamamen çıkmış (geçen çeyrekte vardı, bu dönem yok). Sen hâlâ tutuyorsun.`,
          action: "Tezini yeniden gözden geçir; kâr varsa korumaya al, zarar büyüyorsa Kural 1'i hatırla." });
      } else if (o.leoPut > 0 && o.leoPut > o.leoLong + o.leoCall) {
        suggestions.push({ level: "warn", sym: o.sym,
          text: `Leopold ${o.sym} pozisyonunda net olarak ${fmtM(o.leoPut)} nominal PUT taşıyor — düşüşe karşı korunmuş ya da görece zayıflık bekliyor. Senin pozisyonun korumasız.`,
          action: "İz süren stop'unu sıkılaştır veya pozisyonu küçült; Kural 1: kâğıt kârını geri verme." });
      } else if (o.leoLong + o.leoCall > 0) {
        suggestions.push({ level: "info", sym: o.sym,
          text: `${o.sym} pozisyonunda Leopold ile aynı taraftasın (fonda ${fmtM(o.leoLong + o.leoCall)} long/call).${o.leoPut ? ` Yine de ${fmtM(o.leoPut)} Put ile korumalı oynuyor.` : ""}`,
          action: o.leoPut ? "O korumalı, sen değilsin — stop disiplinini koru." : "Tez örtüşüyor; pozisyon büyüklüğün %25'i aşmasın." });
      }
    }
    // Fonun en büyük 5 long'undan sende olmayanlar → inceleme fikri
    positions
      .filter((p) => p.kind === "long" && p.sym && !mySyms.has(p.sym))
      .slice(0, 5)
      .forEach((p) => {
        suggestions.push({ level: "idea", sym: p.sym,
          text: `${p.sym} (${p.name}) — fonun büyük long'u (${fmtM(p.valueUSD)}, kitabın %${p.weightPct}'i)${p.qoq === "new" ? ", bu çeyrek YENİ almış" : p.qoq === "up" ? `, adedi %${p.qoqPct} artırmış` : ""}. Tema: ${p.theme}. ${p.why}`,
          action: "Almadan önce: giriş + stop + hedef planı yaz; ilk pozisyon portföyün %5-10'unu geçmesin. Kural 1 önce." });
      });
    // Genel duruş: hedge oranı
    if (putUSD > 0 && total > 0) {
      const hr = Math.round((putUSD / total) * 100);
      suggestions.unshift({ level: hr >= 30 ? "warn" : "info", sym: null,
        text: `Fon kitabının ~%${hr}'i PUT (nominal) — Leopold büyük cap AI'da belirgin koruma taşıyor; long tarafı enerji/veri merkezine kaymış.`,
        action: hr >= 30 ? "Savunmacı duruş sinyali: nakit oranını ve stop'larını gözden geçir." : "Dengeli duruş; kendi stop planına sadık kal." });
    }

    res.json({
      fund: leo.fund, checkedAt: leo.checkedAt,
      current: leo.current, previous: leo.previous,
      totals: { totalUSD: total, longUSD, putUSD, callUSD },
      positions,
      exited: exited.map((p) => ({ sym: p.sym, name: p.name, kind: p.kind, valueUSD: p.valueUSD })),
      overlap, suggestions,
      disclaimer: "13F çeyreklik ve ~45 gün gecikmeli açıklanır; short/nakit görünmez, Put/Call nominal değerdir. 'Neden' satırları fonun kamuya açık tezinden çıkarımdır — yatırım tavsiyesi değildir.",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ----------------------- API: günlük raporlar ----------------------- */
app.get("/api/reports", async (_req, res) => {
  try {
    const d = await loadData();
    res.json((d.reports || []).slice().reverse()); // en yeni başta
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ----- API: haftalık özet — her hisse ~5 işlem günü değişim + portföy haftası -----
 * candleCache'ten ücretsiz hesaplanır (yeni TD çağrısı yok); özeti panelde gösterir. */
app.get("/api/weekly", async (_req, res) => {
  try {
    const data = await loadData();
    const holdings = (data.holdings || []).filter((h) => h.type === "stock");
    const rows = [];
    for (const h of holdings) {
      const sym = h.symbol.toUpperCase();
      const c = candleCache[sym]?.candles;
      if (!c || c.length < 6) continue;
      const end = c[c.length - 1].close, start = c[c.length - 6].close; // 5 işlem günü önce
      if (!isFinite(start) || !start) continue;
      const qty = Number(h.quantity) || 0;
      rows.push({
        symbol: sym, name: h.name || radarCache[sym]?.name || null,
        start, end, pct: ((end - start) / start) * 100,
        qty, weekChangeUSD: qty * (end - start),
      });
    }
    rows.sort((a, b) => b.pct - a.pct);
    const sumW = rows.reduce((s, r) => s + r.weekChangeUSD, 0);
    const sumStart = rows.reduce((s, r) => s + r.qty * r.start, 0);
    // Portföy seviyesi (TL) — snapshot'lardan ~7 gün önceki ile bugünü kıyasla
    const snaps = data.snapshots || [];
    const last = snaps[snaps.length - 1] || null;
    const weekAgoTs = Date.now() - 7 * 86400_000;
    let weekAgo = null;
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (new Date(snaps[i].date).getTime() <= weekAgoTs) { weekAgo = snaps[i]; break; }
    }
    if (!weekAgo && snaps.length) weekAgo = snaps[0];
    res.json({
      stocks: rows,
      best: rows[0] || null,
      worst: rows[rows.length - 1] || null,
      stockWeekChangeUSD: sumW,
      stockWeekPct: sumStart ? (sumW / sumStart) * 100 : null,
      portfolio: last && weekAgo ? {
        fromDate: weekAgo.date, toDate: last.date,
        fromTotal: weekAgo.total, toTotal: last.total,
        changeTRY: last.total - weekAgo.total,
        pct: weekAgo.total ? ((last.total - weekAgo.total) / weekAgo.total) * 100 : null,
      } : null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ----- API: sinyal backtest / "keşke" izleyici -----------------------------
 * Geçmiş günlük raporlardaki (data.reports, ~son 30 gün) sinyalleri alır, her
 * sembol+sinyal için İLK işaretlendiği günkü fiyatı bugünkü fiyatla kıyaslar:
 * "o sinyale uysaydım şimdi ne olurdu?" Skoru gözle kalibre etmeye yarar. */
app.get("/api/backtest", async (_req, res) => {
  try {
    const data = await loadData();
    const reports = data.reports || []; // eskiden yeniye
    const latestPrice = (sym) => {
      const c = candleCache[sym]?.candles;
      if (c?.length) return c[c.length - 1].close;
      return radarCache[sym]?.price ?? null;
    };
    const seen = new Set(); // sembol|tip → ilk görülen kaydı tut
    const samples = [];
    for (const rep of reports) {
      const ageDays = Math.round((Date.now() - new Date(rep.date).getTime()) / 86400_000);
      if (ageDays < 1) continue; // bugünün sinyali henüz sonuç vermedi
      for (const s of rep.stocks || []) {
        if (s.price == null) continue;
        const tags = [];
        if (s.signal?.tone === "buy") tags.push("buy");
        if (s.signal?.tone === "sell") tags.push("sell");
        if (s.swing?.setup) tags.push("setup");
        for (const tag of tags) {
          const k = `${s.symbol}|${tag}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const cur = latestPrice(s.symbol);
          if (cur == null) continue;
          samples.push({
            symbol: s.symbol, tag, date: rep.date, ageDays,
            entry: s.price, now: cur, ret: ((cur - s.price) / s.price) * 100,
            setup: s.swing?.setup || null,
          });
        }
      }
    }
    const stat = (tag, winCond) => {
      const arr = samples.filter((x) => x.tag === tag).map((x) => x.ret);
      if (!arr.length) return null;
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      return { n: arr.length, avgRet: avg, winRate: (arr.filter(winCond).length / arr.length) * 100, best: Math.max(...arr), worst: Math.min(...arr) };
    };
    res.json({
      windowDays: 30,
      buy: stat("buy", (r) => r > 0),
      sell: stat("sell", (r) => r < 0),   // sat sinyali "isabetli" = sonradan düştü
      setup: stat("setup", (r) => r > 0),
      samples: samples.sort((a, b) => Math.abs(b.ret) - Math.abs(a.ret)).slice(0, 40),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ----- API: Sinyal Karnesi — kayıtlı planların gerçek sonucu ---------------
 * evaluateLedger tamamen candleCache'ten çalışır → ek API maliyeti yok. */
app.get("/api/signal-stats", async (_req, res) => {
  try {
    evaluateLedger();
    await persistLedger();
    const TYPES = ["breakout", "pullback", "oversold"];
    const byType = {};
    for (const tp of TYPES) {
      const recs = ledger.filter((r) => r.type === tp);
      const resolved = recs.filter((r) => ["target", "stop", "timeout"].includes(r.status));
      const rs = resolved.map((r) => r.r).filter((v) => v != null && isFinite(v));
      const wins = resolved.filter((r) => (r.r ?? 0) > 0).length;
      byType[tp] = {
        total: recs.length,
        waiting: recs.filter((r) => r.status === "waiting").length,
        open: recs.filter((r) => r.status === "open").length,
        expired: recs.filter((r) => r.status === "expired").length,
        target: recs.filter((r) => r.status === "target").length,
        stop: recs.filter((r) => r.status === "stop").length,
        timeout: recs.filter((r) => r.status === "timeout").length,
        resolved: resolved.length,
        winRate: resolved.length ? (wins / resolved.length) * 100 : null,
        avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
        totalR: rs.length ? rs.reduce((a, b) => a + b, 0) : null,
      };
    }
    res.json({
      updated: Date.now(),
      count: ledger.length,
      byType,
      records: [...ledger]
        .sort((a, b) => (a.signalDate < b.signalDate ? 1 : -1))
        .slice(0, 40),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ----- API: HAFTALIK FIRSATLAR — bu haftanın en güçlü GİRİLEBİLİR kurulumları
 * Swing evrenini tarar; her hisseye plan (giriş/stop/hedef) + formasyon +
 * momentum + Sinyal Karnesi isabet oranı ekler, "fırsat skoru"na göre sıralar.
 * Dolarlık pozisyon penceresini ön yüz GERÇEK portföy değerinden çizer.
 * GARANTİ YOK: backtest isabet oranı dürüstçe gösterilir — bilerek abartmaz. */
function setupHitRates() {
  const out = {};
  for (const tp of ["breakout", "pullback", "oversold"]) {
    const resolved = ledger.filter((r) => r.type === tp && ["target", "stop", "timeout"].includes(r.status));
    const wins = resolved.filter((r) => (r.r ?? 0) > 0).length;
    const rs = resolved.map((r) => r.r).filter((v) => v != null && isFinite(v));
    out[tp] = {
      n: resolved.length,
      winRate: resolved.length ? Math.round((wins / resolved.length) * 100) : null,
      avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    };
  }
  return out;
}

app.get("/api/opportunities", async (_req, res) => {
  const { universe, wl, port, cuma } = await swingUniverse();
  maybeRefreshSignals(universe);
  try { evaluateLedger(); } catch {}
  const hits = setupHitRates();
  const items = [];
  for (const sym of universe) {
    const t = signalCache[sym];
    if (!t) continue;
    const candles = candleCache[sym]?.candles || null;
    const price = radarCache[sym]?.price ?? t.lastClose ?? null;
    if (price == null) continue;
    const plan = buildPlan(planCtxFromCache(t, price));
    if (!plan || plan.entry == null) continue;
    // FİLTRE: girilebilir + yükseliş tarafı + makul R/R + aşırı alım değil
    if (plan.overbought) continue;
    if (!["güçlü yükseliş", "yükseliş", "toparlanma"].includes(plan.trend)) continue;
    if (plan.rr == null || plan.rr < 1.6) continue;
    const pat = candles ? detectPatterns(candles).pattern : null;
    if (pat && pat.tone === "bear") continue; // ayı formasyonu varsa fırsat sayma
    const weekly = candles ? weeklyTrend(candles) : null;
    if (weekly && weekly.dir === "down") continue; // haftalık aşağıysa günlük 'al' tuzak — fırsat sayma

    // Momentum (mum önbelleğinden, bedava)
    const closes = candles?.map((c) => c.close) || [];
    const retK = (k) => closes.length > k ? ((price - closes[closes.length - 1 - k]) / closes[closes.length - 1 - k]) * 100 : null;
    const ret1M = retK(21), ret3M = retK(63);
    const fromHighPct = t.w52High ? ((t.w52High - price) / t.w52High) * 100 : null;

    // Fırsat skoru (0-100 civarı): kalite + kurulum + R/R + RSI + trend + zirveye yakınlık + momentum + formasyon
    let score = ({ A: 40, B: 30, C: 18, D: 8 }[plan.grade] || 8);
    if (plan.setup) score += ({ breakout: 10, pullback: 12, oversold: 4 }[plan.setup.type] || 6);
    score += Math.min(15, plan.rr * 5);
    if (t.rsi != null && t.rsi >= 45 && t.rsi <= 65) score += 8;
    if (plan.trend === "güçlü yükseliş") score += 6;
    if (fromHighPct != null && fromHighPct <= 15) score += 8;
    else if (fromHighPct != null && fromHighPct <= 30) score += 4;
    if (ret3M != null && ret3M > 0) score += Math.min(8, ret3M / 5);
    if (pat && pat.tone === "bull") score += Math.min(12, pat.confidence * 0.16);
    if (weekly?.dir === "up") score += 7;        // haftalık teyit → güçlü artı
    else if (weekly?.dir === "flat") score -= 2;
    // Girilebilirlik: hazır "AL" kurulumu olanı, "sadece izle/geri çekilme bekle"nin önüne al
    if (plan.verdict?.key === "buy") score += 8;
    else if (plan.verdict?.key === "watch" && !plan.setup) score -= 5;

    const hr = plan.setup ? hits[plan.setup.type] : null;
    items.push({
      symbol: sym, name: radarCache[sym]?.name ?? null, theme: RADAR_THEME[sym] || null,
      owned: port.has(sym), watched: wl.has(sym), cuma: cuma.has(sym),
      price, dayChangePct: radarCache[sym]?.dayChangePct ?? null, rsi: t.rsi,
      score: Math.min(100, Math.round(score)),
      trend: plan.trend, setup: plan.setup, verdict: plan.verdict, grade: plan.grade,
      entry: plan.entry, entryType: plan.entryType, stop: plan.stop, target: plan.target, target2: plan.target2,
      rr: plan.rr, riskPct: plan.riskPct, rewardPct: plan.rewardPct,
      pattern: pat ? { type: pat.type, label: pat.label, tone: pat.tone, confidence: pat.confidence, breakout: pat.breakout, target: pat.target } : null,
      weekly: weekly ? { dir: weekly.dir, tone: weekly.tone } : null,
      hitRate: hr && hr.n >= 3 ? hr : null,
      ret1M, ret3M, fromHighPct,
      spark: closes.length >= 8 ? closes.slice(-30) : null,
      why: buildWhy(plan, { rsi: t.rsi }, pat, weekly).slice(0, 5),
    });
  }
  items.sort((a, b) => b.score - a.score);
  const top = items.slice(0, 10);
  try { recordOppSnapshot(top); await persistOppHistory(); } catch {}

  // Nöbetteki 10 hisse: insider (radar önbelleğinden, bedava) + son haberler
  // (Finnhub company-news, 18s TTL). Yalnızca Top-10 için → hafif kalır.
  try {
    await Promise.all(top.map(async (o) => {
      const ins = radarCache[o.symbol]?.insider || null;
      if (ins && (ins.buys || ins.sells)) {
        o.insider = {
          buys: ins.buys || 0, sells: ins.sells || 0,
          buyValue: ins.buyValue || 0, netValue: ins.netValue || 0,
          lastBuy: ins.lastBuy || null,
          signal: ins.netValue > 0 && ins.buys > 0 ? "buy" : (ins.netValue < 0 ? "sell" : "neutral"),
        };
      }
      o.news = await recentNews(o.symbol);
    }));
    await persistNewsCache();
  } catch {}

  const ts = Object.values(signalCache).map((v) => v.t || 0);
  res.json({
    updated: ts.length ? Math.max(...ts) : 0,
    refreshing: signalsRefreshing,
    total: universe.length, scanned: items.length,
    items: top,
    hitRates: hits,
  });
});

/* ----- API: Qullamaggie tarayıcı — momentum swing adayları (qm.js, mekanik) -------
 * Evren = Radar (Tarama+Swing) + izleme listesi + Cuma Hoca listesi + portföy (swingUniverse,
 * /api/swing ile aynı evren). Gerçek hamlesi olan HER hisse döner (breakout/EP/kısmi eşleşme) —
 * sabit "ilk 5" kuralı YOK; kaç hisse şartı taşıyorsa hepsi listelenir, kademe+skora göre sıralı.
 * MEKANİK kural taraması — yatırım tavsiyesi DEĞİL, kararı kullanıcı verir (Kural 1). */
app.get("/api/qm", async (_req, res) => {
  const { universe, wl, port } = await swingUniverse();
  maybeRefreshSignals(universe);
  const items = [];
  for (const sym of universe) {
    const candles = candleCache[sym]?.candles || null;
    if (!candles || candles.length < 60) continue;
    const t = signalCache[sym];
    const price = radarCache[sym]?.price ?? t?.lastClose ?? candles[candles.length - 1].close;
    if (price == null) continue;
    const a = qmAnalyze(candles, { price });
    // setup "none" = ne gerçek bir hamle (≥%20) ne de likidite var → Qullamaggie tarzıyla
    // hiç eşleşmiyor, dışla. "watch" (kısmi eşleşme), "breakout", "ep" hepsi listeye girer.
    if (!a.ok || a.setup === "none" || !a.liquidity?.ok) continue;
    items.push({
      symbol: sym, name: radarCache[sym]?.name ?? null, theme: RADAR_THEME[sym] || null,
      owned: port.has(sym), watched: wl.has(sym),
      price, dayChangePct: radarCache[sym]?.dayChangePct ?? null,
      setup: a.setup, stage: a.stage, score: a.score,
      adrPct: a.adrPct, priorMovePct: a.priorMovePct,
      entry: a.entryTrigger, stop: a.stop, stopPct: a.stopPct, pivot: a.pivotHigh,
      rTargets: a.rTargets, ep: a.ep, extendedOverMA10: a.extendedOverMA10,
      consolidation: a.consolidation, ma: a.ma, checklist: a.checklist, reasons: a.reasons,
      fromHighPct: t?.w52High ? ((t.w52High - price) / t.w52High) * 100 : null,
      // Faz 4: göreli güç (SPY'ye karşı IBD 1-99) + hacim teyidi (son gün vs 20g ort.)
      rsRating: rsRating(sym, candles),
      volConfirm: (() => {
        const v = candles.map((c) => c.volume || 0);
        if (v.length < 21) return null;
        const last = v[v.length - 1], avg = v.slice(-21, -1).reduce((s, x) => s + x, 0) / 20;
        return avg > 0 ? +(last / avg).toFixed(2) : null;
      })(),
      spark: candles.map((c) => c.close).slice(-40),
    });
  }
  const stageRank = { "breaking-out": 3, "setting-up": 2, "early": 1, "extended": 0 };
  items.sort((a, b) => (stageRank[b.stage] - stageRank[a.stage]) || (b.score - a.score));
  const ready = items.filter((x) => x.stage === "breaking-out" || x.stage === "setting-up");
  const watch = items.filter((x) => x.stage === "extended" || x.stage === "early");
  // Günlük QM snapshot (sistem sonuç takibi) — sadece yeni günde yazar
  try { const data = await loadData(); if (recordQmSnapshot(data, ready)) await saveData(data); } catch {}
  const ts = Object.values(signalCache).map((v) => v.t || 0);
  res.json({
    updated: ts.length ? Math.max(...ts) : 0,
    refreshing: signalsRefreshing,
    total: universe.length, scanned: items.length,
    top: ready,    // şartı taşıyan TÜM kırılıyor/kuruluyor adayları — sayı sınırı yok, kademe+skora göre sıralı
    watch: watch,  // şartı taşıyan TÜM izleme adayları (kısmi eşleşme/erken/gergin) — sayı sınırı yok
  });
});

// Tek sembol QM giriş kalitesi (Faz 2): swing modalında sembol girilince
// checklist kapısı + ADR/likidite + extended + R hedef. Önbellekteyse anında,
// değilse tek hafif çekim. Tarama "none" verse bile çiğ analizi döndürür.
app.get("/api/qm/:symbol", async (req, res) => {
  const sym = String(req.params.symbol || "").toUpperCase().trim();
  if (!sym) return res.status(400).json({ error: "symbol gerekli" });
  try {
    const candles = candleCache[sym]?.candles || await getCandles(sym).catch(() => null);
    if (!candles || candles.length < 60) return res.json({ symbol: sym, ok: false, reason: "yetersiz mum verisi" });
    const price = radarCache[sym]?.price ?? candles[candles.length - 1].close;
    const a = qmAnalyze(candles, { price });
    const passN = (a.checklist || []).filter((c) => c.pass).length;
    res.json({
      symbol: sym, name: radarCache[sym]?.name ?? null, price,
      ok: a.ok, setup: a.setup, stage: a.stage, score: a.score,
      adrPct: a.adrPct, liquidity: a.liquidity, priorMovePct: a.priorMovePct,
      entryTrigger: a.entryTrigger, stop: a.stop, stopPct: a.stopPct, rTargets: a.rTargets,
      extendedOverMA10: a.extendedOverMA10, consolidation: a.consolidation,
      checklist: a.checklist || [], passN, passTotal: (a.checklist || []).length, reasons: a.reasons || [],
    });
  } catch (e) { res.status(502).json({ error: String(e?.message || e) }); }
});

// Benchmark — S&P 500 (SPY) + Nasdaq-100 (QQQ) günlük kapanış serisi (portföy getirini
// aynı pencerede kıyaslamak için). candleCache'ten (24s TTL); 2 sembol, kota dostu.
app.get("/api/benchmark", async (_req, res) => {
  try {
    const out = {};
    for (const sym of ["SPY", "QQQ"]) {
      const candles = await getCandles(sym).catch(() => null);
      out[sym] = candles?.length ? candles.map((c) => ({ date: c.time, close: c.close })) : null;
    }
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ===== Profesyonel Risk Motoru — getiri-serisi bazlı kurumsal metrikler =====
 * Korelasyon matrisi · portföy & pozisyon volatilitesi · beta (SPY) · VaR (parametrik+tarihsel)
 * · risk katkısı (her pozisyonun toplam riske payı) · momentum · risk-bazlı pozisyon boyutu (ADR/Kelly). */
const _mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const _variance = (a) => { if (a.length < 2) return 0; const m = _mean(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1); };
const _stdev = (a) => Math.sqrt(_variance(a));
const _cov = (a, b) => { const n = Math.min(a.length, b.length); if (n < 2) return 0; const ma = _mean(a.slice(-n)), mb = _mean(b.slice(-n)); let s = 0; for (let i = 0; i < n; i++) s += (a[a.length - n + i] - ma) * (b[b.length - n + i] - mb); return s / (n - 1); };
const _corr = (a, b) => { const sa = _stdev(a), sb = _stdev(b); return (sa && sb) ? _cov(a, b) / (sa * sb) : 0; };
const _dailyReturns = (candles, n) => {
  if (!candles || candles.length < 5) return [];
  const c = candles.slice(-(n + 1)).map((x) => x.close).filter((x) => x > 0);
  const r = []; for (let i = 1; i < c.length; i++) r.push(c[i] / c[i - 1] - 1);
  return r;
};

app.get("/api/risk", async (_req, res) => {
  try {
    const data = await loadData();
    const stocks = (data.holdings || []).filter((h) => h.type === "stock" && Number(h.quantity) > 0);
    // Açık swing pozisyonları da risk evrenine dahil (hepsi bir portföy)
    for (const t of data.swingTrades || []) if (t.status === "open" && Number(t.qty) > 0) stocks.push({ symbol: t.symbol, quantity: t.qty, _swing: true });
    for (const h of stocks) await getCandles(h.symbol).catch(() => {});
    const spy = await getCandles("SPY").catch(() => null);
    const LB = 90;

    // Sembol başına birleştir (aynı sembol hisse+swing) + candle/getiri
    const bySym = {};
    for (const h of stocks) {
      const sym = String(h.symbol).toUpperCase();
      const candles = candleCache[sym]?.candles;
      if (!candles || candles.length < 30) continue;
      const px = candles[candles.length - 1].close;
      const v = px * Number(h.quantity);
      if (!bySym[sym]) bySym[sym] = { symbol: sym, valueUSD: 0, candles, px };
      bySym[sym].valueUSD += v;
    }
    const pos = Object.values(bySym);
    if (pos.length < 1) return res.json({ empty: true, reason: "yeterli mum verisi yok" });

    const spyRetFull = spy ? _dailyReturns(spy, LB) : null;
    for (const p of pos) p.retFull = _dailyReturns(p.candles, LB);
    const L = Math.min(...pos.map((p) => p.retFull.length), spyRetFull ? spyRetFull.length : 999);
    if (L < 20) return res.json({ empty: true, reason: "yeterli geçmiş yok" });
    const spyRet = spyRetFull ? spyRetFull.slice(-L) : null;
    for (const p of pos) p.r = p.retFull.slice(-L);

    const totVal = pos.reduce((s, p) => s + p.valueUSD, 0);
    const ann = Math.sqrt(252);
    for (const p of pos) {
      p.weight = totVal ? p.valueUSD / totVal : 0;
      p.volAnn = _stdev(p.r) * ann;
      p.adr = qmADR(p.candles, 20);
      p.beta = spyRet ? _cov(p.r, spyRet) / (_variance(spyRet) || 1) : null;
      const cl = p.candles.map((x) => x.close);
      p.momo3m = cl.length > 64 ? cl[cl.length - 1] / cl[cl.length - 64] - 1 : null;
      p.momo6m = cl.length > 127 ? cl[cl.length - 1] / cl[cl.length - 127] - 1 : null;
    }
    // Portföy günlük getiri serisi (ağırlıklı)
    const portRet = [];
    for (let i = 0; i < L; i++) portRet.push(pos.reduce((s, p) => s + p.weight * p.r[i], 0));
    const portVolD = _stdev(portRet);
    const varP = _variance(portRet) || 1;
    // Risk katkısı: %RC_i = w_i·cov(r_i, r_p) / var_p  (toplam = %100)
    for (const p of pos) p.rcPct = (p.weight * _cov(p.r, portRet)) / varP * 100;
    // VaR (1 günlük): parametrik (normal) + tarihsel (%5 dilim)
    const sorted = [...portRet].sort((a, b) => a - b);
    const histVar95 = -(sorted[Math.floor(0.05 * sorted.length)] || 0) * totVal;
    // Korelasyon matrisi
    const syms = pos.map((p) => p.symbol);
    const matrix = pos.map((a) => pos.map((b) => +_corr(a.r, b.r).toFixed(2)));
    let cs = 0, ck = 0;
    for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) { cs += matrix[i][j]; ck++; }
    const avgCorr = ck ? cs / ck : 0;
    // Risk-bazlı pozisyon boyutu: 1×ADR stopta portföyün %1'i risk → önerilen pozisyon
    const riskBudgetPct = 1;
    for (const p of pos) {
      const stopDist = (p.adr || 4) / 100;
      const maxRiskUSD = totVal * riskBudgetPct / 100;
      p.maxRiskUSD = maxRiskUSD;
      p.suggestUSD = stopDist > 0 ? maxRiskUSD / stopDist : null;
      p.suggestPct = p.suggestUSD != null && totVal ? p.suggestUSD / totVal * 100 : null;
    }
    res.json({
      asOf: new Date().toISOString(),
      lookback: L,
      hasBenchmark: !!spyRet,
      portfolio: {
        valueUSD: +totVal.toFixed(0),
        volAnnPct: +(portVolD * ann * 100).toFixed(1),
        beta: spyRet ? +(_cov(portRet, spyRet) / (_variance(spyRet) || 1)).toFixed(2) : null,
        var95USD: +(1.645 * portVolD * totVal).toFixed(0),
        var95Pct: +(1.645 * portVolD * 100).toFixed(1),
        var99USD: +(2.326 * portVolD * totVal).toFixed(0),
        histVar95USD: +histVar95.toFixed(0),
        avgCorr: +avgCorr.toFixed(2),
        diversification: +((1 - Math.max(0, avgCorr)) * 100).toFixed(0),
      },
      positions: pos.map((p) => ({
        symbol: p.symbol, weightPct: +(p.weight * 100).toFixed(1), valueUSD: +p.valueUSD.toFixed(0),
        volAnnPct: p.volAnn != null ? +(p.volAnn * 100).toFixed(1) : null, adrPct: p.adr != null ? +p.adr.toFixed(1) : null,
        beta: p.beta != null ? +p.beta.toFixed(2) : null, rcPct: +p.rcPct.toFixed(1),
        momo3mPct: p.momo3m != null ? +(p.momo3m * 100).toFixed(1) : null, momo6mPct: p.momo6m != null ? +(p.momo6m * 100).toFixed(1) : null,
        suggestPct: p.suggestPct != null ? +p.suggestPct.toFixed(1) : null, suggestUSD: p.suggestUSD != null ? +p.suggestUSD.toFixed(0) : null,
        maxRiskUSD: +p.maxRiskUSD.toFixed(0),
      })).sort((a, b) => b.rcPct - a.rcPct),
      correlation: { syms, matrix },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// QM sistem karnesi — taranan kurulumların gerçek sonucu (hedef/stop/açık)
app.get("/api/qm/history", async (_req, res) => {
  try {
    const data = await loadData();
    const hist = Array.isArray(data.qmHistory) ? data.qmHistory : [];
    const samples = [];
    for (const snap of hist) {
      for (const rec of snap.items) {
        samples.push({ symbol: rec.symbol, date: snap.date, qmSetup: rec.qmSetup, score: rec.score,
          ...evaluateOppRecord(rec, snap.date) });
      }
    }
    const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const realized = samples.filter((s) => s.status === "target" || s.status === "stop");
    const openOnes = samples.filter((s) => s.status === "open" && s.ret != null);
    res.json({
      days: hist.length,
      firstDate: hist[0]?.date || null,
      lastDate: hist[hist.length - 1]?.date || null,
      totalPicks: samples.length,
      realized: realized.length ? {
        n: realized.length,
        winRate: Math.round((realized.filter((s) => s.ret > 0).length / realized.length) * 100),
        avgRet: avg(realized.map((s) => s.ret)),
        avgR: avg(realized.map((s) => s.r).filter((v) => v != null)),
        target: samples.filter((s) => s.status === "target").length,
        stop: samples.filter((s) => s.status === "stop").length,
      } : null,
      open: openOnes.length ? { n: openOnes.length, avgRet: avg(openOnes.map((s) => s.ret)) } : null,
      expired: samples.filter((s) => s.status === "expired").length,
      recent: realized.sort((a, b) => (a.exitDate < b.exitDate ? 1 : -1)).slice(0, 15)
        .map((s) => ({ symbol: s.symbol, date: s.date, qmSetup: s.qmSetup, status: s.status, ret: s.ret, r: s.r, exitDate: s.exitDate })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ----- Fırsat backtest: günlük Top-10 anlık görüntüsü + mumlarla sonuç ------
 * "Geçen haftaki Top 10'a uysaydım ne olurdu?" — opp_history.json'a günde bir
 * snapshot yazılır; evaluateOppRecord candleCache'ten (ek API yok) her birinin
 * hedef mi stop mu önce vurduğunu ölçer. Skoru gerçek sonuçla kalibre eder. */
const OPP_HIST_FILE = join(__dirname, "opp_history.json");
let oppHistory = [];
let oppHistDirty = false;
async function loadOppHistory() {
  try { const j = JSON.parse(await readFile(OPP_HIST_FILE, "utf8")); if (Array.isArray(j)) oppHistory = j; } catch {}
}
async function persistOppHistory() {
  if (!oppHistDirty) return;
  oppHistDirty = false;
  try { await writeFile(OPP_HIST_FILE, JSON.stringify(oppHistory), "utf8"); } catch {}
}
function recordOppSnapshot(items) {
  if (signalsRefreshing) return;            // yarım tarama snapshot'ı çarpıtır
  if (!items || items.length < 5) return;
  const today = tdDayKey();
  if (oppHistory.some((s) => s.date === today)) return; // gün başına tek snapshot
  oppHistory.push({
    date: today,
    items: items.slice(0, 10).map((o) => ({
      symbol: o.symbol, setup: o.setup?.type || null, entryType: o.entryType, score: o.score,
      entry: o.entry, stop: o.stop, target: o.target, rr: o.rr ?? null,
    })),
  });
  if (oppHistory.length > 120) oppHistory = oppHistory.slice(-120);
  oppHistDirty = true;
}
/* QM kurulum sonuç takibi — taranan Qullamaggie kurulumlarının gerçek sonucu.
 * data.qmHistory'ye (Supabase-kalıcı, Render diski geçici olduğu için) günde bir
 * snapshot yazılır; evaluateOppRecord ile (QM hep breakout-yönlü: high≥giriş tetikler)
 * her birinin hedef mi stop mu önce vurduğu ölçülür. "Sistem gerçekten çalışıyor mu?" */
function recordQmSnapshot(data, items) {
  if (signalsRefreshing) return false;       // yarım tarama snapshot'ı çarpıtır
  if (!items || items.length < 1) return false;
  const today = tdDayKey();
  data.qmHistory = Array.isArray(data.qmHistory) ? data.qmHistory : [];
  if (data.qmHistory.some((s) => s.date === today)) return false; // gün başına tek snapshot
  data.qmHistory.push({
    date: today,
    items: items.slice(0, 8).map((o) => ({
      symbol: o.symbol, qmSetup: o.setup, stage: o.stage, score: o.score,
      entry: o.entry, stop: o.stop, target: o.rTargets?.r2 ?? null,
      setup: "breakout", entryType: "breakout",   // evaluateOppRecord uyumu (yukarı tetik)
    })),
  });
  if (data.qmHistory.length > 120) data.qmHistory = data.qmHistory.slice(-120);
  return true;
}

// Bir snapshot kaydını sonraki mumlarla değerlendir (ledger mantığının aynısı)
function evaluateOppRecord(rec, snapDate) {
  const candles = candleCache[rec.symbol]?.candles;
  if (!candles?.length) return { status: "unknown", ret: null };
  const risk = rec.entry - rec.stop;
  if (!(risk > 0)) return { status: "invalid", ret: null };
  const after = candles.filter((c) => c.time > snapDate);
  if (!after.length) return { status: "open", ret: null };
  const isBreakout = rec.setup === "breakout";
  let filled = rec.entryType === "now";     // "şimdi al" anında dolar
  let entryDate = filled ? snapDate : null;
  for (let i = 0; i < after.length; i++) {
    const c = after[i];
    if (!filled) {
      const hit = isBreakout ? c.high >= rec.entry : c.low <= rec.entry;
      if (hit) { filled = true; entryDate = c.time; }
      else if (i >= 10) return { status: "expired", ret: null }; // 10 barda tetiklenmedi
      else continue;
    }
    if (c.low <= rec.stop) return { status: "stop", r: (rec.stop - rec.entry) / risk, ret: ((rec.stop - rec.entry) / rec.entry) * 100, exitDate: c.time, entryDate };
    if (c.high >= rec.target) return { status: "target", r: (rec.target - rec.entry) / risk, ret: ((rec.target - rec.entry) / rec.entry) * 100, exitDate: c.time, entryDate };
  }
  if (filled) {
    const last = after[after.length - 1].close;
    return { status: "open", r: (last - rec.entry) / risk, ret: ((last - rec.entry) / rec.entry) * 100, entryDate };
  }
  return { status: "waiting", ret: null };
}

app.get("/api/opportunities/history", async (_req, res) => {
  const samples = [];
  for (const snap of oppHistory) {
    for (const rec of snap.items) {
      samples.push({ symbol: rec.symbol, date: snap.date, setup: rec.setup, score: rec.score, rr: rec.rr, ...evaluateOppRecord(rec, snap.date) });
    }
  }
  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const realized = samples.filter((s) => s.status === "target" || s.status === "stop");
  const openOnes = samples.filter((s) => s.status === "open" && s.ret != null);
  res.json({
    days: oppHistory.length,
    firstDate: oppHistory[0]?.date || null,
    lastDate: oppHistory[oppHistory.length - 1]?.date || null,
    totalPicks: samples.length,
    realized: realized.length ? {
      n: realized.length,
      winRate: Math.round((realized.filter((s) => s.ret > 0).length / realized.length) * 100),
      avgRet: avg(realized.map((s) => s.ret)),
      avgR: avg(realized.map((s) => s.r).filter((v) => v != null)),
      target: samples.filter((s) => s.status === "target").length,
      stop: samples.filter((s) => s.status === "stop").length,
    } : null,
    open: openOnes.length ? { n: openOnes.length, avgRet: avg(openOnes.map((s) => s.ret)) } : null,
    expired: samples.filter((s) => s.status === "expired").length,
    recent: realized.sort((a, b) => (a.exitDate < b.exitDate ? 1 : -1)).slice(0, 15)
      .map((s) => ({ symbol: s.symbol, date: s.date, setup: s.setup, status: s.status, ret: s.ret, r: s.r, exitDate: s.exitDate })),
  });
});

/* ----------------------- API: izleme listesi (watchlist) ----------------------- */
app.post("/api/watchlist", async (req, res) => {
  try {
    const sym = String(req.body?.symbol || "").trim().toUpperCase();
    if (!sym) return res.status(400).json({ error: "symbol gerekli" });
    const d = await loadData();
    d.watchlist = d.watchlist || [];
    if (!d.watchlist.includes(sym)) d.watchlist.push(sym);
    await saveData(d);
    refreshSignals([sym]); // yeni sembolün sinyalini hemen çekmeye başla
    res.json(d.watchlist);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/watchlist/:symbol", async (req, res) => {
  try {
    const sym = String(req.params.symbol || "").toUpperCase();
    const d = await loadData();
    d.watchlist = (d.watchlist || []).filter((s) => String(s).toUpperCase() !== sym);
    await saveData(d);
    res.json(d.watchlist);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* -------- API: Cuma hocanın takip listesi (SABİT 28 hisse) --------
 * Kodda sabit (CUMA_FIXED); swingUniverse'e dahil → setupları Swing & Haftalık'ta
 * "⭐ Cuma" etiketiyle çıkar. Sembol+isim döner; ekleme/silme yok (kürate liste). */
app.get("/api/cuma", (_req, res) => {
  res.json(CUMA_FIXED.map((c) => ({ symbol: c.sym, name: c.name })));
});

/* ------- API: 2026 realize kazançları (broker "beyana tabi" tutarları) ------- */
app.post("/api/realized2026", async (req, res) => {
  try {
    const b = req.body || {};
    const amt = Number(b.amountTRY);
    if (!b.label || !isFinite(amt)) return res.status(400).json({ error: "label ve amountTRY zorunlu" });
    const d = await loadData();
    d.realized2026 = d.realized2026 || [];
    const date = b.date && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : null;
    d.realized2026.push({
      id: "r26-" + Date.now().toString(36),
      symbol: String(b.symbol || b.label).toUpperCase().split(/\s/)[0],
      label: String(b.label), amountTRY: amt,
      date, year: date ? yearOf(date) : (Number(b.year) || new Date().getFullYear()),
      source: "manual",
    });
    await saveData(d);
    res.json(d.realized2026);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Realize kaydı tutarını düzelt (broker yanlış hesaplarsa). Truth kalemi → realized2026Edits; manuel kayıt → kaydı güncelle.
app.put("/api/realized2026/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const amt = Number(req.body?.amountTRY);
    if (!isFinite(amt)) return res.status(400).json({ error: "amountTRY zorunlu" });
    const d = await loadData();
    if (id.startsWith("r26-truth-")) {
      d.realized2026Edits = d.realized2026Edits || {};
      d.realized2026Edits[id] = +amt.toFixed(2);
    } else {
      const rec = (d.realized2026 || []).find((x) => x.id === id);
      if (!rec) return res.status(404).json({ error: "kayıt yok" });
      rec.amountTRY = +amt.toFixed(2);
    }
    await saveData(d);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete("/api/realized2026/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const d = await loadData();
    if (id.startsWith("r26-truth-")) {
      // Truth kalemi silinemez (broker'da var) → varsa düzeltmeyi geri al
      if (d.realized2026Edits) delete d.realized2026Edits[id];
    } else {
      d.realized2026 = (d.realized2026 || []).filter((x) => x.id !== id);
    }
    await saveData(d);
    res.json(d.realized2026 || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// NOT: Realize düzeltmesi artık tek yerden — Vergi paneli (kalem bazlı,
// PUT /api/realized2026/:id). Realize Özeti bu düzeltmelerden türetilen salt-gösterimdir.

/* ----------------------- API: Swing Defteri ----------------------- */
// Açtığın gerçek swing pozisyonları (stop + hedef fiyatlı). Aylık realize
// kazancı 12 ay boyunca hedefe karşı izlenir. Holdings/işlem geçmişinden
// bağımsız, kasıtlı ayrı bir defter — disiplin takibi içindir.
function normalizeSwing(s, id) {
  const num = (v) => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "");
  const today = new Date().toISOString().slice(0, 10);
  const status = s.status === "closed" ? "closed" : "open";
  return {
    id: id || s.id || "sw-" + Date.now().toString(36),
    symbol: String(s.symbol || "").toUpperCase().split(/\s/)[0],
    name: s.name || "",
    entry: num(s.entry) || 0,
    stop: num(s.stop),
    target: num(s.target),
    qty: num(s.qty) || 0,
    openedAt: isDate(s.openedAt) ? s.openedAt : today,
    status,
    exitPrice: status === "closed" ? num(s.exitPrice) : null,
    closedAt: status === "closed" ? (isDate(s.closedAt) ? s.closedAt : today) : null,
    exitUsdtry: status === "closed" ? num(s.exitUsdtry) : null, // kapanış anı USDTRY (TL realize sabit kalsın)
    realizedLots: Array.isArray(s.realizedLots) ? s.realizedLots : [], // kısmi satışlar (ana para çekme)
    note: s.note || "",
  };
}

// Kapanan swing'i ana Realize 2026 defterine (TL) yansıt. Çift kayıt swingId
// ile önlenir; çıkış fiyatı değişirse mevcut kayıt güncellenir. Açığa dönerse
// PUT/DELETE handler'ı bağlı kaydı temizler.
function syncSwingToR26(data, t) {
  data.realized2026 = data.realized2026 || [];
  if (t.status !== "closed" || t.exitPrice == null || !(t.qty > 0) || !t.exitUsdtry) return;
  const amountTRY = +(((t.exitPrice - t.entry) * t.qty - MIDAS_FEE) * t.exitUsdtry).toFixed(2);
  const fields = {
    symbol: t.symbol,
    label: `${+t.qty} adet swing kapanış`,
    date: t.closedAt,
    amountTRY,
    year: yearOf(t.closedAt),
    auto: true,
    swingId: t.id,
  };
  const existing = data.realized2026.find((r) => r.swingId === t.id);
  if (existing) Object.assign(existing, fields);
  else data.realized2026.push({ id: "r26-sw-" + t.id, ...fields });
}

app.get("/api/swing-trades", async (_req, res) => {
  try {
    const data = await loadData();
    const trades = data.swingTrades || [];
    const openSyms = [...new Set(trades.filter((t) => t.status === "open").map((t) => t.symbol).filter(Boolean))];
    const live = {};
    if (openSyms.length) {
      const map = (await safe(fetchStocks(openSyms))) || {};
      for (const sym of openSyms) {
        if (map[sym]) live[sym] = { price: map[sym].price, stale: !!map[sym].stale };
      }
    }
    res.json({ trades, live, goal: data.swingGoal || { min: 600, max: 700 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Aylık geçim hedefi ($ alt/üst) + pozisyon boyutu ayarları (risk sermayesi, işlem başı risk %)
app.put("/api/swing-goal", async (req, res) => {
  try {
    const b = req.body || {};
    const min = Math.max(0, Math.round(Number(b.min) || 0));
    const max = Math.max(min, Math.round(Number(b.max) || 0));
    if (!(max > 0)) return res.status(400).json({ error: "geçerli bir hedef gir" });
    const data = await loadData();
    const prev = data.swingGoal || {};
    const capital = b.capital === "" || b.capital == null ? (prev.capital || 0) : Math.max(0, Number(b.capital) || 0);
    const riskPct = b.riskPct == null || b.riskPct === "" ? (prev.riskPct || 1) : Math.min(10, Math.max(0.1, Number(b.riskPct) || 1));
    data.swingGoal = { min, max, capital, riskPct };
    await saveData(data);
    res.json(data.swingGoal);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/swing-trades", async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.symbol) return res.status(400).json({ error: "sembol zorunlu" });
    const data = await loadData();
    data.swingTrades = data.swingTrades || [];
    // Maliyet (entry) opsiyonel: önce toplam maliyet/adet, sonra eşleşen holding'in
    // ortalama maliyeti (costUSD), o da yoksa hata. "İllâ maliyet yazma" akışı budur.
    let entry = Number(b.entry);
    const qtyN = Number(b.qty) || 0;
    if (!(entry > 0) && Number(b.totalCost) > 0 && qtyN > 0) entry = Number(b.totalCost) / qtyN;
    if (!(entry > 0)) {
      const h = (data.holdings || []).find(
        (x) => x.type === "stock" && String(x.symbol).toUpperCase() === String(b.symbol).toUpperCase());
      if (h && Number(h.costUSD) > 0) entry = Number(h.costUSD);
    }
    if (!(entry > 0)) return res.status(400).json({ error: "giriş maliyeti bulunamadı — fiyat gir ya da portföyde maliyetli bir pozisyon seç" });
    const s = normalizeSwing({ ...b, entry });
    if (s.status === "closed" && s.exitPrice != null) {
      if (!s.exitUsdtry) s.exitUsdtry = await currentUsdTry(data);
      syncSwingToR26(data, s);
    }
    data.swingTrades.push(s);
    await saveData(data);
    res.json(s);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/swing-trades/:id", async (req, res) => {
  try {
    const data = await loadData();
    data.swingTrades = data.swingTrades || [];
    const i = data.swingTrades.findIndex((x) => x.id === req.params.id);
    if (i < 0) return res.status(404).json({ error: "pozisyon bulunamadı" });
    const prev = data.swingTrades[i];
    const t = normalizeSwing({ ...prev, ...req.body }, req.params.id);
    if (t.status === "closed" && t.exitPrice != null) {
      // Yeni kapanış veya çıkış fiyatı değişimi → kapanış kuru gerekiyorsa al, Realize 2026'ya işle
      if (!t.exitUsdtry || prev.exitPrice !== t.exitPrice) t.exitUsdtry = t.exitUsdtry || (await currentUsdTry(data));
      syncSwingToR26(data, t);
    } else {
      // Açığa döndü/kapanış kalktı → bağlı Realize 2026 kaydını temizle
      data.realized2026 = (data.realized2026 || []).filter((r) => r.swingId !== t.id);
    }
    data.swingTrades[i] = t;
    await saveData(data);
    res.json(t);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/swing-trades/:id", async (req, res) => {
  try {
    const data = await loadData();
    const arr = data.swingTrades || [];
    const sw = arr.find((x) => x.id === req.params.id);
    const hasRealized = sw && Array.isArray(sw.realizedLots) && sw.realizedLots.length > 0;
    if (hasRealized) {
      // Kısmi satışla GERÇEKLEŞMİŞ kâr var (ör. ana para çekme). Tamamen silersek bu kâr
      // "bu ayki swing hedefi"nden geriye dönük düşer — yanlış. Bunun yerine "kapanmış
      // (arşiv)" olarak işaretle: realizedLots korunur (hedef sabit kalır), kalan adet ana
      // portföyde (holdings) zaten durur, dokunulmaz. Hayalî pnl olmasın diye qty=0/exit yok.
      sw.status = "closed";
      sw.qty = 0;
      sw.exitPrice = null;
      sw.archived = true;
      sw.closedAt = sw.closedAt || sw.realizedLots[sw.realizedLots.length - 1].date || new Date().toISOString().slice(0, 10);
    } else {
      data.swingTrades = arr.filter((x) => x.id !== req.params.id);
      // Realize edilmiş kâr yoksa bağlı otomatik Realize 2026 kaydını da kaldır
      data.realized2026 = (data.realized2026 || []).filter((r) => r.swingId !== req.params.id);
    }
    await saveData(data);
    res.json(data.swingTrades);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Swing kısmi satış = "ana parayı çek". Gerçek satış olarak işlenir:
// holding adedini düşer + işlem geçmişine yazar + vergiye (realized2026) ekler;
// ayrıca swing'in realizedLots'una eklenip adedi düşürülür (swing getirisine yansır).
// Tez: belirli kâra ulaşınca ana parayı çek, kalan adet sıfır maliyetle binsin.
app.post("/api/swing-trades/:id/sell", async (req, res) => {
  try {
    const data = await loadData();
    const sw = (data.swingTrades || []).find((x) => x.id === req.params.id);
    if (!sw) return res.status(404).json({ error: "pozisyon bulunamadı" });
    const exitPrice = Number(req.body.exitPrice) || 0;
    // Satış YALNIZ bu swing kaydının adediyle sınırlı — uzun vade payına ve diğer swinglere dokunamaz.
    const hPool = (data.holdings || []).find((x) => x.symbol === String(sw.symbol).toUpperCase() && x.type === "stock");
    const sell = Math.min(Number(req.body.shares) || 0, sw.qty, hPool ? hPool.quantity : sw.qty);
    if (!(sell > 0) || !(exitPrice > 0)) return res.status(400).json({ error: "geçerli adet ve çıkış fiyatı gir" });
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || "") ? req.body.date : new Date().toISOString().slice(0, 10);
    let usdtry = await currentUsdTry(data);
    // Gerçek satış işle (holding + işlem geçmişi + vergi). Maliyet = swing girişi. src=swing → ayrı değerlendirilir.
    const { trade, sync } = applyTrade(data, {
      symbol: sw.symbol, kind: "sell", shares: sell, sellUSD: exitPrice, buyUSD: sw.entry,
      date, note: "swing ana para çekme", r26Label: `${+sell.toFixed(4)} adet swing satış`,
      src: "swing", swingId: sw.id,
    }, usdtry);
    // Swing'e realize lot ekle + kalan adedi düş
    sw.realizedLots = sw.realizedLots || [];
    // pnlUSD Midas satış komisyonu ($1.5) düşülmüş NET — swing getirisi gerçek eline geçen
    sw.realizedLots.push({ shares: sell, exitPrice, pnlUSD: +(((exitPrice - sw.entry) * sell) - MIDAS_FEE).toFixed(2), date, tradeId: trade.id, feeUSD: MIDAS_FEE });
    sw.qty = +(sw.qty - sell).toFixed(9);
    if (sw.qty <= 1e-6) { sw.status = "closed"; sw.closedAt = date; sw.exitPrice = exitPrice; }
    await saveData(data);
    res.json({ ok: true, sync, swing: sw, tradeId: trade.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ----------------------- API: opsiyon yönetimi ----------------------- */
// Opsiyon nakit etkisi (tam otomatik nakit modeli — hisse al−/sat+ ile simetrik).
// 1 ABD kontratı = 100 hisse. Açılış: long primi öder (−), short kredi alır (+).
// Kapanış (sil): long güncel değerden tahsil (+), short geri alımla öder (−).
function applyOptionCash(data, o, phase) {
  const contracts = Number(o.contracts) || 0;
  const prem = phase === "open"
    ? (Number(o.premiumPaid) || 0)
    : (o.currentPremium != null ? Number(o.currentPremium) : Number(o.premiumPaid) || 0);
  const amount = prem * contracts * 100;
  if (!(amount > 0)) return;
  const isShort = o.direction === "short";
  // open: long −, short +  |  close: long +, short −
  const sign = phase === "open" ? (isShort ? +1 : -1) : (isShort ? -1 : +1);
  data.cash = data.cash || {};
  data.cash.usd = +(((Number(data.cash.usd) || 0) + sign * amount)).toFixed(2);
}

/* Fiyat alarmları (uygulama-içi; e-posta KALDIRILDI). type: below (≤), above (≥),
 * pct_move (|günlük %| ≥ value). data.alerts'te tutulur (Supabase-kalıcı). */
function normalizeAlert(a, id) {
  const type = ["below", "above", "pct_move"].includes(a.type) ? a.type : "above";
  return {
    id: id || a.id || "al-" + Date.now().toString(36),
    symbol: String(a.symbol || "").toUpperCase().split(/\s/)[0],
    type, value: Number(a.value) || 0,
    note: a.note || "",
    createdAt: a.createdAt || new Date().toISOString().slice(0, 10),
  };
}
function evalAlert(a, q) {
  const price = q?.price ?? null, dc = q?.dayChangePct ?? null;
  let fired = false;
  if (price != null) {
    if (a.type === "below") fired = price <= a.value;
    else if (a.type === "above") fired = price >= a.value;
    else if (a.type === "pct_move") fired = dc != null && Math.abs(dc) >= a.value;
  }
  // "yakın mı" — eşiğe ≤%3 kala (below/above), pct_move için |dc| eşiğin %70'i
  let near = false;
  if (price != null && !fired) {
    if (a.type === "below" && a.value > 0) near = price <= a.value * 1.03;
    else if (a.type === "above" && a.value > 0) near = price >= a.value * 0.97;
    else if (a.type === "pct_move" && dc != null) near = Math.abs(dc) >= a.value * 0.7;
  }
  return { ...a, price, dayChangePct: dc, fired, near };
}

function normalizeOption(o, id) {
  return {
    id: id || o.id || "opt-" + Date.now().toString(36),
    underlying: String(o.underlying || "").toUpperCase(),
    kind: o.kind === "put" ? "put" : "call",
    direction: o.direction === "short" ? "short" : "long",
    strike: Number(o.strike) || 0,
    expiry: o.expiry || "",
    contracts: Number(o.contracts) || 0,
    premiumPaid: Number(o.premiumPaid) || 0,
    currentPremium:
      o.currentPremium == null || o.currentPremium === "" ? null : Number(o.currentPremium),
    note: o.note || "",
  };
}

app.get("/api/alerts", async (_req, res) => {
  try { const data = await loadData(); res.json(data.alerts || []); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/alerts", async (req, res) => {
  try {
    if (!req.body.symbol) return res.status(400).json({ error: "sembol zorunlu" });
    const data = await loadData();
    data.alerts = data.alerts || [];
    const a = normalizeAlert(req.body);
    data.alerts.push(a);
    await saveData(data);
    res.json(a);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete("/api/alerts/:id", async (req, res) => {
  try {
    const data = await loadData();
    data.alerts = (data.alerts || []).filter((x) => x.id !== req.params.id);
    await saveData(data);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ===== Hisse Notları — kişisel, etiketli not defteri (Supabase-kalıcı) =====
 * data.notes[]: { id, symbol, label, text, createdAt, updatedAt }
 * label serbest anahtar; UI sabit bir set gösterir, backend doğrulamaz. */
function normalizeNote(b, id) {
  const now = new Date().toISOString();
  const num = (v) => (v === "" || v == null || Number.isNaN(+v) ? null : +v);
  const symbol = String(b.symbol || "").trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
  return {
    id: id || ("note-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
    symbol,
    label: String(b.label || "genel").trim().slice(0, 24) || "genel",
    text: String(b.text || "").trim().slice(0, 4000),
    // Derin not alanları (hepsi opsiyonel — v1 notlar geriye uyumlu)
    title: String(b.title || "").trim().slice(0, 120),
    targetUSD: num(b.targetUSD),
    stopUSD: num(b.stopUSD),
    conviction: Math.min(5, Math.max(0, Math.round(num(b.conviction) || 0))) || null, // 1-5 güven
    url: String(b.url || "").trim().slice(0, 300),
    pinned: !!b.pinned,
    // Not yazıldığı andaki fiyat — tez sonradan "o gün haklı mıydım?" diye ölçülebilsin
    priceAtUSD: num(b.priceAtUSD) ?? (symbol ? num(lastStocks[symbol]?.price ?? lastStocks[symbol]?.c) : null),
    createdAt: b.createdAt || now,
    updatedAt: now,
  };
}
app.get("/api/notes", async (_req, res) => {
  try { const data = await loadData(); res.json(data.notes || []); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/notes", async (req, res) => {
  try {
    if (!String(req.body?.text || "").trim()) return res.status(400).json({ error: "not metni boş olamaz" });
    const data = await loadData();
    data.notes = data.notes || [];
    const n = normalizeNote(req.body);
    data.notes.unshift(n); // en yeni üstte
    await saveData(data);
    res.json(n);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put("/api/notes/:id", async (req, res) => {
  try {
    const data = await loadData();
    data.notes = data.notes || [];
    const i = data.notes.findIndex((x) => x.id === req.params.id);
    if (i < 0) return res.status(404).json({ error: "not bulunamadı" });
    if (req.body?.text != null && !String(req.body.text).trim()) return res.status(400).json({ error: "not metni boş olamaz" });
    data.notes[i] = normalizeNote({ ...data.notes[i], ...req.body }, req.params.id);
    await saveData(data);
    res.json(data.notes[i]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete("/api/notes/:id", async (req, res) => {
  try {
    const data = await loadData();
    data.notes = (data.notes || []).filter((x) => x.id !== req.params.id);
    await saveData(data);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ===== Claude AI katmanı — tez masası + günlük işlem denetimi ==============
 * ANTHROPIC_API_KEY tanımlı değilse uçlar 503 döner, UI düğmeleri gizler.
 * Yapılandırılmış çıktı: output_config.format (json_schema) → yanıt her zaman
 * şemaya uyan saf JSON. Sonuçlar data'da saklanır (Supabase) → denetim izi +
 * maliyet kontrolü (tez 24 saat, gün denetimi tarihe kilitli önbellek). */
const AI_MODEL = process.env.AI_MODEL || "claude-opus-4-8";
const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;
let _anthropic = null;
const aiClient = () => (_anthropic ||= new Anthropic());

async function askClaude({ system, payload, schema, maxTokens = 16000 }) {
  const r = await aiClient().messages.create({
    model: AI_MODEL,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    system,
    output_config: { format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: JSON.stringify(payload, null, 1) }],
  });
  if (r.stop_reason === "refusal") throw new Error("Claude isteği güvenlik gerekçesiyle reddetti");
  const txt = (r.content || []).find((b) => b.type === "text")?.text || "";
  return { result: JSON.parse(txt), model: r.model, usage: { in: r.usage?.input_tokens, out: r.usage?.output_tokens } };
}
function aiErrMsg(e) {
  if (e?.status === 401) return "Anthropic API anahtarı geçersiz — ANTHROPIC_API_KEY'i kontrol et";
  if (e?.status === 429) return "Claude hız sınırı — birkaç dakika sonra tekrar dene";
  if (e?.status >= 500) return "Claude API geçici olarak yanıt vermiyor — tekrar dene";
  return e?.message || "bilinmeyen hata";
}

const AI_THESIS_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["karar", "guven", "ozet", "boga_tezi", "ayi_tezi", "riskler", "kirmizi_cizgiler", "seviyeler", "kontrol_listesi"],
  properties: {
    karar: { type: "string", enum: ["EKLE", "TUT", "AZALT", "GRI_BOLGE"], description: "Net pozisyon kararı" },
    guven: { type: "integer", description: "0-100 arası güven skoru" },
    ozet: { type: "string", description: "2-3 cümlelik net yönetici özeti" },
    boga_tezi: { type: "array", items: { type: "string" }, description: "Boğa tarafının en güçlü 2-4 argümanı" },
    ayi_tezi: { type: "array", items: { type: "string" }, description: "Ayı tarafının en güçlü 2-4 argümanı" },
    riskler: { type: "array", items: { type: "string" }, description: "Pozisyona özgü somut riskler" },
    kirmizi_cizgiler: { type: "array", items: { type: "string" }, description: "Gerçekleşirse tez çöktü sayılacak ölçülebilir veto koşulları" },
    seviyeler: {
      type: "object", additionalProperties: false, required: ["stop", "hedef", "aciklama"],
      properties: { stop: { type: ["number", "null"] }, hedef: { type: ["number", "null"] }, aciklama: { type: "string" } },
    },
    kontrol_listesi: { type: "array", items: { type: "string" }, description: "Önümüzdeki haftalarda izlenecek somut maddeler" },
  },
};
const AI_THESIS_SYSTEM = `Sen disiplinli bir değer+momentum yatırım analistisin (Buffett/Munger titizliği + Qullamaggie teknik disiplini). Kaan'ın kişisel portföy panosu için TEK BİR pozisyonun yatırım tezini yazacaksın.

Kurallar:
- SADECE sana verilen JSON verisine dayan. Veride olmayan hiçbir sayı, oran veya olay UYDURMA. Bir alan eksikse "veri yok" de.
- Çekişmeli düşün: boğa VE ayı tezini ayrı ayrı, en güçlü halleriyle kur — sonra kararını ver. "Bir yandan... öte yandan..." kaçamağı yok; net karar zorunlu.
- Kaan'ın felsefesi: Kural 1 = önce sermayeyi koru. Kâra geçen pozisyonda ana parayı çekip kârı bedava bindirmek (sıfır-maliyet) tercih edilir. Stopsuz pozisyon tutulmaz.
- kirmizi_cizgiler ölçülebilir olmalı (ör. "fiyat 50 günlük ortalamanın altında haftalık kapanış yaparsa", "bilançoda gelir büyümesi %X altına inerse") — muğlak laf değil.
- seviyeler: stop/hedef için verilen teknik veriden (QM analizi, plan stop, mumlar) mantıklı seviye türet; türetemiyorsan null bırak ve açıklamada söyle.
- Türkçe yaz, kısa ve keskin maddeler kullan. Bu bir bilgilendirmedir, yatırım tavsiyesi değildir — ama lafı dolandırma, işini yap.`;

const AI_DAY_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["genel", "disiplin_notu", "islemler", "yarin_kurali"],
  properties: {
    genel: { type: "string", description: "Günün 2-3 cümlelik dürüst değerlendirmesi" },
    disiplin_notu: { type: "integer", description: "0-100 disiplin puanı (plana sadakat, süreç kalitesi — sonuç değil)" },
    islemler: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["symbol", "karar", "gerekce", "ders"],
        properties: {
          symbol: { type: "string" },
          karar: { type: "string", enum: ["DOGRU", "TARTISMALI", "HATALI"] },
          gerekce: { type: "string", description: "Verilen kanıtlara dayalı kısa gerekçe" },
          ders: { type: "string", description: "Bu işlemden çıkarılacak tek cümlelik ders" },
        },
      },
    },
    yarin_kurali: { type: "string", description: "Yarın için tek cümlelik, uygulanabilir kural" },
  },
};
const AI_DAY_SYSTEM = `Sen acımasız ama adil bir trading koçusun. Kaan'ın gün içi işlemlerini SÜREÇ kalitesine göre denetleyeceksin — sonuca göre değil (kârlı ama plansız işlem HATALI olabilir; zararlı ama disiplinli stop DOGRU'dur).

Kurallar:
- Sana her işlem için panonun kural motorunun ürettiği deterministik bulgular verilir (✅/⚠️/❌ maddeleri). Bunlar kanıttır — değerlendirmeni bunlara ve işlem verisine dayandır, yeni olgu uydurma.
- Kaan'ın sistemi: QM swing disiplini (stop ≤ 1×ADR, rejim kapalıyken yeni giriş yok), Kural 1 (önce sermaye), sıfır-maliyet tezi (kâr alınca ana para çekilir).
- Motorun kararına katılmak zorunda değilsin — ama farklı karar veriyorsan gerekçende hangi kanıta dayandığını söyle.
- ders alanı tekrar eden hatayı kalıba bağlasın; yarin_kurali yarın ekrana yapıştırılabilecek kadar somut olsun.
- Türkçe, kısa, keskin. Yatırım tavsiyesi değil, süreç denetimi.`;

// Pozisyon bağlamını topla — SADECE panonun kendi verisi (uydurma yok)
async function buildThesisContext(data, symbol) {
  const holding = (data.holdings || []).find(
    (h) => h.type === "stock" && String(h.symbol).toUpperCase() === symbol);
  const q = lastStocks[symbol] || {};
  const price = Number(q.price ?? q.c) || null;
  // Portföy ağırlığı (hisse ayağı üzerinden)
  let weightPct = null;
  if (holding) {
    let tot = 0, mine = 0;
    for (const h of data.holdings || []) {
      if (h.type !== "stock") continue;
      const p = Number((lastStocks[String(h.symbol).toUpperCase()] || {}).price) || Number(h.costUSD) || 0;
      const v = p * (Number(h.quantity) || 0);
      tot += v;
      if (h === holding) mine = v;
    }
    if (tot > 0) weightPct = +((mine / tot) * 100).toFixed(1);
  }
  // Teknik: mumlar + QM analizi
  let teknik = null;
  try {
    const candles = await getCandles(symbol, { bg: true });
    if (candles?.length >= 30) {
      const closes = candles.map((c) => +c.c);
      const last = closes.at(-1);
      const ret = (n) => (closes.length > n ? +(((last / closes.at(-1 - n)) - 1) * 100).toFixed(1) : null);
      const hi52 = Math.max(...closes.slice(-252));
      teknik = {
        sonKapanis: last,
        getiri1ayPct: ret(21), getiri3ayPct: ret(63), getiri6ayPct: ret(126),
        zirveyeUzaklikPct: +(((last / hi52) - 1) * 100).toFixed(1),
        qm: qmAnalyze(candles, { price: price || last }),
      };
    }
  } catch {}
  const notes = (data.notes || [])
    .filter((n) => String(n.symbol).toUpperCase() === symbol)
    .slice(0, 8)
    .map((n) => ({ etiket: n.label, tarih: String(n.createdAt || "").slice(0, 10), not: String(n.text).slice(0, 300) }));
  const swing = (data.swingTrades || [])
    .filter((t) => t.status === "open" && String(t.symbol).toUpperCase() === symbol)
    .map((t) => ({ giris: t.entry, stop: t.stop, hedef: t.target, adet: t.qty, acilis: t.openedAt }));
  let haberler = [];
  try { haberler = (await recentNews(symbol)).map((n) => n.headline); } catch {}
  return {
    sembol: symbol,
    tarih: new Date().toISOString().slice(0, 10),
    pozisyon: holding ? {
      adet: Number(holding.quantity) || 0,
      ortalamaMaliyetUSD: Number(holding.costUSD) || null,
      planStop: holding.planStop ?? null,
      planHedef: holding.planTarget ?? null,
      portfoyAgirligiPct: weightPct,
    } : null,
    canliFiyatUSD: price,
    gunlukDegisimPct: Number(q.changePct ?? q.dp) || null,
    teknik,
    yaklasanBilanco: earningsFor(symbol),
    gerceklesmisKarUSD: (() => { // yalnız portföy kuruluşundan (8 Haz) itibaren işlem geçmişi realize'si
      let s = 0;
      for (const tr of data.trades || []) {
        if (tr.kind === "buy" || String(tr.symbol || "").toUpperCase() !== symbol) continue;
        if (tr.date && String(tr.date) < PORTFOLIO_START) continue;
        s += (Number(tr.shares) || 0) * ((Number(tr.sellUSD) || 0) - (Number(tr.buyUSD) || 0));
      }
      for (const t of data.swingTrades || []) {
        if (String(t.symbol || "").toUpperCase() !== symbol) continue;
        for (const lot of t.realizedLots || []) s += Number(lot.pnlUSD) || 0;
      }
      return s ? +s.toFixed(2) : null;
    })(),
    acikSwingPozisyonlari: swing,
    kaaninNotlari: notes,
    sonHaberBasliklari: haberler,
  };
}

app.get("/api/ai/status", (_req, res) => res.json({ enabled: aiEnabled(), model: AI_MODEL }));

app.get("/api/ai/thesis", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "").toUpperCase();
    if (!symbol) return res.status(400).json({ error: "sembol zorunlu" });
    const data = await loadData();
    const rec = (data.aiTheses || {})[symbol];
    if (!rec) return res.status(404).json({ error: "bu sembol için kayıtlı tez yok" });
    res.json({ ...rec, cached: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/ai/thesis", async (req, res) => {
  try {
    if (!aiEnabled()) return res.status(503).json({ error: "ANTHROPIC_API_KEY tanımlı değil — Render/.env ortamına ekle" });
    const symbol = String(req.body?.symbol || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
    if (!symbol) return res.status(400).json({ error: "sembol zorunlu" });
    const data = await loadData();
    data.aiTheses = data.aiTheses || {};
    const cached = data.aiTheses[symbol];
    if (cached && !req.body?.force && Date.now() - new Date(cached.at).getTime() < 24 * 3600_000) {
      return res.json({ ...cached, cached: true });
    }
    const ctx = await buildThesisContext(data, symbol);
    const { result, model, usage } = await askClaude({ system: AI_THESIS_SYSTEM, payload: ctx, schema: AI_THESIS_SCHEMA });
    const rec = { symbol, at: new Date().toISOString(), model, usage, result };
    data.aiTheses[symbol] = rec;
    await saveData(data);
    res.json(rec);
  } catch (e) { res.status(500).json({ error: aiErrMsg(e) }); }
});

app.get("/api/ai/day-review", async (req, res) => {
  try {
    const date = String(req.query.date || "").slice(0, 10);
    if (!date) return res.status(400).json({ error: "tarih zorunlu" });
    const data = await loadData();
    const rec = (data.aiDayReviews || {})[date];
    if (!rec) return res.status(404).json({ error: "bu gün için kayıtlı denetim yok" });
    res.json({ ...rec, cached: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/ai/day-review", async (req, res) => {
  try {
    if (!aiEnabled()) return res.status(503).json({ error: "ANTHROPIC_API_KEY tanımlı değil — Render/.env ortamına ekle" });
    const date = String(req.body?.date || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
    const islemler = Array.isArray(req.body?.islemler) ? req.body.islemler.slice(0, 15) : [];
    if (!islemler.length) return res.status(400).json({ error: "değerlendirilecek işlem yok" });
    const data = await loadData();
    data.aiDayReviews = data.aiDayReviews || {};
    const cached = data.aiDayReviews[date];
    if (cached && !req.body?.force) return res.json({ ...cached, cached: true });
    const payload = {
      tarih: date,
      rejim: req.body?.rejim ?? null,
      gunOzeti: String(req.body?.ozet || "").slice(0, 300),
      islemler: islemler.map((t) => ({
        symbol: String(t.symbol || "").toUpperCase().slice(0, 12),
        tur: t.tur, adet: t.adet, alisUSD: t.alisUSD, satisUSD: t.satisUSD,
        not: String(t.not || "").slice(0, 200),
        kaynak: t.kaynak,
        motorKarari: t.motorKarari,
        motorBulgulari: (Array.isArray(t.bulgular) ? t.bulgular : []).slice(0, 10).map((s) => String(s).slice(0, 250)),
      })),
    };
    const { result, model, usage } = await askClaude({ system: AI_DAY_SYSTEM, payload, schema: AI_DAY_SCHEMA });
    const rec = { date, at: new Date().toISOString(), model, usage, input: payload, result };
    data.aiDayReviews[date] = rec;
    await saveData(data);
    res.json(rec);
  } catch (e) { res.status(500).json({ error: aiErrMsg(e) }); }
});

app.post("/api/options", async (req, res) => {
  try {
    const data = await loadData();
    data.options = data.options || [];
    if (!req.body.underlying) return res.status(400).json({ error: "dayanak (underlying) zorunlu" });
    const o = normalizeOption(req.body);
    data.options.push(o);
    // Nakit: long açılış primi öder (−), short açılış kredi alır (+) — adet × prim × 100
    applyOptionCash(data, o, "open");
    await saveData(data);
    res.json(o);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/options/:id", async (req, res) => {
  try {
    const data = await loadData();
    data.options = data.options || [];
    const i = data.options.findIndex((x) => x.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: "bulunamadı" });
    data.options[i] = normalizeOption({ ...data.options[i], ...req.body }, req.params.id);
    await saveData(data);
    res.json(data.options[i]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/options/:id", async (req, res) => {
  try {
    const data = await loadData();
    const o = (data.options || []).find((x) => x.id === req.params.id);
    data.options = (data.options || []).filter((x) => x.id !== req.params.id);
    // Nakit: kapanış — long pozisyonu güncel değerden tahsil (+), short geri alım (−)
    if (o) applyOptionCash(data, o, "close");
    await saveData(data);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/cash", async (req, res) => {
  try {
    const data = await loadData();
    data.cash = { ...data.cash, ...req.body };
    await saveData(data);
    res.json(data.cash);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ----------------- API: realize edilen hisse işlemleri ---------------- */
// Geriye dönük satış kaydı: satıştan elde edilen realize kâr/zarar takibi
app.get("/api/trades", async (_req, res) => {
  try {
    const data = await loadData();
    res.json(data.trades || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// İşlem (alış/satış) uygula: holding güncelle + işlem geçmişi + satışta realize2026.
// POST /api/trades ve swing kısmi-satış aynı mantığı paylaşsın diye ayrıştırıldı.
// Midas her emirde (alış VE satış) sabit $1.5 komisyon keser. Nakit her iki yönde
// −$1.5 düşer; satış realize'ı (vergi) net gösterilir ($300 satış → $298.5).
const MIDAS_FEE = 1.5;

// Aynı semboldeki AÇIK swing kayıtlarına kilitli toplam adet (satış korumasında kullanılır)
function swingLockedQty(data, sym, excludeId) {
  return (data.swingTrades || [])
    .filter((s) => s.status === "open" && String(s.symbol).toUpperCase() === sym && s.id !== excludeId)
    .reduce((a, s) => a + (Number(s.qty) || 0), 0);
}

function applyTrade(data, t, usdtry) {
  data.trades = data.trades || [];
  data.holdings = data.holdings || [];
  const sym = String(t.symbol).toUpperCase();
  const kind = t.kind === "buy" ? "buy" : "sell";
  const src = t.src === "swing" ? "swing" : "port"; // satış kaynağı: swing akışı mı, normal (uzun vade) mi
  const shares = Number(t.shares) || 0;
  const hIdx = data.holdings.findIndex((x) => x.symbol === sym && x.type === "stock");
  const h = hIdx !== -1 ? data.holdings[hIdx] : null;
  let sync = "";
  let soldShares = kind === "sell" ? shares : 0;
  if (kind === "sell") {
    if (!Number(t.buyUSD) && h?.costUSD) t.buyUSD = h.costUSD; // alış boşsa ort. maliyet
    if (h && h.quantity > 0) {
      const sold = Math.min(shares, h.quantity);
      soldShares = sold;
      const ratio = sold / h.quantity;
      if (h.costTRY != null) h.costTRY = +(h.costTRY * (1 - ratio)).toFixed(2);
      h.quantity = +(h.quantity - sold).toFixed(9);
      // Swing/uzun-vade AYRIMI: başka açık swing'e kilitli adet varken holding'i asla silme —
      // uzun vade payı 0'a inse de swing kayıtları havuzsuz kalmasın (MU vakası).
      const lockedAfter = swingLockedQty(data, sym, t.swingId);
      if (h.quantity <= 1e-6 && lockedAfter <= 1e-6) { data.holdings.splice(hIdx, 1); sync = `${sym} pozisyonu tamamen kapandı, Varlıklar'dan kaldırıldı.`; }
      else if (h.quantity <= 1e-6 && lockedAfter > 1e-6) { sync = `DİKKAT ${sym}: havuz tükendi ama ${+lockedAfter.toFixed(4)} adet hâlâ açık swing'e kilitli — swing kayıtlarını kontrol et.`; }
      else sync = `${sym} adedi ${h.quantity} olarak güncellendi (−${sold}${src === "swing" ? ", swing satışı" : ", uzun vade satışı"}).`;
    }
    // Satış geliri nakde geçer (USD hisse → cash.usd): "satınca para elime geçer"
    // Midas $1.5 komisyonu gelirden düşülür → elime geçen net.
    const proceeds = soldShares * (Number(t.sellUSD) || 0);
    if (proceeds > 0) { data.cash = data.cash || {}; data.cash.usd = +(((Number(data.cash.usd) || 0) + proceeds - MIDAS_FEE)).toFixed(2); }
  } else {
    const px = Number(t.buyUSD) || 0;
    if (h) {
      const oldQty = h.quantity || 0, newQty = oldQty + shares;
      h.costUSD = +(((h.costUSD || 0) * oldQty + px * shares) / newQty).toFixed(4);
      if (usdtry) h.costTRY = +(((h.costTRY || 0) + px * shares * usdtry)).toFixed(2);
      h.quantity = +newQty.toFixed(9);
      sync = `${sym}: adet ${h.quantity}, ort. maliyet $${h.costUSD} olarak güncellendi.`;
    } else {
      data.holdings.push({ id: sym.toLowerCase() + "-" + Date.now().toString(36), symbol: sym, name: t.name || "", type: "stock", quantity: shares, costUSD: px, costTRY: usdtry ? +(px * shares * usdtry).toFixed(2) : null });
      sync = `${sym} Varlıklar'a eklendi (${shares} adet @ $${px}).`;
    }
    // Alış nakitten düşer (tam otomatik nakit): maliyet = adet × alış fiyatı + $1.5 komisyon
    const spend = shares * px;
    if (spend > 0) { data.cash = data.cash || {}; data.cash.usd = +(((Number(data.cash.usd) || 0) - spend - MIDAS_FEE)).toFixed(2); }
  }
  const trade = {
    id: "t-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    kind, symbol: sym, name: t.name || h?.name || "",
    date: t.date || new Date().toISOString().slice(0, 10),
    shares, buyUSD: Number(t.buyUSD) || 0, sellUSD: kind === "sell" ? Number(t.sellUSD) || 0 : 0,
    usdtry: usdtry || null, note: t.note || "",
    src,                 // "swing" | "port" — değerlendirme AYRI yapılır, toplamlara ikisi de dahil
    feeUSD: MIDAS_FEE,   // Midas komisyonu (her emir $1.5) — Vergi'de toplam gösterilir
  };
  data.trades.push(trade);
  // Otomatik realize (vergi): her satış 2026 Realize defterine NET düşer (satış komisyonu çıkar).
  let realizedRec = null;
  if (kind === "sell" && trade.sellUSD > 0 && trade.buyUSD > 0 && soldShares > 0 && usdtry) {
    const amountTRY = +(((trade.sellUSD - trade.buyUSD) * soldShares - MIDAS_FEE) * usdtry).toFixed(2);
    data.realized2026 = data.realized2026 || [];
    realizedRec = { id: "r26-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), symbol: sym, label: t.r26Label || `${soldShares} adet satış`, date: trade.date, amountTRY, year: yearOf(trade.date), auto: true, tradeId: trade.id, feeUSD: MIDAS_FEE };
    data.realized2026.push(realizedRec);
  }
  return { trade, realizedRec, sync, soldShares };
}

app.post("/api/trades", async (req, res) => {
  try {
    const data = await loadData();
    const t = req.body;
    if (!t.symbol) return res.status(400).json({ error: "symbol zorunlu" });
    if (!(Number(t.shares) > 0)) return res.status(400).json({ error: "adet 0'dan büyük olmalı" });
    if (t.kind !== "sell" && !(Number(t.buyUSD) > 0)) return res.status(400).json({ error: "alış fiyatı zorunlu" });
    // Uzun vade satış koruması: açık swing'e KİLİTLİ adetler normal satışla satılamaz.
    // (Swing'i kapatmak istiyorsan Swing sekmesindeki Sat akışını kullan — o kendi kaydını düşer.)
    if (t.kind === "sell" && t.src !== "swing") {
      const sym = String(t.symbol).toUpperCase();
      const h = (data.holdings || []).find((x) => x.symbol === sym && x.type === "stock");
      const locked = swingLockedQty(data, sym);
      const free = Math.max(0, (h?.quantity || 0) - locked);
      if (Number(t.shares) > free + 1e-6) {
        return res.status(400).json({
          error: `${sym}: ${+locked.toFixed(4)} adet açık swing'e kilitli — uzun vadeden satılabilir serbest adet ${+free.toFixed(4)}. Swing payını satmak için Swing sekmesindeki "Sat / Ana Para Çek"i kullan.`,
          lockedQty: +locked.toFixed(4), freeQty: +free.toFixed(4),
        });
      }
    }
    let usdtry = null;
    try { usdtry = Number((await fetchMetals())?.usd?.selling) || null; } catch {}
    if (!usdtry) usdtry = Number((data.snapshots || []).slice(-1)[0]?.usdtry) || null;
    const { trade, realizedRec, sync } = applyTrade(data, t, usdtry);
    await saveData(data);
    res.json({ ...trade, sync, realized: realizedRec });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/trades/:id", async (req, res) => {
  try {
    const data = await loadData();
    data.trades = (data.trades || []).filter((t) => t.id !== req.params.id);
    // Bu işlemden otomatik üretilmiş realize kaydı varsa onu da kaldır.
    data.realized2026 = (data.realized2026 || []).filter((r) => r.tradeId !== req.params.id);
    await saveData(data);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Backfill: İşlem Geçmişi'ndeki satışlardan henüz realize defterine düşmemiş
// olanları (otomatik özellik öncesi kayıtlar dahil) tek seferde ekler.
// tradeId eşleşmesiyle çift kayıt önlenir.
app.post("/api/realized2026/sync-trades", async (_req, res) => {
  try {
    const data = await loadData();
    data.trades = data.trades || [];
    data.realized2026 = data.realized2026 || [];
    const linked = new Set(data.realized2026.map((r) => r.tradeId).filter(Boolean));
    let fxNow = null;
    try { fxNow = Number((await fetchMetals())?.usd?.selling) || null; } catch {}
    const fxFallback = fxNow || Number((data.snapshots || []).slice(-1)[0]?.usdtry) || null;
    let added = 0;
    for (const t of data.trades) {
      if (t.kind !== "sell" || linked.has(t.id)) continue;
      if (!(t.sellUSD > 0 && t.buyUSD > 0 && t.shares > 0)) continue;
      const rate = Number(t.usdtry) || fxFallback;
      if (!rate) continue;
      const amountTRY = +((t.sellUSD - t.buyUSD) * t.shares * rate).toFixed(2);
      data.realized2026.push({
        id: "r26-" + Date.now().toString(36) + "-" + added,
        symbol: t.symbol,
        label: `${+t.shares.toFixed(4)} adet satış`,
        date: t.date,
        amountTRY, year: yearOf(t.date), auto: true, tradeId: t.id,
      });
      added++;
    }
    if (added) await saveData(data);
    res.json({ added, total: data.realized2026.length, realized2026: data.realized2026 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* --------------- API: para giriş/çıkış (sermaye defteri) -------------- */
// Yatırılan/çekilen parayı kaydeder; gerçek getiri (yatırdığın paraya göre)
// hesabı için net sermaye = Σ yatırma − Σ çekme (TL karşılığı, giriş anındaki).
app.get("/api/flows", async (_req, res) => {
  try {
    const data = await loadData();
    res.json(data.flows || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/flows", async (req, res) => {
  try {
    const data = await loadData();
    data.flows = data.flows || [];
    const f = req.body;
    const amount = Number(f.amount) || 0;
    if (!amount) return res.status(400).json({ error: "tutar zorunlu" });
    const currency = ["TL", "USD", "EUR"].includes(f.currency) ? f.currency : "TL";
    const flow = {
      id: "f-" + Date.now().toString(36),
      type: f.type === "withdraw" ? "withdraw" : "deposit",
      date: f.date || new Date().toISOString().slice(0, 10),
      currency,
      amount,
      // Giriş anındaki TL karşılığı (frontend hesaplar; yoksa TL kabul et)
      amountTRY: f.amountTRY != null ? Number(f.amountTRY) : (currency === "TL" ? amount : 0),
      note: f.note || "",
    };
    data.flows.push(flow);
    // Tam otomatik nakit: yatır → nakde ekle, çek → nakitten düş (kendi para birimi kovasına)
    data.cash = data.cash || {};
    const bucket = currency === "USD" ? "usd" : currency === "EUR" ? "eur" : "tl";
    const sign = flow.type === "deposit" ? 1 : -1;
    data.cash[bucket] = +(((Number(data.cash[bucket]) || 0) + sign * amount)).toFixed(2);
    await saveData(data);
    res.json(flow);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/flows/:id", async (req, res) => {
  try {
    const data = await loadData();
    const f = (data.flows || []).find((x) => x.id === req.params.id);
    // Nakit etkisini geri al (yatır silinince nakit düşer, çek silinince geri gelir)
    if (f) {
      data.cash = data.cash || {};
      const bucket = f.currency === "USD" ? "usd" : f.currency === "EUR" ? "eur" : "tl";
      const sign = f.type === "deposit" ? 1 : -1;
      data.cash[bucket] = +(((Number(data.cash[bucket]) || 0) - sign * (Number(f.amount) || 0))).toFixed(2);
    }
    data.flows = (data.flows || []).filter((x) => x.id !== req.params.id);
    await saveData(data);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  Portföy Takip → http://localhost:${PORT}\n`);
});

// Piyasa duygu verisini açılışta ısıt: ilk istekten önce VIX/F&G hazır olsun,
// sonra periyodik tazele (istek yolu zaten asla beklemiyor).
(async () => {
  await Promise.allSettled([refreshVix(), refreshFng()]);
})();
setInterval(() => { refreshVix(); refreshFng(); }, 10 * 60_000).unref?.();

// Gün içi 15dk'lık portföy noktası: sunucu kendi /api/portfolio'unu çağırır
// (geçerli oturum çereziyle) → intraday seyri uygulama açık olmasa da birikir.
// ABD piyasa saatleri civarı (13–22 UTC) yeterli; gece boşuna fiyat çekmeyelim.
setInterval(() => {
  const h = new Date().getUTCHours();
  if (h < 13 || h > 22) return;
  fetch(`http://127.0.0.1:${PORT}/api/portfolio`, { headers: { Cookie: `sid=${signSession()}` } }).catch(() => {});
}, 15 * 60_000).unref?.();

// --- Sinyal motoru: başlangıçta diskten yükle + ilk yenileme + 6 saatlik döngü ---
(async () => {
  try {
    await loadCandleCache(); // grafik mumlarını diskten ısıt → ilk tıkta anında
    await loadNewsCache();   // haftalık fırsat haber nöbeti önbelleği
    await loadLedger();      // sinyal karnesi geçmişi
    await loadOppHistory();  // fırsat backtest geçmişi
    const data = await loadData();
    if (data.signals) Object.assign(signalCache, data.signals);
    const stockSyms = (data.holdings || []).filter((h) => h.type === "stock").map((h) => h.symbol.toUpperCase());
    const watchSyms = (data.watchlist || []).map((s) => String(s).toUpperCase());
    const syms = [...new Set([...stockSyms, ...watchSyms, ...CUMA_SYMBOLS])];
    if (syms.length) {
      maybeRefreshSignals(syms); // yalnızca eksik/bayatsa tara → restart'ta TD kotası boşa yanmaz
      setInterval(() => refreshSignals(syms), SIGNAL_TTL);
    }
  } catch (e) {
    console.error("sinyal motoru başlatılamadı:", e.message);
  }
})();
