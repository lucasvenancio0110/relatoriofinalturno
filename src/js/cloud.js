import {
  APP_NAME,
  APP_VERSION,
  CLOUD_API_URL,
  CLOUD_DEVICE_KEY,
  CLOUD_QUEUE_KEY,
} from "./config.js";
import { activeRecords, kpis } from "./model.js";
import { cellForTnl, createUuid, dateInSaoPaulo, padTnl, timeInSaoPaulo } from "./utils.js";

const MAX_QUEUE_ITEMS = 15;

function readQueue(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(CLOUD_QUEUE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveQueue(storage, queue) {
  storage.setItem(CLOUD_QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE_ITEMS)));
}

function deviceId(storage) {
  let id = storage.getItem(CLOUD_DEVICE_KEY);
  if (!id) {
    id = `device_${createUuid()}`;
    storage.setItem(CLOUD_DEVICE_KEY, id);
  }
  return id;
}

export function buildCloudPayload({ state, fields, report, trigger, storage, now = new Date() }) {
  if (!state.cloudPassageId) state.cloudPassageId = createUuid();
  const metrics = kpis(state);
  return {
    id: state.cloudPassageId,
    trigger: trigger || "manual",
    data_turno: dateInSaoPaulo(now),
    hora_envio: timeInSaoPaulo(now),
    turno_atual: `${fields.currentShift}° TURNO`,
    proximo_turno: `${fields.nextShift}° TURNO`,
    app_version: `${APP_NAME} ${APP_VERSION}`,
    device_id: deviceId(storage),
    pendencias: metrics.pending,
    conflitos: metrics.conflicts,
    decisoes: metrics.completed,
    relatorio_final: report,
    relatorio_bruto: state.raw,
    fields,
    maquinas: activeRecords(state).map((record) => ({
      tnl: padTnl(record.tnl),
      celula: cellForTnl(record.tnl),
      categoria: record.type,
      status_final: record.type,
      origem: record.displayText,
      texto_original: record.rawText,
    })),
    confirmed_decisions: Object.values(state.confirmedDecisions),
    maintenance_cases: Object.values(state.maintenanceCases || {}),
    completed: state.completed,
    saved_at_client: now.toISOString(),
  };
}

async function sendPayload(payload, fetchImpl) {
  const response = await fetchImpl(`${CLOUD_API_URL}/salvar-passagem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `Erro HTTP ${response.status}`);
  return data;
}

function enqueue(storage, payload) {
  const queue = readQueue(storage);
  const index = queue.findIndex((item) => item?.id === payload.id);
  if (index >= 0) queue[index] = payload;
  else queue.push(payload);
  saveQueue(storage, queue);
}

export async function syncCloud(options) {
  const { storage = globalThis.localStorage, fetchImpl = globalThis.fetch } = options;
  const payload = buildCloudPayload({ ...options, storage });
  try {
    const result = await sendPayload(payload, fetchImpl);
    return { ok: true, queued: false, result };
  } catch (error) {
    enqueue(storage, payload);
    return { ok: false, queued: true, error };
  }
}

export async function flushCloudQueue({
  storage = globalThis.localStorage,
  fetchImpl = globalThis.fetch,
} = {}) {
  const queue = readQueue(storage);
  if (!queue.length) return { sent: 0, remaining: 0 };
  const remaining = [];
  let sent = 0;
  for (const payload of queue) {
    try {
      await sendPayload(payload, fetchImpl);
      sent += 1;
    } catch {
      remaining.push(payload);
    }
  }
  saveQueue(storage, remaining);
  return { sent, remaining: remaining.length };
}
