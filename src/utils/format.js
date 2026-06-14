export function fmt(v, d = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (typeof v !== "number") return String(v);
  if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.001 && v !== 0)) return v.toExponential(2);
  return v.toFixed(d);
}

export function expNo(label) {
  return Number(String(label || "").replace(/^Exp/, "")) || 0;
}

export function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export function num(v) {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
