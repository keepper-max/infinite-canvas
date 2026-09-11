import type { CSSProperties } from "react";
import { Modal, Tag } from "antd";
import type { TFunction } from "i18next";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { getProductUpdates } from "@/constant/product-updates";

function getTagColor(type: string) {
    if (type === "新增" || type === "Added") return "green";
    if (type === "修复" || type === "Fixed") return "red";
    if (type === "调整" || type === "Changed") return "blue";
    if (type === "文档" || type === "Docs") return "purple";
    return "default";
}

function releaseTypeLabel(type: string, t: TFunction) {
    const key = ({ 新增: "added", 修复: "fixed", 调整: "changed", 优化: "optimized", 文档: "docs" } as Record<string, string>)[type];
    return key ? t(`version.types.${key}`) : type;
}

type VersionReleaseModalProps = {
    className?: string;
    style?: CSSProperties;
};

export function VersionReleaseModal({ className, style }: VersionReleaseModalProps) {
    const { i18n, t } = useTranslation();
    const [open, setOpen] = useState(false);
    const updates = getProductUpdates(i18n.resolvedLanguage);

    return (
        <>
            <button
                type="button"
                className={className || "shrink-0 cursor-pointer text-xs font-medium text-stone-500 transition hover:text-stone-950 dark:text-stone-400 dark:hover:text-white"}
                style={style}
                onClick={() => setOpen(true)}
                title={t("version.viewUpdates")}
                aria-label={t("version.viewUpdates")}
            >
                <Sparkles className="size-3.5" />
                <span>{t("version.publicLabel")}</span>
            </button>
            <Modal title={t("version.title")} open={open} width={680} centered footer={null} onCancel={() => setOpen(false)}>
                <div className="relative mb-6 overflow-hidden rounded-2xl border border-amber-200/70 bg-[linear-gradient(135deg,rgba(251,191,36,0.12),rgba(245,158,11,0.03)_45%,transparent)] p-5 dark:border-amber-900/60">
                    <div className="absolute -right-8 -top-10 size-32 rounded-full bg-amber-300/10 blur-2xl" />
                    <div className="relative flex items-start gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-stone-950 text-amber-300 dark:bg-stone-100 dark:text-amber-700">
                            <Sparkles className="size-4" />
                        </div>
                        <div>
                            <div className="font-semibold text-stone-950 dark:text-stone-100">{t("version.heroTitle")}</div>
                            <div className="mt-1 text-sm leading-6 text-stone-600 dark:text-stone-400">{t("version.heroDescription")}</div>
                        </div>
                    </div>
                </div>
                <div className="max-h-[56vh] overflow-y-auto pr-2">
                    <div className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-stone-400">{t("version.latestUpdate")}</div>
                    <div className="space-y-2">
                        {updates.map((item) => (
                            <div key={item.title} className="rounded-xl border border-stone-200/80 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/50">
                                <div className="flex items-center gap-2">
                                    <Tag color={getTagColor(item.type)} className="m-0 shrink-0 whitespace-nowrap">
                                        {releaseTypeLabel(item.type, t)}
                                    </Tag>
                                    <span className="font-medium text-stone-950 dark:text-stone-100">{item.title}</span>
                                </div>
                                <p className="mb-0 mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">{item.description}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </Modal>
        </>
    );
}
