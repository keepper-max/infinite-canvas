"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import { Minus, Plus, Maximize2 } from "lucide-react";
import type { CanvasNodeData } from "@/lib/types";

type Props = {
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
  selectedId: string;
  onSelect: (id: string) => void;
  onNodesChange: (nodes: Node<CanvasNodeData>[]) => void;
  onEdgesChange: (edges: Edge[]) => void;
  nodeRenderer: (node: Node<CanvasNodeData>, selected: boolean) => React.ReactNode;
};

const NODE_WIDTH = 230;
const NODE_HEIGHT = 92;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Canvas core adapted from infinite-canvas: a browser-native infinite surface
 * with a server-owned node/edge model. Provider calls remain in our API layer.
 */
export function InfiniteCanvasV2({ nodes, edges, selectedId, onSelect, onNodesChange, onEdgesChange, nodeRenderer }: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ x: 24, y: 24, k: 0.86 });
  const [pan, setPan] = useState<{ id: number; x: number; y: number; ox: number; oy: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; ox: number; oy: number } | null>(null);
  const [link, setLink] = useState<{ source: string; x: number; y: number } | null>(null);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left - viewport.x) / viewport.k, y: (clientY - rect.top - viewport.y) / viewport.k };
  }, [viewport]);

  const updateNodePosition = useCallback((id: string, x: number, y: number) => {
    onNodesChange(nodes.map((item) => item.id === id ? { ...item, position: { x, y } } : item));
  }, [nodes, onNodesChange]);

  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      const point = toWorld(event.clientX, event.clientY);
      updateNodePosition(drag.id, drag.ox + (point.x - drag.x), drag.oy + (point.y - drag.y));
    };
    const up = () => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [drag, toWorld, updateNodePosition]);

  useEffect(() => {
    if (!pan) return;
    const move = (event: PointerEvent) => setViewport((value) => ({ ...value, x: pan.ox + event.clientX - pan.x, y: pan.oy + event.clientY - pan.y }));
    const up = () => setPan(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [pan]);

  useEffect(() => {
    if (!link) return;
    const move = (event: PointerEvent) => {
      const point = toWorld(event.clientX, event.clientY);
      setLink((value) => value ? { ...value, x: point.x, y: point.y } : null);
      const target = (event.target as Element | null)?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId ?? null;
      setHoverTarget(target && target !== link.source ? target : null);
    };
    const up = (event: PointerEvent) => {
      const target = (event.target as Element | null)?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
      if (target && target !== link.source) {
        const id = `e-${link.source}-${target}-${Date.now()}`;
        onEdgesChange([...edges, { id, source: link.source, target, animated: true, label: "参考" }]);
      }
      setHoverTarget(null); setLink(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [edges, link, onEdgesChange, toWorld]);

  const nodeMap = useMemo(() => new Map(nodes.map((item) => [item.id, item])), [nodes]);
  const edgePath = (edge: Edge) => {
    const source = nodeMap.get(edge.source); const target = nodeMap.get(edge.target);
    if (!source || !target) return null;
    const x1 = source.position.x + NODE_WIDTH; const y1 = source.position.y + NODE_HEIGHT / 2;
    const x2 = target.position.x; const y2 = target.position.y + NODE_HEIGHT / 2;
    const bend = Math.max(50, Math.abs(x2 - x1) * 0.42);
    return { d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`, x1, y1, x2, y2 };
  };

  const zoomAt = (factor: number) => setViewport((value) => ({ ...value, k: clamp(value.k * factor, 0.35, 2) }));
  const resetView = () => setViewport({ x: 24, y: 24, k: 0.86 });

  return (
    <div
      ref={surfaceRef}
      className="infinite-canvas-v2"
      onPointerDown={(event) => {
        const target = event.target as Element;
        if (target.closest("button,[data-node-id]")) return;
        if (event.button === 1 || event.button === 0) setPan({ id: event.pointerId, x: event.clientX, y: event.clientY, ox: viewport.x, oy: viewport.y });
        onSelect("");
      }}
      onWheel={(event) => {
        event.preventDefault();
        const factor = Math.pow(1.1, -event.deltaY / 100);
        setViewport((value) => ({ ...value, k: clamp(value.k * factor, 0.35, 2) }));
      }}
    >
      <div className="infinite-canvas-grid" style={{ backgroundPosition: `${viewport.x}px ${viewport.y}px`, backgroundSize: `${48 * viewport.k}px ${48 * viewport.k}px` }} />
      <div className="infinite-canvas-world" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})` }}>
        <svg className="infinite-canvas-edges" width="5000" height="3000" aria-hidden="true">
          <defs><marker id="canvas-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#a79edc" /></marker></defs>
          {edges.map((edge) => { const path = edgePath(edge); return path ? <path key={edge.id} d={path.d} className="canvas-edge" markerEnd="url(#canvas-arrow)" /> : null; })}
          {link && <path d={`M ${nodes.find((item) => item.id === link.source)?.position.x! + NODE_WIDTH} ${nodes.find((item) => item.id === link.source)?.position.y! + NODE_HEIGHT / 2} C ${link.x - 80} ${link.y}, ${link.x - 40} ${link.y}, ${link.x} ${link.y}`} className="canvas-edge draft" />}
        </svg>
        {nodes.map((item) => (
          <div
            key={item.id}
            data-node-id={item.id}
            className={`infinite-canvas-node ${selectedId === item.id ? "selected" : ""} ${hoverTarget === item.id ? "link-target" : ""}`}
            style={{ left: item.position.x, top: item.position.y, width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
            onPointerDown={(event) => {
              event.stopPropagation();
              onSelect(item.id);
              if (event.button !== 0) return;
              const point = toWorld(event.clientX, event.clientY);
              setDrag({ id: item.id, x: point.x, y: point.y, ox: item.position.x, oy: item.position.y });
            }}
          >
            <button className="canvas-handle target" aria-label="连接到此节点" data-canvas-no-zoom onPointerUp={() => undefined} />
            {nodeRenderer(item, selectedId === item.id)}
            <button
              className="canvas-handle source"
              aria-label="从此节点创建连接"
              data-canvas-no-zoom
              onPointerDown={(event) => {
                event.stopPropagation();
                const point = toWorld(event.clientX, event.clientY);
                setLink({ source: item.id, x: point.x, y: point.y });
              }}
            />
          </div>
        ))}
      </div>
      <div className="infinite-canvas-controls">
        <button onClick={() => zoomAt(1.15)} aria-label="放大"><Plus size={15} /></button>
        <button onClick={() => zoomAt(0.87)} aria-label="缩小"><Minus size={15} /></button>
        <button onClick={resetView} aria-label="重置视图"><Maximize2 size={14} /></button>
        <span>{Math.round(viewport.k * 100)}%</span>
      </div>
    </div>
  );
}
