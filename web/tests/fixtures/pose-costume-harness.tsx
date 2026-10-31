// Browser-only fixture. Served by pose-costume-browser.mjs, never imported by the application.
import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../src/styles/globals.css";
import { registerPoseCostumeNode } from "../../src/components/canvas/nodes/pose-costume-node";
import { getNodeDefinition } from "../../src/lib/canvas/node-registry";
import { POSE_COSTUME_NODE_TYPE } from "../../src/lib/canvas/pose-costume";
import { canvasThemes } from "../../src/lib/canvas-theme";
import { getAntThemeConfig } from "../../src/lib/app-theme";
import { useConfigStore, defaultConfig } from "../../src/stores/use-config-store";
import type { CanvasNodeData } from "../../src/types/canvas";
import type { CanvasNodeContext } from "../../src/types/canvas-plugin";

registerPoseCostumeNode();
const dark = new URLSearchParams(location.search).get("theme") === "dark";
document.documentElement.classList.toggle("dark", dark);
useConfigStore.setState({
    config: {
        ...defaultConfig,
        imageModel: "managed::test.image",
        channels: [{ id: "managed", name: "平台测试", baseUrl: "/api/token360", apiKey: "server-managed", apiFormat: "openai", managed: true, models: [{ name: "test.image", capability: "image", modes: ["i2i"], limits: { maxImages: 3 } }] }],
    },
});
const initial = await fetch("/__pose-test-state").then((response) => response.json());
function Harness() {
    const [nodes, setNodes] = useState<CanvasNodeData[]>(initial.nodes);
    const ref = useRef(nodes);
    const save = async () => {
        await fetch("/__pose-test-state", { method: "PUT", body: JSON.stringify({ nodes: ref.current }) });
        return true;
    };
    const change = (value: CanvasNodeData[]) => {
        ref.current = value;
        setNodes(value);
        void save();
    };
    const node = nodes.find((item) => item.id === "library-b")!;
    const definition = getNodeDefinition(POSE_COSTUME_NODE_TYPE)!;
    const Panel = definition.Panel!;
    const ctx = {
        projectId: "project-b",
        node,
        theme: canvasThemes[dark ? "dark" : "light"],
        scale: 1,
        isSelected: true,
        prepareGeneration: save,
        getNode: (id: string) => ref.current.find((item) => item.id === id) || null,
        getNodes: () => ref.current,
        getConnections: () => [],
        getUpstream: () => [],
        getDownstream: () => [],
        updateMetadata: (patch: object) => change(ref.current.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, ...patch } } : item))),
        applyOps: (ops: any[]) => {
            let next = ref.current;
            for (const op of ops) {
                if (op.type === "add_node") next = [...next, { ...op, type: op.nodeType, id: op.id || crypto.randomUUID(), width: op.width || 420, height: op.height || 240 }];
                if (op.type === "update_node") next = next.map((item) => (item.id === op.id ? { ...item, metadata: { ...item.metadata, ...op.metadata } } : item));
            }
            change(next);
        },
        openPanel() {},
        closePanel() {},
        emit() {},
        on: () => () => {},
        storage: {},
        ai: {},
        updateNode() {},
    } as CanvasNodeContext;
    return (
        <>
            <Panel ctx={ctx} onClose={() => {}} />
            <output data-testid="node-count">{nodes.length}</output>
        </>
    );
}
createRoot(document.getElementById("root")!).render(
    <ConfigProvider theme={getAntThemeConfig(dark)}>
        <App>
            <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                <Harness />
            </QueryClientProvider>
        </App>
    </ConfigProvider>,
);
