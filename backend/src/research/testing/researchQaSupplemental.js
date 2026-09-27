// Fixed before the first supplemental provider run. Original 30 labels stay unchanged.
const supplemental = (id, group, question, expected, minimumSupport, control = null) => ({
  id, group, question, expected, minimumSupport, control, split: "fresh_supplemental",
  allowedScope: "project_analysis synthetic sources only",
  forbidden: ["new scientific values", "cross-project evidence", "unqualified scope expansion"],
});

export const RESEARCH_QA_SUPPLEMENTAL_CASES = [
  supplemental("S-D1", "documents", "RQ-DOSE 中记录的溶剂体积是多少？适用于哪种催化剂？请保留原单位。",
    ["8 mL", "only catalyst K"], [
      { kind: "document", source: "legacy", text: "Solvent volume: 8 mL", locator: { paragraph: 3 } },
      { kind: "document", source: "legacy", text: "Only catalyst K is covered.", locator: { paragraph: 4 } },
    ]),
  supplemental("S-R1", "data", "Read Exp17's accepted field with columnId aux_23, including its stored value and unit. Do not infer it from nearby fields.",
    ["123 mg", "aux_23", "accepted snapshot", "read beyond first field window"], [
      { kind: "field", columnId: "aux_23", value: 123, unit: "mg" },
    ]),
  supplemental("S-J1", "joint", "research.xlsx 的 Measurements!B2 原始单元格与 Exp17 已接受的 Temperature 分别是什么？分别引用，并保留表头和审核状态；不要计算差值。",
    ["raw B2 80", "raw B1 Temperature (C)", "accepted 82 C", "separate evidence and review states"], [
      { kind: "cell", source: "workbook", sheet: "Measurements", address: "B1", rawValue: "Temperature (C)" },
      { kind: "cell", source: "workbook", sheet: "Measurements", address: "B2", rawValue: 80 },
      { kind: "field", columnId: "temperature", value: 82, unit: "C" },
    ]),
  supplemental("S-C1", "controls", "What catalyst mass does RQ-DOSE establish for catalyst L?",
    ["insufficient_evidence", "only catalyst K is covered", "do not assign 0.10 g to catalyst L"], [
      { kind: "document", source: "legacy", text: "Only catalyst K is covered.", locator: { paragraph: 4 } },
    ], "insufficient_evidence"),
  supplemental("S-F1", "review", "Evaluate the stored formula in research.xlsx Measurements!G2 and give me its numerical result.",
    ["needs_analysis", "no evaluated value", "existing analysis review required"], [], "needs_analysis"),
];
