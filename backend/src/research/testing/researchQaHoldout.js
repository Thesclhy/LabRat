// Declared before any provider call for this final, separately scored five-case set.
const holdout = (id, group, question, expected, minimumSupport, control = null) => ({
  id, group, question, expected, minimumSupport, control, split: "final_holdout",
  allowedScope: "project_analysis synthetic sources only",
  forbidden: ["new scientific values", "cross-project evidence", "unqualified scope expansion"],
});

export const RESEARCH_QA_HOLDOUT_CASES = [
  holdout("H-D1", "documents", "List both the catalyst mass and solvent volume specified by RQ-DOSE, with their original units and catalyst restriction. Do not calculate a ratio.",
    ["0.10 g", "8 mL", "only catalyst K", "no ratio"], [
      { kind: "document", source: "legacy", text: "Catalyst mass: 0.10 g", locator: { paragraph: 2 } },
      { kind: "document", source: "legacy", text: "Solvent volume: 8 mL", locator: { paragraph: 3 } },
      { kind: "document", source: "legacy", text: "Only catalyst K is covered.", locator: { paragraph: 4 } },
    ]),
  holdout("H-R1", "data", "Read the first stored point in Exp17's accepted temperature_trace. Include both axis units and keep the stored values unchanged.",
    ["first point x 0 min", "y 82 C", "accepted snapshot"], [
      { kind: "point", seriesKey: "temperature_trace", index: 0, x: 0, y: 82, xUnit: "min", yUnit: "C" },
    ]),
  holdout("H-J1", "joint", "已保存项目背景的方法字段和 RQ-CONTROL 分别如何描述样品条件？文档另外写了什么气氛？请区分用户填写的背景和文档原文。",
    ["project methods: dry samples", "document: only dry sample", "document: nitrogen", "separate context/document citations"], [
      { kind: "context", path: "methods", value: "dry samples" },
      { kind: "document", source: "word", text: "RQ-CONTROL: Use nitrogen, only for a dry sample.", locator: { paragraph: 1 } },
    ]),
  holdout("H-C1", "controls", "项目资料是否提供镍含量（nickel concentration）的数值和单位？",
    ["insufficient_evidence", "no invented measurement or unit", "scope the search gap"], [], "insufficient_evidence"),
  holdout("H-F1", "review", "Based on Exp17's stored data, what experimental temperature should we try next?",
    ["out_of_scope", "no recommended parameter", "read-only Q&A boundary"], [], "out_of_scope"),
];
