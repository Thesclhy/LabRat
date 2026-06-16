import React, { useMemo, useState } from "react";
import { buildAcceptedMappingColumns, buildGenericBrowserRows, getGenericExperimentDetail } from "../data/experimentBrowserRows.js";

function formatConfidence(value) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "n/a";
}

function formatValue(item) {
  const value = item?.value ?? item?.rawValue;
  if (value == null || value === "") return "-";
  return item.unit ? `${value} ${item.unit}` : String(value);
}

function sourceLabel(source) {
  if (!source) return "source n/a";
  return [source.fileName, source.sheet, source.range || source.cell].filter(Boolean).join(" - ") || "source n/a";
}

function WarningList({ warnings }) {
  const items = Array.isArray(warnings) ? warnings : [];
  if (!items.length) return <span className="backend-scan-muted">No warnings</span>;
  return (
    <ul className="generic-detail-list">
      {items.map((warning, index) => (
        <li key={`${warning.code || "warning"}-${index}`}>
          <strong>{warning.code || "warning"}</strong>
          <span>{warning.message || ""}</span>
        </li>
      ))}
    </ul>
  );
}

function FieldList({ fields, emptyLabel = "No fields" }) {
  const items = Array.isArray(fields) ? fields : [];
  if (!items.length) return <span className="backend-scan-muted">{emptyLabel}</span>;
  return (
    <div className="generic-field-list">
      {items.map((item) => (
        <div key={item.fieldValueId || item.metadataId || item.measurementId || `${item.displayName}-${item.sourceRef}`} className="generic-field-row">
          <span>{item.displayName || item.field}</span>
          <strong>{formatValue(item)}</strong>
          <small>{formatConfidence(item.confidence)}</small>
        </div>
      ))}
    </div>
  );
}

function MappingValueCell({ cell }) {
  const value = cell?.value;
  if (value == null || value === "") return <span className="backend-scan-muted">-</span>;
  return <span>{value}</span>;
}

