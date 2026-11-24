import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const raiz = process.cwd();
const dirPlantillas = join(raiz, "tenants", "_plantillas");
const disponibles = existsSync(dirPlantillas)
  ? readdirSync(dirPlantillas).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""))
  : [];

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--"));
const i = args.indexOf("--giro");
const giro = i >= 0 ? args[i + 1] : undefined;

if (!slug || !giro) {
  console.error(`Uso: pnpm tenant:nuevo <slug> --giro <giro>\nGiros disponibles: ${disponibles.join(", ") || "(ninguno)"}`);
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error("El slug solo admite minusculas, numeros y guiones.");
  process.exit(1);
}
if (!disponibles.includes(giro)) {
  console.error(`No existe la plantilla "${giro}". Giros disponibles: ${disponibles.join(", ")}`);
  process.exit(1);
}
const destino = join(raiz, "tenants", `${slug}.json`);
if (existsSync(destino)) {
  console.error(`Ya existe tenants/${slug}.json. No lo sobrescribo.`);
  process.exit(1);
}

const ficha = JSON.parse(readFileSync(join(dirPlantillas, `${giro}.json`), "utf8"));
ficha.slug = slug;
writeFileSync(destino, JSON.stringify(ficha, null, 2) + "\n", "utf8");
console.log(`Creada tenants/${slug}.json a partir de la plantilla "${giro}".`);
console.log(`Siguiente: edita la ficha y prueba con  pnpm lab ${slug}`);
