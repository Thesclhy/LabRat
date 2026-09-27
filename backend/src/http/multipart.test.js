import test from "node:test";
import assert from "node:assert/strict";
import { parseMultipartFormData } from "./multipart.js";

test("browser UTF-8 filenames retain Chinese and accented characters without changing file bytes", () => {
  const content = Buffer.from([0xff, 0x00, 0x80, 0x0d, 0x0a, 0x25]);
  for (const [filename, encoding] of [["项目资料-é.txt", "utf8"], ["café.doc", "latin1"], ["research.xlsx", "utf8"]]) {
    const body = Buffer.concat([Buffer.from(`--test-boundary\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`, encoding), content, Buffer.from("\r\n--test-boundary--\r\n")]);
    const result = parseMultipartFormData("multipart/form-data; boundary=test-boundary", body);
    assert.equal(result.files[0].filename, filename);
    assert.deepEqual(result.files[0].buffer, content);
    assert.equal(result.files[0].sizeBytes, content.length);
  }
});
