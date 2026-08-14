import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const indexPath = join(root, "index.html");
const html = readFileSync(indexPath, "utf8");

const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length) throw new Error(`IDs HTML duplicados: ${[...new Set(duplicates)].join(", ")}`);
if (/\sonclick\s*=|\sonchange\s*=|\sonsubmit\s*=/i.test(html)) {
  throw new Error("Eventos inline não são permitidos na arquitetura modular.");
}
if (!/<script\s+type="module"\s+src="\.\/src\/js\/app\.js"><\/script>/i.test(html)) {
  throw new Error("Entrada modular app.js não encontrada.");
}

for (const match of html.matchAll(/(?:href|src)=["'](\.[^"']+)["']/g)) {
  const target = join(root, match[1]);
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

console.log(`Validação estática concluída: ${ids.length} IDs únicos e módulos com sintaxe válida.`);
