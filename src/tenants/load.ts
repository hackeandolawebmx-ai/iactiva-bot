import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TenantSchema, type Tenant } from "./schema";
import { getModulo, nombresDeModulos } from "../modules";

export const TENANTS_DIR = join(process.cwd(), "tenants");

/** Valida una ficha ya parseada. Lanza Error con todos los problemas juntos. */
export function validarFicha(raw: unknown): Tenant {
  const r = TenantSchema.safeParse(raw);
  if (!r.success) {
    const msgs = r.error.issues.map((i) => `- ${i.path.join(".") || "(raiz)"}: ${i.message}`);
    throw new Error(`Ficha invalida:\n${msgs.join("\n")}`);
  }
  const desconocidos = r.data.modulos.filter((m) => !getModulo(m.nombre)).map((m) => m.nombre);
  if (desconocidos.length) {
    throw new Error(
      `Ficha invalida:\n- modulos: desconocidos ${desconocidos.join(", ")} (disponibles: ${nombresDeModulos().join(", ")})`,
    );
  }
  const errores: string[] = [];
  for (const m of r.data.modulos) {
    try {
      getModulo(m.nombre)?.validarConfig?.(m.config);
    } catch (e) {
      errores.push(`- ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (errores.length) throw new Error(`Ficha invalida:\n${errores.join("\n")}`);
  return r.data;
}

export function cargarFicha(slug: string): Tenant {
  const ruta = join(TENANTS_DIR, `${slug}.json`);
  if (!existsSync(ruta)) throw new Error(`No existe tenants/${slug}.json`);
  return validarFicha(JSON.parse(readFileSync(ruta, "utf8")));
}

export function cargarTodas(): Tenant[] {
  if (!existsSync(TENANTS_DIR)) return [];
  return readdirSync(TENANTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => cargarFicha(f.replace(/\.json$/, "")));
}
