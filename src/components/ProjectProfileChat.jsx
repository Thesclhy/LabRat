import React, { useEffect, useMemo, useState } from "react";
import { ChatShell } from "./ChatShell.jsx";

const PROFILE_STEPS = [
  {
    key: "researchGoal",
    label: "research goal",
    question: "What is the main research goal for this project?",
    placeholder: "e.g. Compare gas selectivity across catalyst loadings",
  },
  {
    key: "experimentBackground",
    label: "experiment background",
    question: "What is the experimental background or campaign context?",
    placeholder: "e.g. Batch reactor screening campaign for HDPE hydrogenolysis",
  },
  {
    key: "materials",
    label: "materials",
    question: "Which materials, catalysts, samples, or feedstocks are in scope?",
    placeholder: "e.g. Ru/TiO2, HDPE pellets, hydrogen",
  },
  {
    key: "methods",
    label: "methods",
    question: "What methods or reaction setup should LabRat remember?",
    placeholder: "e.g. Parr reactor, GC-FID post-reaction analysis",
  },
  {
    key: "instruments",
    label: "instruments",
    question: "Which instruments or data sources matter for this project?",
    placeholder: "e.g. GC-FID, pressure logs, Excel master table",
  },
  {
    key: "analysisNotes",
    label: "analysis notes",
    question: "Any analysis notes, chart preferences, or caveats LabRat should preserve?",
    placeholder: "e.g. Use reviewed imported data only; report selectivity as percent",
  },
  {
    key: "tags",
    label: "tags",
    question: "Add a few tags for this project.",
    placeholder: "e.g. screening, selectivity, HDPE",
  },
];

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function profileValue(profile, key) {
  const value = profile?.[key];
  return key === "tags" ? normalizeTags(value).join(", ") : String(value || "");
}

function firstIncompleteIndex(profile) {
  const index = PROFILE_STEPS.findIndex((step) => !profileValue(profile, step.key));
  return index < 0 ? PROFILE_STEPS.length : index;
}

export function ProjectProfileChat({ open, project, projectProfile, onSaveProfile, onClose }) {
  const initialProfile = useMemo(() => projectProfile || {}, [projectProfile]);
  const [draft, setDraft] = useState(initialProfile);
  const [stepIndex, setStepIndex] = useState(() => firstIncompleteIndex(initialProfile));
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const nextDraft = projectProfile || {};
    const nextStepIndex = firstIncompleteIndex(nextDraft);
    setDraft(nextDraft);
    setStepIndex(nextStepIndex);
    setInput("");
    setError("");
    setMessages([
      {
        role: "assistant",
        text: nextStepIndex >= PROFILE_STEPS.length
          ? "This project profile is ready. You can update any context here, or close this panel and start importing data."
          : PROFILE_STEPS[nextStepIndex].question,
      },
    ]);
  }, [open, project?.id]);

  const currentStep = PROFILE_STEPS[stepIndex] || null;
  const saveAnswer = async (value, skipped = false) => {
    if (!currentStep || busy) return;
    const trimmed = String(value || "").trim();
    if (!trimmed && !skipped) return;
    const nextDraft = {
      ...draft,
      [currentStep.key]: currentStep.key === "tags" ? normalizeTags(trimmed) : trimmed,
    };
    const nextStepIndex = Math.min(stepIndex + 1, PROFILE_STEPS.length);
    setBusy(true);
    setError("");
    try {
      const saved = await onSaveProfile?.(nextDraft);
      const savedProfile = saved?.projectProfile || nextDraft;
      setDraft(savedProfile);
      setStepIndex(nextStepIndex);
      setMessages((current) => [
        ...current,
        { role: "user", text: skipped ? `Skip ${currentStep.label} for now.` : trimmed },
        {
          role: "assistant",
          text: nextStepIndex >= PROFILE_STEPS.length
            ? "Project context saved. LabRat will use this background when proposing mappings, charts, and explanations."
            : PROFILE_STEPS[nextStepIndex].question,
        },
      ]);
      setInput("");
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ChatShell
      open={open}
      title="the lab rat"
      context={`${project?.name || "Project"} - structured project background`}
      messages={error ? [...messages, { role: "assistant", text: `Save failed: ${error}` }] : messages}
      input={input}
      onInputChange={setInput}
      onSend={() => saveAnswer(input)}
      onClose={onClose}
      busy={busy}
      placeholder={currentStep?.placeholder || "Project profile is complete."}
      className="profile-agent"
      footerActions={currentStep && (
        <button type="button" className="agent-tool profile-skip" disabled={busy} onClick={() => saveAnswer("", true)}>
          Skip
        </button>
      )}
    />
  );
}

export { PROFILE_STEPS };
