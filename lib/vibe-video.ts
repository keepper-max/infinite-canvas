import { isAbsolute, relative, resolve, sep } from "node:path";

export type VibeSceneInput = {
  title: string;
  narration: string;
  visual: string;
  onScreenText?: string;
  durationSeconds: number;
};

export type VibeStoryboardInput = {
  title: string;
  summary: string;
  aspectRatio: "9:16" | "16:9" | "1:1";
  style?: string;
  scenes: VibeSceneInput[];
};

export const VIBE_PROJECT_NAME = "Vibe 知识视频制作";
export const VIBE_PROJECT_DESCRIPTION =
  "由 Codex 协作管理的 Vibe 知识视频项目：守守画布调用 Claude Opus 5.5 生成文字方案并沉淀脚本、分镜和任务状态，本机完成画面渲染与 MP4 合成后回传成片。";
export const VIBE_MODEL_NAME = "Claude Opus 5.5 · Vibe";
export const VIBE_MODEL_ID = "claude-opus-5-5";
export const VIBE_MODEL_BASE_URL = "https://api.token360.ai/v1";
export const VIBE_MODEL_API_KEY_ENV = "TOKEN360_API_KEY";

export type VibeTextStage =
  | "brief"
  | "script"
  | "storyboard"
  | "canvas_code"
  | "revision";

const stageInstructions: Record<VibeTextStage, string> = {
  brief:
    "整理选题 Brief，明确主题、观众最终记住的一句话、作者署名、事实核验清单与风险。未提供或未经核验的事实不得编造。",
  script:
    "按钩子、历史锚点、机制模拟、反直觉转折、现实落点、声明与引用的叙事弧写带时间码的双语脚本。每句中文不超过 20 字，并给英文对照；15–20 秒安排标题卡。",
  storyboard:
    "把已确认的脚本拆成可制作分镜，逐镜写时间区间、构图、进场/主要动作/出场、顶部标签、画面注释、双语字幕和内容驱动的转场。相邻 2 秒必须有可见变化。",
  canvas_code:
    "根据已确认的脚本和分镜输出单文件 HTML Canvas 实现。必须暴露确定性的 window.render(t)，所有随机数使用固定种子，不依赖计时器或跨帧状态。先明确三张关键静帧的时间点。",
  revision:
    "根据反馈做局部修订，保留未被要求修改的内容，并列出本次改变及其影响。",
};

export function buildVibeTextPrompt(
  stage: VibeTextStage,
  instructions: string,
  context = "",
) {
  const contextBlock = context.trim()
    ? `\n\n已有上下文：\n${context.trim()}`
    : "";
  return `${stageInstructions[stage]}\n\n本次要求：\n${instructions.trim()}${contextBlock}\n\n只输出当前阶段可直接保存到项目中的成品，不要声称已经执行浏览、渲染、上传或其他未实际完成的动作。`;
}

export type VibeCanvasNode = {
  id: string;
  projectId: string;
  nodeType: "prompt" | "scene" | "audio" | "output";
  label: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
  status: "idle";
};

export type VibeCanvasEdge = {
  id: string;
  projectId: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: "reference";
  data: Record<string, never>;
};

const safePart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "-");

export function buildVibeCanvasBundle(
  projectId: string,
  storyboardId: string,
  input: VibeStoryboardInput,
) {
  const prefix = `vibe-${safePart(storyboardId)}`;
  const rootId = `${prefix}-script`;
  const outputId = `${prefix}-output`;
  const nodes: VibeCanvasNode[] = [
    {
      id: rootId,
      projectId,
      nodeType: "prompt",
      label: input.title,
      position: { x: 80, y: 120 },
      data: {
        label: input.title,
        description: input.summary,
        status: "idle",
        source: "codex-vibe",
        storyboardId,
        aspectRatio: input.aspectRatio,
        style: input.style ?? "电影感知识短视频",
      },
      status: "idle",
    },
  ];
  const edges: VibeCanvasEdge[] = [];
  let previousId = rootId;

  input.scenes.forEach((scene, index) => {
    const sceneNumber = index + 1;
    const sceneId = `${prefix}-scene-${sceneNumber}`;
    nodes.push({
      id: sceneId,
      projectId,
      nodeType: "scene",
      label: `场景 ${sceneNumber} · ${scene.title}`,
      position: { x: 420 + index * 340, y: 120 },
      data: {
        label: `场景 ${sceneNumber} · ${scene.title}`,
        description: scene.visual,
        status: "idle",
        source: "codex-vibe",
        storyboardId,
        order: sceneNumber,
        narration: scene.narration,
        visual: scene.visual,
        onScreenText: scene.onScreenText ?? "",
        durationSeconds: scene.durationSeconds,
      },
      status: "idle",
    });
    edges.push({
      id: `${prefix}-edge-${index}`,
      projectId,
      sourceNodeId: previousId,
      targetNodeId: sceneId,
      edgeType: "reference",
      data: {},
    });
    previousId = sceneId;
  });

  nodes.push({
    id: outputId,
    projectId,
    nodeType: "output",
    label: `${input.title} · 成片`,
    position: { x: 420 + input.scenes.length * 340, y: 120 },
    data: {
      label: `${input.title} · 成片`,
      description: "等待渲染后导入 MP4",
      status: "idle",
      source: "codex-vibe",
      storyboardId,
      aspectRatio: input.aspectRatio,
    },
    status: "idle",
  });
  edges.push({
    id: `${prefix}-edge-output`,
    projectId,
    sourceNodeId: previousId,
    targetNodeId: outputId,
    edgeType: "reference",
    data: {},
  });

  return { storyboardId, rootId, outputId, nodes, edges };
}

export function resolveAllowedImportPath(filePath: string, roots: string[]) {
  if (!isAbsolute(filePath)) throw new Error("成片路径必须是绝对路径");
  const target = resolve(filePath);
  const allowed = roots.some((root) => {
    const resolvedRoot = resolve(root);
    const rel = relative(resolvedRoot, target);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel) && !rel.includes(`..${sep}`));
  });
  if (!allowed) throw new Error("成片路径不在 SHOUSHOU_MCP_IMPORT_ROOTS 允许范围内");
  return target;
}
