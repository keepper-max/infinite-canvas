"use client";

import Image from "next/image";
import {
  type Edge,
  type Node,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Download,
  Coins,
  Film,
  FolderKanban,
  Image as ImageIcon,
  Layers3,
  LogIn,
  MoreHorizontal,
  MessageCircle,
  Puzzle,
  BookOpen,
  Settings2,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Upload,
  Send,
  Sparkles,
  UserRound,
  UsersRound,
  WandSparkles,
  Workflow,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  NODE_TYPES,
  type CanvasNodeData,
  type CanvasNodeType,
  type GenerationJob,
  type Project,
} from "@/lib/types";
import { InfiniteCanvasV2 } from "@/components/canvas/infinite-canvas-v2";
import { CreditWallet } from "@/components/credit-wallet";

type VideoCatalogModel = {
  name: string;
  displayName: string;
  type: string;
  inputTypes: string[];
  defaults: Record<string, unknown>;
};

const palette: Record<
  CanvasNodeType,
  { accent: string; icon: typeof Sparkles }
> = {
  prompt: { accent: "#9b8cff", icon: Sparkles },
  character: { accent: "#f0b45c", icon: UserRound },
  scene: { accent: "#62c7a7", icon: ImageIcon },
  panorama: { accent: "#56a7e8", icon: Layers3 },
  composition_3d: { accent: "#d68de7", icon: WandSparkles },
  keyframe: { accent: "#e47e9b", icon: Film },
  tailframe: { accent: "#e58d62", icon: Film },
  image_edit: { accent: "#efad6a", icon: WandSparkles },
  style_polish: { accent: "#8e9de7", icon: Sparkles },
  video: { accent: "#f4799c", icon: Film },
  audio: { accent: "#68c8ca", icon: Sparkles },
  output: { accent: "#bca36f", icon: Download },
};

const node = (
  id: string,
  label: string,
  description: string,
  x: number,
  y: number,
  extra: Partial<CanvasNodeData> = {},
): Node<CanvasNodeData> => ({
  id,
  type: "studio",
  position: { x, y },
  data: { label, description, status: "idle", ...extra },
});

const initialNodes: Node<CanvasNodeData>[] = [
  node("prompt", "创意提示词", "故事意图、风格与镜头目标", 40, 220),
  node("character", "角色三视图", "锁定身份、服装与姿态", 330, 40, {
    locked: true,
  }),
  node("scene", "场景候选", "MJ 抽卡后的场景母版", 330, 260),
  node("panorama", "全景环境", "补足镜头移动空间", 620, 260),
  node("composition", "3D 构图", "机位、站位、比例与视线", 900, 260),
  node("keyframe", "关键帧", "将布局落成可用首帧", 1180, 260),
  node("tailframe", "尾帧", "定义镜头结束姿态与连续性", 1180, 430),
  node("edit", "局部修复", "Nano Banana 2 补全与修图", 1460, 260),
  node("polish", "风格优化", "保持构图的最后抛光", 1740, 260),
  node("audio", "音频", "对白、环境声与节奏参考", 1740, 430),
  node("video", "Seedance 2.5", "动作、运镜、声音与连续性", 2020, 260),
  node("output", "成片预览", "播放、复盘与下载", 2300, 260),
];

const initialEdges: Edge[] = [
  {
    id: "e-p-c",
    source: "prompt",
    target: "character",
    label: "身份提示",
    animated: true,
  },
  {
    id: "e-p-s",
    source: "prompt",
    target: "scene",
    label: "场景提示",
    animated: true,
  },
  { id: "e-s-p", source: "scene", target: "panorama", label: "环境参考" },
  {
    id: "e-c-c",
    source: "character",
    target: "composition",
    label: "角色参考",
  },
  {
    id: "e-p-c2",
    source: "panorama",
    target: "composition",
    label: "空间参考",
  },
  { id: "e-c-k", source: "composition", target: "keyframe", label: "构图" },
  { id: "e-c-t", source: "composition", target: "tailframe", label: "尾帧构图" },
  { id: "e-k-e", source: "keyframe", target: "edit", label: "局部修复" },
  { id: "e-e-p", source: "edit", target: "polish", label: "风格保持" },
  {
    id: "e-p-v",
    source: "polish",
    target: "video",
    label: "I2V / R2V",
    animated: true,
  },
  { id: "e-t-v", source: "tailframe", target: "video", label: "尾帧参考" },
  { id: "e-a-v", source: "audio", target: "video", label: "声音参考" },
  {
    id: "e-v-o",
    source: "video",
    target: "output",
    label: "视频结果",
    animated: true,
  },
];

function migrateCanvas(nodes: Node<CanvasNodeData>[], edges: Edge[]) {
  const known = new Set(nodes.map((item) => item.id));
  const nextNodes = [...nodes, ...initialNodes.filter((item) => !known.has(item.id))];
  const edgeIds = new Set(edges.map((item) => item.id));
  const nextEdges = [...edges, ...initialEdges.filter((item) => !edgeIds.has(item.id) && nextNodes.some((nodeItem) => nodeItem.id === item.source) && nextNodes.some((nodeItem) => nodeItem.id === item.target))];
  return { nodes: nextNodes, edges: nextEdges };
}

function nodeTypeForLabel(label: string): CanvasNodeType {
  if (label === "Seedance 2.5") return "video";
  if (label === "角色三视图") return "character";
  if (label === "场景候选") return "scene";
  if (label === "全景环境") return "panorama";
  if (label === "3D 构图") return "composition_3d";
  if (label === "关键帧") return "keyframe";
  if (label === "尾帧") return "tailframe";
  if (label === "局部修复") return "image_edit";
  if (label === "风格优化") return "style_polish";
  if (label === "音频") return "audio";
  if (label === "成片预览") return "output";
  return "prompt";
}

function StudioNode({ data, selected }: { data: CanvasNodeData; selected?: boolean }) {
  const nodeData = data;
  const style = palette[nodeTypeForLabel(nodeData.label)];
  const Icon = style.icon;
  const statusLabel =
    nodeData.status === "running"
      ? "生成中"
      : nodeData.status === "completed"
        ? "已完成"
        : nodeData.status === "failed"
          ? "失败"
          : nodeData.locked
            ? "身份母版"
            : "待处理";
  return (
    <div
      className={`studio-node ${selected ? "selected" : ""}`}
      style={{ "--node-accent": style.accent } as React.CSSProperties}
    >
      <div className="node-head">
        <span className="node-icon">
          <Icon size={15} />
        </span>
        <span>{nodeData.label}</span>
        <span className={`node-status ${nodeData.status}`}>{statusLabel}</span>
      </div>
      <div className="node-body">{nodeData.description}</div>
      {nodeData.output && <div className="node-output">{nodeData.output}</div>}
    </div>
  );
}

