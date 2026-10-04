import { platformRequest } from "./platform";

export type DirectorSettings = { enabled: boolean; modelId: string | null; modelDisplayName: string | null };

export async function getDirectorSettings(signal?: AbortSignal) {
    return (await platformRequest<{ settings: DirectorSettings }>("/api/director/settings", { signal })).settings;
}
