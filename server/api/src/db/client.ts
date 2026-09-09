import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as tables from "./schema.js";

export type PlatformDatabase = NodePgDatabase<typeof tables>;

export function createDatabase(connectionString: string) {
    const pool = new Pool({ connectionString, max: 10 });
    return { pool, db: drizzle(pool, { schema: tables }) };
}
