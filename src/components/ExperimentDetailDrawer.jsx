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

function storedTypeLabel(value) {
  const normalized = String(value || "string").trim().toLowerCase();
  return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : "Unknown";
}

function sourceTypeLabel(source) {
  const value = source?.rawValue;
  if (value === null || value === undefined || value === "") return "Blank";
  if (typeof value === "number") return "Number";
  if (typeof value === "boolean") return "Boolean";
  return "String";
}

export function ExperimentDetailDrawer({ detail = null, loading = false, error = "", onClose, onOpenSourceRange }) {
  const record = detail?.record;
  const [inspectedField, setInspectedField] = React.useState(null);
  React.useEffect(() => setInspectedField(null), [detail?.experiment?.id, record?.experimentId]);
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
                    <button type="button" className="experiment-field-inspect" onClick={() => setInspectedField(field)}>
                      Inspect stored value
                    </button>
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
              {inspectedField && (
                <aside className="experiment-published-cell-inspector" aria-label="Published stored value details">
                  <header>
                    <div>
                      <strong>{inspectedField.displayName || inspectedField.fieldKey || "Field"}</strong>
                      <span>Active published snapshot</span>
                    </div>
                    <button type="button" aria-label="Close published stored value details" onClick={() => setInspectedField(null)}>x</button>
                  </header>
                  <dl>
                    <div><dt>Stored value</dt><dd>{fieldValue(inspectedField)}</dd></div>
                    <div><dt>Stored type</dt><dd>{storedTypeLabel(inspectedField.valueType)}</dd></div>
                    <div><dt>Unit</dt><dd>{inspectedField.unit || "None"}</dd></div>
                    <div><dt>Numeric scale</dt><dd>{inspectedField.numericScale || "Not applicable"}</dd></div>
                    <div><dt>Source value</dt><dd>{sourceRawValue(asArray(inspectedField.sourceRefs)[0])}</dd></div>
                    <div><dt>Source type</dt><dd>{sourceTypeLabel(asArray(inspectedField.sourceRefs)[0])}</dd></div>
                    <div><dt>Source</dt><dd>{sourceLabel(asArray(inspectedField.sourceRefs)[0])}</dd></div>
                  </dl>
                </aside>
              )}
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

            <section className="experiment-detail-section" aria-label="Linked workbook data">
              <div className="experiment-detail-section-head">
                <h3>Linked workbook data</h3>
                <span>{asArray(detail.linkedRegions).length}</span>
              </div>
              <div className="experiment-source-list">
                {asArray(detail.linkedRegions).map((linked) => (
                  <button
                    type="button"
                    className="experiment-source-button"
                    key={linked.regionId}
                    aria-label={`Open ${linked.dataKind} in ${linked.workbookName}`}
                    onClick={() => onOpenSourceRange?.({
                      sourceType: "excel_range",
                      sourceDocumentId: linked.sourceDocumentId,
                      sheet: linked.sheetName,
                      range: linked.range,
                      workbookReviewSessionId: linked.workbookReviewSessionId,
                      regionId: linked.regionId,
                    })}
                  >
                    <strong>{linked.dataKind}</strong>
                    <span>{linked.workbookName} · {linked.sheetName}!{linked.range}{linked.templateVersion ? ` · template v${linked.templateVersion}` : ""}</span>
                    {!!asArray(linked.seriesLabels).length && <small>{linked.seriesLabels.join(", ")}</small>}
                  </button>
                ))}
                {!asArray(detail.linkedRegions).length && <p className="browser-muted">No linked workbooks. Confirm a region linked to this experiment to see it here.</p>}
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
