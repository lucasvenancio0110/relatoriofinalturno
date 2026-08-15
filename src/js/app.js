import {
  ACCESS_HASH,
  ACCESS_SESSION_KEY,
  APP_VERSION,
  GENERAL_CELL,
  SECTION_LABELS,
  STORAGE_KEY,
  THEME_KEY,
  TYPE_CONFIG,
  UNMAPPED_CELL,
} from "./config.js";
import { flushCloudQueue, syncCloud } from "./cloud.js";
import {
  MACHINE_OUTCOMES,
  clockNow,
  ensureMaintenanceCase,
  maintenanceActionLabel,
  maintenanceCaseOf,
  maintenanceDecisionDetail,
  maintenanceReason,
  maintenanceRoundDefaults,
  maintenanceRoundState,
  maintenanceTrackingLines,
  normalizeMaintenanceCase,
  previousShift,
  removeMaintenanceCase,
  updateMaintenanceCase,
  validateMaintenanceUpdate,
} from "./maintenance.js";
import {
  activeRecords,
  addCompleted,
  addRecord,
  categoriesOfTnl,
  categoryLabel,
  commitDecision,
  createEmptyState,
  hasConflict,
  hydrateState,
  kpis,
  markLedger,
  progressForCell,
  recordsOfTnl,
  registerLedger,
  removeCategory,
  removeCompleted,
  removeRecordsOfTnl,
  reopenDecision,
  restoreSnapshot,
  snapshotSubject,
  undoLastAction,
  unresolvedConflicts,
  visibleCells,
} from "./model.js";
import { parseReport, rebuildInfoFromFields } from "./parser.js";
import { generateReport } from "./report.js";
import {
  SETUP_BEFORE_MAINTENANCE,
  applySetupBeforeMaintenance,
} from "./transitions.js";
import {
  cellForTnl,
  cellLabel,
  cleanLine,
  escapeHtml,
  extractReason,
  nextTurnHeading,
  padTnl,
  sortByTnl,
  uniqueStrings,
  validNextShift,
} from "./utils.js";

const FIELD_IDS = [
  "currentShift",
  "nextShift",
  "checkpoint",
  "cqFechamento",
  "cqReinspecao",
  "sel1",
  "sel2",
  "sel3",
  "selAll",
  "selTnc",
  "development",
  "observations",
];

const DEFAULT_FIELDS = Object.freeze({
  currentShift: "2",
  nextShift: "3",
  checkpoint: "00",
  cqFechamento: "00",
  cqReinspecao: "00",
  sel1: "00",
  sel2: "00",
  sel3: "00",
  selAll: "00",
  selTnc: "00",
  development: "",
  observations: "",
});

const byId = (id) => document.getElementById(id);
let state = createEmptyState();
let selectedCell = "01";
let activeTab = "dados";
let cloudStarted = false;
let toastTimer = null;
let decisionResolver = null;
let maintenanceDrafts = {};
let activeMaintenanceDraftKey = "";
let maintenanceResumeStarted = false;
let maintenanceAutosaveTimer = null;

function toast(message) {
  const node = byId("toast");
  node.textContent = String(message || "");
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 2200);
}

function readFields() {
  return Object.fromEntries(FIELD_IDS.map((id) => [id, byId(id).value]));
}

function applyFields(fields = {}) {
  FIELD_IDS.forEach((id) => {
    byId(id).value = fields[id] ?? DEFAULT_FIELDS[id] ?? "";
  });
  enforceShiftPair("current");
}

function saveSession() {
  try {
    state.raw = byId("rawInput").value;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        state,
        fields: readFields(),
        selectedCell,
        activeTab,
        maintenanceDrafts,
        activeMaintenanceDraftKey,
      }),
    );
    return true;
  } catch (error) {
    console.error("Falha ao salvar a sessão", error);
    toast("Não foi possível salvar a sessão neste navegador");
    return false;
  }
}

function restoreSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      applyFields(DEFAULT_FIELDS);
      return false;
    }
    const saved = JSON.parse(raw);
    state = hydrateState(saved.state);
    applyFields({ ...DEFAULT_FIELDS, ...(saved.fields || {}) });
    byId("rawInput").value = state.raw || "";
    selectedCell = saved.selectedCell || "01";
    activeTab = ["dados", "ronda", "relatorio"].includes(saved.activeTab)
      ? saved.activeTab
      : "dados";
    maintenanceDrafts =
      saved.maintenanceDrafts && typeof saved.maintenanceDrafts === "object"
        ? saved.maintenanceDrafts
        : saved.maintenanceDraft
          ? { [saved.maintenanceDraft.context?.subjectKey || `A:${saved.maintenanceDraft.tnl}`]: saved.maintenanceDraft }
          : {};
    activeMaintenanceDraftKey =
      saved.activeMaintenanceDraftKey && maintenanceDrafts[saved.activeMaintenanceDraftKey]
        ? saved.activeMaintenanceDraftKey
        : Object.keys(maintenanceDrafts).sort(
            (a, b) =>
              String(maintenanceDrafts[b]?.updatedAt || "").localeCompare(
                String(maintenanceDrafts[a]?.updatedAt || ""),
              ),
          )[0] || "";
    return true;
  } catch (error) {
    console.error("Falha ao restaurar a sessão", error);
    applyFields(DEFAULT_FIELDS);
    return false;
  }
}

function setTheme(theme) {
  const safeTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = safeTheme;
  byId("themeIcon").textContent = safeTheme === "light" ? "☀️" : "🌙";
  byId("themeLabel").textContent = safeTheme === "light" ? "Claro" : "Escuro";
  byId("themeToggle").setAttribute("aria-pressed", safeTheme === "light" ? "true" : "false");
  try {
    localStorage.setItem(THEME_KEY, safeTheme);
  } catch {}
}

function initTheme() {
  let saved = "dark";
  try {
    saved = localStorage.getItem(THEME_KEY) || "dark";
  } catch {}
  setTheme(saved);
  byId("themeToggle").addEventListener("click", () => {
    setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
  });
}

async function hashPassword(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function startCloudQueue() {
  if (cloudStarted) return;
  cloudStarted = true;
  setTimeout(() => flushCloudQueue().catch(() => {}), 1000);
  window.addEventListener("online", () => flushCloudQueue().catch(() => {}));
}

function unlockAccess() {
  document.body.classList.remove("auth-locked");
  sessionStorage.setItem(ACCESS_SESSION_KEY, "1");
  startCloudQueue();
  setTimeout(resumePendingMaintenanceDraft, 80);
}

function initAccess() {
  if (sessionStorage.getItem(ACCESS_SESSION_KEY) === "1") {
    unlockAccess();
    return;
  }
  byId("accessForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = byId("accessPassword");
    const error = byId("accessError");
    error.textContent = "";
    try {
      if ((await hashPassword(input.value.trim())) === ACCESS_HASH) {
        input.value = "";
        unlockAccess();
      } else {
        input.value = "";
        input.focus();
        error.textContent = "Senha incorreta.";
      }
    } catch {
      error.textContent = "Não foi possível validar a senha neste navegador.";
    }
  });
  setTimeout(() => byId("accessPassword").focus(), 100);
}

function enforceShiftPair(changed) {
  const current = byId("currentShift");
  const next = byId("nextShift");
  if (changed === "next" && Number(next.value) === Number(current.value)) {
    next.value = String(validNextShift(current.value, ""));
    toast("O próximo turno deve ser diferente do turno atual");
    return;
  }
  next.value = String(validNextShift(current.value, next.value));
}

function switchTab(tab, { userInitiated = false, save = true } = {}) {
  const target = ["dados", "ronda", "relatorio"].includes(tab) ? tab : "dados";
  if (userInitiated && target === "relatorio") {
    const metrics = kpis(state);
    if (metrics.pending && !window.confirm(`Ainda existem ${metrics.pending} pendência(s). Deseja conferir o relatório mesmo assim?`)) {
      return false;
    }
  }
  activeTab = target;
  document.querySelectorAll("[data-tab]").forEach((button) => {
    const isActive = button.dataset.tab === target;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    const isActive = panel.dataset.panel === target;
    panel.classList.toggle("active", isActive);
    panel.hidden = !isActive;
  });
  document.body.classList.toggle("report-tab-active", target === "relatorio");
  if (target === "relatorio") renderReport();
  if (target === "ronda") renderRound();
  if (save) saveSession();
  return true;
}

function lineBreaks(value) {
  return escapeHtml(value).replace(/\n/g, "<br />");
}

function parserWarningHtml() {
  const unmapped = uniqueStrings(
    state.roundLedger
      .filter((entry) => entry.cell === UNMAPPED_CELL)
      .map((entry) => (entry.tnl ? `TNL ${padTnl(entry.tnl)}` : "")),
  );
  const parts = [];
  if (unmapped.length) parts.push(`Máquinas sem célula mapeada: ${escapeHtml(unmapped.join(", "))}.`);
  if (state.reviewLines.length) {
    parts.push(
      `Linhas que precisam de leitura manual:<br />${state.reviewLines
        .slice(0, 8)
        .map((line) => escapeHtml(line))
        .join("<br />")}${state.reviewLines.length > 8 ? "<br />..." : ""}`,
    );
  }
  return parts.length
    ? `<div class="warning"><strong>⚠ REVISAR ANTES DE FINALIZAR</strong>${parts.join("<br /><br />")}</div>`
    : "";
}

function updateKpis() {
  const metrics = kpis(state);
  byId("kpiPending").textContent = metrics.pending;
  byId("kpiConflicts").textContent = metrics.conflicts;
  byId("kpiCompleted").textContent = metrics.completed;
}

