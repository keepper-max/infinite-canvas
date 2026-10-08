export const APP_VERSION = __APP_VERSION__ || "dev";

// Codex/Agent is an internal development aid. Production builds keep it disabled
// unless an internal deployment explicitly opts in at build time.
export const CODEX_AGENT_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_CODEX_AGENT === "true";


// Official plugin registry URL: CI publishes to plugins-dist for jsDelivr delivery; an environment variable may override it for self-hosting.
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL || "https://cdn.jsdelivr.net/gh/basketikun/infinite-canvas@plugins-dist/official-plugins.json";

// Standalone 3D app. Keeping this URL outside the canvas bundle prevents Three.js/R3F from entering the host build.
export const DIRECTOR_DESK_URL = import.meta.env.VITE_DIRECTOR_DESK_URL || "/3d-director/";
