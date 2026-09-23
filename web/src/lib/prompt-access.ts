type PromptAccessRecord = {
    title?: string;
    category?: string;
    tags?: string[];
};

const restrictedLabels = new Set(["nsfw", "r18", "r18+", "adult", "explicit", "成人", "色情", "情色"]);

function normalizeLabel(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, "");
}

function hasRestrictedLabel(value?: string) {
    if (!value) return false;
    const normalized = normalizeLabel(value);
    return normalized.includes("nsfw") || restrictedLabels.has(normalized);
}

export function isRestrictedPrompt(item: PromptAccessRecord) {
    return hasRestrictedLabel(item.title) || hasRestrictedLabel(item.category) || (item.tags || []).some(hasRestrictedLabel);
}

export function filterRestrictedPrompts<T extends PromptAccessRecord>(items: T[], includeRestricted = false) {
    return includeRestricted ? items : items.filter((item) => !isRestrictedPrompt(item));
}
