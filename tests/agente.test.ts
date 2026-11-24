import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/db/memory";
import { procesarEntrante, type Canal, type Entrante } from "../src/core/pipeline";
import type { Llm } from "../src/agent/run";
import { aUtc } from "../src/core/tiempo";
import { fichaDePrueba } from "./helpers";

const RESPONSABLE = "5215599990000";
const CLIENTE = "5215511112222";
const tenant = fichaDePrueba({ escalamiento: { numero: RESPONSABLE, casos: ["Queja"] } });
const AHORA = aUtc("2026-11-16", "10:00", "America/Mexico_City");

type Paso = { texto: string } | { tool: string; input: Record<string, unknown> };

/** Modelo simulado que sigue un guion: cada llamada consume un paso. */
function llmGuion(pasos: Paso[]) {
  const llamadas: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const llm: Llm = async (p) => {
    llamadas.push(structuredClone(p));
    const paso = pasos.shift() ?? { texto: "fin del guion" };
    const esTool = "tool" in paso;
    return {
      id: "msg",
      type: "message",
      role: "assistant",
      model: p.model,
      content: esTool
        ? [{ type: "tool_use", id: `tu_${llamadas.length}`, name: paso.tool, input: paso.input }]
        : [{ type: "text", text: paso.texto, citations: null }],
      stop_reason: esTool ? "tool_use" : "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    } as unknown as Anthropic.Message;
  };
  return { llm, llamadas };
}

function montar(pasos: Paso[]) {
  const store = new MemoryStore();
  const { llm, llamadas } = llmGuion(pasos);
  const enviados: { a: string; texto: string; botones?: string[] }[] = [];
  const canal: Canal = {
    enviarTexto: async (a, texto) => void enviados.push({ a, texto }),
    enviarBotones: async (a, texto, botones) => void enviados.push({ a, texto, botones }),
  };
  let n = 0;
  const decir = (texto: string, de = CLIENTE) =>
    procesarEntrante({ store, llm, canal, ahora: () => AHORA }, tenant, {
      id: `m${n++}`,
      de,
      tipo: "texto",
      texto,
    } satisfies Entrante);
  return { store, decir, enviados, llamadas };
}

describe("bucle de herramientas", () => {
  it("ejecuta la herramienta, devuelve el resultado al modelo y registra la llamada", async () => {
    const { decir, enviados, llamadas } = montar([
      { tool: "agendar_cita", input: { servicio: "Consulta general", fecha: "2026-11-17", hora: "10:00", nombre: "Ana" } },
      { texto: "Listo, tu cita quedo agendada." },
    ]);
    const r = await decir("si, confirmo");
    expect(r?.herramientas[0]?.output).toMatch(/^Cita agendada/);
    expect(enviados.at(-1)?.texto).toBe("Listo, tu cita quedo agendada.");
    const ultimo = llamadas[1]!.messages.at(-1)!;
    expect(JSON.stringify(ultimo.content)).toContain("Cita agendada");
  });

  it("una cita imposible vuelve al modelo como error y no se guarda", async () => {
    const { decir, store } = montar([
      { tool: "agendar_cita", input: { servicio: "Consulta general", fecha: "2026-11-22", hora: "03:00", nombre: "Ana" } },
      { texto: "Ese dia no atendemos." },
    ]);
    const r = await decir("quiero cita el domingo a las 3 am");
    expect(r?.herramientas[0]?.output).toMatch(/^Error/);
    expect(await store.citasEntre(tenant.slug, new Date(0), new Date(8.64e15))).toHaveLength(0);
  });

  it("ofrecer_botones manda el mensaje con botones", async () => {
    const { decir, enviados } = montar([
      { tool: "ofrecer_botones", input: { opciones: ["Confirmar", "Cambiar"] } },
      { texto: "Consulta general, martes 17 a las 10:00. Confirmas?" },
    ]);
    await decir("el martes a las 10");
    expect(enviados.at(-1)?.botones).toEqual(["Confirmar", "Cambiar"]);
  });

  it("el prompt estable va con cache y no contiene secretos del entorno", async () => {
    process.env.META_APP_SECRET = "secreto-que-no-debe-salir";
    const { decir, llamadas } = montar([{ texto: "hola" }]);
    await decir("hola");
    const system = llamadas[0]!.system as Anthropic.TextBlockParam[];
    expect(system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(JSON.stringify(llamadas[0])).not.toContain("secreto-que-no-debe-salir");
  });
});

describe("escalamiento", () => {
  const guion = (): Paso[] => [
    { tool: "escalar_a_humano", input: { motivo: "Pide hablar con una persona", resumen: "Quiere una factura" } },
    { texto: "Una persona del consultorio te contestara por aqui." },
    { texto: "ya no deberia llamarse" },
  ];

  it("avisa al responsable con el resumen y pausa al bot", async () => {
    const { decir, enviados, llamadas } = montar(guion());
    await decir("quiero hablar con alguien");
    const aviso = enviados.find((e) => e.a === RESPONSABLE);
    expect(aviso?.texto).toContain("Quiere una factura");
    expect(aviso?.texto).toContain(CLIENTE);
    expect(enviados.at(-1)).toMatchObject({ a: CLIENTE, texto: "Una persona del consultorio te contestara por aqui." });

    const antes = llamadas.length;
    expect(await decir("hola? sigues ahi?")).toBeNull();
    expect(llamadas.length).toBe(antes); // en pausa: el modelo no se llama
  });

  it("el responsable reactiva con REACTIVAR <telefono>; un cliente no puede", async () => {
    const { decir, enviados, llamadas } = montar(guion());
    await decir("quiero hablar con alguien");
    const antes = llamadas.length;

    await decir(`REACTIVAR ${CLIENTE}`, "5215500000099"); // un tercero: se trata como mensaje normal
    await decir("hola?");
    expect(llamadas.length).toBe(antes + 1); // solo el tercero hablo con el bot; el cliente sigue en pausa

    await decir(`reactivar ${CLIENTE}`, RESPONSABLE);
    expect(enviados.at(-1)).toMatchObject({ a: RESPONSABLE, texto: `Bot reactivado para ${CLIENTE}.` });
    await decir("hola de nuevo");
    expect(llamadas.length).toBe(antes + 2);
  });
});
