import { normalizeText, padTnl, uniqueStrings } from "./utils.js";

export const INITIATION_MODES = Object.freeze({
  production: "PRODUÇÃO ABRIU CHAMADO",
  maintenance: "MANUTENÇÃO INICIOU DIRETAMENTE",
  pending: "AINDA NÃO INICIOU / SEM CHAMADO",
  unknown: "ORIGEM NÃO CONFIRMADA",
});

export const TRACTIAN_STATUSES = Object.freeze({
  informed: "CÓDIGO INFORMADO",
  none: "NÃO POSSUI CÓDIGO",
  not_found: "CÓDIGO NÃO LOCALIZADO",
});

export const CALL_ORIGINS = Object.freeze({
  previous: "TURNO ANTERIOR",
  current: "NOSSO TURNO",
  not_opened: "CHAMADO NÃO ABERTO",
  unknown: "NÃO CONFIRMADO",
});

export const SERVICE_STATUSES = Object.freeze({
  waiting: "MANUTENÇÃO AINDA NÃO CHEGOU",
  working: "MANUTENÇÃO ESTÁ ATUANDO",
  completed: "ATENDIMENTO FINALIZADO",
  resolved_without: "RESOLVIDO SEM MANUTENÇÃO",
  unknown: "ATENDIMENTO NÃO CONFIRMADO",
});

export const MACHINE_OUTCOMES = Object.freeze({
  released: "LIBERADA",
  monitoring: "EM ACOMPANHAMENTO",
  stopped: "CONTINUA PARADA",
  adjustment: "PASSOU PARA AJUSTE",
  setup: "PASSOU PARA SETUP",
});

const CALL_ORIGIN_KEYS = Object.freeze(Object.keys(CALL_ORIGINS));
const INITIATION_MODE_KEYS = Object.freeze(Object.keys(INITIATION_MODES));
const TRACTIAN_STATUS_KEYS = Object.freeze(Object.keys(TRACTIAN_STATUSES));
const SERVICE_STATUS_KEYS = Object.freeze(Object.keys(SERVICE_STATUSES));
const MACHINE_OUTCOME_KEYS = Object.freeze(Object.keys(MACHINE_OUTCOMES));

function allowed(value, values) {
  return values.includes(String(value || "")) ? String(value) : "";
}

export function previousShift(currentShift) {
  const current = Number(currentShift || 2);
  return current === 1 ? 3 : current === 2 ? 1 : 2;
}

