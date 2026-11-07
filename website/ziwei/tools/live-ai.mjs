// Explicit live smoke: two sponsored model calls, then verify the same IP is blocked.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
const require=createRequire(new URL('../../../plugins/canvas/markdown/package.json',import.meta.url));
const {chromium}=require('playwright');
const output='H:/CodexStorage/ziwei-website-verification/live-ai';
await mkdir(output+'/tmp',{recursive:true});
process.env.TMP=process.env.TEMP=output+'/tmp';
const browser=await chromium.launch({headless:true,executablePath:'H:/CodexStorage/aishenhe-playwright/chromium-1234/chrome-win64/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto('https://shoumiren.online/ziwei/');
  await page.waitForFunction(()=>!document.querySelector('#birth-fields').disabled);
  await page.locator('#birth-date').fill('1990-06-15');
  await page.locator('#birth-time').fill('12:30');
  await page.locator('#birthplace').fill('浏览器测试地点');
  await page.locator('#generate').click();
  await page.getByText('命盘已生成',{exact:true}).waitFor();
  let firstRequest;
  for(let index=0;index<2;index++) {
    const responding=page.waitForResponse(r=>r.url().endsWith('/api/website/ziwei/interpret') && r.request().method()==='POST',{timeout:0});
    await page.locator('#interpret').click();
    const response=await responding;
    const payload=await response.json();
    assert.equal(response.status(),200,JSON.stringify(payload));
    assert.equal(payload.data.model,'deepseek-v4.1-flash-1017');
    assert.equal(payload.data.remainingCalls,1-index);
    assert.ok(payload.data.text.trim().length>0);
    assert.doesNotMatch(JSON.stringify(response.request().postDataJSON()),/浏览器测试地点|1990-06-15|12:30|sk-/);
    if(index===0) {
      firstRequest=response.request().postDataJSON();
      const duplicate=await page.request.post('https://shoumiren.online/api/website/ziwei/interpret',{headers:{Origin:'https://shoumiren.online'},data:firstRequest,timeout:0});
      assert.equal(duplicate.status(),200);
      assert.equal((await duplicate.json()).data.text,payload.data.text);
    }
    await page.locator('#interpretation').waitFor({state:'visible'});
    await writeFile(`${output}/response-${index+1}.json`,JSON.stringify(payload,null,2));
    console.log(`Live call ${index+1}: exact model, ${payload.data.text.length} characters, remaining ${payload.data.remainingCalls}`);
    await page.locator('#save').click();
    await page.getByText(/已保存到本机浏览器/).waitFor();
    await page.reload();
    await page.getByText('已恢复本机保存的出生资料与命盘。',{exact:true}).waitFor();
    assert.equal(await page.locator('#interpretation').innerText(),payload.data.text);
  }
  await page.setExtraHTTPHeaders({'X-Forwarded-For':'8.8.8.8','X-Real-IP':'8.8.4.4','CF-Connecting-IP':'1.1.1.1'});
  const limited=page.waitForResponse(r=>r.url().endsWith('/api/website/ziwei/interpret') && r.request().method()==='POST');
  await page.locator('#interpret').click();
  const response=await limited;
  assert.equal(response.status(),429);
  assert.equal((await response.json()).error.code,'ZIWEI_RATE_LIMITED');
  assert.ok(Number(response.headers()['retry-after'])>0);
  await page.locator('#interpretation-status').getByText(/最多解读 2 次/).waitFor();
  await page.screenshot({path:output+'/desktop.png',fullPage:true});
  assert.equal(new URL(page.url()).pathname,'/ziwei/');
  assert.equal(await page.locator('a[href*="canvas.shoumiren.online"]').count(),0);
  assert.equal(errors.length,0);
  console.log('PASS live: in-page DS 1017 twice, duplicate cached, save/reload text restored, third call blocked even with forged IP headers. No canvas redirect.');
} finally {await writeFile(output+'/diagnostics.json',JSON.stringify({errors}));await browser.close();}
