import { useCallback } from "react";
import { App } from "antd";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

export function useDownloadMedia() {
    const { message } = App.useApp();
    const { t } = useTranslation();

    return useCallback(
        async (url: string, fileName: string) => {
            try {
                if (!isProtectedMediaUrl(url)) return saveAs(url, fileName);
                const response = await fetch(url, { credentials: "same-origin" });
                if (!response.ok) throw new Error(response.status === 401 ? t("common.downloadLoginExpired") : t("common.downloadFailed"));
                saveAs(await response.blob(), fileName);
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("common.downloadFailed"));
            }
        },
        [message, t],
    );
}

function isProtectedMediaUrl(value: string) {
    try {
        const url = new URL(value, window.location.origin);
        return url.origin === window.location.origin && url.pathname.startsWith("/api/media/asset-versions/");
    } catch {
        return false;
    }
}
