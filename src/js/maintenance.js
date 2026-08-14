import { normalizeText, padTnl, uniqueStrings } from "./utils.js";

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
  return {
    tnl: machine,
    reasons: uniqueStrings(value?.reasons || []),
    sourceSections: uniqueStrings(value?.sourceSections || []),
    originalLines: uniqueStrings(value?.originalLines || []),
    reportedCompleted: Boolean(value?.reportedCompleted),
    callOrigin: allowed(value?.callOrigin, CALL_ORIGIN_KEYS),
    callOpenedShift: [1, 2, 3].includes(Number(value?.callOpenedShift))
      ? Number(value.callOpenedShift)
      : null,
    callOpenedAt: String(value?.callOpenedAt || ""),
    callOpenedUnknown: Boolean(value?.callOpenedUnknown),
    serviceStatus: allowed(value?.serviceStatus, SERVICE_STATUS_KEYS),
    arrivedAt: String(value?.arrivedAt || ""),
    arrivedUnknown: Boolean(value?.arrivedUnknown),
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
  if (!item.callOrigin) errors.push("Informe quem abriu o chamado.");
  if (
    item.callOrigin === "current" &&
    !hasTimeOrUnknown(item.callOpenedAt, item.callOpenedUnknown)
  ) {
    errors.push("Informe o horário de abertura ou marque como não informado.");
  }
  if (!item.serviceStatus) errors.push("Informe a situação da manutenção.");
  if (
    ["working", "completed"].includes(item.serviceStatus) &&
    !hasTimeOrUnknown(item.arrivedAt, item.arrivedUnknown)
  ) {
    errors.push("Informe o horário de chegada ou marque como não informado.");
  }
  if (
    item.serviceStatus === "completed" &&
    !hasTimeOrUnknown(item.finishedAt, item.finishedUnknown)
  ) {
    errors.push("Informe o horário de término ou marque como não informado.");
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

export function maintenanceTrackingLines(item, currentShift) {
  const value = normalizeMaintenanceCase(item);
  if (!value.reviewed) {
    return value.reportedCompleted
      ? ["🔧 Conclusão informada pelo preparador; falta confirmar o atendimento."]
      : [];
  }

  const lines = [];
  if (value.callOrigin === "previous") {
    lines.push(`📞 Chamado aberto pelo ${value.callOpenedShift || previousShift(currentShift)}º turno.`);
  } else if (value.callOrigin === "current") {
    const openedShift = value.callOpenedShift || Number(currentShift);
    lines.push(
      value.callOpenedAt
        ? `📞 Chamado aberto pelo ${openedShift}º turno às ${value.callOpenedAt}.`
        : `📞 Chamado aberto pelo ${openedShift}º turno; horário não informado.`,
    );
  } else if (value.callOrigin === "not_opened") {
    lines.push("📞 Chamado ainda não foi aberto.");
  } else {
    lines.push("📞 Origem do chamado não confirmada.");
  }

  if (value.serviceStatus === "waiting") {
    lines.push("🔧 Manutenção ainda não chegou.");
  } else if (value.serviceStatus === "working") {
    lines.push(
      value.arrivedAt
        ? `🔧 Manutenção atuando desde ${value.arrivedAt}.`
        : "🔧 Manutenção está atuando; horário de chegada não informado.",
    );
  } else if (value.serviceStatus === "completed") {
    if (value.arrivedAt && value.finishedAt) {
      lines.push(`🔧 Manutenção atuou de ${value.arrivedAt} até ${value.finishedAt}.`);
    } else if (value.arrivedAt) {
      lines.push(`🔧 Manutenção chegou às ${value.arrivedAt}; horário de término não informado.`);
    } else if (value.finishedAt) {
      lines.push(`🔧 Manutenção terminou às ${value.finishedAt}; horário de chegada não informado.`);
    } else {
      lines.push("🔧 Atendimento finalizado; horários de chegada e término não informados.");
    }
  } else if (value.serviceStatus === "resolved_without") {
    lines.push("🔧 Problema resolvido sem atuação da manutenção.");
  } else {
    lines.push("🔧 Situação do atendimento não confirmada.");
  }

  lines.push(`📍 Como ficou: ${MACHINE_OUTCOMES[value.machineOutcome] || "NÃO CONFIRMADA"}.`);
  if (value.monitoringDetails) lines.push(`👁️ Acompanhar: ${value.monitoringDetails}`);
  if (value.details) lines.push(`📝 Detalhes da atuação: ${value.details}`);
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
    ...lines.map((line, index) => `${index === lines.length - 1 ? "└─" : "├─"} ${line}`),
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
    ? "CONFIRMAR MANUTENÇÃO CONCLUÍDA"
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
      callOrigin: relativeCallOrigin(openedShift, currentShift),
      callOpenedShift: openedShift,
      callOpenedAt: match[2] || "",
      callOpenedUnknown: !match[2] && /horario nao informado/i.test(normalized),
    };
  } else if (/^Chamado ainda nao foi aberto/i.test(normalized)) {
    update = { callOrigin: "not_opened", callOpenedShift: null };
  } else if (/^Origem do chamado nao confirmada/i.test(normalized)) {
    update = { callOrigin: "unknown", callOpenedShift: null };
  } else if (/^Manutencao ainda nao chegou/i.test(normalized)) {
    update = { serviceStatus: "waiting", arrivedAt: "", arrivedUnknown: false };
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
  } else if (/^Conclusao informada pelo preparador; falta confirmar o atendimento/i.test(normalized)) {
    update = { reportedCompleted: true };
    reviewed = false;
  }

  return update
    ? normalizeMaintenanceCase({ ...value, ...update, reviewed }, value.tnl)
    : null;
}
