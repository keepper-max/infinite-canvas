// Local homepage QA. No paid generation, authentication or real inquiry submissions.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const phase=process.argv[2]||'after';
const output=path.resolve(__dirname,'../.impeccable/review/p3',phase);
fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const report={phase,viewports:[],errors:[]};
 try{
  for(const width of [1920,1440,1024,768,390]){
   const page=await browser.newPage({viewport:{width,height:width===390?844:1000},reducedMotion:'reduce'});
   page.on('pageerror',e=>report.errors.push(e.message));
   page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text())});
   page.on('response',r=>{if(r.status()>=400)report.errors.push(r.status()+' '+r.url())});
   await page.goto('http://127.0.0.1:4415/',{waitUntil:'networkidle'});
   await page.evaluate(async()=>{for(const img of document.images)img.loading='eager';await Promise.all([...document.images].map(img=>img.decode().catch(()=>{})))});
   const state=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,broken:[...document.images].filter(i=>!i.naturalWidth).map(i=>i.src),badAnchors:[...document.querySelectorAll('a[href^="#"]')].filter(a=>!document.getElementById(a.hash.slice(1))).map(a=>a.hash),projects:document.querySelectorAll('.project-card').length,articles:document.querySelectorAll('.article-card').length,news:document.querySelectorAll('.news-story').length,hero:document.querySelector('.hero-scene img').currentSrc,three:performance.getEntriesByType('resource').some(r=>/three|polytech.*\.js/.test(r.name)),transfer:performance.getEntriesByType('resource').reduce((n,r)=>n+r.transferSize,0),serviceHeights:[...document.querySelectorAll('.solutions article')].map(a=>Math.round(a.getBoundingClientRect().height)),projectHeights:[...document.querySelectorAll('.project-card')].map(a=>Math.round(a.getBoundingClientRect().height))}));
   assert.equal(state.scrollWidth,width);assert.deepEqual(state.broken,[]);assert.deepEqual(state.badAnchors,[]);assert.equal(state.three,false);assert.equal(state.projects,3);assert.equal(state.news,5);
   await page.screenshot({path:path.join(output,width+'-full.png'),fullPage:true});
   // Element captures otherwise duplicate sticky UI inside a tall section in Chromium.
   const captureStyle=await page.addStyleTag({content:'.site-header,.skip-link{visibility:hidden!important}'});
   for(const id of ['home','services','product','projects','insights','ecosystem'])await page.locator('#'+id).screenshot({path:path.join(output,width+'-'+id+'.png')});
   await captureStyle.evaluate(e=>e.remove());
   if(phase==='after'){
    await page.locator('#services details').first().locator('summary').focus();await page.keyboard.press('Enter');assert.ok(await page.locator('#services details').first().evaluate(e=>e.open));
    await page.locator('#product a.primary').focus();assert.ok(await page.locator('#product a.primary').evaluate(e=>e.matches(':focus-visible')));
    if(width<1101){await page.locator('.menu-toggle').click();assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'),'false')}
   }
   report.viewports.push(state);await page.close();
  }
  assert.deepEqual(report.errors,[]);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
