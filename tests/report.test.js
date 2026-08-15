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
    "*DETALHAMENTO DAS MANUTENÇÕES:*",
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
  assert.ok(
    report.indexOf("*DESENVOLVIMENTO:*") <
      report.indexOf("*DETALHAMENTO DAS MANUTENÇÕES:*") &&
      report.indexOf("*DETALHAMENTO DAS MANUTENÇÕES:*") <
        report.indexOf("*OBSERVAÇÕES:*"),
  );
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
  assert.match(report, /Conclusão informada pelo preparador; falta registrar os horários e o chamado/);
  assert.match(report, /✅ TNL 043 - MANUTENÇÃO/);
  assert.match(report, /✅ TNL 143 - MANUTENÇÃO/);
});

test("relatório mantém listas compactas e separa o detalhamento por máquina", () => {
  const { state } = parseReport({ raw: maintenanceLifecycleReport, nextShift: 3 });

  updateMaintenanceCase(state, 48, {
    callOrigin: "previous",
    serviceStatus: "waiting",
    machineOutcome: "stopped",
  });
  updateMaintenanceCase(state, 25, {
    callOrigin: "current",
    callOpenedAt: "16:10",
    tractianCode: "6661",
    serviceStatus: "completed",
    arrivedShift: 2,
    arrivedAt: "17:05",
    finishedShift: 2,
    finishedAt: "17:40",
    machineOutcome: "monitoring",
    monitoringDetails: "Acompanhar medida",
  });
  removeRecordsOfTnl(state, 25);
  addCompleted(state, 25, "maintenance");
  updateMaintenanceCase(state, 19, {
    callOrigin: "previous",
    serviceStatus: "completed",
    arrivedShift: 1,
    arrivedAt: "15:10",
    finishedShift: 1,
    finishedAt: "15:45",
    machineOutcome: "released",
  });
  removeRecordsOfTnl(state, 19);
  addCompleted(state, 19, "maintenance");

  const report = generateReport(state, defaultFields);
  const stoppedBlock = report
    .split("*MÁQUINAS EM MANUTENÇÃO PARADA:*")[1]
    .split("*MÁQUINAS EM MANUTENÇÃO PRODUZINDO:*")[0];
  const completedBlock = report
    .split("*MANUTENÇÕES CONCLUÍDAS:*")[1]
    .split("*DESENVOLVIMENTO:*")[0];
  const trackingBlock = report
    .split("*DETALHAMENTO DAS MANUTENÇÕES:*")[1]
    .split("*OBSERVAÇÕES:*")[0];

  assert.match(stoppedBlock, /TNL 048 - FALHA DE SENSOR/);
  assert.doesNotMatch(stoppedBlock, /Chamado aberto|Como ficou/);
  assert.doesNotMatch(report, /\*MÁQUINAS EM ACOMPANHAMENTO:\*/);
  assert.match(completedBlock, /✅ TNL 019 - QUEBRA DE BEDAME/);
  assert.doesNotMatch(completedBlock, /Manutenção atuou|Como ficou/);

  assert.match(trackingBlock, /\*TNL 019 - QUEBRA DE BEDAME\*/);
  assert.match(trackingBlock, /Início da atuação: 1º turno às 15:10/);
  assert.match(trackingBlock, /Liberação da manutenção: 1º turno às 15:45/);
  assert.match(trackingBlock, /Como ficou: LIBERADA/);
  assert.match(trackingBlock, /\n\n\*TNL 025 - AGUARDANDO TÉCNICO\*/);
  assert.match(trackingBlock, /Chamado aberto pelo 2º turno às 16:10/);
  assert.match(trackingBlock, /Chamado Tractian: #6661/);
  assert.match(trackingBlock, /Como ficou: EM ACOMPANHAMENTO/);
  assert.match(trackingBlock, /Acompanhar: Acompanhar medida/);
  assert.match(trackingBlock, /\*TNL 048 - FALHA DE SENSOR\*/);
  assert.match(trackingBlock, /Máquina já estava parada desde o 1º turno/);
  assert.match(trackingBlock, /Manutenção ainda não chegou/);
  assert.match(trackingBlock, /Como ficou: CONTINUA PARADA/);
  assert.doesNotMatch(
    trackingBlock,
    /[📞🛠️🎫🔧🕒🏁📍👁️📝]|[├└]─/u,
  );
});

test("relatório gerado pode ser importado no turno seguinte sem perder a linha do tempo", () => {
  const { state } = parseReport({ raw: maintenanceLifecycleReport, currentShift: 2, nextShift: 3 });
  updateMaintenanceCase(state, 25, {
    callOrigin: "current",
    callOpenedShift: 2,
    callOpenedAt: "16:10",
    tractianCode: "6661",
    serviceStatus: "completed",
    arrivedShift: 2,
    arrivedAt: "17:05",
    finishedShift: 2,
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
    arrivedShift: 1,
    arrivedAt: "15:10",
    finishedShift: 1,
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
  assert.equal(monitoring.tractianCode, "6661");
  assert.equal(monitoring.arrivedShift, 2);
  assert.equal(monitoring.arrivedAt, "17:05");
  assert.equal(monitoring.finishedShift, 2);
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

test("intervenção direta da manutenção e Tractian sobrevivem ao copiar e reimportar", () => {
  const { state } = parseReport({ raw: maintenanceLifecycleReport, currentShift: 2, nextShift: 3 });
  updateMaintenanceCase(state, 48, {
    initiationMode: "maintenance",
    callOrigin: "",
    tractianCode: "6661",
    serviceStatus: "completed",
    arrivedShift: 1,
    arrivedAt: "13:40",
    finishedShift: 2,
    finishedAt: "17:20",
    machineOutcome: "released",
  });
  removeRecordsOfTnl(state, 48);
  addCompleted(state, 48, "maintenance");

  const copied = generateReport(state, defaultFields);
  assert.match(copied, /Intervenção iniciada pela própria manutenção/);
  assert.match(copied, /Chamado Tractian: #6661/);
  assert.match(copied, /Início da atuação: 1º turno às 13:40/);
  assert.match(copied, /Liberação da manutenção: 2º turno às 17:20/);

  const imported = parseReport({ raw: copied, currentShift: 3, nextShift: 1 }).state;
  const item = imported.maintenanceCases["48"];
  assert.equal(item.initiationMode, "maintenance");
  assert.equal(item.tractianCode, "6661");
  assert.equal(item.arrivedShift, 1);
  assert.equal(item.arrivedAt, "13:40");
  assert.equal(item.finishedShift, 2);
  assert.equal(item.finishedAt, "17:20");
  assert.equal(item.machineOutcome, "released");
});

test("marcação de início do turno sobrevive ao copiar e reimportar", () => {
  const { state } = parseReport({ raw: maintenanceLifecycleReport, currentShift: 2, nextShift: 3 });
  updateMaintenanceCase(state, 48, {
    tractianStatus: "none",
    serviceStatus: "working",
    arrivedShift: 2,
    arrivedAtShiftStart: true,
    machineOutcome: "stopped",
  });

  const copied = generateReport(state, defaultFields);
  assert.match(copied, /já estava em manutenção no início do 2º turno/);

  const imported = parseReport({ raw: copied, currentShift: 3, nextShift: 1 }).state;
  const item = imported.maintenanceCases["48"];
  assert.equal(item.arrivedAtShiftStart, true);
  assert.equal(item.arrivedShift, 2);
  assert.equal(item.serviceStatus, "working");
});
