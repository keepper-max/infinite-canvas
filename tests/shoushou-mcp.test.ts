import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("守守画布 MCP 可通过 stdio 启动并发布预期工具", { timeout: 20_000 }, async () => {
  const client = new Client({ name: "shoushou-mcp-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: ["run", "mcp:shoushou"],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const response = await client.listTools();
    assert.deepEqual(
      response.tools.map((tool) => tool.name).sort(),
      [
        "create_vibe_storyboard",
        "ensure_vibe_project",
        "generate_vibe_text",
        "get_project_context",
        "get_vibe_status",
        "get_vibe_text_status",
        "import_rendered_video",
        "list_projects",
        "list_vibe_text_jobs",
        "queue_vibe_preview",
      ],
    );
  } finally {
    await client.close();
  }
});
