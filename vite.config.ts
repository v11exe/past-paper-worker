import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(async () => {
  const plugins = [react()];
  const nodeMajor = Number(process.versions.node.split(".")[0] ?? 0);

  if (nodeMajor >= 22) {
    const { cloudflare } = await import("@cloudflare/vite-plugin");
    plugins.push(cloudflare());
  }

  return {
    base: "./",
    plugins,
  };
});
