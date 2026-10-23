import type { KnowledgeGraphNode, KnowledgeGraphEdge } from "@/services/api/knowledge";
export type PointNode = KnowledgeGraphNode & { x: number; y: number; depth?: number };
export type LayoutCache = { positions: Record<string, { x: number; y: number }>; camera: { x: number; y: number; k: number } };
type Camera = LayoutCache["camera"];
type Callbacks = { select: (id: string) => void; open: (id: string) => void; settled: (cache: LayoutCache) => void; hover: (node: PointNode | null) => void; context?: (node: PointNode, x: number, y: number) => void };
export const GRAPH_MOTION_MS = 240;
const engines = new WeakMap<HTMLCanvasElement, GraphEngine>();
/** Read-only diagnostics used by the rendering benchmark and interaction tests. */
export const inspectGraph = (canvas: HTMLCanvasElement) => engines.get(canvas)?.snapshot();
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0) >>> 0;
export class GraphEngine {
    private ctx: CanvasRenderingContext2D;
    private worker: Worker;
    private nodes: PointNode[] = [];
    private edges: KnowledgeGraphEdge[] = [];
    private index = new Map<string, PointNode>();
    private born = new Map<string, number>();
    private camera: Camera = { x: 0, y: 0, k: 1 };
    private width = 1;
    private height = 1;
    private dpr = 1;
    private frame = 0;
    private destroyed = false;
    private hoverId: string | null = null;
    private selected: string | null = null;
    private centerId: string | null = null;
    private tween: { start: number; from: Camera; to: Camera } | null = null;
    private effectUntil = 0;
    private reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    private abort = new AbortController();
    private observer: ResizeObserver;
    private pointer: { id: number; x: number; y: number; camera: Camera; node: string | null; moved: boolean } | null = null;
    private touches = new Map<number, { x: number; y: number }>();
    private pinch: number | null = null;
    private lastUpNode: string | null = null;
    private doubleCandidate: string | null = null;
    private autoFit = true;
    private lastPaint = performance.now();
    private emphasis = new Map<string, number>();
    private opacity = new Map<string, number>();
    private edgeOpacity = new Map<string, number>();
    private frames = 0;
    private drawTotal = 0;
    private drawMax = 0;
    private physics = { alpha: 0, ended: true, ticks: 0, totalMs: 0, maxTickMs: 0 };
    private cached: LayoutCache | undefined;
    private restoredCamera = false;
    constructor(
        private canvas: HTMLCanvasElement,
        private callbacks: Callbacks,
        cache?: LayoutCache,
    ) {
        this.cached = cache;
        this.autoFit = !cache;
        this.ctx = canvas.getContext("2d")!;
        engines.set(canvas, this);
        this.worker = new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
        this.worker.onmessage = ({ data: m }) => {
            if (this.destroyed) return;
            for (const p of m.nodes) {
                const n = this.index.get(p.id);
                if (n) {
                    n.x = p.x;
                    n.y = p.y;
                }
            }
            this.physics = { alpha: m.alpha, ended: m.ended, ticks: m.ticks, totalMs: m.totalMs, maxTickMs: m.maxTickMs };
            this.canvas.dataset.simulating = String(!m.ended && !document.hidden);
            this.invalidate();
            if (m.ended) {
                if (this.autoFit && this.nodes.length && !this.centerId) {
                    this.fit(false);
                    this.autoFit = false;
                }
                this.callbacks.settled(this.cache());
            }
        };
        this.observer = new ResizeObserver(() => this.resize());
        this.observer.observe(canvas);
        this.resize();
        const opts = { signal: this.abort.signal };
        canvas.addEventListener(
            "wheel",
            (e) => {
                e.preventDefault();
                this.zoom(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY);
            },
            { ...opts, passive: false },
        );
        canvas.addEventListener("pointerdown", (e) => this.down(e), opts);
        canvas.addEventListener('contextmenu', e => { const node = this.pick(e.offsetX, e.offsetY); if (node) { e.preventDefault(); this.callbacks.context?.(node, e.clientX, e.clientY); } }, opts);
        canvas.addEventListener("pointermove", (e) => this.move(e), opts);
        canvas.addEventListener("pointerup", (e) => this.up(e), opts);
        canvas.addEventListener("pointercancel", (e) => this.up(e, true), opts);
        canvas.addEventListener(
            "pointerleave",
            () => {
                if (!this.pointer) this.hover(null);
            },
            opts,
        );
        canvas.addEventListener(
            "click",
            (e) => {
                if (e.detail === 1) this.doubleCandidate = this.lastUpNode;
            },
            opts,
        );
        canvas.addEventListener(
            "dblclick",
            (e) => {
                const id = this.doubleCandidate || this.pick(e.offsetX, e.offsetY)?.id;
                if (id) this.callbacks.open(id);
            },
            opts,
        );
        canvas.addEventListener(
            "keydown",
            (e) => {
                if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "Home", "Enter"].includes(e.key)) {
                    e.preventDefault();
                    if (e.key === "Home") this.fit();
                    else if (e.key === "Enter" && this.selected) this.callbacks.open(this.selected);
                    else if (["+", "=", "-"].includes(e.key)) this.zoom(e.key === "-" ? 0.8 : 1.25);
                    else {
                        this.camera.x += e.key === "ArrowRight" ? -45 : e.key === "ArrowLeft" ? 45 : 0;
                        this.camera.y += e.key === "ArrowDown" ? -45 : e.key === "ArrowUp" ? 45 : 0;
                        this.invalidate();
                    }
                }
            },
            opts,
        );
        document.addEventListener(
            "visibilitychange",
            () => {
                if (document.hidden && this.pointer?.node) {
                    this.worker.postMessage({ type: "drag", id: this.pointer.node, released: true });
                    this.pointer = null;
                    this.touches.clear();
                }
                this.worker.postMessage({ type: "pause", hidden: document.hidden });
                if (document.hidden) {
                    cancelAnimationFrame(this.frame);
                    this.frame = 0;
                    canvas.dataset.simulating = "false";
                } else this.invalidate();
            },
            opts,
        );
        window.addEventListener(
            "blur",
            () => {
                if (this.pointer?.node) this.worker.postMessage({ type: "drag", id: this.pointer.node, released: true });
                this.pointer = null;
                this.touches.clear();
                this.pinch = null;
                this.lastUpNode = null;
                this.doubleCandidate = null;
            },
            opts,
        );
        const media = matchMedia("(prefers-reduced-motion: reduce)");
        media.addEventListener(
            "change",
            () => {
                this.reduced = media.matches;
                this.worker.postMessage({ type: "reduced", value: this.reduced });
                this.tween = null;
                this.invalidate();
            },
            opts,
        );
    }
    private resize() {
        const rect = this.canvas.getBoundingClientRect(),
            oldW = this.width,
            oldH = this.height;
        this.width = rect.width;
        this.height = rect.height;
        this.dpr = devicePixelRatio || 1;
        this.canvas.width = Math.round(this.width * this.dpr);
        this.canvas.height = Math.round(this.height * this.dpr);
        if (!this.restoredCamera) {
            this.camera = this.cached?.camera ? { ...this.cached.camera } : { x: this.width / 2, y: this.height / 2, k: 1 };
            this.restoredCamera = true;
        } else {
            this.camera.x += (this.width - oldW) / 2;
            this.camera.y += (this.height - oldH) / 2;
        }
        this.invalidate();
    }
    setData(data: KnowledgeGraphNode[], edges: KnowledgeGraphEdge[], centerId: string | null, depths: Map<string, number>) {
        this.centerId = centerId;
        const now = performance.now();
        const prior = this.index;
        this.nodes = data.map((d, i) => {
            const old = prior.get(d.id),
                cached = this.cached?.positions[d.id];
            if (old) return Object.assign(old, d, { depth: depths.get(d.id) });
            const near = edges.map((e) => (e.source === d.id ? prior.get(e.target) : e.target === d.id ? prior.get(e.source) : undefined)).find(Boolean);
            const a = hash(d.id) * 2.399963229728653,
                r = near ? 35 : Math.sqrt(i + 1) * 28;
            this.born.set(d.id, now);
            return { ...d, x: cached?.x ?? (near?.x || 0) + Math.cos(a) * r, y: cached?.y ?? (near?.y || 0) + Math.sin(a) * r, depth: depths.get(d.id) };
        });
        this.index = new Map(this.nodes.map((n) => [n.id, n]));
        this.edges = edges.filter((e) => this.index.has(e.source) && this.index.has(e.target));
        this.worker.postMessage({ type: "data", nodes: this.nodes.map(({ id, x, y }) => ({ id, x, y })), edges: this.edges.map(({ source, target }) => ({ source, target })), warm: prior.size > 0 || Boolean(this.cached), reduced: this.reduced });
        this.worker.postMessage({ type: "pause", hidden: document.hidden });
        this.effectUntil = now + (this.nodes.length ? GRAPH_MOTION_MS : 0);
        this.invalidate();
    }
    setTheme() {
        this.invalidate();
    }
    hasCachedLayout() {
        return Boolean(this.cached && Object.keys(this.cached.positions).length);
    }
    select(id: string | null, move = true) {
        this.lastPaint = performance.now();
        this.selected = id && this.index.has(id) ? id : null;
        if (this.selected && move) this.focus(this.selected);
        this.effectUntil = performance.now() + GRAPH_MOTION_MS;
        this.invalidate();
    }
    focus(id: string) {
        const n = this.index.get(id);
        if (!n) return;
        this.autoFit = false;
        const k = Math.max(0.9, this.camera.k);
        this.animate({ x: this.width / 2 - n.x * k, y: this.height / 2 - n.y * k, k });
    }
    fit(manual = true) {
        if (!this.nodes.length) return;
        if (manual) this.autoFit = false;
        let left = Infinity,
            right = -Infinity,
            top = Infinity,
            bottom = -Infinity;
        for (const n of this.nodes) {
            left = Math.min(left, n.x);
            right = Math.max(right, n.x);
            top = Math.min(top, n.y);
            bottom = Math.max(bottom, n.y);
        }
        const k = Math.min(1.5, Math.max(0.08, Math.min((this.width - 100) / (right - left + 80), (this.height - 130) / (bottom - top + 80))));
        this.animate({ x: this.width / 2 - ((left + right) / 2) * k, y: this.height / 2 - ((top + bottom) / 2) * k, k });
    }
    zoom(factor: number, x = this.width / 2, y = this.height / 2) {
        this.autoFit = false;
        this.tween = null;
        const k = Math.max(0.08, Math.min(5, this.camera.k * factor)),
            ratio = k / this.camera.k;
        this.camera = { x: x - (x - this.camera.x) * ratio, y: y - (y - this.camera.y) * ratio, k };
        this.invalidate();
    }
    private animate(to: Camera) {
        if (this.reduced) {
            this.camera = to;
            this.tween = null;
        } else this.tween = { start: performance.now(), from: { ...this.camera }, to };
        this.invalidate();
    }
    private world(x: number, y: number) {
        return { x: (x - this.camera.x) / this.camera.k, y: (y - this.camera.y) / this.camera.k };
    }
    private radius(n: PointNode) {
        return 4.5 + Math.min(6, Math.sqrt(n.degree) * 0.7) + (n.id === this.centerId ? 3 : 0);
    }
    private pick(x: number, y: number) {
        const p = this.world(x, y);
        let found: PointNode | undefined,
            best = Infinity;
        for (const n of this.nodes) {
            const d = Math.hypot(n.x - p.x, n.y - p.y);
            if (d < Math.max(this.radius(n) + 5, 12 / this.camera.k) && d < best) {
                found = n;
                best = d;
            }
        }
        return found;
    }
    private down(e: PointerEvent) {
        if (e.button !== 0) return;
        this.autoFit = false;
        this.canvas.focus();
        this.canvas.setPointerCapture(e.pointerId);
        this.touches.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
        if (this.touches.size === 2) {
            const [a, b] = [...this.touches.values()];
            this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
            if (this.pointer?.node) this.worker.postMessage({ type: "drag", id: this.pointer.node, released: true });
            this.pointer = null;
            return;
        }
        this.tween = null;
        const n = this.pick(e.offsetX, e.offsetY);
        this.pointer = { id: e.pointerId, x: e.offsetX, y: e.offsetY, camera: { ...this.camera }, node: n?.id || null, moved: false };
    }
    private move(e: PointerEvent) {
        if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
        if (this.touches.size === 2) {
            const [a, b] = [...this.touches.values()],
                distance = Math.hypot(a.x - b.x, a.y - b.y);
            if (this.pinch) this.zoom(distance / this.pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
            this.pinch = distance;
            return;
        }
        const p = this.pointer;
        if (p && p.id === e.pointerId) {
            if (Math.hypot(e.offsetX - p.x, e.offsetY - p.y) > 4) p.moved = true;
            if (p.moved && p.node) {
                const world = this.world(e.offsetX, e.offsetY),
                    n = this.index.get(p.node)!;
                n.x = world.x;
                n.y = world.y;
                this.worker.postMessage({ type: "drag", id: p.node, ...world });
            } else if (p.moved) {
                this.camera.x = p.camera.x + e.offsetX - p.x;
                this.camera.y = p.camera.y + e.offsetY - p.y;
            }
            this.invalidate();
        } else this.hover(this.pick(e.offsetX, e.offsetY)?.id || null);
    }
    private up(e: PointerEvent, cancel = false) {
        this.touches.delete(e.pointerId);
        this.pinch = null;
        const p = this.pointer;
        if (p?.id !== e.pointerId) return;
        this.lastUpNode = !cancel && !p.moved ? p.node : null;
        if (p.node && p.moved) this.worker.postMessage({ type: "drag", id: p.node, released: true });
        if (!cancel && !p.moved) {
            if (p.node) this.callbacks.select(p.node);
            else {
                this.selected = null;
                this.hover(null);
            }
        }
        this.pointer = null;
        this.canvas.style.cursor = "grab";
        this.callbacks.settled(this.cache());
        this.invalidate();
    }
    private hover(id: string | null) {
        if (this.hoverId === id) return;
        this.hoverId = id;
        this.lastPaint = performance.now();
        this.canvas.style.cursor = id ? "pointer" : "grab";
        this.effectUntil = performance.now() + GRAPH_MOTION_MS;
        this.callbacks.hover(id ? this.index.get(id)! : null);
        this.invalidate();
    }
    private invalidate() {
        if (!this.destroyed && !document.hidden && !this.frame) this.frame = requestAnimationFrame((t) => this.draw(t));
    }
    private draw(now: number) {
        this.frame = 0;
        if (this.destroyed || document.hidden) return;
        const start = performance.now(),
            blend = this.reduced ? 1 : 1 - Math.exp(-Math.max(1, now - this.lastPaint) / (GRAPH_MOTION_MS / 4));
        this.lastPaint = now;
        if (this.tween) {
            const t = Math.min(1, (now - this.tween.start) / GRAPH_MOTION_MS),
                v = 1 - (1 - t) ** 3;
            for (const key of ["x", "y", "k"] as const) this.camera[key] = this.tween.from[key] + (this.tween.to[key] - this.tween.from[key]) * v;
            if (t === 1) {
                this.tween = null;
                this.callbacks.settled(this.cache());
            }
        }
        const ctx = this.ctx,
            style = getComputedStyle(this.canvas),
            text = style.getPropertyValue("--k-text").trim() || "#ddd",
            muted = style.getPropertyValue("--k-muted").trim() || "#888",
            paper = style.getPropertyValue("--k-paper").trim() || "#222",
            accent = style.getPropertyValue("--g-out").trim() || "#bda176",
            incoming = style.getPropertyValue("--g-in").trim() || "#779d9a";
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, this.width, this.height);
        ctx.fillStyle = muted;
        ctx.globalAlpha = 0.1;
        const grid = 80 * this.camera.k;
        if (grid > 24)
            for (let x = ((this.camera.x % grid) + grid) % grid; x < this.width; x += grid)
                for (let y = ((this.camera.y % grid) + grid) % grid; y < this.height; y += grid) {
                    ctx.beginPath();
                    ctx.arc(x, y, 0.7, 0, Math.PI * 2);
                    ctx.fill();
                }
        const focus = this.hoverId || this.selected || this.centerId,
            adjacent = new Set<string>(focus ? [focus] : []);
        for (const e of this.edges)
            if (e.source === focus || e.target === focus) {
                adjacent.add(e.source);
                adjacent.add(e.target);
            }
        const screen = (n: PointNode) => ({ x: n.x * this.camera.k + this.camera.x, y: n.y * this.camera.k + this.camera.y });
        for (const e of this.edges) {
            const a = screen(this.index.get(e.source)!),
                b = screen(this.index.get(e.target)!),
                direct = e.source === focus || e.target === focus;
            ctx.strokeStyle = direct ? (e.source === focus ? accent : incoming) : muted;
            const edgeKey = e.source + ":" + e.target,
                targetAlpha = direct ? 0.76 : focus ? 0.07 : 0.19,
                edgeAlpha = (this.edgeOpacity.get(edgeKey) ?? targetAlpha) + (targetAlpha - (this.edgeOpacity.get(edgeKey) ?? targetAlpha)) * blend;
            this.edgeOpacity.set(edgeKey, edgeAlpha);
            ctx.globalAlpha = edgeAlpha;
            ctx.lineWidth = direct ? 1.35 : 0.7;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            if (direct && this.camera.k > 0.55) {
                const angle = Math.atan2(b.y - a.y, b.x - a.x),
                    r = this.radius(this.index.get(e.target)!) * Math.sqrt(this.camera.k) + 3,
                    x = b.x - Math.cos(angle) * r,
                    y = b.y - Math.sin(angle) * r;
                ctx.fillStyle = ctx.strokeStyle;
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(x - Math.cos(angle - 0.45) * 6, y - Math.sin(angle - 0.45) * 6);
                ctx.lineTo(x - Math.cos(angle + 0.45) * 6, y - Math.sin(angle + 0.45) * 6);
                ctx.fill();
            }
        }
        const occupied = new Set<string>();
        ctx.font = "12px " + style.fontFamily;
        ctx.textBaseline = "middle";
        const ordered = [...this.nodes].sort((a, b) => Number(adjacent.has(b.id)) - Number(adjacent.has(a.id)) || b.degree - a.degree);
        for (const n of ordered) {
            const p = screen(n);
            if (p.x < -50 || p.x > this.width + 50 || p.y < -50 || p.y > this.height + 50) continue;
            const hot = n.id === focus,
                related = adjacent.has(n.id),
                enter = this.reduced ? 1 : Math.max(0, Math.min(1, (now - (this.born.get(n.id) || 0)) / GRAPH_MOTION_MS)),
                baseAlpha = focus && !related ? 0.23 : n.degree ? 1 : 0.5,
                depthAlpha = 1 / (1 + (n.depth || 0) * 0.13),
                weight = (this.emphasis.get(n.id) || 0) + (Number(hot) - (this.emphasis.get(n.id) || 0)) * blend,
                r = this.radius(n) * Math.sqrt(this.camera.k) * (1 + weight * 0.25) * Math.max(0.3, enter);
            this.emphasis.set(n.id, weight);
            const opacity = (this.opacity.get(n.id) ?? baseAlpha) + (baseAlpha - (this.opacity.get(n.id) ?? baseAlpha)) * blend;
            this.opacity.set(n.id, opacity);
            ctx.globalAlpha = opacity * enter * depthAlpha;
            if (hot) {
                ctx.strokeStyle = n.id === this.centerId ? accent : text;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.fillStyle = hot ? accent : n.degree ? text : muted;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
            const cell = Math.floor(p.x / 110) + ":" + Math.floor(p.y / 26);
            if (hot || (((related && this.camera.k > 0.45) || this.camera.k > 0.6) && !occupied.has(cell))) {
                occupied.add(cell);
                const label = n.title.length > 22 ? n.title.slice(0, 21) + "…" : n.title;
                ctx.globalAlpha = opacity * enter;
                ctx.lineWidth = 4;
                ctx.strokeStyle = paper;
                ctx.strokeText(label, p.x + r + 7, p.y);
                ctx.fillStyle = hot ? text : muted;
                ctx.fillText(label, p.x + r + 7, p.y);
            }
        }
        ctx.globalAlpha = 1;
        this.frames++;
        const ms = performance.now() - start;
        this.drawTotal += ms;
        this.drawMax = Math.max(this.drawMax, ms);
        this.canvas.dataset.frames = String(this.frames);
        this.canvas.dataset.nodes = String(this.nodes.length);
        this.canvas.dataset.alpha = String(this.physics.alpha);
        if (this.tween || (!this.reduced && now < this.effectUntil)) this.invalidate();
    }
    cache(): LayoutCache {
        return { positions: Object.fromEntries(this.nodes.map((n) => [n.id, { x: n.x, y: n.y }])), camera: { ...this.camera } };
    }
    snapshot() {
        return {
            nodes: this.nodes.map((n) => ({ ...n, screenX: n.x * this.camera.k + this.camera.x, screenY: n.y * this.camera.k + this.camera.y })),
            edges: this.edges,
            camera: { ...this.camera },
            frames: this.frames,
            meanDrawMs: this.frames ? this.drawTotal / this.frames : 0,
            maxDrawMs: this.drawMax,
            physics: { ...this.physics },
            hidden: document.hidden,
            reduced: this.reduced,
        };
    }
    destroy() {
        this.callbacks.settled(this.cache());
        this.destroyed = true;
        this.worker.terminate();
        this.observer.disconnect();
        this.abort.abort();
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        engines.delete(this.canvas);
        this.canvas.dataset.simulating = "false";
    }
}