function AuthScreen({ onDone }: { onDone: (email: string) => void }) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [account, setAccount] = useState("");
  const [code, setCode] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [legacy, setLegacy] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);
  const accountValid = channel === "sms"
    ? /^(?:\+?86)?1[3-9]\d{9}$/.test(account.replace(/[\s()-]/g, ""))
    : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.trim());
  const sendCode = async () => {
    if (!accountValid || countdown > 0 || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/auth/verification/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, account, scene: mode }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "验证码发送失败，请稍后重试");
      setCountdown(Number(payload.retryAfter) || 60);
      setNotice("验证码已发送");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "验证码发送失败，请稍后重试");
    } finally { setBusy(false); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(""); setNotice(""); setBusy(true);
    try {
      const endpoint = legacy ? "/api/auth/login" : `/api/auth/${mode}/code`;
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(legacy
          ? { email: account, password }
          : { channel, account, code, inviteCode: mode === "register" ? inviteCode : undefined }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "操作失败");
      onDone(payload.user.email ?? payload.user.phone);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "操作失败");
    } finally { setBusy(false); }
  };
  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="brand-mark">镜</div>
        <p className="eyebrow">JINGJIE STUDIO</p>
        <h1>{mode === "register" ? "创建你的工作区" : "欢迎回到镜界"}</h1>
        <p className="auth-copy">
          使用手机号或邮箱验证码进入同一个工作区。
        </p>
        <div className="auth-mode-tabs">
          <button className={mode === "register" ? "active" : ""} type="button" onClick={() => { setMode("register"); setLegacy(false); setError(""); }}>注册</button>
          <button className={mode === "login" ? "active" : ""} type="button" onClick={() => { setMode("login"); setLegacy(false); setError(""); }}>登录</button>
        </div>
        {!legacy && <div className="auth-channel-tabs">
          <button className={channel === "sms" ? "active" : ""} type="button" onClick={() => { setChannel("sms"); setAccount(""); setCountdown(0); }}>{mode === "register" ? "手机号注册" : "手机号登录"}</button>
          <button className={channel === "email" ? "active" : ""} type="button" onClick={() => { setChannel("email"); setAccount(""); setCountdown(0); }}>{mode === "register" ? "邮箱注册" : "邮箱登录"}</button>
        </div>}
        <form onSubmit={submit} className="auth-form">
          <label>
            {legacy || channel === "email" ? "邮箱地址" : "手机号"}
            <input
              type={legacy || channel === "email" ? "email" : "tel"}
              placeholder={legacy || channel === "email" ? "you@example.com" : "+86 请输入手机号"}
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              required
            />
          </label>
          {legacy ? <label>
            密码
            <input
              type="password"
              placeholder="至少 6 位"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={6}
              required
            />
          </label> : <label>
            验证码
            <span className="verification-row">
              <input inputMode="numeric" maxLength={6} placeholder="6 位数字验证码" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required />
              <button type="button" onClick={() => void sendCode()} disabled={!accountValid || countdown > 0 || busy}>
                {countdown > 0 ? `${countdown} 秒` : "获取验证码"}
              </button>
            </span>
          </label>}
          {!legacy && mode === "register" && <label>
            邀请码（如有）
            <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value.toUpperCase())} placeholder="请输入邀请码" />
          </label>}
          {notice && <p className="form-notice">{notice}</p>}
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button" type="submit" disabled={busy}>
            <LogIn size={17} />
            {busy ? "请稍候…" : mode === "register" ? "注册并继续" : "登录工作区"}
          </button>
        </form>
        <button
          className="link-button"
          onClick={() => { setMode(mode === "register" ? "login" : "register"); setLegacy(false); setError(""); }}
        >
          {mode === "register" ? "已有账号？登录" : "还没有账号？注册"}
        </button>
        {mode === "login" && <button className="link-button legacy-login" onClick={() => { setLegacy((value) => !value); setChannel("email"); setAccount(""); setError(""); }}>
          {legacy ? "改用验证码登录" : "旧账号使用密码登录"}
        </button>}
      </div>
    </main>
  );
}

function ProjectCreateScreen({
  onCreated,
}: {
  onCreated: (project: Project) => void;
}) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: title }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.error ?? "项目创建失败");
      return;
    }
    onCreated({
      ...payload.project,
      nodeCount: initialNodes.length,
      status: "draft",
    });
  };
  return (
    <main className="welcome-shell">
      <div className="welcome-top">
        <div className="brand-lockup">
          <span className="brand-mark small">镜</span>
          <span>镜界工坊</span>
        </div>
      </div>
      <section className="welcome-content compact-create">
        <p className="eyebrow">NEW PROJECT</p>
        <h1>创建一个漫剧项目</h1>
        <p>从角色母版开始，把整条生产链放进可回溯的画布。</p>
        <form className="new-project-card" onSubmit={create}>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：雨夜的最后一班车"
            required
          />
          <button className="primary-button" type="submit">
            <Plus size={18} />
            创建项目
          </button>
          {error && <span className="form-error">{error}</span>}
        </form>
      </section>
    </main>
  );
}

function ProjectEmpty({
  activeView,
  onCanvas,
}: {
  activeView: string;
  onCanvas: () => void;
}) {
  const title =
    activeView === "tasks"
      ? "任务会出现在这里"
      : activeView === "assets"
        ? "资产库正在等待你的第一张图"
        : "项目概览";
  return (
    <div className="empty-view">
      <div className="empty-icon">
        <Layers3 size={28} />
      </div>
      <h2>{title}</h2>
      <p>当前 MVP 已把画布生产链准备好，切回“生产画布”即可继续。</p>
      <button className="primary-button" onClick={onCanvas}>
        回到生产画布
      </button>
    </div>
  );
}

function toClientJob(job: Record<string, unknown>): GenerationJob {
  return {
    id: String(job.id),
    nodeId: String(job.nodeId ?? ""),
    nodeLabel: String(job.nodeLabel ?? job.nodeId ?? "Mock 任务"),
    provider: String(job.provider ?? "mock"),
    model: String(job.model ?? job.modelId ?? "mock-seedance-2.5"),
    status: (job.status as GenerationJob["status"]) ?? "pending",
    progress: Number(job.progress ?? 0),
    createdAt: String(job.createdAt ?? new Date().toISOString()),
    error: job.errorReason ? String(job.errorReason) : undefined,
  };
}

type AssetRecord = {
  id: string;
  name: string;
  kind: string;
  mimeType: string;
  size: number;
  contentUrl: string;
  createdAt: string;
};

function formatAssetSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function AssetLibrary({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/assets`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? "资产加载失败");
        if (!cancelled) setItems(payload.assets ?? []);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : "资产加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/projects/${projectId}/assets`, {
        method: "POST",
        body: form,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "上传失败");
      setItems((current) => [payload.asset, ...current]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "上传失败");
    } finally {
      setUploading(false);
    }
  };

  const remove = async (asset: AssetRecord) => {
    if (!window.confirm(`确定删除“${asset.name}”吗？`)) return;
    const response = await fetch(`/api/assets/${asset.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setError("删除失败，请稍后重试");
      return;
    }
    setItems((current) => current.filter((item) => item.id !== asset.id));
  };

  return (
    <div className="asset-library">
      <div className="asset-toolbar">
        <div>
          <span className="eyebrow">PROJECT ASSETS</span>
          <h2>资产库</h2>
          <p>上传角色、场景、关键帧和音频，作为画布节点的可复用参考。</p>
        </div>
        <label className="primary-button asset-upload-button">
          <Plus size={16} />
          {uploading ? "上传中…" : "上传资产"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,audio/mpeg,audio/wav"
            onChange={upload}
            disabled={uploading}
          />
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      {loading ? (
        <div className="asset-loading">正在读取资产…</div>
      ) : items.length === 0 ? (
        <div className="asset-empty">
          <div className="empty-icon">
            <Layers3 size={25} />
          </div>
          <h3>还没有资产</h3>
          <p>先上传一张角色三视图或场景参考图。</p>
        </div>
      ) : (
        <div className="asset-grid">
          {items.map((asset) => (
            <article className="asset-card" key={asset.id}>
              <div className="asset-thumb">
                {asset.mimeType.startsWith("image/") ? (
                  <Image
                    src={asset.contentUrl}
                    alt={asset.name}
                    width={260}
                    height={160}
                    unoptimized
                  />
                ) : (
                  <div className="asset-file-icon">
                    <Film size={27} />
                    <span>{asset.kind.toUpperCase()}</span>
                  </div>
                )}
              </div>
              <div className="asset-card-body">
                <strong title={asset.name}>{asset.name}</strong>
                <span>
                  {formatAssetSize(asset.size)} ·{" "}
                  {new Date(asset.createdAt).toLocaleDateString("zh-CN")}
                </span>
              </div>
              <button
                className="asset-delete"
                onClick={() => void remove(asset)}
                aria-label={`删除 ${asset.name}`}
              >
                删除
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

type PlatformData = {
  outline: { title?: string; content?: string };
  agents: Array<{ id: string; name: string; kind: string; enabled: number }>;
  automations: Array<{
    id: string;
    template: string;
    status: string;
    createdAt: string;
  }>;
};

function PlatformPanel({
  projectId,
  view,
}: {
  projectId: string;
  view: "outline" | "workflows" | "agents";
}) {
  const [data, setData] = useState<PlatformData>({
    outline: {},
    agents: [],
    automations: [],
  });
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [notice, setNotice] = useState("");
  const load = async () => {
    const response = await fetch(`/api/projects/${projectId}/platform`);
    const payload = await response.json().catch(() => ({}));
    if (response.ok) {
      setData(payload);
      setTitle(payload.outline?.title ?? "");
      setContent(payload.outline?.content ?? "");
    }
  };
  // The platform panel hydrates its form fields from the server after mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  const saveOutline = async () => {
    const response = await fetch(`/api/projects/${projectId}/platform`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content }),
    });
    setNotice(response.ok ? "大纲已保存" : "保存失败");
  };
  const addAgent = async () => {
    const name = window.prompt("输入 Agent / Skill 名称", "分镜拆解 Agent");
    if (!name) return;
    const response = await fetch(`/api/projects/${projectId}/platform`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "agent",
        name,
        kind: name.toLowerCase().includes("skill") ? "skill" : "agent",
      }),
    });
    if (response.ok) await load();
  };
  const runWorkflow = async (template: string) => {
    const response = await fetch(`/api/projects/${projectId}/platform`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "execute", template }),
    });
    setNotice(
      response.ok ? "流水线已提交，任务中心将显示执行进度" : "创建失败",
    );
    if (response.ok) await load();
  };
  const toggleAgent = async (id: string, enabled: number) => {
    await fetch(`/api/projects/${projectId}/platform`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: id, enabled: !enabled }),
    });
    await load();
  };
  if (view === "outline")
    return (
      <div className="platform-panel">
        <div className="platform-head">
          <div>
            <span className="eyebrow">STORY LIBRARY</span>
            <h2>大纲库</h2>
            <p>
              把故事设定、人物关系和分集目标沉淀下来，作为画布提示词的长期底稿。
            </p>
          </div>
          <button className="primary-button" onClick={() => void saveOutline()}>
            <Download size={16} />
            保存大纲
          </button>
        </div>
        <div className="outline-form">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="大纲标题，例如：雨夜的最后一班车"
          />
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="写下故事梗概、角色动机、分集节奏和视觉基调…"
          />
          {notice && <span className="save-hint">{notice}</span>}
        </div>
      </div>
    );
  if (view === "workflows")
    return (
      <div className="platform-panel">
        <div className="platform-head">
          <div>
            <span className="eyebrow">WORKFLOW LIBRARY</span>
            <h2>工作流模板</h2>
            <p>用预设生产链快速搭建项目，真实模型接入后只需替换 Provider。</p>
          </div>
        </div>
        <div className="workflow-grid">
          {[
            {
              name: "角色到视频",
              desc: "角色三视图 → 场景 → 构图 → 关键帧 → Mock 视频",
              count: "10 节点",
            },
            {
              name: "关键帧修复",
              desc: "关键帧 → 局部修复 → 风格优化 → 输出",
              count: "4 节点",
            },
            {
              name: "大纲到分镜",
              desc: "故事大纲 → 分集拆解 → 分镜提示 → 画布",
              count: "规划中",
            },
          ].map((item) => (
            <article className="workflow-card" key={item.name}>
              <div className="workflow-card-top">
                <span className="workflow-number">01</span>
                <span>{item.count}</span>
              </div>
              <h3>{item.name}</h3>
              <p>{item.desc}</p>
              <button
                className="ghost-button"
                onClick={() => void runWorkflow(item.name)}
              >
                使用模板 <Send size={14} />
              </button>
            </article>
          ))}
        </div>
        {notice && <span className="save-hint">{notice}</span>}
      </div>
    );
  return (
    <div className="platform-panel">
      <div className="platform-head">
        <div>
          <span className="eyebrow">AGENT / SKILL</span>
          <h2>Agent 与 Skill</h2>
          <p>
            为项目配置编剧、角色提取、分镜拆解等能力；这里只保存配置，不调用真实模型。
          </p>
        </div>
        <button className="primary-button" onClick={() => void addAgent()}>
          <Plus size={16} />
          添加能力
        </button>
      </div>
      <div className="agent-list">
        {data.agents.length === 0 ? (
          <div className="platform-empty">
            <Sparkles size={24} />
            <p>还没有配置能力，先添加一个分镜拆解 Agent。</p>
          </div>
        ) : (
          data.agents.map((agent) => (
            <div className="agent-row" key={agent.id}>
              <div>
                <strong>{agent.name}</strong>
                <span>{agent.kind === "skill" ? "Skill" : "Agent"}</span>
              </div>
              <button
                className={agent.enabled ? "toggle on" : "toggle"}
                onClick={() => void toggleAgent(agent.id, agent.enabled)}
              >
                {agent.enabled ? "已启用" : "已停用"}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AssistantPanel({
  projectId,
  node,
}: {
  projectId: string;
  node?: Node<CanvasNodeData>;
}) {
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const ask = async () => {
    setLoading(true);
    const response = await fetch(`/api/projects/${projectId}/assistant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, node: node?.data, upstream: [] }),
    });
    const payload = await response.json().catch(() => ({}));
    setAnswer(response.ok ? payload.answer : (payload.error ?? "助手暂不可用"));
    setLoading(false);
  };
  return (
    <div className="platform-panel">
      <div className="platform-head">
        <div>
          <span className="eyebrow">AI CANVAS ASSISTANT</span>
          <h2>画布助手</h2>
          <p>基于当前选中节点，生成角色、场景、镜头和 Seedance 提示词建议。</p>
        </div>
        <MessageCircle size={24} />
      </div>
      <div className="assistant-context">
        当前节点：{node?.data.label ?? "未选择节点"}
      </div>
      <textarea
        className="outline-form textarea"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="例如：把这个关键帧改成雨夜追逐镜头…"
      />
      <button
        className="primary-button"
        onClick={() => void ask()}
        disabled={loading}
      >
        {loading ? "分析中…" : "询问助手"}
      </button>
      {answer && (
        <div className="result-box">
          <span>Mock Assistant</span>
          <strong>{answer}</strong>
        </div>
      )}
    </div>
  );
}

