import type Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validarFicha } from "../src/tenants/load";
import type { Canal } from "../src/core/pipeline";
import type { Llm } from "../src/agent/run";

export function fichaDePrueba(cambios: Record<string, unknown> = {}) {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "consultorio.json"), "utf8"));
  return validarFicha({
    ...raw,
    whatsapp: { phone_number_id: "PNID-1", waba_id: "WABA-1" },
    privacidad: { ...raw.privacidad, pide_consentimiento: false },
    ...cambios,
  });
}

/** Modelo simulado: responde siempre con el texto dado y cuenta las llamadas. */
export function llmFalso(texto = "Respuesta de prueba") {
  const llamadas: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const llm: Llm = async (p) => {
    llamadas.push(p);
    return {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: p.model,
      content: [{ type: "text", text: texto, citations: null }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    } as unknown as Anthropic.Message;
  };
  return { llm, llamadas };
}

export function canalGrabador() {
  const enviados: { a: string; texto: string }[] = [];
  const canal: Canal = { enviarTexto: async (a, texto) => void enviados.push({ a, texto }) };
  return { canal, enviados };
}

export function payloadTexto(id: string, texto: string, pnid = "PNID-1", de = "5215511112222") {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA-1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: pnid },
              contacts: [{ wa_id: de, profile: { name: "Cliente" } }],
              messages: [{ id, from: de, type: "text", text: { body: texto } }],
            },
          },
        ],
      },
    ],
  };
}
