export const APP_NAME = "VENANC Tools — Relatório Final de Turno";
export const APP_VERSION = "1.6.1";

export const ACCESS_HASH =
  "5d4399c14c690dd5cea764ac1157d890893108a6e7ea5a35dabb76acc8b4a1eb";
export const ACCESS_SESSION_KEY = "relatorio_final_turno_access_v1";
export const STORAGE_KEY = "relatorio_final_turno_state_v1";
export const THEME_KEY = "relatorio_final_turno_theme_v1";
export const CLOUD_QUEUE_KEY = "relatorio_final_turno_cloud_queue_v1";
export const CLOUD_DEVICE_KEY = "relatorio_final_turno_device_v1";
export const CLOUD_API_URL =
  "https://passagem-turno-api.lucassantanals0110.workers.dev";

export const GENERAL_CELL = "GERAL";
export const UNMAPPED_CELL = "SEM_MAPA";

export const CELLS = Object.freeze({
  "01": [2, 5, 15, 19, 23, 24, 25, 26, 27, 29, 30, 35, 46, 47, 48],
  "02": [3, 4, 7, 8, 13, 16, 17, 18, 28, 31, 32, 49, 50, 51, 143],
  "03": [9, 10, 33, 34, 36, 37, 39, 40, 41, 43, 44],
  "04": [42, 52, 53, 57, 58, 59, 60, 61, 64, 65, 66],
  "05": [69, 72, 83, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95],
  "06": [67, 68, 73, 74, 75, 76, 77, 79, 81, 82, 84, 86],
  "07": [45, 54, 55, 56, 62, 63, 70, 71, 78, 80, 102, 103, 110, 111],
  "08": [96, 98, 104, 107, 112, 113, 115, 116, 118, 119, 121, 122],
  "09": [97, 99, 100, 101, 105, 106, 108, 109, 114, 117, 120, 123],
  "10": [6, 124, 125, 126, 127, 128, 129, 130, 134, 135, 136, 137, 138, 139, 140, 141, 142, 144, 145],
});

export const CELL_ORDER = Object.freeze(Object.keys(CELLS));

export const ACTIVE_TYPES = Object.freeze([
  "maintenance",
  "maintenance_prod",
  "maintenance_completed",
  "maintenance_monitoring",
  "setup_active",
  "setup_start",
  "adjustment",
  "manual_pending",
]);

export const TYPE_CONFIG = Object.freeze({
  maintenance: { short: "MANUTENÇÃO", tone: "danger" },
  maintenance_prod: { short: "MANUT. PRODUZINDO", tone: "success" },
  maintenance_completed: { short: "✅ CONCLUSÃO INFORMADA", tone: "warning" },
  maintenance_monitoring: { short: "EM ACOMPANHAMENTO", tone: "info" },
  setup_active: { short: "SETUP", tone: "setup" },
  setup_start: { short: "INICIAR SETUP", tone: "setup" },
  adjustment: { short: "AJUSTE", tone: "warning" },
  manual_pending: { short: "REDEFINIR STATUS", tone: "warning" },
});

export const SECTION_LABELS = Object.freeze({
  maintenance: "MANUTENÇÃO PARADA",
  maintenance_prod: "MANUTENÇÃO PRODUZINDO",
  maintenance_completed: "MANUTENÇÃO CONCLUÍDA INFORMADA",
  maintenance_monitoring: "MÁQUINA EM ACOMPANHAMENTO",
  maintenance_tracking: "DETALHAMENTO DA MANUTENÇÃO",
  setup_active: "SETUP",
  setup_start: "PRÓXIMOS SETUPS",
  adjustment: "AJUSTE",
  future: "SETUP FUTURO",
});
