import type { CameraMotionAction, CameraMotionPath, CameraMotionPoint, CameraMotionState } from "@/types/camera-motion";

export const CAMERA_MOTION_NODE_TYPE = "camera:motion-path";
export const CAMERA_MOTION_COLORS = ["#22d3ee", "#f97316", "#a78bfa", "#f43f5e", "#84cc16"];

export const CAMERA_MOTION_ACTIONS: Array<{ value: CameraMotionAction; label: string; prompt: string }> = [
    { value: "push_in", label: "推进", prompt: "镜头沿轨迹平稳推进" },
    { value: "pull_out", label: "拉远", prompt: "镜头沿轨迹平稳拉远" },
    { value: "truck_left", label: "左移", prompt: "镜头沿轨迹向左平移" },
    { value: "truck_right", label: "右移", prompt: "镜头沿轨迹向右平移" },
    { value: "pan", label: "横摇", prompt: "镜头按轨迹横向摇摄" },
    { value: "tilt", label: "俯仰", prompt: "镜头按轨迹上下俯仰" },
    { value: "orbit", label: "环绕", prompt: "镜头围绕主体按轨迹环绕" },
    { value: "tracking", label: "跟拍", prompt: "镜头按轨迹稳定跟随主体" },
    { value: "fly_through", label: "穿越", prompt: "镜头沿轨迹连续穿越空间" },
];

export function simplifyMotionPoints(points: CameraMotionPoint[], minDistance = 0.006) {
    if (points.length < 3) return points.map(clampPoint);
    const result = [clampPoint(points[0])];
    for (let index = 1; index < points.length - 1; index += 1) {
        const point = clampPoint(points[index]);
        const previous = result[result.length - 1];
        if (Math.hypot(point.x - previous.x, point.y - previous.y) >= minDistance) result.push(point);
    }
    result.push(clampPoint(points.at(-1)!));
    return result;
}

export function smoothMotionPoints(points: CameraMotionPoint[], subdivisions = 8) {
    const source = simplifyMotionPoints(points);
    if (source.length < 3) return source;
    const result: CameraMotionPoint[] = [];
    for (let index = 0; index < source.length - 1; index += 1) {
        const p0 = source[Math.max(0, index - 1)];
        const p1 = source[index];
        const p2 = source[index + 1];
        const p3 = source[Math.min(source.length - 1, index + 2)];
        for (let step = 0; step < subdivisions; step += 1) {
            const t = step / subdivisions;
            const t2 = t * t;
            const t3 = t2 * t;
            result.push(
                clampPoint({
                    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
                    y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
                }),
            );
        }
    }
    result.push(source.at(-1)!);
    return result;
}

export function buildCameraMotionPrompt(paths: CameraMotionPath[]) {
    const instructions = paths.map((path, index) => {
        const action = CAMERA_MOTION_ACTIONS.find((item) => item.value === path.action)?.prompt || "镜头沿轨迹运动";
        const speed = path.speed === "slow" ? "缓慢" : path.speed === "fast" ? "快速但稳定" : "中速平稳";
        const keyframes = path.keyframes.length ? `，经过 ${path.keyframes.length} 个关键停点` : "";
        return `轨迹${index + 1}：${action}，${speed}${keyframes}`;
    });
    return [`以参考图1作为最终画面与主体外观依据，参考图2仅作为运镜轨迹示意。`, ...instructions, "严格保持参考图1的主体、场景、服装、材质和画面风格，不要在成片中出现轨迹线、箭头、圆点、数字、标记或文字。"].join("\n");
}

export function createCameraMotionState(sourceImageNodeId: string, paths: CameraMotionPath[]): CameraMotionState {
    return { schemaVersion: 1, sourceImageNodeId, paths, prompt: buildCameraMotionPrompt(paths), updatedAt: new Date().toISOString() };
}

export function drawCameraMotionGuide(context: CanvasRenderingContext2D, width: number, height: number, paths: CameraMotionPath[], selectedPathId?: string) {
    paths.forEach((path, pathIndex) => {
        if (path.points.length < 2) return;
        const scale = Math.max(1, Math.min(width, height) / 900);
        context.save();
        context.lineCap = "round";
        context.lineJoin = "round";
        context.strokeStyle = path.color;
        context.lineWidth = (path.id === selectedPathId ? 6 : 4) * scale;
        context.shadowColor = "rgba(0,0,0,.55)";
        context.shadowBlur = 5 * scale;
        context.beginPath();
        path.points.forEach((point, index) => {
            const x = point.x * width;
            const y = point.y * height;
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
        });
        context.stroke();
        drawArrow(context, path.points.at(-2)!, path.points.at(-1)!, width, height, path.color, scale);
        drawMarker(context, path.points[0], width, height, path.color, `${pathIndex + 1}`, scale);
        path.keyframes.forEach((keyframe, index) => drawMarker(context, pointAtProgress(path.points, keyframe.progress), width, height, path.color, `${pathIndex + 1}.${index + 1}`, scale * 0.8));
        context.restore();
    });
}

export async function exportCameraMotionGuide(image: Blob, paths: CameraMotionPath[], width: number, height: number) {
    const bitmap = await createImageBitmap(image);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法创建运镜引导图");
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    drawCameraMotionGuide(context, width, height, paths);
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("运镜引导图导出失败"))), "image/png"));
}

function pointAtProgress(points: CameraMotionPoint[], progress: number) {
    if (points.length < 2) return points[0] || { x: 0.5, y: 0.5 };
    const index = Math.max(0, Math.min(points.length - 1, Math.round(progress * (points.length - 1))));
    return points[index];
}

function drawMarker(context: CanvasRenderingContext2D, point: CameraMotionPoint, width: number, height: number, color: string, label: string, scale: number) {
    const x = point.x * width;
    const y = point.y * height;
    const radius = 13 * scale;
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#ffffff";
    context.font = `700 ${Math.max(9, 12 * scale)}px ui-sans-serif, system-ui`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, x, y);
}

function drawArrow(context: CanvasRenderingContext2D, from: CameraMotionPoint, to: CameraMotionPoint, width: number, height: number, color: string, scale: number) {
    const x = to.x * width;
    const y = to.y * height;
    const angle = Math.atan2((to.y - from.y) * height, (to.x - from.x) * width);
    const size = 22 * scale;
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x - size * Math.cos(angle - Math.PI / 6), y - size * Math.sin(angle - Math.PI / 6));
    context.lineTo(x - size * Math.cos(angle + Math.PI / 6), y - size * Math.sin(angle + Math.PI / 6));
    context.closePath();
    context.fill();
}

function clampPoint(point: CameraMotionPoint) {
    return { x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) };
}
