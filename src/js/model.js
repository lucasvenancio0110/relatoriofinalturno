import { ACTIVE_TYPES, CELL_ORDER, GENERAL_CELL, UNMAPPED_CELL } from "./config.js";
import { normalizeMaintenanceCases } from "./maintenance.js";
import { cellForTnl, deepClone, sortByTnl, uniqueNumbers } from "./utils.js";

export function createEmptyState() {
  return {
    raw: "",
    records: [],
    futureItems: [],
    devObsItems: [],
    generalInfoItems: [],
    reviewLines: [],
    reasons: { maintenance: {}, adjustment: {} },
    maintenanceCases: {},
    completed: { adjustments: [], setups: [], maintenances: [] },
    reviewedTnls: {},
    resolvedConflicts: {},
    confirmedDecisions: {},
    decisionOrder: 0,
    actionHistory: [],
    roundLedger: [],
    nextId: 1,
    nextFutureId: 1,
    nextDevObsId: 1,
    nextGeneralId: 1,
    cloudPassageId: null,
  };
}

export function hydrateState(saved) {
  const base = createEmptyState();
  const source = saved && typeof saved === "object" ? saved : {};
  const state = {
    ...base,
    ...source,
    reasons: {
      maintenance: { ...(source.reasons?.maintenance || {}) },
      adjustment: { ...(source.reasons?.adjustment || {}) },
    },
    completed: {
      adjustments: uniqueNumbers(source.completed?.adjustments || []),
      setups: uniqueNumbers(source.completed?.setups || []),
      maintenances: uniqueNumbers(source.completed?.maintenances || []),
    },
    reviewedTnls: { ...(source.reviewedTnls || {}) },
    resolvedConflicts: { ...(source.resolvedConflicts || {}) },
    confirmedDecisions: { ...(source.confirmedDecisions || {}) },
    maintenanceCases: normalizeMaintenanceCases(source.maintenanceCases || {}),
    records: [...(source.records || [])],
    futureItems: [...(source.futureItems || [])],
    devObsItems: [...(source.devObsItems || [])],
    generalInfoItems: [...(source.generalInfoItems || [])],
    reviewLines: [...(source.reviewLines || [])],
    actionHistory: [...(source.actionHistory || [])],
    roundLedger: [...(source.roundLedger || [])],
  };
  state.decisionOrder = Math.max(
    Number(state.decisionOrder || 0),
    0,
    ...Object.values(state.confirmedDecisions).map((item) => Number(item?.order || 0)),
  );
  return state;
}

export function activeRecords(state) {
  return state.records.filter((record) => ACTIVE_TYPES.includes(record.type));
}

export function recordsOfTnl(state, tnl) {
  return state.records.filter((record) => Number(record.tnl) === Number(tnl));
}

export function categoryOfType(type) {
  if (["maintenance", "maintenance_prod", "maintenance_completed", "maintenance_monitoring"].includes(type)) {
    return "maintenance";
  }
  if (["setup_active", "setup_start"].includes(type)) return "setup";
  if (type === "adjustment") return "adjustment";
  return "";
}

export function categoryLabel(category) {
  return {
    maintenance: "MANUTENÇÃO",
    setup: "SETUP",
    adjustment: "AJUSTE",
  }[category] || String(category || "ATIVIDADE").toUpperCase();
}

export function categoriesOfTnl(state, tnl) {
  return [...new Set(recordsOfTnl(state, tnl).map((item) => categoryOfType(item.type)).filter(Boolean))];
}

export function hasConflict(state, tnl) {
  return categoriesOfTnl(state, tnl).length > 1;
}

export function unresolvedConflicts(state) {
  const tnls = uniqueNumbers(activeRecords(state).map((record) => record.tnl));
  return tnls.filter(
    (tnl) => hasConflict(state, tnl) && !state.resolvedConflicts[String(tnl)],
  );
}

export function registerLedger(state, entry) {
  const key = String(entry.key);
  const existing = state.roundLedger.find((item) => item.key === key);
  if (existing) {
    Object.assign(existing, entry, { key });
    return existing;
  }
  const created = {
    key,
    kind: entry.kind,
    tnl: entry.tnl == null ? null : Number(entry.tnl),
    cell: entry.cell || (entry.tnl ? cellForTnl(entry.tnl) : GENERAL_CELL),
    status: entry.status === "decided" ? "decided" : "pending",
  };
  state.roundLedger.push(created);
  return created;
}

