import { spawn } from "node:child_process";
import process from "node:process";

const commands = [
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
