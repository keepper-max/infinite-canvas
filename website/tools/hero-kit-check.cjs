// Local Hero-only visual verification. Never calls generation or submits inquiries.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=path.resolve(__dirname,'../.impeccable/review/hero-kit');
fs.mkdirSync(output,{recursive:true});
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  const report={viewports:[],errors:[],scope:{}};
  try{
    const old=fs.readFileSync('H:/CodexStorage/website-backups/20261026-hero-kit/index.before.html','utf8');
    const now=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
    const split='<section class="section container" id="services"';
    assert.equal(now.slice(now.indexOf(split)),old.slice(old.indexOf(split)),'Everything after Hero must remain byte-identical');
    assert.equal(now.match(/<header[\s\S]*?<\/header>/)[0],old.match(/<header[\s\S]*?<\/header>/)[0]);
    report.scope={afterHero:'byte-identical',navigation:'byte-identical'};
    for(const [width,height] of [[1440,900],[1024,900],[768,900],[390,844]]){
      const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
      page.on('pageerror',error=>report.errors.push(error.message));
      page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text())});
      page.on('response',response=>{if(response.status()>=400)report.errors.push(response.status()+' '+response.url())});
      await page.goto('http://127.0.0.1:4415/',{waitUntil:'networkidle'});
      await page.locator('.hero-scene img').evaluate(image=>image.decode());
      const state=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scene:document.querySelector('.hero-scene img').currentSrc,title:document.querySelector('#hero-title').innerText.replace(/\s/g,''),heroHeight:document.querySelector('#home').getBoundingClientRect().height,capabilities:[...document.querySelectorAll('#home .capability-grid a')].map(a=>({href:a.getAttribute('href'),valid:!!document.querySelector(a.getAttribute('href'))})),buttons:[...document.querySelectorAll('#home .actions a')].map(a=>({text:a.textContent.trim(),href:a.hash,target:!!document.querySelector(a.hash)})),animation:getComputedStyle(document.querySelector('.hero-copy')).animationName,projects:document.querySelectorAll('.project-card').length,academy:document.querySelector('a[href="/ai-courses/"]')?.getAttribute('href'),community:!!document.querySelector('#community'),canvas:document.querySelector('#product a')?.href,heroImages:performance.getEntriesByType('resource').filter(r=>/hero-(desktop|mobile)-v2\.webp/.test(r.name)).map(r=>r.name)}));
      assert.equal(state.width,state.scrollWidth);assert.equal(state.title,'让AI为更多行业创造真实价值');
      assert.equal(state.scene.endsWith(width<=560?'hero-mobile-v2.webp':'hero-desktop-v2.webp'),true);
      assert.equal(state.heroImages.length,1,'Do not fetch both responsive backgrounds');
      assert.equal(state.animation,'none'); assert.equal(state.projects,3); assert.equal(state.community,true);
      assert.ok(state.capabilities.every(a=>a.valid));assert.ok(state.buttons.every(a=>a.target));
      await page.screenshot({path:path.join(output,width+'x'+height+'.png')});
      await page.locator('#home').screenshot({path:path.join(output,width+'-hero.png')});
      await page.locator('#home .primary').focus();assert.ok(await page.locator('#home .primary').evaluate(a=>a.matches(':focus-visible')));
      await page.keyboard.press('Enter');await page.waitForFunction(()=>location.hash==='#services');
      if(width===390){await page.locator('.menu-toggle').click();assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');}
      report.viewports.push(state); await page.close();
    }
    assert.deepEqual(report.errors,[]);
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
