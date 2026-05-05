import { spawn, spawnSync, execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.VITE_PORT ?? 5177);
const host = process.env.VITE_HOST ?? "127.0.0.1";
const url = `http://${host}:${port}/`;
const cacheDir = join(root, "node_modules", ".cache");
const lockHashFile = join(cacheDir, "past-paper-worker-lock.hash");

function fail(message, error) {
  console.error(`\n[dev-local] ${message}`);
  if (error) console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], { cwd: root, shell: true, stdio: "ignore" });
  return result.status === 0;
}

function hashLock() {
  if (!existsSync(join(root, "package-lock.json"))) return "no-lock";
  const lock = readFileSync(join(root, "package-lock.json"), "utf8");
  let hash = 0;
  for (let index = 0; index < lock.length; index += 1) {
    hash = (hash * 31 + lock.charCodeAt(index)) >>> 0;
  }
  return String(hash);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, shell: true, stdio: "inherit" });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed.`);
}

function pidsOnPort() {
  if (process.platform !== "win32") {
    const result = spawnSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8" });
    return result.status === 0 ? result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
  }

  try {
    const output = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`,
      ],
      { encoding: "utf8" },
    );
    return output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && line !== "0");
  } catch {
    return [];
  }
}

function stopExistingServer() {
  const pids = pidsOnPort();
  for (const pid of pids) {
    try {
      process.kill(Number(pid));
      console.log(`[dev-local] Stopped existing process ${pid} on port ${port}.`);
    } catch (error) {
      console.warn(`[dev-local] Could not stop process ${pid} on port ${port}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

if (!commandExists("node")) fail("Node.js is not available on PATH.");
if (!commandExists("npm")) fail("npm is not available on PATH.");

const currentHash = hashLock();
const cachedHash = existsSync(lockHashFile) ? readFileSync(lockHashFile, "utf8") : "";
if (!existsSync(join(root, "node_modules")) || cachedHash !== currentHash) {
  console.log("[dev-local] Installing dependencies with npm ci...");
  run("npm", ["ci"]);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(lockHashFile, currentHash);
}

stopExistingServer();

console.log(`[dev-local] Starting Vite at ${url}`);
const vite = spawn("npm", ["run", "dev", "--", "--host", host, "--port", String(port)], {
  cwd: root,
  shell: true,
  stdio: "inherit",
});

vite.on("error", (error) => fail("Could not start Vite.", error));
vite.on("exit", (code) => {
  if (code && code !== 0) fail(`Vite exited with code ${code}.`);
});
