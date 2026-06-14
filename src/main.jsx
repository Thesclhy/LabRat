import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { makePlot } from "./charts/makePlot";
import { BackendScanPanel } from "./components/BackendScanPanel";
import { BlankOnboarding } from "./components/BlankOnboarding";
import { Plot } from "./charts/Plot";
import { ManuscriptCanvas } from "./components/ManuscriptCanvas";
import { BLANK_PROJECT_SOURCE_NAME, blankTemplateLinks, isBlankDataMode } from "./data/appMode.js";
import { proposeChartsWithBackend } from "./data/backendChartProposalApi.js";
import { scanWorkbookWithBackend } from "./data/backendImportScanApi.js";
import { normalizeScanWithBackend } from "./data/backendImportNormalizeApi.js";
import { proposeSemanticMappingsWithBackend } from "./data/backendSemanticMappingApi.js";
import { proposeExcelMappingsFromScan } from "./data/aiExcelParserBoundary.js";
import { applyGenericImportPatch } from "./data/genericImportPatch.js";
import { setChartProposalStatus, setMappingStatus, upsertGenericChartProposalSet, upsertGenericMappingSet } from "./data/genericProposalState.js";
import { createBlockReviewState, setBlockReviewDecision } from "./data/importBlockReviewState.js";
import { parseLocalExcelFolder } from "./data/masterTableImporter.js";
import { emptyDataset } from "./data/loadEmbeddedDataset.js";
import { resolveStartupProject } from "./data/startupProject.js";
import { scanExcelFolder } from "./data/workbookScanner.js";
import { ls } from "./storage/localStorage";
import { buildProjectRecord, loadActiveProject, normalizeProjectRecord, saveActiveProject } from "./storage/projectStorage";
import { experimentDateSortValue, formatExperimentDateForDisplay } from "./utils/date.js";
import { expNo, fmt, uid } from "./utils/format";
import "./styles.css";

const BLANK_MODE = isBlankDataMode();

