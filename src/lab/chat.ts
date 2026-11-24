import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { cargarFicha } from "../tenants/load.js";
import { MemoryStore } from "../db/memory.js";
import { SupabaseStore } from "../db/supabase.js";
import { llmReal } from "../agent/run.js";
import { procesarEntrante, type Canal } from "../core/pipeline.js";

const slug = process.argv[2];
if (!slug) {
  console.error("Uso: pnpm lab <slug>   (ej. pnpm lab consultorio-demo)");
  process.exit(1);
}

let tenant: ReturnType<typeof cargarFicha>;
let llm: ReturnType<typeof llmReal>;
try {
  tenant = cargarFicha(slug);
  llm = llmReal();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
// Por defecto memoria (cada sesion empieza limpia). Con --supabase usa la base real.
const store = process.argv.includes("--supabase") ? new SupabaseStore() : new MemoryStore();
const TELEFONO = "5210000000000";

const canal: Canal = {
  enviarTexto: async (a, texto) =>
    a === TELEFONO
      ? console.log(`\n${tenant.personalidad.nombre_asistente}: ${texto}\n`)
      : console.log(`\n  [WhatsApp al responsable ${a}]\n  ${texto.replace(/\n/g, "\n  ")}\n`),
  enviarBotones: async (_a, texto, botones) =>
    console.log(`\n${tenant.personalidad.nombre_asistente}: ${texto}\n  [botones: ${botones.join(" | ")}]\n`),
};

console.log(
  `Laboratorio: ${tenant.nombre} (${tenant.giro}). Comandos: "salir", "reactivar" (quita la pausa tras un escalamiento).\n`,
);

const rl = createInterface({ input: stdin, output: stdout });
let n = 0;
while (true) {
  const linea = (await rl.question("tu: ")).trim();
  if (!linea) continue;
  if (linea === "salir") break;
  if (linea === "reactivar") {
    const c = await store.upsertContacto(tenant.slug, TELEFONO);
    const conv = await store.getConversacion(tenant.slug, c.id);
    await store.actualizarConversacion(conv.id, { pausada: false });
    console.log("  (bot reactivado)\n");
    continue;
  }
  const antes = await store.upsertContacto(tenant.slug, TELEFONO);
  if ((await store.getConversacion(tenant.slug, antes.id)).pausada) {
    console.log('  (bot en pausa: un humano atiende. Escribe "reactivar" para continuar)\n');
  }
  const r = await procesarEntrante(
    { store, llm, canal },
    tenant,
    { id: `lab-${Date.now()}-${n++}`, de: TELEFONO, nombre: "Cliente Lab", tipo: "texto", texto: linea },
  );
  if (r) {
    for (const h of r.herramientas) console.log(`  [herramienta] ${h.name}(${JSON.stringify(h.input)}) -> ${h.output.slice(0, 200)}`);
    console.log(`  [${r.tokens_in} tokens in, ${r.tokens_out} out, ${r.latencia_ms} ms]`);
  }
}
rl.close();
