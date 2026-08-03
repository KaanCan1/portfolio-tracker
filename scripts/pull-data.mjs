/* pull-data — Supabase'deki canlı portföyü diske çeker (SALT OKUMA).
 *
 *   npm run pull-data           # karşılaştır + yaz
 *   npm run pull-data -- --diff # yalnız karşılaştır, HİÇBİR ŞEY yazma
 *
 * NEDEN VAR: veri app_data.portfolio'da (Supabase) yaşıyor, diskteki
 * portfolio.json yalnız DATABASE_URL yokken kullanılan yerel yedek ve git'te
 * takipli DEĞİL. İkisi sessizce ayrışıyor: 3 Ağu 2026'da diske 13 Haziran'dan
 * kalma bir kopya bindi, fark edilmesi yarım saat sürdü ve az kalsın Swing
 * Defteri + notlar + risk bütçesi "silinmiş" olarak commit'lenecekti.
 *
 * GÜVENLİK KAPISI: kaynaktaki (Supabase) her liste, diskteki halinden KISA
 * olmamalı. Kısaysa yazma yapılmaz — çünkü bu, veri kaybı yönünde bir
 * değişimdir ve sessizce uygulanmamalıdır. Tek muafiyet `intraday`: gün içi
 * tampon, her gün sıfırlanır, kısalması normaldir.
 *
 * Bu betik ASLA yazmaz-tarafa gitmez: yalnız SELECT yapar. Diske yazar. */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KOK = join(__dirname, "..");
const HEDEF = join(KOK, "portfolio.json");
const SADECE_FARK = process.argv.includes("--diff");
const GUNICI_MUAF = new Set(["intraday"]);   // her gün sıfırlanır

const say = (v) => Array.isArray(v) ? v.length : v == null ? null : typeof v === "object" ? Object.keys(v).length : null;
const tip = (v) => Array.isArray(v) ? "liste" : v && typeof v === "object" ? "nesne" : "değer";

async function dbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = await readFile(join(KOK, ".env"), "utf8");
    const m = env.match(/^DATABASE_URL=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch {}
  return "";
}

const url = await dbUrl();
if (!url) {
  console.error("DATABASE_URL yok (ortamda da .env'de de). Supabase bağlantısı olmadan çekilecek bir şey yok.");
  process.exit(1);
}

const pg = (await import("pg")).default;
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });

let uzak, guncelleme;
try {
  const r = await pool.query("SELECT value, updated_at FROM app_data WHERE key='portfolio'");
  if (!r.rows.length) { console.error("app_data'da 'portfolio' anahtarı yok."); process.exit(1); }
  uzak = r.rows[0].value;
  guncelleme = r.rows[0].updated_at;
} catch (e) {
  console.error("Supabase okunamadı:", e.message);
  process.exit(1);
} finally { await pool.end(); }

let yerel = null;
try { yerel = JSON.parse(await readFile(HEDEF, "utf8")); }
catch (e) { if (e.code !== "ENOENT") { console.error("Diskteki portfolio.json okunamadı:", e.message); process.exit(1); } }

console.log(`Supabase son güncelleme: ${guncelleme?.toISOString?.() ?? guncelleme}`);
if (!yerel) console.log("Diskte portfolio.json yok — ilk çekim.\n");

// ── Karşılaştırma ──
const anahtarlar = [...new Set([...Object.keys(uzak), ...Object.keys(yerel || {})])].sort();
const satirlar = [], kisalan = [];
for (const k of anahtarlar) {
  const a = yerel?.[k], b = uzak[k];
  const sa = say(a), sb = say(b);
  const yok = a === undefined ? "diskte yok" : b === undefined ? "SUPABASE'DE YOK" : null;
  if (yok || sa !== sb) satirlar.push(`  ${k.padEnd(20)} disk ${String(sa ?? "—").padStart(5)}  →  supabase ${String(sb ?? "—").padStart(5)}  ${yok ? "(" + yok + ")" : ""}`);
  if (sa != null && sb != null && sb < sa && !GUNICI_MUAF.has(k)) kisalan.push(`${k}: ${sa} → ${sb}`);
  if (b === undefined && a !== undefined) kisalan.push(`${k}: Supabase'de hiç yok (diskte ${tip(a)})`);
}

if (!satirlar.length) console.log("Fark yok — disk zaten Supabase ile aynı.");
else { console.log("Farklar (kayıt sayısı):"); satirlar.forEach((s) => console.log(s)); }

const muaf = anahtarlar.filter((k) => GUNICI_MUAF.has(k) && say(yerel?.[k]) > say(uzak[k]));
if (muaf.length) console.log(`\nBeklenen kısalma (gün içi tampon, yok sayıldı): ${muaf.join(", ")}`);

// ── Güvenlik kapısı ──
if (kisalan.length) {
  console.error("\n❌ YAZILMADI — Supabase diskteki verinin üst kümesi değil:");
  kisalan.forEach((s) => console.error("   " + s));
  console.error("\nBu veri kaybı yönünde bir değişim. Hangisinin doğru olduğuna bakmadan yazma.");
  console.error("İncelemek için: npm run pull-data -- --diff");
  process.exit(1);
}

if (SADECE_FARK) { console.log("\n--diff modu: hiçbir şey yazılmadı."); process.exit(0); }
if (!satirlar.length) process.exit(0);

// server.js'in saveData'sıyla aynı biçim (indent 2) — gereksiz diff gürültüsü olmasın
await writeFile(HEDEF, JSON.stringify(uzak, null, 2), "utf8");
console.log(`\n✅ yazıldı: portfolio.json (${(await readFile(HEDEF, "utf8")).length.toLocaleString("tr-TR")} bayt)`);
