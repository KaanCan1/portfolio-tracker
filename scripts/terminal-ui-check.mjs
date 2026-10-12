// 13 Eki 2026: tasarım denetimi yalnız izole sunucuda, sentetik portföyle koşar.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import fs from 'node:fs/promises';import assert from 'node:assert/strict';
if (!process.env.TERMINAL_TEST_PASSWORD) throw new Error('TERMINAL_TEST_PASSWORD gerekli');
const output=process.env.TERMINAL_TEST_OUTPUT || '/tmp/portfolio-terminal-ui';await fs.mkdir(output,{recursive:true});
const url=process.env.TERMINAL_TEST_URL||'http://localhost:4121';
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE ? {executablePath:process.env.CHROME_EXECUTABLE} : {})});
const context=await browser.newContext({viewport:{width:1500,height:1080},colorScheme:'light'});
await context.request.post(url+'/api/login',{data:{password:process.env.TERMINAL_TEST_PASSWORD}});
const history=Array.from({length:60},(_,i)=>({date:new Date(Date.UTC(2026,7,14+i)).toISOString().slice(0,10),total:(6500+i*9+Math.sin(i*1.6)*60+Math.cos(i*.3)*80)*42,usdtry:42}));
const makePeriod = rows => ({ok:true,verified:true,pct:(rows.at(-1).total/rows[0].total-1)*100,start:rows[0].date,end:rows.at(-1).date,flowCount:0,series:rows.map(v=>({date:v.date,pct:(v.total/rows[0].total-1)*100}))});
const periods = Object.fromEntries(Object.entries({day:2,week:7,month:30,quarter:60,half:60,year:60,since:60}).map(([key,count])=>[key,makePeriod(history.slice(-count))]));
const holdings=[['NVDA','NVIDIA',20,140,165],['AAPL','Apple',10,210,224],['MSFT','Microsoft',5,420,436]].map(([symbol,name,quantity,costUSD,priceUSD])=>({id:'demo-'+symbol.toLowerCase(),type:'stock',symbol,name,quantity,costUSD,horizon:'long',live:{priceUSD,prevClose:priceUSD-1.5,marketValueUSD:quantity*priceUSD,marketValueTRY:quantity*priceUSD*42}}));
const total=holdings.reduce((a,h)=>a+h.live.marketValueTRY,0)+600*42;
const fixture={fx:{usdtry:42,eurtry:45,gram:5300},regime:null,fearGreed:null,alerts:[],rule1:{score:85,grade:'B',violations:[]},insights:{items:[],counts:{risk:0,'kar-al':0,firsat:0,denge:0}},topPicks:[],meta:{healthy:true,missingPrices:[],stalePrices:[],staleSignals:[],noSignalYet:[],totals:{grandTRY:total}},performance:periods,holdings,history,options:[],trades:[{id:'demo-sale',symbol:'AAPL',kind:'sell',shares:2,buyUSD:210,sellUSD:224,date:'2026-10-09'}],flows:[],realized2026:[],realizedBySym:{AAPL:28},realizedTruthBySym:{},realizedOptBySym:{},intraday:[],swingOpen:{},swingPositions:[],updatedAt:new Date().toISOString(),cash:{tl:0,usd:600,eur:0}};fixture.performance.unexplained=[];
await context.route('**/api/portfolio',r=>r.fulfill({json:fixture}));
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(url+'/#genel');await page.waitForSelector('.desk-total-card');await page.waitForTimeout(500);
await page.evaluate(()=>{document.querySelector('.desk-eyebrow').textContent='ÖRNEK VERİLER · TASARIM ÖNİZLEMESİ'});
async function audit(label){return page.evaluate(label=>({label,overflow:document.documentElement.scrollWidth>innerWidth,bright:[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();if(r.width<65||r.height<24)return false;const c=getComputedStyle(el).backgroundColor.match(/[\d.]+/g);return c&&c.length>=3&&Number(c[0])>190&&Number(c[1])>190&&Number(c[2])>190&&(!c[3]||Number(c[3])>.7)}).map(el=>({tag:el.tagName,cls:el.className,color:getComputedStyle(el).backgroundColor})).slice(0,20)}),label)}
const audits=[];
for(const view of ['genel','pozisyonlar','swingdefteri','radar','challenge','analiz','notlar','raporlar']){
 await page.evaluate(view=>showView(view),view);await page.waitForTimeout(350);audits.push(await audit(view));await page.screenshot({path:output+'/'+view+'.png'});
}
await page.evaluate(()=>showView('genel'));await page.locator('[data-desk-action=add]').click();await page.waitForTimeout(300);audits.push(await audit('holding'));await page.screenshot({path:output+'/entry.png'});await page.keyboard.press('Escape');
for(const width of [320,390,768,1024]){
 await page.setViewportSize({width,height:844});
 for(const view of ['genel','pozisyonlar','swingdefteri','radar','challenge','analiz','notlar','raporlar']){await page.evaluate(v=>showView(v),view);await page.waitForTimeout(80);audits.push(await audit(view+'-'+width));}
 await page.evaluate(()=>showView('genel'));await page.evaluate(()=>openAdd());await page.waitForTimeout(200);audits.push(await audit('entry-'+width));if(width===390)await page.screenshot({path:output+'/entry-mobile.png'});await page.keyboard.press('Escape');if(width===390)await page.screenshot({path:output+'/mobile.png'});
}
// Form hatasında veri kaybolmamalı; gönderim yalnız mock uçta gözlenir.
await page.setViewportSize({width:1500,height:1000});await page.evaluate(()=>showView('genel'));
await context.route('**/api/holdings',r=>r.fulfill({status:400,json:{error:'Örnek doğrulama hatası'}}));
await page.locator('[data-desk-action=add]').click();await page.locator('#holdingForm [name=symbol]').fill('NVDA');
await page.locator('#holdingForm [name=quantity]').fill('5');await page.locator('#holdingForm [name=costUSD]').fill('140');
assert.match(await page.locator('#holdingPreview').innerText(),/700/);await page.locator('#holdingSaveBtn').click();
await page.waitForSelector('#holdingForm [data-entry-feedback]:not([hidden])');
assert.equal(await page.locator('#holdingForm [name=quantity]').inputValue(),'5');
await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.dataset.deskAction),'add');
await page.locator('[data-desk-action=trade]').click();await page.locator('#tradeForm [name=symbol]').fill('NVDA');
await page.locator('#tradeForm [name=shares]').fill('2');await page.locator('#tradeForm [name=buyUSD]').fill('140');
assert.match(await page.locator('#tfPreview').innerText(),/280/);await page.keyboard.press('Escape');
await page.locator('[data-desk-action=withdraw]').click();assert.equal(await page.locator('#flowForm [name=type]').inputValue(),'withdraw');await page.keyboard.press('Escape');
for(const colorScheme of ['light','dark']) {
 await page.emulateMedia({colorScheme});
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),'dark');
 const neutral=await page.evaluate(()=>heatStyle(null));assert.equal(neutral.bg,'#202836');
}
assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.desk-total-card')).borderTopLeftRadius),'4px');
assert.deepEqual(errors,[]);assert.deepEqual(audits.filter(v=>v.overflow||v.bright.length),[]);
// Giriş görünümü oturumdan bağımsız aynı dili ve klavye erişimini korur.
await page.goto(url+'/login');await page.waitForSelector('#pw');
assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),'dark');
await page.locator('#toggle').click();assert.equal(await page.locator('#pw').getAttribute('type'),'text');
await page.screenshot({path:output+'/login.png'});
console.log(JSON.stringify({passed:true,views:8,widths:[320,390,768,1024,1500],checks:'Taşma, açık renk kalıntıları, iki sistem teması, ısı haritası, kayıt hatasında veri koruma, form özeti, klavye odağı, giriş ekranı',errors,audits},null,2));await browser.close();
