import { createServer } from "../../../web/node_modules/vite/dist/node/index.js";
const root = "H:/CodexStorage/infinite-canvas-auth-upgrade/web";
process.chdir(root); // Tailwind's automatic source detection follows cwd, independently of Vite root.
const server = await createServer({
  root,
  configFile: root + "/vite.config.ts",
  cacheDir: (process.env.NATIVE_AGENT_LAB_ROOT||"H:/CodexStorage/shoushou-p25")+"/vite-cache",
  server: {
    host: "127.0.0.1",
    port: Number(process.env.NATIVE_AGENT_LAB_WEB_PORT||5195),
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:"+(process.env.NATIVE_AGENT_LAB_PORT||3195),
      "/__p25": "http://127.0.0.1:"+(process.env.NATIVE_AGENT_LAB_PORT||3195),
    },
  },
});
await server.listen();
console.log("Isolated UI http://127.0.0.1:"+server.config.server.port+"/__p25/login");
