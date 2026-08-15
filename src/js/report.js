import { activeRecords } from "./model.js";
import {
  maintenanceCaseOf,
  maintenanceReportBucket,
  maintenanceSummaryEntry,
  maintenanceTrackingLines,
  maintenanceTrackingReportEntry,
} from "./maintenance.js";
import { nextTurnHeading, padTnl, sortByTnl, uniqueNumbers, uniqueStrings } from "./utils.js";

function formatList(lines) {
  const clean = uniqueStrings(lines);
  return clean.length ? clean.join("\n") : "N/A";
}

function formatCompleted(values) {
  const items = uniqueNumbers(values).map(padTnl);
  return items.length ? `TNL's - ${items.join(" - ")}.` : "N/A";
}

function formatBlocks(lines) {
  const clean = uniqueStrings(lines);
  return clean.length ? clean.join("\n\n") : "N/A";
}

export function developmentLines(state) {
  const general = state.generalInfoItems
    .filter((item) => item.kind === "development" && item.status !== "removed")
    .map((item) => item.rawText || item.text);
  const machines = sortByTnl(
    state.devObsItems.filter(
      (item) => item.kind === "development" && !["removed", "resolved"].includes(item.status),
    ),
  ).map((item) => item.displayText);
  return uniqueStrings([...general, ...machines]);
}

export function observationLines(state) {
  const general = state.generalInfoItems
    .filter((item) => item.kind === "observation" && item.status !== "removed")
    .map((item) => item.rawText || item.text);
  const machines = sortByTnl(
    state.devObsItems.filter(
      (item) => item.kind === "observation" && !["removed", "resolved"].includes(item.status),
    ),
  ).map((item) => item.displayText);
  return uniqueStrings([...general, ...machines]);
}

export function generateReport(state, fields) {
  const records = activeRecords(state);
  const trackedLine = (record) => {
    const item = maintenanceCaseOf(state, record.tnl);
    return item ? maintenanceSummaryEntry(item) : record.displayText;
  };
  const maintenance = uniqueStrings(
    sortByTnl(records.filter((item) => item.type === "maintenance")).map(trackedLine),
  );
  const producing = uniqueStrings(
    sortByTnl(records.filter((item) => item.type === "maintenance_prod")).map(trackedLine),
  );
  const maintenanceCases = Object.values(state.maintenanceCases || {});
  const completedCases = sortByTnl(
    maintenanceCases.filter((item) => maintenanceReportBucket(item) === "completed"),
  );
  const completedCaseTnls = new Set(completedCases.map((item) => Number(item.tnl)));
  const legacyCompleted = uniqueNumbers(state.completed.maintenances).filter(
    (tnl) => !completedCaseTnls.has(Number(tnl)),
  );
  const completedMaintenance = [
    ...completedCases.map((item) => maintenanceSummaryEntry(item, { completed: true })),
    ...(legacyCompleted.length ? [`TNL's - ${legacyCompleted.map(padTnl).join(" - ")}.`] : []),
  ];
  const maintenanceTracking = sortByTnl(
    maintenanceCases.filter(
      (item) => maintenanceTrackingLines(item, fields.currentShift).length > 0,
    ),
  ).map((item) => maintenanceTrackingReportEntry(item, fields.currentShift));
  const setup = sortByTnl(
    records.filter((item) => ["setup_active", "setup_start"].includes(item.type)),
  ).map((item) => item.displayText);
  const adjustments = sortByTnl(records.filter((item) => item.type === "adjustment")).map(
    (item) => item.displayText,
  );
  const futureItems = state.futureItems.filter((item) => item.status !== "removed");
  const headings = [...new Set(futureItems.map((item) => item.heading))].sort();
  const futureBlocks = headings.length
    ? headings
        .map(
          (heading) =>
            `*${heading}:*\n${formatList(
              sortByTnl(futureItems.filter((item) => item.heading === heading)).map(
                (item) => item.displayText,
              ),
            )}`,
        )
        .join("\n\n")
    : `*${nextTurnHeading(fields.nextShift)}:*\nN/A`;

  return `*${fields.currentShift}° TURNO*
*SITUAÇÃO DO SETOR ⬇️⬇️⬇️*

*BANCADA – CHECK POINT:*
${fields.checkpoint || "00"}

*ORDENS PARA SELEÇÃO:*

Seleção 1° turno: ${fields.sel1 || "00"}
Seleção 2° turno: ${fields.sel2 || "00"}
Seleção 3° turno: ${fields.sel3 || "00"}
Os 3 turnos: ${fields.selAll || "00"}
Seleção TNC: ${fields.selTnc || "00"}

*CQ FECHAMENTO:*
${fields.cqFechamento || "00"}

*CQ REINSPEÇÃO:*
${fields.cqReinspecao || "00"}

*MÁQUINAS EM MANUTENÇÃO PARADA:*
${formatList(maintenance)}

*MÁQUINAS EM MANUTENÇÃO PRODUZINDO:*
${formatList(producing)}

*SETUP:*
${formatList(setup)}

*MAQUINAS EM AJUSTES:*
${formatList(adjustments)}

${futureBlocks}

*AJUSTES CONCLUÍDOS:*
${formatCompleted(state.completed.adjustments)}

*SETUPS CONCLUÍDOS:*
${formatCompleted(state.completed.setups)}

*MANUTENÇÕES CONCLUÍDAS:*
${formatList(completedMaintenance)}

*DESENVOLVIMENTO:*
${formatList(developmentLines(state))}

*DETALHAMENTO DAS MANUTENÇÕES:*
${formatBlocks(maintenanceTracking)}

*OBSERVAÇÕES:*
${formatList(observationLines(state))}

*RESTANTE OK !*`;
}
