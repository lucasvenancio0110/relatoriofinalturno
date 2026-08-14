import test from "node:test";
import assert from "node:assert/strict";

import { cellForTnl } from "../src/js/utils.js";
import { hasConflict, kpis, progressForCell } from "../src/js/model.js";
import { parseReport } from "../src/js/parser.js";
import { fullReport, maintenanceLifecycleReport } from "./fixtures.js";

test("parser preserva todos os blocos operacionais e informações", () => {
  const { state, development, observations } = parseReport({ raw: fullReport, nextShift: 3 });

  assert.equal(state.records.filter((item) => item.type === "maintenance").length, 2);
  assert.equal(state.records.filter((item) => item.type === "maintenance_prod").length, 1);
  assert.equal(state.records.filter((item) => item.type === "setup_active").length, 2);
  assert.equal(state.records.filter((item) => item.type === "setup_start").length, 1);
  assert.equal(state.records.filter((item) => item.type === "adjustment").length, 1);
  assert.equal(state.futureItems.length, 2);
  assert.equal(state.devObsItems.length, 4);
  assert.equal(state.generalInfoItems.length, 2);
  assert.match(development, /TNL 006 - PROGRAMAÇÃO/);
  assert.match(observations, /\(514112\)/);
});

test("parser detecta conflito, TNL sem mapa e total correto da ronda", () => {
  const { state } = parseReport({ raw: fullReport, nextShift: 3 });
  assert.equal(hasConflict(state, 19), true);
  assert.deepEqual(kpis(state), { pending: 14, conflicts: 1, completed: 0 });
  assert.equal(progressForCell(state, "01").total, 5);
  assert.equal(progressForCell(state, "07").total, 3);
  assert.equal(progressForCell(state, "10").total, 1);
  assert.equal(progressForCell(state, "SEM_MAPA").total, 1);
});

test("mapeamento mantém TNL 006 e 144 na célula 10", () => {
  assert.equal(cellForTnl(6), "10");
  assert.equal(cellForTnl(144), "10");
  assert.equal(cellForTnl(999), "SEM_MAPA");
});

test("parser preserva o motivo importado de ajuste", () => {
  const { state } = parseReport({ raw: fullReport, nextShift: 3 });
  const adjustment = state.records.find((item) => item.type === "adjustment");
  assert.equal(adjustment.displayText, "TNL 043 - VARIAÇÃO DE MEDIDA");
  assert.equal(state.reasons.adjustment["43"], "VARIAÇÃO DE MEDIDA");
});

test("parser leva manutenções com check e bloco concluído para confirmação na ronda", () => {
  const { state } = parseReport({ raw: maintenanceLifecycleReport, nextShift: 3 });
  const concludedRecords = state.records.filter((item) => item.type === "maintenance_completed");

  assert.deepEqual(
    concludedRecords.map((item) => item.tnl).sort((a, b) => a - b),
    [19, 43, 143],
  );
  assert.equal(state.records.filter((item) => item.type === "maintenance").length, 1);
  assert.equal(state.records.filter((item) => item.type === "maintenance_prod").length, 1);
  assert.equal(Object.keys(state.maintenanceCases).length, 5);
  assert.equal(state.maintenanceCases["19"].reportedCompleted, true);
  assert.equal(state.maintenanceCases["43"].reportedCompleted, true);
  assert.equal(state.maintenanceCases["143"].reportedCompleted, true);
  assert.equal(state.completed.maintenances.length, 0);
  assert.equal(kpis(state).pending, 5);
  assert.equal(progressForCell(state, "01").pending, 3);
  assert.equal(progressForCell(state, "02").pending, 1);
  assert.equal(progressForCell(state, "03").pending, 1);
});
