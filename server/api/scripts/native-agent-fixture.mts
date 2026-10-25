/** Deterministic OpenAI-compatible HTTP fixture. Test code only, never part of the production runtime. */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
export function startFixture(port = 3295) {
  const server = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/v1/tokenization") {
      const pieces: Buffer[] = [];
      for await (const c of req) pieces.push(c);
      const input = Buffer.concat(pieces).toString();
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(
          JSON.stringify({
            data: [
              {
                total_tokens: input.includes("测试官方分词超限") ? 20000 : 500,
              },
            ],
          }),
        );
      return;
    }
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const continuous=body.messages.some((m:any)=>m.role==="system"&&String(m.content).includes("连续规划协议v1"));
    const messages = body.messages as any[],
      results = messages
        .filter((m) => m.role === "tool")
        .map((m) => {
          try {
            return JSON.parse(m.content);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    const calls: any[] = [];
    const call = (name: string, input: unknown) =>
      calls.push({
        id: "call_" + randomUUID(),
        type: "function",
        function: { name, arguments: JSON.stringify(input) },
      });
    const lastUser =
      [...messages].reverse().find((m) => m.role === "user")?.content || "";
    let text = "";
    if (String(lastUser).includes("测试提交状态不明")) {
      req.socket.destroy();
      return;
    }
    if(String(lastUser).includes('只读工具能力验证')){if(!results.some(r=>typeof r.revision==='number'))call('get_canvas_state',{});else text='检查完成';}
    else if(String(lastUser).includes('你好，你能帮我做什么')) text='我可以和你讨论故事、梳理人物设定，也能在你确认后把创作思路整理到画布上。你想从哪里开始？';
    else if(String(lastUser).includes('给我看这次任务的技术追踪')) text='技术追踪需要相应权限。请使用任务中的管理员技术追踪入口，普通任务详情可以直接展开查看。';
    else if(String(lastUser).includes('查看这个任务的执行详情')) text='你可以展开任务卡片中的执行详情，查看阅读资料、创建节点和保存的实际状态。';
    else if (String(lastUser).includes("测试未知工具"))
      call("execute_shell", { command: "never execute" });
    else if (String(lastUser).includes("测试无效参数"))
      call("search_knowledge", { spaceId: "wrong", q: "test" });
    else if (String(lastUser).includes("测试无限循环"))
      call("get_canvas_state", {});
    else if (String(lastUser).includes("测试纯文本"))
      text =
        '{"tool":"create_canvas_node","success":true} 这只是文本，没有执行工具。';
    else if (!results.find((r) => r.spaces)) call("get_project_context", {});
    else {
      const project = results.find((r) => r.spaces),
        space = project.spaces.find((s: any) => s.kind === "project");
      const searches = results.filter((r) => Array.isArray(r.items)),
        docs = ["雾港世界观", "林岚人物设定", "周可人物设定"]
          .map((title) =>
            searches
              .flatMap((r) => r.items)
              .find((d: any) => d.title === title),
          )
          .filter(Boolean),
        read = results.filter((r) => r.untrustedSource);
      const created = results.filter((r) => r.nodeId||(continuous&&r.plannedNodeId)).map(r=>({...r,nodeId:r.nodeId??r.plannedNodeId})),
        edges = results.filter((r) => r.edgeId||(continuous&&r.plannedEdgeId));
      if (!space) text = "当前项目尚无知识空间，请先创建。";
      else if (searches.length < 3) {
        for (const q of ["雾港世界观", "林岚人物设定", "周可人物设定"])
          call("search_knowledge", {
            spaceId: space.id,
            q,
            page: 1,
            pageSize: 20,
          });
      } else if (!docs.length) text = "没有找到三篇资料，不执行创建。";
      else if (read.length < 3) {
        for (const doc of docs.slice(0, 3))
          call("read_knowledge", {
            spaceId: space.id,
            documentId: doc.id,
            offset: 0,
            length: 200,
          });
      } else if(String(lastUser).includes('你觉得我的雾港剧本怎么样')||String(lastUser).includes('帮我看看林岚的人设')) text='根据已读取的设定，林岚追查父亲失踪的动机很清楚。可以让她与周可对线索产生不同判断，让调查中的冲突更自然。';
      else if (
        String(lastUser).includes("建议模式") ||
        messages.some(
          (m) =>
            m.role === "system" &&
            String(m.content).includes("当前运行模式:advice"),
        )
      )
        text =
          "建议创建三个知识引用节点和一个文本创作节点；当前仅规划，未写入。";
      else if (created.length < 4) {
        const state = results
          .filter((r) => r.nodeIds && r.revision !== undefined)
          .at(-1);
        if (!state) call("get_canvas_state", {});
        else {
          for (const [i, d] of read.slice(0, 3).entries())
            call("create_canvas_node", {
              type: "knowledge:document",
              reference: {
                spaceId: d.spaceId,
                documentId: d.documentId,
                mode: "pinned",
                revision: d.revision,
              },
              position: { x: 80, y: 80 + i * 280 },
              expectedCanvasRevision: state.revision,
            });
          call("create_canvas_node", {
            type: "text",
            title: "第一集剧本创作",
            content:
              "结合雾港世界观、林岚与周可的设定，编写第一集剧本。保留人物动机与来源。",
            position: { x: 650, y: 250 },
            expectedCanvasRevision: state.revision,
          });
          text =
            "已读取三篇授权资料。计划创建三个固定版本知识节点和一个文本创作节点，随后建立知识正文输入连接。请检查并确认。";
        }
      } else if (edges.length < 3) {
        const state = results
          .filter((r) => r.nodeIds && r.revision !== undefined)
          .at(-1);
        const fresh =
          state &&
          state.revision === Math.max(...created.map((r) => r.revision));
        if (!fresh) call("get_canvas_state", {});
        else {
          const knowledge = created.filter((r) => r.documentId),
            textNode = created.find((r) => !r.documentId);
          for (const d of knowledge)
            call("connect_canvas_nodes", {
              fromNodeId: d.nodeId,
              toNodeId: textNode.nodeId,
              sourcePortId: "knowledge.output",
              targetPortId: "text.input",
              expectedCanvasRevision: state.revision,
            });
          text =
            "节点已持久化。接下来将三篇知识正文连接到第一集剧本节点，请确认连线计划。";
        }
      } else
        text =
          (continuous?"完整提案已包含3知识节点、1文本节点及3连接，等待平台统一审批。":"已根据服务端保存回执完成：3个知识节点、1个剧本创作文本节点、3条有效输入连接。来源版本与哈希已保留，未调用付费生成。");
    }
    const id = "chatcmpl-isolated-" + randomUUID();
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    const event = (delta: any, finish_reason: any = null, usage?: any) =>
      res.write(
        "data: " +
          JSON.stringify({
            id,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: body.model,
            choices: [{ index: 0, delta, finish_reason }],
            ...(usage ? { usage } : {}),
          }) +
          "\n\n",
      );
    event({ role: "assistant" });
    if (text)
      for (const part of text.match(/.{1,8}/gu) || []) event({ content: part });
    for (const [index, c] of calls.entries())
      event({ tool_calls: [{ index, ...c }] });
    // Fixture usage is explicitly synthetic; never recorded as vendor billing proof.
    if (String(lastUser).includes("测试纯文本预算取整")) {
      event({}, "stop", {
        prompt_tokens: 9000,
        completion_tokens: 500,
        total_tokens: 9500,
      });
      res.end("data: [DONE]\n\n");
      return;
    }
    event({}, calls.length ? "tool_calls" : "stop", {
      prompt_tokens: Math.ceil(Buffer.byteLength(JSON.stringify(body)) / 3),
      completion_tokens: Math.max(
        1,
        Math.ceil(Buffer.byteLength(JSON.stringify({ text, calls })) / 3),
      ),
      total_tokens:
        Math.ceil(Buffer.byteLength(JSON.stringify(body)) / 3) +
        Math.max(
          1,
          Math.ceil(Buffer.byteLength(JSON.stringify({ text, calls })) / 3),
        ),
    });
    res.end("data: [DONE]\n\n");
  });
  server.listen(port, "127.0.0.1");
  return server;
}
if (process.argv[1]?.endsWith("native-agent-fixture.mts")) {
  startFixture(Number(process.env.NATIVE_AGENT_LAB_FIXTURE_PORT||3295));
  console.log(
    "P25 deterministic Tool Calling fixture listening on loopback:3295; no vendor calls",
  );
}
