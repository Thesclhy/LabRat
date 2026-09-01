import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compiledEntry = path.join(backendRoot, "dist-v1", "v1", "main.js");

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error("Could not reserve a local port for the v1 entry smoke test.");
  return port;
}

function childEnvironment(port) {
  return {
    ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
    ...(process.env.Path ? { Path: process.env.Path } : {}),
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}),
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    DATABASE_URL: "postgres://smoke:smoke@127.0.0.1:1/labrat_entry_smoke",
    SESSION_SECRET: "labrat-production-entry-smoke-session-secret",
    LABRAT_SEED_DEV_ACCOUNTS: "false",
    LABRAT_AI_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: "labrat-production-entry-smoke-provider-key",
    ANTHROPIC_MODEL: "smoke-model",
    DEEPSEEK_API_KEY: "",
    DEEPSEEK_BASE_URL: "https://api.deepseek.com",
    LABRAT_ANALYSIS_EXECUTOR: "disabled",
  };
}

await fs.access(compiledEntry).catch(() => {
  throw new Error("Compiled NestJS entry is missing; run npm run build:v1 first.");
});

const port = await reservePort();
const child = spawn(process.execPath, ["src/server.js"], {
  cwd: backendRoot,
  env: childEnvironment(port),
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => { output = `${output}${chunk}`.slice(-8000); });
child.stderr.on("data", (chunk) => { output = `${output}${chunk}`.slice(-8000); });

let exited = false;
let exitCode = null;
child.once("exit", (code) => {
  exited = true;
  exitCode = code;
});

try {
  const deadline = Date.now() + 15_000;
  let health = null;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`Production entry exited with code ${exitCode}.\n${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        health = await response.json();
        break;
      }
    } catch {
      // The process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!health) throw new Error(`Production entry did not become healthy.\n${output}`);
  if (health.apiVersion !== "v1" || health.service !== "labrat-backend") {
    throw new Error(`Production entry served the wrong backend: ${JSON.stringify(health)}`);
  }
  console.log("production NestJS entry smoke passed");
} finally {
  if (!exited) child.kill();
}