function renderCellOptions() {
  const cells = visibleCells(state);
  if (!cells.includes(selectedCell)) selectedCell = cells.includes("01") ? "01" : cells[0] || "01";
  byId("cellSelect").innerHTML = cells
    .map(
      (cell) =>
        `<option value="${escapeHtml(cell)}" ${cell === selectedCell ? "selected" : ""}>${escapeHtml(cellLabel(cell))}</option>`,
    )
    .join("");
}

function conflictsForCell(cell) {
  const conflictSet = new Set(unresolvedConflicts(state));
  return new Set(
    state.roundLedger
      .filter((entry) => entry.cell === cell && conflictSet.has(Number(entry.tnl)))
      .map((entry) => Number(entry.tnl)),
  ).size;
}

function renderCellOverview() {
  byId("cellOverview").innerHTML = visibleCells(state)
    .map((cell) => {
      const progress = progressForCell(state, cell);
      const conflicts = conflictsForCell(cell);
      const status = conflicts ? "conflict" : progress.pending ? "pending" : "clear";
      const count = conflicts
        ? `${progress.pending} pend. · ${conflicts} confl.`
        : progress.pending
          ? `${progress.pending} pend.`
          : "OK";
      const short = cell === GENERAL_CELL ? "GERAL" : cell === UNMAPPED_CELL ? "SEM CÉL." : `C${cell}`;
      return `<button class="cell-chip ${status} ${cell === selectedCell ? "selected" : ""}" type="button" data-cell="${escapeHtml(cell)}"><span>${escapeHtml(short)}</span><small>${escapeHtml(count)}</small></button>`;
    })
    .join("");
}

function sourceBlocks(records) {
  const groups = new Map();
  records.forEach((record) => {
    const key = record.sourceSection || record.type;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });
  return [...groups.entries()]
    .map(([section, items]) => {
      const label = SECTION_LABELS[section] || TYPE_CONFIG[section]?.short || section;
      const lines = uniqueStrings(items.map((item) => item.rawText || item.displayText));
      return `<div class="source-group"><strong>${escapeHtml(label)}</strong>${lines.map((line) => `<p>${lineBreaks(line)}</p>`).join("")}</div>`;
    })
    .join("");
}

function roundCard({ key, kind, value, title, badge, tone, source, conflict = false }) {
  return `<button class="round-card ${tone || "neutral"} ${conflict ? "conflict" : ""}" type="button" data-kind="${escapeHtml(kind)}" data-value="${escapeHtml(value)}" data-key="${escapeHtml(key)}"><span class="round-accent"></span><span class="round-card-head"><strong>${escapeHtml(title)}</strong><em class="badge ${tone || "neutral"}">${escapeHtml(badge)}</em></span><span class="round-card-action">DECIDIR</span><span class="round-card-source"><small>INFORMAÇÃO ORIGINAL DO GRUPO</small>${source}</span></button>`;
}

function cardForLedger(entry) {
  if (entry.status === "decided") return "";
  if (entry.kind === "machine") {
    const records = recordsOfTnl(state, entry.tnl);
    const maintenanceItem = maintenanceCaseOf(state, entry.tnl);
    if (!records.length && !maintenanceItem) return "";
    const conflict = hasConflict(state, entry.tnl) && !state.resolvedConflicts[String(entry.tnl)];
    const first = records[0]?.type || (maintenanceItem ? "maintenance" : "");
    const config = conflict ? { short: "CONFLITO", tone: "danger" } : TYPE_CONFIG[first] || { short: "PENDÊNCIA", tone: "warning" };
    const tracking = maintenanceItem?.reviewed
      ? `<div class="source-group"><strong>ÚLTIMO ACOMPANHAMENTO</strong>${maintenanceTrackingLines(
          maintenanceItem,
          readFields().currentShift,
        )
          .map((line) => `<p>${lineBreaks(line)}</p>`)
          .join("")}</div>`
      : "";
    return roundCard({
      key: entry.key,
      kind: "machine",
      value: entry.tnl,
      title: `TNL ${padTnl(entry.tnl)}`,
      badge: config.short,
      tone: config.tone,
      source: `${sourceBlocks(records)}${tracking}`,
      conflict,
    });
  }
  if (entry.kind === "future") {
    const item = state.futureItems.find((future) => `F:${future.id}` === entry.key && future.status !== "removed");
    if (!item) return "";
    return roundCard({
      key: entry.key,
      kind: "future",
      value: item.id,
      title: `TNL ${padTnl(item.tnl)}`,
      badge: item.heading,
      tone: "setup",
      source: `<p>${lineBreaks(item.rawText || item.displayText)}</p>`,
    });
  }
  if (entry.kind === "devobs") {
    const item = state.devObsItems.find(
      (info) => `D:${info.id}` === entry.key && !["removed", "resolved"].includes(info.status),
    );
    if (!item) return "";
    const development = item.kind === "development";
    return roundCard({
      key: entry.key,
      kind: "devobs",
      value: item.id,
      title: `TNL ${padTnl(item.tnl)}`,
      badge: development ? "DESENVOLVIMENTO" : "OBSERVAÇÃO",
      tone: development ? "info" : "warning",
      source: `<p>${lineBreaks(item.rawText || item.displayText)}</p>`,
    });
  }
  if (entry.kind === "general") {
    const item = state.generalInfoItems.find(
      (info) => `G:${info.id}` === entry.key && info.status !== "removed",
    );
    if (!item) return "";
    return roundCard({
      key: entry.key,
      kind: "general",
      value: item.id,
      title: "GERAL / SEM MÁQUINA",
      badge: item.kind === "development" ? "DESENVOLVIMENTO" : "OBSERVAÇÃO",
      tone: item.kind === "development" ? "info" : "warning",
      source: `<p>${lineBreaks(item.rawText || item.text)}</p>`,
    });
  }
  return "";
}

function renderSelectedCell() {
  const progress = progressForCell(state, selectedCell);
  byId("progressFill").style.width = `${progress.percent}%`;
  byId("progressLabel").textContent = progress.total
    ? `${cellLabel(selectedCell)}: ${progress.decided}/${progress.total} decisões concluídas`
    : `${cellLabel(selectedCell)}: nenhuma informação registrada`;
  const cards = state.roundLedger
    .filter((entry) => entry.cell === selectedCell)
    .map(cardForLedger)
    .filter(Boolean);
  byId("machineList").innerHTML = cards.length
    ? cards.join("")
    : '<div class="empty">Nenhuma pendência aguardando decisão nesta célula.</div>';
}

function renderConfirmed() {
  const decisions = Object.values(state.confirmedDecisions).sort(
    (a, b) => Number(b.order || 0) - Number(a.order || 0),
  );
  byId("confirmedCount").textContent = `— ${String(decisions.length).padStart(2, "0")}`;
  byId("confirmedList").innerHTML = decisions.length
    ? decisions
        .map((decision) => {
          const title = decision.general
            ? "GERAL / SEM MÁQUINA"
            : decision.tnl
              ? `TNL ${padTnl(decision.tnl)}`
              : "DECISÃO";
          const maintenanceDecision =
            decision.tnl &&
            decision.action?.startsWith("MANUTENÇÃO —") &&
            maintenanceCaseOf(state, decision.tnl)?.reviewed;
          const actionButton = maintenanceDecision
            ? `<button class="btn btn-primary btn-small" type="button" data-update-maintenance="${escapeHtml(decision.key)}">ATUALIZAR MANUTENÇÃO</button>`
            : `<button class="btn btn-soft btn-small" type="button" data-reopen="${escapeHtml(decision.key)}">REEDITAR</button>`;
          return `<details class="confirmed-item"><summary><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(decision.action)} · ${escapeHtml(decision.time)}</small></span></summary><div class="confirmed-detail"><p>${lineBreaks(decision.detail)}</p>${actionButton}</div></details>`;
        })
        .join("")
    : '<div class="empty">Nenhuma decisão confirmada.</div>';
}

function renderRound() {
  renderCellOptions();
  renderCellOverview();
  renderSelectedCell();
  renderConfirmed();
}

function renderReport() {
  const report = generateReport(state, readFields());
  byId("finalOutput").value = report;
  const lines = report.split("\n");
  byId("finalPreview").innerHTML = `${lines
    .map((line) => {
      if (!line.trim()) return '<span class="wa-line blank">&nbsp;</span>';
      const escaped = escapeHtml(line).replace(/\*(.*?)\*/g, "<strong>$1</strong>");
      return `<span class="wa-line">${escaped}</span>`;
    })
    .join("")}<small class="wa-time">${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} ✓✓</small>`;
}

function renderAll() {
  updateKpis();
  byId("parserWarning").innerHTML = parserWarningHtml();
  renderRound();
  renderReport();
}

function showChoice({ title, subtitle = "", source = "", actions = [] }) {
  const dialog = byId("decisionDialog");
  byId("decisionTitle").textContent = title;
  byId("decisionSubtitle").textContent = subtitle;
  byId("decisionSource").innerHTML = source;
  byId("decisionActions").innerHTML = actions
    .map(
      (action) =>
        `<button class="modal-btn ${escapeHtml(action.tone || "neutral")}" type="button" data-choice="${escapeHtml(action.value)}">${escapeHtml(action.label)}</button>`,
    )
    .join("");
  if (decisionResolver) decisionResolver(null);
  return new Promise((resolve) => {
    decisionResolver = resolve;
    dialog.showModal();
  });
}

