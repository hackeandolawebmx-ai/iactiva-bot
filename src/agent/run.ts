import Anthropic from "@anthropic-ai/sdk";
import type { Tenant } from "../tenants/schema.js";
import type { Contacto, Store, Mensaje } from "../db/store.js";
import { getModulo, type ToolDef } from "../modules/index.js";
import { promptEstable, promptVariable } from "./prompt.js";

/** Funcion que llama al modelo. Se inyecta para poder probar sin red. */
export type Llm = (p: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

export function llmReal(apiKey = process.env.ANTHROPIC_API_KEY): Llm {
  if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY en .env");
  const client = new Anthropic({ apiKey });
  return (p) => client.messages.create(p);
}

export interface RespuestaAgente {
  texto: string;
  tokens_in: number;
  tokens_out: number;
  latencia_ms: number;
  herramientas: { name: string; input: unknown; output: string }[];
  /** Botones de respuesta rapida que acompanan al texto (maximo 3). */
  botones?: string[];
}

/** Herramienta del nucleo, siempre disponible: adjunta botones a la respuesta. */
const ofrecerBotones: ToolDef = {
  name: "ofrecer_botones",
  description:
    "Adjunta botones de respuesta rapida a tu siguiente mensaje (por ejemplo para confirmar). Maximo 3 botones de hasta 20 caracteres. Despues escribe el mensaje con la pregunta.",
  input_schema: {
    type: "object",
    properties: { opciones: { type: "array", items: { type: "string" }, description: "Textos de los botones" } },
    required: ["opciones"],
  },
  async run(input, ctx) {
    const op = Array.isArray(input.opciones) ? input.opciones.map((o) => String(o).trim()).filter(Boolean) : [];
    if (op.length < 1 || op.length > 3) return "Error: deben ser entre 1 y 3 botones.";
    if (op.some((o) => o.length > 20)) return "Error: cada boton admite maximo 20 caracteres.";
    ctx.salida.botones = op;
    return "Botones listos. Ahora escribe el mensaje que los acompana.";
  },
};

const MAX_VUELTAS = 6;
const VENTANA_HISTORIAL = 12;
const RESUMIR_CADA = 10;

function herramientasActivas(t: Tenant) {
  const out: { tool: ToolDef; config: Record<string, unknown> }[] = [{ tool: ofrecerBotones, config: {} }];
  for (const m of t.modulos) {
    for (const tool of getModulo(m.nombre)?.tools?.() ?? []) out.push({ tool, config: m.config });
  }
  return out;
}

function historialAMensajes(hist: Mensaje[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of hist) {
    const role = m.rol === "cliente" ? "user" : "assistant";
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.content = `${prev.content as string}\n${m.contenido}`;
    else out.push({ role, content: m.contenido });
  }
  // La API exige que el primer mensaje sea del usuario.
  while (out[0] && out[0].role !== "user") out.shift();
  return out;
}

export async function responder(args: {
  llm: Llm;
  tenant: Tenant;
  contacto: Contacto;
  store: Store;
  conversacionId: string;
  resumen: string;
  ahora?: Date;
  notificarResponsable: (texto: string) => Promise<void>;
  /** El mensaje nuevo del cliente ya debe estar guardado en el historial. */
}): Promise<RespuestaAgente> {
  const { llm, tenant, contacto, store, conversacionId, resumen } = args;
  const ahora = args.ahora ?? new Date();
  const salida: { botones?: string[] } = {};
  const t0 = Date.now();
  const hist = await store.ultimosMensajes(conversacionId, VENTANA_HISTORIAL);
  const messages = historialAMensajes(hist);
  const activas = herramientasActivas(tenant);
  const tools: Anthropic.Tool[] = activas.map(({ tool }) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  }));
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: promptEstable(tenant), cache_control: { type: "ephemeral" } },
    { type: "text", text: promptVariable(tenant, resumen, ahora) },
  ];

  let tokens_in = 0;
  let tokens_out = 0;
  const herramientas: RespuestaAgente["herramientas"] = [];

  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
    const res = await llm({
      model: tenant.modelo.nombre,
      max_tokens: 700,
      system,
      messages,
      ...(tools.length ? { tools } : {}),
    });
    tokens_in += res.usage.input_tokens;
    tokens_out += res.usage.output_tokens;

    const usos = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || usos.length === 0) {
      const texto = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { texto, tokens_in, tokens_out, latencia_ms: Date.now() - t0, herramientas, botones: salida.botones };
    }

    messages.push({ role: "assistant", content: res.content });
    const resultados: Anthropic.ToolResultBlockParam[] = [];
    for (const uso of usos) {
      const def = activas.find((a) => a.tool.name === uso.name);
      let output: string;
      try {
        output = def
          ? await def.tool.run(uso.input as Record<string, unknown>, {
              tenant,
              contacto,
              store,
              conversacionId,
              config: def.config,
              ahora,
              salida,
              notificarResponsable: args.notificarResponsable,
            })
          : `Herramienta desconocida: ${uso.name}`;
      } catch (e) {
        output = `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
      herramientas.push({ name: uso.name, input: uso.input, output });
      resultados.push({ type: "tool_result", tool_use_id: uso.id, content: output });
    }
    messages.push({ role: "user", content: resultados });
  }

  return {
    texto: "Dame un momento, voy a pedir apoyo a una persona del equipo para ayudarte.",
    tokens_in,
    tokens_out,
    latencia_ms: Date.now() - t0,
    herramientas,
  };
}

/** Actualiza el resumen cada RESUMIR_CADA mensajes. */
export async function resumirSiToca(args: {
  llm: Llm;
  tenant: Tenant;
  store: Store;
  conversacionId: string;
}) {
  const { llm, tenant, store, conversacionId } = args;
  const conv = await store.actualizarConversacion(conversacionId, {});
  if (conv.mensajes_desde_resumen < RESUMIR_CADA) return;
  const recientes = await store.ultimosMensajes(conversacionId, RESUMIR_CADA + 4);
  const texto = recientes.map((m) => `${m.rol}: ${m.contenido}`).join("\n");
  const res = await llm({
    model: tenant.modelo.nombre,
    max_tokens: 400,
    system:
      "Resume la conversacion de WhatsApp en maximo 8 lineas: datos del cliente, lo que pidio, acuerdos, pendientes. Solo hechos, sin inventar.",
    messages: [
      { role: "user", content: `Resumen previo:\n${conv.resumen || "(ninguno)"}\n\nMensajes nuevos:\n${texto}` },
    ],
  });
  const nuevo = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  await store.actualizarConversacion(conversacionId, { resumen: nuevo, mensajes_desde_resumen: 0 });
}
