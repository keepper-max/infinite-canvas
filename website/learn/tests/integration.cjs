/* 栏目构建检查：静态官网无需 Vite/Next 构建，保证完整性及资源闭包。 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { Script } = require('node:vm');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'upstream-integrity.json'), 'utf8'));
for (const [file, expected] of Object.entries(manifest)) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
  assert.equal(actual, expected, file + ' differs from imported upstream');
}
for (const name of ['index.html','about.html','credits.html','explore/index.html','diagnose/index.html']) {
  const html = fs.readFileSync(path.join(root, name), 'utf8');
  for (const [, attrs, code] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!attrs.includes('src=')) new Script(code, { filename: name + ':inline' });
  }
  for (const [, value] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (/^(?:https?:|data:|#)/.test(value)) continue;
    const url = new URL(value.replaceAll('&amp;', '&'), 'https://shoumiren.online/learn/' + name);
    if (url.pathname === '/') continue; // Deliberate return to the official homepage.
    assert(url.pathname.startsWith('/learn/'), name + ': outside learning center: ' + value);
    const file = path.join(root, url.pathname.slice('/learn/'.length));
    assert(fs.existsSync(file), name + ': missing ' + value);
  }
  assert(html.includes('assets/learn.css'), name + ': missing isolated brand stylesheet');
  assert(!/儿童智商|智商测试/.test(html), name + ': promotion remains');
}
const home = fs.readFileSync(path.join(root, '../index.html'), 'utf8');
for (const [, attrs, code] of home.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (!attrs.includes('src=')) new Script(code, { filename: 'website/index.html:inline' });
}
for (const file of ['assets/home.js','assets/learn.js','explore/app.js','diagnose/app.js','diagnose/share.js','diagnose/engine.js','../preview.cjs']) {
  new Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}
assert.equal((home.match(/href="\/learn\/">学习中心/g) || []).length, 2, 'desktop and mobile navigation');
const topics = JSON.parse(fs.readFileSync(path.join(root,'data/topics.json'), 'utf8'));
const questions = JSON.parse(fs.readFileSync(path.join(root,'data/questions.json'), 'utf8'));
assert.equal(topics.length, 1244);
assert.equal(questions.length, 5123);
console.log('PASS: upstream integrity (' + Object.keys(manifest).length + ' files), 1244 topics, 5123 questions, static resources and desktop/mobile navigation');
