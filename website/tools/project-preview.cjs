// Local, read-only screenshot fixture. Never proxies a real API or loads .env files.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const roots = {
  4407: 'H:/代码相关/项目/ai智能品控审核系统/frontend/dist',
  4408: 'H:/代码相关/项目/1688/apps/web/out',
};
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2' };
for (const [port, root] of Object.entries(roots)) http.createServer((req,res) => {
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api')) {
    const fixtures = {
      '/api/auth/me': {id:0, username:'项目展示'},
      '/api/dashboard': {active_rules:0,audit_count:0,pending_documents:0,case_memory_count:0,recent_audits:[]},
      '/api/audits/provider/status': {provider:'doubao',is_simulation:false,configured:true},
    };
    res.writeHead(fixtures[url.pathname] ? 200 : 404, {'Content-Type':'application/json'});
    return res.end(JSON.stringify(fixtures[url.pathname] || {detail:'Read-only preview'}));
  }
  let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(path.resolve(root) + path.sep) && file !== path.resolve(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file,'index.html');
  if (!fs.existsSync(file)) file = fs.existsSync(file+'.html') ? file+'.html' : path.join(root,'index.html');
  res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store'});
  fs.createReadStream(file).pipe(res);
}).listen(Number(port),'127.0.0.1',() => console.log('Read-only project preview on '+port));
