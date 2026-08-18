# LabRat Visible Intent Composer Plan

Status: proposed

This document records the approved design for making LabRat composer intent
visible and user-controlled. The design is complete, but no frontend, backend,
API-contract, persistence, or routing implementation described below has been
started.

## Goal And Interaction

Replace the current hidden workflow target with a Codex/ChatGPT-style composed
input where users can see and remove any explicit intent that the frontend will
send to the backend.

- The `+` button opens a menu above the text input titled `Intent`.
- The menu contains:
  - `Add file`: opens the operating system file picker and retains the current
    Excel upload and Workbook Review workflow.
  - `Add or update Experiment Browser`.
  - `Create chart`.
- The final two choices are mutually exclusive explicit intents. Selecting one
  displays a status item in the composer toolbar:
  - `Intent: Experiment Browser`.
  - `Intent: Chart`.
- Hovering or focusing the intent item exposes an `x` control. Removing it
  returns the next message to automatic intent recognition.
- An explicit intent applies to the next message only. Sending the message
  clears the intent immediately, even if the request later fails.
- Closing LabRat, switching projects, or resetting the chat clears an unsent
  intent so hidden state cannot leak into a later request.
- File attachments and explicit analysis intents cannot be active together:
  - Opening the file picker does not change the current intent by itself.
  - Selecting a file clears the current explicit intent.
  - While a file is attached, the Browser and Chart intent choices are disabled
    with guidance to remove the attachment first.
- The existing file attachment chip remains. This change does not alter upload,
  indexing, or Workbook Review boundaries.
- Desktop and mobile use one composer structure: a multiline text area above a
  compact toolbar containing the `+` menu, attachment or intent status, and the
  send button.

## Unified Entry Points

All product entry points that open LabRat should set composer state through one
shared interface rather than separate hidden booleans.

- Ordinary `Ask LabRat` opens with no explicit intent and uses automatic
  recognition.
- Experiment Browser `Add or update data` opens LabRat with
  `Intent: Experiment Browser` visible.
- Workbook Review `Review extracted experiments` opens with the same Experiment
  Browser intent.
- Experiment Browser preview correction keeps its prefilled text and also shows
  the Experiment Browser intent.
- Overview `Upload workbook` opens LabRat and immediately invokes the file
  picker. A selected file appears as an attachment, not an intent.
- Choosing `Create chart` from the composer menu shows the Chart intent.
- Chart Review requests that submit without the chat panel use the same backend
  `intent: "chart"` contract.
- Onboarding Experiment Browser planning uses the same backend
  `intent: "experiment_browser"` contract.
- Manuscript actions that describe, summarize, or caption an already selected
  chart retain their selected-chart context and must not be mislabeled as chart
  creation.
- When a product entry point supplies a new intent, it replaces any unsent
  intent. Ordinary `Ask LabRat` does not inject or preserve an intent from a
  different entry point.

## Frontend And Backend Contract

Standardize `POST /api/projects/:projectId/agent/runs` requests around an
explicit top-level intent:

```json
{
  "message": "i want a graph of carbon number distribution",
  "conversation": [],
  "intent": "chart",
  "selectedContext": {
    "tab": "browser",
    "activeSurface": "browser"
  },
  "modeHint": "auto"
}
```

`intent` is a required enum:

```text
auto
experiment_browser
chart
```

The values have these meanings:

- `auto`: the user did not choose a hard intent. The backend applies
  deterministic text rules and then uses LLM intent classification as the
  fallback.
- `experiment_browser`: hard-route to `publish_experiment_data` and create a
  reviewed thread with `outputTarget: experiment_browser`.
- `chart`: hard-route to `create_analysis_chart` and create a reviewed thread
  with `outputTarget: chart`.
- A missing or invalid value returns `400 invalid_agent_intent` instead of being
  silently guessed.

`selectedContext` remains available only for resolving the current surface,
selected experiments, selected charts, and similar references. It no longer
contains workflow commands.

- Remove `selectedContext.analysisOutputTarget`.
- Remove `selectedContext.requestedWorkflow`.
- Treat `tab` and `activeSurface` only as weak context.
- Ignore legacy `analysisOutputTarget` values for hard routing if an older
  client still sends them.

Routing precedence is fixed:

```text
explicit user-selected intent
  -> deterministic hard route
otherwise
  -> deterministic text rules
  -> structured LLM intent classification
  -> clarification
```

AgentRun audit output should record both the requested and resolved intent
without adding a database column. Store the normalized requested value in the
existing AgentRun JSON context and expose readable workflow details such as:

```text
requestedIntent: chart
resolvedIntent: create_analysis_chart
```

Update the API contract, architecture, AI boundaries, and durable decisions in
the implementation milestone to state that an explicit user selection is a
command while page context remains only a hint.

## Implementation Groups

1. Refactor the `AgentPanel` composer state. Replace the `+` button's direct file
   picker action with an accessible Intent menu and add intent status,
   attachment exclusivity, and one-message consumption.
2. Route page entry points through one function such as
   `openAgent({ intent, openFilePicker, draft })`. Remove the existing
   `requestedAnalysisOutputTarget` state and cleanup callback.
3. Update the frontend API helper to always send a normalized `intent`. Migrate
   direct Chart Review and onboarding AgentRun calls to the same contract.
4. Validate the intent in the backend request handler and update the intent
   router to process the explicit enum before automatic routing. Remove the old
   `selectedContext` fields' hard-routing effects.
5. Update contracts, architecture notes, AI boundaries, durable decisions,
   active milestone state, and `doc/PROGRESS.md` as part of the later
   implementation milestone.

## Test And Acceptance Plan

- The `+` menu opens, selects, and closes with mouse and keyboard interaction;
  focus management and accessible labels are present.
- `Add file` opens the file picker. Selecting a file shows the attachment and
  clears a hard intent; cancelling the picker does not change the current
  intent.
- Browser and Chart intent statuses are mutually exclusive, removable, and
  disappear immediately after send.
- Opening LabRat from Browser, Workbook Review, or the correction entry point
  shows the correct status.
- Ordinary Ask LabRat shows no intent. Sending
  `i want a graph of carbon number distribution` sends `intent: "auto"` and
  resolves to `create_analysis_chart`.
- Opening from the Browser data entry point and sending that same text retains
  the visible, explicit Browser command and resolves to
  `publish_experiment_data`. Removing the status before sending allows the text
  to resolve to chart creation.
- Explicit `intent: "chart"` creates a chart thread even when the message names
  Experiment Browser. Explicit Experiment Browser intent behaves symmetrically.
- Legacy `selectedContext.analysisOutputTarget` and `requestedWorkflow` values
  alone no longer control routing.
- Invalid intent values return 400 and create neither an AgentRun nor an
  AnalysisThread.
- Mobile verification confirms the menu stays within the viewport, the intent
  can be removed, and the text area and send button do not overlap.
- Run focused AgentPanel, frontend API, and backend router/route tests; then run
  the complete frontend and backend suites, the production build, and Docker
  browser QA reproducing the original misclassification report.

## Decisions And Defaults

- `Create chart` means the existing reviewed analysis chart workflow, not a
  reusable chart-style template.
- An explicit intent applies to one message and clears on send.
- Only one hard intent may be active at a time.
- File upload is an independent composer attachment action, not an AgentRun
  intent.
- This document is design-only. No implementation behavior has changed yet.
