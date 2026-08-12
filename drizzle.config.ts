import { defineConfig } from "drizzle-kit";
import { existsSync } from "node:fs";

if (!process.env.DATABASE_URL_TEST && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}
const databaseUrl = process.env.DATABASE_URL_TEST;
if (!databaseUrl) {
  throw new Error("DATABASE_URL_TEST is required for Drizzle migrations");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
});
