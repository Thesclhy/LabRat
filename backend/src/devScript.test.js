import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("backend NestJS dev server loads local configuration without watch restarts", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(packageJson.scripts.dev, "npm run dev:v1");
  const devScript = packageJson.scripts["dev:v1"];

  assert.match(devScript, /--env-file-if-exists=\.\.\/\.env/);
  assert.match(devScript, /--env-file-if-exists=\.\.\/\.env\.local/);
  assert.ok(devScript.startsWith("npm run build:v1 && "));
  assert.ok(devScript.endsWith("dist-v1/v1/main.js"));
  assert.doesNotMatch(devScript, /--watch|nodemon/);
});
