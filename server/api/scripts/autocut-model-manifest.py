"""Create/verify a portable SHA256 manifest of provisioned local model files; never downloads weights."""
import argparse, hashlib, json
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('operation',choices=['create','verify'])
p.add_argument('--manifest',required=True)
for role in ('asr','vad','punctuation'):p.add_argument('--'+role,required=True)
a=p.parse_args();roots={role:Path(getattr(a,role)).resolve(strict=True) for role in ('asr','vad','punctuation')}
def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()
if a.operation=='create':
    models={}
    for role,root in roots.items():
        files=[]
        for path in sorted(root.rglob('*')):
            if not path.is_file():continue
            path.resolve().relative_to(root)
            files.append({'path':path.relative_to(root).as_posix(),'bytes':path.stat().st_size,'sha256':digest(path)})
        if not files or not any(f['path']=='model.pt' for f in files):raise RuntimeError('Required model.pt missing for '+role)
        models[role]={'files':files}
    document={'schemaVersion':1,'scope':'Locally provisioned, separately licensed model bytes; not an upstream revision claim','models':models}
    Path(a.manifest).write_text(json.dumps(document,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
else:
    document=json.loads(Path(a.manifest).read_text(encoding='utf-8'))
    if document.get('schemaVersion')!=1 or set(document.get('models',{}))!=set(roots):raise RuntimeError('Unsupported model manifest')
    for role,root in roots.items():
        records=document['models'][role]['files']
        if not records or len({f['path'] for f in records})!=len(records):raise RuntimeError('Invalid manifest records')
        expected=set()
        for f in records:
            path=(root/f['path']).resolve(strict=True);path.relative_to(root);expected.add(path)
            if path.stat().st_size!=f['bytes'] or digest(path)!=f['sha256']:raise RuntimeError('Model checksum mismatch: '+role+'/'+f['path'])
        actual={path.resolve() for path in root.rglob('*') if path.is_file()}
        if actual!=expected:raise RuntimeError('Model file set changed: '+role)
print(json.dumps({'operation':a.operation,'models':{role:len(document['models'][role]['files']) for role in roots},'verified':a.operation=='verify'}))
