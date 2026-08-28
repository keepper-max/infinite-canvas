"use client";

import Image from "next/image";
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Download,
  Film,
  FolderKanban,
  Image as ImageIcon,
  Layers3,
  LogIn,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  UserRound,
  WandSparkles,
  Workflow,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NODE_TYPES, type CanvasNodeData, type CanvasNodeType, type GenerationJob, type Project } from "@/lib/types";
import { providerForNode } from "@/lib/provider";

const palette: Record<CanvasNodeType, { accent: string; icon: typeof Sparkles }> = {
  prompt: { accent: "#9b8cff", icon: Sparkles }, character: { accent: "#f0b45c", icon: UserRound }, scene: { accent: "#62c7a7", icon: ImageIcon }, panorama: { accent: "#56a7e8", icon: Layers3 }, composition_3d: { accent: "#d68de7", icon: WandSparkles }, keyframe: { accent: "#e47e9b", icon: Film }, image_edit: { accent: "#efad6a", icon: WandSparkles }, style_polish: { accent: "#8e9de7", icon: Sparkles }, video: { accent: "#f4799c", icon: Film }, audio: { accent: "#68c8ca", icon: Sparkles }, output: { accent: "#bca36f", icon: Download },
};

const node = (id: string, label: string, description: string, x: number, y: number, extra: Partial<CanvasNodeData> = {}): Node<CanvasNodeData> => ({ id, type: "studio", position: { x, y }, data: { label, description, status: "idle", ...extra } });

const initialNodes: Node<CanvasNodeData>[] = [
  node("prompt", "创意提示词", "故事意图、风格与镜头目标", 40, 220), node("character", "角色三视图", "锁定身份、服装与姿态", 330, 40, { locked: true }), node("scene", "场景候选", "MJ 抽卡后的场景母版", 330, 260), node("panorama", "全景环境", "补足镜头移动空间", 620, 260), node("composition", "3D 构图", "机位、站位、比例与视线", 900, 260), node("keyframe", "关键帧", "将布局落成可用首帧", 1180, 260), node("edit", "局部修复", "Nano Banana 2 补全与修图", 1460, 260), node("polish", "风格优化", "保持构图的最后抛光", 1740, 260), node("video", "Seedance 2.5", "动作、运镜、声音与连续性", 2020, 260), node("output", "成片预览", "播放、复盘与下载", 2300, 260),
];

const initialEdges: Edge[] = [
  { id: "e-p-c", source: "prompt", target: "character", label: "身份提示", animated: true }, { id: "e-p-s", source: "prompt", target: "scene", label: "场景提示", animated: true }, { id: "e-s-p", source: "scene", target: "panorama", label: "环境参考" }, { id: "e-c-c", source: "character", target: "composition", label: "角色参考" }, { id: "e-p-c2", source: "panorama", target: "composition", label: "空间参考" }, { id: "e-c-k", source: "composition", target: "keyframe", label: "构图" }, { id: "e-k-e", source: "keyframe", target: "edit", label: "局部修复" }, { id: "e-e-p", source: "edit", target: "polish", label: "风格保持" }, { id: "e-p-v", source: "polish", target: "video", label: "I2V / R2V", animated: true }, { id: "e-v-o", source: "video", target: "output", label: "视频结果", animated: true },
];

function nodeTypeForLabel(label: string): CanvasNodeType {
  if (label === "Seedance 2.5") return "video";
  if (label === "角色三视图") return "character";
  if (label === "场景候选") return "scene";
  if (label === "全景环境") return "panorama";
  if (label === "3D 构图") return "composition_3d";
  if (label === "关键帧") return "keyframe";
  if (label === "局部修复") return "image_edit";
  if (label === "风格优化") return "style_polish";
  if (label === "成片预览") return "output";
  return "prompt";
}

