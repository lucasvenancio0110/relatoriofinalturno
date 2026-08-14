import test from "node:test";
import assert from "node:assert/strict";

import {
  addCompleted,
  categoriesOfTnl,
  commitDecision,
  kpis,
  progressForCell,
  removeRecordsOfTnl,
  reopenDecision,
  snapshotSubject,
  undoLastAction,
} from "../src/js/model.js";
import { parseReport } from "../src/js/parser.js";
import { fullReport } from "./fixtures.js";

test("progresso mantém denominador após liberar uma máquina", () => {
  const { state } = parseReport({ raw: fullReport, nextShift: 3 });
  const before = snapshotSubject(state, "A:19");
  categoriesOfTnl(state, 19).forEach((category) => addCompleted(state, 19, category));
  removeRecordsOfTnl(state, 19);
  commitDecision(state, { subjectKey: "A:19", tnl: 19, kind: "machine", action: "LIBERADA", before });

  assert.deepEqual(progressForCell(state, "01"), {
    total: 5,
    decided: 1,
    pending: 4,
    percent: 20,
  });
  assert.deepEqual(kpis(state), { pending: 13, conflicts: 0, completed: 1 });
});

test("desfazer restaura registros, conflito e progresso", () => {
  const { state } = parseReport({ raw: fullReport, nextShift: 3 });
  const before = snapshotSubject(state, "A:19");
  removeRecordsOfTnl(state, 19);
  commitDecision(state, { subjectKey: "A:19", tnl: 19, kind: "machine", action: "LIBERADA", before });
  assert.equal(undoLastAction(state), true);
  assert.equal(state.records.filter((item) => item.tnl === 19).length, 2);
  assert.equal(kpis(state).conflicts, 1);
  assert.equal(progressForCell(state, "01").decided, 0);
});

test("reeditar decisão restaura o snapshot original", () => {
  const { state } = parseReport({ raw: fullReport, nextShift: 3 });
  const before = snapshotSubject(state, "A:19");
  removeRecordsOfTnl(state, 19);
  commitDecision(state, { subjectKey: "A:19", tnl: 19, kind: "machine", action: "LIBERADA", before });
  assert.equal(reopenDecision(state, "A:19"), true);
  assert.equal(state.confirmedDecisions["A:19"], undefined);
  assert.equal(state.records.filter((item) => item.tnl === 19).length, 2);
  assert.equal(progressForCell(state, "01").pending, 5);
});
