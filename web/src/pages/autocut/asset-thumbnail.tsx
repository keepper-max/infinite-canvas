import { useState } from "react";
import { Film, ImageIcon, Volume2 } from "lucide-react";
import { theme } from "antd";
import type { CloudAssetVersion } from "@/services/api/assets";

export function AssetThumbnail({ version, mimeType, name }: { version?: CloudAssetVersion; mimeType?: string; name: string }) {
    const { token } = theme.useToken();
    const [failedSource, setFailedSource] = useState<string>();
    const mime = version?.mimeType || mimeType || "";
    const hasThumbnail = !!(version?.thumbnailStorageKey || version?.thumbnailUrl);
    const source = version && (hasThumbnail || mime.startsWith("image/"))
        ? `/api/media/asset-versions/${encodeURIComponent(version.id)}${hasThumbnail ? "?thumbnail=1" : ""}`
        : "";
    const Icon = mime.startsWith("audio/") ? Volume2 : mime.startsWith("image/") ? ImageIcon : Film;
    return (
        <span className="flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded" style={{ background: token.colorFillQuaternary, color: token.colorTextSecondary }}>
            {source && failedSource !== source ? (
                <img src={source} alt={`${name} 预览图`} loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setFailedSource(source)} />
            ) : <Icon size={18} aria-label={mime.startsWith("audio/") ? "音频素材" : "暂无预览图"} />}
        </span>
    );
}