function StudioNode({ data, selected }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const style = palette[nodeTypeForLabel(nodeData.label)];
  const Icon = style.icon;
  const statusLabel = nodeData.status === "running" ? "生成中" : nodeData.status === "completed" ? "已完成" : nodeData.status === "failed" ? "失败" : nodeData.locked ? "身份母版" : "待处理";
  return <div className={`studio-node ${selected ? "selected" : ""}`} style={{ "--node-accent": style.accent } as React.CSSProperties}><Handle type="target" position={Position.Left} /><div className="node-head"><span className="node-icon"><Icon size={15} /></span><span>{nodeData.label}</span><span className={`node-status ${nodeData.status}`}>{statusLabel}</span></div><div className="node-body">{nodeData.description}</div>{nodeData.output && <div className="node-output">{nodeData.output}</div>}<Handle type="source" position={Position.Right} /></div>;
}

const nodeTypes = { studio: StudioNode };

function AuthScreen({ onDone }: { onDone: (email: string) => void }) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setError(""); const endpoint = mode === "register" ? "/api/auth/register" : "/api/auth/login"; const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }); const payload = await response.json().catch(() => ({})); if (!response.ok) { setError(payload.error ?? "操作失败"); return; } onDone(payload.user.email); };
  return <main className="auth-shell"><div className="auth-card"><div className="brand-mark">镜</div><p className="eyebrow">JINGJIE STUDIO</p><h1>{mode === "register" ? "创建你的工作区" : "欢迎回到镜界"}</h1><p className="auth-copy">登录后创建项目，保存每一次画布和 Mock 任务。</p><form onSubmit={submit} className="auth-form"><label>邮箱<input type="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>密码<input type="password" placeholder="至少 6 位" value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} required /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button" type="submit"><LogIn size={17} />{mode === "register" ? "注册并继续" : "登录工作区"}</button></form><button className="link-button" onClick={() => setMode(mode === "register" ? "login" : "register")}>{mode === "register" ? "已有账号？登录" : "还没有账号？注册"}</button></div></main>;
}

function ProjectCreateScreen({ onCreated }: { onCreated: (project: Project) => void }) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const create = async (event: React.FormEvent) => { event.preventDefault(); setError(""); const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: title }) }); const payload = await response.json().catch(() => ({})); if (!response.ok) { setError(payload.error ?? "项目创建失败"); return; } onCreated({ ...payload.project, nodeCount: initialNodes.length, status: "draft" }); };
  return <main className="welcome-shell"><div className="welcome-top"><div className="brand-lockup"><span className="brand-mark small">镜</span><span>镜界工坊</span></div></div><section className="welcome-content compact-create"><p className="eyebrow">NEW PROJECT</p><h1>创建一个漫剧项目</h1><p>从角色母版开始，把整条生产链放进可回溯的画布。</p><form className="new-project-card" onSubmit={create}><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：雨夜的最后一班车" required /><button className="primary-button" type="submit"><Plus size={18} />创建项目</button>{error && <span className="form-error">{error}</span>}</form></section></main>;
}

function ProjectEmpty({ activeView, onCanvas }: { activeView: string; onCanvas: () => void }) {
  const title = activeView === "tasks" ? "任务会出现在这里" : activeView === "assets" ? "资产库正在等待你的第一张图" : "项目概览";
  return <div className="empty-view"><div className="empty-icon"><Layers3 size={28} /></div><h2>{title}</h2><p>当前 MVP 已把画布生产链准备好，切回“生产画布”即可继续。</p><button className="primary-button" onClick={onCanvas}>回到生产画布</button></div>;
}

function toClientJob(job: Record<string, unknown>): GenerationJob {
  return { id: String(job.id), nodeId: String(job.nodeId ?? ""), nodeLabel: String(job.nodeLabel ?? job.nodeId ?? "Mock 任务"), provider: String(job.provider ?? "mock"), model: String(job.model ?? job.modelId ?? "mock-seedance-2.5"), status: (job.status as GenerationJob["status"]) ?? "pending", progress: Number(job.progress ?? 0), createdAt: String(job.createdAt ?? new Date().toISOString()), error: job.errorReason ? String(job.errorReason) : undefined };
}

