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
    const userTurns=messages.filter(m=>m.role==="user"&&!String(m.content).startsWith("以下是平台授权")&&!String(m.content).startsWith("平台"));
    const prompt=String(userTurns.at(-1)?.content??lastUser);
    const currentStart=messages.lastIndexOf(userTurns.at(-1));
    const freshResults=messages.slice(currentStart).filter(m=>m.role==="tool").map(m=>{try{return JSON.parse(m.content);}catch{return null;}}).filter(Boolean);
    const intentStage=messages.some(m=>m.role==="system"&&String(m.content).includes("你是受约束的会话策略分析器"));
    if(prompt.includes("只读工具能力验证")){if(!freshResults.some(r=>typeof r.revision==="number"))call("get_canvas_state",{});else text="检查完成";}
    else if(intentStage){
      const intent=/按我们刚才|修改画布|执行/.test(prompt)?"action":/第二个|慢节奏|不同意/.test(prompt)?"compare":/开场|短视频|人设/.test(prompt)?"consult":/那个方案/.test(prompt)?"clarify":"chat";
      text=JSON.stringify({intent,actionTarget:intent==="action"?"canvas":"unspecified",evidence:prompt,resolvedRequest:intent==="action"?"只修改当前画布《第一集剧本》文本，采用第二个缓慢悬疑方案：林岚以调查员身份到灯塔核查，先给异常声响与矛盾线索，不改职业、不揭露周可动机；知识原稿不改。":prompt,summary:{discussion:"正在讨论雾港第一集开场；用户偏好慢节奏悬疑。",proposals:[{label:"第一个方案",content:"提前爆发灯塔冲突，代价是减少氛围铺垫"},{label:"第二个方案",content:"保留缓慢节奏，但先呈现异常声响与矛盾线索，保留调查员身份"}],confirmed:userTurns.filter(m=>String(m.content).includes("第二个方案")).map(m=>({text:"选择第二个缓慢悬疑方案，保留林岚的调查员身份",evidence:m.content})),rejected:userTurns.some(m=>String(m.content).includes("不同意"))?["不要强推快节奏爆发"]:[],openQuestions:[]}});
    } else if(prompt.includes("隔离参数错误回归")) {
      const corrected=messages.some(m=>m.role==="user"&&String(m.content).startsWith("平台已拒绝上一批次"));
      const state=freshResults.find(r=>Array.isArray(r.nodeIds)&&typeof r.revision==="number");
      if(!corrected)call("create_canvas_node",{type:"text",title:"缺少正文的错误提案",position:{x:0,y:0},expectedCanvasRevision:0});
      else if(!state)call("get_canvas_state",{});
      else if(!freshResults.some(r=>r.proposalOnly))call("create_canvas_node",{type:"text",title:"参数修复回归",content:"隔离合成剧本；已修正参数，等待审批后保存。",position:{x:0,y:0},expectedCanvasRevision:state.revision});
      else text="已经修正参数，准备保存画布文本，请确认平台计划。";
    } else if(prompt.includes("保留当前已保存结果"))text="已保存的画布结果保持不动。接下来可以继续比较开场与镜头节奏；如果要变更内容，我会先给你看修改计划。";
    else if(/你好/.test(prompt)) text="今天不用急着搭流程。我们可以先聊《雾港》的一个小问题：你更想看人物，还是看看第一集的开场？没有具体想法也没关系。";
    else if(/不同意|慢节奏/.test(prompt))text="慢节奏本身不是问题，我刚才把抓人等同于加快冲突了，这个判断需要收窄。可以比较两种办法：\n1. 提前爆发灯塔事件，悬疑更直接，但会削弱雾港氛围。\n2. 保持缓慢节奏，只提前给一个异常声响和一处矛盾线索。人物仍按调查节奏进入，观众却有具体疑问。\n我更推荐第二种，它保留你的审美，同时让每段铺垫有期待。";
    else if(/第二个方案/.test(prompt))text="那就采用第二个：保留缓慢的雾港氛围，先给异常声响和矛盾线索。林岚仍是调查员，不更改职业。这是我们确认的创作方向，尚未修改文档或画布。";
    else if(/15秒|短视频/.test(prompt))text="第二个方案适合做15秒悬疑短片的雏形，但不能把慢节奏原样压缩。可以用前3秒呈现异常声响，中段只保留一条调查线索，结尾留下矛盾；这是剪辑建议，不是已执行的修改，林岚的调查员身份仍保留。";
    else if(/按我们刚才|修改画布|执行/.test(prompt)){
      const state=freshResults.filter(r=>Array.isArray(r.nodeIds)&&typeof r.revision==="number").at(-1);
      const listed=freshResults.find(r=>Array.isArray(r.nodes)&&r.nodes.some(n=>n.type==="text"));
      const proposed=freshResults.find(r=>r.proposalOnly);
      if(proposed)text="方案已经完整：只改画布中的剧本文本，保留调查员职业和缓慢悬疑风格。知识原稿保持，请确认这项修改。";
      else if(!state)call("get_canvas_state",{});
      else if(!listed)call("list_canvas_nodes",{page:1,pageSize:20});
      else {const n=listed.nodes.find(n=>n.type==="text");call("update_canvas_node",{nodeId:n.id,content:"# 第一集：雾港回声\n调查员林岚踏入灯塔，雾笛间夹着一次异常敲击。她慢慢核对封存的航道记录：日期相同，灯号却不一致。周可没有解释。\n保留调查员身份与缓慢悬疑节奏，不揭露周可动机。",expectedCanvasRevision:state.revision});}
    } else if(/开场|人设/.test(prompt)){
      const project=freshResults.find(r=>r.spaces),space=project?.spaces?.find(s=>s.kind==="project"),search=freshResults.find(r=>Array.isArray(r.items)&&r.items.some(d=>d.title==="第一集剧本")),read=freshResults.find(r=>r.untrustedSource&&r.title==="第一集剧本");
      if(!project)call("get_project_context",{});
      else if(!search)call("search_knowledge",{spaceId:space.id,q:"第一集剧本",page:1,pageSize:20});
      else if(!read)call("read_knowledge",{spaceId:space.id,documentId:search.items.find(d=>d.title==="第一集剧本").id,offset:0,length:2000});
      else {if(!read.markdown.includes("三分钟"))throw Error("Fixture expected real script not found");text="依据《第一集剧本》当前原文，开头用三分钟介绍港口，而林岚进入灯塔较晚。我的判断是：需要更早给观众一个可以追问的矛盾，不一定加快整体节奏。\n可以比较两套创意：第一套把灯塔事件提前，悬疑直接但牺牲氛围；第二套保留慢节奏，只在开场放入异常声响与矛盾线索。第二套更贴近现有雾港气质。以上是建议，尚未修改内容。";}
    } else text="我会保留刚才已确认的创作方向。你可以继续讨论，也可以明确指定需要调整的画布内容；实际修改仍会先展示计划。";
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
      prompt_tokens: 500,
      completion_tokens: 300,
      total_tokens:
        500 +
        300,
    });
    res.end("data: [DONE]\n\n");
  });
  server.listen(port, "127.0.0.1");
  return server;
}
if (process.argv[1]?.endsWith("native-agent-r22-fixture.mts")) {
  startFixture(Number(process.env.NATIVE_AGENT_LAB_FIXTURE_PORT||3295));
  console.log(
    "P25 deterministic Tool Calling fixture listening on loopback:3295; no vendor calls",
  );
}
