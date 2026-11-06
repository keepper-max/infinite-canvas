const fs = require('node:fs');
const path = require('node:path');
const website = path.resolve(__dirname, '..');
const demos = path.join(website, 'demos');
const items = [
  ['region', '区域运营大屏', '旋转四川地图，查看沿边界流动的光线和两侧图表（示例数据）。', '打开大屏', 'product', '/demos/media/region/'],
  ['exploded', '产品结构拆解', '工作台的导航栏、趋势图和示例指标卡沿空间轴分离，再逐层归位。', '播放镜头', 'product'],
  ['assemble', '界面卡片逐步组装', '看一张产品卡从空白骨架开始，依次装入图像、文字和操作区。', '播放镜头', 'product'],
  ['cat', '寻猫雷达', '跟随指挥舱的雷达扫描，看分散的线索逐步汇聚到目标。', '播放样片', 'film'],
  ['farm', '一亩田', '从等轴视角看田块和道路逐步成形，示例数据随场景浮现。', '播放样片', 'film'],
  ['paper', '纸上有戏', '层叠的纸景与皮影人物在舞台上移动，讲述一段剪纸小戏。', '播放样片', 'film'],
  ['intro', '科技发布片头', '镜头掠过发光的屏幕墙，金属质感的示例数字随光线浮现。', '播放样片', 'film'],
  ['breakfast', '中国早餐图鉴', '翻阅像素画里的地方早餐，看看不同城市的清晨吃什么。', '翻阅图鉴', 'learn', '', 16],
  ['attention', 'Transformer 图解', '沿蓝图逐页阅读注意力公式、模型结构与编码过程。', '阅读图解', 'learn', '', 15],
  ['diagnose', '数学薄弱点诊断', '从配方法开始作答，沿先修知识查找需要补习的内容（示例数据）。', '开始诊断', 'learn', '/learn/diagnose/?target=cnm_221&amp;demo=1'],
  ['tree', '人类科技树', '旋转知识网络，点选技术节点查看它的前置知识和后续关联。', '探索科技树', 'learn', '/lab/polytech-tree/'],
  ['sugar', '奶茶里有多少糖', '跟随会动的贴纸，看看一杯奶茶的含糖问题如何讲成动画。', '播放科普', 'learn'],
].map(([id, title, text, action, group, direct, pages]) => ({
  id, title, text, action, group, pages, direct, href: direct || '/demos/' + id + '/',
  cover: id === 'tree' ? '/website-assets/polytech-tree/cover-f67e358e16e5.webp' : '/demos/media/' + id + '/cover.webp'
}));
const groups = {all:'全部', product:'企业与产品', film:'影像与品牌', learn:'教育与知识'};
function card(item, level) {
  return `<article class="demo-card" data-group="${item.group}">
  <div class="demo-cover"><img src="${item.cover}" alt="" width="640" height="360" loading="lazy" decoding="async"></div>
  <div class="demo-copy"><h${level}>${item.title}</h${level}><p>${item.text}</p>
  <a class="demo-action" href="${item.href}" aria-label="${item.action}，${item.title}">${item.action}<span aria-hidden="true">↗</span></a></div></article>`;
}
const logo = '/website-assets/20261016-site01/brand-logo.png';
function page(title, body) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · 守密人科技</title><link rel="icon" href="${logo}">
<link rel="stylesheet" href="/website-assets/20261026-site09/brand.css"><link rel="stylesheet" href="/demos/demos.css"><script defer src="/demos/demos.js"></script></head>
<body class="demo-page"><a class="skip-link" href="#main">跳至主要内容</a>
<header class="demo-nav"><div class="container"><a class="brand" href="/"><img src="${logo}" width="38" height="38" alt=""><span>守密人科技<small>SHOUMIREN TECHNOLOGY</small></span></a><a href="/#demos">返回官网首页 <span aria-hidden="true">↗</span></a></div></header>
<main id="main" class="container demo-main" tabindex="-1">${body}</main></body></html>
`;
}
const grid = `<section aria-label="演示案例" class="demo-grid">${items.map(i=>card(i,2)).join('\n')}</section>`;
const filters = Object.entries(groups).map(([id,label]) => `<a data-filter="${id}" href="${id==='all'?'/demos/':'/demos/?category='+id}">${label}</a>`).join('');
fs.mkdirSync(demos,{recursive:true});
fs.writeFileSync(path.join(demos,'index.html'),page('技术演示',`<div class="demo-title"><h1>技术演示</h1><span>${items.length} 个演示</span></div>
<nav class="demo-filters" aria-label="演示分类">${filters}</nav>${grid}`));
for (const item of items.filter(i=>!i.direct)) {
  const media = '/demos/media/' + item.id + '/';
  const stage = item.pages ? `<div class="slide-reader" data-pages="${item.pages}" data-media="${media}"><a id="slide-full" href="${media}1.webp" target="_blank" rel="noopener" aria-label="查看当前页原图"><img id="slide" width="1280" height="720" src="${media}1.webp" alt="${item.title}，第 1 页"></a><div class="reader-controls"><button id="prev" disabled>← 上一页</button><output id="counter" aria-live="polite">1 / ${item.pages}</output><button id="next">下一页 →</button></div></div>`
    : `<video controls playsinline preload="metadata" poster="${item.cover}" src="${media}clip.mp4" aria-label="${item.title}">浏览器无法播放这段视频。</video>`;
  const dir = path.join(demos,item.id);
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'index.html'),page(item.title,`<a class="demo-return" href="/demos/">← 返回技术演示</a>
  <div class="detail-heading"><h1>${item.title}</h1><p>${item.text}</p></div><div class="demo-stage">${stage}</div>`));
}
const homePath = path.join(website,'index.html');
const current = fs.readFileSync(homePath,'utf8');
const mark = /<!-- demos:start -->[\s\S]*?<!-- demos:end -->/;
if (!mark.test(current)) throw Error('首页缺少技术演示区域');
const featured = ['region','cat','breakfast'].map(id=>card(items.find(i=>i.id===id),3)).join('\n');
const home = current.replace(mark,`<!-- demos:start -->
<section class="section container" id="demos" aria-labelledby="demos-title"><div class="section-heading"><h2 id="demos-title">技术演示</h2><a class="text-link" href="/demos/">查看全部 ${items.length} 个演示 <span aria-hidden="true">→</span></a></div>
<div class="demo-grid">${featured}</div></section>
<!-- demos:end -->`);
if(home!==current) fs.writeFileSync(homePath,home);
// This deployment allowlist deliberately omits source files and maintenance records.
const publicFiles = ['demos/index.html','demos/demos.css','demos/demos.js','demos/home.js'];
for (const item of items) {
  if (item.id !== 'tree') publicFiles.push(item.cover.slice(1));
  if (!item.direct) {
    publicFiles.push('demos/'+item.id+'/index.html');
    const base = 'demos/media/'+item.id+'/';
    if (item.pages) for (let n=1;n<=item.pages;n++) publicFiles.push(base+n+'.webp');
    else publicFiles.push(base+'clip.mp4');
  }
}
const mapBase = 'demos/media/region/';
publicFiles.push(mapBase+'index.html');
for (const name of fs.readdirSync(path.join(website,mapBase,'assets'))) {
  if (/^(?:index-[\w-]+\.(?:css|js)|(?:terrain|normal|elevation)-[\w-]+\.webp)$/.test(name)) publicFiles.push(mapBase+'assets/'+name);
}
fs.writeFileSync(path.join(__dirname,'demo-public-files.json'),JSON.stringify(publicFiles,null,2)+'\n');
for (const file of publicFiles) {
  const source = path.join(website, file === 'demos/home.js' ? 'brand.js' : file);
  if (!fs.statSync(source).size) throw Error('空文件：'+file);
}
// Export only the changed public paths, alongside an existing static site.
// A fresh output directory avoids carrying old files or overwriting a release.
if (process.argv[2]) {
  const output = path.resolve(process.argv[2]);
  fs.mkdirSync(output);
  const copy = (source, target) => {
    const dest = path.join(output,target);
    fs.mkdirSync(path.dirname(dest),{recursive:true});
    fs.copyFileSync(path.join(website,source),dest);
  };
  copy('index.html','index.html');
  for (const file of publicFiles) copy(file === 'demos/home.js' ? 'brand.js' : file,file);
  copy('learn/diagnose/app.js','learn/diagnose/app.js');
  const lab = 'lab/polytech-tree/';
  copy(lab+'dist/index.html',lab+'index.html');
  for (const file of fs.readdirSync(path.join(website,lab,'dist/assets'))) {
    if (/^[\w-]+\.(css|js)$/.test(file)) copy(lab+'dist/assets/'+file,lab+'assets/'+file);
  }
}
console.log('技术演示：生成 '+items.length+' 张展厅卡、3 张首页卡及独立播放和阅读页。');
