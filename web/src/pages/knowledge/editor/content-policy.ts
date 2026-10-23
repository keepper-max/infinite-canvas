import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import DOMPurify from "dompurify";
import { marked } from "marked";

type Ast = { type: string; value?: string; children?: Ast[]; [key: string]: unknown };
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml", "toml"]);
const supported = new Set(["root", "paragraph", "heading", "text", "strong", "emphasis", "delete", "inlineCode", "code", "blockquote", "list", "listItem", "link", "image", "thematicBreak", "break", "table", "tableRow", "tableCell"]);

function walk(node: Ast, visit: (node: Ast) => void) {
    visit(node);
    node.children?.forEach((child) => walk(child, visit));
}

export function inspectSource(source: string): string[] {
    const reasons = new Set<string>();
    const tree = parser.parse(source) as Ast;
    walk(tree, (node) => {
        if (!supported.has(node.type)) reasons.add(`未开放富文本转换的语法：${node.type}`);
        if (node.type === "listItem" && node.checked != null) reasons.add("任务列表保留源码");
        if (node.type === "table" && Array.isArray(node.align) && node.align.some(Boolean)) reasons.add("表格对齐属性保留源码");
        if (node.type === "code" && node.meta) reasons.add("代码块扩展属性保留源码");
        if ((node.type === "image" || node.type === "link") && typeof node.url === "string") {
            if (!safeUrl(node.url)) reasons.add("不安全或需单独授权的资源地址");
        }
        if (node.type === "text") {
            const text = node.value || "";
            if (/!\[\[/.test(text)) reasons.add("文档/附件嵌入保留源码");
            if (/\[![^\]]+\]/.test(text)) reasons.add("Obsidian Callout 保留源码");
            if (/(?:^|\s)\^[\w-]+/.test(text) || /\[\[[^\]]*\^/.test(text)) reasons.add("块 ID/块引用保留源码");
            if (/:::|\{%|\{\{|\+\+|==|%%|\$/.test(text)) reasons.add("未知扩展分隔符保留源码");
            const withoutValidLinks = text.replace(/\[\[([^\[\]\n|]+)(?:\|([^\[\]\n|]+))?\]\]/g, "");
            if (/\[\[|\]\]/.test(withoutValidLinks)) reasons.add("未闭合或未知 Wiki Link");
        }
    });
    return [...reasons];
}

export function linkTargets(source: string): string[] {
    const targets = new Set<string>();
    walk(parser.parse(source) as Ast, (node) => {
        if (node.type !== "text") return;
        for (const match of (node.value || "").matchAll(/\[\[([^\[\]\n|]+)(?:\|([^\[\]\n|]+))?\]\]/g)) {
            targets.add(match[1].split("#")[0].replace(/\.md$/i, "").split("/").at(-1) || "");
        }
    });
    return [...targets];
}

// Compare parsed meaning: preserve structure, marks, URLs, image alt/title, list start,
// table alignment and all text. Only parser positions and list formatting trivia are ignored.
export function semanticSignature(source: string): string {
    const tree = parser.parse(source) as Ast;
    function normalize(value: unknown): unknown {
        if (Array.isArray(value)) return value.map(normalize);
        if (!value || typeof value !== "object") return value;
        return Object.fromEntries(
            Object.entries(value)
                .filter(([key]) => !["position", "spread"].includes(key))
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, child]) => [key, normalize(child)]),
        );
    }
    return JSON.stringify(normalize(tree));
}

export function guardRoundTrip(source: string, roundTrip: (source: string) => string) {
    const reasons = inspectSource(source);
    if (reasons.length) return { protected: true, reasons, output: source };
    try {
        const output = roundTrip(source);
        if (semanticSignature(source) !== semanticSignature(output)) {
            return { protected: true, reasons: ["实际往返后的语义树发生变化"], output: source };
        }
        return { protected: false, reasons: [], output };
    } catch (error) {
        return { protected: true, reasons: [`转换失败：${error instanceof Error ? error.message : "未知错误"}`], output: source };
    }
}

export function safeUrl(url: string) {
    // Public web links and relative lab attachments only; no protocol-relative URLs,
    // encoded/whitespace control protocol tricks, data/blob/file, or script protocols.
    const normalized = url.replace(/[\u0000-\u0020\u007f]/g, "");
    if (normalized !== url || url.startsWith("//") || url.includes("\\")) return false;
    return /^https?:\/\//i.test(url) || !/^[a-z][a-z0-9+.-]*:/i.test(url);
}

export function previewHtml(source: string) {
    const html = DOMPurify.sanitize(marked.parse(source, { async: false }), {
        ALLOWED_TAGS: ["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "strong", "em", "del", "blockquote", "pre", "code", "a", "img", "table", "thead", "tbody", "tr", "th", "td", "hr", "br"],
        ALLOWED_ATTR: ["href", "src", "alt", "title", "start", "align"],
        ALLOW_DATA_ATTR: false,
    });
    const fragment = document.createElement("template");
    fragment.innerHTML = html;
    for (const element of fragment.content.querySelectorAll("[href],[src]")) {
        for (const attr of ["href", "src"]) {
            const url = element.getAttribute(attr);
            if (url && !safeUrl(url)) element.removeAttribute(attr);
            // Never auto-fetch external images or arbitrary relative imports in this lab.
            if (attr === "src" && url && url !== "attachments/reference.svg") element.removeAttribute("src");
        }
        if (element.tagName === "A") {
            element.setAttribute("rel", "noopener noreferrer");
        }
    }
    return fragment.innerHTML;
}
