import { Button } from "antd";
import { RefreshCw } from "lucide-react";
import { useRouteError } from "react-router-dom";

import { isChunkLoadFailure } from "@/lib/chunk-load-recovery";

export function RouteErrorPage() {
    const error = useRouteError();
    const stalePage = isChunkLoadFailure(error);

    return (
        <main className="grid min-h-dvh place-items-center bg-background px-6 text-foreground">
            <section className="max-w-md text-center">
                <h1 className="text-xl font-semibold">{stalePage ? "页面已更新" : "页面暂时无法打开"}</h1>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{stalePage ? "正在使用的页面版本已经更新，请重新加载后继续。" : "加载过程中出现了问题，请重新加载后再试。"}</p>
                <Button className="mt-6" type="primary" icon={<RefreshCw className="size-4" />} onClick={() => window.location.reload()}>
                    重新加载
                </Button>
            </section>
        </main>
    );
}