export function markLedger(state, key, status) {
  const entry = state.roundLedger.find((item) => item.key === String(key));
  if (entry) entry.status = status;
}

export function visibleCells(state) {
  const cells = [...CELL_ORDER];
  if (state.roundLedger.some((item) => item.cell === GENERAL_CELL)) cells.unshift(GENERAL_CELL);
  if (state.roundLedger.some((item) => item.cell === UNMAPPED_CELL)) cells.push(UNMAPPED_CELL);
  return cells;
}

export function progressForCell(state, cell) {
  const entries = state.roundLedger.filter((item) => item.cell === cell);
  const decided = entries.filter((item) => item.status === "decided").length;
  return {
    total: entries.length,
    decided,
    pending: entries.length - decided,
    percent: entries.length ? Math.round((decided / entries.length) * 100) : 100,
  };
}

export function kpis(state) {
  return {
    pending: state.roundLedger.filter((item) => item.status !== "decided").length,
    conflicts: unresolvedConflicts(state).length,
    completed: Object.keys(state.confirmedDecisions).length,
  };
}

export function completedKey(category) {
  return { maintenance: "maintenances", setup: "setups", adjustment: "adjustments" }[category] || "";
}

export function addCompleted(state, tnl, category) {
  const key = completedKey(category);
  if (key) state.completed[key] = uniqueNumbers([...state.completed[key], Number(tnl)]);
}

export function removeCompleted(state, tnl, category) {
  const key = completedKey(category);
  if (key) state.completed[key] = state.completed[key].filter((value) => Number(value) !== Number(tnl));
}

export function removeCategory(state, tnl, category) {
  state.records = state.records.filter(
    (record) => Number(record.tnl) !== Number(tnl) || categoryOfType(record.type) !== category,
  );
}

export function removeRecordsOfTnl(state, tnl) {
  state.records = state.records.filter((record) => Number(record.tnl) !== Number(tnl));
}

export function addRecord(state, record) {
  const key = [record.tnl, record.type, record.displayText, record.rawText].join("|").toLowerCase();
  if (
    !state.records.some(
      (item) =>
        [item.tnl, item.type, item.displayText, item.rawText].join("|").toLowerCase() === key,
    )
  ) {
    state.records.push(record);
    state.records = sortByTnl(state.records);
  }
}

export function snapshotSubject(state, subjectKey) {
  const key = String(subjectKey);
  const ledger = state.roundLedger.find((item) => item.key === key);
  const generalId = key.startsWith("G:") ? Number(key.split(":")[1]) : null;
  if (generalId) {
    return {
      mode: "general",
      generalId,
      item: deepClone(state.generalInfoItems.find((item) => Number(item.id) === generalId)),
      ledger: deepClone(state.roundLedger.filter((item) => item.key === key)),
      decisions: deepClone(
        Object.fromEntries(Object.entries(state.confirmedDecisions).filter(([decisionKey]) => decisionKey === key)),
      ),
    };
  }
  const tnl = Number(ledger?.tnl || state.confirmedDecisions[key]?.tnl || 0);
  return {
    mode: "tnl",
    tnl,
    records: deepClone(recordsOfTnl(state, tnl)),
    futureItems: deepClone(state.futureItems.filter((item) => Number(item.tnl) === tnl)),
    devObsItems: deepClone(state.devObsItems.filter((item) => Number(item.tnl) === tnl)),
    ledger: deepClone(state.roundLedger.filter((item) => Number(item.tnl) === tnl)),
    decisions: deepClone(
      Object.fromEntries(
        Object.entries(state.confirmedDecisions).filter(([, decision]) => Number(decision?.tnl) === tnl),
      ),
    ),
    reviewed: Boolean(state.reviewedTnls[String(tnl)]),
    resolved: Boolean(state.resolvedConflicts[String(tnl)]),
    completed: {
      maintenance: state.completed.maintenances.includes(tnl),
      setup: state.completed.setups.includes(tnl),
      adjustment: state.completed.adjustments.includes(tnl),
    },
    reasons: {
      maintenance: deepClone(state.reasons.maintenance[String(tnl)] || []),
      adjustment: state.reasons.adjustment[String(tnl)] || "",
    },
    maintenanceCase: deepClone(state.maintenanceCases?.[String(tnl)]),
  };
}

