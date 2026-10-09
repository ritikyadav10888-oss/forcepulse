import { defineConfig } from "vitest/config";
import { workspaceAlias } from "../../vitest.shared";

export default defineConfig({
  resolve: { alias: workspaceAlias },
  test: { testTimeout: 30_000, hookTimeout: 120_000 },
});