type AssetRecord = { id: string; name: string; kind: string; mimeType: string; size: number; contentUrl: string; createdAt: string };

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
    fetch(`/api/projects/${projectId}/assets`).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "资产加载失败");
      if (!cancelled) setItems(payload.assets ?? []);
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "资产加载失败"); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(""); setUploading(true);
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch(`/api/projects/${projectId}/assets`, { method: "POST", body: form });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "上传失败");
      setItems((current) => [payload.asset, ...current]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "上传失败"); } finally { setUploading(false); }
  };

  const remove = async (asset: AssetRecord) => {
    if (!window.confirm(`确定删除“${asset.name}”吗？`)) return;
    const response = await fetch(`/api/assets/${asset.id}`, { method: "DELETE" });
    if (!response.ok) { setError("删除失败，请稍后重试"); return; }
    setItems((current) => current.filter((item) => item.id !== asset.id));
  };

  return <div className="asset-library"><div className="asset-toolbar"><div><span className="eyebrow">PROJECT ASSETS</span><h2>资产库</h2><p>上传角色、场景、关键帧和音频，作为画布节点的可复用参考。</p></div><label className="primary-button asset-upload-button"><Plus size={16} />{uploading ? "上传中…" : "上传资产"}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,audio/mpeg,audio/wav" onChange={upload} disabled={uploading} /></label></div>{error && <p className="form-error">{error}</p>}{loading ? <div className="asset-loading">正在读取资产…</div> : items.length === 0 ? <div className="asset-empty"><div className="empty-icon"><Layers3 size={25} /></div><h3>还没有资产</h3><p>先上传一张角色三视图或场景参考图。</p></div> : <div className="asset-grid">{items.map((asset) => <article className="asset-card" key={asset.id}><div className="asset-thumb">{asset.mimeType.startsWith("image/") ? <Image src={asset.contentUrl} alt={asset.name} width={260} height={160} unoptimized /> : <div className="asset-file-icon"><Film size={27} /><span>{asset.kind.toUpperCase()}</span></div>}</div><div className="asset-card-body"><strong title={asset.name}>{asset.name}</strong><span>{formatAssetSize(asset.size)} · {new Date(asset.createdAt).toLocaleDateString("zh-CN")}</span></div><button className="asset-delete" onClick={() => void remove(asset)} aria-label={`删除 ${asset.name}`}>删除</button></article>)}</div>}</div>;
}

type PlatformData = { outline: { title?: string; content?: string }; agents: Array<{ id: string; name: string; kind: string; enabled: number }>; automations: Array<{ id: string; template: string; status: string; createdAt: string }> };

