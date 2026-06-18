import { createServerSupplementalImportBatch, uploadServerProjectFile } from "./serverApi.js";

export async function mapWithConcurrency(items, limit, mapper) {
  const values = Array.from(items || []);
  const results = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function uploadSupplementalFilesAsBatch({
  projectId,
  files,
  concurrency = 3,
  uploadFile = uploadServerProjectFile,
  createBatch = createServerSupplementalImportBatch,
} = {}) {
  const uploads = await mapWithConcurrency(files, concurrency, (file) => uploadFile(projectId, file));
  const fileObjects = uploads.map((upload) => upload.fileObject).filter(Boolean);
  const batchResponse = await createBatch(projectId, { fileObjectIds: fileObjects.map((fileObject) => fileObject.id) });
  return {
    uploads,
    fileObjects,
    batch: batchResponse.batch,
  };
}
