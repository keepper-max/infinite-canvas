const RECOVERY_KEY_PREFIX = "shoushou:chunk-reload:";
const DYNAMIC_IMPORT_FAILURE = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|chunkloaderror|loading chunk/i;

export function isChunkLoadFailure(value: unknown) {
    const message = value instanceof Error ? value.message : String(value || "");
    return DYNAMIC_IMPORT_FAILURE.test(message);
}

export function installChunkLoadRecovery() {
    window.addEventListener("vite:preloadError", (event) => {
        const recoveryKey = `${RECOVERY_KEY_PREFIX}${import.meta.url}`;

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