function PromptLibraryPanel({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<
    Array<{ id: string; title: string; category: string; content: string }>
  >([]);
  const [selected, setSelected] = useState("");
  useEffect(() => {
    void fetch(`/api/projects/${projectId}/prompts`)
      .then((response) => response.json())
      .then((payload) => setItems(payload.prompts ?? []));
  }, [projectId]);
  return (
    <div className="platform-panel">
      <div className="platform-head">
        <div>
          <span className="eyebrow">PROMPT LIBRARY</span>
          <h2>提示词库</h2>
          <p>按漫剧生产节点复用角色、场景和视频提示词。</p>
        </div>
        <BookOpen size={24} />
      </div>
      <div className="workflow-grid">
        {items.map((item) => (
          <article
            className="workflow-card"
            key={item.id}
            onClick={() => setSelected(item.content)}
          >
            <div className="workflow-card-top">
              <span className="workflow-number">{item.category}</span>
            </div>
            <h3>{item.title}</h3>
            <p>{item.content}</p>
            <button
              className="ghost-button"
              onClick={() => void navigator.clipboard?.writeText(item.content)}
            >
              复制提示词
            </button>
          </article>
        ))}
      </div>
      {selected && (
        <div className="result-box">
          <span>已选择提示词</span>
          <strong>{selected}</strong>
        </div>
      )}
    </div>
  );
}

function PluginPanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<{
    builtins: Array<{ slug: string; name: string; config: unknown }>;
    plugins: Array<{ id: string; slug: string; name: string; enabled: number }>;
  }>({ builtins: [], plugins: [] });
  const load = () =>
    void fetch(`/api/projects/${projectId}/plugins`)
      .then((response) => response.json())
      .then(setData);
  useEffect(load, [projectId]);
  const install = (item: { slug: string; name: string; config: unknown }) =>
    void fetch(`/api/projects/${projectId}/plugins`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    }).then(load);
  return (
    <div className="platform-panel">
      <div className="platform-head">
        <div>
          <span className="eyebrow">PLUGIN NODES</span>
          <h2>插件节点</h2>
          <p>把角色、提示词和 Seedance 能力作为可启停的画布节点。</p>
        </div>
        <Puzzle size={24} />
      </div>
      <div className="agent-list">
        {data.builtins.map((item) => (
          <div className="agent-row" key={item.slug}>
            <div>
              <strong>{item.name}</strong>
              <span>
                {data.plugins.some((plugin) => plugin.slug === item.slug)
                  ? "已安装"
                  : "内置插件"}
              </span>
            </div>
            <button className="toggle on" onClick={() => void install(item)}>
              安装 / 更新
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModelConfigPanel({ projectId }: { projectId: string }) {
  const [configs, setConfigs] = useState<
    Array<{
      id: string;
      name: string;
      baseUrl: string;
      model: string;
      apiKeyEnv: string;
    }>
  >([]);
  const [catalog, setCatalog] = useState<Array<{ name: string; displayName: string; type: string; tags: unknown[] }>>([]);
  const [catalogType, setCatalogType] = useState("all");
  const [form, setForm] = useState({
    name: "Seedance 适配器",
    baseUrl: "https://api.example.com/v1",
    model: "qwen3.8-flash",
    apiKeyEnv: "TOKEN360_API_KEY",
  });
  const load = () =>
    void fetch(`/api/projects/${projectId}/models`)
      .then((response) => response.json())
      .then((payload) => setConfigs(payload.configs ?? []));
  useEffect(load, [projectId]);
  useEffect(() => {
    void fetch("/api/models/catalog")
      .then((response) => response.json())
      .then((payload) => setCatalog(payload.models ?? []));
  }, []);
  const save = async () => {
    await fetch(`/api/projects/${projectId}/models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    await load();
  };
  return (
    <div className="platform-panel">
      <div className="platform-head">
        <div>
          <span className="eyebrow">MODEL SCRIPTS</span>
          <h2>自定义模型脚本</h2>
          <p>
            保存 OpenAI 兼容接口、模型名和服务端环境变量引用，不保存明文 Key。
          </p>
        </div>
        <Settings2 size={24} />
      </div>
      <div className="outline-form">
        <input
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          placeholder="配置名称"
        />
        <input
          value={form.baseUrl}
          onChange={(event) =>
            setForm({ ...form, baseUrl: event.target.value })
          }
          placeholder="Base URL"
        />
        <select
          value={form.model}
          onChange={(event) => setForm({ ...form, model: event.target.value })}
          aria-label="模型 ID"
        >
          <option value={form.model}>{form.model}（当前）</option>
          {catalog
            .filter((item) => catalogType === "all" || item.type === catalogType)
            .filter((item, index, all) => all.findIndex((candidate) => candidate.name === item.name) === index)
            .map((item) => <option value={item.name} key={item.name}>{item.displayName} · {item.name}</option>)}
        </select>
        <input
          value={form.apiKeyEnv}
          onChange={(event) =>
            setForm({ ...form, apiKeyEnv: event.target.value })
          }
          placeholder="API Key 环境变量名"
        />
        <button className="primary-button" onClick={() => void save()}>
          保存模型配置
        </button>
      </div>
      <div className="catalog-strip">
        <span className="eyebrow">MODEL CATALOG · {catalog.length || "…"} MODELS</span>
        <div className="catalog-filters">
          {[['all', '全部'], ['LLM', '文本'], ['VIDEO_GENERATION', '视频'], ['IMAGE_GENERATION', '图片'], ['AUDIO_GENERATION', '音频']].map(([value, label]) => (
            <button key={value} className={catalogType === value ? "filter-chip active" : "filter-chip"} onClick={() => setCatalogType(value)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="agent-list">
        {configs.map((config) => (
          <div className="agent-row" key={config.id}>
            <div>
              <strong>{config.name}</strong>
              <span>
                {config.model} · {config.apiKeyEnv || "未配置 Key"}
              </span>
            </div>
            <span>{config.baseUrl}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MembersPanel({ projectId }: { projectId: string }) {
  const [members, setMembers] = useState<
    Array<{ userId: string; email: string; role: string }>
  >([]);
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const load = () =>
    void fetch(`/api/projects/${projectId}/members`)
      .then((response) => response.json())
      .then((payload) => setMembers(payload.members ?? []));
  useEffect(load, [projectId]);
  const add = async () => {
    const response = await fetch(`/api/projects/${projectId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role: "editor" }),
    });
    const payload = await response.json().catch(() => ({}));
    setNotice(response.ok ? "成员已添加" : (payload.error ?? "添加失败"));
    if (response.ok) {
      setEmail("");
      await load();
    }
  };
  const updateRole = async (userId: string, role: string) => {
    await fetch(`/api/projects/${projectId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    await load();
  };
  const remove = async (userId: string) => {
    if (!window.confirm("确定移除该成员吗？")) return;
    await fetch(`/api/projects/${projectId}/members/${userId}`, {
      method: "DELETE",
    });
    await load();
  };
  return (
    <div className="platform-panel">
      <div className="platform-head">
        <div>
          <span className="eyebrow">PROJECT TEAM</span>
          <h2>团队成员</h2>
          <p>管理项目协作者和只读访问权限。</p>
        </div>
        <UsersRound size={24} />
      </div>
      <div className="field-row">
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="已注册用户邮箱"
        />
        <button className="primary-button" onClick={() => void add()}>
          添加成员
        </button>
      </div>
      {notice && <p className="save-hint">{notice}</p>}
      <div className="agent-list">
        {members.map((member) => (
          <div className="agent-row" key={member.userId}>
            <div>
              <strong>{member.email}</strong>
              <span>{member.role === "viewer" ? "只读" : "可编辑"}</span>
            </div>
            <div>
              <select
                value={member.role}
                onChange={(event) =>
                  void updateRole(member.userId, event.target.value)
                }
              >
                <option value="editor">可编辑</option>
                <option value="viewer">只读</option>
              </select>
              <button
                className="ghost-button"
                onClick={() => void remove(member.userId)}
              >
                移除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type AdminUserRow = {
  id: string;
  phone: string;
  phoneVerified: boolean;
  email: string;
  emailVerified: boolean;
  sourceType: string;
  inviteCode: string | null;
  schoolId: string | null;
  channelId: string | null;
  status: string;
  credits: number | null;
  projectCount: number;
  createdAt: string;
  lastLoginAt: string | null;
};

function AdminUsersPanel() {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void fetch(`/api/admin/users${reveal ? "?reveal=1" : ""}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "用户列表加载失败");
        setRows(payload.users ?? []);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "用户列表加载失败"));
  }, [reveal]);
  return <div className="platform-panel admin-users-panel">
    <div className="platform-head">
      <div><p className="eyebrow">ADMIN / USERS</p><h2>用户管理</h2><p>手机号和邮箱默认脱敏，仅管理员可临时查看完整信息。</p></div>
      <button className="secondary-button" onClick={() => { setError(""); setReveal((value) => !value); }}>{reveal ? "恢复脱敏" : "查看完整信息"}</button>
    </div>
    {error && <p className="form-error">{error}</p>}
    <div className="admin-users-table">
      <div className="admin-user-head"><span>用户 / 凭证</span><span>验证</span><span>来源</span><span>账户</span><span>时间 / 状态</span></div>
      {rows.map((user) => <div className="admin-user-row" key={user.id}>
        <span><b>{user.id}</b><small>{user.phone}<br />{user.email}</small></span>
        <span><small>手机 {user.phoneVerified ? "已验证" : "未验证"}<br />邮箱 {user.emailVerified ? "已验证" : "未验证"}</small></span>
        <span><small>{user.sourceType}<br />邀请码 {user.inviteCode ?? "—"}<br />学校 {user.schoolId ?? "—"} / 渠道 {user.channelId ?? "—"}</small></span>
        <span><small>{Number(user.credits ?? 0).toLocaleString()} 积分<br />{user.projectCount} 个项目</small></span>
        <span><small>{new Date(user.createdAt).toLocaleString("zh-CN")}<br />最近 {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("zh-CN") : "未记录"}</small><b className={user.status === "active" ? "status-active" : "status-disabled"}>{user.status === "active" ? "正常" : "禁用"}</b></span>
      </div>)}
    </div>
  </div>;
}

