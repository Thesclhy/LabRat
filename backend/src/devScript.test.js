import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("backend dev server loads local configuration without watch restarts", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const devScript = packageJson.scripts.dev;

  assert.match(devScript, /--env-file-if-exists=\.\.\/\.env/);
  assert.match(devScript, /--env-file-if-exists=\.\.\/\.env\.local/);
  assert.match(devScript, /src\/server\.js$/);
  assert.doesNotMatch(devScript, /--watch|nodemon/);
});