export function restoreSnapshot(state, snapshot) {
  if (!snapshot) return;
  if (snapshot.mode === "general") {
    const id = Number(snapshot.generalId);
    state.generalInfoItems = state.generalInfoItems.filter((item) => Number(item.id) !== id);
    if (snapshot.item) state.generalInfoItems.push(deepClone(snapshot.item));
    state.roundLedger = state.roundLedger.filter((item) => item.key !== `G:${id}`);
    state.roundLedger.push(...deepClone(snapshot.ledger || []));
    delete state.confirmedDecisions[`G:${id}`];
    Object.assign(state.confirmedDecisions, deepClone(snapshot.decisions || {}));
    return;
  }

  const tnl = Number(snapshot.tnl);
  state.records = state.records.filter((item) => Number(item.tnl) !== tnl);
  state.records.push(...deepClone(snapshot.records || []));
  state.records = sortByTnl(state.records);
  state.futureItems = state.futureItems.filter((item) => Number(item.tnl) !== tnl);
  state.futureItems.push(...deepClone(snapshot.futureItems || []));
  state.futureItems = sortByTnl(state.futureItems);
  state.devObsItems = state.devObsItems.filter((item) => Number(item.tnl) !== tnl);
  state.devObsItems.push(...deepClone(snapshot.devObsItems || []));
  state.devObsItems = sortByTnl(state.devObsItems);
  state.roundLedger = state.roundLedger.filter((item) => Number(item.tnl) !== tnl);
  state.roundLedger.push(...deepClone(snapshot.ledger || []));
  Object.entries(state.confirmedDecisions).forEach(([key, decision]) => {
    if (Number(decision?.tnl) === tnl) delete state.confirmedDecisions[key];
  });
  Object.assign(state.confirmedDecisions, deepClone(snapshot.decisions || {}));
  snapshot.reviewed
    ? (state.reviewedTnls[String(tnl)] = true)
    : delete state.reviewedTnls[String(tnl)];
  snapshot.resolved
    ? (state.resolvedConflicts[String(tnl)] = true)
    : delete state.resolvedConflicts[String(tnl)];
  ["maintenance", "setup", "adjustment"].forEach((category) => {
    removeCompleted(state, tnl, category);
    if (snapshot.completed?.[category]) addCompleted(state, tnl, category);
  });
  snapshot.reasons?.maintenance?.length
    ? (state.reasons.maintenance[String(tnl)] = deepClone(snapshot.reasons.maintenance))
    : delete state.reasons.maintenance[String(tnl)];
  snapshot.reasons?.adjustment
    ? (state.reasons.adjustment[String(tnl)] = snapshot.reasons.adjustment)
    : delete state.reasons.adjustment[String(tnl)];
  if (!state.maintenanceCases || typeof state.maintenanceCases !== "object") {
    state.maintenanceCases = {};
  }
  snapshot.maintenanceCase
    ? (state.maintenanceCases[String(tnl)] = deepClone(snapshot.maintenanceCase))
    : delete state.maintenanceCases[String(tnl)];
}

export function commitDecision(state, { subjectKey, tnl = null, kind, action, detail, before, general = false }) {
  const key = String(subjectKey);
  const machine = tnl == null ? null : Number(tnl);
  markLedger(state, key, "decided");
  if (kind === "machine" && machine) {
    state.reviewedTnls[String(machine)] = true;
    state.resolvedConflicts[String(machine)] = true;
  }
  state.decisionOrder = Number(state.decisionOrder || 0) + 1;
  state.confirmedDecisions[key] = {
    key,
    kind,
    tnl: machine,
    general,
    action,
    detail: detail || action,
    time: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    order: state.decisionOrder,
    before: deepClone(before),
  };
  state.actionHistory.push({ subjectKey: key, before: deepClone(before) });
  return state.confirmedDecisions[key];
}

export function undoLastAction(state) {
  const action = state.actionHistory.pop();
  if (!action) return false;
  restoreSnapshot(state, action.before);
  return true;
}

export function reopenDecision(state, key) {
  const decision = state.confirmedDecisions[String(key)];
  if (!decision?.before) return false;
  const current = snapshotSubject(state, key);
  restoreSnapshot(state, decision.before);
  state.actionHistory.push({ subjectKey: String(key), before: current });
  return true;
}
