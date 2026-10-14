import { useCallback, useEffect, useRef } from "react";
import { App } from "antd";

/** Confirm new submissions only; restoring or polling an existing task is not a submission. */
export function useGenerationRiskConfirmation() {
    const { modal } = App.useApp();
    const pending = useRef<(() => void) | null>(null);

    useEffect(() => () => pending.current?.(), []);

    return useCallback((): Promise<boolean> => {
        if (pending.current) return Promise.resolve(false);
        return new Promise((resolve) => {
            let settled = false;
            const finish = (confirmed: boolean) => {
                if (settled) return;
                settled = true;
                pending.current = null;
                resolve(confirmed);
            };
            const dialog = modal.confirm({
                title: "开始生成前，请确认",
                content: (
                    <div className="space-y-3">
                        <p>确认后，任务将直接提交到后台及模型供应商执行，提交后无法保证撤回。</p>
                        <p>停止等待、关闭页面或取消本地任务，不代表供应商已停止生成，任务仍可能继续执行并产生费用。</p>
                        <p>请确认提示词、参考素材和生成参数无误，再开始生成。</p>
                    </div>
                ),
                okText: "我已了解，开始生成",
                cancelText: "暂不生成",
                focusable: { autoFocusButton: "cancel" },
                onOk: () => finish(true),
                onCancel: () => finish(false),
                afterClose: () => finish(false),
            });
            pending.current = () => {
                finish(false);
                dialog.destroy();
            };
        });
    }, [modal]);
}
