import "server-only";

import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";

import * as schema from "./schema";

neonConfig.webSocketConstructor = ws;

type Database = ReturnType<typeof drizzle<typeof schema>>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

let pool: Pool | undefined;
let database: Database | undefined;

export function resolveDatabaseUrl(
  environment: Partial<
    Pick<
    NodeJS.ProcessEnv,
    "DATABASE_URL" | "DATABASE_URL_TEST" | "DATABASE_USE_TEST_URL" | "NODE_ENV"
    >
  > = process.env
): string {
  const useTestDatabase =
    environment.NODE_ENV !== "production" && environment.DATABASE_USE_TEST_URL === "true";
  const url = useTestDatabase ? environment.DATABASE_URL_TEST : environment.DATABASE_URL;
  if (!url) {
    throw new Error(
      `${useTestDatabase ? "DATABASE_URL_TEST" : "DATABASE_URL"} is required for the Neon data model`
    );
  }
  return url;
}

function getDatabase(): Database {
  if (!database) {
    pool = new Pool({ connectionString: resolveDatabaseUrl() });
    database = drizzle({ client: pool, schema });
  }
  return database;
}

export const db: Database = new Proxy({} as Database, {
  get(_target, property, receiver) {
    const value = Reflect.get(getDatabase(), property, receiver);
    return typeof value === "function" ? value.bind(getDatabase()) : value;
  },
});

export async function dbTransaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T> {
  return getDatabase().transaction(callback);
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
  }
  pool = undefined;
  database = undefined;
}
