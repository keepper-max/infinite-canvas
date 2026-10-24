import { platformRequest, PlatformApiError } from "./platform";
export type ImportTask = {
    id: string;
    filename: string;
    state: string;
    error: string | null;
    markdown: string | null;
    folder_id: string | null;
    bytes: number;
    sha256: string;
    converter: string | null;
    warnings: string[];
    pages: { page: number; characters: number }[];
    duplicateDocumentId: string | null;
    document_id: string | null;
    reparse_document_id: string | null;
    expected_revision: number | null;
    created_at: string;
    metrics: Record<string, number>;
};
const path = (space: string) => `/api/knowledge/${space}/imports`;
export const listImports = (space: string) => platformRequest<ImportTask[]>(path(space));
export const getImport = (space: string, id: string) => platformRequest<ImportTask>(path(space) + "/" + id);
export const getImportOperation = (space: string, id: string) => platformRequest<ImportTask>(path(space) + "/operations/" + id);
export const importChange = (space: string, id: string, action: "cancel" | "retry") => platformRequest<ImportTask>(path(space) + `/${id}/${action}`, { method: "POST" });
export const reparseImport = (space: string, id: string, operationId: string) => platformRequest<ImportTask>(path(space) + `/${id}/reparse`, { method: "POST", body: JSON.stringify({ operationId }) });
export const getImportSources = (space: string, doc: string) => platformRequest<{ id: string; filename: string; sha256: string; bytes: number; converter: string; document_revision: number }[]>(`/api/knowledge/${space}/documents/${doc}/sources`);
export const originalImportUrl = (space: string, id: string) => path(space) + `/${id}/original`;
export function uploadImport(space: string, operationId: string, file: File, folderId: string | null, onProgress: (n: number) => void): Promise<ImportTask> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", path(space));
        xhr.withCredentials = true;
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
        xhr.setRequestHeader("x-operation-id", operationId);
        if (folderId) xhr.setRequestHeader("x-folder-id", folderId);
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onerror = () => reject(new PlatformApiError("上传回执未确认；重选同一文件会查询并续用原操作", 0, "NETWORK_ERROR", true));
        xhr.onload = () => {
            let p;
            try {
                p = JSON.parse(xhr.responseText);
            } catch {
                reject(new Error("服务器返回格式无效，请重试"));
                return;
            }
            if (xhr.status >= 200 && xhr.status < 300) resolve(p.data);
            else reject(new PlatformApiError(p.error?.message || "上传失败", xhr.status, p.error?.code || "UPLOAD_ERROR", false));
        };
        xhr.send(file);
    });
}
