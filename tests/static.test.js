import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "index.html"), "utf8");
const app = readFileSync(resolve(root, "src/js/app.js"), "utf8");
const maintenanceHtml = html.match(/<dialog[^>]+id="maintenanceDialog"[\s\S]*?<\/dialog>/)?.[0] || "";

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
  ["LIBERADA \/ PRODUZINDO", "PARADA"].forEach(
    (option) => assert.ok(html.includes(option), `Resultado ausente: ${option}`),
  );
});

test("ronda rápida usa no máximo quatro blocos progressivos", () => {
  assert.doesNotMatch(html, /<select[^>]+id="maintenance(?:CallOrigin|ServiceStatus|MachineOutcome)"/i);
  assert.match(html, /id="maintenanceTractianCode"[^>]+inputmode="numeric"/);
  assert.match(maintenanceHtml, /AINDA NÃO CHEGOU/);
  assert.match(maintenanceHtml, /JÁ ESTAVA NO INÍCIO DO TURNO/);
  assert.match(maintenanceHtml, /CHEGOU AGORA/);
  assert.match(maintenanceHtml, /AINDA ESTÁ EM MANUTENÇÃO/);
  assert.match(maintenanceHtml, /LIBEROU AGORA/);
  assert.match(html, /data-time-mode="manual"/);
  assert.match(html, /data-time-mode="unknown"/);
  assert.match(html, /Rascunho salvo automaticamente/i);
  assert.match(html, /id="maintenanceOutcomeStep"/);
  assert.equal((maintenanceHtml.match(/class="maintenance-step/g) || []).length, 4);
  assert.doesNotMatch(maintenanceHtml, /Quem abriu o chamado|Detalhes da atuação|EM ACOMPANHAMENTO|PASSOU PARA AJUSTE|PASSOU PARA SETUP/i);
});

test("rascunho da manutenção integra sessão, ocultação e fechamento da página", () => {
  assert.match(app, /maintenanceDrafts/);
  assert.match(app, /activeMaintenanceDraftKey/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /pagehide/);
  assert.match(app, /resumePendingMaintenanceDraft/);
});

test("conflito setup e manutenção preserva a sequência operacional", () => {
  assert.match(app, /resolveSetupBeforeMaintenance/);
  assert.match(app, /SETUP CONCLUÍDO → ENTROU EM MANUTENÇÃO/);
  assert.match(app, /SETUP INTERROMPIDO → RETOMAR APÓS MANUTENÇÃO/);
  assert.match(app, /applySetupBeforeMaintenance/);
});
