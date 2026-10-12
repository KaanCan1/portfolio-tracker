# Portföy terminali · 13 Ekim 2026

Sekmeler, hisse grafiği ve giriş ekranı aynı koyu nötr yüzeyleri kullanır. Kenarlar 3–4 px; sayılar eş genişlikli; seçimler mavi, kâr/zarar yeşil/kırmızı, uyarılar amber. Mobil kontroller en az 44 px dokunma alanını korur. İşlem, muhasebe, getiri ve strateji kuralları değişmez.

`public/css/terminal.css` en son yüklenen ortak görsel katmandır. Eski görünümlerde sabit açık zeminler ayrıca bu tokenlara bağlanır. Isı haritası işletim sisteminin tercihine değil, gerçek CSS `color-scheme` değerine bakar. Three.js dağılımı isteğe bağlı kalır; sekme giriş animasyonları yüklenmez.

## Tarayıcı denetimi

Yalnız izole klon/önizleme sunucusu kullanın; gerçek portföy veya canlı DB kullanmayın. Örneğin klonda:

```sh
DATABASE_URL= AUTH_PASSWORD=preview-only PORT=4121 node server.js
```

Ayrı terminalde, Playwright kurulu ortamda:

```sh
TERMINAL_TEST_URL=http://localhost:4121 \
TERMINAL_TEST_PASSWORD=preview-only \
node scripts/terminal-ui-check.mjs
```

İsteğe bağlı `PLAYWRIGHT_MODULE`, `CHROME_EXECUTABLE`, `TERMINAL_TEST_OUTPUT` ortam değişkenleri modül yolunu, Chrome'u ve ekran görüntüsü klasörünü seçer.

Kontrol portföy yanıtını sentetik verilerle değiştirir, kayıt isteğini mock hata yanıtıyla karşılar. Sekmelerin tüm içerikleri 320, 390, 768, 1024 ve 1500 px genişliklerde taşma/açık zemin kalıntısı için incelenir. Form özeti, hatada verinin korunması, Escape/odak dönüşü, para çekme akışı, iki sistem teması, ısı haritası ve giriş ekranı kontrol edilir. Hisse grafik araçları ayrıca `scripts/chart-ui-check.mjs` ile sınanır.
