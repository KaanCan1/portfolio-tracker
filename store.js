/* store.js — app_data anahtarları için ortak kalıcılık. Saf: pg/fs bilmez,
 * ikisi de dışarıdan verilir → testler GERÇEK kodu import eder.
 *
 * NEDEN VAR: 13 anahtarın her birinin elle yazılmış load/save çifti vardı ve
 * davranışları sessizce ayrışmıştı — kimi DB-only, kimi dosya yedekli, kimi
 * dosyadan tohumlanıyor, kimi hiç. signal_ledger'ın DB yolu HİÇ YOKTU ve
 * Render'ın geçici diski yüzünden her deploy'da kayıt kaybediyordu (3 Ağu:
 * diskte 102, git'te 90). Tutarsızlık kendi başına bir hata kaynağıydı.
 *
 * KAPSAM DIŞI — portfolio (loadData/saveData) BİLEREK burada değil:
 * dosya bozuksa {} dönmek yerine FIRLATIYOR, çünkü {} dönmek ilk saveData'da
 * bozuk dosyanın üstüne boş veri yazar ve asıl kayıp orada olur. Bu garanti
 * portföye özgü ve taşınamayacak kadar kritik; genel yardımcıya katmak ya
 * garantiyi zayıflatır ya yardımcıyı çarpıtır. Orada kalsın, gerekçesi
 * server.js'te yazılı.
 */

export function depoOlustur({ dbOku, dbYaz, dosyaOku, dosyaYaz, log = console }) {
  if (typeof dbOku !== "function" || typeof dbYaz !== "function") throw new Error("depoOlustur: dbOku/dbYaz zorunlu");
  if (typeof dosyaOku !== "function" || typeof dosyaYaz !== "function") throw new Error("depoOlustur: dosyaOku/dosyaYaz zorunlu");

  /* depo(anahtar, secenekler)
   *   dosya      → DB yokken kullanılacak yerel dosya yolu (yoksa dosya modu devre dışı)
   *   varsayilan → hiçbir yerde kayıt yoksa dönecek değer (her okumada KLONLANIR,
   *                yoksa çağıranlar aynı nesneyi paylaşıp birbirini bozar)
   *   normalize  → okunan ham değeri beklenen şekle sokar (bozuk/eksik kayda karşı)
   *   tohumla    → DB boşsa dosyadaki kaydı DB'ye taşı (tek seferlik geçiş)
   */
  return function depo(anahtar, { dosya = null, varsayilan = null, normalize = null, tohumla = false } = {}) {
    const klon = () => (varsayilan === null || varsayilan === undefined ? varsayilan : JSON.parse(JSON.stringify(varsayilan)));
    const duzelt = (v) => (normalize ? normalize(v) : v);

    return {
      anahtar,

      async oku() {
        const dbVar = await dbOku(anahtar);          // null → kayıt yok ya da DB yok
        if (dbVar !== null && dbVar !== undefined) return duzelt(dbVar);

        let dosyaVeri = null;
        if (dosya) {
          try { dosyaVeri = JSON.parse(await dosyaOku(dosya)); } catch { dosyaVeri = null; }
        }
        if (dosyaVeri === null) return duzelt(klon());

        // DB boş ama dosyada kayıt var → istenmişse DB'ye taşı (bir kez).
        // Kaybı önler: dosya Render'da geçici, DB kalıcı.
        if (tohumla) {
          try {
            await dbYaz(anahtar, dosyaVeri, { yalnizYoksa: true });
            log.log?.(`  ${anahtar}: dosyadan DB'ye tohumlandı`);
          } catch { /* tohumlama başarısızsa okuma yine de çalışsın */ }
        }
        return duzelt(dosyaVeri);
      },

      /* YA DB YA DOSYA — ikisine birden YAZILMAZ. Çift kopya tutmak hangisinin
       * güncel olduğunu belirsizleştiriyor; 3 Ağu'da portfolio.json'da tam
       * bunu yaşadık (13 Haziran'dan kalma dosya canlı verinin üstüne bindi).
       * Sözleşme: dbYaz yazdıysa true döner, DB yoksa false → dosyaya düşülür. */
      async yaz(deger) {
        const yazildi = await dbYaz(anahtar, deger);
        if (yazildi) return "db";
        if (dosya) { await dosyaYaz(dosya, JSON.stringify(deger)); return "dosya"; }
        return "hicbiri";
      },
    };
  };
}
