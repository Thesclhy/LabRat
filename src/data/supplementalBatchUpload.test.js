import { describe, expect, it, vi } from "vitest";
import { uploadSupplementalFilesAsBatch } from "./supplementalBatchUpload.js";

describe("uploadSupplementalFilesAsBatch", () => {
  it("uploads multiple supplemental files and creates one batch", async () => {
    const files = [
      new File(["a"], "a.xlsx"),
      new File(["b"], "b.xlsx"),
      new File(["c"], "c.xlsx"),
    ];
    const uploadFile = vi.fn(async (_projectId, file) => ({
      fileObject: { id: `file_${file.name[0]}`, originalName: file.name },
    }));
    const createBatch = vi.fn(async () => ({ batch: { id: "batch_1" } }));

    const result = await uploadSupplementalFilesAsBatch({
      projectId: "project_1",
      files,
      uploadFile,
      createBatch,
    });

    expect(uploadFile).toHaveBeenCalledTimes(3);
    expect(createBatch).toHaveBeenCalledWith("project_1", { fileObjectIds: ["file_a", "file_b", "file_c"] });
    expect(result.batch.id).toBe("batch_1");
    expect(result.fileObjects.map((file) => file.id)).toEqual(["file_a", "file_b", "file_c"]);
  });
});