function PlatformPanel({ projectId, view }: { projectId: string; view: "outline" | "workflows" | "agents" }) {
  const [data, setData] = useState<PlatformData>({ outline: {}, agents: [], automations: [] });
  const [title, setTitle] = useState(""); const [content, setContent] = useState(""); const [notice, setNotice] = useState("");
  const load = async () => { const response = await fetch(`/api/projects/${projectId}/platform`); const payload = await response.json().catch(() => ({})); if (response.ok) { setData(payload); setTitle(payload.outline?.title ?? ""); setContent(payload.outline?.content ?? ""); } };
  // The platform panel hydrates its form fields from the server after mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [projectId]);
  const saveOutline = async () => { const response = await fetch(`/api/projects/${projectId}/platform`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, content }) }); setNotice(response.ok ? "大纲已保存" : "保存失败"); };
  const addAgent = async () => { const name = window.prompt("输入 Agent / Skill 名称", "分镜拆解 Agent"); if (!name) return; const response = await fetch(`/api/projects/${projectId}/platform`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "agent", name, kind: name.toLowerCase().includes("skill") ? "skill" : "agent" }) }); if (response.ok) await load(); };
  const runWorkflow = async (template: string) => { const response = await fetch(`/api/projects/${projectId}/platform`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template }) }); setNotice(response.ok ? "流水线草稿已创建，可在画布中继续执行" : "创建失败"); if (response.ok) await load(); };
  const toggleAgent = async (id: string, enabled: number) => { await fetch(`/api/projects/${projectId}/platform`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: id, enabled: !enabled }) }); await load(); };
  if (view === "outline") return <div className="platform-panel"><div className="platform-head"><div><span className="eyebrow">STORY LIBRARY</span><h2>大纲库</h2><p>把故事设定、人物关系和分集目标沉淀下来，作为画布提示词的长期底稿。</p></div><button className="primary-button" onClick={() => void saveOutline()}><Download size={16} />保存大纲</button></div><div className="outline-form"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="大纲标题，例如：雨夜的最后一班车" /><textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="写下故事梗概、角色动机、分集节奏和视觉基调…" />{notice && <span className="save-hint">{notice}</span>}</div></div>;
  if (view === "workflows") return <div className="platform-panel"><div className="platform-head"><div><span className="eyebrow">WORKFLOW LIBRARY</span><h2>工作流模板</h2><p>用预设生产链快速搭建项目，真实模型接入后只需替换 Provider。</p></div></div><div className="workflow-grid">{[{ name: "角色到视频", desc: "角色三视图 → 场景 → 构图 → 关键帧 → Mock 视频", count: "10 节点" }, { name: "关键帧修复", desc: "关键帧 → 局部修复 → 风格优化 → 输出", count: "4 节点" }, { name: "大纲到分镜", desc: "故事大纲 → 分集拆解 → 分镜提示 → 画布", count: "规划中" }].map((item) => <article className="workflow-card" key={item.name}><div className="workflow-card-top"><span className="workflow-number">01</span><span>{item.count}</span></div><h3>{item.name}</h3><p>{item.desc}</p><button className="ghost-button" onClick={() => void runWorkflow(item.name)}>使用模板 <Send size={14} /></button></article>)}</div>{notice && <span className="save-hint">{notice}</span>}</div>;
  return <div className="platform-panel"><div className="platform-head"><div><span className="eyebrow">AGENT / SKILL</span><h2>Agent 与 Skill</h2><p>为项目配置编剧、角色提取、分镜拆解等能力；这里只保存配置，不调用真实模型。</p></div><button className="primary-button" onClick={() => void addAgent()}><Plus size={16} />添加能力</button></div><div className="agent-list">{data.agents.length === 0 ? <div className="platform-empty"><Sparkles size={24} /><p>还没有配置能力，先添加一个分镜拆解 Agent。</p></div> : data.agents.map((agent) => <div className="agent-row" key={agent.id}><div><strong>{agent.name}</strong><span>{agent.kind === "skill" ? "Skill" : "Agent"}</span></div><button className={agent.enabled ? "toggle on" : "toggle"} onClick={() => void toggleAgent(agent.id, agent.enabled)}>{agent.enabled ? "已启用" : "已停用"}</button></div>)}</div></div>;
}

