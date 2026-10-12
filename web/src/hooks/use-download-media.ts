import { useCallback } from "react";
import { App } from "antd";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

export function useDownloadMedia() {
    const { message } = App.useApp();
    const { t } = useTranslation();

    return useCallback(
        (url: string, fileName: string) => {
            try {
                saveAs(url, fileName);
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("common.downloadFailed"));
            }
        },
        [message, t],
    );
}