function closeChoice(value = null) {
  const dialog = byId("decisionDialog");
  if (dialog.open) dialog.close();
  const resolve = decisionResolver;
  decisionResolver = null;
  resolve?.(value);
}

function askText({ title, subtitle, initial = "" }) {
  const dialog = byId("textDialog");
  const input = byId("textDialogInput");
  byId("textDialogTitle").textContent = title;
  byId("textDialogSubtitle").textContent = subtitle || "";
  input.value = initial;
  dialog.returnValue = "";
  dialog.showModal();
  setTimeout(() => input.focus(), 80);
  return new Promise((resolve) => {
    const handleClose = () => {
      dialog.removeEventListener("close", handleClose);
      resolve(dialog.returnValue === "save" ? input.value.trim() : null);
    };
    dialog.addEventListener("close", handleClose);
  });
}

const MAINTENANCE_TIME_FIELDS = Object.freeze({
  maintenanceArrivedAt: {
    unknown: "maintenanceArrivedUnknown",
    shift: "maintenanceArrivedShift",
    shiftStart: "maintenanceArrivedAtShiftStart",
  },
  maintenanceFinishedAt: { unknown: "maintenanceFinishedUnknown", shift: "maintenanceFinishedShift" },
});

function maintenanceDraftKey(context = {}, tnl = 0) {
  return String(context.subjectKey || `A:${Number(tnl)}`);
}

