import test from "node:test";
import assert from "node:assert/strict";

import { CLOUD_QUEUE_KEY } from "../src/js/config.js";
import { buildCloudPayload, flushCloudQueue, syncCloud } from "../src/js/cloud.js";
import { parseReport } from "../src/js/parser.js";
import { generateReport } from "../src/js/report.js";
import { defaultFields, fullReport } from "./fixtures.js";

class MemoryStorage {
  data = new Map();
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { this.data.set(key, String(value)); }
}

test("payload de nuvem contém relatório, campos, máquinas e decisões", () => {
  const storage = new MemoryStorage();
  const { state } = parseReport({ raw: fullReport, nextShift: 3 });
  const report = generateReport(state, defaultFields);
  const payload = buildCloudPayload({
    state,
    fields: defaultFields,
    report,
    trigger: "teste",
    storage,
    now: new Date("2026-08-14T21:00:00.000Z"),
  });
  assert.equal(payload.trigger, "teste");
  assert.equal(payload.relatorio_final, report);
  assert.equal(payload.relatorio_bruto, fullReport);
  assert.ok(payload.maquinas.length >= 7);
  assert.ok(Array.isArray(payload.maintenance_cases));
  assert.ok(payload.maintenance_cases.length >= 3);
  assert.match(payload.device_id, /^device_/);
});

test("falha de envio entra na fila e flush posterior remove pendência", async () => {
  const storage = new MemoryStorage();
  const { state } = parseReport({ raw: fullReport, nextShift: 3 });
  const report = generateReport(state, defaultFields);
  const failed = await syncCloud({
    state,
    fields: defaultFields,
    report,
    trigger: "teste",
    storage,
    fetchImpl: async () => { throw new Error("offline"); },
  });
  assert.equal(failed.queued, true);
  assert.equal(JSON.parse(storage.getItem(CLOUD_QUEUE_KEY)).length, 1);

  const flushed = await flushCloudQueue({
    storage,
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true }) }),
  });
  assert.deepEqual(flushed, { sent: 1, remaining: 0 });
  assert.equal(JSON.parse(storage.getItem(CLOUD_QUEUE_KEY)).length, 0);
});
