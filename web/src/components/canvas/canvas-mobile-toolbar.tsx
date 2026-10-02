import { Button } from "antd";
import { Image as ImageIcon, Redo2, Trash2, Type, Undo2, Upload, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasMobileToolbar({
    canUndo,
    canRedo,
    hasSelection,
    onUndo,
    onRedo,
    onAddText,
    onAddImage,
    onAddVideo,
    onUpload,
    onDelete,
}: {
    canUndo: boolean;
    canRedo: boolean;
    hasSelection: boolean;
    onUndo: () => void;
    onRedo: () => void;
    onAddText: () => void;
    onAddImage: () => void;
    onAddVideo: () => void;
    onUpload: () => void;
    onDelete: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const buttonClass = "!h-10 !w-10 !min-w-10 !rounded-xl !p-0";

    return (
        <div
            className="pointer-events-auto absolute inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-[65] flex h-14 items-center justify-center gap-1 rounded-2xl border px-2 shadow-xl backdrop-blur-xl"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
            data-canvas-no-zoom
        >
            <Button type="text" className={buttonClass} disabled={!canUndo} icon={<Undo2 className="size-4.5" />} aria-label="撤销" onClick={onUndo} />
            <Button type="text" className={buttonClass} disabled={!canRedo} icon={<Redo2 className="size-4.5" />} aria-label="重做" onClick={onRedo} />
            <span className="mx-1 h-6 w-px" style={{ background: theme.toolbar.border }} />
            <Button type="text" className={buttonClass} icon={<Type className="size-4.5" />} aria-label="添加文字" onClick={onAddText} />
            <Button type="text" className={buttonClass} icon={<ImageIcon className="size-4.5" />} aria-label="添加图片" onClick={onAddImage} />
            <Button type="text" className={buttonClass} icon={<Video className="size-4.5" />} aria-label="添加视频" onClick={onAddVideo} />
            <Button type="text" className={buttonClass} icon={<Upload className="size-4.5" />} aria-label="上传素材" onClick={onUpload} />
            {hasSelection ? <Button danger type="text" className={buttonClass} icon={<Trash2 className="size-4.5" />} aria-label="删除选中节点" onClick={onDelete} /> : null}
        </div>
    );
}
