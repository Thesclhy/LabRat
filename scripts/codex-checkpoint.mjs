import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const progressPath = path.join(root, "doc", "PROGRESS.md");
const checklistPath = path.join(root, "doc", "task-checklist.md");

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function ensureDateSection(content, date) {
  const heading = `## ${date}`;
  if (content.includes(`${heading}\n`)) return content;
  const firstHeading = content.match(/^## \d{4}-\d{2}-\d{2}$/m);
  if (!firstHeading) return `${content.trimEnd()}\n\n${heading}\n\n`;
  return `${content.slice(0, firstHeading.index)}${heading}\n\n${content.slice(firstHeading.index)}`;
}

function insertProgressEntry(content, date, entry) {
  const withSection = ensureDateSection(content, date);
  const heading = `## ${date}`;
  const start = withSection.indexOf(heading);
  const insertAt = withSection.indexOf("\n", start) + 1;
  return `${withSection.slice(0, insertAt)}\n- ${entry}\n${withSection.slice(insertAt)}`;
}

function insertChecklistCheckpoint(content, date, message) {
  const marker = "## Recent Checkpoints";
  const entry = `- ${date}: ${message}`;
  if (!content.includes(marker)) {
    return `${content.trimEnd()}\n\n${marker}\n\n${entry}\n`;
  }
  const start = content.indexOf(marker);
  const insertAt = content.indexOf("\n", start) + 1;
  return `${content.slice(0, insertAt)}\n${entry}\n${content.slice(insertAt)}`;
}

const args = parseArgs(process.argv.slice(2));
const message = typeof args.message === "string" ? args.message.trim() : "";

if (!message) {
  console.log("Codex checkpoint");
  console.log("================");
  console.log("No checkpoint written. Usage:");
  console.log('  npm run codex:checkpoint -- --message "Completed milestone" --verification "npm test, npm run build"');
  process.exit(0);
}

const date = typeof args.date === "string" && args.date.trim() ? args.date.trim() : todayIso();
const parts = [message];
if (args.milestone) parts.push(`Milestone: ${args.milestone}.`);
if (args.files) parts.push(`Files: ${args.files}.`);
if (args.verification) parts.push(`Verification: ${args.verification}.`);
if (args.next) parts.push(`Next: ${args.next}.`);
const entry = parts.join(" ");

const progress = fs.readFileSync(progressPath, "utf8");
fs.writeFileSync(progressPath, insertProgressEntry(progress, date, entry));

if (fs.existsSync(checklistPath)) {
  const checklist = fs.readFileSync(checklistPath, "utf8");
  fs.writeFileSync(checklistPath, insertChecklistCheckpoint(checklist, date, message));
}

console.log(`Checkpoint written to doc/PROGRESS.md for ${date}.`);
