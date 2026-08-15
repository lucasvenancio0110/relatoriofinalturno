import test from "node:test";
import assert from "node:assert/strict";

import { categoriesOfTnl } from "../src/js/model.js";
import { parseReport } from "../src/js/parser.js";
import {
  SETUP_BEFORE_MAINTENANCE,
  applySetupBeforeMaintenance,
} from "../src/js/transitions.js";
import { fullReport } from "./fixtures.js";

test("setup concluído antes da manutenção permanece no histórico", () => {
  const { state } = parseReport({ raw: fullReport, nextShift: 3 });
  const transition = applySetupBeforeMaintenance(
    state,
    19,
    SETUP_BEFORE_MAINTENANCE.completed,
  );

  assert.equal(transition.resumeAfterMaintenance, false);
  assert.equal(state.completed.setups.includes(19), true);
  assert.deepEqual(categoriesOfTnl(state, 19), ["maintenance"]);
});

test("setup interrompido é retirado do conflito e marcado para retomada", () => {
  const { state } = parseReport({ raw: fullReport, nextShift: 3 });
  const transition = applySetupBeforeMaintenance(
    state,
    19,
    SETUP_BEFORE_MAINTENANCE.resume,
  );

  assert.equal(transition.resumeAfterMaintenance, true);
  assert.equal(transition.setupMode, "active");
  assert.equal(state.completed.setups.includes(19), false);
  assert.deepEqual(categoriesOfTnl(state, 19), ["maintenance"]);
});

test("transição de setup inválida é bloqueada", () => {
  const { state } = parseReport({ raw: fullReport, nextShift: 3 });
  assert.throws(
    () => applySetupBeforeMaintenance(state, 19, "apagado"),
    /Destino do setup inválido/,
  );
});
