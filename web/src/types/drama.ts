export type DramaWorkflowKind =
    | "story.idea"
    | "story.writer"
    | "script.breakdown"
    | "character.profile"
    | "character.turnaround"
    | "scene.candidate"
    | "scene.panorama"
    | "prop.image"
    | "composition.3d"
    | "storyboard.plan"
    | "prompt.optimize"
    | "frame.first"
    | "frame.last"
    | "skill.seedance"
    | "video.seedance";

export type DramaAssetBinding = {
    role: "identity" | "environment" | "composition" | "motion" | "first_frame" | "last_frame" | "video_input" | "audio_input";
    nodeId: string;
    assetId?: string;
    assetVersionId?: string;
};

export type DramaCharacterCard = {
    name: string;
    identity: string;
    appearance: string;
    wardrobe: string;
    state: string;
    turnaroundVersionId?: string;
    voiceBinding?: string;
    shotIds: string[];
};

export type DramaStoryboardShot = {
    id: string;
    durationSec: number;
    shotSize: string;
    picture: string;
    action: string;
    camera: string;
    dialogue: string;
    characterIds: string[];
    sceneId: string;
    firstFrameStatus: "pending" | "running" | "completed" | "failed";
    videoStatus: "pending" | "running" | "completed" | "failed";
};

export type SeedanceSkillResult = {
    prompt: string;
    camera: string;
    motion: string;
    continuity: string[];
    audio: string;
    negative: string[];
    recommendedMode: "t2v" | "i2v" | "flf2v" | "multiref";
};

export type DramaNodeState = {
    schemaVersion: 1;
    brief?: string;
    output?: unknown;
    character?: DramaCharacterCard;
    shots?: DramaStoryboardShot[];
    skillResult?: SeedanceSkillResult;
    inputHash?: string;
    outputHash?: string;
    inputSnapshot?: Record<string, unknown>;
    assetBindings?: DramaAssetBinding[];
    stale?: boolean;
    accepted?: boolean;
    skillId?: string;
    skillVersion?: string;
    textModel?: string;
    userModified?: boolean;
    lastRunAt?: string;
};
