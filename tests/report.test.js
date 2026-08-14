import test from "node:test";
import assert from "node:assert/strict";

import { addCompleted, removeCategory } from "../src/js/model.js";
import { parseReport } from "../src/js/parser.js";
import { generateReport } from "../src/js/report.js";
import { defaultFields, fullReport } from "./fixtures.js";

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
