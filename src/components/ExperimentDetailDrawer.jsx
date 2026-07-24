import React from "react";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function confidenceLabel(value) {
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 100)}%` : "n/a";
}

function fieldValue(field) {
  if (field?.formattedValue != null && field.formattedValue !== "") {
    return `${field.formattedValue}${field.unit ? ` ${field.unit}` : ""}`;
  }
  if (field?.value != null && field.value !== "") return `${field.value}${field.unit ? ` ${field.unit}` : ""}`;
  return "-";
}

function sourceLabel(source) {
  if (source?.fileName) {
    return [source.fileName, source?.sheet, source?.range || source?.cell].filter(Boolean).join(" · ");
  }
  return [source?.sheet, source?.range || source?.cell].filter(Boolean).join(" ") || "Source range";
}

function missingReasonLabel(reason) {
  if (reason === "source_blank") return "Source cell is blank";
  if (reason === "source_placeholder") return "Source contains a missing-value placeholder";
  if (reason === "calculation_unavailable") return "Required calculation input is unavailable";
  return "Missing in source";
}

function sourceRawValue(source) {
  if (source?.rawValue === null || source?.rawValue === undefined || source.rawValue === "") {
    return "blank";
  }
  return String(source.rawValue);
}

export function ExperimentDetailDrawer({ detail = null, loading = false, error = "", onClose, onOpenSourceRange }) {
  const record = detail?.record;
  const title = detail?.experiment?.canonicalLabel || record?.label || "Experiment detail";
  return (
    <aside className="experiment-detail-drawer" aria-label="Experiment detail">
      <header className="experiment-detail-head">
        <div>
          <span className="experiment-detail-kicker">Active snapshot</span>
          <h2>{title}</h2>
        </div>
        <button type="button" className="icon-button" aria-label="Close experiment detail" title="Close" onClick={onClose}>x</button>
      </header>
      <div className="experiment-detail-body">
        {loading && <p className="browser-status">Loading experiment detail...</p>}
        {!loading && error && <p className="browser-error" role="alert">{error}</p>}
        {!loading && !error && record && (
          <>
            <section className="experiment-detail-section">
              <div className="experiment-detail-section-head">
                <h3>Scalar fields</h3>
                <span>{asArray(record.fields).length}</span>
              </div>
              <div className="experiment-detail-fields">
                {asArray(record.fields).map((field, index) => (
                  <div className="experiment-detail-field" key={`${field.fieldKey || "field"}-${field.unit || "unitless"}-${index}`}>
                    <span>{field.displayName || field.fieldKey || "Field"}</span>
                    <strong>{fieldValue(field)}</strong>
                    <small>{field.role || "field"} | {confidenceLabel(field.confidence)} confidence</small>
                    {field.value == null && field.missingReason && (
                      <div className="experiment-missing-detail">
                        <strong>Missing in source</strong>
                        <span>{missingReasonLabel(field.missingReason)}</span>
                        {asArray(field.sourceRefs).map((source, sourceIndex) => (
                          <button
                            type="button"
                            className="experiment-source-button"
                            key={`${source.sourceDocumentId || "source"}-${source.sheet || "sheet"}-${source.cell || sourceIndex}`}
                            aria-label={`Open ${sourceLabel(source)}`}
                            onClick={() => onOpenSourceRange?.(source)}
                          >
                            <strong>{sourceLabel(source)}</strong>
                            <span>Original value: {sourceRawValue(source)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {!asArray(record.fields).length && <p className="browser-muted">No scalar fields.</p>}
              </div>
            </section>

            <section className="experiment-detail-section">
              <div className="experiment-detail-section-head">
                <h3>Series</h3>
                <span>{asArray(record.series).length}</span>
              </div>
              <div className="experiment-series-list">
                {asArray(record.series).map((series, index) => (
                  <div className="experiment-series-item" key={`${series.seriesKey || "series"}-${index}`}>
                    <strong>{series.label || series.seriesKey || "Series"}</strong>
                    <span>{asArray(series.points).length} points</span>
                    <small>{[series.xField, series.xUnit, series.yField, series.yUnit].filter(Boolean).join(" | ") || "Units not specified"}</small>
                  </div>
                ))}
                {!asArray(record.series).length && <p className="browser-muted">No series data.</p>}
              </div>
            </section>

            <section className="experiment-detail-section">
              <div className="experiment-detail-section-head">
                <h3>Warnings</h3>
                <span>{asArray(record.warnings).length}</span>
              </div>
              {asArray(record.warnings).length ? (
                <ul className="experiment-warning-list">
                  {asArray(record.warnings).map((warning, index) => (
                    <li key={`${warning.code || "warning"}-${index}`}>{warning.message || warning.code || "Review warning"}</li>
                  ))}
                </ul>
              ) : <p className="browser-muted">No record warnings.</p>}
            </section>

            <section className="experiment-detail-section">
              <div className="experiment-detail-section-head">
                <h3>Source ranges</h3>
                <span>{asArray(record.sourceRefs).length}</span>
              </div>
              <div className="experiment-source-list">
                {asArray(record.sourceRefs).map((source, index) => (
                  <button
                    type="button"
                    className="experiment-source-button"
                    key={`${source.sourceDocumentId || "source"}-${source.sheet || "sheet"}-${source.range || source.cell || index}`}
                    aria-label={`Open ${sourceLabel(source)}`}
                    onClick={() => onOpenSourceRange?.(source)}
                  >
                    <strong>{sourceLabel(source)}</strong>
                    <span>{source.sourceDocumentId || "source document"}</span>
                  </button>
                ))}
                {!asArray(record.sourceRefs).length && <p className="browser-muted">No source ranges.</p>}
              </div>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
