import test from "node:test";
import assert from "node:assert/strict";
import { buildVibeCanvasBundle, buildVibeTextPrompt, resolveAllowedImportPath } from "@/lib/vibe-video";

test("Vibe 分镜转换为可追踪的画布节点和连线", () => {
  const bundle = buildVibeCanvasBundle("project-1", "story-1", {
    title: "为什么星星会闪烁",
    summary: "用大气扰动解释星光闪烁。",
    aspectRatio: "9:16",
    scenes: [
      { title: "疑问", narration: "抬头看星空。", visual: "夜空中的星星忽明忽暗", durationSeconds: 4 },
      { title: "答案", narration: "空气像流动的镜片。", visual: "光线穿过不同密度的空气层", durationSeconds: 6 },
    ],
  });
  assert.equal(bundle.nodes.length, 4);
  assert.equal(bundle.edges.length, 3);
  assert.equal(bundle.nodes[1].data.storyboardId, "story-1");
  assert.equal(bundle.nodes[2].data.order, 2);
  assert.equal(bundle.nodes.at(-1)?.nodeType, "output");
});

test("成片导入路径只能位于允许目录", () => {
  const allowed = resolveAllowedImportPath("H:\\CodexStorage\\vibe\\demo.mp4", ["H:\\CodexStorage"]);
  assert.match(allowed.toLowerCase(), /codexstorage/);
  assert.throws(
    () => resolveAllowedImportPath("H:\\private\\demo.mp4", ["H:\\CodexStorage"]),
    /允许范围/,
  );
  assert.throws(() => resolveAllowedImportPath("demo.mp4", ["H:\\CodexStorage"]), /绝对路径/);
});

test("Vibe 文字模型提示词包含阶段约束和已有上下文", () => {
  const prompt = buildVibeTextPrompt("storyboard", "把脚本拆成 8 个镜头", "片名：运气的形状");
  assert.match(prompt, /可制作分镜/);
  assert.match(prompt, /把脚本拆成 8 个镜头/);
  assert.match(prompt, /片名：运气的形状/);
  assert.match(prompt, /不要声称已经执行/);
});
