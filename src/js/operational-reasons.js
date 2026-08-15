import { maintenanceCaseOf } from "./maintenance.js";
import { recordsOfTnl } from "./model.js";
import { extractReason, normalizeHeader, uniqueStrings } from "./utils.js";

const MAINTENANCE_RECORD_TYPES = new Set([
  "maintenance",
  "maintenance_prod",
  "maintenance_completed",
  "maintenance_monitoring",
]);

const GENERIC_REASONS = Object.freeze({
  adjustment: new Set([
    "AJUSTE",
    "EM AJUSTE",
    "VAI PASSAR EM AJUSTE",
    "MOTIVO NAO INFORMADO",
    "NAO INFORMADO",
    "N A",
    "NA",
  ]),
  maintenance: new Set([
    "MANUTENCAO",
    "EM MANUTENCAO",
    "VAI PASSAR EM MANUTENCAO",
    "MANUTENCAO PRODUZINDO",
    "MANUTENCAO CONCLUIDA",
    "EM ACOMPANHAMENTO",
    "CONTINUA PARADA",
    "MOTIVO NAO INFORMADO",
    "NAO INFORMADO",
    "N A",
    "NA",
  ]),
});

export function meaningfulOperationalReason(value, category) {
  const text = String(value || "").trim();
  if (!text) return "";
  const key = normalizeHeader(text);
  return GENERIC_REASONS[category]?.has(key) ? "" : text;
}

function reasonsFromRecords(records, category) {
  return uniqueStrings(
    records
      .flatMap((record) => [extractReason(record.rawText), extractReason(record.displayText)])
      .map((value) => meaningfulOperationalReason(value, category))
      .filter(Boolean),
  );
}

export function existingAdjustmentReason(state, tnl) {
  const records = recordsOfTnl(state, tnl).filter((record) => record.type === "adjustment");
  if (!records.length) return "";
  return reasonsFromRecords(records, "adjustment").join(" + ");
}

export function existingMaintenanceReason(state, tnl) {
  const records = recordsOfTnl(state, tnl);
  const maintenanceRecords = records.filter((record) => MAINTENANCE_RECORD_TYPES.has(record.type));
  const maintenanceCase = maintenanceCaseOf(state, tnl);

  // Caso antigo de manutenção não vale como motivo atual quando a máquina está só em outra categoria.
  if (!maintenanceRecords.length && (records.length || !maintenanceCase)) return "";

  const currentRecordReasons = reasonsFromRecords(maintenanceRecords, "maintenance");
  if (currentRecordReasons.length) return currentRecordReasons.join(" + ");

  const key = String(Number(tnl));
  const storedReasons = Array.isArray(state?.reasons?.maintenance?.[key])
    ? state.reasons.maintenance[key]
    : [state?.reasons?.maintenance?.[key]];
  const caseReasons = maintenanceCase?.reasons || [];
  return uniqueStrings(
    [...caseReasons, ...storedReasons]
      .map((value) => meaningfulOperationalReason(value, "maintenance"))
      .filter(Boolean),
  ).join(" + ");
}
