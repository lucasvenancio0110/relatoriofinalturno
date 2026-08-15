import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "index.html"), "utf8");
const app = readFileSync(resolve(root, "src/js/app.js"), "utf8");
const baseCss = readFileSync(resolve(root, "styles/base.css"), "utf8");
const componentsCss = readFileSync(resolve(root, "styles/components.css"), "utf8");
const responsiveCss = readFileSync(resolve(root, "styles/responsive.css"), "utf8");
const responsiveDialogs = readFileSync(resolve(root, "src/js/responsive-dialogs.js"), "utf8");
const buildScript = readFileSync(resolve(root, "scripts/build.mjs"), "utf8");
const zoomLock = readFileSync(resolve(root, "src/js/zoom-lock.js"), "utf8");
const maintenanceHtml = html.match(/<dialog[^>]+id="maintenanceDialog"[\s\S]*?<\/dialog>/)?.[0] || "";

test("HTML usa módulos e não contém senha em texto aberto", () => {
  assert.match(html, /type="module" src="\.\/src\/js\/app\.js"/);
  assert.doesNotMatch(html, /132423/);
  assert.doesNotMatch(html, /onclick\s*=/i);
});

test("viewport bloqueia zoom e diálogos possuem semântica nativa", () => {
  assert.match(html, /user-scalable=no/i);
  assert.match(html, /maximum-scale=1/i);
  assert.match(html, /minimum-scale=1/i);
  assert.match(baseCss, /touch-action:\s*manipulation;/i);
  assert.match(html, /src="\.\/src\/js\/zoom-lock\.js"/);
  assert.match(zoomLock, /gesturestart/);
  assert.match(zoomLock, /touches\.length > 1/);
  assert.match(zoomLock, /dblclick/);
  assert.ok((html.match(/<dialog\b/g) || []).length >= 4);
  assert.match(html, /id="maintenanceCallOrigin"/);
  assert.match(html, /id="maintenanceServiceStatus"/);
  assert.match(html, /id="maintenanceMachineOutcome"/);
  ["EM MANUTENÇÃO", "LIBERADA"].forEach(
    (option) => assert.ok(html.includes(option), `Resultado ausente: ${option}`),
  );
});

test("resumo das células usa cinco colunas fixas em todas as larguras", () => {
  assert.match(
    componentsCss,
    /\.cell-overview\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\);/,
  );
  assert.doesNotMatch(
    responsiveCss,
    /\.cell-overview\s*\{[^}]*grid-template-columns:/,
  );
  assert.match(componentsCss, /\.cell-chip\s*\{[\s\S]*?min-width:\s*0;/);
});

