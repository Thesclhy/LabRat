import fs from "node:fs/promises";
import path from "node:path";

function safeExtension(filename) {
  const ext = path.extname(String(filename || "")).toLowerCase();
  return /^[.][a-z0-9]+$/.test(ext) ? ext : "";
}

export async function persistUploadedFile(config, { fileId, projectId, originalName, buffer }) {
  const extension = safeExtension(originalName);
  const storageKey = path.join(projectId, `${fileId}${extension}`);
  const fullPath = path.join(config.fileStorageRoot, storageKey);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, buffer);
  return storageKey;
}

export async function deleteUploadedFile(config, storageKey) {
  if (!storageKey) return;
  await fs.rm(path.join(config.fileStorageRoot, storageKey), { force: true });
}

export async function readFileObjectBuffer(config, fileObject) {
  if (fileObject?.buffer) return Buffer.from(fileObject.buffer);
  if (!fileObject?.storageKey) {
    throw Object.assign(new Error("File contents are unavailable for this file object."), {
      statusCode: 409,
      code: "file_contents_unavailable",
    });
  }
  return fs.readFile(path.join(config.fileStorageRoot, fileObject.storageKey));
}
