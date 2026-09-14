export type ReferenceVideo = {
    id: string;
    name: string;
    type: string;
    url: string;
    storageKey?: string;
    assetId?: string;
    assetVersionId?: string;
    bytes?: number;
    width?: number;
    height?: number;
    durationMs?: number;
    role?: "motion_reference" | "video_input";
};

export type ReferenceAudio = {
    id: string;
    name: string;
    type: string;
    url: string;
    storageKey?: string;
    assetId?: string;
    assetVersionId?: string;
    durationMs?: number;
};
