import test from "node:test";
import assert from "node:assert/strict";

import { updateMaintenanceCase } from "../src/js/maintenance.js";
import { addCompleted, removeCategory, removeRecordsOfTnl } from "../src/js/model.js";
import { parseReport } from "../src/js/parser.js";
import { generateReport } from "../src/js/report.js";
import { defaultFields, fullReport, maintenanceLifecycleReport } from "./fixtures.js";

test("relatório final mantém todas as seções do modelo WhatsApp", () => {
  const { state } = parseReport({ raw: fullReport, nextShift: 3 });
  const report = generateReport(state, defaultFields);
  [
    "*2° TURNO*",
    "*MÁQUINAS EM MANUTENÇÃO PARADA:*",
    "*MÁQUINAS EM MANUTENÇÃO PRODUZINDO:*",
    "*SETUP:*",
    "*MAQUINAS EM AJUSTES:*",
    "*SETUPS 3°T:*",
    "*DESENVOLVIMENTO:*",
    "*OBSERVAÇÕES:*",
    "*RESTANTE OK !*",
  ].forEach((section) => assert.ok(report.includes(section), `Seção ausente: ${section}`));
  assert.match(report, /TNL 043 - VARIAÇÃO DE MEDIDA/);
  assert.match(report, /DESENVOLVIMENTO GERAL SEM MÁQUINA/);
  assert.match(report, /TNL 056 - SEM ORDEM/);
});

test("conclusão migra a TNL para o bloco concluído", () => {
  const { state } = parseReport({ raw: fullReport, nextShift: 3 });
  removeCategory(state, 19, "maintenance");
  addCompleted(state, 19, "maintenance");
  const report = generateReport(state, defaultFields);
  assert.match(report, /\*MANUTENÇÕES CONCLUÍDAS:\*\nTNL's - 019\./);
  assert.doesNotMatch(
    report.split("*MÁQUINAS EM MANUTENÇÃO PARADA:*")[1].split("*MÁQUINAS EM MANUTENÇÃO PRODUZINDO:*")[0],
    /TNL 019/,
  );
});

test("check informado pelo preparador continua visível até a confirmação", () => {
  const { state } = parseReport({ raw: maintenanceLifecycleReport, nextShift: 3 });
  const report = generateReport(state, defaultFields);
  assert.match(report, /✅ TNL 019 - QUEBRA DE BEDAME/);
  assert.match(report, /Conclusão informada pelo preparador; falta confirmar o atendimento/);
  assert.match(report, /✅ TNL 043 - MANUTENÇÃO/);
  assert.match(report, /✅ TNL 143 - MANUTENÇÃO/);
});

test("relatório separa manutenção parada, acompanhamento e conclusão com horários", () => {
  const { state } = parseReport({ raw: maintenanceLifecycleReport, nextShift: 3 });

  updateMaintenanceCase(state, 48, {
    callOrigin: "previous",
    serviceStatus: "waiting",
    machineOutcome: "stopped",
  });
  updateMaintenanceCase(state, 25, {
    callOrigin: "current",
    callOpenedAt: "16:10",
    serviceStatus: "completed",
    arrivedAt: "17:05",
    finishedAt: "17:40",
    machineOutcome: "monitoring",
    monitoringDetails: "Acompanhar medida",
  });
  removeRecordsOfTnl(state, 25);
  addCompleted(state, 25, "maintenance");
  updateMaintenanceCase(state, 19, {
    callOrigin: "previous",
    serviceStatus: "completed",
    arrivedAt: "15:10",
    finishedAt: "15:45",
    machineOutcome: "released",
  });
  removeRecordsOfTnl(state, 19);
  addCompleted(state, 19, "maintenance");

  const report = generateReport(state, defaultFields);
  const stoppedBlock = report
    .split("*MÁQUINAS EM MANUTENÇÃO PARADA:*")[1]
    .split("*MÁQUINAS EM MANUTENÇÃO PRODUZINDO:*")[0];
  const monitoringBlock = report
    .split("*MÁQUINAS EM ACOMPANHAMENTO:*")[1]
    .split("*SETUP:*")[0];
  const completedBlock = report
    .split("*MANUTENÇÕES CONCLUÍDAS:*")[1]
    .split("*DESENVOLVIMENTO:*")[0];

  assert.match(stoppedBlock, /TNL 048 - FALHA DE SENSOR/);
  assert.match(stoppedBlock, /Chamado aberto pelo 1º turno/);
  assert.match(stoppedBlock, /Manutenção ainda não chegou/);
  assert.match(stoppedBlock, /Situação: CONTINUA PARADA/);
  assert.match(monitoringBlock, /TNL 025 - AGUARDANDO TÉCNICO/);
  assert.match(monitoringBlock, /Chamado aberto pelo 2º turno às 16:10/);
  assert.match(monitoringBlock, /Acompanhar: Acompanhar medida/);
  assert.match(completedBlock, /✅ TNL 019 - QUEBRA DE BEDAME/);
  assert.match(completedBlock, /Manutenção atuou de 15:10 até 15:45/);
  assert.match(completedBlock, /Situação: LIBERADA/);
});

test("relatório gerado pode ser importado no turno seguinte sem perder a linha do tempo", () => {
  const { state } = parseReport({ raw: maintenanceLifecycleReport, currentShift: 2, nextShift: 3 });
  updateMaintenanceCase(state, 25, {
    callOrigin: "current",
    callOpenedShift: 2,
    callOpenedAt: "16:10",
    serviceStatus: "completed",
    arrivedAt: "17:05",
    finishedAt: "17:40",
    machineOutcome: "monitoring",
    monitoringDetails: "Acompanhar medida após correção",
    details: "Sensor substituído",
  });
  removeRecordsOfTnl(state, 25);
  updateMaintenanceCase(state, 19, {
    callOrigin: "previous",
    callOpenedShift: 1,
    serviceStatus: "completed",
    arrivedAt: "15:10",
    finishedAt: "15:45",
    machineOutcome: "released",
  });
  removeRecordsOfTnl(state, 19);
  addCompleted(state, 19, "maintenance");

  const copiedReport = generateReport(state, defaultFields);
  const imported = parseReport({ raw: copiedReport, currentShift: 3, nextShift: 1 }).state;
  const monitoring = imported.maintenanceCases["25"];
  const released = imported.maintenanceCases["19"];

  assert.equal(monitoring.callOrigin, "previous");
  assert.equal(monitoring.callOpenedShift, 2);
  assert.equal(monitoring.callOpenedAt, "16:10");
  assert.equal(monitoring.arrivedAt, "17:05");
  assert.equal(monitoring.finishedAt, "17:40");
  assert.equal(monitoring.machineOutcome, "monitoring");
  assert.equal(monitoring.monitoringDetails, "Acompanhar medida após correção");
  assert.equal(monitoring.details, "Sensor substituído");
  assert.equal(released.machineOutcome, "released");
  assert.equal(released.callOpenedShift, 1);
  assert.equal(imported.reviewLines.length, 0);
  assert.ok(imported.roundLedger.some((item) => item.tnl === 25 && item.status === "pending"));
  assert.ok(imported.roundLedger.some((item) => item.tnl === 19 && item.status === "pending"));
});
