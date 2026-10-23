import { Node, mergeAttributes, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";

const WikiLink = Node.create({
    name: "wikiLink",
    group: "inline",
    inline: true,
    atom: true,
    addAttributes: () => ({ target: { default: "" }, alias: { default: null } }),
    parseHTML: () => [{ tag: "span[data-wiki-link]" }],
    renderHTML: ({ node, HTMLAttributes }) => [
        "span",
        mergeAttributes(HTMLAttributes, {
            "data-wiki-link": node.attrs.target,
            class: "wiki-link",
            title: node.attrs.target,
        }),
        node.attrs.alias || node.attrs.target,
    ],
    markdownTokenizer: {
        name: "wikiLink",
        level: "inline",
        start: (source) => source.indexOf("[["),
        tokenize(source) {
            const match = /^\[\[([^\[\]\n|]+)(?:\|([^\[\]\n|]+))?\]\]/.exec(source);
            if (match) return { type: "wikiLink", raw: match[0], target: match[1], alias: match[2] ?? null };
        },
    },
    parseMarkdown: (token, helpers) => helpers.createNode("wikiLink", { target: token.target, alias: token.alias }),
    renderMarkdown: (node) => `[[${node.attrs?.target}${node.attrs?.alias ? `|${node.attrs.alias}` : ""}]]`,
});

export function editorExtensions(): Extensions {
    return [StarterKit.configure({ link: { openOnClick: false } }), Image, TableKit, WikiLink, Markdown.configure({ indentation: { style: "space", size: 2 } })];
}
