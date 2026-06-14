import React, { useEffect, useRef } from "react";

let plotlyLoader = null;

function loadPlotly() {
  plotlyLoader ||= import("plotly.js-dist-min").then((mod) => mod.default || mod);
  return plotlyLoader;
}

export function Plot({ traces = [], layout, config, className = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let active = true;
    let Plotly = null;

    loadPlotly()
      .then((loaded) => {
        Plotly = loaded;
        if (!active) {
          Plotly.purge(node);
          return;
        }
        if (!traces.length) {
          Plotly.purge(node);
          return;
        }
        Plotly.react(node, traces, layout, {
          responsive: true,
          displaylogo: false,
          modeBarButtonsToRemove: ["sendDataToCloud"],
          ...config,
        }).then(() => Plotly.Plots?.resize(node));
      })
      .catch((err) => console.error("Failed to load Plotly", err));

    const observer = new ResizeObserver(() => {
      if (Plotly && active) Plotly.Plots?.resize(node);
    });
    observer.observe(node);

    return () => {
      active = false;
      observer.disconnect();
      if (Plotly) Plotly.purge(node);
    };
  }, [traces, layout, config]);
  return traces.length
    ? <div className={`plot ${className}`} ref={ref} />
    : <div className={`plot plot-empty ${className}`}>No plottable data for this chart.</div>;
}
