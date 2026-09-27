# Para akışı ve performans sözleşmesi

- **Portföy değeri:** O an elde tutulan varlıklar + portföy içi nakit. Kişisel harcama için çekilen para net değeri azaltır. Değer grafiği bunu gösterir; değer değişimi yatırım getirisi değildir.
- **Dış nakit akışı:** Bankadan portföye yatırılan veya portföyden kişisel kullanıma çekilen para. Kredi kartı ödemesi için çekim buraya girer. Çekim, yatırım zararı veya satış kâr/zararı değildir.
- **İç işlem:** Hisse/fon/altın alımı ve satımı, portföy içi nakit-döviz dönüşümü. Toplam portföyden para çıkmadıkça dış akış kaydı açılmaz. Komisyon, kur ve piyasa hareketi performansta kalır.
- **Performans:** USD bazlı, günlük kapanışlarla yaklaşık zaman ağırlıklı getiri (TWR). Her adımda `(bitiş değeri − dış akış) / başlangıç değeri − 1` hesaplanır; adımlar geometrik bağlanır. USD akışında gerçek USD tutarı, TL/EUR akışında kayıtlı TL karşılığının ilgili kapanış kuruna çevrilmiş tutarı kullanılır. Gün içindeki akış zamanı bilinmediğinden bu, gerçek zamanlı değerleme yapılan kesin TWR değildir.
- **Dönem K/Z:** Dönem sonu USD değeri − dönem başı USD değeri − dönem içindeki net dış akış. Yüzde TWR ile aynı şey değildir; farklı tarihlerde yatırılan para dönem K/Z'sini ve yüzdeyi farklı etkileyebilir.
- **Ölçüm sınırı:** Geriye doldurulmuş eski anlık görüntüler ölçüme alınmaz; başlangıç 1 Haziran 2026'dır. İlk sermaye kaydı tam olmadığı için `bugünkü değer − kayıtlı net yatırma` hiçbir zaman “ömür boyu gerçek kâr” olarak sunulmaz.
- **Eksik kayıt:** Nakit mutabakatında açıklanamayan fark varsa ilgili dönemin yüzdesi güvenilir kabul edilmez ve gizlenir. Sistem farkı otomatik kredi kartı çekimi saymaz; fiyat, işlem tarihi veya başka kayıt hatası da olabilir. Kullanıcı doğruladığı gerçek çekimleri tarih, para birimi ve tutarla kaydeder.
- **Geçmiş akışın bakiyesi:** Eski bir çekim zaten bugünkü nakitte yer alıyorsa `cashApplied=false` olarak kaydedilir. Bu kayıt getiriyi ve mutabakatı düzeltir, mevcut nakdi yeniden azaltmaz. Silindiğinde de nakit geri eklenmez. Yeni çekimde `cashApplied=true` olur ve nakit güncellenir.

Kişisel para hareketlerinin tarih ve tutarları bu açık depoda belgelenmez. Geçmiş akışlar yalnızca erişim denetimli portföy defterine kaydedilir.
