import { defineConfig } from "drizzle-kit";

// `npm run generate` writes a new SQL migration from the schema. Review it before committing.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  schemaFilter: ["identity", "people", "competition", "finance", "platform", "auction"],
});
