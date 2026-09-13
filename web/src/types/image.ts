export type ReferenceImage = {
    id: string;
    name: string;
    type: string;
    dataUrl: string;
    url?: string;
    storageKey?: string;
    assetId?: string;
    assetVersionId?: string;
    virtualPortraitId?: string;
    generationJobId?: string;
    role?: "first_frame" | "last_frame" | "identity" | "environment" | "composition" | "motion";
};
