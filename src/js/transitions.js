import {
  addCompleted,
  addRecord,
  recordsOfTnl,
  removeCategory,
  removeCompleted,
} from "./model.js";
import { padTnl } from "./utils.js";

export const MACHINE_NEXT_STEPS = Object.freeze({
  maintenance: "maintenance",
  setup: "setup",
});

export const ROUTED_SETUP_MODES = Object.freeze({
  active: "active",
  start: "start",
});

export function buildMachineRoute(
  state,
  tnl,
  { nextStep = MACHINE_NEXT_STEPS.maintenance, setupMode = "" } = {},
) {
  const machine = Number(tnl);
  if (!Object.values(MACHINE_NEXT_STEPS).includes(nextStep)) {
    throw new Error("Próximo passo inválido para a máquina.");
  }
  if (
    nextStep === MACHINE_NEXT_STEPS.setup &&
    !Object.values(ROUTED_SETUP_MODES).includes(setupMode)
  ) {
    throw new Error("Situação do setup inválida para a máquina.");
  }
  const setupRecord = recordsOfTnl(state, machine).find((record) =>
    ["setup_active", "setup_start"].includes(record.type),
  );
  return {
    nextStep,
    setupMode: nextStep === MACHINE_NEXT_STEPS.setup ? setupMode : "",
    setupEmoji: setupRecord?.emoji || "🔴",
    setupWasPresent: Boolean(setupRecord),
  };
}

export function applyMachineRoute(state, tnl, route = {}) {
  const machine = Number(tnl);
  const plan = {
    nextStep: route.nextStep,
    setupMode: route.setupMode || "",
    setupEmoji: route.setupEmoji || "🔴",
    setupWasPresent: Boolean(route.setupWasPresent),
  };
  if (!Object.values(MACHINE_NEXT_STEPS).includes(plan.nextStep)) {
    throw new Error("Próximo passo inválido para a máquina.");
  }

  if (plan.nextStep === MACHINE_NEXT_STEPS.maintenance) {
    removeCategory(state, machine, "setup");
    if (plan.setupWasPresent) addCompleted(state, machine, "setup");
    return {
      ...plan,
      action: plan.setupWasPresent
        ? "SETUP CONCLUÍDO → VAI PASSAR EM MANUTENÇÃO"
        : "VAI PASSAR EM MANUTENÇÃO",
    };
  }

  if (!Object.values(ROUTED_SETUP_MODES).includes(plan.setupMode)) {
    throw new Error("Situação do setup inválida para a máquina.");
  }
  removeCompleted(state, machine, "setup");
  removeCategory(state, machine, "setup");
  const starting = plan.setupMode === ROUTED_SETUP_MODES.start;
  addRecord(state, {
    id: state.nextId++,
    tnl: machine,
    type: starting ? "setup_start" : "setup_active",
    displayText: `${plan.setupEmoji} TNL ${padTnl(machine)} - ${starting ? "INICIAR SETUP" : "EM SETUP"}`,
    rawText: `TNL ${padTnl(machine)} - ${starting ? "INICIAR SETUP" : "EM SETUP"}`,
    sourceSection: "decision",
    emoji: plan.setupEmoji,
  });
  return {
    ...plan,
    action: starting ? "INICIAR SETUP" : "VAI PASSAR EM SETUP",
  };
}
