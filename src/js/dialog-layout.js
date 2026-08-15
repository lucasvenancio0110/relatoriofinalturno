export const KEYBOARD_INSET_THRESHOLD = 120;

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function dialogViewportMetrics({
  layoutHeight,
  viewportHeight,
  viewportOffsetTop = 0,
  keyboardThreshold = KEYBOARD_INSET_THRESHOLD,
} = {}) {
  const safeLayoutHeight = Math.max(1, finiteNumber(layoutHeight, 1));
  const safeViewportHeight = Math.max(
    1,
    Math.min(safeLayoutHeight, finiteNumber(viewportHeight, safeLayoutHeight)),
  );
  const safeOffsetTop = Math.max(0, finiteNumber(viewportOffsetTop));
  const coveredHeight = Math.max(
    0,
    safeLayoutHeight - safeViewportHeight - safeOffsetTop,
  );
  const keyboardOpen = coveredHeight >= keyboardThreshold;

  return {
    viewportHeight: Math.round(safeViewportHeight),
    viewportOffsetTop: Math.round(safeOffsetTop),
    keyboardInset: keyboardOpen ? Math.round(coveredHeight) : 0,
    keyboardOpen,
  };
}
