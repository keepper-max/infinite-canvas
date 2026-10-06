#!/usr/bin/env python3
import json, os, subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

def load_key():
    for line in open('/opt/infinite-canvas-global/.env', encoding='utf-8'):
        if line.startswith('TOKEN360_API_KEY='):
            return line.strip().split('=', 1)[1]
    return ''

class Handler(BaseHTTPRequestHandler):
    def do_GET(self): self.forward()
    def do_POST(self): self.forward()
    def do_DELETE(self): self.forward()
    def forward(self):
        path = self.path
        if not path.startswith('/v1/'):
            self.send_error(404); return
        body = self.rfile.read(int(self.headers.get('Content-Length', '0'))) if self.command not in ('GET','HEAD') else None
        try:
            args = ['curl', '-sS', '--noproxy', '*', '--max-time', '180', '-X', self.command,
                    'https://api.token360.ai' + path,
                    '-H', 'Authorization: Bearer ' + load_key(),
                    '-H', 'Content-Type: ' + self.headers.get('Content-Type', 'application/json'),
                    '-H', 'Accept: application/json', '-w', '\n__STATUS__:%{http_code}']
            if body: args += ['--data-binary', '@-']
            result = subprocess.run(args, input=body, capture_output=True, timeout=190)
            raw = result.stdout.decode('utf-8', errors='replace'); marker = raw.rfind('\n__STATUS__:')
            status = int(raw[marker + 12:].strip() or '502') if marker >= 0 else 502
            data = (raw[:marker] if marker >= 0 else raw).encode()
            self.send_response(status); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(data)
        except Exception as e:
            self.send_error(502, str(e))
    def log_message(self, *_): pass

ThreadingHTTPServer(('172.17.0.1', 8787), Handler).serve_forever()
