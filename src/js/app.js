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
      JSON.stringify({ version: 1, state, fields: readFields(), selectedCell, activeTab }),
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
    if (!records.length) return "";
    const conflict = hasConflict(state, entry.tnl) && !state.resolvedConflicts[String(entry.tnl)];
    const first = records[0]?.type;
    const config = conflict ? { short: "CONFLITO", tone: "danger" } : TYPE_CONFIG[first] || { short: "PENDÊNCIA", tone: "warning" };
    return roundCard({
      key: entry.key,
      kind: "machine",
      value: entry.tnl,
      title: `TNL ${padTnl(entry.tnl)}`,
      badge: config.short,
      tone: config.tone,
      source: sourceBlocks(records),
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
          return `<details class="confirmed-item"><summary><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(decision.action)} · ${escapeHtml(decision.time)}</small></span></summary><div class="confirmed-detail"><p>${lineBreaks(decision.detail)}</p><button class="btn btn-soft btn-small" type="button" data-reopen="${escapeHtml(decision.key)}">REEDITAR</button></div></details>`;
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
    displayText: `${emoji} TNL ${padTnl(tnl)} - ${after ? "Após manutenção" : `Setup ${readFields().nextShift}°T`}`,
    rawText: `TNL ${padTnl(tnl)} - ${after ? "Após manutenção" : `Setup ${readFields().nextShift}°T`}`,
    status: "kept",
    reviewed: true,
    outcome: true,
  });
  state.futureItems = sortByTnl(state.futureItems);
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

async function chooseMaintenance(
  subjectKey,
  tnl,
  producing = false,
  before = snapshotSubject(state, subjectKey),
  beforeApply = () => {},
) {
  const initial = (state.reasons.maintenance[String(tnl)] || []).join(" + ");
  const reason = await askText({
    title: `Motivo da manutenção — TNL ${padTnl(tnl)}`,
    subtitle: "Informe o motivo da manutenção.",
    initial,
  });
  if (!reason) return;
  await applyTransition({
    subjectKey,
    tnl,
    target: "maintenance",
    before,
    applyTarget: () => {
      beforeApply();
      setMaintenance(tnl, reason, producing);
    },
    action: producing ? `MANUTENÇÃO PRODUZINDO — ${reason}` : `VAI PASSAR EM MANUTENÇÃO — ${reason}`,
  });
}

async function openMachine(tnl) {
  const subjectKey = `A:${Number(tnl)}`;
  const records = recordsOfTnl(state, tnl);
  const conflict = hasConflict(state, tnl) && !state.resolvedConflicts[String(tnl)];
  const choice = await showChoice({
    title: `TNL ${padTnl(tnl)}${conflict ? " · CONFLITO" : ""}`,
    subtitle: conflict
      ? `A máquina consta em ${categoriesOfTnl(state, tnl).map(categoryLabel).join(" × ")}. Confirme o status correto.`
      : "Escolha a decisão para essa máquina.",
    source: `<div class="modal-source">${sourceBlocks(records)}</div>`,
    actions: [
      { value: "adjustment", label: "VAI PASSAR EM AJUSTE", tone: "warning" },
      { value: "setup", label: "VAI PASSAR EM SETUP", tone: "setup" },
      { value: "maintenance", label: "VAI PASSAR EM MANUTENÇÃO", tone: "danger" },
      { value: "release", label: "LIBERADA", tone: "success" },
      { value: "remove", label: "REMOVER DO RELATÓRIO", tone: "neutral" },
    ],
  });
  if (!choice) return;
  const before = snapshotSubject(state, subjectKey);
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
    if (reason) {
      await applyTransition({ subjectKey, tnl, target: "maintenance", before, applyTarget: () => setMaintenance(tnl, reason, status === "maintenance_prod"), action: status === "maintenance_prod" ? `MANUTENÇÃO PRODUZINDO — ${reason}` : `VAI PASSAR EM MANUTENÇÃO — ${reason}` });
    } else await chooseMaintenance(subjectKey, tnl, status === "maintenance_prod", before);
    return true;
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
    nextShift: readFields().nextShift,
  });
  state = parsed.state;
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
