// Local-only browser checks. Inquiry responses are intercepted; never sends to production.
const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.resolve(__dirname, '../.impeccable/review');
fs.mkdirSync(output, {recursive:true});
const url = 'http://127.0.0.1:4415/';
(async () => {
  const browser = await chromium.launch({headless:true, channel:'chrome'});
  const report = {viewports:[],checks:[],errors:[]};
  try {
    for (const width of [1440,1024,768,390]) {
      const page = await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
      page.on('pageerror', error => report.errors.push(error.message));
      page.on('response', response => { if(response.status() >= 400) report.errors.push(response.status()+' '+response.url()); });
      await page.goto(url, {waitUntil:'networkidle'});
      // Decode lazy images before a full-page capture; jumping straight to the footer skips them.
      await page.evaluate(async () => { for (const image of document.images) image.loading = 'eager'; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); });
      await page.evaluate(() => window.scrollTo(0,0));
      await page.waitForFunction(() => [...document.images].every(image => image.complete));
      const state = await page.evaluate(() => ({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,h1:document.querySelectorAll('h1').length,projects:document.querySelectorAll('.project-card').length,news:document.querySelectorAll('.news-story').length,brokenImages:[...document.images].filter(image => !image.naturalWidth).map(image=>image.src),badAnchors:[...document.querySelectorAll('a[href^="#"]')].filter(a=>!document.getElementById(a.hash.slice(1))).map(a=>a.hash),threeLoaded:performance.getEntriesByType('resource').some(r=>/three|polytech.*\.js/.test(r.name)),heroHeight:document.querySelector('.hero').getBoundingClientRect().height,bytes:performance.getEntriesByType('resource').reduce((sum,r)=>sum+r.transferSize,0)}));
      assert.equal(state.scrollWidth,width,'Horizontal overflow'); assert.equal(state.h1,1); assert.equal(state.projects,3); assert.equal(state.news,5); assert.deepEqual(state.brokenImages,[]); assert.deepEqual(state.badAnchors,[]); assert.equal(state.threeLoaded,false);
      report.viewports.push(state);
      const name=width===1440?'desktop':width===390?'mobile':'tablet-'+width;
      await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});
      await page.screenshot({path:path.join(output,name+'-hero.png')});
      if ([1440,390].includes(width)) {
        for (const [id,label] of [['product','product'],['projects','projects'],['contact','contact']]) {
          await page.locator('#'+id).screenshot({path:path.join(output,name+'-'+label+'.png')});
        }
      }
      state.type = await page.evaluate(() => Object.fromEntries(['body','h1','h2','h3'].map(selector=>[selector,getComputedStyle(document.querySelector(selector)).fontSize])));
      if(width===390) {
        await page.locator('.menu-toggle').focus(); await page.keyboard.press('Enter');
        assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'),'true');
        await page.keyboard.press('Escape'); assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'),'false');
        await page.locator('.menu-toggle').click(); await page.locator('#primary-nav a[href="#services"]').click(); assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'),'false');
        report.checks.push('Mobile menu Enter/Escape/navigation close');
      }
      await page.locator('.solutions summary').first().click(); assert.equal(await page.locator('.solutions details').first().getAttribute('open'),'');
      await page.locator('.article-card summary').first().click(); assert.ok(await page.locator('.article-body').first().isVisible());
      await page.locator('a[href="#product-details"]').click(); assert.ok(await page.locator('#product-details').getAttribute('open') !== null);
      await page.close();
    }
    const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    await page.goto(url); const sent=[]; let succeed=false;
    await page.route('**/api/website/inquiries', async route=>{ const data=route.request().postDataJSON(); sent.push(data); await route.fulfill({status:succeed?200:503,contentType:'application/json',body:JSON.stringify(succeed?{data:{id:data.id}}:{error:{message:'测试：服务暂不可用，请稍后重试。'}})}); });
    await page.locator('#inquiry-content').fill('测试需求：整理企业资料与人工复核流程'); await page.locator('#inquiry-contact').fill('local-preview@example.com'); await page.locator('[name=consent]').check();
    await page.locator('#inquiry-form button').click(); await page.waitForFunction(()=>document.querySelector('#inquiry-result').dataset.state==='error');
    assert.ok((await page.locator('#inquiry-content').inputValue()).includes('测试需求'));
    succeed=true; await page.locator('#inquiry-form button').click(); await page.waitForFunction(()=>document.querySelector('#inquiry-result').dataset.state==='success');
    assert.equal(sent[0].id,sent[1].id); assert.equal(sent[0].consent,true); assert.equal(await page.locator('#inquiry-content').inputValue(),'');
    report.checks.push('Inquiry failure retains content; retry reuses id; success resets form; all mocked');
    for(const target of ['/learn/','/ai-courses/','/lab/polytech-tree/','/ai-cases/']){ const r=await page.request.get(new URL(target,url).href); assert.equal(r.status(),200); }
    report.checks.push('Existing static page entrypoints return 200 (no production access changes)');
    await page.close();
    const failed=await browser.newPage(); await failed.route('**/website-news/current.js',route=>route.abort()); await failed.goto(url); assert.ok(await failed.locator('#news-list').innerText()); await failed.locator('.menu-toggle').count(); assert.equal(await failed.locator('#inquiry-form').count(),1); await failed.close();
    report.checks.push('Missing content data gives fallback, static product and inquiry remain');
    for(const mode of ['no-javascript','blocked-script']) {
      const context=await browser.newContext({javaScriptEnabled:mode!=='no-javascript'});
      const fallback=await context.newPage(); const requests=[];
      fallback.on('request', request=>requests.push(request.url()));
      if(mode==='blocked-script') await fallback.route('**/brand.js', route=>route.fulfill({status:404,body:'Not found'}));
      await fallback.goto(url);
      assert.equal(await fallback.locator('#inquiry-content').isDisabled(),true);
      assert.equal(await fallback.locator('#inquiry-form button').isDisabled(),true);
      assert.equal(await fallback.locator('#inquiry-form').getAttribute('method'),'post');
      assert.ok(await fallback.locator('#inquiry-availability').isVisible());
      assert.ok(await fallback.locator('.contact-email').isVisible());
      await fallback.locator('#contact').scrollIntoViewIfNeeded();
      await fallback.keyboard.press('Enter');
      assert.equal(fallback.url(),url); assert.ok(!requests.some(request=>/content=|contact=|consent=/.test(request)));
      await fallback.screenshot({path:path.join(output,mode+'.png'),fullPage:true});
      await context.close(); report.checks.push(mode+': fields disabled, no native GET, email fallback visible');
    }
    assert.deepEqual(report.errors,[]);
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
