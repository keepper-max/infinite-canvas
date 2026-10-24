import mammoth from "mammoth";
import Turndown from "turndown";
import { gfm } from "turndown-plugin-gfm";
import yauzl from "yauzl";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const root = dirname(fileURLToPath(import.meta.url));
export async function inspectZip(buffer) {
  return new Promise((resolve, reject) =>
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error) return reject(new Error("DOCX 压缩结构损坏"));
        let count = 0,
          bytes = 0;
        const names = [];
        zip.on("error", reject);
        zip.on("entry", (entry) => {
          bytes += entry.uncompressedSize;
          names.push(entry.fileName);
          if (
            ++count > 10000 ||
            bytes > 100 * 1024 * 1024 ||
            /(^|\/)\.\.(\/|$)|^[\\/]|^[A-Za-z]:/.test(entry.fileName) ||
            entry.generalPurposeBitFlag & 1
          ) {
            zip.close();
            return reject(new Error("DOCX 解压资源或路径超限，无法安全转换"));
          }
          zip.readEntry();
        });
        zip.on("end", () =>
          names.includes("word/document.xml") &&
          names.includes("[Content_Types].xml")
            ? resolve(names)
            : reject(new Error("文件实际不是 DOCX")),
        );
        zip.readEntry();
      },
    ),
  );
}
export async function convert(buffer, extension) {
  const warnings = [],
    assets = [],
    pages = [];
  let markdown = "",
    converter;
  if (["md", "markdown", "txt"].includes(extension)) {
    if (
      buffer.includes(0) ||
      buffer.subarray(0, 4).toString() === "%PDF" ||
      buffer.subarray(0, 2).toString() === "PK"
    )
      throw new Error("文件内容与文本扩展名不一致");
    try {
      markdown = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(buffer);
    } catch {
      throw new Error(
        "文本不是有效 UTF-8，请另存为 UTF-8 后重新上传；原件仍保留",
      );
    }
    converter = "utf8/1";
  } else if (extension === "docx") {
    const names = await inspectZip(buffer);
    if (names.some((n) => /vbaProject|embeddings\//i.test(n)))
      warnings.push("包含宏或嵌入对象：未执行；嵌入附件请从保留的原件查看。");
    const result = await mammoth.convertToHtml(
      { buffer },
      {
        externalFileAccess: false,
        styleMap: ["p[style-name='Title'] => h1:fresh"],
        convertImage: mammoth.images.imgElement(async (image) => {
          let body;
          try {
            body = await image.read("base64");
          } catch {
            warnings.push(
              "无法读取文档图片（可能为外部引用），正文继续保留；请从原件核对。",
            );
            return { src: "", alt: "图片不可用，请查看原件" };
          }
          const id = String(assets.length);
          if (
            !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
              image.contentType,
            )
          ) {
            warnings.push("无法显示的图片格式已保留在原件");
            return { src: "", alt: "图片请查看原件" };
          }
          assets.push({ id, mimeType: image.contentType, body });
          return { src: `import-asset:${id}` };
        }),
      },
    );
    warnings.push(...result.messages.map((m) => m.message));
    const td = new Turndown({ headingStyle: "atx", codeBlockStyle: "fenced" });
    td.use(gfm);
    td.addRule("plain-tables", {
      filter: (node) => node.nodeName === "TABLE",
      replacement: (_content, node) => {
        const rows = Array.from(node.rows);
        if (
          rows.some((row) =>
            Array.from(row.cells).some(
              (cell) =>
                cell.colSpan > 1 ||
                cell.rowSpan > 1 ||
                cell.querySelector("table"),
            ),
          )
        ) {
          warnings.push(
            "合并或嵌套表格保留为 HTML，源码保护模式可编辑；请对照原件。",
          );
          return "\n\n" + node.outerHTML + "\n\n";
        }
        const cells = rows.map((row) =>
          Array.from(row.cells).map((cell) =>
            td
              .turndown(cell.innerHTML)
              .replace(/\n+/g, "<br>")
              .replace(/\|/g, "\\|"),
          ),
        );
        if (!cells.length) return "";
        const columns = Math.max(...cells.map((row) => row.length)),
          empty = Array(columns).fill("");
        const header =
          rows[0].cells[0]?.nodeName === "TH" ? cells.shift() : empty;
        const line = (row) =>
          "| " +
          Array.from({ length: columns }, (_, i) => row[i] || "").join(" | ") +
          " |";
        return (
          "\n\n" +
          [
            line(header),
            line(Array(columns).fill("---")),
            ...cells.map(line),
          ].join("\n") +
          "\n\n"
        );
      },
    });
    // Keep visible link text when a document contains executable URL protocols.
    td.addRule("safe-links", {
      filter: (n) =>
        n.nodeName === "A" &&
        !/^(https?:|mailto:|#)/i.test(n.getAttribute("href") || ""),
      replacement: (content) => content,
    });
    markdown = td.turndown(result.value);
    converter = "mammoth/1.13.0+turndown/7.2.4";
  } else if (extension === "pdf") {
    if (buffer.subarray(0, 5).toString() !== "%PDF-")
      throw new Error("文件内容不是 PDF");
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: false,
      standardFontDataUrl: `${root}/node_modules/pdfjs-dist/standard_fonts/`,
      cMapUrl: `${root}/node_modules/pdfjs-dist/cmaps/`,
      cMapPacked: true,
    });
    const pdf = await loading.promise;
    try {
      for (let page = 1; page <= pdf.numPages; page++) {
        const p = await pdf.getPage(page),
          text = await p.getTextContent({ includeMarkedContent: true });
        let body = "",
          line = "",
          lastY = null;
        const marked = new Map(),
          stack = [];
        let unmarked = false;
        for (const item of text.items) {
          if (
            item.type === "beginMarkedContentProps" ||
            item.type === "beginMarkedContent"
          ) {
            stack.push(item.id || null);
            continue;
          }
          if (item.type === "endMarkedContent") {
            stack.pop();
            continue;
          }
          if (!("str" in item)) continue;
          const mark = stack.findLast((id) => id);
          if (mark)
            marked.set(
              mark,
              (marked.get(mark) || "") + item.str + (item.hasEOL ? "\n" : " "),
            );
          else if (item.str.trim()) unmarked = true;
          const y = item.transform[5];
          if (
            lastY !== null &&
            Math.abs(y - lastY) > Math.max(3, item.height * 0.5)
          ) {
            body += line.trimEnd() + "\n";
            line = "";
          }
          line += item.str + (item.hasEOL ? "\n" : " ");
          lastY = y;
        }
        body = (body + line).trim();
        const tree = await p.getStructTree(),
          used = new Set();
        const render = (node) => {
          if (node.type === "content") {
            used.add(node.id);
            return marked.get(node.id) || "";
          }
          const children = node.children || [],
            contents = () => children.map(render).join("\n\n").trim();
          if (node.role === "Table") {
            const tableRows = [];
            const collect = (n) => {
              if (n.role === "TR") tableRows.push(n);
              else (n.children || []).forEach(collect);
            };
            collect(node);
            if (!tableRows.length) return contents();
            const cells = tableRows.map((row) =>
              (row.children || []).filter((c) => ["TH", "TD"].includes(c.role)),
            );
            if (
              cells.some(
                (row) =>
                  !row.length ||
                  row.some((c) => (c.colSpan || 1) > 1 || (c.rowSpan || 1) > 1),
              )
            ) {
              warnings.push(
                `第${page}页有复杂标记表格，保留文字顺序而不推测单元格。`,
              );
              return contents();
            }
            const values = cells.map((row) =>
                row.map((c) =>
                  render(c).replace(/\n+/g, " ").replace(/\|/g, "\\|"),
                ),
              ),
              cols = Math.max(...values.map((r) => r.length)),
              line = (row) =>
                "| " +
                Array.from({ length: cols }, (_, i) => row[i] || "").join(
                  " | ",
                ) +
                " |";
            const header = cells[0].every((c) => c.role === "TH")
              ? values.shift()
              : Array(cols).fill("");
            return [
              line(header),
              line(Array(cols).fill("---")),
              ...values.map(line),
            ].join("\n");
          }
          const value = contents();
          return /^H[1-6]$/.test(node.role)
            ? "#".repeat(Number(node.role.slice(1))) + " " + value
            : value;
        };
        if (tree && !unmarked && marked.size) {
          const structured = render(tree);
          if ([...marked.keys()].every((id) => used.has(id))) body = structured;
        }
        pages.push({ page, characters: body.length, start: markdown.length });
        if (body.replace(/\s/g, "").length < 20)
          warnings.push(`第 ${page} 页为空白或可提取文字较少，请核对原件。`);
        markdown += `## 第 ${page} 页\n\n${body}\n\n`;
        p.cleanup();
      }
      if (!pages.some((p) => p.characters > 0))
        throw new Error("当前文件可能为扫描版 PDF，需要 OCR 识别。");
      warnings.push(
        "PDF 按文字对象顺序提取；复杂分栏、表格和图片请对照原件。首版不推测不可靠的表格结构。",
      );
    } finally {
      await loading.destroy();
    }
    converter = "pdfjs-dist/6.4.299";
  } else
    throw new Error(
      "暂不支持该文件格式，请选择 DOCX、文字型 PDF、TXT 或 Markdown",
    );
  return { markdown, warnings, pages, assets, converter };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log = (...values) => process.stderr.write(values.join(" ") + "\n");
  const start = performance.now(),
    cpu = process.cpuUsage();
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const result = await convert(
      Buffer.from(input.body, "base64"),
      input.extension,
    );
    process.stdout.write(
      JSON.stringify({
        ...result,
        metrics: {
          elapsedMs: performance.now() - start,
          cpu: process.cpuUsage(cpu),
          maxRssKiB: process.resourceUsage().maxRSS,
        },
      }),
    );
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: e.message }));
    process.exitCode = 1;
  }
}