test("ronda rápida usa no máximo quatro blocos progressivos", () => {
  assert.doesNotMatch(html, /<select[^>]+id="maintenance(?:CallOrigin|ServiceStatus|MachineOutcome)"/i);
  assert.match(html, /id="maintenanceTractianCode"[^>]+inputmode="numeric"/);
  assert.match(maintenanceHtml, /VEIO DO TURNO ANTERIOR/);
  assert.match(maintenanceHtml, /ABRIMOS NO NOSSO TURNO/);
  assert.match(maintenanceHtml, /MANUTENÇÃO INICIOU DIRETO/);
  assert.match(maintenanceHtml, /AINDA NÃO CHEGOU/);
  assert.match(maintenanceHtml, /SIM, JÁ ATUOU/);
  assert.match(maintenanceHtml, /INÍCIO DO TURNO/);
  assert.match(maintenanceHtml, /Que horas liberaram/);
  assert.match(html, /data-time-mode="manual"/);
  assert.match(html, /data-time-mode="unknown"/);
  assert.match(maintenanceHtml, /TNL 000 - Manutenção/);
  assert.match(maintenanceHtml, /class="maintenance-reason"[^>]*><strong>Motivo:<\/strong>/);
  assert.doesNotMatch(
    maintenanceHtml,
    /SALVAMENTO AUTOMÁTICO|Rascunho salvo|Salvando rascunho|Quatro respostas rápidas|Ver informação recebida/i,
  );
  assert.match(html, /id="maintenanceOutcomeStep"/);
  assert.equal((maintenanceHtml.match(/class="maintenance-step/g) || []).length, 4);
  assert.doesNotMatch(maintenanceHtml, /Quem abriu o chamado|Detalhes da atuação|EM ACOMPANHAMENTO|PASSOU PARA AJUSTE|PASSOU PARA SETUP/i);
});

test("formulário de manutenção permanece compacto e sem estouro no celular", () => {
  const standardPhoneCss = responsiveCss
    .split("@media (max-width: 390px) {")[1]
    ?.split("@container popup")[0] || "";
  assert.match(maintenanceHtml, /SALVAR E AVANÇAR/);
  assert.match(maintenanceHtml, /class="time-mode-options quick-answer-grid release-time-options"/);
  assert.match(baseCss, /\.manual-time \{[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*hidden;/);
  assert.match(baseCss, /\.maintenance-submit \.modal-actions-row \{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 88px;/);
  assert.match(responsiveCss, /#maintenanceDialog\s*\{[\s\S]*?88dvh/);
  assert.match(responsiveCss, /#maintenanceDialog\s*\{[\s\S]*?env\(safe-area-inset-bottom\)/);
  assert.doesNotMatch(
    standardPhoneCss,
    /\.express-options-two,\s*\.quick-answer-grid,\s*\.outcome-options\s*\{\s*grid-template-columns:\s*1fr;/,
  );
  assert.equal((maintenanceHtml.match(/Quando chegaram\?/g) || []).length, 1);
});

test("popups usam viewport visual, container query e Motion via npm", () => {
  assert.match(app, /openResponsiveDialog/);
  assert.doesNotMatch(app, /\.showModal\(\)/);
  assert.match(responsiveDialogs, /from "motion\/mini"/);
  assert.match(responsiveDialogs, /window\.visualViewport/);
  assert.match(responsiveDialogs, /prefers-reduced-motion/);
  assert.match(responsiveCss, /var\(--dialog-viewport-height, 100dvh\)/);
  assert.match(responsiveCss, /@container popup \(max-width: 330px\)/);
  assert.match(buildScript, /bundle:\s*true/);
  assert.match(buildScript, /target:\s*\["safari16\.4", "chrome111", "firefox115"\]/);
});

test("rascunho da manutenção integra sessão, ocultação e fechamento da página", () => {
  assert.match(app, /maintenanceDrafts/);
  assert.match(app, /activeMaintenanceDraftKey/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /pagehide/);
  assert.match(app, /resumePendingMaintenanceDraft/);
  assert.match(app, /acted: byId\("maintenanceActed"\)\.value/);
  assert.match(app, /setMaintenanceOrigin/);
  assert.match(app, /context\.completionConfirmed/);
});

test("toda máquina preserva as cinco decisões do passagemdeturno", () => {
  const flow = app.match(/async function openMachine[\s\S]*?\n}\n\nasync function openFuture/)?.[0] || "";
  [
    'value: "adjustment"',
    'value: "setup"',
    'value: "maintenance"',
    'value: "release"',
    'value: "remove"',
  ].forEach((option) => assert.match(flow, new RegExp(option)));
  assert.doesNotMatch(flow, /maintenanceRelated|maintenance_path|setup_path/);
});

test("manutenção usa o formulário rápido sem apagar setup ou ajuste em bloco", () => {
  const collect = app.match(/async function collectMaintenanceDecision[\s\S]*?\n}\n\nfunction applyMaintenanceTracking/)?.[0] || "";
  const applyTracking = app.match(/function applyMaintenanceTracking[\s\S]*?\n}\n\nasync function finishMaintenanceDecision/)?.[0] || "";
  const finish = app.match(/async function finishMaintenanceDecision[\s\S]*?\n}\n\nasync function resumePendingMaintenanceDraft/)?.[0] || "";
  assert.match(collect, /const tracking = await showMaintenanceForm/);
  assert.match(finish, /collectMaintenanceDecision/);
  assert.match(finish, /if \(!collected\) return false/);
  assert.match(finish, /target: "maintenance"/);
  assert.match(applyTracking, /updateMaintenanceCase/);
  assert.match(applyTracking, /removeCategory\(state, tnl, "maintenance"\)/);
  assert.doesNotMatch(finish, /removeRecordsOfTnl|applyMachineRoute/);
  assert.ok(finish.indexOf("collectMaintenanceDecision") < finish.indexOf("applyTransition"));
});

test("LIBERADA revisa conflitos categoria por categoria", () => {
  const review = app.match(/async function reviewMachineRelease[\s\S]*?\n}\n\nasync function openMachine/)?.[0] || "";
  const flow = app.match(/async function openMachine[\s\S]*?\n}\n\nasync function openFuture/)?.[0] || "";
  const releaseBranch = flow.match(/if \(choice === "release"\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(app, /const RELEASE_REVIEW_ORDER = \["setup", "maintenance", "adjustment"\]/);
  assert.match(review, /collectMaintenanceDecision/);
  assert.match(review, /applyMaintenanceTracking/);
  assert.match(review, /applyCategoryReview/);
  assert.match(review, /O \$\{label\.toLocaleLowerCase\("pt-BR"\)\} foi concluído\?/);
  assert.match(flow, /return reviewMachineRelease\(subjectKey, tnl, before\)/);
  assert.doesNotMatch(flow, /categoriesOfTnl\(state, tnl\)\.forEach/);
  assert.doesNotMatch(releaseBranch, /removeRecordsOfTnl|addCompleted/);
});

test("setup futuro mantém a decisão em duas etapas e resolve conflitos", () => {
  const flow = app.match(/async function openFuture[\s\S]*?\n}\n\nasync function openDevObs/)?.[0] || "";
  assert.match(flow, /value: "keep"/);
  assert.match(flow, /value: "setup"/);
  assert.match(flow, /value: "remove"/);
  assert.match(flow, /O setup futuro iniciou ou mudou de condição/);
  assert.match(flow, /value: "active"/);
  assert.match(flow, /value: "start"/);
  assert.match(flow, /value: "after"/);
  assert.match(flow, /target: "setup"/);
  assert.match(flow, /applyTransition/);
});

test("motivos importados são reaproveitados sem nova digitação", () => {
  const adjustment = app.match(/async function chooseAdjustment[\s\S]*?\n}\n\nfunction createMaintenanceDecision/)?.[0] || "";
  const maintenance = app.match(/async function chooseMaintenance[\s\S]*?\n}\n\nconst RELEASE_REVIEW_ORDER/)?.[0] || "";
  assert.match(adjustment, /savedReason \|\|/);
  assert.match(maintenance, /initial \|\|/);
});
