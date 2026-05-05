import { execSync } from "node:child_process";

const ports = [5177, 5180];

for (const port of ports) {
  try {
    const output = execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique"`,
      { encoding: "utf8" },
    )
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const pid of output) {
      if (pid === "0") continue;
      try {
        process.kill(Number(pid));
        console.log(`Stopped PID ${pid} on port ${port}`);
      } catch {
        console.log(`Could not stop PID ${pid} on port ${port}`);
      }
    }
  } catch {
    // No process found for this port.
  }
}
