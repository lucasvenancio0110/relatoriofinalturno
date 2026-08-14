import { GENERAL_CELL, SECTION_LABELS } from "./config.js";
import { addCompleted, addRecord, createEmptyState, registerLedger } from "./model.js";
import {
  cellForTnl,
  cleanLine,
  extractEmoji,
  extractReason,
  extractTnl,
  isNA,
  nextTurnHeading,
  normalizeHeader,
  normalizedKey,
  padTnl,
  sortByTnl,
  uniqueStrings,
} from "./utils.js";

export function detectSection(line) {
  const header = normalizeHeader(line);
  if (header === "MAQUINAS EM MANUTENCAO PARADA") return { type: "maintenance" };
  if (header === "MAQUINAS EM MANUTENCAO PRODUZINDO") return { type: "maintenance_prod" };
  if (["MAQUINAS EM SETUP", "SETUP"].includes(header)) return { type: "setup_active" };
  if (header === "PROXIMOS SETUPS") return { type: "setup_start" };
  const future = header.match(/^SETUPS?\s*([123])\s*T(?:URNO)?$/);
  if (future) return { type: "future", heading: `SETUPS ${future[1]}°T` };
  if (["MAQUINAS EM AJUSTES", "MAQUINAS EM AJUSTE"].includes(header)) {
    return { type: "adjustment" };
  }
  if (header === "DESENVOLVIMENTO") return { type: "development_raw" };
  if (["OBSERVACOES", "OBSERVACAO"].includes(header)) return { type: "observation_raw" };
  if (
    [
      "ORDENS PARA SELECAO",
      "BOM TRABALHO",
      "SITUACAO DO SETOR",
      "BANCADA CHECK POINT",
      "CQ FECHAMENTO",
      "CQ REINSPECAO",
      "AJUSTES CONCLUIDOS",
      "SETUPS CONCLUIDOS",
      "MANUTENCOES CONCLUIDAS",
      "RESTANTE OK",
    ].includes(header)
  ) {
    return { type: "ignore" };
  }
  return null;
}

function recordText(type, tnl, reason, emoji) {
  if (type === "maintenance") return `TNL ${padTnl(tnl)} - ${reason || "MANUTENÇÃO"}`;
  if (type === "maintenance_prod") {
    return `TNL ${padTnl(tnl)} - ${reason || "MANUTENÇÃO PRODUZINDO"}`;
  }
  if (type === "setup_active") return `${emoji} TNL ${padTnl(tnl)} - EM SETUP`;
  if (type === "setup_start") return `${emoji} TNL ${padTnl(tnl)} - INICIAR SETUP`;
  if (type === "adjustment") return `TNL ${padTnl(tnl)} - ${reason || "EM AJUSTE"}`;
  return `TNL ${padTnl(tnl)} - REDEFINIR STATUS`;
}

function createRecord(state, { tnl, type, line, emoji, reason }) {
  return {
    id: state.nextId++,
    tnl: Number(tnl),
    type,
    displayText: recordText(type, tnl, reason, emoji),
    rawText: String(line || "").trim(),
    sourceSection: type,
    emoji,
  };
}

function isInfoHeader(line) {
  return ["DESENVOLVIMENTO", "OBSERVACOES", "OBSERVACAO"].includes(normalizeHeader(line));
}

function isContinuationLine(line) {
  const clean = cleanLine(line);
  return /^\(.+\)$/.test(clean) || /^\d{4,}$/.test(clean) || /^OP\s*[:\-]?\s*\d+/i.test(clean) || /^ITEM\s*[:\-]?/i.test(clean);
}

function infoIdentity(kind, tnl, text) {
  return [kind, Number(tnl), normalizedKey(text)].join("|");
}

function generalIdentity(kind, text) {
  return [kind, normalizedKey(text)].join("|");
}

function makeInfoItem(state, { kind, tnl, reason, extra, previousItems }) {
  const displayText = `TNL ${padTnl(tnl)}${reason ? ` - ${reason}` : ""}${extra ? `\n${extra}` : ""}`;
  const old = previousItems.find(
    (item) => infoIdentity(item.kind, item.tnl, item.rawText || item.displayText) === infoIdentity(kind, tnl, displayText),
  );
  return {
    id: old?.id || state.nextDevObsId++,
    kind,
    tnl: Number(tnl),
    displayText,
    rawText: displayText,
    reviewed: Boolean(old?.reviewed),
    status: old?.status || "pending",
  };
}

