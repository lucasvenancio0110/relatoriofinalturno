import test from "node:test";
import assert from "node:assert/strict";

import {
  ensureMaintenanceCase,
  maintenanceDecisionDetail,
  maintenanceReportBucket,
  minutesBetweenTimes,
  previousShift,
  updateMaintenanceCase,
  validateMaintenanceUpdate,
} from "../src/js/maintenance.js";
import { createEmptyState } from "../src/js/model.js";

test("turno anterior e duração atravessando meia-noite são calculados corretamente", () => {
  assert.equal(previousShift(1), 3);
  assert.equal(previousShift(2), 1);
  assert.equal(previousShift(3), 2);
  assert.equal(minutesBetweenTimes("22:30", "00:15"), 105);
  assert.equal(minutesBetweenTimes("18:20", "19:05"), 45);
});

test("validação exige os horários condicionais e o detalhe de acompanhamento", () => {
  const invalid = validateMaintenanceUpdate({
    tnl: 19,
    callOrigin: "current",
    serviceStatus: "completed",
    machineOutcome: "monitoring",
  });
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.errors, [
    "Informe o horário de abertura ou marque como não informado.",
    "Informe o código Tractian ou selecione uma das alternativas.",
    "Informe o horário de início da atuação ou marque como não informado.",
    "Informe o horário de término ou marque como não informado.",
    "Informe o que precisa ser acompanhado.",
  ]);

  const valid = validateMaintenanceUpdate({
    tnl: 19,
    callOrigin: "current",
    callOpenedAt: "16:10",
    tractianStatus: "none",
    serviceStatus: "completed",
    arrivedShift: 2,
    arrivedAt: "17:05",
    finishedShift: 2,
    finishedAt: "17:40",
    machineOutcome: "monitoring",
    monitoringDetails: "Medida após a troca do bedame",
  });
  assert.equal(valid.valid, true);
});

test("caso de manutenção mantém origem, horários, resultado e texto rastreável", () => {
  const state = createEmptyState();
  ensureMaintenanceCase(state, {
    tnl: 19,
    reason: "QUEBRA DE BEDAME",
    sourceSection: "maintenance",
    originalLine: "✅ TNL 019 - QUEBRA DE BEDAME",
    reportedCompleted: true,
  });
  const item = updateMaintenanceCase(
    state,
    19,
    {
      callOrigin: "current",
      callOpenedAt: "16:10",
      tractianCode: "6661",
      serviceStatus: "completed",
      arrivedShift: 2,
      arrivedAt: "17:05",
      finishedShift: 2,
      finishedAt: "17:40",
      machineOutcome: "monitoring",
      monitoringDetails: "Medida após a troca do bedame",
      details: "Bedame substituído",
    },
    new Date("2026-08-14T20:40:00.000Z"),
  );

  assert.equal(item.reportedCompleted, true);
  assert.equal(maintenanceReportBucket(item), "monitoring");
  assert.match(maintenanceDecisionDetail(item, 2), /Chamado aberto pelo 2º turno às 16:10/);
  assert.match(maintenanceDecisionDetail(item, 2), /Tractian #6661/);
  assert.match(maintenanceDecisionDetail(item, 2), /Início da atuação: 2º turno às 17:05/);
  assert.match(maintenanceDecisionDetail(item, 2), /Término da atuação: 2º turno às 17:40/);
  assert.match(maintenanceDecisionDetail(item, 2), /Como ficou: EM ACOMPANHAMENTO/);
  assert.match(maintenanceDecisionDetail(item, 2), /Acompanhar: Medida após a troca do bedame/);
});

test("atendimento em andamento não pode resultar em máquina liberada", () => {
  const result = validateMaintenanceUpdate({
    tnl: 48,
    callOrigin: "previous",
    tractianStatus: "not_found",
    serviceStatus: "working",
    arrivedUnknown: true,
    machineOutcome: "released",
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /acompanhamento ou parada/);
});

test("atualização posterior preserva a origem e o horário já registrados", () => {
  const state = createEmptyState();
  ensureMaintenanceCase(state, { tnl: 48, reason: "FALHA DE SENSOR" });
  updateMaintenanceCase(state, 48, {
    callOrigin: "current",
    callOpenedAt: "16:10",
    serviceStatus: "waiting",
    machineOutcome: "stopped",
  });
  const updated = updateMaintenanceCase(state, 48, {
    serviceStatus: "completed",
    arrivedAt: "17:05",
    finishedAt: "17:40",
    machineOutcome: "released",
  });

  assert.equal(updated.callOrigin, "current");
  assert.equal(updated.callOpenedAt, "16:10");
  assert.equal(updated.arrivedAt, "17:05");
  assert.equal(updated.finishedAt, "17:40");
  assert.equal(updated.machineOutcome, "released");
});

test("preventiva iniciada pela manutenção aceita Tractian e horários em turnos diferentes", () => {
  const result = validateMaintenanceUpdate({
    tnl: 88,
    initiationMode: "maintenance",
    tractianCode: "#6661",
    serviceStatus: "completed",
    arrivedShift: 1,
    arrivedAt: "13:40",
    finishedShift: 2,
    finishedAt: "17:20",
    machineOutcome: "released",
  });

  assert.equal(result.valid, true);
  assert.equal(result.value.tractianCode, "6661");
  const detail = maintenanceDecisionDetail({ ...result.value, reviewed: true }, 2);
  assert.match(detail, /Intervenção iniciada pela própria manutenção/);
  assert.match(detail, /Tractian #6661/);
  assert.match(detail, /Início da atuação: 1º turno às 13:40/);
  assert.match(detail, /Término da atuação: 2º turno às 17:20/);
  assert.match(detail, /Como ficou: LIBERADA/);
});
