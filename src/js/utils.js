import { CELL_ORDER, CELLS, GENERAL_CELL, UNMAPPED_CELL } from "./config.js";

export function padTnl(value) {
  return String(Number(value)).padStart(3, "0");
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeHeader(value) {
  return normalizeText(value)
    .replace(/[^A-Z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function normalizedKey(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, " ").trim();
}

export function cleanLine(value) {
  return String(value || "")
    .replace(/[✅❌]/g, "")
    .replace(/[•●]/g, " ")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractTnl(value) {
  const match = String(value || "").match(/TNL\s*0*(\d{1,3})/i);
  return match ? Number(match[1]) : null;
}

export function extractEmoji(value) {
  return String(value || "").match(/(🔴|🔵|🟢)/)?.[1] || "🔴";
}

export function extractReason(value) {
  const match = cleanLine(value).match(/TNL\s*0*\d{1,3}\s*-\s*(.+)$/i);
  return match ? match[1].trim() : "";
}

export function isNA(value) {
  return normalizeHeader(value).replace(/\s+/g, "") === "NA";
}

export function uniqueNumbers(values) {
  return [...new Set(values.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
}

export function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

export function sortByTnl(values) {
  return [...values].sort(
    (a, b) =>
      Number(a.tnl) - Number(b.tnl) ||
      String(a.displayText || a.text || "").localeCompare(
        String(b.displayText || b.text || ""),
        "pt-BR",
      ),
  );
}

export function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function cellForTnl(tnl) {
  const number = Number(tnl);
  return CELL_ORDER.find((cell) => CELLS[cell].includes(number)) || UNMAPPED_CELL;
}

export function cellLabel(cell) {
  if (cell === GENERAL_CELL) return "GERAL / SEM MÁQUINA";
  if (cell === UNMAPPED_CELL) return "SEM CÉLULA";
  return `CÉLULA ${cell}`;
}

export function defaultNextShift(currentShift) {
  const current = Number(currentShift || 2);
  return current === 1 ? 2 : current === 2 ? 3 : 1;
}

export function validNextShift(currentShift, requestedShift) {
  const current = Number(currentShift || 2);
  const requested = Number(requestedShift || 0);
  return [1, 2, 3].includes(requested) && requested !== current
    ? requested
    : defaultNextShift(current);
}

export function nextTurnHeading(nextShift) {
  return `SETUPS ${Number(nextShift)}°T`;
}

export function formatClock(date = new Date()) {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function dateInSaoPaulo(date = new Date()) {
  return date
    .toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
    .split("/")
    .reverse()
    .join("-");
}

export function timeInSaoPaulo(date = new Date()) {
  return date.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function createUuid() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {}
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
