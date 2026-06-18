import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

const requiredDocs = [
  "AGENTS.md",
  "README.md",
  "doc/plan.md",
  "doc/PROGRESS.md",
  "doc/ARCHITECTURE.md",
  "doc/ROADMAP.md",
  "doc/saas-api-contract-v0.md",
  "doc/saas-database-schema-v0.md",
  "doc/server-project-state-plan.md",
  "doc/backend-api-contract.md",
  "doc/canonical-data-dictionary.md",
  "doc/ai-boundaries.md",
  "doc/decisions.md",
  "doc/task-checklist.md",
  "doc/code-review.md",
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

const missingDocs = requiredDocs.filter((relativePath) => !exists(relativePath));
const packageJson = readJson("package.json");
const backendPackageJson = readJson("backend/package.json");
const missingScripts = [
  ["package.json", "test", packageJson.scripts?.test],
  ["package.json", "build", packageJson.scripts?.build],
  ["backend/package.json", "test", backendPackageJson.scripts?.test],
].filter(([, , value]) => !value);

console.log("Codex preflight");
console.log("================");

if (missingDocs.length) {
  console.error("Missing required workflow docs:");
  missingDocs.forEach((item) => console.error(`- ${item}`));
}

if (missingScripts.length) {
  console.error("Missing required verification scripts:");
  missingScripts.forEach(([file, name]) => console.error(`- ${file} scripts.${name}`));
}

if (missingDocs.length || missingScripts.length) {
  process.exitCode = 1;
} else {
  console.log("Required docs and verification scripts are present.");
}

console.log("");
console.log("Required long-task loop:");
console.log("1. Read doc/plan.md.");
console.log("2. Read relevant API/data-model docs before routes, schemas, persistence, or frontend API usage.");
console.log("3. Create or update doc/task-checklist.md.");
console.log("4. Implement one milestone.");
console.log("5. Run targeted tests and npm run codex:verify when feasible.");
console.log("6. Update doc/PROGRESS.md.");
console.log("7. Re-read docs before continuing.");
console.log("");
console.log("Canonical progress log: doc/PROGRESS.md");
