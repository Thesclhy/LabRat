import { ANALYSIS_RUNTIME_VERSION } from "./analysisSchemas.js";

const source = String.raw`def analyze(inputs, labrat):
    placeholders = {"-", "--", "—", "n/a", "na"}
    columns = []
    mappings = []

    def normalized_text(value):
        return "" if value is None else str(value).strip()

    def converted_value(raw, displayed, value_type):
        raw_text = normalized_text(raw)
        display_text = normalized_text(displayed)
        if raw is None or (not raw_text and not display_text):
            return None, None, "source_blank"
        if raw_text.lower() in placeholders or display_text.lower() in placeholders:
            return None, None, "source_placeholder"
        if value_type == "number":
            if isinstance(raw, bool):
                raise ValueError("A boolean source value cannot be imported as a number.")
            if isinstance(raw, (int, float)):
                value = float(raw) if isinstance(raw, float) else raw
            else:
                value = float(raw_text.replace(",", "").removesuffix("%").strip())
            return value, display_text or str(value), None
        if value_type == "boolean":
            if isinstance(raw, bool):
                return raw, display_text or ("true" if raw else "false"), None
            lowered = raw_text.lower()
            if lowered not in {"true", "false", "yes", "no", "1", "0"}:
                raise ValueError("A source value could not be imported as a boolean.")
            value = lowered in {"true", "yes", "1"}
            return value, display_text or ("true" if value else "false"), None
        value = display_text or raw_text
        return value, value, None

    for table in inputs.get("tables", []):
        structure = table.get("structure") or {}
        if structure.get("experimentAxis") != "rows":
            raise ValueError("Direct source mapping requires a confirmed one-experiment-per-row region.")
        id_letter = normalized_text(structure.get("experimentIdColumn")).upper()
        id_column = None
        table_mappings = []
        for source_column in table.get("columns", []):
            if normalized_text(source_column.get("excelColumn")).upper() == id_letter:
                id_column = source_column.get("columnIndex")
        for source_mapping in structure.get("fieldMappings", []):
            output_index = len(columns)
            value_type = normalized_text(source_mapping.get("valueType")).lower() or "string"
            if value_type not in {"number", "string", "date", "boolean"}:
                raise ValueError("An accepted source column has an unsupported value type.")
            columns.append({
                "displayName": normalized_text(source_mapping.get("displayName")) or "Column " + str(output_index + 1),
                "valueType": value_type,
                "unit": source_mapping.get("unit"),
                "numericScale": source_mapping.get("numericScale"),
            })
            table_mappings.append((source_mapping.get("sourceColumnIndex"), output_index, value_type))
        if id_column is None:
            raise ValueError("The confirmed experiment identifier column is outside the selected source range.")
        mappings.append((table, id_column, table_mappings))

    patches_by_label = {}
    exclusions = []
    for table, id_column, table_mappings in mappings:
        structure = table.get("structure") or {}
        inclusion = structure.get("inclusion") or {}
        first_row = int(inclusion.get("startRow") or ((structure.get("headerRow") or table.get("startRow")) + 1))
        last_row = int(inclusion.get("endRow") or (table.get("startRow") + table.get("rowCount") - 1))
        skipped = {int(item.get("rowNumber")) for item in inclusion.get("skippedRows", []) if item.get("rowNumber") is not None}
        values = table.get("values", [])
        displayed = table.get("displayValues", [])
        for row_offset, row in enumerate(values):
            absolute_row = int(table.get("startRow")) + row_offset
            if absolute_row < first_row or absolute_row > last_row or absolute_row in skipped:
                continue
            label = normalized_text(row[id_column] if id_column < len(row) else None)
            if not label:
                exclusions.append({"label": "Row " + str(absolute_row), "reason": "The confirmed experiment identifier cell is blank."})
                continue
            key = label.casefold()
            patch = patches_by_label.get(key)
            if patch is None:
                patch = {"label": label, "values": [], "upsertSeries": [], "removeSeries": [], "warnings": []}
                patches_by_label[key] = patch
            for source_index, output_index, value_type in table_mappings:
                raw = row[source_index] if source_index < len(row) else None
                shown_row = displayed[row_offset] if row_offset < len(displayed) else []
                shown = shown_row[source_index] if source_index < len(shown_row) else raw
                value, formatted, missing_reason = converted_value(raw, shown, value_type)
                item = {
                    "columnIndex": output_index,
                    "value": value,
                    "formattedValue": formatted,
                    "confidence": 1,
                    "warnings": [],
                    "sources": [{"tableId": table.get("tableId"), "rowOffset": row_offset, "columnOffset": source_index}],
                }
                if missing_reason is not None:
                    item["missingReason"] = missing_reason
                patch["values"].append(item)

    return {"columns": columns, "recordPatches": list(patches_by_label.values()), "exclusions": exclusions}
`;

export function deterministicExperimentBrowserProgram() {
  return {
    runtime: ANALYSIS_RUNTIME_VERSION,
    entrypoint: "analyze",
    source,
    modelMetadata: {
      provider: "deterministic_source_mapping",
      model: null,
      latencyMs: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
    },
  };
}
