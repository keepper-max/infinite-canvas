export type CameraMotionAction = "push_in" | "pull_out" | "truck_left" | "truck_right" | "pan" | "tilt" | "orbit" | "tracking" | "fly_through";

export type CameraMotionPoint = {
    x: number;
    y: number;
};

export type CameraMotionKeyframe = {
    id: string;
    progress: number;
    easing: "linear" | "ease_in" | "ease_out" | "ease_in_out";
};

export type CameraMotionPath = {
    id: string;
    color: string;
    action: CameraMotionAction;
    speed: "slow" | "medium" | "fast";
    rawPoints: CameraMotionPoint[];
    points: CameraMotionPoint[];
    keyframes: CameraMotionKeyframe[];
};

export type CameraMotionState = {
    schemaVersion: 1;
    sourceImageNodeId: string;
    paths: CameraMotionPath[];
    prompt: string;
    updatedAt: string;
};

export type CameraMotionEditorResult = {
    motion: CameraMotionState;
    guideBlob: Blob;
    generate: boolean;
};
