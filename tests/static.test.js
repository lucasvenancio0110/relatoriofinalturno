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
  assert.match(app, /context\.route/);
  assert.match(app, /context\.completionConfirmed/);
});

test("máquina em manutenção começa pelo destino e só depois abre o atendimento", () => {
  assert.match(app, /value: "maintenance_path"/);
  assert.match(app, /value: "setup_path"/);
  assert.match(app, /VAI PASSAR EM MANUTENÇÃO/);
  assert.match(app, /VAI PASSAR EM SETUP/);
  const flow = app.match(/async function chooseSetupThenMaintenance[\s\S]*?\n}\n\nasync function openMachine/)?.[0] || "";
  assert.match(flow, /Como a máquina vai entrar no setup/);
  assert.match(flow, /A manutenção foi concluída/);
  assert.match(flow, /completionConfirmed: maintenanceCompleted === "yes"/);
  assert.ok(flow.indexOf("setupMode = await showChoice") < flow.indexOf("maintenanceCompleted = await showChoice"));
  assert.ok(flow.indexOf("maintenanceCompleted = await showChoice") < flow.indexOf("finishMaintenanceDecision"));
});

test("roteamento é aplicado somente depois de salvar o atendimento", () => {
  const finish = app.match(/async function finishMaintenanceDecision[\s\S]*?\n}\n\nasync function resumePendingMaintenanceDraft/)?.[0] || "";
  assert.match(finish, /const tracking = await showMaintenanceForm/);
  assert.match(finish, /if \(!tracking\) return false/);
  assert.match(finish, /const appliedRoute = applyMachineRoute/);
  assert.ok(finish.indexOf("if (!tracking) return false") < finish.indexOf("applyMachineRoute"));
});
