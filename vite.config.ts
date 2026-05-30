import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const versionHistorySource = readFileSync(new URL("./src/versionHistory.ts", import.meta.url), "utf8");
const currentVersion = versionHistorySource.match(/version:\s*["']([^"']+)["']/)?.[1] ?? "v0.0.0";

function gitValue(command: string) {
  try {
    return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

export default defineConfig(async () => {
  const plugins = [react()];
  const nodeMajor = Number(process.versions.node.split(".")[0] ?? 0);
  const buildMeta = {
    version: currentVersion,
    updatedAt: new Date().toISOString(),
    commitHash: gitValue("git rev-parse --short HEAD") || null,
    commitMessage: gitValue("git log -1 --pretty=%s") || "Build metadata unavailable",
  };

  if (nodeMajor >= 22) {
    const { cloudflare } = await import("@cloudflare/vite-plugin");
    plugins.push(cloudflare());
  }

  return {
    base: "./",
    define: {
      __APP_META__: JSON.stringify(buildMeta),
    },
    plugins,
  };
});
