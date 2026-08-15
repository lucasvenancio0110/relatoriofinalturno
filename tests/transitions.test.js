import test from "node:test";
import assert from "node:assert/strict";

import { categoriesOfTnl } from "../src/js/model.js";
import { parseReport } from "../src/js/parser.js";
import {
  MACHINE_NEXT_STEPS,
  ROUTED_SETUP_MODES,
  applyMachineRoute,
  buildMachineRoute,
} from "../src/js/transitions.js";
import { fullReport } from "./fixtures.js";

test("rota manutenção conclui o setup anterior sem apagar a manutenção", () => {
  const { state } = parseReport({ raw: fullReport, nextShift: 3 });
  const route = buildMachineRoute(state, 19, {
    nextStep: MACHINE_NEXT_STEPS.maintenance,
  });

  assert.equal(route.setupWasPresent, true);
  const applied = applyMachineRoute(state, 19, route);

  assert.equal(applied.action, "SETUP CONCLUÍDO → VAI PASSAR EM MANUTENÇÃO");
  assert.equal(state.completed.setups.includes(19), true);
  assert.deepEqual(categoriesOfTnl(state, 19), ["maintenance"]);
});

test("rota setup preserva a manutenção e registra iniciar setup", () => {
  const { state } = parseReport({ raw: fullReport, nextShift: 3 });
  const route = buildMachineRoute(state, 48, {
    nextStep: MACHINE_NEXT_STEPS.setup,
    setupMode: ROUTED_SETUP_MODES.start,
  });
  const applied = applyMachineRoute(state, 48, route);

  assert.equal(applied.action, "INICIAR SETUP");
  assert.deepEqual(categoriesOfTnl(state, 48).sort(), ["maintenance", "setup"]);
  assert.equal(
    state.records.some((item) => item.tnl === 48 && item.type === "setup_start"),
    true,
  );
});

test("rota setup exige informar como o setup vai começar", () => {
  const { state } = parseReport({ raw: fullReport, nextShift: 3 });
  assert.throws(
    () =>
      buildMachineRoute(state, 48, {
        nextStep: MACHINE_NEXT_STEPS.setup,
      }),
    /Situação do setup inválida/,
  );
});
