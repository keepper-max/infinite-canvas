export type ReferenceRole = "character" | "pose" | "costume";
export type LocalizedReferenceLabel = { zh: string; en: string };
export type LibraryVariant = {
    id: string;
    angle: string;
    label: LocalizedReferenceLabel;
    thumbnail: string;
    original: string;
};
export type LibraryReference = {
    id: string;
    kind: ReferenceRole;
    code: string;
    title: LocalizedReferenceLabel;
    category: LocalizedReferenceLabel & { id: string };
    series: LocalizedReferenceLabel;
    extended: boolean;
    keywords: LocalizedReferenceLabel;
    source: string;
    portrait?: { section: "face" | "styling"; hair: string };
    variants: LibraryVariant[];
};
/** Only immutable asset identifiers and small descriptions are saved in the canvas. */
export type OutfitReference = {
    assetId: string;
    assetVersionId: string;
    name: string;
    mimeType: string;
    width?: number;
    height?: number;
    catalogId?: string;
    code?: string;
    variantId?: string;
    angle?: string;
    source?: string;
    license?: string;
};
export type OutfitSlots = Partial<Record<ReferenceRole, OutfitReference>>;
export type OutfitCombination = { id: string; name: string; slots: OutfitSlots; prompt: string; model: string };
export type OutfitRun = {
    operationId: string;
    jobId?: string;
    prompt: string;
    model: string;
    slots: OutfitSlots;
    parameters: Record<string, unknown>;
    status?: string;
};
export type PoseCostumeState = {
    slots?: OutfitSlots;
    favorites?: string[];
    combinations?: OutfitCombination[];
    prompt?: string;
    model?: string;
    run?: OutfitRun;
    resultNodeIds?: string[];
};
