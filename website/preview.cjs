const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const files = { '/': ['index.html', 'text/html'], '/website-assets/20261016-site01/fusion.css': ['fusion.css', 'text/css'], '/website-assets/20261016-site01/brand-logo.png': ['brand-logo.png', 'image/png'], '/website-assets/20261017-site02/content.css':['content.css','text/css'], '/website-assets/20261017-site02/content.js':['content.js','text/javascript'], '/website-assets/20261017-site02/cases/quality-concept-v1.png':['assets/cases/quality-concept-v1.png','image/png'], '/website-assets/20261017-site02/cases/factory-concept-v1.png':['assets/cases/factory-concept-v1.png','image/png'], '/website-assets/20261017-site02/cases/canvas-concept-v1.png':['assets/cases/canvas-concept-v1.png','image/png'] };
files['/website-news/current.js'] = ['content.js', 'text/javascript'];
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.mjs':'application/javascript; charset=utf-8','.css':'text/css','.webp':'image/webp','.json':'application/json','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8','.png':'image/png'};
const port=Number(process.env.WEBSITE_PREVIEW_PORT||4405);
const caseIds=new Set(JSON.parse(fs.readFileSync(path.join(__dirname,'ai-cases/cases.json'),'utf8')).map(item=>item.id));
http.createServer((req,res)=>{
  const route=new URL(req.url,'http://localhost').pathname;
  let file=files[route];
  // Learning pages are static documents; normalize directories without dropping query parameters.
  if(['/learn','/learn/explore','/learn/diagnose'].includes(route)) {
    res.writeHead(302,{Location:route+'/'+new URL(req.url,'http://localhost').search});return res.end();
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
  res.writeHead(200,{'Content-Type':file[1],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  fs.createReadStream(path.join(__dirname,file[0])).pipe(res);
}).listen(port,'127.0.0.1',()=>console.log('Website release preview: http://127.0.0.1:'+port+'/'));
