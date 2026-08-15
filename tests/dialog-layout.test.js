import test from "node:test";
import assert from "node:assert/strict";

import { dialogViewportMetrics } from "../src/js/dialog-layout.js";

test("viewport normal não inventa recuo de teclado", () => {
  assert.deepEqual(
    dialogViewportMetrics({
      layoutHeight: 844,
      viewportHeight: 790,
      viewportOffsetTop: 10,
    }),
    {
      viewportHeight: 790,
      viewportOffsetTop: 10,
      keyboardInset: 0,
      keyboardOpen: false,
    },
  );
});

test("teclado móvel reduz a altura do popup e o mantém visível", () => {
  assert.deepEqual(
    dialogViewportMetrics({
      layoutHeight: 844,
      viewportHeight: 463,
      viewportOffsetTop: 0,
    }),
    {
      viewportHeight: 463,
      viewportOffsetTop: 0,
      keyboardInset: 381,
      keyboardOpen: true,
    },
  );
});

test("métricas inválidas recebem valores seguros", () => {
  assert.deepEqual(dialogViewportMetrics({ layoutHeight: 640, viewportHeight: NaN }), {
    viewportHeight: 640,
    viewportOffsetTop: 0,
    keyboardInset: 0,
    keyboardOpen: false,
  });
});
