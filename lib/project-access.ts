import { and, eq } from "drizzle-orm";
import { projectMembers, projects } from "@/db/schema";
import { db } from "@/lib/db";

export async function getProjectForUser(projectId: string, userId: string) {
  const [project] = await db.select({ id: projects.id, ownerId: projects.ownerId, name: projects.name, description: projects.description, createdAt: projects.createdAt, updatedAt: projects.updatedAt }).from(projects).innerJoin(projectMembers, eq(projectMembers.projectId, projects.id)).where(and(eq(projects.id, projectId), eq(projectMembers.userId, userId))).limit(1);
  return project ?? null;
}
