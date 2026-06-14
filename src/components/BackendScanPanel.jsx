import React from "react";
import { makeGenericChartPreview } from "../charts/genericChartPreview.js";
import { Plot } from "../charts/Plot.jsx";
import { blockReviewDecision } from "../data/importBlockReviewState.js";

function warningCount(result) {
  return result?.summary?.warningCount ?? result?.warnings?.length ?? 0;
}

function formatConfidence(value) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "n/a";
}

function sourceLabel(source) {
  if (!source) return "source n/a";
  return [source.sheet, source.range || source.cell].filter(Boolean).join(" ") || "source n/a";
}

function WarningList({ warnings }) {
  const items = Array.isArray(warnings) ? warnings : [];
  if (!items.length) return <span className="backend-scan-muted">No warnings</span>;
  return (
    <ul className="backend-scan-list">
      {items.map((warning, index) => (
        <li key={`${warning.code || "warning"}-${index}`}>
          <strong>{warning.code || "warning"}</strong>
          <span>{warning.message || ""}</span>
          {warning.range && <em>{warning.range}</em>}
        </li>
      ))}
    </ul>
  );
}

function NormalizedPreview({ normalizeState, onApplyNormalize }) {
  const state = normalizeState || {};
  const result = state.result || null;
  if (state.loading) return <div className="import-review-empty">Preparing normalized preview...</div>;
  if (state.error) return <p className="import-review-error">{state.error}</p>;
  if (!result) return <div className="import-review-empty">No normalized preview yet.</div>;

  const genericImports = result.datasetPatch?.genericImports || [];
  const experimentCount = result.summary?.createdExperiments ?? genericImports.reduce((total, item) => total + (item.experiments?.length || 0), 0);
  const measurementCount = result.summary?.createdMeasurements ?? genericImports.reduce((total, item) => total + (item.measurements?.length || 0), 0);
  const warningCountValue = result.summary?.warningCount ?? genericImports.reduce((total, item) => total + (item.warnings?.length || 0), 0);

  return (
    <div className="backend-normalize-preview">
      <div className="backend-scan-stats">
        <span>{genericImports.length} generic imports</span>
        <span>{experimentCount} experiments</span>
        <span>{measurementCount} measurements</span>
        <span>{warningCountValue} warnings</span>
      </div>
      <div className="backend-normalize-toolbar">
        <button
          type="button"
          className="primary"
          disabled={!genericImports.length}
          onClick={() => onApplyNormalize?.()}
        >
          Apply normalized data
        </button>
        {state.applied && <span>Normalized data applied to project</span>}
      </div>
      {genericImports.map((item) => (
        <article className="backend-normalize-card" key={item.importId}>
          <div className="backend-scan-block-head">
            <strong>{item.fileName || item.importId}</strong>
            <span>{item.approvedBlockIds?.length || 0} approved blocks</span>
          </div>
          <p className="backend-scan-muted">
            Sources: {item.sources?.length || 0} - Files: {item.files?.length || 0}
          </p>
          <p className="backend-scan-muted">
            Measurements: {(item.measurements || []).slice(0, 4).map((measurement) => measurement.displayName).join(", ") || "None"}
          </p>
        </article>
      ))}
      <pre>{JSON.stringify(result, null, 2)}</pre>
    </div>
  );
}

