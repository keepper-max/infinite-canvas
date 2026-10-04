import { Route } from "lucide-react";

import { CAMERA_MOTION_ACTIONS, CAMERA_MOTION_NODE_TYPE } from "@/lib/canvas/camera-motion";
import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import type { CanvasNodeContext, CanvasNodeDefinition, CanvasNodeResource } from "@/types/canvas-plugin";

function resource(node: CanvasNodeContext["node"]): CanvasNodeResource | null {
    return node.metadata?.content ? { kind: "image", url: node.metadata.content } : null;
}

function CameraMotionNodeContent({ ctx }: { ctx: CanvasNodeContext }) {
    const motion = ctx.node.metadata?.cameraMotion;
    const content = ctx.node.metadata?.content;
    if (content) {
        return (
            <div className="relative h-full w-full overflow-hidden">
                <img src={content} alt="运镜引导图" className="h-full w-full object-cover" draggable={false} />
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-8 text-white">
                    <span className="flex items-center gap-1.5 text-xs font-medium">
                        <Route className="size-3.5" />
                        运镜轨迹
                    </span>
                    <span className="text-[10px] opacity-75">{motion?.paths.length || 0} 条</span>
                </div>
            </div>
        );
    }
    return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-5 text-center" style={{ color: ctx.theme.node.text }}>
            <Route className="size-8" />
            <div className="text-sm font-semibold">运镜轨迹</div>
            <div className="text-xs" style={{ color: ctx.theme.node.muted }}>
                {motion?.paths
                    .map((path) => CAMERA_MOTION_ACTIONS.find((action) => action.value === path.action)?.label)
                    .filter(Boolean)
                    .join(" · ") || "等待保存轨迹"}
            </div>
        </div>
    );
}

const definition: CanvasNodeDefinition = {
    type: CAMERA_MOTION_NODE_TYPE,
    title: "运镜轨迹",
    description: "保存镜头运动路径与 Seedance 引导图",
    icon: <Route className="size-5" />,
    defaultSize: { width: 360, height: 240 },
    defaultMetadata: { status: "idle" },
    definitionVersion: 1,
    workflowKind: "camera.motion",
    minimapColor: "#22d3ee",
    showInCreateMenu: false,
    hidePanel: true,
    keepAspectRatio: () => true,
    resource,
    ports: [
        { id: "camera.motion.input", label: "原图", direction: "input", resourceTypes: ["image"], roles: ["data", "identity"], cardinality: "one" },
        { id: "camera.motion.output", label: "引导图", direction: "output", resourceTypes: ["image"], roles: ["composition", "motion"], cardinality: "many" },
    ],
    Content: CameraMotionNodeContent,
};

let registered = false;
export function registerCameraMotionNode() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions([definition], "builtin");
}
