import { Button, Drawer } from "antd";
import { MessageSquareText } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { UserStatusActions } from "@/components/layout/user-status-actions";

type MobileNavDrawerProps = {
    open: boolean;
    activeToolSlug?: NavigationToolSlug;
    showOperations: boolean;
    feedbackUnread: boolean;
    onOpenFeedback: () => void;
    onClose: () => void;
};

export function MobileNavDrawer({ open, activeToolSlug, showOperations, feedbackUnread, onOpenFeedback, onClose }: MobileNavDrawerProps) {
    const { t } = useTranslation();

    return (
        <Drawer title={t("topNav.navigation")} placement="left" size={280} open={open} onClose={onClose} className="md:hidden" styles={{ body: { display: "flex", flexDirection: "column" } }}>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                {navigationTools
                    .filter((tool) => tool.slug !== "operations" || showOperations)
                    .map((tool) => {
                        const Icon = tool.icon;
                        const active = tool.slug === activeToolSlug;
                        return (
                            <Link
                                key={tool.slug}
                                to={`/${tool.slug}`}
                                onClick={onClose}
                                className={cn(
                                    "flex items-center gap-3 rounded-lg px-3 py-3 text-base transition",
                                    active ? "bg-stone-100 font-medium text-stone-950 dark:bg-stone-800 dark:text-stone-100" : "text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100",
                                )}
                            >
                                <Icon className="size-5" />
                                <span>{t(`navigation.${tool.slug}`)}</span>
                            </Link>
                        );
                    })}
            </div>
            <div className="mt-5 shrink-0 border-t border-stone-200 pt-4 dark:border-stone-800">
                <Button type="text" className="!mb-3 !flex !h-10 !w-full !items-center !justify-start !gap-3 !px-3" icon={<MessageSquareText className="size-5" />} onClick={onOpenFeedback}>
                    <span className="relative">
                        {t("feedback.shortLabel")}
                        {feedbackUnread ? <span className="absolute -right-3 top-0 size-2 rounded-full bg-red-500" /> : null}
                    </span>
                </Button>
                <UserStatusActions />
            </div>
        </Drawer>
    );
}
