import React, { useEffect, useRef } from "react";

let plotlyLoader = null;

function loadPlotly() {
  plotlyLoader ||= import("plotly.js-dist-min").then((mod) => mod.default || mod);
  return plotlyLoader;
}

export function Plot({ traces = [], layout, config, className = "" }) {
  const ref = useRef(null);
  const pending = useRef(Promise.resolve());
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let active = true;
    let Plotly = null;
    let ready = false;

    pending.current = pending.current
      .then(async () => {
        Plotly = await loadPlotly();
        if (!active) return;
        if (!traces.length) {
          Plotly.purge(node);
          return;
        }
        await Plotly.react(node, traces, layout, {
          responsive: true,
          displaylogo: false,
          modeBarButtonsToRemove: ["sendDataToCloud"],
          ...config,
        });
        if (!active) return;
        ready = true;
        await Plotly.Plots?.resize(node);
      })
      .catch((err) => { if (active) console.error("Failed to render Plotly", err); });

    const observer = new ResizeObserver(() => {
      if (Plotly && active && ready) {
        Promise.resolve(Plotly.Plots?.resize(node)).catch((err) => {
          if (active) console.error("Failed to resize Plotly", err);
        });
      }
    });
    observer.observe(node);

    return () => {
      active = false;
      ready = false;
      observer.disconnect();
      // Never purge a node while its asynchronous render is still using its emitter.
      pending.current = pending.current.then(() => { if (Plotly) Plotly.purge(node); });
    };
  }, [traces, layout, config]);
  return traces.length
    ? <div className={`plot ${className}`} ref={ref} />
    : <div className={`plot plot-empty ${className}`} ref={ref}>No plottable data for this chart.</div>;
}
