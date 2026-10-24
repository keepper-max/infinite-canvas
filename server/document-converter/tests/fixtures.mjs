import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  ImageRun,
  ExternalHyperlink,
} from "docx";
import PDFDocument from "pdfkit";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
export async function fixtures(dir, font) {
  await mkdir(dir, { recursive: true });
  const sharp = createRequire(
    new URL("../../api/package.json", import.meta.url),
  )("sharp");
  const png = await sharp({
    create: { width: 40, height: 40, channels: 3, background: "#457b9d" },
  })
    .png()
    .toBuffer();
  for (const kind of ["basic", "headings", "table", "image"]) {
    const children = [
      new Paragraph({ text: "中文资料测试", heading: HeadingLevel.TITLE }),
      new Paragraph({
        children: [
          new TextRun("人物李白，量子力学 Quantum mechanics。"),
          new TextRun({ text: "加粗内容", bold: true }),
          new TextRun({ text: "斜体内容", italics: true }),
        ],
      }),
      new Paragraph({
        children: [
          new ExternalHyperlink({
            link: "https://example.com/reference",
            children: [new TextRun("原始来源")],
          }),
        ],
      }),
    ];
    if (kind === "headings")
      children.push(
        new Paragraph({ text: "一级标题", heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: "列表第一项", bullet: { level: 0 } }),
        new Paragraph({ text: "列表第二项", bullet: { level: 0 } }),
      );
    if (kind === "table")
      children.push(
        new Table({
          rows: [
            ["姓名", "领域"],
            ["李白", "诗歌"],
          ].map(
            (row) =>
              new TableRow({
                children: row.map(
                  (text) => new TableCell({ children: [new Paragraph(text)] }),
                ),
              }),
          ),
        }),
      );
    if (kind === "image")
      children.push(
        new Paragraph({
          children: [
            new ImageRun({
              data: png,
              type: "png",
              transformation: { width: 40, height: 40 },
            }),
          ],
        }),
      );
    await writeFile(
      `${dir}/${kind}.docx`,
      await Packer.toBuffer(new Document({ sections: [{ children }] })),
    );
  }
  const pdf = async (name, pages, scan = false, blank = false) => {
    const p = new PDFDocument({ autoFirstPage: false }),
      chunks = [];
    p.on("data", (b) => chunks.push(b));
    const done = new Promise((r) => p.on("end", r));
    for (let i = 0; i < pages; i++) {
      p.addPage();
      if (!blank) {
        if (scan) p.image(png, 50, 50, { width: 200, height: 200 });
        else {
          p.font(font)
            .fontSize(18)
            .text("中文知识资料 第" + (i + 1) + "页");
          p.fontSize(12).text(
            "人物李白与王安石。专业术语：量子力学，Quantum mechanics 中英文混排。\n正文阅读顺序与来源页码测试。",
          );
        }
      }
    }
    p.end();
    await done;
    await writeFile(`${dir}/${name}.pdf`, Buffer.concat(chunks));
  };
  await pdf("chinese", 1);
  await pdf("mixed", 1);
  await pdf("multipage", 5);
  await pdf("scan", 1, true);
  await pdf("blank", 1, false, true);
  await pdf("large", 30);
  const tagged = new PDFDocument({
      tagged: true,
      pdfVersion: "1.7",
      lang: "zh-CN",
    }),
    chunks = [];
  tagged.on("data", (b) => chunks.push(b));
  const done = new Promise((r) => tagged.on("end", r));
  tagged.font(font);
  tagged.addStructure(
    tagged.struct("H1", () => tagged.fontSize(18).text("中文结构表格")),
  );
  tagged.addStructure(
    tagged.struct(
      "Table",
      [
        ["姓名", "领域"],
        ["李白", "诗歌"],
        ["王安石", "文学"],
      ].map((row, index) =>
        tagged.struct(
          "TR",
          row.map((value) =>
            tagged.struct(index === 0 ? "TH" : "TD", () =>
              tagged.fontSize(12).text(value),
            ),
          ),
        ),
      ),
    ),
  );
  tagged.end();
  await done;
  await writeFile(dir + "/tagged-table.pdf", Buffer.concat(chunks));
  await writeFile(dir + "/notes.txt", "中文知识：李白、王安石与量子力学。");
  await writeFile(
    dir + "/protected.md",
    "---\ntitle: 原文\n---\n# 知识\n[[李白|人物]]\n> [!NOTE] 保真\n:::unknown\n内容\n:::\n",
  );
  await writeFile(dir + "/broken.docx", "corrupt");
  await writeFile(dir + "/spoof.pdf", "this is not PDF");
  await writeFile(dir + "/encoding.txt", Buffer.from([0xff, 0xfe, 0x88, 0x99]));
}
if (process.argv[2]) await fixtures(process.argv[2], process.argv[3]);
