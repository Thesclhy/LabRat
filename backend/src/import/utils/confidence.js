export function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Number(Math.min(0.99, Math.max(0, number)).toFixed(2));
}

export function confidenceResult(confidence, reasons = []) {
  return {
    confidence: clampConfidence(confidence),
    reasons: (Array.isArray(reasons) ? reasons : [reasons]).filter(Boolean),
  };
}

export function confidenceFromSignals(signals = []) {
  const score = signals.reduce((total, signal) => total + (signal.active ? Number(signal.weight) || 0 : 0), 0);
  const reasons = signals.filter((signal) => signal.active && signal.reason).map((signal) => signal.reason);
  return confidenceResult(score, reasons);
}
