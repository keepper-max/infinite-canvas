import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import { parse } from "yaml";
const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ["yaml", "toml"]);
type Ast = { type: string; value?: string; children?: Ast[] };
export function knowledgeIndex(source: string) {
  const tags = new Set<string>(),
    links: { target: string; alias: string | null }[] = [];
  const visit = (n: Ast) => {
    if (n.type === "yaml") {
      try {
        const data = parse(n.value || "");
        for (const tag of typeof data?.tags === "string"
          ? data.tags.split(/[,\s]+/)
          : Array.isArray(data?.tags)
            ? data.tags
            : [])
          if (typeof tag === "string" && tag.trim())
            tags.add(tag.replace(/^#/, "").trim());
      } catch {
        /* Bad YAML remains authoritative source; no destructive normalization. */
      }
    }
    if (n.type === "text") {
      for (const m of (n.value || "").matchAll(
        /\[\[([^\[\]\n|]+)(?:\|([^\[\]\n|]+))?\]\]/g,
      ))
        links.push({ target: m[1].trim(), alias: m[2] ?? null });
      for (const m of (n.value || "").matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu))
        tags.add(m[1]);
    }
    n.children?.forEach(visit);
  };
  visit(parser.parse(source) as Ast);
  return { tags: [...tags].sort(), links };
}
