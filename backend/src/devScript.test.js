import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("backend NestJS dev server loads local configuration without watch restarts", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const devScript = packageJson.scripts.dev;

  assert.match(devScript, /--env-file-if-exists=\.\.\/\.env/);
  assert.match(devScript, /--env-file-if-exists=\.\.\/\.env\.local/);
  assert.match(devScript, /--import tsx/);
  assert.match(devScript, /src\/v1\/main\.ts$/);
  assert.doesNotMatch(devScript, /--watch|nodemon/);
});
