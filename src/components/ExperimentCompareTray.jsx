import React, { useMemo } from "react";

function uniqueIds(ids) {
  return [...new Set(ids.filter(Boolean))];
}

function scalarColumnKey(field) {
  return [field.fieldKey, field.unit || "", field.valueType || ""].join("::");
}

function labelWithUnit(label, unit) {
  if (!unit) return label;
  const normalizedLabel = String(label).toLowerCase();
  const normalizedUnit = String(unit).toLowerCase();
  return normalizedLabel.includes(`(${normalizedUnit})`) ? label : `${label} (${unit})`;
}

function displayFieldValue(field) {
  if (!field) return "-";
  const value = field.formattedValue ?? field.value;
  if (value === null || value === undefined || value === "") return "-";
  return field.unit ? `${value} ${field.unit}` : String(value);
}

function sourceLabel(sourceRef) {
  return [sourceRef.sheet, sourceRef.range].filter(Boolean).join(" ") || "Source evidence";
}

export function ExperimentCompareTray({
  selectedExperimentIds = [],
  summaries = [],
  details = [],
  expanded = false,
  loading = false,
  error = "",
  onRemove,
  onClear,
  onOpen,
  onClose,
  onSourceClick,
}) {
  const ids = useMemo(() => uniqueIds(selectedExperimentIds), [selectedExperimentIds]);
  const summariesById = useMemo(
    () => new Map(summaries.map((summary) => [summary.experimentId, summary])),
    [summaries],
  );
  const detailsById = useMemo(
    () => new Map(details.map((detail) => [detail?.experiment?.id, detail])),
    [details],
  );
  const scalarColumns = useMemo(() => {
    const byKey = new Map();
    details.forEach((detail) => {
      (detail?.record?.fields || []).forEach((field) => {
        const key = scalarColumnKey(field);
        if (!byKey.has(key)) {
          byKey.set(key, { key, label: labelWithUnit(field.displayName || field.fieldKey, field.unit) });
        }
      });
    });
    return [...byKey.values()];
  }, [details]);

  if (ids.length === 0) return null;

  return (
    <section className={`experiment-compare-tray${expanded ? " is-expanded" : ""}`} aria-label="Experiment comparison">
      <header className="experiment-compare-tray__summary">
        <strong>{ids.length} selected</strong>
        <div className="experiment-compare-tray__chips">
          {ids.map((id) => {
            const summary = summariesById.get(id);
            const label = summary?.label || summary?.canonicalLabel || id;
            return (
              <span className="experiment-compare-chip" key={id}>
                <span>{label}</span>
                <button
                  type="button"
                  aria-label={`Remove ${label} from comparison`}
                  title="Remove"
                  onClick={() => onRemove?.(id)}
                >
                  &times;
                </button>
              </span>
            );
          })}
        </div>
        <div className="experiment-compare-tray__actions">
          <button type="button" className="text-action" aria-label="Clear comparison" onClick={onClear}>
            Clear
          </button>
          {expanded ? (
            <button type="button" className="primary-action" onClick={onClose}>Close comparison</button>
          ) : (
            <button type="button" className="primary-action" onClick={onOpen}>Compare selected experiments</button>
          )}
        </div>
      </header>

      {expanded ? (
        <div className="experiment-compare-tray__panel">
          {loading ? <p className="experiment-browser-state">Loading experiment details...</p> : null}
          {error ? <p className="experiment-browser-state is-error" role="alert">{error}</p> : null}
          {!loading && !error ? (
            <div className="experiment-compare-table-wrap">
              <table className="experiment-compare-table">
                <thead>
                  <tr>
                    <th scope="col">Experiment</th>
                    {scalarColumns.map((column) => <th scope="col" key={column.key}>{column.label}</th>)}
                    <th scope="col">Series</th>
                    <th scope="col">Sources</th>
                  </tr>
                </thead>
                <tbody>
                  {ids.map((id) => {
                    const detail = detailsById.get(id);
                    const label = detail?.experiment?.canonicalLabel
                      || summariesById.get(id)?.label
                      || id;
                    const fieldsByKey = new Map((detail?.record?.fields || []).map((field) => [scalarColumnKey(field), field]));
                    return (
                      <tr key={id}>
                        <th scope="row">{label}</th>
                        {scalarColumns.map((column) => (
                          <td key={column.key}>{displayFieldValue(fieldsByKey.get(column.key))}</td>
                        ))}
                        <td>
                          {(detail?.record?.series || []).length ? (
                            <ul className="experiment-compare-inventory">
                              {detail.record.series.map((series) => (
                                <li key={series.seriesKey || series.label}>
                                  <strong>{series.label || series.seriesKey}</strong>
                                  <span>{series.points?.length || 0} points</span>
                                </li>
                              ))}
                            </ul>
                          ) : "-"}
                        </td>
                        <td>
                          {(detail?.record?.sourceRefs || []).length ? (
                            <ul className="experiment-compare-sources">
                              {detail.record.sourceRefs.map((sourceRef, index) => (
                                <li key={`${sourceRef.sourceDocumentId || "source"}-${sourceRef.sheet || ""}-${sourceRef.range || index}`}>
                                  <button type="button" onClick={() => onSourceClick?.(sourceRef)}>
                                    {sourceLabel(sourceRef)}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
