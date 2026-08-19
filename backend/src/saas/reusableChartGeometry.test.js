import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RESOLVED_CHART_GEOMETRY_SCHEMA_VERSION,
  allocateSelectionOrderStyles,
  resolveReusableChartGeometry,
} from "./reusableChartGeometry.js";

function template(comparisonMode = "grouped", geometryPolicy = {}) {
  return { encoding: { comparisonMode, chartType: "bar" }, geometryPolicy };
}

test("selection-order styles remain deterministic and enforce palette overflow", () => {
  const definition = {
    palette: {
      colors: ["#112233", "#445566"],
      assignment: "selection_order",
      overflow: "marker_and_dash",
    },
  };
  const first = allocateSelectionOrderStyles({ styleVersion: definition, itemCount: 4 });
  const replay = allocateSelectionOrderStyles({ styleVersion: definition, itemCount: 4 });
  assert.deepEqual(replay, first);
  assert.deepEqual(first.map((item) => item.color), ["#112233", "#445566", "#112233", "#445566"]);
  assert.notEqual(first[0].markerSymbol, first[2].markerSymbol);

  assert.throws(
    () => allocateSelectionOrderStyles({
      styleVersion: { ...definition, palette: { ...definition.palette, overflow: "block" } },
      itemCount: 3,
    }),
    (error) => error.code === "chart_template_palette_exhausted",
  );
});

test("geometry preserves preferred plot area for two and three experiments", () => {
  const common = {
    templateVersion: template(),
    comparisonMode: "grouped",
    chartType: "bar",
    title: "Yield comparison",
    legendLabels: ["Yield", "Conversion"],
    showLegend: true,
  };
  const two = resolveReusableChartGeometry({ ...common, experimentLabels: ["Exp1", "Exp2"] });
  const three = resolveReusableChartGeometry({ ...common, experimentLabels: ["Exp1", "Exp2", "Exp3"] });
  assert.deepEqual(three.resolvedGeometry.marginsPx, two.resolvedGeometry.marginsPx);
  assert.equal(two.resolvedGeometry.plotArea.widthRatio >= two.resolvedGeometry.plotArea.preferredWidthRatio, true);
  assert.equal(three.resolvedGeometry.plotArea.heightRatio >= three.resolvedGeometry.plotArea.preferredHeightRatio, true);
});

test("long labels rotate and grow bounded margins while legend positions fall back", () => {
  const value = resolveReusableChartGeometry({
    styleVersion: {
      figure: { preferredWidthPx: 600, preferredHeightPx: 700 },
      geometry: {
        preferredPlotAreaWidthRatio: 0.7,
        preferredPlotAreaHeightRatio: 0.58,
        minimumPlotAreaWidthRatio: 0.55,
        minimumPlotAreaHeightRatio: 0.5,
        preferredMarginsPx: { top: 60, right: 35, bottom: 75, left: 85 },
        maximumMarginsPx: { top: 100, right: 180, bottom: 180, left: 140 },
      },
      legend: { preferredPosition: "right", fallbackPositions: ["bottom"], allowWrapping: true },
    },
    templateVersion: template("grouped", { longLabelThreshold: 8 }),
    comparisonMode: "grouped",
    chartType: "bar",
    title: "A deliberately long chart title that needs a predictable wrapping decision",
    experimentLabels: ["A very long experiment label", "Another very long experiment label"],
    legendLabels: ["An exceptionally long first measurement name", "An exceptionally long second measurement name"],
    showLegend: true,
  });
  assert.equal(value.resolvedGeometry.labels.xTickAngle, -35);
  assert.equal(value.resolvedGeometry.marginsPx.bottom > 75, true);
  assert.equal(value.resolvedGeometry.legend.position, "bottom");
  assert.equal(value.resolvedGeometry.plotArea.widthRatio >= value.resolvedGeometry.plotArea.minimumWidthRatio, true);
});

test("geometry blocks output below the accepted minimum plot area", () => {
  assert.throws(
    () => resolveReusableChartGeometry({
      styleVersion: {
        figure: { preferredWidthPx: 400, preferredHeightPx: 300 },
        geometry: {
          preferredPlotAreaWidthRatio: 0.95,
          preferredPlotAreaHeightRatio: 0.95,
          minimumPlotAreaWidthRatio: 0.9,
          minimumPlotAreaHeightRatio: 0.9,
          preferredMarginsPx: { top: 50, right: 50, bottom: 50, left: 50 },
          maximumMarginsPx: { top: 50, right: 50, bottom: 50, left: 50 },
        },
      },
      templateVersion: template(),
      comparisonMode: "grouped",
      chartType: "bar",
      title: "Unreadable",
      experimentLabels: ["Exp1", "Exp2"],
    }),
    (error) => error.code === "chart_template_geometry_unreadable",
  );
});

test("facets use a bounded grid, grow panels, and share axes", () => {
  const value = resolveReusableChartGeometry({
    templateVersion: template("faceted", {
      facet: { maxColumns: 3, panelWidthPx: 400, panelHeightPx: 300, allowFigureGrowth: true, sharedAxes: true },
    }),
    comparisonMode: "faceted",
    chartType: "bar",
    title: "Faceted yield",
    experimentLabels: ["Exp1", "Exp2", "Exp3", "Exp4", "Exp5", "Exp6"],
  });
  assert.equal(value.resolvedGeometry.schemaVersion, RESOLVED_CHART_GEOMETRY_SCHEMA_VERSION);
  assert.deepEqual(
    { rows: value.resolvedGeometry.facets.rows, columns: value.resolvedGeometry.facets.columns },
    { rows: 2, columns: 3 },
  );
  assert.equal(value.resolvedGeometry.figure.widthPx >= 3 * 400, true);
  assert.equal(value.resolvedGeometry.figure.heightPx >= 2 * 300, true);
  assert.equal(value.facetRefs.length, 6);
  assert.equal(value.layout.yaxis2.matches, "y");
});
