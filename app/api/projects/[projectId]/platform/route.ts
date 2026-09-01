import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  automationRuns,
  canvasEdges,
  canvasNodes,
  generationJobs,
  projectAgents,
  storyOutlines,
} from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProjectForUser } from "@/lib/project-access";
import { getMockQueue } from "@/lib/queue";
import { recordJobEvent } from "@/lib/job-events";
import { topologicalOrder } from "@/lib/workflow";

async function access(projectId: string) {
  const user = await getCurrentUser();
  if (!user)
    return {
      response: NextResponse.json({ error: "未登录" }, { status: 401 }),
    };
  const project = await getProjectForUser(projectId, user.id);
  if (!project)
    return {
      response: NextResponse.json({ error: "项目不存在" }, { status: 404 }),
    };
  return { user, project };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const checked = await access(projectId);
  if (checked.response) return checked.response;
  const [outline] = await db
    .select()
    .from(storyOutlines)
    .where(eq(storyOutlines.projectId, projectId))
    .limit(1);
  const agents = await db
    .select()
    .from(projectAgents)
    .where(eq(projectAgents.projectId, projectId))
    .orderBy(desc(projectAgents.updatedAt));
  const automations = await db
    .select()
    .from(automationRuns)
    .where(eq(automationRuns.projectId, projectId))
    .orderBy(desc(automationRuns.createdAt))
    .limit(20);
  return NextResponse.json({
    outline: outline ?? { title: "", content: "" },
    agents,
    automations,
  });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const checked = await access(projectId);
  if (checked.response) return checked.response;
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.slice(0, 160) : "";
  const content =
    typeof body.content === "string" ? body.content.slice(0, 20000) : "";
  const [outline] = await db
    .insert(storyOutlines)
    .values({ projectId, title, content })
    .onConflictDoUpdate({
      target: storyOutlines.projectId,
      set: { title, content, updatedAt: new Date() },
    })
    .returning();
  return NextResponse.json({ outline });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const checked = await access(projectId);
  if (checked.response) return checked.response;
  const body = await request.json().catch(() => ({}));
  if (body.action === "execute") {
    const [run] = await db
      .insert(automationRuns)
      .values({
        projectId,
        template:
          typeof body.template === "string" ? body.template : "角色到视频",
        status: "running",
        input: typeof body.input === "object" && body.input ? body.input : {},
      })
      .returning();
    const nodes = await db
      .select()
      .from(canvasNodes)
      .where(eq(canvasNodes.projectId, projectId));
    const edges = await db
      .select({
        sourceNodeId: canvasEdges.sourceNodeId,
        targetNodeId: canvasEdges.targetNodeId,
      })
      .from(canvasEdges)
      .where(eq(canvasEdges.projectId, projectId));
    const orderedNodes = topologicalOrder(nodes, edges);
    const queue = getMockQueue();
    const jobs = [];
    for (const node of orderedNodes) {
      const [active] = await db
        .select({ id: generationJobs.id })
        .from(generationJobs)
        .where(
          and(
            eq(generationJobs.projectId, projectId),
            eq(generationJobs.nodeId, node.id),
            inArray(generationJobs.status, ["pending", "running"]),
          ),
        )
        .limit(1);
      if (active) continue;
      const [job] = await db
        .insert(generationJobs)
        .values({
          projectId,
          nodeId: node.id,
          provider: "mock",
          modelId:
            node.nodeType === "video"
              ? "mock-seedance-2.5"
              : "mock-image-pipeline",
          mode: "workflow",
          prompt: String(
            (node.data as { description?: string })?.description ?? "",
          ),
          input: { node, workflowRunId: run.id },
          parameters: {},
        })
        .returning();
      await recordJobEvent({
        jobId: job.id,
        projectId,
        status: "pending",
        progress: 0,
        message: `工作流已排队：${node.label}`,
      });
      await queue.add(
        "mock-generation",
        { jobId: job.id, projectId, nodeId: node.id },
        { jobId: job.id, removeOnComplete: 100, removeOnFail: 100 },
      );
      jobs.push(job);
    }
    return NextResponse.json({ run, jobs }, { status: 201 });
  }
  if (body.type === "agent") {
    const name =
      typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
    if (!name)
      return NextResponse.json(
        { error: "Agent / Skill 名称不能为空" },
        { status: 400 },
      );
    const [agent] = await db
      .insert(projectAgents)
      .values({
        projectId,
        name,
        kind: body.kind === "skill" ? "skill" : "agent",
        config:
          typeof body.config === "object" && body.config ? body.config : {},
      })
      .returning();
    return NextResponse.json({ agent }, { status: 201 });
  }
  const template =
    typeof body.template === "string" ? body.template : "角色到视频";
  const [run] = await db
    .insert(automationRuns)
    .values({
      projectId,
      template,
      status: "draft",
      input: typeof body.input === "object" && body.input ? body.input : {},
    })
    .returning();
  return NextResponse.json({ run }, { status: 201 });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const checked = await access(projectId);
  if (checked.response) return checked.response;
  const body = await request.json().catch(() => ({}));
  if (typeof body.agentId !== "string")
    return NextResponse.json({ error: "agentId 缺失" }, { status: 400 });
  const [agent] = await db
    .update(projectAgents)
    .set({ enabled: body.enabled === false ? 0 : 1, updatedAt: new Date() })
    .where(
      and(
        eq(projectAgents.id, body.agentId),
        eq(projectAgents.projectId, projectId),
      ),
    )
    .returning();
  if (!agent)
    return NextResponse.json(
      { error: "Agent / Skill 不存在" },
      { status: 404 },
    );
  return NextResponse.json({ agent });
}
