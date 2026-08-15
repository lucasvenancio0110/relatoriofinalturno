import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyState, addRecord } from "../src/js/model.js";
import {
  existingAdjustmentReason,
  existingMaintenanceReason,
  meaningfulOperationalReason,
} from "../src/js/operational-reasons.js";
import { ensureMaintenanceCase } from "../src/js/maintenance.js";

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
