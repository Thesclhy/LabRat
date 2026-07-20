import assert from "node:assert/strict";
import test from "node:test";

import { createProjectAgentPlan } from "./projectAgentPlanner.js";

test("answers project-content questions directly without proposing a Browser action", () => {
  const plan = createProjectAgentPlan({
    project: {
      id: "project_1",
      name: "Catalyst Screening",
      description: "Compare catalyst performance.",
      status: "active",
    },
    projectProfile: {
      researchGoal: "Compare gas selectivity.",
      materials: "Ru/TiO2 and HDPE",
      methods: "Batch reactor screening",
      tags: ["catalysis"],
    },
    sourceDocuments: [{ id: "source_1" }],
    experimentSnapshotHeads: [{ experimentIdentityId: "exp_1" }, { experimentIdentityId: "exp_2" }],
    chartSpecs: [{ id: "chart_1" }],
    message: "所以目前项目是什么样的？完整从数据到表格的链路通了吗？",
  });

  assert.deepEqual(plan.actions, []);
  assert.equal(plan.intent, "project_summary");
  assert.match(plan.reply, /Catalyst Screening/);
  assert.match(plan.reply, /Compare gas selectivity/);
  assert.match(plan.reply, /2 个已发布实验/);
  assert.match(plan.reply, /Experiment Browser/);
  assert.equal(plan.reply.includes("Open Experiment Browser"), false);
});

test("keeps explicit workbook upload requests ahead of project summaries", () => {
  const plan = createProjectAgentPlan({
    project: { id: "project_1", name: "Catalyst Screening" },
    message: "What workbook should I upload to this project?",
  });

  assert.equal(plan.intent, "action_plan");
  assert.deepEqual(plan.actions.map((action) => action.type), ["upload_workbook_for_review"]);
});

test("routes explicit accepted-data chart requests to reviewed analysis", () => {
  [
    "Create a chart for this project showing status by experiment.",
    "Show a chart for this project status by experiment.",
    "Chart this project status by experiment.",
  ].forEach((message) => {
    const plan = createProjectAgentPlan({
      project: { id: "project_1", name: "Catalyst Screening" },
      message,
    });

    assert.equal(plan.intent, "analysis_thread", message);
    assert.deepEqual(plan.actions, [], message);
  });
});

test("routes trend and calculation requests to reviewed analysis without Browser actions", () => {
  [
    "Give me a one-paragraph overview of the trends across all experiments.",
    "Normalize Solid, Liquid, and Gas selectivity to 100 percent.",
    "Compare reaction time versus reaction rate.",
  ].forEach((message) => {
    const plan = createProjectAgentPlan({
      project: { id: "project_1", name: "Catalyst Screening" },
      experimentSnapshotHeads: [{ experimentId: "experiment_1" }],
      message,
    });

    assert.equal(plan.intent, "analysis_thread", message);
    assert.deepEqual(plan.actions, [], message);
    assert.equal(plan.reply.includes("Open Experiment Browser"), false, message);
    assert.equal(plan.analysisRequest?.message, message);
  });
});

test("answers experiment-purpose questions without proposing a Browser action", () => {
  const plan = createProjectAgentPlan({
    project: {
      id: "project_1",
      name: "Catalyst Screening",
      description: "Compare catalyst performance.",
    },
    projectProfile: {
      researchGoal: "Determine how reaction conditions affect selectivity.",
    },
    message: "What is this experiment for?",
  });

  assert.equal(plan.intent, "project_summary");
  assert.deepEqual(plan.actions, []);
  assert.match(plan.reply, /Determine how reaction conditions affect selectivity/);
});

test("opens Experiment Browser only for explicit navigation", () => {
  const plan = createProjectAgentPlan({
    project: { id: "project_1", name: "Catalyst Screening" },
    message: "Open Experiment Browser and filter Exp12.",
  });

  assert.deepEqual(plan.actions.map((action) => action.type), ["open_experiment_browser"]);
});

test("asks for clarification instead of using Browser as an unknown-message fallback", () => {
  const plan = createProjectAgentPlan({
    project: { id: "project_1", name: "Catalyst Screening" },
    message: "Investigate this.",
  });

  assert.equal(plan.intent, "clarification");
  assert.deepEqual(plan.actions, []);
});