function makeGeneralItem(state, { kind, text, previousItems }) {
  const rawText = String(text || "").trim();
  const old = previousItems.find(
    (item) => generalIdentity(item.kind, item.rawText || item.text) === generalIdentity(kind, rawText),
  );
  return {
    id: old?.id || state.nextGeneralId++,
    kind,
    text: rawText,
    rawText,
    reviewed: Boolean(old?.reviewed),
    status: old?.status || "pending",
  };
}

export function parseTnlsLine(state, line, extraLines, kind, previousItems = []) {
  const clean = cleanLine(line);
  const extra = uniqueStrings(extraLines || []).join("\n");
  const items = [];
  let match = clean.match(/^TNL'?S?\s*-\s*(.+)$/i);
  if (match) {
    const parts = match[1].split(/\s*-\s*/).filter(Boolean);
    const numbers = [];
    const reasonParts = [];
    let readingReason = false;
    parts.forEach((part) => {
      if (!readingReason && /^0*\d{1,3}$/.test(part.trim())) numbers.push(Number(part));
      else {
        readingReason = true;
        reasonParts.push(part.trim());
      }
    });
    const reason = reasonParts.join(" - ");
    numbers.forEach((tnl) =>
      items.push(makeInfoItem(state, { kind, tnl, reason, extra, previousItems })),
    );
    if (items.length) return items;
  }

  match = clean.match(/^TNL\s*0*(\d{1,3}(?:\s*[\/,]\s*0*\d{1,3})+)\s*(?:-\s*)?(.+)?$/i);
  if (match) {
    const numbers = match[1]
      .split(/[\/,]/)
      .map((value) => Number(value.replace(/\D/g, "")))
      .filter(Number.isFinite);
    const reason = String(match[2] || "").trim();
    numbers.forEach((tnl) =>
      items.push(makeInfoItem(state, { kind, tnl, reason, extra, previousItems })),
    );
    return items;
  }

  match = clean.match(/^TNL\s*0*(\d{1,3})\s*(?:-\s*)?(.+)?$/i);
  if (match) {
    items.push(
      makeInfoItem(state, {
        kind,
        tnl: Number(match[1]),
        reason: String(match[2] || "").trim(),
        extra,
        previousItems,
      }),
    );
  }
  return items;
}

export function parseInfoText(state, text, kind, previousItems = [], previousGeneral = []) {
  const entries = [];
  const general = [];
  let current = null;
  const flush = () => {
    if (current) entries.push(current);
    current = null;
  };

  String(text || "")
    .split(/\r?\n/)
    .forEach((rawLine) => {
      const line = String(rawLine || "").trim();
      if (!line || isNA(line) || isInfoHeader(line)) return;
      if (extractTnl(line) || /^TNL'?S?\s*-/i.test(cleanLine(line))) {
        flush();
        current = { line, extra: [] };
        return;
      }
      if (current && isContinuationLine(line)) {
        current.extra.push(line);
        return;
      }
      flush();
      general.push(makeGeneralItem(state, { kind, text: line, previousItems: previousGeneral }));
    });
  flush();

  const items = [];
  entries.forEach((entry) => {
    const parsed = parseTnlsLine(state, entry.line, entry.extra, kind, previousItems);
    if (parsed.length) items.push(...parsed);
    else {
      general.push(
        makeGeneralItem(state, {
          kind,
          text: [entry.line, ...entry.extra].join("\n"),
          previousItems: previousGeneral,
        }),
      );
    }
  });
  return { items, general };
}

export function rebuildInfoFromFields(state, development, observations) {
  const previousItems = [...state.devObsItems];
  const previousGeneral = [...state.generalInfoItems];
  const parsedDev = parseInfoText(state, development, "development", previousItems, previousGeneral);
  const parsedObs = parseInfoText(state, observations, "observation", previousItems, previousGeneral);
  state.devObsItems = sortByTnl([...parsedDev.items, ...parsedObs.items]);
  state.generalInfoItems = [...parsedDev.general, ...parsedObs.general].sort((a, b) =>
    `${a.kind}|${a.text}`.localeCompare(`${b.kind}|${b.text}`, "pt-BR"),
  );

  const liveKeys = new Set();
  state.devObsItems.forEach((item) => {
    const key = `D:${item.id}`;
    liveKeys.add(key);
    registerLedger(state, {
      key,
      kind: "devobs",
      tnl: item.tnl,
      cell: cellForTnl(item.tnl),
      status: item.reviewed ? "decided" : "pending",
    });
  });
  state.generalInfoItems.forEach((item) => {
    const key = `G:${item.id}`;
    liveKeys.add(key);
    registerLedger(state, {
      key,
      kind: "general",
      cell: GENERAL_CELL,
      status: item.reviewed ? "decided" : "pending",
    });
  });
  state.roundLedger = state.roundLedger.filter(
    (entry) => !["devobs", "general"].includes(entry.kind) || liveKeys.has(entry.key) || entry.status === "decided",
  );
}

export function parseReport({ raw, development = "", observations = "", nextShift = 3 }) {
  const state = createEmptyState();
  state.raw = String(raw || "");
  const rawDevelopment = [];
  const rawObservations = [];
  let section = "ignore";
  let futureHeading = nextTurnHeading(nextShift);

  state.raw.split(/\r?\n/).forEach((rawLine) => {
    const line = String(rawLine || "").trim();
    if (!line) return;
    const detected = detectSection(line);
    if (detected) {
      section = detected.type;
      if (detected.heading) futureHeading = detected.heading;
      return;
    }
    if (section === "development_raw") {
      rawDevelopment.push(line);
      return;
    }
    if (section === "observation_raw") {
      rawObservations.push(line);
      return;
    }

    const tnl = extractTnl(line);
    if (!tnl) {
      if (
        ["maintenance", "maintenance_prod", "setup_active", "setup_start", "adjustment", "future"].includes(section) &&
        !isNA(line)
      ) {
        state.reviewLines.push(`${SECTION_LABELS[section] || section}: ${line}`);
      }
      return;
    }

    const concluded = line.includes("✅");
    const emoji = extractEmoji(line);
    const reason = extractReason(line);
    if (["maintenance", "maintenance_prod"].includes(section)) {
      if (reason) {
        state.reasons.maintenance[String(tnl)] = uniqueStrings([
          ...(state.reasons.maintenance[String(tnl)] || []),
          reason,
        ]);
      }
      if (concluded) addCompleted(state, tnl, "maintenance");
      else addRecord(state, createRecord(state, { tnl, type: section, line, emoji, reason }));
      return;
    }
    if (["setup_active", "setup_start"].includes(section)) {
      if (concluded) addCompleted(state, tnl, "setup");
      else addRecord(state, createRecord(state, { tnl, type: section, line, emoji, reason }));
      return;
    }
    if (section === "adjustment") {
      if (concluded) addCompleted(state, tnl, "adjustment");
      else {
        if (reason) state.reasons.adjustment[String(tnl)] = reason;
        addRecord(state, createRecord(state, { tnl, type: section, line, emoji, reason }));
      }
      return;
    }
    if (section === "future") {
      if (concluded) addCompleted(state, tnl, "setup");
      else {
        const item = {
          id: state.nextFutureId++,
          heading: futureHeading,
          tnl,
          emoji,
          displayText: cleanLine(line).replace(/TNL\s*0*\d{1,3}/i, `TNL ${padTnl(tnl)}`),
          rawText: line,
          status: "pending",
          reviewed: false,
        };
        state.futureItems.push(item);
      }
    }
  });

  const finalDevelopment = rawDevelopment.length ? rawDevelopment.join("\n") : development;
  const finalObservations = rawObservations.length ? rawObservations.join("\n") : observations;
  rebuildInfoFromFields(state, finalDevelopment, finalObservations);

  [...new Set(state.records.map((record) => Number(record.tnl)))].forEach((tnl) =>
    registerLedger(state, { key: `A:${tnl}`, kind: "machine", tnl, cell: cellForTnl(tnl) }),
  );
  state.futureItems = sortByTnl(state.futureItems);
  state.futureItems.forEach((item) =>
    registerLedger(state, {
      key: `F:${item.id}`,
      kind: "future",
      tnl: item.tnl,
      cell: cellForTnl(item.tnl),
    }),
  );

  return {
    state,
    development: finalDevelopment,
    observations: finalObservations,
  };
}
