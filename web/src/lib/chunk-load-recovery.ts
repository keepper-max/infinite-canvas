const RECOVERY_KEY_PREFIX = "shoushou:chunk-reload:";
const DYNAMIC_IMPORT_FAILURE = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|chunkloaderror|loading chunk/i;

export function isChunkLoadFailure(value: unknown) {
    const message = value instanceof Error ? value.message : String(value || "");
    return DYNAMIC_IMPORT_FAILURE.test(message);
}

export function installChunkLoadRecovery() {
    window.addEventListener("vite:preloadError", (event) => {
        const payload = (event as Event & { payload?: unknown }).payload;
        if (!isChunkLoadFailure(payload)) return;

        const message = payload instanceof Error ? payload.message : String(payload || "");
        const asset = message.match(/(?:https?:\/\/[^\s]+)?\/assets\/[^\s?#]+\.js/i)?.[0];
        const recoveryKey = `${RECOVERY_KEY_PREFIX}${asset || message.slice(0, 200)}`;

        try {
            if (sessionStorage.getItem(recoveryKey)) return;
            sessionStorage.setItem(recoveryKey, "1");
        } catch {
            return;
        }

        event.preventDefault();
        window.location.reload();
    });
}
