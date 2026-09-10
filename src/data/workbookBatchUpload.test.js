import { describe, expect, it, vi } from "vitest";
import {
  createWorkbookBatchItems,
  parseExperimentNumberFromFileName,
  runWorkbookBatchUpload,
  suggestExperimentForFile,
  summarizeWorkbookBatch,
  workbookBatchItemForStorage,
} from "./workbookBatchUpload.js";

function fileNamed(name) {
  return new File(["placeholder"], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

describe("parseExperimentNumberFromFileName", () => {
  it("reads experiment numbers from common lab file names", () => {
    expect(parseExperimentNumberFromFileName("Calculation Exp31.xlsx")).toBe(31);
    expect(parseExperimentNumberFromFileName("exp_007 rates.xlsx")).toBe(7);
    expect(parseExperimentNumberFromFileName("Experiment-12 carbon.xlsx")).toBe(12);
  });

  it("returns null when no experiment number is present", () => {
    expect(parseExperimentNumberFromFileName("MasterTable_updated.xlsx")).toBeNull();
    expect(parseExperimentNumberFromFileName("")).toBeNull();
  });
});

describe("suggestExperimentForFile", () => {
  const experiments = [
    { experimentId: "identity_31", label: "Exp31" },
    { experimentId: "identity_32", label: "exp 32" },
    { experimentId: "identity_40a", label: "Exp40" },
    { experimentId: "identity_40b", label: "EXP-40" },
  ];

  it("matches one experiment identity by normalized alias", () => {
    expect(suggestExperimentForFile("Calculation Exp31.xlsx", experiments)).toMatchObject({
      experimentNumber: 31,
      label: "Exp31",
      status: "matched",
      match: { experimentId: "identity_31", label: "Exp31" },
    });
    expect(suggestExperimentForFile("rates exp_032.xlsx", experiments).match?.experimentId).toBe("identity_32");
  });

  it("reports unmatched, ambiguous, and unnamed files without guessing", () => {
    expect(suggestExperimentForFile("Calculation Exp33.xlsx", experiments)).toMatchObject({ status: "unmatched", label: "Exp33", match: null });
    expect(suggestExperimentForFile("Calculation Exp40.xlsx", experiments)).toMatchObject({ status: "ambiguous", match: null });
    expect(suggestExperimentForFile("MasterTable.xlsx", experiments)).toMatchObject({ status: "no_experiment_in_name", match: null });
  });
});

describe("runWorkbookBatchUpload", () => {
  it("uploads every file with bounded concurrency and isolates failures", async () => {
    const files = [fileNamed("Calculation Exp31.xlsx"), fileNamed("Calculation Exp32.xlsx"), fileNamed("broken.xlsx"), fileNamed("Calculation Exp34.xlsx")];
    let inFlight = 0;
    let maxInFlight = 0;
    const uploadFile = vi.fn(async (file) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      if (file.name === "broken.xlsx") throw new Error("Unsupported workbook");
      return { workbookReviewLink: { workbookReviewSessionId: `session_${file.name}`, workbookName: file.name, regionCount: 2 } };
    });
    const updates = [];
    const items = await runWorkbookBatchUpload({ files, uploadFile, concurrency: 2, onUpdate: (next) => updates.push(next) });

    expect(uploadFile).toHaveBeenCalledTimes(4);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(items.map((item) => item.status)).toEqual(["uploaded", "uploaded", "failed", "uploaded"]);
    expect(items[2].error).toBe("Unsupported workbook");
    expect(items[0].workbookReviewLink.workbookReviewSessionId).toBe("session_Calculation Exp31.xlsx");
    expect(updates.some((snapshot) => snapshot.some((item) => item.status === "uploading"))).toBe(true);
    expect(summarizeWorkbookBatch(items)).toMatchObject({ total: 4, uploaded: 3, failed: 1 });
  });

  it("retries only the requested failed files while keeping earlier results", async () => {
    const files = [fileNamed("Calculation Exp31.xlsx"), fileNamed("broken.xlsx")];
    const uploadFile = vi.fn(async (file) => ({ workbookReviewLink: { workbookReviewSessionId: `retry_${file.name}`, workbookName: file.name, regionCount: 1 } }));
    const previous = createWorkbookBatchItems(files).map((item, index) => (
      index === 0
        ? { ...item, status: "uploaded", workbookReviewLink: { workbookReviewSessionId: "session_31", workbookName: "Calculation Exp31.xlsx", regionCount: 3 } }
        : { ...item, status: "failed", error: "Network error" }
    ));

    const items = await runWorkbookBatchUpload({ files, items: previous, uploadFile, onlyIndexes: [1] });

    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(uploadFile.mock.calls[0][0].name).toBe("broken.xlsx");
    expect(items[0].workbookReviewLink.workbookReviewSessionId).toBe("session_31");
    expect(items[1]).toMatchObject({ status: "uploaded", error: "" });
  });

  it("drops File and raw response objects before chat history storage", () => {
    const stored = workbookBatchItemForStorage({ index: 0, fileName: "a.xlsx", status: "uploaded", file: fileNamed("a.xlsx"), result: { big: true }, workbookReviewLink: { workbookReviewSessionId: "s" } });
    expect(stored).toEqual({ index: 0, fileName: "a.xlsx", status: "uploaded", workbookReviewLink: { workbookReviewSessionId: "s" } });
  });
});
