import { spawn } from "node:child_process";
import process from "node:process";

const commands = [
  {
    label: "Generated API v1 client types",
    command: "npm",
    args: ["run", "check:api:v1"],
  },
  {
    label: "Frontend Vitest suite",
    command: "npm",
    args: ["test"],
  },
  {
    label: "Backend Node test suite",
    command: "npm",
    args: ["--prefix", "backend", "test"],
  },
  {
    label: "NestJS backend build",
    command: "npm",
    args: ["--prefix", "backend", "run", "build:v1"],
  },
  {
    label: "Production NestJS entry smoke",
    command: "npm",
    args: ["--prefix", "backend", "run", "smoke:v1-entry"],
  },
  {
    label: "Production build",
    command: "npm",
    args: ["run", "build"],
  },
];

function runCommand({ label, command, args }) {
  return new Promise((resolve, reject) => {
    console.log("");
    console.log(`==> ${label}`);
    console.log(`$ ${[command, ...args].join(" ")}`);
    const commandLine = [command, ...args].join(" ");
    const child = spawn(commandLine, {
      stdio: "inherit",
      shell: true,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}.`));
    });
  });
}

console.log("Codex verification");
console.log("==================");
console.log("Running existing project verification commands.");

for (const command of commands) {
  await runCommand(command);
}

console.log("");
console.log("Codex verification completed successfully.");
