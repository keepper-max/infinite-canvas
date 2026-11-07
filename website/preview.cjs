const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const files = { '/': ['index.html', 'text/html'], '/website-assets/20261016-site01/fusion.css': ['fusion.css', 'text/css'], '/website-assets/20261016-site01/brand-logo.png': ['brand-logo.png', 'image/png'], '/website-assets/20261017-site02/content.css':['content.css','text/css'], '/website-assets/20261017-site02/content.js':['content.js','text/javascript'], '/website-assets/20261017-site02/cases/quality-concept-v1.png':['assets/cases/quality-concept-v1.png','image/png'], '/website-assets/20261017-site02/cases/factory-concept-v1.png':['assets/cases/factory-concept-v1.png','image/png'], '/website-assets/20261017-site02/cases/canvas-concept-v1.png':['assets/cases/canvas-concept-v1.png','image/png'] };
files['/website-news/current.js'] = ['content.js', 'text/javascript'];
// Preview-only Hero imagery: deliberately not mapped by production Nginx or publishers.
files['/website-preview/hero-kit/hero.css'] = ['hero-kit.css','text/css; charset=utf-8'];
for(const name of ['hero-desktop-v2.webp','hero-mobile-v2.webp']) files['/website-preview/hero-kit/'+name] = ['assets/hero-validation/'+name,'image/webp'];
// Explicit public whitelist for the new homepage; never expose source or editorial files.
files['/website-assets/brand-v2/brand.css'] = ['brand.css', 'text/css; charset=utf-8'];
files['/website-assets/brand-v2/brand.js'] = ['brand.js', 'application/javascript; charset=utf-8'];
for (const name of ['industries-v1.webp','canvas-concept.webp','quality-concept.webp','factory-concept.webp','canvas-interface.webp','quality-interface.webp','factory-interface.webp','service-enterprise.webp','service-industry.webp','service-agent.webp','service-knowledge.webp']) {
  files['/website-assets/brand-v2/'+name] = ['assets/brand-v2/'+name,'image/webp'];
}
// Versioned P3 production URLs also available in local preview.
files['/website-assets/20261026-site09/brand.css'] = ['brand.css','text/css'];
files['/website-assets/20261026-site09/brand.js'] = ['brand.js','application/javascript'];
files['/website-assets/20261026-site09/hero-kit.css'] = ['hero-kit.css','text/css'];
files['/website-assets/20261026-site09/hero-desktop-v2.webp'] = ['assets/hero-validation/hero-desktop-v2.webp','image/webp'];
files['/website-assets/20261026-site09/hero-mobile-v2.webp'] = ['assets/hero-validation/hero-mobile-v2.webp','image/webp'];
files['/website-assets/20261026-site09/canvas-interface.webp'] = ['assets/brand-v2/canvas-interface.webp','image/webp'];
files['/website-assets/20261026-site09/quality-interface.webp'] = ['assets/brand-v2/quality-interface.webp','image/webp'];
files['/website-assets/20261026-site09/factory-interface.webp'] = ['assets/brand-v2/factory-interface.webp','image/webp'];
files['/website-assets/20261026-site09/service-enterprise.webp'] = ['assets/brand-v2/service-enterprise.webp','image/webp'];
files['/website-assets/20261026-site09/service-industry.webp'] = ['assets/brand-v2/service-industry.webp','image/webp'];
files['/website-assets/20261026-site09/service-agent.webp'] = ['assets/brand-v2/service-agent.webp','image/webp'];
files['/website-assets/20261026-site09/service-knowledge.webp'] = ['assets/brand-v2/service-knowledge.webp','image/webp'];
files['/website-assets/brand-v2/canvas-workspace-v2-2ca46f587804.webp'] = ['assets/brand-v2/canvas-workspace-v2.webp','image/webp'];
const mime={'.svg':'image/svg+xml','.html':'text/html; charset=utf-8','.js':'application/javascript','.mjs':'application/javascript; charset=utf-8','.css':'text/css','.webp':'image/webp','.json':'application/json','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8','.png':'image/png'};
const port=Number(process.env.WEBSITE_PREVIEW_PORT||4405);
const laboratoryFiles = new Set(require('./laboratory/public-files.json'));
const demoFiles = new Set(require('./tools/demo-public-files.json'));
const caseIds=new Set(JSON.parse(fs.readFileSync(path.join(__dirname,'ai-cases/cases.json'),'utf8')).map(item=>item.id));
http.createServer((req,res)=>{
  const route=new URL(req.url,'http://localhost').pathname;
  if (route === '/api/website/ziwei/interpret') {
    res.writeHead(503, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    return res.end(JSON.stringify({error:{code:'ZIWEI_AI_NOT_CONFIGURED',message:'AI 解读尚未配置，请先复制资料到文本工作台'}}));
  }
  let file=files[route];
  if (route === '/laboratory' || route.startsWith('/laboratory/')) {
    const relative=route.slice(1);
    if(laboratoryFiles.has(relative+'/index.html')){
      res.writeHead(302,{Location:route+'/'+new URL(req.url,'http://localhost').search});return res.end();
    }
    const target=relative.endsWith('/')?relative+'index.html':relative;
    if(!laboratoryFiles.has(target)){res.writeHead(404);return res.end('Not found');}
    file=[target, target.endsWith('.zip')?'application/zip':mime[path.extname(target)]||'text/plain; charset=utf-8'];
  }

  if (route === '/demos' || route.startsWith('/demos/')) {
    const relative = route.slice(1);
    if (demoFiles.has(relative + '/index.html')) {
      res.writeHead(302, {Location: route + '/' + new URL(req.url,'http://localhost').search});
      return res.end();
    }
    const target = relative.endsWith('/') ? relative + 'index.html' : relative;
    if (!demoFiles.has(target)) { res.writeHead(404); return res.end('Not found'); }
    file = [target === 'demos/home.js' ? 'brand.js' : target, mime[path.extname(target)] || 'video/mp4'];
  }
  // Standalone Ziwei website tool. Serve only built, explicitly public files.
  if (route === '/ziwei' || route.startsWith('/ziwei/')) {
    if (route === '/ziwei') {res.writeHead(302,{Location:'/ziwei/'+new URL(req.url,'http://localhost').search});return res.end();}
    const allowed = new Set(JSON.parse(fs.readFileSync(path.join(__dirname,'ziwei/public-files.json'),'utf8')));
    const relative = route.slice('/ziwei/'.length) || 'index.html';
    if (!allowed.has(relative)) {res.writeHead(404);return res.end('Not found');}
    file=['ziwei/dist/'+relative, mime[path.extname(relative)] || 'text/plain; charset=utf-8'];
  }
  // Learning pages are static documents; normalize directories without dropping query parameters.
  if(['/learn','/learn/explore','/learn/diagnose'].includes(route)) {
    res.writeHead(302,{Location:route+'/'+new URL(req.url,'http://localhost').search});return res.end();
  }
  const columns={
    '/ai-courses/':{'index.html':'text/html; charset=utf-8','courses.css':'text/css; charset=utf-8'},
    '/reference/ai-repositories/':{'index.html':'text/html; charset=utf-8','library.css':'text/css; charset=utf-8','library.mjs':'application/javascript; charset=utf-8','catalog.json':'application/json; charset=utf-8'}
  };
  for(const [base,allowed] of Object.entries(columns)) {
    if(route===base.slice(0,-1)){res.writeHead(302,{Location:base+new URL(req.url,'http://localhost').search});return res.end()}
    if(route.startsWith(base)){
      const relative=route.slice(base.length)||'index.html';
      if(!Object.hasOwn(allowed,relative)){res.writeHead(404);return res.end('Not found')}
      const headers={'Content-Type':allowed[relative],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'};
      if(base.startsWith('/reference/'))headers['X-Robots-Tag']='noindex, nofollow, noarchive';
      res.writeHead(200,headers);
      return fs.createReadStream(path.join(__dirname,base.slice(1),relative)).pipe(res);
    }
  }
  if(route.startsWith('/learn/')) {
    const relative=route.slice('/learn/'.length);
    if(/^(?:(?:explore|diagnose)\/)?(?:index\.html)?$/.test(relative) || /^(?:about\.html|credits\.html|LICENSE|assets\/(?:[\w.-]+|vendor\/[\w.-]+)|data\/[\w-]+\.json|(?:explore|diagnose)\/[\w.-]+)$/.test(relative)) {
      const target='learn/'+relative+(route.endsWith('/')?'index.html':'');
      file=[target,mime[path.extname(target)]||'text/plain; charset=utf-8'];
    }
  }
  if(route==='/lab/polytech-tree'){res.writeHead(302,{Location:'/lab/polytech-tree/'});return res.end()}
  const demoBase='/lab/polytech-tree/';
  if(route.startsWith(demoBase)){
    const relative=route.slice(demoBase.length)||'index.html';
    if(/^(?:index\.html|LICENSE|LICENSE-data\.md|LICENSE-three\.txt|THIRD-PARTY-NOTICES\.txt|dataset-source\.json|assets\/[A-Za-z0-9_-]+\.(?:js|css))$/.test(relative)) file=['lab/polytech-tree/dist/'+relative,mime[path.extname(relative)]||'text/plain; charset=utf-8'];
  }
  if(route==='/website-assets/polytech-tree/cover-f67e358e16e5.webp')file=['assets/polytech-tree/cover-f67e358e16e5.webp','image/webp'];
  if(route==='/website-assets/polytech-tree/case.css')file=['assets/polytech-tree/case.css','text/css'];
  if(route==='/ai-cases'){res.writeHead(302,{Location:'/ai-cases/'+new URL(req.url,'http://localhost').search});return res.end()}
  if(route.startsWith('/ai-cases/')){
    const relative=route.slice('/ai-cases/'.length);
    if(caseIds.has(relative)){res.writeHead(302,{Location:route+'/'+new URL(req.url,'http://localhost').search});return res.end()}
    if(/^(?:index\.html|cases\.css|cases\.json|present\.mjs|core\.mjs|list\.mjs|detail\.mjs|LICENSE-FDE\.txt)$/.test(relative)) file=['ai-cases/'+relative,mime[path.extname(relative)]];
    else if(!relative)file=['ai-cases/index.html',mime['.html']];
    else if(relative.endsWith('/')&&caseIds.has(relative.slice(0,-1)))file=['ai-cases/'+relative+'index.html',mime['.html']];
    else {res.writeHead(404,{'Content-Type':mime['.html'],'Cache-Control':'no-store'});return fs.createReadStream(path.join(__dirname,'ai-cases/404.html')).pipe(res)}
  }
  if(!file||!fs.existsSync(path.join(__dirname,file[0]))){res.writeHead(404);return res.end('Not found')}
  if (file[1] === 'video/mp4') {
    const filename = path.join(__dirname,file[0]);
    const size = fs.statSync(filename).size;
    const headers = {'Content-Type':'video/mp4','Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff'};
    const range = req.headers.range;
    let start = 0, end = size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match && (match[1] || match[2])) {
        start = match[1] ? Number(match[1]) : Math.max(0,size-Number(match[2]));
        if (match[1] && match[2]) end = Math.min(end,Number(match[2]));
      }
      if (!match || (!match[1] && !match[2]) || start > end || start >= size) {
        res.writeHead(416, {...headers,'Content-Range':'bytes */'+size}); return res.end();
      }
      headers['Content-Range'] = 'bytes '+start+'-'+end+'/'+size;
    }
    res.writeHead(range ? 206 : 200,{...headers,'Content-Length':end-start+1});
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(filename,{start,end});
    res.on('close',()=>stream.destroy());
    return stream.pipe(res);
  }
  res.writeHead(200,{'Content-Type':file[1],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  fs.createReadStream(path.join(__dirname,file[0])).pipe(res);
}).listen(port,'127.0.0.1',()=>console.log('Website release preview: http://127.0.0.1:'+port+'/'));
