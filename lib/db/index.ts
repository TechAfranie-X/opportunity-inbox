import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  postgres?: ReturnType<typeof postgres>;
};

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }

  const client = globalForDb.postgres ?? postgres(url);
  if (process.env.NODE_ENV !== "production") {
    globalForDb.postgres = client;
  }

  return drizzle(client, { schema });
}

export function getDb() {
  return createClient();
}

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}
