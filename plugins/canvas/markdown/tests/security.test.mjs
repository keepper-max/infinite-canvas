import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);

test("Markdown preview blocks active content, keeps legacy rendering and fails closed", async () => {
    const bundle = await build({
        stdin: {
            contents: `import * as renderer from './src/render-markdown';
                import {marked} from 'marked';
                import plugin from './src/index';
                import React from 'react'; import {createRoot} from 'react-dom/client';
                globalThis.InfiniteCanvasRuntime={React};
                globalThis.md={...renderer, marked, plugin, React, createRoot};`,
            resolveDir: root, loader: "tsx",
        },
        alias: {
            react: path.resolve(root, "../../../web/node_modules/react"),
            "react-dom": path.resolve(root, "../../../web/node_modules/react-dom"),
        },
        bundle: true, write: false, format: "iife", platform: "browser",
        jsx: "automatic", jsxImportSource: "@infinite-canvas/plugin-sdk", loader: { ".css": "text" },
        // Test-only failure injection wraps the real sanitizer, leaving its normal path intact.
        plugins: [{ name: "sanitizer-failure-injection", setup(builder) {
            builder.onResolve({filter:/^dompurify$/}, () => ({path:"purify-test-wrapper",namespace:"failure-test"}));
            builder.onLoad({filter:/.*/,namespace:"failure-test"}, () => ({
                contents: `import create from ${JSON.stringify(require.resolve("dompurify"))};
                    export default function(win) { const p=create(win); const sanitize=p.sanitize;
                    p.sanitize=(...args)=>{if(globalThis.failSanitizer)throw new Error('test failure');return sanitize(...args)};return p;}`,
                resolveDir: root,
            }));
        }}],
    });
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
    try {
        const page = await browser.newPage();
        await page.route("**/*", route => route.fulfill({contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHE0AAAAASUVORK5CYII=","base64")}));
        await page.setContent('<base href="https://canvas.test/"><div id="preview"></div><div id="host"></div>');
        await page.addScriptTag({content:bundle.outputFiles[0].text});
        const result = await page.evaluate(async () => {
            const checks=[];
            const check=(name,ok)=>{if(!ok)throw new Error(name);checks.push(name)};
            const until=async(predicate)=>{const deadline=performance.now()+2000;while(!predicate()){if(performance.now()>deadline)throw new Error('React preview did not settle: '+document.querySelector('#host').innerHTML);await new Promise(r=>setTimeout(r,10));}};
            const el=document.querySelector('#preview');
            const legacy='# 标题\n\n**粗体** *斜体* ~~删除~~\n\n> 引用\n\n1. 有序\n2. 列表\n\n- [x] 完成\n\n|姓名|说明|\n|---|---|\n|林岚|你好|\n\n```html\n<img src=x onerror=alert(1)>\n```\n\n[附件](attachments/人物.md) ![图片](images/a.png) [网页](https://example.test) [邮件](mailto:a@example.test)';
            md.renderMarkdown(legacy); // Surface the actual cause if normal rendering fails.
            let previous=md.updateMarkdownPreview(el,legacy,null);
            check('legacy headings/table/code/list/links',!!el.querySelector('h1')&&el.querySelectorAll('td').length===2&&el.querySelector('pre code').textContent.includes('onerror')&&!!el.querySelector('ol')&&decodeURI(el.querySelector('a').getAttribute('href'))==='attachments/人物.md');
            check('task checkboxes remain disabled',el.querySelector('input')?.checked&&el.querySelector('input').disabled);
            const image=el.querySelector('img');
            check('same source preserves DOM and image identity',md.updateMarkdownPreview(el,legacy,previous)===previous&&el.querySelector('img')===image);
            const attacks=[
                '<img src=x onerror="window.attacked=1"><script>window.attacked=1</script>',
                '[点击](javascript:window.attacked=1) <a href="jav&#x61;script:window.attacked=1">x</a>',
                '<a href="java&#10;script:window.attacked=1">x</a><a href="vbscript:msgbox(1)">x</a>',
                '<iframe srcdoc="<script>window.attacked=1</script>"></iframe><object data="data:text/html,x"></object><embed src=x>',
                '<svg><a xlink:href="javascript:window.attacked=1">x</a><g onload="window.attacked=1"></g></svg><math><mtext><img src=x onerror="window.attacked=1"></mtext></math>',
                '<form id=md><input name=renderMarkdown autofocus onfocus="window.attacked=1"></form><img src=x style="position:fixed" onerror="window.attacked=1">',
                '<a href="data:text/html,<script>alert(1)</script>">x</a><img src="data:image/svg+xml,<svg onload=alert(1)>">',
                '<a href="file:///etc/passwd">x</a><a href="custom:run">x</a><a href="blob:https://canvas.test/evil">x</a>',
                '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=window.attacked=1>">',
            ];
            for (const [i,source] of attacks.entries()) {
                const original=source;
                previous=md.updateMarkdownPreview(el,source,previous);
                check(`attack ${i+1} no dangerous tags`,!el.querySelector('script,iframe,object,embed,svg,math,form,style'));
                check(`attack ${i+1} no events/style/clobbering`,[...el.querySelectorAll('*')].every(n=>[...n.attributes].every(a=>!/^on/i.test(a.name)&&!['style','id','name','srcdoc','xlink:href'].includes(a.name))));
                check(`attack ${i+1} no dangerous URLs`,[...el.querySelectorAll('[href],[src]')].every(n=>[...n.attributes].filter(a=>['href','src'].includes(a.name)).every(a=>{const p=new URL(a.value,document.baseURI).protocol;return ['http:','https:','mailto:','tel:'].includes(p)})));
                check(`attack ${i+1} original unchanged`,source===original);
            }
            md.updateMarkdownPreview(el,'![内嵌](data:image/png;base64,AAAA)',null);
            check('raster data image preserved',el.querySelector('img')?.getAttribute('src')?.startsWith('data:image/png;'));
            md.updateMarkdownPreview(el,'<img src="blob:https://canvas.test/local-image">',null);
            check('local blob image preserved',el.querySelector('img')?.getAttribute('src')==='blob:https://canvas.test/local-image');
            const oldParse=md.marked.parse;
            md.marked.parse=()=>{throw new Error('parse failed')};
            check('parser failure is text only',md.updateMarkdownPreview(el,'unique parse failure',null)===null&&el.textContent===md.RENDER_ERROR&&!el.children.length);
            md.marked.parse=oldParse;
            globalThis.failSanitizer=true;
            check('sanitizer failure is text only',md.updateMarkdownPreview(el,'<img onerror=alert(1)>unique sanitizer failure',null)===null&&el.textContent===md.RENDER_ERROR&&!el.children.length);
            globalThis.failSanitizer=false;
            check('failed output was not cached',!!md.updateMarkdownPreview(el,'unique parse failure',null)&&el.textContent.trim()==='unique parse failure');
            const metadata={content:'<img src=x onerror="window.attacked=1">**原文**',editing:false};
            const before=JSON.stringify(metadata);const patches=[];
            const ctx={node:{metadata},theme:{node:{text:'#222',fill:'#fff'}},updateMetadata:p=>patches.push(p)};
            const reactRoot=md.createRoot(document.querySelector('#host'));
            const Content=md.plugin.nodes[0].Content;
            reactRoot.render(md.React.createElement(Content,{ctx}));
            await until(()=>document.querySelector('#host strong'));
            check('real plugin preview sanitized without metadata write',!document.querySelector('#host [onerror]')&&document.querySelector('#host strong')?.textContent==='原文'&&JSON.stringify(metadata)===before&&patches.length===0);
            ctx.node.metadata={...metadata,editing:true};
            reactRoot.render(md.React.createElement(Content,{ctx}));
            await until(()=>document.querySelector('#host textarea'));
            check('edit mode retains original HTML',document.querySelector('#host textarea')?.value===metadata.content);
            reactRoot.unmount();
            await new Promise(r=>setTimeout(r,30));
            check('no payload executed',!globalThis.attacked);
            return checks;
        });
        assert.ok(result.length>=40);
        console.log(JSON.stringify({browser:browser.version(),checks:result},null,2));
    } finally { await browser.close(); }
});
