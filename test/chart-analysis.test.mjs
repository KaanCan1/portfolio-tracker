// 12 Eki 2026: günlük mumlar gün içi emir/gerçekleşme gibi sunulmasın.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChartCandles, closedChartCandles, chartRelativeStrength, chartVolumeSummary, chartEntryAnalysis } from '../chart-analysis.js';
import '../public/js/15-chart-tools.js';
const tools = globalThis.ChartTools;
const now = new Date('2026-10-12T22:00:00Z');
function candles(last = {}) {
  return Array.from({length:70},(_,i)=>({time:new Date(Date.UTC(2026,7,4+i)).toISOString().slice(0,10),open:96,high:99,low:94,close:97,volume:1000000,...(i===69?last:{})}));
}
const qm = {ok:true,setup:'breakout',stage:'setting-up',entryTrigger:100,stop:90};
const analyze = (extra={})=>chartEntryAnalysis({candles:candles(),qm,atr:3,rsFark:2,now,...extra});
test('mumlar sıralanır, aynı gün tek nokta olur, giriş dizisi değişmez',()=>{
 const input=[candles()[2],candles()[0],{...candles()[2],close:98}];
 const result=normalizeChartCandles(input,now);
 assert.deepEqual(result.candles.map(c=>c.time),[input[1].time,input[0].time]);
 assert.equal(result.duplicates,1);assert.equal(result.candles[1].close,98);assert.equal(input.length,3);
});
test('bozuk OHLC, geçersiz tarih ve gelecekteki mum elenir',()=>{
 const good=candles()[0];
 const result=normalizeChartCandles([good,{...good,high:1},{...good,open:NaN},{...good,time:'2026-02-30'},{...good,time:'2026-10-13'}],now);
 assert.equal(result.candles.length,1);assert.equal(result.rejected,4);
});
test('eksik/negatif hacim fiyat mumu uydurmaz; hacim null olur',()=>{
 assert.equal(normalizeChartCandles([{...candles()[0],volume:-1}],now).candles[0].volume,null);
});
test('mum tarihi ve kapanış NY saatine göre okunur',()=>{
 const c=[{...candles()[0],time:'2026-10-12'}];
 assert.equal(closedChartCandles(c,new Date('2026-10-12T20:02:00Z')).length,0);
 assert.equal(closedChartCandles(c,new Date('2026-10-12T20:06:00Z')).length,1);
 assert.equal(normalizeChartCandles(c,new Date('2026-10-12T01:00:00Z')).rejected,1);
});
test('bekleyen günlük senaryonun risk ve hedefleri aynı geometriden hesaplanır',()=>{
 const a=analyze();assert.equal(a.state,'waiting');assert.equal(a.levels.risk,10);assert.equal(a.levels.target2,120);assert.equal(a.levels.target3,130);assert.equal(a.quality.intradayVerified,false);
});
test('kapanış tetiği geçtiğinde gün içi emir teyidi iddia edilmez',()=>{
 const a=analyze({candles:candles({close:101,high:103,low:95})});
 assert.equal(a.state,'close-confirmed');assert.match(a.evidence,/gün içi tetik.*doğrulanmaz/);
});
test('günlük mumda giriş ve stop birlikte görülürse temas sırası bilinmez',()=>{
 assert.equal(analyze({candles:candles({high:102,low:89,close:101})}).state,'ambiguous');
});
test('tetik teması kapanışın altındaysa giriş teyidi yoktur',()=>{
 assert.equal(analyze({candles:candles({high:102,close:99})}).state,'rejected');
});
test('tetik üstünde bir risk birimi uzaklıkta ilk plan kovalanmaz',()=>{
 assert.equal(analyze({candles:candles({open:111,high:114,low:111,close:112})}).state,'extended');
});
test('stop üstte/eşitse çizilecek giriş planı üretilmez',()=>{
 assert.equal(analyze({qm:{...qm,stop:100}}).levels,null);
 assert.equal(analyze({qm:{...qm,stop:102}}).state,'invalid');
});
test('izleme adayı gerçek kurulum etiketi alamaz',()=>{
 assert.equal(analyze({qm:{...qm,setup:'watch'}}).levels,null);
});
test('grafik QM ile oynaklık ve göreli güç filtreleri atlanamaz',()=>{
 assert.equal(analyze({rsFark:-2}).state,'blocked');
 assert.equal(analyze({atr:12}).state,'blocked');
 assert.equal(analyze({plan:{kapi:{sebep:'Kurulum kapısı'}}}).state,'blocked');
});
test('filtre verisi eksikse kapanış üstü teyit eksik diye etiketlenir',()=>{
 assert.equal(analyze({rsFark:null,candles:candles({high:103,close:101})}).state,'unverified');
});
test('eski/bozuk veri tetik üstünde olsa bile teyit vermez',()=>{
 const old=candles({high:103,close:101}).map(c=>({...c,time:c.time.replace('2026-10','2026-09')}));
 assert.equal(analyze({candles:old}).state,'data-warning');assert.equal(analyze({rejected:1}).state,'data-warning');
});
test('2R öncesi gerçek direnç planın alanını ayrıca sınırlar',()=>{
 const a=analyze({resistance:[105,130]});assert.equal(a.levels.roomR,.5);assert.match(a.reasons.join(' '),/2R hedefinden önce/);
});
test('açık bugünkü mum senaryonun kapanışını veya stop temasını değiştirmez',()=>{
 const c=[...candles().slice(0,-1),{...candles().at(-1),time:'2026-10-12',high:140,low:70,close:120}];
 const a=analyze({candles:c,now:new Date('2026-10-12T15:00:00Z')});
 assert.equal(a.quality.partialBar,true);assert.equal(a.currentPrice,97);assert.equal(a.state,'waiting');
});
test('bozuk localStorage şekli/çizimi grafik açılmasını bozmaz',()=>{
 assert.deepEqual(tools.drawings({bad:true},'2026-10-12'),[]);
 assert.deepEqual(tools.drawings([null,{t:'h',price:-1},{t:'trend',p1:{},p2:{}}],'2026-10-12'),[]);
});
test('ileri çizim çapası yeni mum gelince sağa kaymaz',()=>{
 const item=tools.drawings([{t:'trend',p1:{time:'2026-10-09',price:100},p2:{ext:3,price:110}}],'2026-10-09')[0];
 assert.equal(tools.logical(item.p2,new Map([['2026-10-09',4],['2026-10-12',5]])),7);
 assert.equal(tools.logical(item.p1,new Map([['2026-10-12',0]])),null);
});
test('EMA bulutu kesişimde iki doğru renk parçasına ayrılır',()=>{
 const parts=tools.cloudParts({x:0,fast:105,slow:100},{x:20,fast:95,slow:100});
 assert.equal(parts.length,2);assert.equal(parts[0].bull,true);assert.equal(parts[1].bull,false);assert.equal(parts[0].b.x,10);assert.equal(parts[0].b.fast,parts[0].b.slow);
});
test('örtüşen ve kısmi swing yalnız ek payıyla grafik pozisyonuna katılır',()=>{
 const plan=tools.swingContribution({qty:20,entry:100,valueUSD:2200,sayilanQty:0,sayilanCostUSD:0,sayilanValueUSD:0},20);
 assert.equal(plan.qty,0);assert.equal(plan.cost,0);assert.equal(plan.value,0);
 const extra=tools.swingContribution({qty:30,entry:100,valueUSD:3300,sayilanQty:10,sayilanCostUSD:1000,sayilanValueUSD:1100},20);
 assert.equal(extra.qty,10);assert.equal(extra.cost,1000);assert.equal(extra.value,1100);
 const legacy=tools.swingContribution({qty:30,entry:100,valueUSD:3300},20);
 assert.equal(legacy.qty,10);assert.equal(legacy.value,1100);
});

