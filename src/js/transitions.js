import { addCompleted, recordsOfTnl, removeCategory } from "./model.js";

export const SETUP_BEFORE_MAINTENANCE = Object.freeze({
  completed: "completed",
  resume: "resume",
  remove: "remove",
});

export function applySetupBeforeMaintenance(state, tnl, resolution) {
  const machine = Number(tnl);
  const setupRecord = recordsOfTnl(state, machine).find((record) =>
    ["setup_active", "setup_start"].includes(record.type),
  );
  if (!setupRecord) return null;
  if (!Object.values(SETUP_BEFORE_MAINTENANCE).includes(resolution)) {
    throw new Error("Destino do setup inválido para a transição de manutenção.");
  }

  const transition = {
    resolution,
    resumeAfterMaintenance: resolution === SETUP_BEFORE_MAINTENANCE.resume,
    setupMode: setupRecord.type === "setup_start" ? "start" : "active",
    emoji: setupRecord.emoji || "🔴",
  };

  if (resolution === SETUP_BEFORE_MAINTENANCE.completed) {
    addCompleted(state, machine, "setup");
  }
  removeCategory(state, machine, "setup");
  return transition;
}
