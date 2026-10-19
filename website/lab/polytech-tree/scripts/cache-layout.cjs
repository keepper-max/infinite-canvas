// Generated coordinates reuse secwind's MIT layoutTower; knowledge facts remain in dataset/.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), ts = require('typescript');
const root = path.join(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, 'dataset', name + '.json'), 'utf8'));
const techs = read('techs'), eras = read('eras').sort((a,b) => a.order-b.order), categories = read('categories');
const nodes = techs.map(t => ({...t, era:eras.findIndex(e=>e.id===t.era), category:categories.findIndex(c=>c.id===t.category)}));
const signature = JSON.stringify(nodes.map(n => [n.id,n.year,n.era,n.category,n.importance]));
const source = fs.readFileSync(path.join(root,'src/layout.ts'),'utf8');
const sourceHash = crypto.createHash('sha256').update(source.replace(/\r\n/g,'\n')).digest('hex');
const hash = crypto.createHash('sha256').update(signature).digest('hex');
const target = path.join(root,'src/network-layout.json');
if(fs.existsSync(target)){const old=JSON.parse(fs.readFileSync(target,'utf8'));if(old.version===2&&old.hash===hash&&old.layoutSourceHash===sourceHash&&old.positions?.length===nodes.length){console.log('Layout cache unchanged: '+old.positions.length+' real IDs');process.exit(0)}}
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const exportsObject={};
new Function('require','exports',compiled)(name=>{if(name==='three')return require('three');if(name==='./data')return {ERA_COUNT:eras.length,CATEGORY_COUNT:categories.length};throw new Error('Unexpected layout dependency: '+name)},exportsObject);
const result=exportsObject.layoutTower(nodes),round=n=>Math.round(n*1e6)/1e6;
const cache={version:2,hash,layoutSourceHash:sourceHash,towerHeight:result.towerHeight,eraRadii:result.eraRadii.map(round),eraY:result.eraY.map(round),positions:result.placed.map(p=>[p.node.id,...p.position.toArray().map(round),p.scale])};
fs.writeFileSync(target,JSON.stringify(cache)+'\n');
console.log('Cached V1 coordinates: '+cache.positions.length+' real IDs; '+fs.statSync(target).size+' bytes');
