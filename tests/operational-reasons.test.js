import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createEmptyState, addRecord } from "../src/js/model.js";
import {
  existingAdjustmentReason,
  existingMaintenanceReason,
  meaningfulOperationalReason,
  adjustmentReasonWithoutPreparer,
} from "../src/js/operational-reasons.js";
import { ensureMaintenanceCase } from "../src/js/maintenance.js";

// Regression guard: ajuste e manutenção nunca podem seguir sem motivo operacional real.
const appSource = readFileSync(new URL("../src/js/app.js", import.meta.url), "utf8");

function record(state, tnl, type, reason) {
  addRecord(state, {
    id: state.nextId++,
    tnl,
    type,
    displayText: `TNL ${String(tnl).padStart(3, "0")} - ${reason}`,
    rawText: `TNL ${String(tnl).padStart(3, "0")} - ${reason}`,
    sourceSection: type,
    emoji: "🔴",
  });
}

test("setup com motivo antigo de ajuste não reaproveita motivo invisível", () => {
  const state = createEmptyState();
  state.reasons.adjustment["60"] = "Ferramenta quebrando";
  record(state, 60, "setup_active", "EM SETUP");
  assert.equal(existingAdjustmentReason(state, 60), "");
});

test("ajuste atual reutiliza motivo real e rejeita rótulo genérico", () => {
  const state = createEmptyState();
  record(state, 60, "adjustment", "Correção de medida no diâmetro");
  assert.equal(existingAdjustmentReason(state, 60), "Correção de medida no diâmetro");
  const generic = createEmptyState();
  record(generic, 61, "adjustment", "EM AJUSTE");
  assert.equal(existingAdjustmentReason(generic, 61), "");
});

test("setup com caso antigo de manutenção exige novo motivo", () => {
  const state = createEmptyState();
  record(state, 60, "setup_active", "EM SETUP");
  state.reasons.maintenance["60"] = ["Sensor sem leitura"];
  ensureMaintenanceCase(state, { tnl: 60, reason: "Sensor sem leitura", sourceSection: "decision" });
  assert.equal(existingMaintenanceReason(state, 60), "");
});

test("manutenção atual reutiliza motivo real", () => {
  const state = createEmptyState();
  record(state, 60, "maintenance", "Curto no empurrador de barras");
  assert.equal(existingMaintenanceReason(state, 60), "Curto no empurrador de barras");
});

test("caso de manutenção sem registro preserva motivo importado", () => {
  const state = createEmptyState();
  ensureMaintenanceCase(state, { tnl: 124, reason: "Eixo H1 com batimento", sourceSection: "maintenance_tracking" });
  assert.equal(existingMaintenanceReason(state, 124), "Eixo H1 com batimento");
});

test("rótulos genéricos não contam como motivo operacional", () => {
  assert.equal(meaningfulOperationalReason("MANUTENÇÃO", "maintenance"), "");
  assert.equal(meaningfulOperationalReason("EM AJUSTE", "adjustment"), "");
  assert.equal(meaningfulOperationalReason("Vazamento atrás do empurrador", "maintenance"), "Vazamento atrás do empurrador");
});

test("ronda conecta a regra de motivo a todas as transições críticas", () => {
  assert.doesNotMatch(appSource, /const savedReason = existingAdjustmentReason\(state, tnl\)/);
  assert.match(appSource, /Toda decisão de passar em AJUSTE pergunta o motivo novamente/);
  assert.match(appSource, /const existing = category === "maintenance" \? existingMaintenanceReason\(state, tnl\) : ""/);
  assert.match(appSource, /const initial = providedReason \|\| existingMaintenanceReason\(state, tnl\)/);
  assert.match(appSource, /const initialReason = existingMaintenanceReason\(state, tnl\)/);
  assert.match(appSource, /category === "adjustment" && answer === "no"/);
  assert.match(appSource, /keepsCategory && \["adjustment", "maintenance"\]\.includes\(category\)/);
});


test("fluxo mantém perguntas explícitas de motivo", () => {
  assert.match(appSource, /Motivo do ajuste — TNL/);
  assert.match(appSource, /Escreva o motivo do ajuste para o relatório/);
  assert.match(appSource, /Motivo da manutenção — TNL/);
  assert.match(appSource, /Escreva o motivo da manutenção para o relatório/);
});


test("nome do preparador não conta como motivo de ajuste", () => {
  [
    "Márcio",
    "Wendel",
    "Luciano",
    "Nattan",
    "Clayton",
    "Christoffer",
    "Marlon",
    "Everson",
    "Ewerson",
    "Adriano",
    "Gabriel",
    "Willians",
    "Alan",
    "Lucas V",
    "Preparador João",
  ].forEach((name) => assert.equal(meaningfulOperationalReason(name, "adjustment"), ""));
});

test("nome do preparador é removido quando existe motivo técnico junto", () => {
  assert.equal(adjustmentReasonWithoutPreparer("Márcio - Correção de medida"), "Correção de medida");
  assert.equal(adjustmentReasonWithoutPreparer("Ferramenta quebrando - Wendel"), "Ferramenta quebrando");
  assert.equal(meaningfulOperationalReason("Luciano / Ajuste no diâmetro", "adjustment"), "Ajuste no diâmetro");
});

test("registro de ajuste contendo somente preparador obriga novo motivo", () => {
  const state = createEmptyState();
  record(state, 60, "adjustment", "Márcio");
  assert.equal(existingAdjustmentReason(state, 60), "");
});


test("ajuste sempre pergunta motivo e manutenção só pergunta quando não existe motivo", () => {
  const chooseStart = appSource.indexOf("async function chooseAdjustment(");
  const chooseEnd = appSource.indexOf("function createMaintenanceDecision", chooseStart);
  const chooseBlock = appSource.slice(chooseStart, chooseEnd);
  assert.match(chooseBlock, /const reason = await askText\(/);
  assert.doesNotMatch(chooseBlock, /existingAdjustmentReason\(state, tnl\)/);

  const ensureStart = appSource.indexOf("async function ensureExistingCategoryReason");
  const ensureEnd = appSource.indexOf("async function applyTransition", ensureStart);
  const ensureBlock = appSource.slice(ensureStart, ensureEnd);
  assert.match(ensureBlock, /category === "maintenance" \? existingMaintenanceReason\(state, tnl\) : ""/);
  assert.match(ensureBlock, /category === "maintenance" && existing/);
});
