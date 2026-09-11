export const APP_VERSION = __APP_VERSION__ || "dev";

// Codex/Agent is an internal development aid. Production builds keep it disabled
// unless an internal deployment explicitly opts in at build time.
export const CODEX_AGENT_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_CODEX_AGENT === "true";

export const DOCS_URL = import.meta.env.VITE_DOC_URL || "https://docs.canvas.best";

// Official plugin registry URL: CI publishes to plugins-dist for jsDelivr delivery; an environment variable may override it for self-hosting.
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL || "https://cdn.jsdelivr.net/gh/basketikun/infinite-canvas@plugins-dist/official-plugins.json";
