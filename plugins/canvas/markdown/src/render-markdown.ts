import createDOMPurify from "dompurify";
import { marked } from "marked";

export const PLACEHOLDER = "*选中节点,点上方工具条的 ✎ 编辑 Markdown*";
export const MARKDOWN_POLICY_VERSION = "html-v1";

// Private instance: other plugins cannot change this renderer's hooks/configuration.
const purifier = createDOMPurify(window);
purifier.addHook("uponSanitizeAttribute", (node, data) => {
    if (data.attrName !== "href" && data.attrName !== "src") return;
    if ((data.attrName === "src" && node.nodeName !== "IMG") || (data.attrName === "href" && node.nodeName !== "A")) {
        data.keepAttr = false;
        return;
    }
    try {
        const url = new URL(data.attrValue, document.baseURI);
        const image = node.nodeName === "IMG" && data.attrName === "src";
        data.keepAttr = ["http:", "https:"].includes(url.protocol)
            || (data.attrName === "href" && ["mailto:", "tel:"].includes(url.protocol))
            || (image && url.protocol === "blob:")
            || (image && /^data:image\/(?:png|gif|jpe?g|webp|avif);base64,/i.test(data.attrValue));
    } catch {
        data.keepAttr = false;
    }
});
purifier.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName === "INPUT") {
        node.setAttribute("type", "checkbox");
        node.setAttribute("disabled", "");
    }
});

// Only sanitized output enters the cache. Failures throw; callers must display text.
const htmlCache = new Map<string, string>();
export function renderMarkdown(source: string): string {
    if (!purifier.isSupported) throw new Error("HTML sanitizer unavailable");
    const markdown = source || PLACEHOLDER;
    const key = `${MARKDOWN_POLICY_VERSION}\0${markdown}`;
    const cached = htmlCache.get(key);
    if (cached !== undefined) return cached;
    const html = purifier.sanitize(marked.parse(markdown, { async: false }), {
        ALLOWED_TAGS: ["h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "a", "img", "strong", "em", "b", "i", "del", "s", "blockquote", "pre", "code", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "input", "sup", "sub", "details", "summary", "div", "span"],
        ALLOWED_ATTR: ["href", "src", "alt", "title", "class", "align", "width", "height", "start", "type", "checked", "disabled", "open"],
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false,
        ALLOW_UNKNOWN_PROTOCOLS: false,
        // The hook above restricts img src, including local Blob/raster data previews.
        ADD_URI_SAFE_ATTR: ["src"],
        RETURN_TRUSTED_TYPE: false,
    });
    htmlCache.set(key, html);
    return html;
}

export const RENDER_ERROR = "Markdown 预览失败，请切换编辑模式查看原文。";

export function updateMarkdownPreview(
    element: HTMLElement,
    source: string,
    previousHtml: string | null,
): string | null {
    try {
        const html = renderMarkdown(source);
        if (html !== previousHtml) element.innerHTML = html;
        return html;
    } catch {
        // Never fall back to parsed HTML, including after a successful older render.
        element.textContent = RENDER_ERROR;
        return null;
    }
}