export function clockNow(date = new Date()) {
  return date.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

export function minutesBetweenTimes(start, end) {
  const parse = (value) => {
    const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  };
  const from = parse(start);
  const to = parse(end);
  if (from == null || to == null) return null;
  const difference = to - from;
  return difference < 0 ? difference + 24 * 60 : difference;
}

export function normalizeMaintenanceCase(value = {}, tnl = value?.tnl) {
  const machine = Number(tnl || value?.tnl || 0);
  const callOrigin = allowed(value?.callOrigin, CALL_ORIGIN_KEYS);
  const legacyInitiationMode = ["previous", "current"].includes(callOrigin)
    ? "production"
    : callOrigin === "not_opened"
      ? "pending"
      : callOrigin === "unknown"
        ? "unknown"
        : "";
  const tractianCode = String(value?.tractianCode || "").replace(/\D/g, "").slice(0, 12);
  return {
    tnl: machine,
    reasons: uniqueStrings(value?.reasons || []),
    sourceSections: uniqueStrings(value?.sourceSections || []),
    originalLines: uniqueStrings(value?.originalLines || []),
    reportedCompleted: Boolean(value?.reportedCompleted),
    initiationMode:
      allowed(value?.initiationMode, INITIATION_MODE_KEYS) || legacyInitiationMode,
    tractianCode,
    tractianStatus: tractianCode
      ? "informed"
      : allowed(value?.tractianStatus, TRACTIAN_STATUS_KEYS),
    callOrigin,
    callOpenedShift: [1, 2, 3].includes(Number(value?.callOpenedShift))
      ? Number(value.callOpenedShift)
      : null,
    callOpenedAt: String(value?.callOpenedAt || ""),
    callOpenedUnknown: Boolean(value?.callOpenedUnknown),
    serviceStatus: allowed(value?.serviceStatus, SERVICE_STATUS_KEYS),
    arrivedShift: [1, 2, 3].includes(Number(value?.arrivedShift))
      ? Number(value.arrivedShift)
      : null,
    arrivedAt: String(value?.arrivedAt || ""),
    arrivedUnknown: Boolean(value?.arrivedUnknown),
    finishedShift: [1, 2, 3].includes(Number(value?.finishedShift))
      ? Number(value.finishedShift)
      : null,
    finishedAt: String(value?.finishedAt || ""),
    finishedUnknown: Boolean(value?.finishedUnknown),
    machineOutcome: allowed(value?.machineOutcome, MACHINE_OUTCOME_KEYS),
    monitoringDetails: String(value?.monitoringDetails || "").trim(),
    details: String(value?.details || "").trim(),
    reviewed: Boolean(value?.reviewed),
    updatedAt: value?.updatedAt || null,
  };
}

export function normalizeMaintenanceCases(cases = {}) {
  return Object.fromEntries(
    Object.entries(cases || {})
      .map(([key, value]) => {
        const item = normalizeMaintenanceCase(value, Number(value?.tnl || key));
        return item.tnl ? [String(item.tnl), item] : null;
      })
      .filter(Boolean),
  );
}

export function maintenanceRoundDefaults(value = {}, { producing = false } = {}) {
  const item = normalizeMaintenanceCase(value);
  if (item.reportedCompleted && !item.reviewed) {
    return normalizeMaintenanceCase({
      ...item,
      serviceStatus: "completed",
      machineOutcome: "released",
    });
  }
  if (
    !producing &&
    ["waiting", "working"].includes(item.serviceStatus) &&
    !item.machineOutcome
  ) {
    return normalizeMaintenanceCase({ ...item, machineOutcome: "stopped" });
  }
  return item;
}

export function maintenanceCaseOf(state, tnl) {
  const value = state?.maintenanceCases?.[String(Number(tnl))];
  return value ? normalizeMaintenanceCase(value, tnl) : null;
}

export function ensureMaintenanceCase(
  state,
  { tnl, reason = "", sourceSection = "", originalLine = "", reportedCompleted = false } = {},
) {
  if (!state.maintenanceCases || typeof state.maintenanceCases !== "object") {
    state.maintenanceCases = {};
  }
  const key = String(Number(tnl));
  const current = normalizeMaintenanceCase(state.maintenanceCases[key] || {}, Number(tnl));
  const merged = normalizeMaintenanceCase(
    {
      ...current,
      reasons: uniqueStrings([...current.reasons, reason]),
      sourceSections: uniqueStrings([...current.sourceSections, sourceSection]),
      originalLines: uniqueStrings([...current.originalLines, originalLine]),
      reportedCompleted: current.reportedCompleted || Boolean(reportedCompleted),
    },
    Number(tnl),
  );
  state.maintenanceCases[key] = merged;
  return merged;
}

export function updateMaintenanceCase(state, tnl, update, now = new Date()) {
  const current = ensureMaintenanceCase(state, { tnl });
  const next = normalizeMaintenanceCase(
    {
      ...current,
      ...update,
      reasons: uniqueStrings([...(current.reasons || []), ...(update?.reasons || [])]),
      sourceSections: uniqueStrings([
        ...(current.sourceSections || []),
        ...(update?.sourceSections || []),
      ]),
      originalLines: uniqueStrings([
        ...(current.originalLines || []),
        ...(update?.originalLines || []),
      ]),
      reportedCompleted: current.reportedCompleted || Boolean(update?.reportedCompleted),
      reviewed: true,
      updatedAt: now.toISOString(),
    },
    tnl,
  );
  state.maintenanceCases[String(Number(tnl))] = next;
  return next;
}

export function removeMaintenanceCase(state, tnl) {
  if (state?.maintenanceCases) delete state.maintenanceCases[String(Number(tnl))];
}

function hasTimeOrUnknown(value, unknown) {
  return minutesBetweenTimes(value, value) != null || Boolean(unknown);
}

export function validateMaintenanceUpdate(value) {
  const item = normalizeMaintenanceCase(value);
  const errors = [];
  if (!item.initiationMode) errors.push("Informe como a manutenção começou.");
  if (item.initiationMode === "production" && !["previous", "current"].includes(item.callOrigin)) {
    errors.push("Informe em qual turno a produção abriu o chamado.");
  }
  if (
    item.initiationMode === "production" &&
    item.callOrigin === "current" &&
    !hasTimeOrUnknown(item.callOpenedAt, item.callOpenedUnknown)
  ) {
    errors.push("Informe o horário de abertura ou marque como não informado.");
  }
  if (
    ["production", "maintenance"].includes(item.initiationMode) &&
    !item.tractianStatus
  ) {
    errors.push("Informe o código Tractian ou selecione uma das alternativas.");
  }
  if (item.tractianStatus === "informed" && !item.tractianCode) {
    errors.push("Informe os números do código Tractian.");
  }
  if (!item.serviceStatus) errors.push("Informe a situação da manutenção.");
  if (
    ["working", "completed"].includes(item.serviceStatus) &&
    !hasTimeOrUnknown(item.arrivedAt, item.arrivedUnknown)
  ) {
    errors.push("Informe o horário de início da atuação ou marque como não informado.");
  }
  if (
    ["working", "completed"].includes(item.serviceStatus) &&
    item.arrivedAt &&
    !item.arrivedShift
  ) {
    errors.push("Informe em qual turno a atuação começou.");
  }
  if (
    item.serviceStatus === "completed" &&
    !hasTimeOrUnknown(item.finishedAt, item.finishedUnknown)
  ) {
    errors.push("Informe o horário de término ou marque como não informado.");
  }
  if (item.serviceStatus === "completed" && item.finishedAt && !item.finishedShift) {
    errors.push("Informe em qual turno a atuação terminou.");
  }
  if (!item.machineOutcome) errors.push("Informe como a máquina ficou.");
  if (
    ["waiting", "working"].includes(item.serviceStatus) &&
    !["monitoring", "stopped"].includes(item.machineOutcome)
  ) {
    errors.push("Enquanto o atendimento não terminou, a máquina deve ficar em acompanhamento ou parada.");
  }
  if (item.machineOutcome === "monitoring" && !item.monitoringDetails) {
    errors.push("Informe o que precisa ser acompanhado.");
  }
  return { valid: errors.length === 0, errors, value: item };
}

function shiftTime(shift, time, unknown, fallback = "horário não informado") {
  if (time) return `${shift ? `${shift}º turno às ` : "às "}${time}`;
  if (unknown) return fallback;
  return fallback;
}

export function maintenanceTrackingLines(item, currentShift) {
  const value = normalizeMaintenanceCase(item);
  if (!value.reviewed) {
    return value.reportedCompleted
      ? ["Conclusão informada pelo preparador; falta registrar origem e horários."]
      : [];
  }

  const lines = [];
  if (value.initiationMode === "production" && value.callOrigin === "previous") {
    lines.push(`Chamado aberto pelo ${value.callOpenedShift || previousShift(currentShift)}º turno.`);
  } else if (value.initiationMode === "production" && value.callOrigin === "current") {
    const openedShift = value.callOpenedShift || Number(currentShift);
    lines.push(
      value.callOpenedAt
        ? `Chamado aberto pelo ${openedShift}º turno às ${value.callOpenedAt}.`
        : `Chamado aberto pelo ${openedShift}º turno; horário não informado.`,
    );
  } else if (value.initiationMode === "maintenance") {
    lines.push("Intervenção iniciada pela própria manutenção.");
  } else if (value.initiationMode === "pending") {
    lines.push("Chamado ainda não foi aberto e a manutenção não iniciou.");
  } else {
    lines.push("Origem do atendimento não confirmada.");
  }

  if (value.tractianStatus === "informed" && value.tractianCode) {
    lines.push(`Chamado Tractian: #${value.tractianCode}.`);
  } else if (value.tractianStatus === "none") {
    lines.push("Sem código Tractian.");
  } else if (value.tractianStatus === "not_found") {
    lines.push("Código Tractian não localizado.");
  }

  if (value.serviceStatus === "waiting") {
    lines.push("Manutenção ainda não chegou ou não iniciou a atuação.");
  } else if (value.serviceStatus === "working") {
    lines.push(`Início da atuação: ${shiftTime(value.arrivedShift, value.arrivedAt, value.arrivedUnknown)}.`);
    lines.push(`Continuava em manutenção no fechamento do ${Number(currentShift)}º turno.`);
  } else if (value.serviceStatus === "completed") {
    lines.push(`Início da atuação: ${shiftTime(value.arrivedShift, value.arrivedAt, value.arrivedUnknown)}.`);
    lines.push(`Liberação da manutenção: ${shiftTime(value.finishedShift, value.finishedAt, value.finishedUnknown)}.`);
  } else if (value.serviceStatus === "resolved_without") {
    lines.push("Problema resolvido sem atuação da manutenção.");
  } else {
    lines.push("Situação do atendimento não confirmada.");
  }

  lines.push(`Como ficou: ${MACHINE_OUTCOMES[value.machineOutcome] || "NÃO CONFIRMADA"}.`);
  if (value.monitoringDetails) lines.push(`Acompanhar: ${value.monitoringDetails}`);
  if (value.details) lines.push(`Detalhes da atuação: ${value.details}`);
  return lines;
}

export function maintenanceReason(item, fallback = "MANUTENÇÃO") {
  return uniqueStrings(item?.reasons || []).join(" + ") || fallback;
}

export function maintenanceReportEntry(item, currentShift, { completed = false } = {}) {
  const value = normalizeMaintenanceCase(item);
  return `${maintenanceSummaryEntry(value, { completed })}${
    maintenanceTrackingLines(value, currentShift).length
      ? `\n${maintenanceTrackingLines(value, currentShift).join("\n")}`
      : ""
  }`;
}

export function maintenanceSummaryEntry(item, { completed = false } = {}) {
  const value = normalizeMaintenanceCase(item);
  const prefix = completed ? "✅ " : "";
  return `${prefix}TNL ${padTnl(value.tnl)} - ${maintenanceReason(value)}`;
}

export function maintenanceTrackingReportEntry(item, currentShift) {
  const value = normalizeMaintenanceCase(item);
  const lines = maintenanceTrackingLines(value, currentShift);
  if (!lines.length) return "";
  return [
    `*${maintenanceSummaryEntry(value)}*`,
    ...lines,
  ].join("\n");
}

export function maintenanceDecisionDetail(item, currentShift) {
  const value = normalizeMaintenanceCase(item);
  return [
    `TNL ${padTnl(value.tnl)} - ${maintenanceReason(value)}`,
    ...maintenanceTrackingLines(value, currentShift),
  ].join("\n");
}

export function maintenanceReportBucket(item) {
  const value = normalizeMaintenanceCase(item);
  if (!value.reviewed) {
    if (value.sourceSections.includes("maintenance_monitoring")) return "monitoring";
    return value.reportedCompleted ? "completed" : "active";
  }
  if (value.machineOutcome === "monitoring") return "monitoring";
  if (value.machineOutcome === "stopped") return "stopped";
  if (["released", "adjustment", "setup"].includes(value.machineOutcome)) return "completed";
  return value.reportedCompleted ? "completed" : "active";
}

export function maintenanceActionLabel(item) {
  const value = normalizeMaintenanceCase(item || {});
  return value.reportedCompleted && !value.reviewed
    ? "REGISTRAR HORÁRIOS DA MANUTENÇÃO"
    : "ATUALIZAR ACOMPANHAMENTO DA MANUTENÇÃO";
}

function relativeCallOrigin(openedShift, currentShift) {
  return Number(openedShift) === Number(currentShift) ? "current" : "previous";
}

export function parseMaintenanceTrackingLine(item, line, currentShift) {
  const value = normalizeMaintenanceCase(item);
  const raw = String(line || "").trim();
  const normalized = normalizeText(raw).replace(/^[^A-Z0-9]+/i, "").trim();
  let update = null;
  let reviewed = true;
  let match = normalized.match(/^Chamado aberto pelo\s*([123])\s*[º°o]?\s*turno(?:\s+as\s+(\d{2}:\d{2}))?/i);
  if (match) {
    const openedShift = Number(match[1]);
    update = {
      initiationMode: "production",
      callOrigin: relativeCallOrigin(openedShift, currentShift),
      callOpenedShift: openedShift,
      callOpenedAt: match[2] || "",
      callOpenedUnknown: !match[2] && /horario nao informado/i.test(normalized),
    };
  } else if (/^Intervencao iniciada pela propria manutencao/i.test(normalized)) {
    update = { initiationMode: "maintenance", callOrigin: "", callOpenedShift: null };
  } else if (/^Chamado ainda nao foi aberto/i.test(normalized)) {
    update = { initiationMode: "pending", callOrigin: "not_opened", callOpenedShift: null };
  } else if (/^Origem do (?:chamado|atendimento) nao confirmada/i.test(normalized)) {
    update = { initiationMode: "unknown", callOrigin: "unknown", callOpenedShift: null };
  } else if ((match = normalized.match(/^(?:Chamado\s+)?Tractian\s*:?\s*#\s*(\d+)/i))) {
    update = { tractianCode: match[1], tractianStatus: "informed" };
  } else if (/^Sem codigo Tractian/i.test(normalized)) {
    update = { tractianCode: "", tractianStatus: "none" };
  } else if (/^Codigo Tractian nao localizado/i.test(normalized)) {
    update = { tractianCode: "", tractianStatus: "not_found" };
  } else if (/^Manutencao ainda nao chegou/i.test(normalized)) {
    update = { serviceStatus: "waiting", arrivedAt: "", arrivedUnknown: false };
  } else if ((match = normalized.match(/^Inicio da atuacao:\s*(?:([123])\s*[º°o]?\s*turno\s+)?(?:as\s+)?(\d{2}:\d{2})/i))) {
    update = {
      serviceStatus: value.serviceStatus === "completed" ? "completed" : "working",
      arrivedShift: match[1] ? Number(match[1]) : null,
      arrivedAt: match[2],
      arrivedUnknown: false,
    };
  } else if (/^Inicio da atuacao:\s*horario nao informado/i.test(normalized)) {
    update = {
      serviceStatus: value.serviceStatus === "completed" ? "completed" : "working",
      arrivedShift: null,
      arrivedAt: "",
      arrivedUnknown: true,
    };
  } else if ((match = normalized.match(/^(?:Termino da atuacao|Liberacao da manutencao):\s*(?:([123])\s*[º°o]?\s*turno\s+)?(?:as\s+)?(\d{2}:\d{2})/i))) {
    update = {
      serviceStatus: "completed",
      finishedShift: match[1] ? Number(match[1]) : null,
      finishedAt: match[2],
      finishedUnknown: false,
    };
  } else if (/^(?:Termino da atuacao|Liberacao da manutencao):\s*horario nao informado/i.test(normalized)) {
    update = {
      serviceStatus: "completed",
      finishedShift: null,
      finishedAt: "",
      finishedUnknown: true,
    };
  } else if (/^Continuava em (?:atuacao|manutencao) no fechamento/i.test(normalized)) {
    update = { serviceStatus: "working" };
  } else if ((match = normalized.match(/^Manutencao atuando desde\s+(\d{2}:\d{2})/i))) {
    update = { serviceStatus: "working", arrivedAt: match[1], arrivedUnknown: false };
  } else if (/^Manutencao esta atuando; horario de chegada nao informado/i.test(normalized)) {
    update = { serviceStatus: "working", arrivedAt: "", arrivedUnknown: true };
  } else if ((match = normalized.match(/^Manutencao atuou de\s+(\d{2}:\d{2})\s+ate\s+(\d{2}:\d{2})/i))) {
    update = {
      serviceStatus: "completed",
      arrivedAt: match[1],
      arrivedUnknown: false,
      finishedAt: match[2],
      finishedUnknown: false,
    };
  } else if ((match = normalized.match(/^Manutencao chegou as\s+(\d{2}:\d{2}); horario de termino nao informado/i))) {
    update = {
      serviceStatus: "completed",
      arrivedAt: match[1],
      arrivedUnknown: false,
      finishedAt: "",
      finishedUnknown: true,
    };
  } else if ((match = normalized.match(/^Manutencao terminou as\s+(\d{2}:\d{2}); horario de chegada nao informado/i))) {
    update = {
      serviceStatus: "completed",
      arrivedAt: "",
      arrivedUnknown: true,
      finishedAt: match[1],
      finishedUnknown: false,
    };
  } else if (/^Atendimento finalizado; horarios de chegada e termino nao informados/i.test(normalized)) {
    update = {
      serviceStatus: "completed",
      arrivedAt: "",
      arrivedUnknown: true,
      finishedAt: "",
      finishedUnknown: true,
    };
  } else if (/^Problema resolvido sem atuacao da manutencao/i.test(normalized)) {
    update = { serviceStatus: "resolved_without" };
  } else if (/^Situacao do atendimento nao confirmada/i.test(normalized)) {
    update = { serviceStatus: "unknown" };
  } else if ((match = normalized.match(/^(?:Situacao|Como ficou):\s*(.+?)[.]?$/i))) {
    const outcome = Object.entries(MACHINE_OUTCOMES).find(
      ([, label]) => normalizeText(label).toUpperCase() === match[1].replace(/[.]+$/, "").trim().toUpperCase(),
    )?.[0];
    if (outcome) update = { machineOutcome: outcome };
  } else if ((match = normalized.match(/^Acompanhar:\s*(.+)$/i))) {
    update = { monitoringDetails: raw.split(":").slice(1).join(":").trim() };
  } else if ((match = normalized.match(/^Detalhes da atuacao:\s*(.+)$/i))) {
    update = { details: raw.split(":").slice(1).join(":").trim() };
  } else if (/^Conclusao informada pelo preparador; falta (?:confirmar o atendimento|registrar origem e horarios)/i.test(normalized)) {
    update = { reportedCompleted: true };
    reviewed = false;
  }

  return update
    ? normalizeMaintenanceCase({ ...value, ...update, reviewed }, value.tnl)
    : null;
}
