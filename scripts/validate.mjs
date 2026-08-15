import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const indexPath = join(root, "index.html");
const html = readFileSync(indexPath, "utf8");
const appSource = readFileSync(join(root, "src", "js", "app.js"), "utf8");

const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length) throw new Error(`IDs HTML duplicados: ${[...new Set(duplicates)].join(", ")}`);
const referencedIds = [...appSource.matchAll(/\bbyId\(["']([^"']+)["']\)/g)].map(
  (match) => match[1],
);
const missingIds = [...new Set(referencedIds.filter((id) => !ids.includes(id)))];
if (missingIds.length) throw new Error(`IDs usados no app e ausentes no HTML: ${missingIds.join(", ")}`);
if (/\sonclick\s*=|\sonchange\s*=|\sonsubmit\s*=/i.test(html)) {
  throw new Error("Eventos inline não são permitidos na arquitetura modular.");
}
if (!/<script\s+type="module"\s+src="\.\/src\/js\/app\.js(?:\?v=[^"]+)?"><\/script>/i.test(html)) {
  throw new Error("Entrada modular app.js não encontrada.");
}

for (const match of html.matchAll(/(?:href|src)=["'](\.[^"']+)["']/g)) {
  const target = join(root, match[1].split("?")[0]);
  if (!existsSync(target)) throw new Error(`Arquivo referenciado não existe: ${match[1]}`);
}

function filesUnder(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

for (const file of filesUnder(join(root, "src", "js")).filter((path) => extname(path) === ".js")) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `Falha de sintaxe em ${file}`);
}

for (const file of filesUnder(join(root, "styles")).filter((path) => extname(path) === ".css")) {
  const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0;
  for (const character of source) {
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth < 0) throw new Error(`Chave CSS excedente em ${file}`);
  }
  if (depth !== 0) throw new Error(`Bloco CSS incompleto em ${file}`);
  if (/\b(?:min-h|max-h)\s*$/i.test(source.trim())) {
    throw new Error(`Declaração CSS truncada em ${file}`);
  }
}

console.log(`Validação estática concluída: ${ids.length} IDs únicos, JS válido e CSS íntegro.`);
