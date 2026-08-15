import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "index.html"), "utf8");
const app = readFileSync(resolve(root, "src/js/app.js"), "utf8");

test("HTML usa módulos e não contém senha em texto aberto", () => {
  assert.match(html, /type="module" src="\.\/src\/js\/app\.js"/);
  assert.doesNotMatch(html, /132423/);
  assert.doesNotMatch(html, /onclick\s*=/i);
});

test("viewport permite zoom e diálogos possuem semântica nativa", () => {
  assert.doesNotMatch(html, /user-scalable\s*=\s*no/i);
  assert.doesNotMatch(html, /maximum-scale\s*=\s*1/i);
  assert.ok((html.match(/<dialog\b/g) || []).length >= 4);
  assert.match(html, /id="maintenanceCallOrigin"/);
  assert.match(html, /id="maintenanceServiceStatus"/);
  assert.match(html, /id="maintenanceMachineOutcome"/);
  ["LIBERADA", "EM ACOMPANHAMENTO", "CONTINUA PARADA", "PASSOU PARA AJUSTE", "PASSOU PARA SETUP"].forEach(
    (option) => assert.ok(html.includes(option), `Resultado ausente: ${option}`),
  );
});

test("ronda expressa evita selects nativos e identifica o chamado Tractian", () => {
  assert.doesNotMatch(html, /<select[^>]+id="maintenance(?:CallOrigin|ServiceStatus|MachineOutcome)"/i);
  assert.match(html, /id="maintenanceInitiationMode"/);
  assert.match(html, /id="maintenanceTractianCode"[^>]+inputmode="numeric"/);
  assert.match(html, /data-time-mode="now"/);
  assert.match(html, /data-time-mode="manual"/);
  assert.match(html, /data-time-mode="unknown"/);
  assert.match(html, /Rascunho salvo automaticamente/i);
});

test("rascunho da manutenção integra sessão, ocultação e fechamento da página", () => {
  assert.match(app, /maintenanceDrafts/);
  assert.match(app, /activeMaintenanceDraftKey/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /pagehide/);
  assert.match(app, /resumePendingMaintenanceDraft/);
});