test('RS aynı kapanış tarihini ve aynı ortak pencereyi kullanır',()=>{
 const own=candles(), benchmark=own.map(bar=>({...bar,open:bar.open*.5,high:bar.high*.5,low:bar.low*.5,close:bar.close*.5}));
 assert.equal(chartRelativeStrength(own,benchmark,now),0);
 assert.equal(chartRelativeStrength(own,benchmark.slice(0,-1),now),null);
 assert.equal(chartRelativeStrength(own,benchmark.slice(-40),now),null);
});

test('otomatik trend çizgisi ters tarih sırasından da doğru zaman serisine dönüşür',()=>{
 assert.deepEqual(tools.trendData({p1:{time:'2026-10-12',value:110},p2:{time:'2026-10-09',value:100}}),[{time:'2026-10-09',value:100},{time:'2026-10-12',value:110}]);
});
test('dejenere, negatif veya sayısal olmayan trend çizgisi çizilmez',()=>{
 assert.deepEqual(tools.trendData({p1:{time:'2026-10-12',value:110},p2:{time:'2026-10-12',value:100}}),[]);
 assert.deepEqual(tools.trendData({p1:{time:'2026-10-09',value:110},p2:{time:'2026-10-12',value:NaN}}),[]);
 assert.deepEqual(tools.trendData({p1:{time:'2026-10-09',value:110},p2:{time:'2026-10-12',value:-10}}),[]);
});

test('son hacim eksikse geçmiş hacim bugünün teyidi sayılmaz',()=>{
 const valid=Array.from({length:20},()=>({volume:100}));
 assert.deepEqual(chartVolumeSummary(valid),{avgVol:100,lastVol:100});
 assert.deepEqual(chartVolumeSummary([...valid.slice(0,-1),{volume:null}]),{avgVol:null,lastVol:null});
 assert.deepEqual(chartVolumeSummary([...valid.slice(0,-1),{volume:0}]),{avgVol:95,lastVol:0});
});