function MappingProposalReview({ genericImports, mappingState, onProposeMappings, onMappingDecision }) {
  const state = mappingState || {};
  const mappingSet = state.result?.mappingSet || null;
  const mappings = mappingSet?.mappings || [];
  const warningCountValue = mappingSet?.warnings?.length || 0;
  const canPropose = genericImports.length > 0 && !state.loading;

  return (
    <section className="backend-proposal-section">
      <div className="backend-normalize-toolbar">
        <button
          type="button"
          className="primary"
          disabled={!canPropose}
          onClick={() => onProposeMappings?.()}
        >
          {state.loading ? "Proposing mappings..." : "Propose mappings"}
        </button>
        <span>{mappings.length} mapping proposals</span>
      </div>
      {state.error && <p className="import-review-error">{state.error}</p>}
      {!mappingSet && !state.loading && <div className="import-review-empty">No semantic mapping proposals yet.</div>}
      {mappingSet && (
        <div className="backend-proposal-grid">
          <div className="backend-scan-stats">
            <span>{mappings.length} mappings</span>
            <span>{mappings.filter((mapping) => mapping.status === "accepted").length} accepted</span>
            <span>{mappings.filter((mapping) => mapping.status === "rejected").length} rejected</span>
            <span>{warningCountValue} warnings</span>
          </div>
          {mappings.map((mapping) => (
            <article className="backend-proposal-card" key={mapping.mappingId}>
              <div className="backend-scan-block-head">
                <strong>{mapping.rawLabel || mapping.mappingId}</strong>
                <span>{mapping.semanticRole} - {formatConfidence(mapping.confidence)}</span>
              </div>
              <p className="backend-scan-muted">
                {mapping.canonicalField} - {mapping.valueType}{mapping.unit ? ` - ${mapping.unit}` : ""}
              </p>
              <p className="backend-scan-muted">{mapping.rationale}</p>
              <WarningList warnings={mapping.warnings} />
              <div className="import-review-actions">
                <button
                  type="button"
                  className={mapping.status === "accepted" ? "primary" : ""}
                  onClick={() => onMappingDecision?.(mapping.mappingId, "accepted")}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className={mapping.status === "rejected" ? "primary" : ""}
                  onClick={() => onMappingDecision?.(mapping.mappingId, "rejected")}
                >
                  Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ChartProposalCard({ proposal, genericImports, onChartProposalDecision }) {
  const preview = makeGenericChartPreview(proposal, genericImports);
  return (
    <article className="backend-proposal-card backend-chart-proposal-card">
      <div className="backend-scan-block-head">
        <strong>{proposal.title || proposal.proposalId}</strong>
        <span>{proposal.chartType} - {formatConfidence(proposal.confidence)}</span>
      </div>
      <div className="generic-chart-preview">
        <Plot
          traces={preview.traces}
          layout={preview.layout}
          config={{ staticPlot: true, displayModeBar: false }}
          className="generic-chart-preview-plot"
        />
      </div>
      <p className="backend-scan-muted">{proposal.rationale || proposal.reason}</p>
      <p className="backend-scan-muted">
        X: {proposal.x?.label || proposal.x?.field || "n/a"}{proposal.x?.unit ? ` (${proposal.x.unit})` : ""}
        {" - "}
        Y: {proposal.y?.label || proposal.y?.field || "n/a"}{proposal.y?.unit ? ` (${proposal.y.unit})` : ""}
      </p>
      <WarningList warnings={proposal.warnings} />
      <div className="import-review-actions">
        <button
          type="button"
          className={proposal.status === "accepted" ? "primary" : ""}
          onClick={() => onChartProposalDecision?.(proposal.proposalId, "accepted")}
        >
          Accept
        </button>
        <button
          type="button"
          className={proposal.status === "rejected" ? "primary" : ""}
          onClick={() => onChartProposalDecision?.(proposal.proposalId, "rejected")}
        >
          Reject
        </button>
      </div>
    </article>
  );
}

function ChartProposalReview({ genericImports, mappingState, chartProposalState, onProposeCharts, onChartProposalDecision }) {
  const state = chartProposalState || {};
  const proposalSet = state.result?.proposalSet || null;
  const proposals = proposalSet?.proposals || [];
  const mappingCount = mappingState?.result?.mappingSet?.mappings?.length || 0;
  const canPropose = genericImports.length > 0 && mappingCount > 0 && !state.loading;

  return (
    <section className="backend-proposal-section">
      <div className="backend-normalize-toolbar">
        <button
          type="button"
          className="primary"
          disabled={!canPropose}
          onClick={() => onProposeCharts?.()}
        >
          {state.loading ? "Proposing charts..." : "Propose charts"}
        </button>
        <span>{proposals.length} chart proposals</span>
      </div>
      {state.error && <p className="import-review-error">{state.error}</p>}
      {!proposalSet && !state.loading && <div className="import-review-empty">No chart proposals yet.</div>}
      {proposalSet && (
        <div className="backend-proposal-grid">
          <div className="backend-scan-stats">
            <span>{proposals.length} charts</span>
            <span>{proposals.filter((proposal) => proposal.status === "accepted").length} accepted</span>
            <span>{proposals.filter((proposal) => proposal.status === "rejected").length} rejected</span>
            <span>{proposalSet.warnings?.length || 0} warnings</span>
          </div>
          {proposals.map((proposal) => (
            <ChartProposalCard
              key={proposal.proposalId}
              proposal={proposal}
              genericImports={genericImports}
              onChartProposalDecision={onChartProposalDecision}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MetadataList({ metadata }) {
  const items = Array.isArray(metadata) ? metadata : [];
  if (!items.length) return <span className="backend-scan-muted">No metadata</span>;
  return (
    <ul className="backend-scan-list">
      {items.map((item, index) => (
        <li key={`${item.rawKey || "metadata"}-${index}`}>
          <strong>{item.rawKey || "Metadata"}</strong>
          <span>{item.rawValue ?? ""}{item.unit ? ` (${item.unit})` : ""}</span>
          <em>{sourceLabel(item.source)}</em>
        </li>
      ))}
    </ul>
  );
}

function HeaderList({ headers }) {
  const items = Array.isArray(headers) ? headers : [];
  if (!items.length) return <span className="backend-scan-muted">No headers</span>;
  return (
    <ul className="backend-scan-list">
      {items.map((header, index) => (
        <li key={`${header.range || "header"}-${index}`}>
          <strong>{header.range || `row ${header.row}`}</strong>
          <span>{(header.columns || []).map((column) => `${column.rawName || column.label || column.address}${column.unit ? ` [${column.unit}]` : ""}`).join(", ")}</span>
          <em>{formatConfidence(header.confidence)}</em>
        </li>
      ))}
    </ul>
  );
}

function BlockList({ blocks, blockReview, onBlockReviewDecision }) {
  const items = Array.isArray(blocks) ? blocks : [];
  if (!items.length) return <span className="backend-scan-muted">No blocks</span>;
  return (
    <div className="backend-scan-blocks">
      {items.map((block) => {
        const decision = blockReviewDecision(blockReview, block.blockId);
        return (
          <article className="backend-scan-block" key={block.blockId}>
            <div className="backend-scan-block-head">
              <strong>{block.blockId}</strong>
              <span>{block.type} - {formatConfidence(block.confidence)}</span>
            </div>
            <div className="backend-scan-review-actions" aria-label={`Review ${block.blockId}`}>
              <span>Review: {decision}</span>
              <button
                type="button"
                className={decision === "approved" ? "active" : ""}
                onClick={() => onBlockReviewDecision?.(block.blockId, "approved")}
              >
                Approve
              </button>
              <button
                type="button"
                className={decision === "ignored" ? "active" : ""}
                onClick={() => onBlockReviewDecision?.(block.blockId, "ignored")}
              >
                Ignore
              </button>
            </div>
            <div className="backend-scan-kv">
              <span>Range</span><strong>{block.range || sourceLabel(block.source)}</strong>
              <span>Rows</span><strong>{block.table?.rows?.length ?? 0}</strong>
              <span>Source</span><strong>{sourceLabel(block.source)}</strong>
            </div>
            {block.title && <p className="backend-scan-muted">Title: {block.title.value || block.title.rawValue} - {sourceLabel(block.title.source)}</p>}
            <div className="backend-scan-subgrid">
              <div><h5>Metadata</h5><MetadataList metadata={block.metadata || block.candidateMetadata} /></div>
              <div><h5>Warnings</h5><WarningList warnings={block.warnings} /></div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function SheetDetails({ sheet, blockReview, onBlockReviewDecision }) {
  return (
    <article className="backend-scan-sheet">
      <div className="backend-scan-sheet-head">
        <div>
          <strong>{sheet.name || sheet.sheetId}</strong>
          <span>{sheet.usedRange || "no used range"}</span>
        </div>
        <span>{sheet.layout?.type || "unknown"} - {formatConfidence(sheet.layout?.confidence)}</span>
      </div>
      <div className="backend-scan-stats">
        <span>{sheet.rowCount ?? sheet.cellGrid?.rowCount ?? 0} rows</span>
        <span>{sheet.columnCount ?? sheet.cellGrid?.columnCount ?? 0} columns</span>
        <span>{sheet.blocks?.length || 0} blocks</span>
        <span>{sheet.warnings?.length || 0} warnings</span>
      </div>
      <div className="backend-scan-subgrid">
        <div><h5>Headers</h5><HeaderList headers={sheet.candidateHeaders} /></div>
        <div><h5>Metadata</h5><MetadataList metadata={sheet.candidateMetadata} /></div>
      </div>
      <div className="backend-scan-subgrid">
        <div><h5>Blocks</h5><BlockList blocks={sheet.blocks} blockReview={blockReview} onBlockReviewDecision={onBlockReviewDecision} /></div>
        <div><h5>Warnings</h5><WarningList warnings={sheet.warnings} /></div>
      </div>
    </article>
  );
}

export function BackendScanPanel({
  scanState,
  blockReview,
  normalizeState,
  mappingState,
  chartProposalState,
  onScanFile,
  onBlockReviewDecision,
  onPreviewNormalize,
  onApplyNormalize,
  onProposeMappings,
  onMappingDecision,
  onProposeCharts,
  onChartProposalDecision,
}) {
  const state = scanState || {};
  const result = state.result || null;
  const sheetCount = result?.summary?.sheetCount ?? result?.sheets?.length ?? 0;
  const blockCount = result?.summary?.blockCount ?? result?.sheets?.reduce((total, sheet) => total + (sheet.blocks?.length || 0), 0) ?? 0;
  const approvedCount = blockReview?.approvedBlockIds?.length || 0;
  const genericImports = normalizeState?.result?.datasetPatch?.genericImports || [];

  return (
    <section className="import-review-section backend-scan-panel">
      <div className="import-review-section-head">
        <h3>Backend scan</h3>
        <span>{state.loading ? "scanning" : result ? "ready" : "idle"}</span>
      </div>
      <div className="backend-scan-toolbar">
        <label className={`folder-btn backend-scan-upload ${state.loading ? "disabled" : ""}`}>
          {state.loading ? "Scanning..." : "Scan workbook"}
          <input
            type="file"
            accept=".xlsx,.xls"
            disabled={state.loading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onScanFile?.(file);
              event.target.value = "";
            }}
          />
        </label>
        {state.fileName && <span className="backend-scan-file">{state.fileName}</span>}
      </div>
      {state.error && <p className="import-review-error">{state.error}</p>}
      {result ? (
        <div className="backend-scan-debug">
          <div className="backend-scan-stats">
            <span>{sheetCount} sheets</span>
            <span>{blockCount} blocks</span>
            <span>{warningCount(result)} warnings</span>
          </div>
          <div className="backend-scan-sheets">
            {(result.sheets || []).map((sheet) => (
              <SheetDetails
                key={sheet.sheetId || sheet.name}
                sheet={sheet}
                blockReview={blockReview}
                onBlockReviewDecision={onBlockReviewDecision}
              />
            ))}
          </div>
          <div className="backend-normalize-toolbar">
            <button
              type="button"
              className="primary"
              disabled={!approvedCount || normalizeState?.loading}
              onClick={() => onPreviewNormalize?.()}
            >
              {normalizeState?.loading ? "Previewing..." : "Preview normalized output"}
            </button>
            <span>{approvedCount} approved blocks</span>
          </div>
          <NormalizedPreview normalizeState={normalizeState} onApplyNormalize={onApplyNormalize} />
          <MappingProposalReview
            genericImports={genericImports}
            mappingState={mappingState}
            onProposeMappings={onProposeMappings}
            onMappingDecision={onMappingDecision}
          />
          <ChartProposalReview
            genericImports={genericImports}
            mappingState={mappingState}
            chartProposalState={chartProposalState}
            onProposeCharts={onProposeCharts}
            onChartProposalDecision={onChartProposalDecision}
          />
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      ) : (
        <div className="import-review-empty">No backend scan yet.</div>
      )}
    </section>
  );
}
