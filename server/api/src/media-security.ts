// Sandbox active formats without changing stored files or blocking normal img previews.
export const MEDIA_SANDBOX_CSP = "sandbox allow-downloads; default-src 'none'; img-src https: http: data: blob:; media-src https: http: data: blob:; style-src 'unsafe-inline'";
