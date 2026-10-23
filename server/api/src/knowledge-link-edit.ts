import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import { knowledgeIndex } from "./knowledge-index.js";
import { DomainError } from "./domain.js";

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml", "toml"]);
type Node = { type: string; value?: string; depth?: number; children?: Node[]; position?: { start: { offset?: number }; end: { offset?: number } } };
export function wikiSourceRanges(source: string) {
    const ranges: { ordinal: number; start: number | null; end: number | null; text: string; target: string }[] = [];
    const visit = (n: Node) => {
        if (n.type === "text") for (const m of (n.value || "").matchAll(/\[\[([^\[\]\n|]+)(?:\|([^\[\]\n|]+))?\]\]/g)) {
            const start = n.position?.start.offset, end = n.position?.end.offset;
            // Escapes/entities can change AST offsets: never guess a destructive edit.
            const exact = start !== undefined && end !== undefined && source.slice(start, end) === n.value;
            ranges.push({ ordinal: ranges.length, target: m[1].trim(), text: m[0], start: exact ? start + m.index! : null, end: exact ? start + m.index! + m[0].length : null });
        }
        n.children?.forEach(visit);
    };
    visit(parser.parse(source) as Node);
    return ranges;
}
export function appendKnowledgeLink(source: string, title: string) {
    if (!title.trim() || /[\[\]|\r\n]/.test(title)) throw new DomainError("KNOWLEDGE_LINK_TITLE_UNSAFE", "目标标题无法安全表示为双向链接，请先调整文档标题", 422);
    const newline = source.includes("\r\n") ? "\r\n" : "\n", root = parser.parse(source) as Node;
    const headings = root.children?.filter(n => n.type === "heading") || [], lastHeading = headings.at(-1);
    const inSection = lastHeading?.depth === 2 && lastHeading.children?.map(n => n.value || "").join("") === "关联知识";
    const addition = `${source && !source.endsWith(newline) ? newline : ""}${source ? newline : ""}${inSection ? "" : "## 关联知识" + newline + newline}- [[${title}]]${newline}`;
    const markdown = source + addition, before = knowledgeIndex(source).links, after = knowledgeIndex(markdown).links;
    if (after.length !== before.length + 1 || after.at(-1)?.target !== title)
        throw new DomainError("KNOWLEDGE_LINK_REQUIRES_EDITOR", "无法安全在文档末尾插入链接，请打开源码编辑定位", 422);
    return { markdown, ordinal: after.length - 1, start: source.length, end: source.length, addition };
}