export default function Studio() {
  const [session, setSession] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [selectedId, setSelectedId] = useState("video");
  const [activeView, setActiveView] = useState("canvas");
  const [addIndex, setAddIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const projectLoadRef = useRef(false);
  const updateNode = (id: string, patch: Partial<CanvasNodeData>) => setNodes((current) => current.map((item) => item.id === id ? { ...item, data: { ...item.data, ...patch } } : item));

  useEffect(() => { fetch("/api/auth/me").then((response) => response.ok ? response.json() : null).then((payload) => { setSession(payload?.user?.email ?? null); setReady(true); }).catch(() => setReady(true)); }, []);

  useEffect(() => {
    if (!session) return;
    if (projectLoadRef.current) return;
    projectLoadRef.current = true;
    let cancelled = false;
    const loadProject = async () => {
      const response = await fetch("/api/projects");
      const payload = response.ok ? await response.json() : { projects: [] };
      const first = payload.projects?.[0];
      if (first) { if (!cancelled) setProject({ ...first, nodeCount: initialNodes.length, status: "draft" }); return; }
      const createdResponse = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "我的漫剧工作台", description: "Seedance 2.5 漫剧短片" }) });
      const createdPayload = await createdResponse.json().catch(() => ({}));
      if (!cancelled && createdResponse.ok && createdPayload.project) setProject({ ...createdPayload.project, nodeCount: initialNodes.length, status: "draft" });
    };
    void loadProject();
    return () => { cancelled = true; };
  }, [session]);

  useEffect(() => {
    if (!project) return;
    Promise.all([fetch(`/api/projects/${project.id}/canvas`).then((response) => response.json()), fetch(`/api/projects/${project.id}/jobs`).then((response) => response.json())]).then(([canvas, jobPayload]) => {
      if (Array.isArray(canvas.nodes) && canvas.nodes.length) setNodes(canvas.nodes);
      if (Array.isArray(canvas.edges)) setEdges(canvas.edges);
      setJobs((jobPayload.jobs ?? []).map(toClientJob));
      setCanvasReady(true);
    });
    const events = new EventSource(`/api/projects/${project.id}/events`);
    events.addEventListener("job", (event) => { const payload = JSON.parse((event as MessageEvent).data); const item = payload.event ?? payload; setJobs((current) => { const next = toClientJob(item); const previous = current.find((job) => job.id === next.id); if (item.status === "completed" && (item.nodeId ?? previous?.nodeId)) setNodes((nodesCurrent) => nodesCurrent.map((nodeItem) => nodeItem.id === String(item.nodeId ?? previous?.nodeId) ? { ...nodeItem, data: { ...nodeItem.data, status: "completed", output: "mock-video.svg · 可预览" } } : nodeItem)); return current.some((job) => job.id === next.id) ? current.map((job) => job.id === next.id ? { ...job, ...next } : job) : [next, ...current]; }); });
    return () => events.close();
  }, [project, setEdges, setNodes]);

  useEffect(() => {
    if (!project || !canvasReady) return;
    const timer = window.setTimeout(() => { void fetch(`/api/projects/${project.id}/canvas`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nodes, edges }) }); }, 700);
    return () => window.clearTimeout(timer);
  }, [nodes, edges, project, canvasReady]);

  const selectedNode = nodes.find((item) => item.id === selectedId);
  const completedCount = nodes.filter((item) => item.data.status === "completed").length;
  const pendingCount = nodes.filter((item) => item.data.status === "idle").length;
  const runNode = async (nodeId: string) => {
    if (!project) return;
    const currentNode = nodes.find((item) => item.id === nodeId); if (!currentNode || currentNode.data.status === "running") return;
    updateNode(nodeId, { status: "running" });
    const response = await fetch(`/api/projects/${project.id}/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nodeId, mode: nodeId === "video" ? "I2V" : "edit" }) });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.job) setJobs((items) => { const next = toClientJob(payload.job); return items.some((job) => job.id === next.id) ? items : [next, ...items]; });
    if (!response.ok) updateNode(nodeId, { status: "failed" });
  };
  const runPending = () => nodes.filter((item) => item.data.status === "idle").slice(0, 3).forEach((item, index) => window.setTimeout(() => runNode(item.id), index * 240));
  const addNode = () => { const type = NODE_TYPES[addIndex % NODE_TYPES.length]; const label = type === "composition_3d" ? "3D 构图" : type === "image_edit" ? "局部修复" : type === "style_polish" ? "风格优化" : type === "video" ? "Seedance 2.5" : type; setNodes((current) => [...current, node(`${type}-${Date.now()}`, label, "新增节点，可连接到已有生产链", 380 + (addIndex % 3) * 300, 620 + Math.floor(addIndex / 3) * 150)]); setAddIndex((value) => value + 1); };
  const exportManifest = () => { const payload = JSON.stringify({ app: "镜界工坊", project, nodes, edges, jobs, exportedAt: new Date().toISOString() }, null, 2); const url = URL.createObjectURL(new Blob([payload], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${project?.title ?? "jingjie-project"}.json`; anchor.click(); URL.revokeObjectURL(url); };
  const miniMapColor = (item: Node<CanvasNodeData>) => palette[nodeTypeForLabel(item.data.label)].accent;
  const onConnect = (connection: Connection) => setEdges((current) => addEdge({ ...connection, animated: true }, current));

  if (!ready) return <div className="loading-screen">加载镜界工坊…</div>;
  if (!session) return <AuthScreen onDone={setSession} />;
  if (!project) return <div className="loading-screen">正在准备工作台…</div>;

  const inspectorProvider = selectedNode ? providerForNode(selectedNode.id === "video" ? "video" : "prompt") : "Mock Studio";
  return <main className="app-shell"><aside className="sidebar"><div className="brand-lockup"><span className="brand-mark small">镜</span><span>镜界工坊</span></div><div className="workspace-switch"><span className="workspace-dot" /><span>{project.title}</span><button className="workspace-menu-trigger" aria-label="打开项目菜单" onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={16} /></button>{menuOpen && <div className="workspace-menu"><button onClick={() => { setActiveView("overview"); setMenuOpen(false); }}>项目设置</button><button onClick={() => { void navigator.clipboard?.writeText(project.id); setMenuOpen(false); }}>复制项目 ID</button><button onClick={() => { exportManifest(); setMenuOpen(false); }}>导出项目</button><button className="danger-menu-item" onClick={async () => { if (!window.confirm("确定删除这个项目吗？项目画布、任务和产物记录都会被删除。")) return; const response = await fetch(`/api/projects/${project.id}`, { method: "DELETE" }); if (response.ok) { setMenuOpen(false); window.location.reload(); } }}>删除项目</button></div>}</div><nav><p className="nav-label">WORKSPACE</p><button className={activeView === "overview" ? "nav-item active" : "nav-item"} onClick={() => setActiveView("overview")}><FolderKanban size={17} />项目概览</button><button className={activeView === "canvas" ? "nav-item active" : "nav-item"} onClick={() => setActiveView("canvas")}><Workflow size={17} />生产画布<span className="nav-count">{nodes.length}</span></button><button className={activeView === "assets" ? "nav-item active" : "nav-item"} onClick={() => setActiveView("assets")}><Layers3 size={17} />资产库</button><button className={activeView === "tasks" ? "nav-item active" : "nav-item"} onClick={() => setActiveView("tasks")}><Film size={17} />任务中心<span className="nav-count">{jobs.length}</span></button><p className="nav-label second">LIBRARY</p><button className={activeView === "outline" ? "nav-item active" : "nav-item"} onClick={() => setActiveView("outline")}><Sparkles size={17} />大纲库</button><button className={activeView === "agents" ? "nav-item active" : "nav-item"} onClick={() => setActiveView("agents")}><WandSparkles size={17} />Agent / Skill</button><button className={activeView === "workflows" ? "nav-item active" : "nav-item"} onClick={() => setActiveView("workflows")}><Workflow size={17} />工作流模板</button></nav><div className="sidebar-bottom"><div className="credit-card"><span>MOCK CREDITS</span><strong>1,000</strong><small>真实生成接入后启用账本</small></div><button className="user-row" onClick={() => { void fetch("/api/auth/logout", { method: "POST" }); setSession(null); }}><span className="avatar">{session[0]?.toUpperCase()}</span><span><b>{session.split("@")[0]}</b><small>服务端 Session</small></span><LogIn size={15} /></button></div></aside><section className="main-panel"><header className="topbar"><div><p className="eyebrow">PROJECT / {project.title.toUpperCase()}</p><h1>{activeView === "canvas" ? "生产画布" : activeView === "tasks" ? "任务中心" : activeView === "assets" ? "资产库" : activeView === "outline" ? "大纲库" : activeView === "agents" ? "Agent / Skill" : activeView === "workflows" ? "工作流模板" : "项目概览"}</h1></div><div className="top-actions"><span className="save-status"><span className="save-dot" />已自动保存</span><button className="icon-button" title="撤销"><RotateCcw size={16} /></button><button className="secondary-button" onClick={exportManifest}><Download size={16} />导出项目</button><button className="primary-button compact" onClick={runPending}><Play size={16} />运行待处理</button></div></header>{activeView === "assets" && <AssetLibrary projectId={project.id} />}{(activeView === "outline" || activeView === "agents" || activeView === "workflows") && <PlatformPanel projectId={project.id} view={activeView} />}{activeView !== "canvas" && activeView !== "assets" && activeView !== "outline" && activeView !== "agents" && activeView !== "workflows" && <ProjectEmpty activeView={activeView} onCanvas={() => setActiveView("canvas")} />}{activeView === "canvas" && <div className="canvas-layout"><div className="canvas-wrap"><div className="canvas-toolbar"><div><span className="toolbar-title">EPISODE 01 / KEYFRAME MODE</span><span className="toolbar-subtitle">{completedCount}/{nodes.length} 节点完成 · {pendingCount} 待处理</span></div><div className="toolbar-actions"><button className="ghost-button" onClick={addNode}><Plus size={15} />添加节点</button><button className="ghost-button" onClick={runPending}><Send size={15} />批量生成</button></div></div><div className="flow-canvas"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodeClick={(_, item) => setSelectedId(item.id)} fitView minZoom={0.25} maxZoom={1.5}><Background color="#d9d4ca" gap={24} size={1} /><Controls position="bottom-left" /><MiniMap position="bottom-right" nodeColor={miniMapColor} pannable zoomable /></ReactFlow></div></div><aside className="inspector"><div className="inspector-head"><span className="eyebrow">NODE INSPECTOR</span><button className="icon-button"><MoreHorizontal size={16} /></button></div>{selectedNode ? <><div className="selected-preview" style={{ "--node-accent": palette[nodeTypeForLabel(selectedNode.data.label)].accent } as React.CSSProperties}><div className="preview-icon"><Sparkles size={22} /></div><div><span>{selectedNode.data.status === "completed" ? "已完成" : "待处理"}</span><strong>{selectedNode.data.label}</strong></div></div><label className="field-label">节点说明<textarea value={selectedNode.data.description} onChange={(event) => updateNode(selectedNode.id, { description: event.target.value })} /></label><div className="field-row"><div><span className="field-label">Provider</span><div className="select-like">{inspectorProvider}</div></div><div><span className="field-label">状态</span><div className="select-like">{selectedNode.data.status}</div></div></div>{selectedNode.data.output && <div className="result-box"><span>最新输出</span><strong>{selectedNode.data.output}</strong>{selectedNode.id === "video" && <Image src="/demo/mock-video.svg" alt="Mock Seedance 2.5 预览" width={240} height={135} />}</div>}<button className="primary-button full" onClick={() => runNode(selectedNode.id)}><Play size={16} />{selectedNode.id === "video" ? "运行 Mock Seedance 2.5" : "运行此节点"}</button><p className="inspector-note">真实 Provider 接入后，这里会显示模型、参考资产、时长、比例和任务费用。</p></> : <p className="empty-copy">选择一个节点开始编辑。</p>}</aside></div>}{activeView === "canvas" && <footer className="statusbar"><span><span className="status-dot green" />系统正常</span><span>Mock Provider</span><span>PostgreSQL / Redis / MinIO 已在 Docker 编排中预留</span><span className="status-right">v0.1 MVP</span></footer>}</section></main>;
}