function setMaintenanceChoice(fieldId, value) {
  byId(fieldId).value = String(value || "");
  document.querySelectorAll(`[data-maintenance-choice="${fieldId}"]`).forEach((button) => {
    const selected = button.dataset.value === String(value || "");
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

function setMaintenanceShift(fieldId, value) {
  byId(fieldId).value = value ? String(value) : "";
  document.querySelectorAll(`[data-shift-target="${fieldId}"]`).forEach((button) => {
    const selected = button.dataset.shift === String(value || "");
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

function renderTimeMode(inputId) {
  const input = byId(inputId);
  const mode = input.dataset.timeMode || "";
  const wrapper = document.querySelector(`[data-manual-time="${inputId}"]`);
  if (wrapper) wrapper.hidden = mode !== "manual";
  document.querySelectorAll(`[data-time-mode-target="${inputId}"]`).forEach((button) => {
    const selected = button.dataset.timeMode === mode;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    if (button.dataset.timeMode === "now") {
      button.dataset.defaultLabel ||= button.textContent;
      button.textContent =
        mode === "now" && input.value
          ? `${button.dataset.defaultLabel} · ${input.value}`
          : button.dataset.defaultLabel;
    }
  });
}

function setTimeMode(inputId, mode, { preserveValue = false, save = true } = {}) {
  const input = byId(inputId);
  const config = MAINTENANCE_TIME_FIELDS[inputId];
  if (!config) return;
  const unknown = byId(config.unknown);
  const shiftStart = config.shiftStart ? byId(config.shiftStart) : null;
  input.dataset.timeMode = mode || "";
  if (shiftStart) shiftStart.checked = mode === "shift_start";
  if (mode === "now") {
    if (!preserveValue || !input.value) input.value = clockNow();
    unknown.checked = false;
    if (config.shift && !byId(config.shift).value) {
      setMaintenanceShift(config.shift, Number(readFields().currentShift));
    }
  } else if (mode === "manual") {
    unknown.checked = false;
    if (config.shift && !byId(config.shift).value) {
      setMaintenanceShift(config.shift, Number(readFields().currentShift));
    }
  } else if (mode === "shift_start") {
    input.value = "";
    unknown.checked = false;
    if (config.shift) setMaintenanceShift(config.shift, Number(readFields().currentShift));
  } else if (mode === "unknown") {
    input.value = "";
    unknown.checked = true;
    if (config.shift) setMaintenanceShift(config.shift, "");
  } else if (["not_arrived", "working"].includes(mode)) {
    input.value = "";
    unknown.checked = false;
    if (config.shift) setMaintenanceShift(config.shift, "");
  } else {
    input.value = "";
    unknown.checked = false;
    if (config.shift) setMaintenanceShift(config.shift, "");
  }
  renderTimeMode(inputId);
  byId("maintenanceFormError").textContent = "";
  if (save) queueMaintenanceDraftSave();
}

function updateMaintenanceFormVisibility() {
  const dialog = byId("maintenanceDialog");
  const confirmedCompletion = dialog.dataset.confirmedCompletion === "true";
  const arrivalMode = byId("maintenanceArrivedAt").dataset.timeMode || "";
  const releaseMode = byId("maintenanceFinishedAt").dataset.timeMode || "";
  const roundState = maintenanceRoundState({
    reportedCompleted: confirmedCompletion,
    arrivalMode,
    releaseMode,
  });
  const arrivalReady = Boolean(arrivalMode) &&
    (arrivalMode !== "manual" || Boolean(byId("maintenanceArrivedAt").value));
  const releaseReady = Boolean(releaseMode) &&
    (releaseMode !== "manual" || Boolean(byId("maintenanceFinishedAt").value));
  const tractianReady = Boolean(
    byId("maintenanceTractianCode").value || byId("maintenanceTractianStatus").value,
  );
  const outcomeReady = ["released", "stopped"].includes(
    byId("maintenanceMachineOutcome").value,
  );

  setMaintenanceChoice("maintenanceServiceStatus", roundState.serviceStatus);
  byId("maintenanceNotArrived").hidden = confirmedCompletion;
  byId("maintenanceStillWorking").hidden = confirmedCompletion;
  byId("maintenanceFinishedField").hidden = !arrivalReady || !roundState.arrived;
  byId("maintenanceTractianField").hidden =
    !arrivalReady || (roundState.arrived && !releaseReady);
  byId("maintenanceOutcomeStep").hidden =
    byId("maintenanceTractianField").hidden || !tractianReady;
  byId("maintenanceSave").disabled = !(
    arrivalReady &&
    (!roundState.arrived || releaseReady) &&
    tractianReady &&
    outcomeReady &&
    roundState.serviceStatus
  );
  byId("maintenanceArrivedLabel").textContent = confirmedCompletion
    ? "Que horas a manutenção chegou?"
    : "A manutenção já chegou a atuar?";
  byId("maintenanceFinishedLabel").textContent = confirmedCompletion
    ? "Que horas a manutenção liberou?"
    : "A manutenção já liberou?";
  ["maintenanceTractianStatus", "maintenanceMachineOutcome"].forEach((id) =>
    setMaintenanceChoice(id, byId(id).value),
  );
  ["maintenanceArrivedShift", "maintenanceFinishedShift"].forEach((id) =>
    setMaintenanceShift(id, byId(id).value),
  );
  Object.keys(MAINTENANCE_TIME_FIELDS).forEach(renderTimeMode);
}

function readMaintenanceForm(tnl) {
  const tractianCode = byId("maintenanceTractianCode").value.replace(/\D/g, "").slice(0, 12);
  const roundState = maintenanceRoundState({
    reportedCompleted: byId("maintenanceDialog").dataset.confirmedCompletion === "true",
    arrivalMode: byId("maintenanceArrivedAt").dataset.timeMode || "",
    releaseMode: byId("maintenanceFinishedAt").dataset.timeMode || "",
  });
  const value = {
    tnl: Number(tnl),
    tractianCode,
    tractianStatus: tractianCode ? "informed" : byId("maintenanceTractianStatus").value,
    serviceStatus: roundState.serviceStatus,
    arrivedShift: Number(byId("maintenanceArrivedShift").value) || null,
    arrivedAt: byId("maintenanceArrivedAt").value,
    arrivedUnknown: byId("maintenanceArrivedUnknown").checked,
    arrivedAtShiftStart: byId("maintenanceArrivedAtShiftStart").checked,
    finishedShift: Number(byId("maintenanceFinishedShift").value) || null,
    finishedAt: byId("maintenanceFinishedAt").value,
    finishedUnknown: byId("maintenanceFinishedUnknown").checked,
    machineOutcome: byId("maintenanceMachineOutcome").value,
  };
  if (!["working", "completed"].includes(value.serviceStatus)) {
    value.arrivedShift = null;
    value.arrivedAt = "";
    value.arrivedUnknown = false;
    value.arrivedAtShiftStart = false;
  }
  if (value.serviceStatus !== "completed") {
    value.finishedShift = null;
    value.finishedAt = "";
    value.finishedUnknown = false;
  }
  return value;
}

function maintenanceDraftUi() {
  return {
    timeModes: Object.fromEntries(
      Object.keys(MAINTENANCE_TIME_FIELDS).map((id) => [id, byId(id).dataset.timeMode || ""]),
    ),
  };
}

function persistMaintenanceDraft() {
  const dialog = byId("maintenanceDialog");
  const tnl = Number(dialog.dataset.tnl || 0);
  const key = dialog.dataset.draftKey || "";
  if (!tnl || !key) return false;
  const previous = maintenanceDrafts[key] || {};
  const values = normalizeMaintenanceCase(
    { ...(previous.values || {}), ...readMaintenanceForm(tnl) },
    tnl,
  );
  maintenanceDrafts[key] = {
    version: 1,
    tnl,
    context: previous.context || { subjectKey: key, tnl },
    values,
    ui: maintenanceDraftUi(),
    scrollTop: dialog.scrollTop,
    openedAt: previous.openedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  activeMaintenanceDraftKey = key;
  const saved = saveSession();
  if (saved) {
    byId("maintenanceAutosaveStatus").innerHTML =
      '<span aria-hidden="true">●</span> Rascunho salvo automaticamente neste dispositivo';
  }
  return saved;
}

function queueMaintenanceDraftSave() {
  if (!byId("maintenanceDialog").open) return;
  byId("maintenanceAutosaveStatus").innerHTML =
    '<span class="saving" aria-hidden="true">●</span> Salvando rascunho…';
  clearTimeout(maintenanceAutosaveTimer);
  maintenanceAutosaveTimer = setTimeout(persistMaintenanceDraft, 120);
}

function flushMaintenanceDraft() {
  clearTimeout(maintenanceAutosaveTimer);
  maintenanceAutosaveTimer = null;
  if (byId("maintenanceDialog").dataset.draftKey) persistMaintenanceDraft();
}

function clearMaintenanceDraft(key) {
  if (!key) return;
  delete maintenanceDrafts[key];
  const dialog = byId("maintenanceDialog");
  if (dialog.dataset.draftKey === key) {
    delete dialog.dataset.draftKey;
    delete dialog.dataset.tnl;
  }
  activeMaintenanceDraftKey = Object.keys(maintenanceDrafts).sort(
    (a, b) =>
      String(maintenanceDrafts[b]?.updatedAt || "").localeCompare(
        String(maintenanceDrafts[a]?.updatedAt || ""),
      ),
  )[0] || "";
}

function showMaintenanceForm(tnl, initial = {}, context = {}) {
  const dialog = byId("maintenanceDialog");
  const form = byId("maintenanceForm");
  const key = maintenanceDraftKey(context, tnl);
  const storedDraft = maintenanceDrafts[key];
  const storedValues = storedDraft?.values || {};
  let item = maintenanceRoundDefaults(normalizeMaintenanceCase(
    {
      ...initial,
      ...storedValues,
      reasons: uniqueStrings([...(initial.reasons || []), ...(storedValues.reasons || [])]),
      sourceSections: uniqueStrings([
        ...(initial.sourceSections || []),
        ...(storedValues.sourceSections || []),
      ]),
      originalLines: uniqueStrings([
        ...(initial.originalLines || []),
        ...(storedValues.originalLines || []),
      ]),
    },
    tnl,
  ), { producing: Boolean(context.producing) });
  if (item.callOpenedShift && item.initiationMode === "production") {
    item = normalizeMaintenanceCase(
      {
        ...item,
        callOrigin:
          Number(item.callOpenedShift) === Number(readFields().currentShift)
            ? "current"
            : "previous",
      },
      tnl,
    );
  }
  maintenanceDrafts[key] = {
    ...storedDraft,
    version: 1,
    tnl: Number(tnl),
    context: {
      subjectKey: context.subjectKey || key,
      tnl: Number(tnl),
      reason: context.reason || maintenanceReason(item),
      producing: Boolean(context.producing),
    },
    values: item,
    openedAt: storedDraft?.openedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  activeMaintenanceDraftKey = key;
  dialog.dataset.tnl = String(Number(tnl));
  dialog.dataset.draftKey = key;
  dialog.dataset.confirmedCompletion = String(item.reportedCompleted && !item.reviewed);
  dialog.dataset.producing = String(Boolean(context.producing));

  byId("maintenanceDialogTitle").textContent = `Manutenção — TNL ${padTnl(tnl)}`;
  const received = item.originalLines.length
    ? `<details><summary>Ver informação recebida</summary><p>${lineBreaks(item.originalLines.join("\n"))}</p></details>`
    : "";
  byId("maintenanceSourceSummary").innerHTML = `${
    item.reportedCompleted
      ? "<strong>Já veio marcada como concluída.</strong><span>Registre somente os horários, o chamado e como a máquina está.</span>"
      : "<strong>Confirme rapidamente a situação na máquina.</strong>"
  }${item.reasons.length ? `<span>Motivo: ${escapeHtml(item.reasons.join(" + "))}</span>` : ""}${received}`;

  setMaintenanceChoice("maintenanceInitiationMode", item.initiationMode);
  setMaintenanceChoice("maintenanceCallOrigin", item.callOrigin);
  byId("maintenanceTractianCode").value = item.tractianCode;
  setMaintenanceChoice("maintenanceTractianStatus", item.tractianStatus);
  byId("maintenanceOpenedAt").value = item.callOpenedAt;
  byId("maintenanceOpenedUnknown").checked = item.callOpenedUnknown;
  setMaintenanceChoice("maintenanceServiceStatus", item.serviceStatus);
  setMaintenanceShift("maintenanceArrivedShift", item.arrivedShift);
  byId("maintenanceArrivedAt").value = item.arrivedAt;
  byId("maintenanceArrivedUnknown").checked = item.arrivedUnknown;
  byId("maintenanceArrivedAtShiftStart").checked = item.arrivedAtShiftStart;
  setMaintenanceShift("maintenanceFinishedShift", item.finishedShift);
  byId("maintenanceFinishedAt").value = item.finishedAt;
  byId("maintenanceFinishedUnknown").checked = item.finishedUnknown;
  setMaintenanceChoice("maintenanceMachineOutcome", item.machineOutcome);
  byId("maintenanceFormError").textContent = "";
  Object.entries(MAINTENANCE_TIME_FIELDS).forEach(([inputId, config]) => {
    let fallbackMode = byId(config.unknown).checked
      ? "unknown"
      : byId(inputId).value
        ? "manual"
        : "";
    if (inputId === "maintenanceArrivedAt") {
      if (item.serviceStatus === "waiting") fallbackMode = "not_arrived";
      else if (item.arrivedAtShiftStart) fallbackMode = "shift_start";
    }
    if (inputId === "maintenanceFinishedAt" && item.serviceStatus === "working") {
      fallbackMode = "working";
    }
    const mode = storedDraft?.ui?.timeModes?.[inputId] || fallbackMode;
    setTimeMode(inputId, mode, { preserveValue: true, save: false });
  });
  updateMaintenanceFormVisibility();
  dialog.returnValue = "";
  dialog.showModal();
  dialog.scrollTop = Number(storedDraft?.scrollTop || 0);
  persistMaintenanceDraft();
  setTimeout(() => {
    const firstAnswer = form.querySelector(
      '[data-time-mode-target="maintenanceArrivedAt"].selected, [data-time-mode-target="maintenanceArrivedAt"]',
    );
    (firstAnswer || byId("maintenanceSave")).focus();
  }, 80);

  return new Promise((resolve) => {
    let result = null;
    const handleSubmit = (event) => {
      if (event.submitter?.value !== "save") return;
      event.preventDefault();
      flushMaintenanceDraft();
      const candidate = {
        ...item,
        ...readMaintenanceForm(tnl),
      };
      const validation = validateMaintenanceUpdate(candidate);
      if (!validation.valid) {
        byId("maintenanceFormError").textContent = validation.errors[0];
        byId("maintenanceFormError").scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      result = validation.value;
      dialog.close("save");
    };
    const handleClose = () => {
      flushMaintenanceDraft();
      form.removeEventListener("submit", handleSubmit);
      dialog.removeEventListener("close", handleClose);
      resolve(dialog.returnValue === "save" ? result : null);
    };
    form.addEventListener("submit", handleSubmit);
    dialog.addEventListener("close", handleClose);
  });
}

function detailForTnl(tnl, fallback) {
  const lines = [
    ...recordsOfTnl(state, tnl).map((item) => item.displayText),
    ...state.futureItems
      .filter((item) => Number(item.tnl) === Number(tnl) && item.status !== "removed")
      .map((item) => item.displayText),
    ...state.devObsItems
      .filter((item) => Number(item.tnl) === Number(tnl) && !["removed", "resolved"].includes(item.status))
      .map((item) => item.displayText),
  ];
  return uniqueStrings(lines).join(" | ") || fallback;
}

function commitAndRefresh({ subjectKey, tnl, kind, action, before, general = false, detail = "" }) {
  commitDecision(state, {
    subjectKey,
    tnl,
    kind,
    action,
    before,
    general,
    detail: detail || (tnl ? detailForTnl(tnl, action) : action),
  });
  renderAll();
  saveSession();
  toast(tnl ? `TNL ${padTnl(tnl)} atualizada` : "Informação atualizada");
}

function setupEmoji(tnl) {
  return recordsOfTnl(state, tnl).find((record) => ["setup_active", "setup_start"].includes(record.type))?.emoji || "🔴";
}

function setSetup(tnl, mode, emoji = "🔴") {
  removeCategory(state, tnl, "setup");
  addRecord(state, {
    id: state.nextId++,
    tnl: Number(tnl),
    type: mode === "start" ? "setup_start" : "setup_active",
    displayText: `${emoji} TNL ${padTnl(tnl)} - ${mode === "start" ? "INICIAR SETUP" : "EM SETUP"}`,
    rawText: `TNL ${padTnl(tnl)} - ${mode === "start" ? "INICIAR SETUP" : "EM SETUP"}`,
    sourceSection: "decision",
    emoji,
  });
}

function setAdjustment(tnl, reason) {
  removeCategory(state, tnl, "adjustment");
  state.reasons.adjustment[String(tnl)] = reason;
  addRecord(state, {
    id: state.nextId++,
    tnl: Number(tnl),
    type: "adjustment",
    displayText: `TNL ${padTnl(tnl)} - ${reason}`,
    rawText: `TNL ${padTnl(tnl)} - ${reason}`,
    sourceSection: "decision",
    emoji: "🔴",
  });
}

function setMaintenance(tnl, reason, producing = false) {
  removeCategory(state, tnl, "maintenance");
  state.reasons.maintenance[String(tnl)] = uniqueStrings([reason]);
  ensureMaintenanceCase(state, {
    tnl,
    reason,
    sourceSection: "decision",
    originalLine: `TNL ${padTnl(tnl)} - ${reason || "MANUTENÇÃO"}`,
  });
  addRecord(state, {
    id: state.nextId++,
    tnl: Number(tnl),
    type: producing ? "maintenance_prod" : "maintenance",
    displayText: `TNL ${padTnl(tnl)} - ${reason || (producing ? "MANUTENÇÃO PRODUZINDO" : "MANUTENÇÃO")}`,
    rawText: `TNL ${padTnl(tnl)} - ${reason || "MANUTENÇÃO"}`,
    sourceSection: "decision",
    emoji: "🔴",
  });
}

function addOutcomeFuture(tnl, mode, emoji = "🔴") {
  state.futureItems = state.futureItems.filter((item) => Number(item.tnl) !== Number(tnl));
  const after = mode === "after";
  state.futureItems.push({
    id: state.nextFutureId++,
    heading: nextTurnHeading(readFields().nextShift),
    tnl: Number(tnl),
    emoji,
    displayText: `${emoji} TNL ${padTnl(tnl)} - ${after ? "RETOMAR SETUP APÓS MANUTENÇÃO" : `Setup ${readFields().nextShift}°T`}`,
    rawText: `TNL ${padTnl(tnl)} - ${after ? "RETOMAR SETUP APÓS MANUTENÇÃO" : `Setup ${readFields().nextShift}°T`}`,
    status: "kept",
    reviewed: true,
    outcome: true,
  });
  state.futureItems = sortByTnl(state.futureItems);
}

async function resolveSetupBeforeMaintenance(tnl) {
  if (!categoriesOfTnl(state, tnl).includes("setup")) return null;
  const resolution = await showChoice({
    title: `TNL ${padTnl(tnl)} · SETUP → MANUTENÇÃO`,
    subtitle: "A manutenção já foi registrada. Agora confirme o que aconteceu com o setup para não perder a sequência.",
    actions: [
      {
        value: SETUP_BEFORE_MAINTENANCE.completed,
        label: "SETUP CONCLUÍDO → ENTROU EM MANUTENÇÃO",
        tone: "success",
      },
      {
        value: SETUP_BEFORE_MAINTENANCE.resume,
        label: "SETUP INTERROMPIDO → RETOMAR APÓS MANUTENÇÃO",
        tone: "setup",
      },
      {
        value: SETUP_BEFORE_MAINTENANCE.remove,
        label: "A INFORMAÇÃO DE SETUP ESTAVA INCORRETA",
        tone: "danger",
      },
    ],
  });
  return resolution ? applySetupBeforeMaintenance(state, tnl, resolution) : false;
}

async function applyTransition({ subjectKey, tnl, target, applyTarget, action, before }) {
  const other = categoriesOfTnl(state, tnl).filter((category) => category !== target);
  let convertMaintenance = null;
  for (const category of other) {
    const done = await showChoice({
      title: `TNL ${padTnl(tnl)} — ${categoryLabel(category)}`,
      subtitle: `O ${categoryLabel(category)} foi concluído?`,
      actions: [
        { value: "yes", label: "SIM", tone: "success" },
        { value: "no", label: "NÃO", tone: "danger" },
      ],
    });
    if (!done) {
      restoreSnapshot(state, before);
      renderAll();
      return false;
    }
    if (done === "yes") {
      addCompleted(state, tnl, category);
      removeCategory(state, tnl, category);
      continue;
    }

    let options;
    if (category === "setup" && target === "maintenance") {
      options = [
        { value: "future_after", label: `SETUP ${readFields().nextShift}°T APÓS MANUTENÇÃO`, tone: "setup" },
        { value: "future_only", label: `MANTER APENAS COMO SETUP ${readFields().nextShift}°T`, tone: "setup" },
        { value: "remove", label: "REMOVER DE SETUP", tone: "danger" },
      ];
    } else if (category === "maintenance" && target === "setup") {
      options = [
        { value: "maintenance_after", label: `MANTER MANUTENÇÃO + SETUP ${readFields().nextShift}°T APÓS MANUTENÇÃO`, tone: "setup" },
        { value: "maintenance_only", label: `MANTER MANUTENÇÃO + SETUP ${readFields().nextShift}°T`, tone: "setup" },
        { value: "remove", label: "REMOVER DE MANUTENÇÃO", tone: "danger" },
      ];
    } else {
      options = [
        { value: "keep", label: `MANTER EM ${categoryLabel(category)}`, tone: "warning" },
        { value: "remove", label: `REMOVER DE ${categoryLabel(category)}`, tone: "danger" },
      ];
    }
    const residual = await showChoice({
      title: `TNL ${padTnl(tnl)} — ${categoryLabel(category)}`,
      subtitle: `O que deseja fazer com ${categoryLabel(category)}?`,
      actions: options,
    });
    if (!residual) {
      restoreSnapshot(state, before);
      renderAll();
      return false;
    }
    if (residual === "remove") removeCategory(state, tnl, category);
    if (residual === "future_after" || residual === "future_only") {
      const emoji = setupEmoji(tnl);
      removeCategory(state, tnl, "setup");
      addOutcomeFuture(tnl, residual === "future_after" ? "after" : "only", emoji);
    }
    if (residual === "maintenance_after") convertMaintenance = "after";
    if (residual === "maintenance_only") convertMaintenance = "only";
  }

  applyTarget();
  if (convertMaintenance) {
    const emoji = setupEmoji(tnl);
    removeCategory(state, tnl, "setup");
    addOutcomeFuture(tnl, convertMaintenance, emoji);
  }
  commitAndRefresh({ subjectKey, tnl, kind: subjectKey.startsWith("A:") ? "machine" : "information", action, before });
  return true;
}

async function chooseSetup(
  subjectKey,
  tnl,
  before = snapshotSubject(state, subjectKey),
  beforeApply = () => {},
) {
  const choice = await showChoice({
    title: `TNL ${padTnl(tnl)} — SETUP`,
    subtitle: "Como essa TNL vai passar para o próximo turno?",
    actions: [
      { value: "active", label: "EM SETUP", tone: "setup" },
      { value: "start", label: "INICIAR SETUP", tone: "setup" },
      { value: "future", label: `SETUP ${readFields().nextShift}°T`, tone: "info" },
      { value: "after", label: "APÓS MANUTENÇÃO", tone: "warning" },
    ],
  });
  if (!choice) return;
  if (["future", "after"].includes(choice)) {
    beforeApply();
    const emoji = setupEmoji(tnl);
    removeCategory(state, tnl, "setup");
    addOutcomeFuture(tnl, choice === "after" ? "after" : "only", emoji);
    commitAndRefresh({
      subjectKey,
      tnl,
      kind: subjectKey.startsWith("A:") ? "machine" : "information",
      action: choice === "after" ? "APÓS MANUTENÇÃO" : `SETUP ${readFields().nextShift}°T`,
      before,
    });
    return;
  }
  const emoji = setupEmoji(tnl);
  await applyTransition({
    subjectKey,
    tnl,
    target: "setup",
    before,
    applyTarget: () => {
      beforeApply();
      setSetup(tnl, choice, emoji);
    },
    action: choice === "start" ? "INICIAR SETUP" : "VAI PASSAR EM SETUP",
  });
}

async function chooseAdjustment(
  subjectKey,
  tnl,
  before = snapshotSubject(state, subjectKey),
  beforeApply = () => {},
) {
  const savedReason = state.reasons.adjustment[String(tnl)] || "";
  const reason = await askText({
    title: `Motivo do ajuste — TNL ${padTnl(tnl)}`,
    subtitle: "Informe o motivo do ajuste.",
    initial: savedReason,
  });
  if (!reason) return;
  await applyTransition({
    subjectKey,
    tnl,
    target: "adjustment",
    before,
    applyTarget: () => {
      beforeApply();
      setAdjustment(tnl, reason);
    },
    action: `VAI PASSAR EM AJUSTE — ${reason}`,
  });
}

async function finishMaintenanceDecision({
  subjectKey,
  tnl,
  reason,
  producing = false,
  before = snapshotSubject(state, subjectKey),
  beforeApply = () => {},
}) {
  const existing = maintenanceCaseOf(state, tnl) || {};
  const seed = normalizeMaintenanceCase(
    {
      ...existing,
      tnl,
      reasons: uniqueStrings([...(existing.reasons || []), reason]),
      sourceSections: uniqueStrings([
        ...(existing.sourceSections || []),
        producing ? "maintenance_prod" : "maintenance",
      ]),
      originalLines: uniqueStrings([
        ...(existing.originalLines || []),
        reason ? `TNL ${padTnl(tnl)} - ${reason}` : "",
      ]),
    },
    tnl,
  );
  const context = { subjectKey, tnl: Number(tnl), reason, producing };
  const tracking = await showMaintenanceForm(tnl, seed, context);
  if (!tracking) return false;

  let adjustmentReason = "";
  if (tracking.machineOutcome === "adjustment") {
    adjustmentReason = await askText({
      title: `Motivo do ajuste — TNL ${padTnl(tnl)}`,
      subtitle: "A máquina passou da manutenção para ajuste. Informe o motivo.",
      initial: state.reasons.adjustment[String(tnl)] || maintenanceReason(seed),
    });
    if (!adjustmentReason) return false;
  }

  const setupTransition = await resolveSetupBeforeMaintenance(tnl);
  if (setupTransition === false) return false;

  beforeApply();
  ensureMaintenanceCase(state, {
    tnl,
    reason,
    sourceSection: producing ? "maintenance_prod" : "maintenance",
    originalLine: reason ? `TNL ${padTnl(tnl)} - ${reason}` : "",
    reportedCompleted: seed.reportedCompleted,
  });
  const callOpenedShift =
    tracking.callOrigin === "current"
      ? Number(readFields().currentShift)
      : tracking.callOrigin === "previous"
        ? previousShift(readFields().currentShift)
        : null;
  updateMaintenanceCase(state, tnl, { ...tracking, callOpenedShift });
  removeRecordsOfTnl(state, tnl);
  removeCompleted(state, tnl, "maintenance");

  const closedService = ["completed", "resolved_without", "unknown"].includes(
    tracking.serviceStatus,
  );
  const activeService = ["waiting", "working"].includes(tracking.serviceStatus);
  if (activeService) {
    setMaintenance(
      tnl,
      maintenanceReason(seed),
      tracking.machineOutcome === "released",
    );
  } else if (tracking.machineOutcome === "stopped") {
    setMaintenance(tnl, maintenanceReason(seed), false);
  } else if (tracking.machineOutcome === "adjustment") {
    if (closedService || seed.reportedCompleted) addCompleted(state, tnl, "maintenance");
    removeCompleted(state, tnl, "adjustment");
    setAdjustment(tnl, adjustmentReason);
  } else if (tracking.machineOutcome === "setup") {
    if (closedService || seed.reportedCompleted) addCompleted(state, tnl, "maintenance");
    if (setupTransition?.resolution !== SETUP_BEFORE_MAINTENANCE.completed) {
      removeCompleted(state, tnl, "setup");
    }
    setSetup(
      tnl,
      setupTransition?.resumeAfterMaintenance ? setupTransition.setupMode : "active",
      setupTransition?.emoji || "🔴",
    );
  } else if (tracking.machineOutcome === "released") {
    addCompleted(state, tnl, "maintenance");
  } else if (tracking.machineOutcome === "monitoring" && closedService) {
    addCompleted(state, tnl, "maintenance");
  }
  if (setupTransition?.resumeAfterMaintenance && tracking.machineOutcome !== "setup") {
    addOutcomeFuture(tnl, "after", setupTransition.emoji);
  }

  const finalCase = maintenanceCaseOf(state, tnl);
  clearMaintenanceDraft(maintenanceDraftKey(context, tnl));
  commitAndRefresh({
    subjectKey,
    tnl,
    kind: subjectKey.startsWith("A:") ? "machine" : "information",
    action: `MANUTENÇÃO — ${MACHINE_OUTCOMES[tracking.machineOutcome]}`,
    detail: maintenanceDecisionDetail(finalCase, readFields().currentShift),
    before,
  });
  return true;
}

async function resumePendingMaintenanceDraft() {
  if (maintenanceResumeStarted || byId("maintenanceDialog").open) return;
  const draft = maintenanceDrafts[activeMaintenanceDraftKey];
  const context = draft?.context;
  const tnl = Number(draft?.tnl || context?.tnl || 0);
  if (!draft || !context || !tnl) return;
  maintenanceResumeStarted = true;
  selectedCell = cellForTnl(tnl);
  switchTab("ronda", { save: false });
  renderRound();
  saveSession();
  toast(`Rascunho da TNL ${padTnl(tnl)} restaurado`);
  const beforeApply = () => {
    if (!String(context.subjectKey || "").startsWith("D:")) return;
    const id = Number(String(context.subjectKey).slice(2));
    const item = state.devObsItems.find((entry) => Number(entry.id) === id);
    if (item) {
      item.status = "resolved";
      item.reviewed = true;
    }
  };
  try {
    await finishMaintenanceDecision({
      subjectKey: context.subjectKey || `A:${tnl}`,
      tnl,
      reason: context.reason || maintenanceReason(draft.values || {}),
      producing: Boolean(context.producing),
      before: snapshotSubject(state, context.subjectKey || `A:${tnl}`),
      beforeApply,
    });
  } finally {
    maintenanceResumeStarted = false;
  }
}

async function chooseMaintenance(
  subjectKey,
  tnl,
  producing = false,
  before = snapshotSubject(state, subjectKey),
  beforeApply = () => {},
  providedReason = "",
) {
  const initial =
    providedReason ||
    (state.reasons.maintenance[String(tnl)] || []).join(" + ") ||
    maintenanceReason(maintenanceCaseOf(state, tnl) || {}, "");
  const reason =
    providedReason ||
    (await askText({
      title: `Motivo da manutenção — TNL ${padTnl(tnl)}`,
      subtitle: "Informe o motivo da manutenção.",
      initial,
    }));
  if (!reason) return false;
  return finishMaintenanceDecision({
    subjectKey,
    tnl,
    reason,
    producing,
    before,
    beforeApply,
  });
}

async function openMachine(tnl) {
  const subjectKey = `A:${Number(tnl)}`;
  const records = recordsOfTnl(state, tnl);
  const conflict = hasConflict(state, tnl) && !state.resolvedConflicts[String(tnl)];
  const maintenanceItem = maintenanceCaseOf(state, tnl);
  const maintenanceRelated = categoriesOfTnl(state, tnl).includes("maintenance");
  const choice = await showChoice({
    title: `TNL ${padTnl(tnl)}${conflict ? " · CONFLITO" : ""}`,
    subtitle: maintenanceRelated
      ? "Registre o ciclo do chamado, a atuação da manutenção e como a máquina ficou."
      : conflict
        ? `A máquina consta em ${categoriesOfTnl(state, tnl).map(categoryLabel).join(" × ")}. Confirme o status correto.`
        : "Escolha a decisão para essa máquina.",
    source: `<div class="modal-source">${sourceBlocks(records)}</div>`,
    actions: maintenanceRelated
      ? [
          {
            value: "maintenance_followup",
            label: maintenanceActionLabel(maintenanceItem),
            tone: maintenanceItem?.reportedCompleted ? "warning" : "danger",
          },
          { value: "remove", label: "REMOVER DO RELATÓRIO", tone: "neutral" },
        ]
      : [
          { value: "adjustment", label: "VAI PASSAR EM AJUSTE", tone: "warning" },
          { value: "setup", label: "VAI PASSAR EM SETUP", tone: "setup" },
          { value: "maintenance", label: "VAI PASSAR EM MANUTENÇÃO", tone: "danger" },
          { value: "release", label: "LIBERADA", tone: "success" },
          { value: "remove", label: "REMOVER DO RELATÓRIO", tone: "neutral" },
        ],
  });
  if (!choice) return;
  const before = snapshotSubject(state, subjectKey);
  if (choice === "maintenance_followup") {
    const fallbackReason =
      (state.reasons.maintenance[String(tnl)] || []).join(" + ") ||
      records.map((record) => extractReason(record.rawText || record.displayText)).find(Boolean) ||
      "MANUTENÇÃO";
    return finishMaintenanceDecision({
      subjectKey,
      tnl,
      reason: maintenanceReason(maintenanceItem, fallbackReason),
      producing: records.some((record) => record.type === "maintenance_prod"),
      before,
    });
  }
  if (choice === "adjustment") return chooseAdjustment(subjectKey, tnl, before);
  if (choice === "setup") return chooseSetup(subjectKey, tnl, before);
  if (choice === "maintenance") return chooseMaintenance(subjectKey, tnl, false, before);
  if (choice === "release") {
    categoriesOfTnl(state, tnl).forEach((category) => addCompleted(state, tnl, category));
    removeRecordsOfTnl(state, tnl);
    commitAndRefresh({ subjectKey, tnl, kind: "machine", action: "LIBERADA", before });
  }
  if (choice === "remove") {
    removeRecordsOfTnl(state, tnl);
    removeMaintenanceCase(state, tnl);
    state.futureItems = state.futureItems.filter((item) => Number(item.tnl) !== Number(tnl));
    state.devObsItems.forEach((item) => {
      if (Number(item.tnl) === Number(tnl)) {
        item.status = "removed";
        item.reviewed = true;
        markLedger(state, `D:${item.id}`, "decided");
      }
    });
    ["maintenance", "setup", "adjustment"].forEach((category) => removeCompleted(state, tnl, category));
    commitAndRefresh({ subjectKey, tnl, kind: "machine", action: "REMOVIDA DO RELATÓRIO", before });
  }
}

async function openFuture(id) {
  const item = state.futureItems.find((future) => Number(future.id) === Number(id));
  if (!item) return;
  const subjectKey = `F:${item.id}`;
  const choice = await showChoice({
    title: `TNL ${padTnl(item.tnl)} · ${item.heading}`,
    subtitle: "Confirme se mantém ou muda a programação.",
    source: `<div class="modal-source"><p>${lineBreaks(item.rawText || item.displayText)}</p></div>`,
    actions: [
      { value: "keep", label: `MANTER PARA ${item.heading.replace("SETUPS ", "")}`, tone: "setup" },
      { value: "active", label: "EM SETUP", tone: "setup" },
      { value: "start", label: "INICIAR SETUP", tone: "setup" },
      { value: "after", label: "APÓS MANUTENÇÃO", tone: "warning" },
      { value: "remove", label: "REMOVER DO RELATÓRIO", tone: "neutral" },
    ],
  });
  if (!choice) return;
  const before = snapshotSubject(state, subjectKey);
  if (choice === "keep") {
    item.reviewed = true;
    item.status = "kept";
    commitAndRefresh({ subjectKey, tnl: item.tnl, kind: "future", action: `MANTER ${item.heading.replace("SETUPS ", "")}`, before });
    return;
  }
  if (["active", "start"].includes(choice)) {
    item.status = "removed";
    item.reviewed = true;
    setSetup(item.tnl, choice, item.emoji);
    commitAndRefresh({ subjectKey, tnl: item.tnl, kind: "future", action: choice === "start" ? "INICIAR SETUP" : "VAI PASSAR EM SETUP", before });
    return;
  }
  if (choice === "after") {
    item.displayText = `${item.emoji || "🔴"} TNL ${padTnl(item.tnl)} - Após manutenção`;
    item.rawText = item.displayText;
    item.reviewed = true;
    item.status = "kept";
    commitAndRefresh({ subjectKey, tnl: item.tnl, kind: "future", action: "APÓS MANUTENÇÃO", before });
    return;
  }
  item.status = "removed";
  item.reviewed = true;
  commitAndRefresh({ subjectKey, tnl: item.tnl, kind: "future", action: "SETUP FUTURO REMOVIDO", before });
}

async function openDevObs(id) {
  const item = state.devObsItems.find((info) => Number(info.id) === Number(id));
  if (!item) return;
  const subjectKey = `D:${item.id}`;
  const development = item.kind === "development";
  const choice = await showChoice({
    title: `TNL ${padTnl(item.tnl)} · ${development ? "DESENVOLVIMENTO" : "OBSERVAÇÃO"}`,
    subtitle: "Decida como essa informação deve seguir para o próximo turno.",
    source: `<div class="modal-source"><p>${lineBreaks(item.rawText || item.displayText)}</p></div>`,
    actions: [
      { value: "keep", label: development ? "MANTER DESENVOLVIMENTO" : "MANTER OBSERVAÇÃO", tone: "info" },
      { value: "resolve", label: development ? "JÁ VOLTOU PARA O CNC" : "OBSERVAÇÃO RESOLVIDA", tone: "success" },
      { value: "adjustment", label: "VAI PASSAR EM AJUSTE", tone: "warning" },
      { value: "setup", label: "VAI PASSAR EM SETUP", tone: "setup" },
      { value: "maintenance", label: "VAI PASSAR EM MANUTENÇÃO", tone: "danger" },
      { value: "remove", label: "REMOVER DO RELATÓRIO", tone: "neutral" },
    ],
  });
  if (!choice) return;
  const before = snapshotSubject(state, subjectKey);
  if (choice === "keep") {
    item.status = "kept";
    item.reviewed = true;
    commitAndRefresh({ subjectKey, tnl: item.tnl, kind: "devobs", action: development ? "MANTER DESENVOLVIMENTO" : "MANTER OBSERVAÇÃO", before });
    return;
  }
  if (["resolve", "remove"].includes(choice)) {
    item.status = choice === "resolve" ? "resolved" : "removed";
    item.reviewed = true;
    commitAndRefresh({
      subjectKey,
      tnl: item.tnl,
      kind: "devobs",
      action:
        choice === "remove"
          ? development
            ? "DESENVOLVIMENTO REMOVIDO"
            : "OBSERVAÇÃO REMOVIDA"
          : development
            ? "JÁ VOLTOU PARA O CNC"
            : "OBSERVAÇÃO RESOLVIDA",
      before,
    });
    return;
  }
  const consume = () => {
    item.status = "resolved";
    item.reviewed = true;
  };
  if (choice === "adjustment") return chooseAdjustment(subjectKey, item.tnl, before, consume);
  if (choice === "setup") return chooseSetup(subjectKey, item.tnl, before, consume);
  return chooseMaintenance(subjectKey, item.tnl, false, before, consume);
}

async function openGeneral(id) {
  const item = state.generalInfoItems.find((info) => Number(info.id) === Number(id));
  if (!item) return;
  const subjectKey = `G:${item.id}`;
  const choice = await showChoice({
    title: item.kind === "development" ? "DESENVOLVIMENTO GERAL" : "OBSERVAÇÃO GERAL",
    subtitle: "Essa informação sem TNL deve permanecer no relatório final?",
    source: `<div class="modal-source"><p>${lineBreaks(item.rawText || item.text)}</p></div>`,
    actions: [
      { value: "keep", label: "MANTER NO RELATÓRIO", tone: "success" },
      { value: "remove", label: "REMOVER DO RELATÓRIO", tone: "neutral" },
    ],
  });
  if (!choice) return;
  const before = snapshotSubject(state, subjectKey);
  item.reviewed = true;
  item.status = choice === "keep" ? "kept" : "removed";
  commitAndRefresh({
    subjectKey,
    kind: "general",
    action: choice === "keep" ? "MANTER NO RELATÓRIO" : "REMOVER DO RELATÓRIO",
    detail: item.rawText || item.text,
    before,
    general: true,
  });
}

function appendInfoField(kind, line) {
  const field = byId(kind === "development" ? "development" : "observations");
  const lines = field.value
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value && value.toUpperCase() !== "N/A");
  if (!lines.some((value) => cleanLine(value).toLowerCase() === cleanLine(line).toLowerCase())) lines.push(line);
  field.value = lines.join("\n");
}

async function saveManualMachine() {
  const tnl = Number(String(byId("addMachine").value).replace(/\D/g, ""));
  const status = byId("addStatus").value;
  const reason = byId("addReason").value.trim();
  if (!Number.isInteger(tnl) || tnl < 1 || tnl > 999) {
    toast("Informe uma TNL válida");
    return false;
  }
  if (["development", "observation"].includes(status)) {
    appendInfoField(status, `TNL ${padTnl(tnl)} - ${reason || (status === "development" ? "DESENVOLVIMENTO" : "OBSERVAÇÃO")}`);
    rebuildInfoFromFields(state, byId("development").value, byId("observations").value);
    selectedCell = cellForTnl(tnl);
    renderAll();
    saveSession();
    toast(`${status === "development" ? "Desenvolvimento" : "Observação"} adicionada para decisão`);
    return true;
  }

  if (status === "setup_future") {
    const item = {
      id: state.nextFutureId++,
      heading: nextTurnHeading(readFields().nextShift),
      tnl,
      emoji: "🔴",
      displayText: `🔴 TNL ${padTnl(tnl)} - Setup ${readFields().nextShift}°T`,
      rawText: `TNL ${padTnl(tnl)} - Setup ${readFields().nextShift}°T`,
      status: "pending",
      reviewed: false,
    };
    state.futureItems.push(item);
    registerLedger(state, { key: `F:${item.id}`, kind: "future", tnl, cell: cellForTnl(tnl) });
    const before = snapshotSubject(state, `F:${item.id}`);
    item.status = "kept";
    item.reviewed = true;
    selectedCell = cellForTnl(tnl);
    commitAndRefresh({ subjectKey: `F:${item.id}`, tnl, kind: "future", action: `SETUP ${readFields().nextShift}°T`, before });
    return true;
  }

  const subjectKey = `A:${tnl}`;
  if (!state.roundLedger.some((entry) => entry.key === subjectKey)) {
    addRecord(state, {
      id: state.nextId++,
      tnl,
      type: "manual_pending",
      displayText: `TNL ${padTnl(tnl)} - REDEFINIR STATUS`,
      rawText: `TNL ${padTnl(tnl)} - Nova informação durante a ronda`,
      sourceSection: "manual_pending",
      emoji: "🔴",
    });
    registerLedger(state, { key: subjectKey, kind: "machine", tnl, cell: cellForTnl(tnl) });
  }
  selectedCell = cellForTnl(tnl);
  const before = snapshotSubject(state, subjectKey);
  if (status === "adjustment") {
    if (reason) {
      await applyTransition({ subjectKey, tnl, target: "adjustment", before, applyTarget: () => setAdjustment(tnl, reason), action: `VAI PASSAR EM AJUSTE — ${reason}` });
    } else await chooseAdjustment(subjectKey, tnl, before);
    return true;
  }
  if (["maintenance", "maintenance_prod"].includes(status)) {
    return Boolean(
      await chooseMaintenance(
        subjectKey,
        tnl,
        status === "maintenance_prod",
        before,
        () => {},
        reason,
      ),
    );
  }
  await applyTransition({
    subjectKey,
    tnl,
    target: "setup",
    before,
    applyTarget: () => setSetup(tnl, status === "setup_start" ? "start" : "active"),
    action: status === "setup_start" ? "INICIAR SETUP" : "VAI PASSAR EM SETUP",
  });
  return true;
}

async function copyReport() {
  const metrics = kpis(state);
  if (metrics.conflicts) {
    toast(`Resolva ${metrics.conflicts} conflito(s) antes de copiar`);
    return;
  }
  if (metrics.pending && !window.confirm(`Ainda existem ${metrics.pending} pendência(s). Deseja copiar mesmo assim?`)) return;
  const report = generateReport(state, readFields());
  let copied = false;
  try {
    await navigator.clipboard.writeText(report);
    copied = true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = report;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    copied = document.execCommand("copy");
    textarea.remove();
  }
  if (!copied) {
    toast("Não foi possível copiar o relatório");
    return;
  }
  toast("Relatório copiado");
  const result = await syncCloud({
    state,
    fields: readFields(),
    report,
    trigger: "copiar_relatorio",
  });
  saveSession();
  if (result.ok) toast("Relatório copiado e histórico salvo");
  else toast("Relatório copiado; histórico ficou pendente");
}

function importCurrentReport() {
  const raw = byId("rawInput").value.trim();
  if (!raw) {
    toast("Cole o relatório do grupo antes de preparar a passagem");
    return;
  }
  if (
    state.roundLedger.length &&
    !window.confirm("Preparar novamente substituirá as decisões atuais. Deseja continuar?")
  ) {
    return;
  }
  const parsed = parseReport({
    raw,
    development: byId("development").value,
    observations: byId("observations").value,
    currentShift: readFields().currentShift,
    nextShift: readFields().nextShift,
  });
  state = parsed.state;
  maintenanceDrafts = {};
  activeMaintenanceDraftKey = "";
  state.cloudPassageId = null;
  byId("development").value = parsed.development;
  byId("observations").value = parsed.observations;
  selectedCell = visibleCells(state).find((cell) => progressForCell(state, cell).pending) || "01";
  renderAll();
  switchTab("ronda", { save: false });
  saveSession();
  toast("Relatório importado");
}

function clearSession() {
  if (!window.confirm("Deseja limpar toda a sessão?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = createEmptyState();
  maintenanceDrafts = {};
  activeMaintenanceDraftKey = "";
  selectedCell = "01";
  activeTab = "dados";
  byId("rawInput").value = "";
  applyFields(DEFAULT_FIELDS);
  renderAll();
  switchTab("dados", { save: false });
  toast("Sessão limpa");
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) =>
    button.addEventListener("click", () => switchTab(button.dataset.tab, { userInitiated: true })),
  );
  byId("btnGoReport").addEventListener("click", () => switchTab("relatorio", { userInitiated: true }));
  byId("btnBackRonda").addEventListener("click", () => switchTab("ronda"));
  byId("btnBackDados").addEventListener("click", () => switchTab("dados"));
  byId("btnImport").addEventListener("click", importCurrentReport);
  byId("btnClear").addEventListener("click", clearSession);
  byId("btnCopy").addEventListener("click", copyReport);
  byId("btnCopyFloating").addEventListener("click", copyReport);
  byId("btnUndo").addEventListener("click", () => {
    if (!undoLastAction(state)) {
      toast("Nenhuma ação para desfazer");
      return;
    }
    renderAll();
    saveSession();
    toast("Última ação desfeita");
  });

  byId("cellSelect").addEventListener("change", (event) => {
    selectedCell = event.target.value;
    renderRound();
    saveSession();
  });
  byId("cellOverview").addEventListener("click", (event) => {
    const button = event.target.closest("[data-cell]");
    if (!button) return;
    selectedCell = button.dataset.cell;
    renderRound();
    saveSession();
  });
  byId("machineList").addEventListener("click", (event) => {
    const card = event.target.closest("[data-kind][data-value]");
    if (!card) return;
    const handlers = { machine: openMachine, future: openFuture, devobs: openDevObs, general: openGeneral };
    handlers[card.dataset.kind]?.(Number(card.dataset.value));
  });
  byId("confirmedList").addEventListener("click", async (event) => {
    const maintenanceButton = event.target.closest("[data-update-maintenance]");
    if (maintenanceButton) {
      const key = maintenanceButton.dataset.updateMaintenance;
      const decision = state.confirmedDecisions[key];
      const tnl = Number(decision?.tnl || 0);
      const item = maintenanceCaseOf(state, tnl);
      if (!tnl || !item) {
        toast("Acompanhamento de manutenção não encontrado");
        return;
      }
      await finishMaintenanceDecision({
        subjectKey: key,
        tnl,
        reason: maintenanceReason(item),
        producing: recordsOfTnl(state, tnl).some((record) => record.type === "maintenance_prod"),
        before: snapshotSubject(state, key),
      });
      return;
    }
    const button = event.target.closest("[data-reopen]");
    if (!button) return;
    const key = button.dataset.reopen;
    const choice = await showChoice({
      title: "Reeditar decisão",
      subtitle: "A decisão anterior será desfeita e o item voltará para a conferência.",
      actions: [{ value: "reopen", label: "REABRIR PARA DECISÃO", tone: "warning" }],
    });
    if (choice !== "reopen") return;
    if (reopenDecision(state, key)) {
      renderAll();
      saveSession();
      toast("Decisão reaberta");
    }
  });

  byId("decisionActions").addEventListener("click", (event) => {
    const button = event.target.closest("[data-choice]");
    if (button) closeChoice(button.dataset.choice);
  });
  byId("decisionCancel").addEventListener("click", () => closeChoice(null));
  byId("decisionDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    closeChoice(null);
  });
  byId("textDialogForm").addEventListener("submit", (event) => {
    if (event.submitter?.value === "save" && !byId("textDialogInput").value.trim()) {
      event.preventDefault();
      toast("Digite o motivo");
      byId("textDialogInput").focus();
    }
  });
  byId("maintenanceForm").addEventListener("click", (event) => {
    const choice = event.target.closest("[data-maintenance-choice]");
    if (choice) {
      const fieldId = choice.dataset.maintenanceChoice;
      const value = choice.dataset.value;
      setMaintenanceChoice(fieldId, value);
      if (fieldId === "maintenanceTractianStatus") {
        byId("maintenanceTractianCode").value = "";
      }
      updateMaintenanceFormVisibility();
      byId("maintenanceFormError").textContent = "";
      queueMaintenanceDraftSave();
      return;
    }
    const timeMode = event.target.closest("[data-time-mode-target]");
    if (timeMode) {
      const inputId = timeMode.dataset.timeModeTarget;
      const mode = timeMode.dataset.timeMode;
      setTimeMode(inputId, mode);
      if (inputId === "maintenanceArrivedAt" && mode === "not_arrived") {
        setTimeMode("maintenanceFinishedAt", "", { save: false });
      }
      updateMaintenanceFormVisibility();
      if (mode === "manual") {
        const input = byId(inputId);
        input.focus();
        try {
          input.showPicker?.();
        } catch {}
      }
      return;
    }
    const shift = event.target.closest("[data-shift-target]");
    if (shift) {
      setMaintenanceShift(shift.dataset.shiftTarget, shift.dataset.shift);
      byId("maintenanceFormError").textContent = "";
      queueMaintenanceDraftSave();
    }
  });
  byId("maintenanceForm").addEventListener("input", (event) => {
    const target = event.target;
    if (target.id === "maintenanceTractianCode") {
      target.value = target.value.replace(/\D/g, "").slice(0, 12);
      setMaintenanceChoice(
        "maintenanceTractianStatus",
        target.value ? "informed" : byId("maintenanceTractianStatus").value === "informed" ? "" : byId("maintenanceTractianStatus").value,
      );
      updateMaintenanceFormVisibility();
    }
    if (MAINTENANCE_TIME_FIELDS[target.id]) {
      target.dataset.timeMode = "manual";
      byId(MAINTENANCE_TIME_FIELDS[target.id].unknown).checked = false;
      const shiftStartId = MAINTENANCE_TIME_FIELDS[target.id].shiftStart;
      if (shiftStartId) byId(shiftStartId).checked = false;
      if (MAINTENANCE_TIME_FIELDS[target.id].shift) {
        setMaintenanceShift(
          MAINTENANCE_TIME_FIELDS[target.id].shift,
          Number(readFields().currentShift),
        );
      }
      renderTimeMode(target.id);
      updateMaintenanceFormVisibility();
    }
    byId("maintenanceFormError").textContent = "";
    queueMaintenanceDraftSave();
  });
  byId("maintenanceForm").addEventListener("change", () => {
    updateMaintenanceFormVisibility();
    queueMaintenanceDraftSave();
  });
  byId("maintenanceDialog").addEventListener("scroll", queueMaintenanceDraftSave, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushMaintenanceDraft();
  });
  window.addEventListener("pagehide", flushMaintenanceDraft);

  byId("btnOpenAdd").addEventListener("click", () => {
    byId("addMachine").value = "";
    byId("addReason").value = "";
    byId("addStatus").value = "adjustment";
    byId("addDialog").returnValue = "";
    byId("addDialog").showModal();
    setTimeout(() => byId("addMachine").focus(), 80);
  });
  byId("addForm").addEventListener("submit", async (event) => {
    if (event.submitter?.value !== "save") return;
    event.preventDefault();
    const tnl = Number(String(byId("addMachine").value).replace(/\D/g, ""));
    if (!Number.isInteger(tnl) || tnl < 1 || tnl > 999) {
      toast("Informe uma TNL válida");
      byId("addMachine").focus();
      return;
    }
    byId("addDialog").close("save");
    const saved = await saveManualMachine();
    if (!saved) toast("Não foi possível adicionar a máquina");
  });

  byId("currentShift").addEventListener("change", () => {
    enforceShiftPair("current");
    renderReport();
    saveSession();
  });
  byId("nextShift").addEventListener("change", () => {
    enforceShiftPair("next");
    renderReport();
    saveSession();
  });
  ["checkpoint", "cqFechamento", "cqReinspecao", "sel1", "sel2", "sel3", "selAll", "selTnc"].forEach(
    (id) => byId(id).addEventListener("input", () => {
      renderReport();
      saveSession();
    }),
  );
  byId("rawInput").addEventListener("input", saveSession);
  ["development", "observations"].forEach((id) =>
    byId(id).addEventListener("change", () => {
      rebuildInfoFromFields(state, byId("development").value, byId("observations").value);
      renderAll();
      saveSession();
    }),
  );
}

function init() {
  initTheme();
  const restored = restoreSession();
  bindEvents();
  renderAll();
  switchTab(activeTab, { save: false });
  initAccess();
  if (restored) toast(`Sessão restaurada · v${APP_VERSION}`);
}

init();