function Topbar({ tab, setTab, dirty, onSave, onExportProject, onImportProject, onAgent, dataset, sourceName, onLoadFolder, loadingSource, sourceError, onOpenImportReview, hasImportReview, blankMode }) {
  return (
    <header className="topbar">
      <div className="brand"><img className="brand-logo" src={`${import.meta.env.BASE_URL}labrat-logo.png`} alt="LabRat" /><span className="brand-word">LabRat</span><span className="sub">&middot; Your AI Research Assistant</span></div>
      <nav className="tabs">
        {[["browser", "Experiment Browser"], ["manuscript", "Manuscript"], ["reference", "Add Reference"]].map(([k, label]) => (
          <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{label}</button>
        ))}
      </nav>
      <div className="top-actions">
        <span className={`badge ${sourceError ? "bad-src" : ""}`} title={sourceError || sourceName}>{dataset.experiments.length} experiments</span>
        {blankMode ? (
          <>
            <button className="folder-btn primary-import" type="button" disabled={!hasImportReview} onClick={onOpenImportReview}>Import Excel workbook</button>
            <label className="folder-btn legacy-import" title="Legacy HDPE MasterTable.xlsx folder import">
              {loadingSource ? "Loading..." : "Legacy MasterTable folder"}
              <input type="file" multiple webkitdirectory="" directory="" accept=".xlsx,.xls" onChange={(e) => onLoadFolder(e.target.files)} />
            </label>
          </>
        ) : (
          <>
            <label className="folder-btn">
              {loadingSource ? "Loading..." : "Load Excel folder"}
              <input type="file" multiple webkitdirectory="" directory="" accept=".xlsx,.xls" onChange={(e) => onLoadFolder(e.target.files)} />
            </label>
            <button className="folder-btn" type="button" disabled={!hasImportReview} onClick={onOpenImportReview}>Import review</button>
          </>
        )}
        {tab === "manuscript" && <button className={`save ${dirty ? "dirty" : ""}`} onClick={onSave}>Save</button>}
        <button className="folder-btn" onClick={onExportProject}>Export project</button>
        <label className="folder-btn">
          Import project
          <input type="file" accept=".labrat.json,application/json" onChange={(e) => { onImportProject(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <button className="agent-btn" onClick={onAgent}>
          <img src={`${import.meta.env.BASE_URL}labrat-logo.png`} alt="" />
          <span>Ask Lab Rat</span>
        </button>
      </div>
    </header>
  );
}

function Browser({ dataset, setSelected, sourceName, blankMode, onOpenImportReview, templateLinks }) {
  const [filters, setFilters] = useState({ search: "", cat: [], impeller: [], rpm: [], cb95: false, hasPostGc: false, hasSweep: false, hasrate: false });
  const [sort, setSort] = useState(["date", -1]);
  const setChip = (key, val) => setFilters((f) => ({ ...f, [key]: f[key].includes(val) ? f[key].filter((x) => x !== val) : [...f[key], val] }));
  const hasPostReactionGc = (e) => !!(e.calculation || e.files?.calculation || e.sources?.some((source) => source.kind === "post_reaction_gc"));
  const hasSweepData = (e) => !!(e.sweep || e.files?.sweep || e.sources?.some((source) => source.kind === "sweep_gc"));
  const rows = useMemo(() => {
    const q = filters.search.toLowerCase().trim();
    const out = dataset.experiments.filter((e) => {
      if (q && !`${e.label} ${e.comments || ""}`.toLowerCase().includes(q)) return false;
      if (filters.cat.length && !filters.cat.includes(e.catalyst_type || "-")) return false;
      if (filters.impeller.length && !filters.impeller.includes(e.impeller || "-")) return false;
      if (filters.rpm.length && !filters.rpm.includes(String(e.rpm))) return false;
      if (filters.cb95 && !(e.carbon_balance_pct >= 95)) return false;
      if (filters.hasPostGc && !hasPostReactionGc(e)) return false;
      if (filters.hasSweep && !hasSweepData(e)) return false;
      if (filters.hasrate && !e.rate_sources?.length) return false;
      return true;
    });
    const [col, dir] = sort;
    return out.sort((a, b) => {
      const av = col === "label" ? expNo(a.label) : col === "date" ? experimentDateSortValue(a.date) : a[col];
      const bv = col === "label" ? expNo(b.label) : col === "date" ? experimentDateSortValue(b.date) : b[col];
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av > bv ? 1 : av < bv ? -1 : 0) * dir;
    });
  }, [filters, sort, dataset.experiments]);
  const cats = [...new Set(dataset.experiments.map((e) => e.catalyst_type || "-"))].sort();
  const imps = [...new Set(dataset.experiments.map((e) => e.impeller || "-"))].sort();
  const rpms = [...new Set(dataset.experiments.map((e) => String(e.rpm)))].sort((a, b) => Number(a) - Number(b));
  const blankProjectHasNoUserData = blankMode
    && !dataset.experiments.length
    && !(dataset.genericImports || []).length
    && !(dataset.genericMappingSets || []).length
    && !(dataset.genericChartProposals || []).length;
  if (blankProjectHasNoUserData) {
    return (
      <div className="browser">
        <aside className="sidebar blank-sidebar">
          <section className="filter">
            <h4>Project</h4>
            <p>Empty project</p>
          </section>
          <section className="filter">
            <h4>Compatibility</h4>
            <p>Legacy HDPE MasterTable folder import remains available in the topbar.</p>
          </section>
        </aside>
        <main className="main">
          <div className="page-head">
            <div><h1>New LabRat project</h1><p>No embedded research data is loaded in blank mode.</p></div>
          </div>
          <BlankOnboarding onImportWorkbook={onOpenImportReview} templateLinks={templateLinks} />
        </main>
      </div>
    );
  }
  return (
    <div className="browser">
      <aside className="sidebar">
        <Filter title="Search"><input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Label, comments..." /></Filter>
        <Filter title="Catalyst">{cats.map((c) => <Chip key={c} active={filters.cat.includes(c)} onClick={() => setChip("cat", c)}>{c}</Chip>)}</Filter>
        <Filter title="Impeller">{imps.map((c) => <Chip key={c} active={filters.impeller.includes(c)} onClick={() => setChip("impeller", c)}>{c}</Chip>)}</Filter>
        <Filter title="RPM">{rpms.map((c) => <Chip key={c} active={filters.rpm.includes(c)} onClick={() => setChip("rpm", c)}>{c}</Chip>)}</Filter>
        <label className="check"><input type="checkbox" checked={filters.cb95} onChange={(e) => setFilters({ ...filters, cb95: e.target.checked })} /> Carbon balance &gt;= 95%</label>
        <label className="check"><input type="checkbox" checked={filters.hasPostGc} onChange={(e) => setFilters({ ...filters, hasPostGc: e.target.checked })} /> Has post-rxn GC data</label>
        <label className="check"><input type="checkbox" checked={filters.hasSweep} onChange={(e) => setFilters({ ...filters, hasSweep: e.target.checked })} /> Has sweep data</label>
        <label className="check"><input type="checkbox" checked={filters.hasrate} onChange={(e) => setFilters({ ...filters, hasrate: e.target.checked })} /> Has rate data</label>
        <button className="clear" onClick={() => setFilters({ search: "", cat: [], impeller: [], rpm: [], cb95: false, hasPostGc: false, hasSweep: false, hasrate: false })}>Clear filters</button>
      </aside>
      <main className="main">
        <div className="page-head">
          <div><h1>Experiment Browser</h1><p>{rows.length} of {dataset.experiments.length} experiments - source: {sourceName} - click a row for full record.</p></div>
        </div>
        <div className="card table-wrap">
          <table>
            <thead><tr>{[
              ["label", "Label"], ["date", "Date"], ["catalyst_loading_g", "Cat (g)"], ["reaction_time_hr", "t (h)"], ["rpm", "RPM"], ["impeller", "Impeller"], ["conversion_pct", "Conv %"], ["selectivity_liquid_pct", "Sel S/L/G"], ["carbon_balance_pct", "C-bal %"], ["files", "Files"],
            ].map(([k, l]) => <th key={k} onClick={() => k !== "files" && setSort(([old, d]) => old === k ? [k, -d] : [k, 1])}>{l}</th>)}</tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.label} onClick={() => setSelected(e)}>
                <td><span>{e.label}</span></td><td>{formatExperimentDateForDisplay(e.date)}</td><td>{fmt(e.catalyst_loading_g, 3)}</td><td>{fmt(e.reaction_time_hr, 1)}</td><td>{fmt(e.rpm, 0)}</td>
                <td><span className="pill muted">{e.impeller || "-"}</span></td><td>{fmt(e.conversion_pct, 1)}</td>
                <td>{fmt(e.selectivity_solid_pct, 1)} / {fmt(e.selectivity_liquid_pct, 1)} / {fmt(e.selectivity_gas_pct, 1)}</td>
                <td className="plain-cell"><span className={`pill ${e.carbon_balance_pct >= 95 ? "ok" : e.carbon_balance_pct >= 90 ? "warn" : "bad"}`}>{fmt(e.carbon_balance_pct, 1)}</span></td>
                <td className="plain-cell"><FilePills e={e} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

function Filter({ title, children }) {
  return <section className="filter"><h4>{title}</h4><div className="chips">{children}</div></section>;
}

function Chip({ active, onClick, children }) {
  return <button className={`chip ${active ? "active" : ""}`} onClick={onClick}>{children}</button>;
}

function FilePills({ e }) {
  const items = [["calculation", "Calc"], ["sweep", "Sweep"]];
  const rateSource = Array.isArray(e.rate_sources) && e.rate_sources.length ? e.rate_sources[0] : null;
  return <>{items.map(([k, l]) => {
    const f = e.files?.[k];
    if (!f) return <span key={k} className="file disabled">{l}</span>;
    const href = typeof f === "string" ? `/original/${encodeURIComponent(f)}` : f.url;
    const title = typeof f === "string" ? f : f.name;
    return href
      ? <a key={k} className="file" href={href} title={title} onClick={(ev) => ev.stopPropagation()} target="_blank">{l}</a>
      : <span key={k} className="file disabled" title={title}>{l}</span>;
  })}
    {rateSource
      ? <span className="file" title={`${rateSource.source_file || "Reaction rate data"}${rateSource.n_points ? ` - ${rateSource.n_points} points` : ""}`}>Reaction rate</span>
      : <span className="file disabled">Reaction rate</span>}
  </>;
}

function DetailModal({ exp, onClose, onStage }) {
  if (!exp) return null;
  const selectivity = makePlot("selectivity", [exp]);
  const rate = exp.rate_sources?.length ? makePlot("rate", [exp]) : null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-head"><span>{exp.label} - Full record</span><button onClick={onClose}>x</button></div>
        <div className="modal-body">
          <div className="detail-title">
            <div><h2>{exp.label} <span>{formatExperimentDateForDisplay(exp.date)}</span></h2><p>{exp.catalyst_type} - {exp.polymer_type} - {exp.impeller} impeller</p></div>
            <button className="primary" onClick={() => onStage(exp.label)}>Stage for manuscript</button>
          </div>
          <div className="stats">
            <Stat label="Conversion" value={`${fmt(exp.conversion_pct, 1)}%`} note={`${fmt(exp.reaction_time_hr, 1)} h`} />
            <Stat label="Carbon balance" value={`${fmt(exp.carbon_balance_pct, 1)}%`} note={exp.carbon_balance_pct >= 95 ? "passes" : "flagged"} />
            <Stat label="Liquid selectivity" value={`${fmt(exp.selectivity_liquid_pct, 2)}%`} note={`solid ${fmt(exp.selectivity_solid_pct, 1)}% / gas ${fmt(exp.selectivity_gas_pct, 2)}%`} />
            <Stat label="H2 consumed" value={fmt(exp.h2_consumption_mol, 3)} note="mol" />
          </div>
          <div className="detail-grid">
            <section className="card"><h3>Conditions</h3><KV e={exp} /></section>
            <section className="card"><h3>Selectivity</h3><Plot {...selectivity} className="short" /></section>
            {rate && <section className="card full"><h3>Reaction rate vs. time</h3><Plot {...rate} className="tall" /></section>}
            <section className="card full"><h3>Sources</h3><SourceList e={exp} /></section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, note }) {
  return <div className="stat"><span>{label}</span><span className="stat-value">{value}</span><small>{note}</small></div>;
}

function ImportReviewModal({
  session,
  backendScanState,
  backendBlockReview,
  backendNormalizeState,
  backendMappingState,
  backendChartProposalState,
  onBackendScanFile,
  onBlockReviewDecision,
  onPreviewNormalize,
  onApplyNormalize,
  onProposeMappings,
  onMappingDecision,
  onProposeCharts,
  onChartProposalDecision,
  onClose,
  onApproveProposal,
  onRejectProposal,
}) {
  const proposals = Array.isArray(session?.proposals?.proposals) ? session.proposals.proposals : [];
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal wide import-review-modal" role="dialog" aria-modal="true" aria-label="Import review">
        <div className="modal-head">
          <span>Import review</span>
          <button type="button" onClick={onClose}>x</button>
        </div>
        <div className="modal-body">
          <p className="import-review-note">
            Workbook scanning, block review, normalization, semantic mappings, and chart proposals stay review-only until you explicitly apply normalized data or accept/reject proposal overlays.
          </p>
          <BackendScanPanel
            scanState={backendScanState}
            blockReview={backendBlockReview}
            normalizeState={backendNormalizeState}
            mappingState={backendMappingState}
            chartProposalState={backendChartProposalState}
            onScanFile={onBackendScanFile}
            onBlockReviewDecision={onBlockReviewDecision}
            onPreviewNormalize={onPreviewNormalize}
            onApplyNormalize={onApplyNormalize}
            onProposeMappings={onProposeMappings}
            onMappingDecision={onMappingDecision}
            onProposeCharts={onProposeCharts}
            onChartProposalDecision={onChartProposalDecision}
          />
          <section className="import-review-section">
            <div className="import-review-section-head">
              <h3>Scanned workbooks</h3>
              <span>{session?.scan?.workbookCount || 0} files</span>
            </div>
            <div className="import-review-grid">
              {(session?.scan?.scannedWorkbooks || []).map((workbook) => (
                <article className="import-review-card" key={workbook.fileName}>
                  <div className="import-review-card-head">
                    <strong>{workbook.fileName}</strong>
                    <span>{workbook.sheetCount} sheets</span>
                  </div>
                  <p>Sheets: {workbook.sheetNames.join(", ") || "None"}</p>
                  <p>Experiment labels: {workbook.sheets.flatMap((sheet) => sheet.detectedExperimentLabels || []).filter((value, index, list) => value && list.indexOf(value) === index).join(", ") || "None detected"}</p>
                  <p>Units: {workbook.sheets.flatMap((sheet) => sheet.detectedUnits || []).filter((value, index, list) => value && list.indexOf(value) === index).slice(0, 6).join(", ") || "None detected"}</p>
                  <p>Keywords: {workbook.sheets.flatMap((sheet) => (sheet.keywordHits || []).map((hit) => hit.keyword)).filter((value, index, list) => value && list.indexOf(value) === index).join(", ") || "None detected"}</p>
                </article>
              ))}
            </div>
          </section>
          <section className="import-review-section">
            <div className="import-review-section-head">
              <h3>AI parser boundary</h3>
              <span>{session?.proposals?.parserStatus || "unknown"}</span>
            </div>
            <p className="import-review-note">{session?.proposals?.notes || "No parser notes."}</p>
            {proposals.length ? (
              <div className="import-review-proposals">
                {proposals.map((proposal) => (
                  <article className="import-review-proposal" key={proposal.proposalId}>
                    <div>
                      <strong>{proposal.targetPath}</strong>
                      <p>{proposal.experimentLabel || "Unscoped proposal"} from {proposal.sourceWorkbook || "unknown workbook"}</p>
                    </div>
                    <div className="import-review-actions">
                      <button type="button" onClick={() => onRejectProposal(proposal.proposalId)}>Reject</button>
                      <button type="button" className="primary" onClick={() => onApproveProposal(proposal.proposalId)}>Approve</button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="import-review-empty">
                No AI mapping proposals yet. The scanner metadata is ready for a future parser to consume.
              </div>
            )}
          </section>
          <section className="import-review-section">
            <div className="import-review-section-head">
              <h3>Review state</h3>
            </div>
            <p>Approved: {session?.confirmedProposalIds?.length || 0}</p>
            <p>Rejected: {session?.rejectedProposalIds?.length || 0}</p>
          </section>
        </div>
      </section>
    </div>
  );
}

function KV({ e }) {
  const rows = [["Temperature", `${fmt(e.temperature_C, 0)} C`], ["Pressure", `${fmt(e.pressure_bar, 0)} bar`], ["Reaction time", `${fmt(e.reaction_time_hr, 1)} h`], ["RPM", fmt(e.rpm, 0)], ["Catalyst", `${fmt(e.catalyst_loading_g, 4)} g`], ["HDPE", `${fmt(e.polymer_loading_g, 4)} g`]];
  return <dl className="kv">{rows.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>;
}

function SourceList({ e }) {
  return <div className="sources"><FilePills e={e} />{(e.sources || []).map((s, i) => <div key={i} className="source-row"><span>{s.kind}</span><span>{s.file}{s.sheet ? ` - ${s.sheet}` : ""}{s.row ? ` - row ${s.row}` : ""}</span></div>)}</div>;
}

function ReferenceLibrary({ references, setReferences }) {
  const [filter, setFilter] = useState("all");
  const addFiles = (files) => Array.from(files || []).forEach((file) => {
    const reader = new FileReader();
    reader.onload = () => setReferences((refs) => [...refs, { id: uid(), name: file.name, mime: file.type, size: file.size, dataUrl: reader.result, note: "", createdAt: Date.now(), kind: refKind(file) }]);
    reader.readAsDataURL(file);
  });
  const shown = filter === "all" ? references : references.filter((r) => r.kind === filter);
  return <main className="reference main">
    <div className="page-head"><div><h1>Add Reference</h1><p>Upload images, PDFs, raw data, calculations, and notes into the local reference library.</p></div></div>
    <label className="drop">Drop or choose files<input type="file" multiple onChange={(e) => addFiles(e.target.files)} /></label>
    <div className="chips ref-filter">{["all", "image", "pdf", "data", "document", "code", "other"].map((k) => <Chip key={k} active={filter === k} onClick={() => setFilter(k)}>{k}</Chip>)}</div>
    <div className="ref-grid">{shown.map((r) => <article className="ref-card" key={r.id}>
      <div className="thumb">{r.kind === "image" ? <img src={r.dataUrl} alt="" /> : <span>{r.kind}</span>}</div>
      <div className="ref-info"><span>{r.name}</span><small>{Math.round(r.size / 1024)} KB</small><textarea value={r.note} placeholder="Add a note..." onChange={(e) => setReferences((refs) => refs.map((x) => x.id === r.id ? { ...x, note: e.target.value } : x))} /></div>
      <div className="ref-actions"><a href={r.dataUrl} download={r.name}>Download</a><button onClick={() => setReferences((refs) => refs.filter((x) => x.id !== r.id))}>Delete</button></div>
    </article>)}</div>
  </main>;
}

function refKind(file) {
  const n = file.name.toLowerCase();
  if (file.type.startsWith("image/")) return "image";
  if (n.endsWith(".pdf")) return "pdf";
  if (/\.(xlsx|xls|csv|tsv|txt|log|json)$/i.test(n)) return "data";
  if (/\.(docx|doc|md|pptx)$/i.test(n)) return "document";
  if (/\.(m|py|js|r|mat)$/i.test(n)) return "code";
  return "other";
}

function AgentPanel({ open, setOpen, dataset, blocks, setBlocks, references, selected, selectedChartContext, pendingChartAnalysis, onChartAnalysisHandled }) {
  const [history, setHistory] = useState(() => ls.get("labrat_blank_chat_history_v1_react", []).map(({ streaming, streamId, ...message }) => message));
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("labrat_blank_anthropic_key_v1") || "");
  const [model, setModel] = useState(() => localStorage.getItem("labrat_blank_anthropic_model_v1") || "claude-sonnet-4-5");
  const [writingExamples, setWritingExamples] = useState(() => localStorage.getItem("labrat_blank_writing_examples_v1") || "");
  const [projectBackground, setProjectBackground] = useState(() => localStorage.getItem("labrat_blank_project_background_v1") || "");
  const [houseRules, setHouseRules] = useState(() => localStorage.getItem("labrat_blank_house_rules_v1") || "");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState({
    apiKey,
    model,
    writingExamples,
    projectBackground,
    houseRules,
  });
  useEffect(() => {
    ls.set("labrat_blank_chat_history_v1_react", history.map(({ streaming, streamId, ...message }) => message));
  }, [history]);
  const openSettings = () => {
    setSettingsDraft({ apiKey, model, writingExamples, projectBackground, houseRules });
    setSettingsOpen(true);
  };
  const cancelSettings = () => {
    setSettingsDraft({ apiKey, model, writingExamples, projectBackground, houseRules });
    setSettingsOpen(false);
  };
  const saveSettings = () => {
    const next = {
      apiKey: settingsDraft.apiKey,
      model: settingsDraft.model || "claude-sonnet-4-5",
      writingExamples: settingsDraft.writingExamples,
      projectBackground: settingsDraft.projectBackground,
      houseRules: settingsDraft.houseRules,
    };
    setApiKey(next.apiKey);
    setModel(next.model);
    setWritingExamples(next.writingExamples);
    setProjectBackground(next.projectBackground);
    setHouseRules(next.houseRules);
    localStorage.setItem("labrat_blank_anthropic_key_v1", next.apiKey);
    localStorage.setItem("labrat_blank_anthropic_model_v1", next.model);
    localStorage.setItem("labrat_blank_writing_examples_v1", next.writingExamples);
    localStorage.setItem("labrat_blank_project_background_v1", next.projectBackground);
    localStorage.setItem("labrat_blank_house_rules_v1", next.houseRules);
    setSettingsOpen(false);
  };
  const updateSettingsDraft = (key, value) => setSettingsDraft((draft) => ({ ...draft, [key]: value }));
  const context = () => ({
    study: dataset.metadata.study,
    n_experiments: dataset.experiments.length,
    selected: selected?.label,
    selected_chart: selectedChartContext,
    assistant_profile: {
      writing_examples: writingExamples,
      project_background: projectBackground,
      house_rules: houseRules,
    },
    manuscript_blocks: blocks.map((b) => ({ kind: b.kind, chartKind: b.chartKind, labels: b.labels, title: b.opts?.title, text: b.kind === "text" ? b.html : undefined })),
    references: references.map((r) => ({ name: r.name, kind: r.kind, note: r.note })),
    experiments_csv: dataset.experiments.map((e) => [e.label, e.catalyst_loading_g, e.rpm, e.impeller, e.reaction_time_hr, e.conversion_pct, e.selectivity_liquid_pct, e.carbon_balance_pct].join(",")).join("\n"),
  });
  const appendStreamDelta = (streamId, delta) => {
    setHistory((current) => current.map((message) => (
      message.streamId === streamId ? { ...message, text: `${message.text || ""}${delta}` } : message
    )));
  };
  const finishStreamMessage = (streamId, patch = {}) => {
    setHistory((current) => current.map((message) => {
      if (message.streamId !== streamId) return message;
      const { streaming, streamId: _streamId, ...rest } = message;
      return { ...rest, ...patch };
    }));
  };
  const readAnthropicStream = async (body, onText) => {
    if (!body) throw new Error("Streaming response body is unavailable.");
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const handleEvent = (rawEvent) => {
      const data = rawEvent
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") return;
      const event = JSON.parse(data);
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        onText(event.delta.text || "");
      }
      if (event.type === "error") {
        throw new Error(event.error?.message || "Streaming request failed.");
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() || "";
      parts.forEach((part) => part.trim() && handleEvent(part));
      if (done) break;
    }
    if (buffer.trim()) handleEvent(buffer);
  };
  const send = async (prefill, meta = null) => {
    const text = (prefill ?? input).trim();
    if (!text || busy) return;
    setInput("");
    const next = [...history.map(({ streaming, streamId, ...message }) => message), { role: "user", text, meta }];
    setHistory(next);
    if (!apiKey) {
      setHistory([...next, { role: "assistant", text: "Add an Anthropic API key in settings to enable live answers. I can already see the selected chart context locally." }]);
      return;
    }
    const streamId = uid();
    let streamedText = "";
    setHistory([...next, { role: "assistant", text: "", meta, streaming: true, streamId }]);
    setBusy(true);
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({
          model,
          max_tokens: 1200,
          stream: true,
          system: `You are LabRat, a concise research assistant for HDPE hydroconversion over Ru/TiO2. Use the JSON context and experiment CSV. Do not invent mechanisms or values. Match the user's saved writing voice when examples are provided, use the project background for scope, and obey house rules. Context:\n${JSON.stringify(context())}`,
          messages: next.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.text })),
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      await readAnthropicStream(resp.body, (delta) => {
        streamedText += delta;
        appendStreamDelta(streamId, delta);
      });
      finishStreamMessage(streamId, { text: streamedText || "No text response.", meta });
    } catch (err) {
      const failure = `Request failed: ${err.message}`;
      finishStreamMessage(streamId, { text: streamedText ? `${streamedText}\n\n${failure}` : failure, meta });
    } finally {
      setBusy(false);
    }
  };
  const selectedChartMeta = selectedChartContext
    ? { source: "chart", chartBlockId: selectedChartContext.blockId, chartBox: selectedChartContext.block }
    : null;
  const chartPrompt = (task) => {
    if (!selectedChartContext) return;
    const chartJson = JSON.stringify(selectedChartContext);
    const plainTextRule = "Return plain text only. Do not use Markdown headings, bold text, bullet points, numbered lists, tables, labels, or section headers.";
    const prompts = {
      describe: `Describe the selected chart for insertion into a manuscript text box. Write one polished paragraph of 80-130 words. Focus on what is plotted, the major trend, and any caveats visible from the data. Avoid inventing mechanisms. ${plainTextRule} Selected chart JSON:\n${chartJson}`,
      trend: `Summarize the key trend in the selected chart for insertion into a manuscript text box. Write 2-3 concise plain sentences. Mention experiment labels and values when useful. Avoid overclaiming. ${plainTextRule} Selected chart JSON:\n${chartJson}`,
      caption: `Draft a manuscript-style figure caption for insertion into a manuscript text box. Write 1-2 concise plain sentences. Include chart type, compared experiments, plotted quantities, and a neutral takeaway. ${plainTextRule} Selected chart JSON:\n${chartJson}`,
    };
    send(prompts[task], selectedChartMeta);
  };
  useEffect(() => {
    if (!pendingChartAnalysis || busy) return;
    if (pendingChartAnalysis.blockId !== selectedChartContext?.blockId) return;
    onChartAnalysisHandled?.(pendingChartAnalysis.nonce);
    chartPrompt("describe");
  }, [pendingChartAnalysis?.nonce, pendingChartAnalysis?.blockId, selectedChartContext?.blockId, busy]);
  const cleanAssistantText = (text) => String(text || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const insertAssistantText = (message) => {
    const box = message.meta?.chartBox || selectedChartContext?.block;
    const id = uid();
    const cleanedText = cleanAssistantText(message.text);
    setBlocks((currentBlocks) => {
      const current = Array.isArray(currentBlocks) ? currentBlocks : [];
      return [...current, {
        id,
        kind: "text",
        x: Math.max(0, box?.x ?? 120),
        y: Math.max(0, (box?.y ?? 120) + (box?.h ?? 220) + 24),
        w: Math.max(360, Math.min(box?.w ?? 520, 700)),
        h: 180,
        html: cleanedText,
        fontSize: 14,
      }];
    });
  };
  const logoSrc = `${import.meta.env.BASE_URL}labrat-logo.png`;
  const closeAgent = () => {
    setExpanded(false);
    setOpen(false);
  };
  return <>
  <aside className={`agent ${open ? "open" : ""} ${expanded ? "expanded" : ""}`}>
    <div className="agent-head">
      <div className="agent-title">
        <img src={logoSrc} alt="" />
        <span>the lab rat</span>
      </div>
      <div className="agent-head-actions">
        <button type="button" aria-label={expanded ? "Collapse Lab Rat panel" : "Expand Lab Rat panel"} title={expanded ? "Collapse" : "Expand"} onClick={() => setExpanded((value) => !value)}>{expanded ? "\u2199" : "\u2197"}</button>
        <button type="button" className={settingsOpen ? "active" : ""} aria-label="Settings" title="Settings" onClick={openSettings}>&#9881;</button>
        <button type="button" aria-label="Reset chat" title="Reset chat" onClick={() => setHistory([])}>&#8635;</button>
        <button type="button" aria-label="Close Lab Rat panel" title="Close" onClick={closeAgent}>&times;</button>
      </div>
    </div>
    <div className="agent-context">Manuscript 路 {blocks.length} blocks on canvas 路 focused: {selected?.label || "none"} 路 {selectedChartContext ? "1 chart selected" : "0 charts selected"}</div>
    {selectedChartContext && (
      <div className="agent-chart-context">
        <img className="agent-chart-avatar" src={logoSrc} alt="" />
        <div className="agent-chart-copy">
          <button type="button" className="agent-chart-callout" disabled={busy} onClick={() => chartPrompt("describe")}>Want help writing about this chart?</button>
          <span>Selected chart: {selectedChartContext.title}</span>
          <div className="agent-chart-actions">
            <button disabled={busy} onClick={() => chartPrompt("describe")}>Analysis</button>
            <button disabled={busy} onClick={() => chartPrompt("trend")}>Trend</button>
            <button disabled={busy} onClick={() => chartPrompt("caption")}>Caption</button>
          </div>
        </div>
      </div>
    )}
    <div className="messages">
      {!history.length && <div className="welcome">
        <img className="welcome-avatar" src={logoSrc} alt="" />
        <span>Hi! I'm the lab rat.</span>
        <p>I can read all your experiments, the manuscript canvas, and references. Ask me anything: analyze a chart, compare experiments, draft a paragraph, or explain a result.</p>
        <button onClick={() => send("Give me a one-paragraph overview of the trends across all experiments.")}>Overview of all experiments</button>
        <button onClick={() => send("Which experiment has the highest liquid selectivity, and why?")}>Highest liquid selectivity?</button>
        <button onClick={() => send("Compare reaction time vs selectivity across the experiments. Highlight the main trend and any caveats.")}>Reaction time vs selectivity</button>
      </div>}
      {history.map((m, i) => <div key={i} className={`msg ${m.role}`}>
        {m.role === "assistant" ? <img className="msg-avatar" src={logoSrc} alt="" /> : <span className="msg-avatar user">You</span>}
        <div className="msg-body">
          <span>{m.role === "user" ? "You" : "the lab rat"}</span>
          <p>{m.text}</p>
          {m.role === "assistant" && m.meta?.source === "chart" && m.text && !m.streaming && !m.text.startsWith("Request failed:") && <button className="insert-chat-text" onClick={() => insertAssistantText(m)}>Insert as text box</button>}
        </div>
      </div>)}
      {busy && !history.some((m) => m.role === "assistant" && m.streaming && m.text) && <div className="typing">Thinking...</div>}
    </div>
    <div className="agent-foot">
      <button type="button" className="agent-tool" aria-label="Attach reference">+</button>
      <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Ask the rat about your data, charts, or manuscript..." />
      <button type="button" className="agent-send" onClick={() => send()}>&#8593;</button>
    </div>
  </aside>
  {settingsOpen && (
    <div className="settings-backdrop" onMouseDown={(e) => e.target === e.currentTarget && cancelSettings()}>
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="labrat-settings-title">
        <div className="settings-head">
          <h2 id="labrat-settings-title">Lab rat settings</h2>
          <button type="button" aria-label="Close settings" onClick={cancelSettings}>&times;</button>
        </div>
        <div className="settings-body">
          <section className="settings-section">
            <h3>API</h3>
            <label className="settings-field">
              <span>Anthropic API key</span>
              <input type="password" value={settingsDraft.apiKey} onChange={(e) => updateSettingsDraft("apiKey", e.target.value)} />
            </label>
            <p className="settings-help">Get a key at <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer">console.anthropic.com</a> - API Keys. Stored only in your browser's local storage. New accounts get free credits.</p>
            <label className="settings-field">
              <span>Model</span>
              <select value={settingsDraft.model} onChange={(e) => updateSettingsDraft("model", e.target.value)}>
                {settingsDraft.model && !["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-3-5"].includes(settingsDraft.model) && (
                  <option value={settingsDraft.model}>{settingsDraft.model}</option>
                )}
                <option value="claude-sonnet-4-5">Claude Sonnet 4.5 (recommended)</option>
                <option value="claude-opus-4-1">Claude Opus 4.1</option>
                <option value="claude-haiku-3-5">Claude Haiku 3.5</option>
              </select>
            </label>
          </section>
          <section className="settings-section">
            <h3>Voice &amp; Context</h3>
            <p className="settings-help">Anything you put here is included in every chat. The agent picks up your writing voice from the examples, learns your project from the background, and obeys the house rules.</p>
            <div className="settings-textarea-head">
              <label htmlFor="writing-examples">Your writing examples</label>
              <button type="button" disabled>Load from file...</button>
            </div>
            <textarea id="writing-examples" className="settings-large-textarea" value={settingsDraft.writingExamples} onChange={(e) => updateSettingsDraft("writingExamples", e.target.value)} placeholder="Paste 2-4 paragraphs you've written before (analysis paragraphs from previous papers, discussion sections, captions). The agent will match this voice." />
            <div className="settings-textarea-head">
              <label htmlFor="project-background">Lab / project background</label>
              <button type="button" disabled>Load from file...</button>
            </div>
            <textarea id="project-background" className="settings-medium-textarea" value={settingsDraft.projectBackground} onChange={(e) => updateSettingsDraft("projectBackground", e.target.value)} placeholder="What's the broader study about? What catalysts, polymers, or systems are in scope? Any terminology specific to your lab the agent should know." />
            <div className="settings-textarea-head">
              <label htmlFor="house-rules">House rules</label>
              <button type="button" disabled>Load from file...</button>
            </div>
            <textarea id="house-rules" className="settings-medium-textarea" value={settingsDraft.houseRules} onChange={(e) => updateSettingsDraft("houseRules", e.target.value)} placeholder="Conventions, e.g.: use SI units; selectivity reported as % with one decimal; never say 'highly significant'; cite as Author (year)." />
          </section>
        </div>
        <div className="settings-actions">
          <button type="button" onClick={cancelSettings}>Cancel</button>
          <button type="button" className="settings-save" onClick={saveSettings}>Save</button>
        </div>
      </section>
    </div>
  )}
  </>;
}

function App() {
  const [tab, setTab] = useState("browser");
  const [dataset, setDataset] = useState(() => BLANK_MODE ? emptyDataset() : ls.get("labrat_dataset", emptyDataset()));
  const [sourceName, setSourceName] = useState(() => BLANK_MODE ? BLANK_PROJECT_SOURCE_NAME : (localStorage.getItem("labrat_blank_source_name") || "embedded LabRat dataset"));
  const [sourceError, setSourceError] = useState("");
  const [loadingSource, setLoadingSource] = useState(false);
  const [staged, setStaged] = useState(() => ls.get("labrat_staged", []));
  const [blocks, setBlocks] = useState(() => ls.get("labrat_blocks", []));
  const [canvasHeight, setCanvasHeight] = useState(() => ls.get("labrat_canvas_height", 0));
  const [pages, setPages] = useState(null);
  const [pageOrientationPreference, setPageOrientationPreference] = useState(null);
  const [chartTemplates, setChartTemplates] = useState(() => ls.get("labrat_chart_templates", []));
  const [references, setReferences] = useState(() => ls.get("labrat_refs", []));
  const [selected, setSelected] = useState(null);
  const [selectedChartContext, setSelectedChartContext] = useState(null);
  const [pendingChartAnalysis, setPendingChartAnalysis] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [projectLoaded, setProjectLoaded] = useState(false);
  const [importReviewOpen, setImportReviewOpen] = useState(false);
  const [importSession, setImportSession] = useState(null);
  const [backendScanState, setBackendScanState] = useState({ loading: false, result: null, error: "", fileName: "" });
  const [backendBlockReview, setBackendBlockReview] = useState(() => createBlockReviewState());
  const [backendNormalizeState, setBackendNormalizeState] = useState({ loading: false, result: null, error: "" });
  const [backendMappingState, setBackendMappingState] = useState({ loading: false, result: null, error: "" });
  const [backendChartProposalState, setBackendChartProposalState] = useState({ loading: false, result: null, error: "" });
  useEffect(() => {
    let cancelled = false;
    loadActiveProject()
      .then(async (project) => {
        if (cancelled) return;
        const next = await resolveStartupProject({
          existingProject: project,
          blankMode: BLANK_MODE,
          legacyDataset: dataset,
          sourceName,
          staged,
          blocks,
          pages,
          canvasHeight,
          pageOrientationPreference,
          chartTemplates,
          references,
        });
        if (cancelled) return;
        if (!project) await saveActiveProject(next);
        if (cancelled) return;
        setDataset(next.dataset);
        setSourceName(next.sourceName);
        setStaged(next.staged);
        setBlocks(next.blocks);
        setPages(next.pages);
        setCanvasHeight(next.canvasHeight);
        setPageOrientationPreference(next.pageOrientationPreference);
        setChartTemplates(next.chartTemplates);
        setReferences(next.references);
        setDirty(false);
      })
      .catch((err) => {
        if (!cancelled) setSourceError(`Startup load failed: ${err.message}`);
      })
      .finally(() => {
        if (!cancelled) setProjectLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (projectLoaded) setDirty(true);
  }, [staged, blocks, pages, references, canvasHeight, pageOrientationPreference, chartTemplates]);
  const currentProject = () => buildProjectRecord({ dataset, sourceName, staged, blocks, pages, canvasHeight, pageOrientationPreference, chartTemplates, references });
  const save = async () => {
    try {
      await saveActiveProject(currentProject());
      setSourceError("");
      setDirty(false);
    } catch (err) {
      setSourceError(`Save failed: ${err.message}`);
    }
  };
  const applyProject = (project) => {
    setDataset(project.dataset);
    setSourceName(project.sourceName);
    setStaged(project.staged);
    setBlocks(project.blocks);
    setPages(project.pages);
    setCanvasHeight(project.canvasHeight);
    setPageOrientationPreference(project.pageOrientationPreference);
    setChartTemplates(project.chartTemplates);
    setReferences(project.references);
    setSelected(null);
    setSelectedChartContext(null);
  };
  const exportProject = () => {
    const project = currentProject();
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const date = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `labrat-project-${date}.labrat.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };
  const importProject = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const project = normalizeProjectRecord(JSON.parse(text), dataset);
      await saveActiveProject(project);
      applyProject(project);
      setSourceError("");
      setDirty(false);
    } catch (err) {
      setSourceError(`Import failed: ${err.message}`);
    }
  };
  const loadFolder = async (files) => {
    if (!files?.length) return;
    setLoadingSource(true);
    setSourceError("");
    try {
      const next = await parseLocalExcelFolder(files);
      let nextImportSession = null;
      try {
        const scan = await scanExcelFolder(files);
        const proposals = proposeExcelMappingsFromScan(scan);
        nextImportSession = {
          createdAt: new Date().toISOString(),
          scan,
          proposals,
          confirmedProposalIds: [],
          rejectedProposalIds: [],
        };
      } catch (scanErr) {
        nextImportSession = {
          createdAt: new Date().toISOString(),
          scan: { workbookCount: 0, scannedWorkbooks: [] },
          proposals: {
            parserStatus: "stub",
            generatedAt: new Date().toISOString(),
            parserName: "future-ai-parser",
            proposals: [],
            notes: `Scanner unavailable: ${scanErr.message || String(scanErr)}`,
          },
          confirmedProposalIds: [],
          rejectedProposalIds: [],
        };
      }
      setDataset(next);
      setSourceName(`local folder (${next.experiments.length} experiments)`);
      setStaged([]);
      setBlocks([]);
      setPages([]);
      setCanvasHeight(0);
      setPageOrientationPreference(null);
      await saveActiveProject(buildProjectRecord({
        dataset: next,
        sourceName: `local folder (${next.experiments.length} experiments)`,
        staged: [],
        blocks: [],
        pages: [],
        canvasHeight: 0,
        pageOrientationPreference: null,
        chartTemplates,
        references,
      }));
      setImportSession(nextImportSession);
      setDirty(false);
    } catch (err) {
      setSourceError(err.message || String(err));
    } finally {
      setLoadingSource(false);
    }
  };
  const stage = (label) => setStaged((s) => s.includes(label) ? s.filter((x) => x !== label) : [...s, label]);
  const requestChartAnalysis = (blockId) => {
    setAgentOpen(true);
    setPendingChartAnalysis({ blockId, nonce: Date.now() });
  };
  const clearChartAnalysisRequest = (nonce) => {
    setPendingChartAnalysis((request) => request?.nonce === nonce ? null : request);
  };
  const approveImportProposal = (proposalId) => {
    setImportSession((current) => current ? {
      ...current,
      confirmedProposalIds: current.confirmedProposalIds.includes(proposalId) ? current.confirmedProposalIds : [...current.confirmedProposalIds, proposalId],
      rejectedProposalIds: current.rejectedProposalIds.filter((id) => id !== proposalId),
    } : current);
  };
  const rejectImportProposal = (proposalId) => {
    setImportSession((current) => current ? {
      ...current,
      rejectedProposalIds: current.rejectedProposalIds.includes(proposalId) ? current.rejectedProposalIds : [...current.rejectedProposalIds, proposalId],
      confirmedProposalIds: current.confirmedProposalIds.filter((id) => id !== proposalId),
    } : current);
  };
  const runBackendScan = async (file) => {
    if (!file) return;
    setBackendScanState({ loading: true, result: null, error: "", fileName: file.name });
    setBackendBlockReview(createBlockReviewState());
    setBackendNormalizeState({ loading: false, result: null, error: "" });
    setBackendMappingState({ loading: false, result: null, error: "" });
    setBackendChartProposalState({ loading: false, result: null, error: "" });
    try {
      const result = await scanWorkbookWithBackend(file);
      setBackendScanState({ loading: false, result, error: "", fileName: file.name });
      setBackendBlockReview(createBlockReviewState(result));
      setBackendNormalizeState({ loading: false, result: null, error: "" });
      setBackendMappingState({ loading: false, result: null, error: "" });
      setBackendChartProposalState({ loading: false, result: null, error: "" });
    } catch (err) {
      setBackendScanState({
        loading: false,
        result: null,
        error: err.message || String(err),
        fileName: file.name,
      });
      setBackendBlockReview(createBlockReviewState());
      setBackendNormalizeState({ loading: false, result: null, error: "" });
      setBackendMappingState({ loading: false, result: null, error: "" });
      setBackendChartProposalState({ loading: false, result: null, error: "" });
    }
  };
  const setBackendBlockDecision = (blockId, decision) => {
    setBackendBlockReview((current) => setBlockReviewDecision(current, blockId, decision));
    setBackendNormalizeState({ loading: false, result: null, error: "" });
    setBackendMappingState({ loading: false, result: null, error: "" });
    setBackendChartProposalState({ loading: false, result: null, error: "" });
  };
  const previewBackendNormalization = async () => {
    if (!backendScanState.result) return;
    setBackendNormalizeState({ loading: true, result: null, error: "" });
    setBackendMappingState({ loading: false, result: null, error: "" });
    setBackendChartProposalState({ loading: false, result: null, error: "" });
    try {
      const result = await normalizeScanWithBackend({
        scanResult: backendScanState.result,
        approvedBlockIds: backendBlockReview.approvedBlockIds,
      });
      setBackendNormalizeState({ loading: false, result, error: "" });
    } catch (err) {
      setBackendNormalizeState({ loading: false, result: null, error: err.message || String(err) });
    }
  };
  const applyBackendNormalization = () => {
    const datasetPatch = backendNormalizeState.result?.datasetPatch;
    if (!datasetPatch?.genericImports?.length) return;
    const ok = window.confirm("Apply normalized generic import data to this project?");
    if (!ok) return;
    setDataset((current) => applyGenericImportPatch(current, datasetPatch));
    setBackendNormalizeState((current) => ({ ...current, applied: true }));
    setDirty(true);
  };
  const currentPhase3GenericImports = () => {
    const previewImports = backendNormalizeState.result?.datasetPatch?.genericImports;
    return previewImports?.length ? previewImports : (dataset.genericImports || []);
  };
  const proposeBackendMappings = async () => {
    const genericImports = currentPhase3GenericImports();
    if (!genericImports.length) return;
    setBackendMappingState({ loading: true, result: null, error: "" });
    setBackendChartProposalState({ loading: false, result: null, error: "" });
    try {
      const result = await proposeSemanticMappingsWithBackend({
        genericImports,
        selectedImportIds: genericImports.map((item) => item.importId).filter(Boolean),
        scanSummary: backendScanState.result?.summary || null,
        priorDecisions: (dataset.genericMappingSets || []).flatMap((set) => set.mappings || []),
      });
      setBackendMappingState({ loading: false, result, error: "" });
      setDataset((current) => upsertGenericMappingSet(current, result.mappingSet));
      setDirty(true);
    } catch (err) {
      setBackendMappingState({ loading: false, result: null, error: err.message || String(err) });
    }
  };
  const setBackendMappingDecision = (mappingId, status) => {
    const mappingSet = backendMappingState.result?.mappingSet;
    if (!mappingSet) return;
    const nextMappingSet = setMappingStatus(mappingSet, mappingId, status);
    setBackendMappingState((current) => current.result ? ({
      ...current,
      result: { ...current.result, mappingSet: nextMappingSet },
    }) : current);
    setBackendChartProposalState({ loading: false, result: null, error: "" });
    setDataset((current) => upsertGenericMappingSet(current, nextMappingSet));
    setDirty(true);
  };
  const proposeBackendCharts = async () => {
    const genericImports = currentPhase3GenericImports();
    const mappingSet = backendMappingState.result?.mappingSet;
    if (!genericImports.length || !mappingSet) return;
    setBackendChartProposalState({ loading: true, result: null, error: "" });
    try {
      const result = await proposeChartsWithBackend({
        genericImports,
        selectedImportIds: genericImports.map((item) => item.importId).filter(Boolean),
        mappingSets: [mappingSet],
        priorDecisions: (dataset.genericChartProposals || []).flatMap((set) => set.proposals || []),
      });
      setBackendChartProposalState({ loading: false, result, error: "" });
      setDataset((current) => upsertGenericChartProposalSet(current, result.proposalSet));
      setDirty(true);
    } catch (err) {
      setBackendChartProposalState({ loading: false, result: null, error: err.message || String(err) });
    }
  };
  const setBackendChartProposalDecision = (proposalId, status) => {
    const proposalSet = backendChartProposalState.result?.proposalSet;
    if (!proposalSet) return;
    const nextProposalSet = setChartProposalStatus(proposalSet, proposalId, status);
    setBackendChartProposalState((current) => current.result ? ({
      ...current,
      result: { ...current.result, proposalSet: nextProposalSet },
    }) : current);
    setDataset((current) => upsertGenericChartProposalSet(current, nextProposalSet));
    setDirty(true);
  };
  return (
    <>
      <Topbar tab={tab} setTab={setTab} dirty={dirty} onSave={save} onAgent={() => setAgentOpen(true)}
        dataset={dataset} sourceName={sourceName} sourceError={sourceError} loadingSource={loadingSource} onLoadFolder={loadFolder} onExportProject={exportProject} onImportProject={importProject} onOpenImportReview={() => setImportReviewOpen(true)} hasImportReview blankMode={BLANK_MODE} />
      {tab === "browser" && <Browser dataset={dataset} sourceName={sourceError || sourceName} setSelected={setSelected} blankMode={BLANK_MODE} onOpenImportReview={() => setImportReviewOpen(true)} templateLinks={blankTemplateLinks()} />}
      {tab === "manuscript" && <ManuscriptCanvas dataset={dataset} blocks={blocks} setBlocks={setBlocks} staged={staged} setStaged={setStaged} references={references} chartTemplates={chartTemplates} setChartTemplates={setChartTemplates} pages={pages} setPages={setPages} canvasHeight={canvasHeight} setCanvasHeight={setCanvasHeight} pageOrientationPreference={pageOrientationPreference} setPageOrientationPreference={setPageOrientationPreference} onSelectedChartContextChange={setSelectedChartContext} onRequestChartAnalysis={requestChartAnalysis} onSaveProject={save} />}
      {tab === "reference" && <ReferenceLibrary references={references} setReferences={setReferences} />}
      <DetailModal exp={selected} onClose={() => setSelected(null)} onStage={stage} />
      {importReviewOpen && <ImportReviewModal
        session={importSession}
        backendScanState={backendScanState}
        backendBlockReview={backendBlockReview}
        backendNormalizeState={backendNormalizeState}
        backendMappingState={backendMappingState}
        backendChartProposalState={backendChartProposalState}
        onBackendScanFile={runBackendScan}
        onBlockReviewDecision={setBackendBlockDecision}
        onPreviewNormalize={previewBackendNormalization}
        onApplyNormalize={applyBackendNormalization}
        onProposeMappings={proposeBackendMappings}
        onMappingDecision={setBackendMappingDecision}
        onProposeCharts={proposeBackendCharts}
        onChartProposalDecision={setBackendChartProposalDecision}
        onClose={() => setImportReviewOpen(false)}
        onApproveProposal={approveImportProposal}
        onRejectProposal={rejectImportProposal}
      />}
      <AgentPanel open={agentOpen} setOpen={setAgentOpen} dataset={dataset} blocks={blocks} setBlocks={setBlocks} references={references} selected={selected} selectedChartContext={selectedChartContext} pendingChartAnalysis={pendingChartAnalysis} onChartAnalysisHandled={clearChartAnalysisRequest} />
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);

