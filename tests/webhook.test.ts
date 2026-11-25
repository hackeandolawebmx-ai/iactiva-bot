import { describe, expect, it } from "vitest";
import { crearApp } from "../src/app.js";
import { MemoryStore } from "../src/db/memory.js";
import { firmar } from "../src/webhook/signature.js";
import { canalGrabador, fichaDePrueba, llmFalso, payloadTexto } from "./helpers.js";

const SECRET = "s3cret";

function montar(tenantCambios: Record<string, unknown> = {}) {
  const store = new MemoryStore();
  const { llm, llamadas } = llmFalso("Hola desde el bot");
  const { canal, enviados } = canalGrabador();
  const pendientes: Promise<unknown>[] = [];
  const app = crearApp({
    store,
    llm,
    tenants: [fichaDePrueba(tenantCambios)],
    canalPara: () => canal,
    appSecret: SECRET,
    verifyToken: "token-ok",
    programar: (p) => void pendientes.push(p),
  });
  const post = async (payload: unknown, firma?: string) => {
    const cuerpo = JSON.stringify(payload);
    return app.request("/webhook", {
      method: "POST",
      body: cuerpo,
      headers: { "content-type": "application/json", "x-hub-signature-256": firma ?? firmar(cuerpo, SECRET) },
    });
  };
  const esperar = () => Promise.all(pendientes);
  return { app, store, post, esperar, llamadas, enviados };
}

describe("GET /webhook (verificacion de Meta)", () => {
  it("devuelve el challenge con el token correcto", async () => {
    const { app } = montar();
    const r = await app.request("/webhook?hub.mode=subscribe&hub.verify_token=token-ok&hub.challenge=12345");
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("12345");
  });
  it("rechaza con token incorrecto", async () => {
    const { app } = montar();
    const r = await app.request("/webhook?hub.mode=subscribe&hub.verify_token=malo&hub.challenge=1");
    expect(r.status).toBe(403);
  });
});

describe("POST /webhook", () => {
  it("rechaza con 401 una firma invalida y no procesa nada", async () => {
    const { post, esperar, llamadas } = montar();
    const r = await post(payloadTexto("wamid.1", "hola"), "sha256=" + "0".repeat(64));
    await esperar();
    expect(r.status).toBe(401);
    expect(llamadas).toHaveLength(0);
  });

  it("responde 200 y el bot contesta al mensaje", async () => {
    const { post, esperar, enviados } = montar();
    const r = await post(payloadTexto("wamid.2", "cuanto cuesta la consulta?"));
    expect(r.status).toBe(200);
    await esperar();
    expect(enviados).toEqual([{ a: "5215511112222", texto: "Hola desde el bot" }]);
  });

  it("idempotencia: el mismo message.id solo se procesa una vez", async () => {
    const { post, esperar, llamadas, enviados } = montar();
    await post(payloadTexto("wamid.3", "hola"));
    await post(payloadTexto("wamid.3", "hola")); // reintento de Meta
    await esperar();
    expect(llamadas).toHaveLength(1);
    expect(enviados).toHaveLength(1);
  });

  it("ignora y registra un phone_number_id no registrado", async () => {
    const { post, esperar, llamadas, store } = montar();
    const r = await post(payloadTexto("wamid.4", "hola", "PNID-DESCONOCIDO"));
    await esperar();
    expect(r.status).toBe(200);
    expect(llamadas).toHaveLength(0);
    expect(store.eventos.some((e) => e.tipo === "numero_no_registrado")).toBe(true);
  });

  it("pide consentimiento antes de conversar y despues contesta", async () => {
    const base = fichaDePrueba();
    const { post, esperar, llamadas, enviados } = montar({ privacidad: { ...base.privacidad, pide_consentimiento: true } });
    await post(payloadTexto("wamid.5", "hola"));
    await esperar();
    expect(llamadas).toHaveLength(0);
    expect(enviados[0]?.texto).toMatch(/ACEPTO/);
    await post(payloadTexto("wamid.6", "acepto"));
    await esperar();
    expect(enviados[1]?.texto).toBe(base.personalidad.saludo);
    expect(llamadas).toHaveLength(0);
  });

  it("avisar_al_inicio: agrega el aviso una sola vez a la primera respuesta, sin pedir ACEPTO", async () => {
    const base = fichaDePrueba();
    const { post, esperar, llamadas, enviados } = montar({
      privacidad: { ...base.privacidad, pide_consentimiento: false, avisar_al_inicio: true },
    });
    await post(payloadTexto("wamid.20", "hola"));
    await esperar();
    expect(enviados).toHaveLength(1);
    expect(enviados[0]?.texto).toBe(`Hola desde el bot\n\n${base.privacidad.aviso}`);
    expect(llamadas).toHaveLength(1);
    await post(payloadTexto("wamid.21", "otra cosa"));
    await esperar();
    expect(enviados).toHaveLength(2);
    expect(enviados[1]?.texto).toBe("Hola desde el bot"); // el aviso no se repite
  });

  it("BAJA marca opt-out y confirma sin llamar al modelo", async () => {
    const { post, esperar, llamadas, enviados } = montar();
    await post(payloadTexto("wamid.7", "BAJA"));
    await esperar();
    expect(llamadas).toHaveLength(0);
    expect(enviados[0]?.texto).toMatch(/ya no te enviaremos/i);
  });

  it("un audio no llama al modelo y pide escribir", async () => {
    const { post, esperar, llamadas, enviados } = montar();
    const p = payloadTexto("wamid.8", "x");
    (p.entry[0]!.changes[0]!.value.messages[0] as Record<string, unknown>) = {
      id: "wamid.8",
      from: "5215511112222",
      type: "audio",
      audio: { id: "media-1" },
    };
    await post(p);
    await esperar();
    expect(llamadas).toHaveLength(0);
    expect(enviados[0]?.texto).toMatch(/texto/);
  });
});