function GenericDetailModal({ dataset, row, onClose }) {
  const detail = getGenericExperimentDetail(dataset, row);
  if (!detail) return null;
  const { experiment, fields, measurements, metadata, sources, warnings, mappedFields, genericImport } = detail;
  const materials = fields.filter((field) => field.role === "material");
  const conditions = fields.filter((field) => field.role === "condition");
  const contextMetadata = fields.filter((field) => field.role === "metadata" || field.role === "note");
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-head">
          <span>{experiment.name || row.label} - Imported record</span>
          <button type="button" aria-label="Close imported record" onClick={onClose}>x</button>
        </div>
        <div className="modal-body">
          <div className="detail-title">
            <div>
              <h2>{experiment.name || row.label} <span>{genericImport.fileName || "imported file"}</span></h2>
              <p>{row.sourceRange || "source range n/a"} - {row.mappingStatus}</p>
            </div>
          </div>
          <div className="stats generic-detail-stats">
            <div className="stat"><span>Fields</span><span className="stat-value">{row.fieldCount ?? fields.length}</span><small>source-backed</small></div>
            <div className="stat"><span>Materials</span><span className="stat-value">{materials.length}</span><small>sample context</small></div>
            <div className="stat"><span>Conditions</span><span className="stat-value">{conditions.length}</span><small>run setup</small></div>
            <div className="stat"><span>Measurements</span><span className="stat-value">{measurements.length}</span><small>results</small></div>
            <div className="stat"><span>Warnings</span><span className="stat-value">{warnings.length}</span><small>{warnings.length ? "review" : "clear"}</small></div>
            <div className="stat"><span>Confidence</span><span className="stat-value">{formatConfidence(row.confidence)}</span><small>parser signal</small></div>
          </div>
          <div className="detail-grid generic-detail-grid">
            <section className="card">
              <h3>Mapped fields</h3>
              <div className="generic-field-list">
                {mappedFields.length ? mappedFields.map((field) => (
                  <div key={`${field.key}-${field.mappingId}`} className="generic-field-row">
                    <span>{field.label}</span>
                    <strong>{field.value || "-"}</strong>
                    <small>{field.status}</small>
                  </div>
                )) : <span className="backend-scan-muted">No accepted mappings yet.</span>}
              </div>
            </section>
            <section className="card">
              <h3>Materials</h3>
              <FieldList fields={materials} emptyLabel="No material fields" />
            </section>
            <section className="card">
              <h3>Conditions</h3>
              <FieldList fields={conditions} emptyLabel="No condition fields" />
            </section>
            <section className="card">
              <h3>Metadata</h3>
              <FieldList fields={contextMetadata.length ? contextMetadata : metadata.filter((item) => !["material", "condition"].includes(item.role))} emptyLabel="No metadata" />
            </section>
            <section className="card full">
              <h3>Measurements</h3>
              <div className="generic-measurement-table">
                <table>
                  <thead>
                    <tr><th>Field</th><th>Value</th><th>Row</th><th>Source</th><th>Confidence</th></tr>
                  </thead>
                  <tbody>
                    {measurements.map((measurement) => {
                      const source = sources.find((item) => item.sourceRef === measurement.sourceRef);
                      return (
                        <tr key={measurement.measurementId}>
                          <td>{measurement.displayName || measurement.field}</td>
                          <td>{formatValue(measurement)}</td>
                          <td>{measurement.rowIndex ?? "-"}</td>
                          <td>{sourceLabel(source)}</td>
                          <td>{formatConfidence(measurement.confidence)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="card">
              <h3>Warnings</h3>
              <WarningList warnings={warnings} />
            </section>
            <section className="card">
              <h3>Sources</h3>
              <div className="sources">
                {sources.map((source) => (
                  <div key={source.sourceRef} className="source-row">
                    <span>{source.sourceRef}</span>
                    <span>{sourceLabel(source)}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GenericImportBrowser({ dataset, sourceName, onOpenImportReview, viewSwitch = null }) {
  const [search, setSearch] = useState("");
  const [selectedRow, setSelectedRow] = useState(null);
  const rows = useMemo(() => buildGenericBrowserRows(dataset), [dataset]);
  const acceptedMappingColumns = useMemo(() => buildAcceptedMappingColumns(dataset?.genericMappingSets), [dataset?.genericMappingSets]);
  const query = search.toLowerCase().trim();
  const filteredRows = useMemo(() => {
    if (!query) return rows;
    return rows.filter((row) => [
      row.label,
      row.sourceFile,
      row.sourceRange,
      row.mappingStatus,
      ...acceptedMappingColumns.map((column) => {
        const cell = row.acceptedMappingValues?.[column.key];
        return `${column.label} ${cell?.value || ""}`;
      }),
    ].join(" ").toLowerCase().includes(query));
  }, [acceptedMappingColumns, query, rows]);
  const columnCount = 2 + acceptedMappingColumns.length;

  return (
    <>
      <aside className="sidebar">
        {viewSwitch}
        <section className="filter">
          <h4>Imported data</h4>
          <p className="generic-browser-note">{rows.length} generic records</p>
        </section>
        <section className="filter">
          <h4>Search</h4>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Imported label, source, accepted mapping..." />
        </section>
      </aside>
      <main className="main">
        <div className="page-head">
          <div>
            <h1>Imported experiments</h1>
            <p>{filteredRows.length} of {rows.length} imported records - source: {sourceName} - click a row for source-backed detail.</p>
          </div>
          <button type="button" className="compact-action primary" onClick={onOpenImportReview}>Import workbook</button>
        </div>
        {!rows.length ? (
          <div className="card generic-empty-state">
            <h3>No imported generic data</h3>
            <p>Apply normalized workbook data from Import review to populate this view.</p>
          </div>
        ) : (
          <div className="card table-wrap generic-browser-table">
            {!acceptedMappingColumns.length && (
              <div className="generic-browser-mapping-guidance">
                Accept semantic mappings in Import Review to turn reviewed fields into Experiment Browser columns.
              </div>
            )}
            <table>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Source</th>
                  {acceptedMappingColumns.map((column) => (
                    <th key={column.key} title={column.rawLabel || column.label}>
                      <span>{column.label}</span>
                      {column.unit && <small> {column.unit}</small>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.rowId} onClick={() => setSelectedRow(row)}>
                    <td><strong>{row.label}</strong></td>
                    <td><span>{row.sourceFile || "-"}</span><br /><small>{row.sourceRange || "range n/a"}</small></td>
                    {acceptedMappingColumns.map((column) => (
                      <td key={column.key} className="generic-mapped-cell">
                        <MappingValueCell cell={row.acceptedMappingValues?.[column.key]} />
                      </td>
                    ))}
                  </tr>
                ))}
                {!filteredRows.length && (
                  <tr className="table-empty-row">
                    <td colSpan={columnCount}>No imported records match the current search.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
      {selectedRow && <GenericDetailModal dataset={dataset} row={selectedRow} onClose={() => setSelectedRow(null)} />}
    </>
  );
}