export default function Studio() {
  const [session, setSession] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [nodes, setNodes] = useNodesState(initialNodes);
  const [edges, setEdges] = useEdgesState(initialEdges);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [selectedId, setSelectedId] = useState("video");
  const [activeView, setActiveView] = useState("canvas");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (new URLSearchParams(window.location.search).get("view") === "credits") setActiveView("credits");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const [addIndex, setAddIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // 视频节点统一使用目录中的真实模型；非视频节点按节点类型匹配模型。
  const useRealVideo = true;
  const [videoModel, setVideoModel] = useState("seedance-2.5");
  const [videoCatalog, setVideoCatalog] = useState<VideoCatalogModel[]>([]);
  const [modelCatalog, setModelCatalog] = useState<VideoCatalogModel[]>([]);
  const [creditBalance, setCreditBalance] = useState(1000);
  const [, setHistoryTick] = useState(0);
  const historyRef = useRef<{
    past: Array<{ nodes: Node<CanvasNodeData>[]; edges: Edge[] }>;
    future: Array<{ nodes: Node<CanvasNodeData>[]; edges: Edge[] }>;
    lastKey: string;
    applying: boolean;
  }>({ past: [], future: [], lastKey: "", applying: false });
  const importRef = useRef<HTMLInputElement>(null);
  const projectLoadRef = useRef(false);
  const updateNode = (id: string, patch: Partial<CanvasNodeData>) =>
    setNodes((current) =>
      current.map((item) =>
        item.id === id ? { ...item, data: { ...item.data, ...patch } } : item,
      ),
    );

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        setSession(payload?.user?.email ?? payload?.user?.phone ?? null);
        setIsAdmin(Boolean(payload?.user?.isAdmin));
        setReady(true);
      })
      .catch(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!session) return;
    void fetch("/api/credits")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (payload?.balance !== undefined)
          setCreditBalance(Number(payload.balance));
      });
  }, [session]);

  useEffect(() => {
    void fetch("/api/models/catalog")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        const models = Array.isArray(payload?.models) ? payload.models : [];
        const typedModels = models as VideoCatalogModel[];
        setModelCatalog(typedModels);
        const videos = typedModels.filter((item) => item.type === "VIDEO_GENERATION");
        setVideoCatalog(videos);
        if (videos.some((item: VideoCatalogModel) => item.name === "seedance-2.5")) setVideoModel("seedance-2.5");
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!session) return;
    if (projectLoadRef.current) return;
    projectLoadRef.current = true;
    let cancelled = false;
    const loadProject = async () => {
      const response = await fetch("/api/projects");
      const payload = response.ok ? await response.json() : { projects: [] };
      const first = payload.projects?.[0];
      if (first) {
        if (!cancelled)
          setProject({
            ...first,
            nodeCount: initialNodes.length,
            status: "draft",
          });
        return;
      }
      const createdResponse = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "我的漫剧工作台",
          description: "Seedance 2.5 漫剧短片",
        }),
      });
      const createdPayload = await createdResponse.json().catch(() => ({}));
      if (!cancelled && createdResponse.ok && createdPayload.project)
        setProject({
          ...createdPayload.project,
          nodeCount: initialNodes.length,
          status: "draft",
        });
    };
    void loadProject();
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!project) return;
    Promise.all([
      fetch(`/api/projects/${project.id}/canvas`).then((response) =>
        response.json(),
      ),
      fetch(`/api/projects/${project.id}/jobs`).then((response) =>
        response.json(),
      ),
    ]).then(([canvas, jobPayload]) => {
      if (Array.isArray(canvas.nodes) && canvas.nodes.length) {
        const migrated = migrateCanvas(canvas.nodes, Array.isArray(canvas.edges) ? canvas.edges : []);
        setNodes(migrated.nodes);
        setEdges(migrated.edges);
      }
      else if (Array.isArray(canvas.edges)) setEdges(canvas.edges);
      setJobs((jobPayload.jobs ?? []).map(toClientJob));
      setCanvasReady(true);
    });
    const events = new EventSource(`/api/projects/${project.id}/events`);
    events.addEventListener("job", (event) => {
      const payload = JSON.parse((event as MessageEvent).data);
      const item = payload.event ?? payload;
      setJobs((current) => {
        const next = toClientJob(item);
        const previous = current.find((job) => job.id === next.id);
        if (item.status === "completed" && (item.nodeId ?? previous?.nodeId))
          setNodes((nodesCurrent) =>
            nodesCurrent.map((nodeItem) =>
              nodeItem.id === String(item.nodeId ?? previous?.nodeId)
                ? {
                    ...nodeItem,
                    data: {
                      ...nodeItem.data,
                      status: "completed",
                      output: "mock-video.svg · 可预览",
                    },
                  }
                : nodeItem,
            ),
          );
        return current.some((job) => job.id === next.id)
          ? current.map((job) =>
              job.id === next.id ? { ...job, ...next } : job,
            )
          : [next, ...current];
      });
    });
    return () => events.close();
  }, [project, setEdges, setNodes]);

  useEffect(() => {
    if (!project || !canvasReady) return;
    const timer = window.setTimeout(() => {
      void fetch(`/api/projects/${project.id}/canvas`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes, edges }),
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [nodes, edges, project, canvasReady]);

  useEffect(() => {
    if (!canvasReady) return;
    const key = JSON.stringify({ nodes, edges });
    const history = historyRef.current;
    if (!history.lastKey) {
      history.lastKey = key;
      return;
    }
    if (history.lastKey === key) return;
    if (history.applying) {
      history.applying = false;
      history.lastKey = key;
      return;
    }
    const previous = JSON.parse(history.lastKey) as {
      nodes: Node<CanvasNodeData>[];
      edges: Edge[];
    };
    history.past = [...history.past.slice(-30), previous];
    history.future = [];
    history.lastKey = key;
    setHistoryTick((tick) => tick + 1);
  }, [nodes, edges, canvasReady]);

  const selectedNode = nodes.find((item) => item.id === selectedId);
  const isVideoNode = (item?: Node<CanvasNodeData>) =>
    Boolean(item && nodeTypeForLabel(item.data.label) === "video");
  const completedCount = nodes.filter(
    (item) => item.data.status === "completed",
  ).length;
  const pendingCount = nodes.filter(
    (item) => item.data.status === "idle",
  ).length;
  const runNode = async (nodeId: string) => {
    if (!project) return;
    const currentNode = nodes.find((item) => item.id === nodeId);
    if (!currentNode || currentNode.data.status === "running") return;
    updateNode(nodeId, { status: "running" });
    const response = await fetch(`/api/projects/${project.id}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeId,
        mode: isVideoNode(currentNode) ? "I2V" : "edit",
        parameters: isVideoNode(currentNode) ? {
          real: useRealVideo,
          modelId: videoModel,
          duration: Number(videoCatalog.find((item) => item.name === videoModel)?.defaults?.duration ?? 5),
          aspectRatio: String(videoCatalog.find((item) => item.name === videoModel)?.defaults?.aspect_ratio ?? "16:9"),
          resolution: String(videoCatalog.find((item) => item.name === videoModel)?.defaults?.resolution ?? "720p"),
          generateAudio: true,
        } : { modelId: videoModel },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.job)
      setJobs((items) => {
        const next = toClientJob(payload.job);
        return items.some((job) => job.id === next.id)
          ? items
          : [next, ...items];
      });
    if (!response.ok) updateNode(nodeId, { status: "failed" });
  };
  const runPending = () =>
    nodes
      .filter((item) => item.data.status === "idle")
      .slice(0, 3)
      .forEach((item, index) =>
        window.setTimeout(() => runNode(item.id), index * 240),
      );
  const addNode = () => {
    const type = NODE_TYPES[addIndex % NODE_TYPES.length];
    const label =
      type === "composition_3d"
        ? "3D 构图"
        : type === "image_edit"
          ? "局部修复"
          : type === "style_polish"
            ? "风格优化"
            : type === "video"
              ? "Seedance 2.5"
              : type;
    setNodes((current) => [
      ...current,
      node(
        `${type}-${Date.now()}`,
        label,
        "新增节点，可连接到已有生产链",
        380 + (addIndex % 3) * 300,
        620 + Math.floor(addIndex / 3) * 150,
      ),
    ]);
    setAddIndex((value) => value + 1);
  };
  const addPluginNode = async () => {
    if (!project) return;
    const response = await fetch(`/api/projects/${project.id}/plugins`);
    const payload = await response.json().catch(() => ({}));
    const plugin = [...(payload.plugins ?? []), ...(payload.builtins ?? [])].find((item: { enabled?: number }) => item.enabled === undefined || item.enabled === 1);
    if (!plugin) return;
    const pluginType = String(plugin.config?.nodeType ?? "prompt") as CanvasNodeType;
    const id = `plugin-${plugin.slug}-${Date.now()}`;
    setNodes((current) => [...current, node(id, plugin.name, "插件节点，可连接到生产链", 520 + (current.length % 3) * 280, 650 + Math.floor(current.length / 3) * 130, { pluginSlug: plugin.slug, pluginType })]);
    setSelectedId(id);
  };
  const exportManifest = () => {
    const payload = JSON.stringify(
      {
        app: "镜界工坊",
        project,
        nodes,
        edges,
        jobs,
        exportedAt: new Date().toISOString(),
      },
      null,
      2,
    );
    const url = URL.createObjectURL(
      new Blob([payload], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project?.title ?? "jingjie-project"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const undo = () => {
    const history = historyRef.current;
    const previous = history.past.pop();
    if (!previous) return;
    history.future.push({ nodes, edges });
    history.applying = true;
    setNodes(previous.nodes);
    setEdges(previous.edges);
    setHistoryTick((tick) => tick + 1);
  };
  const redo = () => {
    const history = historyRef.current;
    const next = history.future.pop();
    if (!next) return;
    history.past.push({ nodes, edges });
    history.applying = true;
    setNodes(next.nodes);
    setEdges(next.edges);
    setHistoryTick((tick) => tick + 1);
  };
  const duplicateSelected = () => {
    const current = nodes.find((item) => item.id === selectedId);
    if (!current) return;
    const id = `${current.id}-copy-${Date.now()}`;
    setNodes((items) => [
      ...items,
      {
        ...current,
        id,
        position: { x: current.position.x + 40, y: current.position.y + 40 },
        selected: true,
      },
    ]);
    setSelectedId(id);
  };
  const deleteSelected = () => {
    if (!selectedId) return;
    setNodes((items) => items.filter((item) => item.id !== selectedId));
    setEdges((items) =>
      items.filter(
        (item) => item.source !== selectedId && item.target !== selectedId,
      ),
    );
    setSelectedId("");
  };
  const importManifest = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text()) as {
        nodes?: Node<CanvasNodeData>[];
        edges?: Edge[];
      };
      if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges))
        throw new Error("文件格式不正确");
      setNodes(payload.nodes);
      setEdges(payload.edges);
      setSelectedId(payload.nodes[0]?.id ?? "");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "导入失败");
    }
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      )
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "y"
      ) {
        event.preventDefault();
        redo();
      } else if (event.key === "Delete" || event.key === "Backspace")
        deleteSelected();
      else if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "d"
      ) {
        event.preventDefault();
        duplicateSelected();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  if (!ready) return <div className="loading-screen">加载镜界工坊…</div>;
  if (!session) return <AuthScreen onDone={setSession} />;
  if (!project) return <div className="loading-screen">正在准备工作台…</div>;

  const selectedIsVideo = isVideoNode(selectedNode);
  const inspectorProvider = selectedIsVideo ? videoModel : (selectedNode ? "自动匹配" : "未选择");
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <span className="brand-mark small">镜</span>
          <span>镜界工坊</span>
        </div>
        <div className="workspace-switch">
          <span className="workspace-dot" />
          <span>{project.title}</span>
          <button
            className="workspace-menu-trigger"
            aria-label="打开项目菜单"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <div className="workspace-menu">
              <button
                onClick={() => {
                  setActiveView("overview");
                  setMenuOpen(false);
                }}
              >
                项目设置
              </button>
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(project.id);
                  setMenuOpen(false);
                }}
              >
                复制项目 ID
              </button>
              <button
                onClick={() => {
                  exportManifest();
                  setMenuOpen(false);
                }}
              >
                导出项目
              </button>
              <button
                className="danger-menu-item"
                onClick={async () => {
                  if (
                    !window.confirm(
                      "确定删除这个项目吗？项目画布、任务和产物记录都会被删除。",
                    )
                  )
                    return;
                  const response = await fetch(`/api/projects/${project.id}`, {
                    method: "DELETE",
                  });
                  if (response.ok) {
                    setMenuOpen(false);
                    window.location.reload();
                  }
                }}
              >
                删除项目
              </button>
            </div>
          )}
        </div>
        <nav>
          <p className="nav-label">WORKSPACE</p>
          <button
            className={
              activeView === "overview" ? "nav-item active" : "nav-item"
            }
            onClick={() => setActiveView("overview")}
          >
            <FolderKanban size={17} />
            项目概览
          </button>
          <button
            className={activeView === "canvas" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveView("canvas")}
          >
            <Workflow size={17} />
            生产画布<span className="nav-count">{nodes.length}</span>
          </button>
          <button
            className={activeView === "assets" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveView("assets")}
          >
            <Layers3 size={17} />
            资产库
          </button>
          <button
            className={activeView === "tasks" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveView("tasks")}
          >
            <Film size={17} />
            任务中心<span className="nav-count">{jobs.length}</span>
          </button>
          <button
            className={activeView === "credits" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveView("credits")}
          >
            <Coins size={17} />
            积分账户
          </button>
          <p className="nav-label second">LIBRARY</p>
          <button
            className={
              activeView === "outline" ? "nav-item active" : "nav-item"
            }
            onClick={() => setActiveView("outline")}
          >
            <Sparkles size={17} />
            大纲库
          </button>
          <button
            className={activeView === "agents" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveView("agents")}
          >
            <WandSparkles size={17} />
            Agent / Skill
          </button>
          <button
            className={
              activeView === "workflows" ? "nav-item active" : "nav-item"
            }
            onClick={() => setActiveView("workflows")}
          >
            <Workflow size={17} />
            工作流模板
          </button>
          <button
            className={
              activeView === "assistant" ? "nav-item active" : "nav-item"
            }
            onClick={() => setActiveView("assistant")}
          >
            <MessageCircle size={17} />
            画布助手
          </button>
          <button
            className={
              activeView === "prompts" ? "nav-item active" : "nav-item"
            }
            onClick={() => setActiveView("prompts")}
          >
            <BookOpen size={17} />
            提示词库
          </button>
          <button
            className={
              activeView === "plugins" ? "nav-item active" : "nav-item"
            }
            onClick={() => setActiveView("plugins")}
          >
            <Puzzle size={17} />
            插件节点
          </button>
          <button
            className={activeView === "models" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveView("models")}
          >
            <Settings2 size={17} />
            模型脚本
          </button>
          <button
            className={
              activeView === "members" ? "nav-item active" : "nav-item"
            }
            onClick={() => setActiveView("members")}
          >
            <UsersRound size={17} />
            团队成员
          </button>
          {isAdmin && <button
            className={activeView === "users" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveView("users")}
          >
            <UsersRound size={17} />
            用户管理
          </button>}
        </nav>
        <div className="sidebar-bottom">
          <div className="credit-card">
            <span>我的积分</span>
            <strong>{creditBalance.toLocaleString()}</strong>
            <small>当前为免费体验 · Mock 任务不扣分</small>
          </div>
          <button
            className="user-row"
            onClick={() => {
              void fetch("/api/auth/logout", { method: "POST" });
              setSession(null);
              setIsAdmin(false);
            }}
          >
            <span className="avatar">{session[0]?.toUpperCase()}</span>
            <span>
              <b>{session.split("@")[0]}</b>
              <small>服务端 Session</small>
            </span>
            <LogIn size={15} />
          </button>
        </div>
      </aside>
      <section className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">PROJECT / {project.title.toUpperCase()}</p>
            <h1>
              {activeView === "canvas"
                ? "生产画布"
                : activeView === "credits"
                  ? "积分账户"
                : activeView === "tasks"
                  ? "任务中心"
                  : activeView === "assets"
                    ? "资产库"
                    : activeView === "outline"
                      ? "大纲库"
                      : activeView === "agents"
                        ? "Agent / Skill"
                        : activeView === "workflows"
                          ? "工作流模板"
                          : activeView === "assistant"
                            ? "画布助手"
                            : activeView === "prompts"
                              ? "提示词库"
                              : activeView === "plugins"
                                ? "插件节点"
                                : activeView === "models"
                                  ? "模型脚本"
                                  : activeView === "members"
                                    ? "团队成员"
                                    : activeView === "users"
                                      ? "用户管理"
                                    : "项目概览"}
            </h1>
          </div>
          <div className="top-actions">
            <span className="save-status">
              <span className="save-dot" />
              已自动保存
            </span>
            <button className="icon-button" title="撤销" onClick={undo}>
              <RotateCcw size={16} />
            </button>
            <button className="icon-button" title="重做" onClick={redo}>
              <RotateCw size={16} />
            </button>
            <button className="secondary-button" onClick={exportManifest}>
              <Download size={16} />
              导出项目
            </button>
            <button
              className="secondary-button"
              onClick={() => importRef.current?.click()}
            >
              <Upload size={16} />
              导入画布
            </button>
            <input
              ref={importRef}
              type="file"
              accept="application/json"
              hidden
              onChange={importManifest}
            />
            <button className="primary-button compact" onClick={runPending}>
              <Play size={16} />
              运行待处理
            </button>
          </div>
        </header>
        {activeView === "assets" && <AssetLibrary projectId={project.id} />}
        {activeView === "credits" && <CreditWallet onBalanceChange={setCreditBalance} />}
        {(activeView === "outline" ||
          activeView === "agents" ||
          activeView === "workflows") && (
          <PlatformPanel projectId={project.id} view={activeView} />
        )}
        {activeView === "assistant" && (
          <AssistantPanel projectId={project.id} node={selectedNode} />
        )}
        {activeView === "prompts" && (
          <PromptLibraryPanel projectId={project.id} />
        )}
        {activeView === "plugins" && <PluginPanel projectId={project.id} />}
        {activeView === "models" && <ModelConfigPanel projectId={project.id} />}
        {activeView === "members" && <MembersPanel projectId={project.id} />}
        {activeView === "users" && isAdmin && <AdminUsersPanel />}
        {activeView !== "canvas" &&
          activeView !== "credits" &&
          activeView !== "assets" &&
          activeView !== "outline" &&
          activeView !== "agents" &&
          activeView !== "workflows" &&
          activeView !== "assistant" &&
          activeView !== "prompts" &&
          activeView !== "plugins" &&
          activeView !== "models" &&
          activeView !== "members" &&
          activeView !== "users" && (
            <ProjectEmpty
              activeView={activeView}
              onCanvas={() => setActiveView("canvas")}
            />
          )}
        {activeView === "canvas" && (
          <div className="canvas-layout">
            <div className="canvas-wrap">
              <div className="canvas-toolbar">
                <div>
                  <span className="toolbar-title">
                    EPISODE 01 / KEYFRAME MODE
                  </span>
                  <span className="toolbar-subtitle">
                    {completedCount}/{nodes.length} 节点完成 · {pendingCount}{" "}
                    待处理
                  </span>
                </div>
                <div className="toolbar-actions">
                  {edges.length === 0 && (
                    <button
                      className="ghost-button"
                      onClick={() => setEdges(initialEdges)}
                      title="恢复生产链的默认节点连线"
                    >
                      恢复默认连线
                    </button>
                  )}
                  <button className="ghost-button" onClick={() => { setNodes(initialNodes); setEdges(initialEdges); setSelectedId("prompt"); }}>
                    <Workflow size={15} />
                    载入工作流
                  </button>
                  <button className="ghost-button" onClick={addNode}>
                    <Plus size={15} />
                    添加节点
                  </button>
                  <button className="ghost-button" onClick={() => void addPluginNode()}>
                    <Puzzle size={15} />
                    插件节点
                  </button>
                  <button className="ghost-button" onClick={runPending}>
                    <Send size={15} />
                    批量生成
                  </button>
                  {isVideoNode(selectedNode) && (
                    <div className="real-video-controls">
                      <span className="platform-badge">已接入</span>
                      <select className="model-select" value={videoModel} onChange={(event) => setVideoModel(event.target.value)} aria-label="视频模型">
                        {(videoCatalog.length ? videoCatalog : [{ name: "seedance-2.5", displayName: "Seedance 2.5", type: "VIDEO_GENERATION", inputTypes: ["text", "image", "video", "audio"], defaults: { duration: 5, aspect_ratio: "16:9", resolution: "720p" } }]).map((model) => (
                          <option value={model.name} key={model.name}>{model.displayName} · {model.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <button
                    className="ghost-button"
                    onClick={duplicateSelected}
                    disabled={!selectedNode}
                  >
                    复制节点
                  </button>
                  <button
                    className="ghost-button"
                    onClick={deleteSelected}
                    disabled={!selectedNode}
                  >
                    删除节点
                  </button>
                </div>
              </div>
              <div className="flow-canvas">
                <InfiniteCanvasV2
                  nodes={nodes}
                  edges={edges}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onNodesChange={setNodes}
                  onEdgesChange={setEdges}
                  nodeRenderer={(item, selected) => <StudioNode data={item.data} selected={selected} />}
                />
              </div>
            </div>
            <aside className="inspector">
              <div className="inspector-head">
                <span className="eyebrow">NODE INSPECTOR</span>
                <button className="icon-button">
                  <MoreHorizontal size={16} />
                </button>
              </div>
              {selectedNode ? (
                <>
                  <div
                    className="selected-preview"
                    style={
                      {
                        "--node-accent":
                          palette[nodeTypeForLabel(selectedNode.data.label)]
                            .accent,
                      } as React.CSSProperties
                    }
                  >
                    <div className="preview-icon">
                      <Sparkles size={22} />
                    </div>
                    <div>
                      <span>
                        {selectedNode.data.status === "completed"
                          ? "已完成"
                          : "待处理"}
                      </span>
                      <strong>{selectedNode.data.label}</strong>
                    </div>
                  </div>
                  <label className="field-label">
                    节点说明
                    <textarea
                      value={selectedNode.data.description}
                      onChange={(event) =>
                        updateNode(selectedNode.id, {
                          description: event.target.value,
                        })
                      }
                    />
                  </label>
                  <div className="field-row">
                    <div>
                      <span className="field-label">模型</span>
                      <div className="select-like">{inspectorProvider}</div>
                    </div>
                    <div>
                      <span className="field-label">状态</span>
                      <div className="select-like">
                        {selectedNode.data.status}
                      </div>
                    </div>
                  </div>
                  {!selectedIsVideo && modelCatalog.length > 0 && (
                    <label className="field-label model-field">
                      生成模型
                      <select className="model-select inspector-model" value={videoModel} onChange={(event) => setVideoModel(event.target.value)}>
                        {modelCatalog.map((model) => (
                          <option value={model.name} key={model.name}>{model.displayName} · {model.name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {selectedIsVideo && useRealVideo && (
                    <div className="model-summary">
                      <span className="field-label">实际模型</span>
                      <strong>{videoCatalog.find((item) => item.name === videoModel)?.displayName ?? "Seedance 2.5"}</strong>
                      <small>{videoModel}</small>
                    </div>
                  )}
                  {selectedNode.data.output && (
                    <div className="result-box">
                      <span>最新输出</span>
                      <strong>{selectedNode.data.output}</strong>
                      {selectedNode.id === "video" && !useRealVideo && (
                        <Image
                          src="/demo/mock-video.svg"
                          alt="Mock Seedance 2.5 预览"
                          width={240}
                          height={135}
                        />
                      )}
                      {selectedNode.id === "video" && useRealVideo && (
                        <small className="result-hint">真实视频生成完成后将在此显示结果链接</small>
                      )}
                    </div>
                  )}
                  <button
                    className="primary-button full"
                    onClick={() => runNode(selectedNode.id)}
                  >
                    <Play size={16} />
                    {isVideoNode(selectedNode)
                      ? `运行 ${videoCatalog.find((item) => item.name === videoModel)?.displayName ?? "Seedance 2.5"}`
                      : "运行此节点"}
                  </button>
                  <p className="inspector-note">
                    {selectedIsVideo && useRealVideo
                      ? "当前任务将提交到所选视频模型，完成后回写到画布。"
                      : "当前节点使用自动匹配的生成模型。"}
                  </p>
                </>
              ) : (
                <p className="empty-copy">选择一个节点开始编辑。</p>
              )}
            </aside>
          </div>
        )}
        {activeView === "canvas" && (
          <footer className="statusbar">
            <span>
              <span className="status-dot green" />
              系统正常
            </span>
        <span>模型服务已连接</span>
            <span>PostgreSQL / Redis / MinIO 已在 Docker 编排中预留</span>
            <span className="status-right">v0.1 MVP</span>
          </footer>
        )}
      </section>
    </main>
  );
}
