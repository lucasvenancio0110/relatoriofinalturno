import { animate } from "motion/mini";

import { dialogViewportMetrics } from "./dialog-layout.js";

const activeAnimations = new WeakMap();
const closingDialogs = new WeakMap();
let initialized = false;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isMobileSheet() {
  return window.matchMedia("(max-width: 680px)").matches;
}

function stopActiveAnimation(dialog) {
  activeAnimations.get(dialog)?.stop?.();
  activeAnimations.delete(dialog);
}

function resetAnimatedCard(dialog) {
  const card = dialog.querySelector(".modal-card");
  if (!card) return;
  card.style.removeProperty("opacity");
  card.style.removeProperty("transform");
}

function syncVisualViewport() {
  const viewport = window.visualViewport;
  const metrics = dialogViewportMetrics({
    layoutHeight: window.innerHeight,
    viewportHeight: viewport?.height ?? window.innerHeight,
    viewportOffsetTop: viewport?.offsetTop ?? 0,
  });
  const root = document.documentElement;
  root.style.setProperty("--dialog-viewport-height", `${metrics.viewportHeight}px`);
  root.style.setProperty("--dialog-viewport-top", `${metrics.viewportOffsetTop}px`);
  root.style.setProperty("--dialog-keyboard-inset", `${metrics.keyboardInset}px`);
  root.toggleAttribute("data-dialog-keyboard", metrics.keyboardOpen);
}

function animateDialogOpen(dialog) {
  const card = dialog.querySelector(".modal-card");
  if (!card) return;
  stopActiveAnimation(dialog);
  const reduced = prefersReducedMotion();
  const mobile = isMobileSheet();
  const controls = animate(
    card,
    reduced
      ? { opacity: [0.72, 1] }
      : {
          opacity: [0.68, 1],
          transform: [
            `translateY(${mobile ? 26 : 12}px) scale(${mobile ? 0.992 : 0.985})`,
            "translateY(0) scale(1)",
          ],
        },
    { duration: reduced ? 0.12 : 0.24, ease: [0.22, 1, 0.36, 1] },
  );
  activeAnimations.set(dialog, controls);
  controls.then(() => activeAnimations.delete(dialog));
}

export function openResponsiveDialog(dialog) {
  if (!(dialog instanceof HTMLDialogElement)) {
    throw new TypeError("O popup precisa ser um elemento <dialog>.");
  }
  syncVisualViewport();
  stopActiveAnimation(dialog);
  resetAnimatedCard(dialog);
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => animateDialogOpen(dialog));
  return dialog;
}

export function closeResponsiveDialog(dialog, returnValue = "") {
  if (!dialog?.open) return Promise.resolve();
  if (closingDialogs.has(dialog)) return closingDialogs.get(dialog);

  const task = (async () => {
    const card = dialog.querySelector(".modal-card");
    dialog.dataset.closing = "true";
    try {
      stopActiveAnimation(dialog);
      if (card) {
        const reduced = prefersReducedMotion();
        const mobile = isMobileSheet();
        const controls = animate(
          card,
          reduced
            ? { opacity: [1, 0.7] }
            : {
                opacity: [1, 0.68],
                transform: [
                  "translateY(0) scale(1)",
                  `translateY(${mobile ? 18 : 8}px) scale(${mobile ? 0.995 : 0.99})`,
                ],
              },
          { duration: reduced ? 0.08 : 0.16, ease: "ease-in" },
        );
        activeAnimations.set(dialog, controls);
        await controls;
      }
      if (dialog.open) dialog.close(returnValue);
    } finally {
      resetAnimatedCard(dialog);
      delete dialog.dataset.closing;
      activeAnimations.delete(dialog);
      closingDialogs.delete(dialog);
    }
  })();

  closingDialogs.set(dialog, task);
  return task;
}

function enhanceDialog(dialog) {
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    void closeResponsiveDialog(dialog, "cancel");
  });
  dialog.addEventListener("click", (event) => {
    const cancel = event.target.closest('button[value="cancel"]');
    if (!cancel || !dialog.contains(cancel)) return;
    event.preventDefault();
    void closeResponsiveDialog(dialog, cancel.value);
  });
  dialog.addEventListener("close", () => {
    stopActiveAnimation(dialog);
    resetAnimatedCard(dialog);
    delete dialog.dataset.closing;
    closingDialogs.delete(dialog);
    syncVisualViewport();
  });
}

export function initResponsiveDialogs() {
  if (initialized) return;
  initialized = true;
  document.querySelectorAll("dialog.modal").forEach(enhanceDialog);
  syncVisualViewport();
  window.addEventListener("resize", syncVisualViewport, { passive: true });
  window.addEventListener("orientationchange", syncVisualViewport, { passive: true });
  window.visualViewport?.addEventListener("resize", syncVisualViewport, { passive: true });
  window.visualViewport?.addEventListener("scroll", syncVisualViewport, { passive: true });
}
