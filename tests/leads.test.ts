import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/db/memory.js";
import { crearApp } from "../src/app.js";
import { registrarLead, mandarSeguimientos, TOPE_DIARIO } from "../src/leads/leads.js";
import { telefonoCanonico } from "../src/leads/telefono.js";
import { procesarEntrante } from "../src/core/pipeline.js";
import { fichaDePrueba, llmFalso } from "./helpers.js";

const datos = { negocio: "Las delicias", nombre: "Juan Perez", whatsapp: "8100000000", dolor: "Pedidos", detalle: "", ref: "" };
const tenant = fichaDePrueba();

function canal() {
  const plantillas: { a: string; nombre: string }[] = [];
  return {
    plantillas,
    canal: {
      enviarTexto: async () => {},
      enviarPlantilla: async (a: string, nombre: string) => void plantillas.push({ a, nombre }),
    },
  };
}

describe("leads", () => {
  it("unifica el telefono del formulario y el de WhatsApp", () => {
    expect(telefonoCanonico("8100000000")).toBe("528100000000");
    expect(telefonoCanonico("5218100000000")).toBe("528100000000");
  });

  it("avisa, da la bienvenida una sola vez y guarda el estado", async () => {
    const store = new MemoryStore();
    const c = canal();
    expect(await registrarLead({ store, canal: c.canal }, tenant, datos)).toBe("contactado");
    expect(await registrarLead({ store, canal: c.canal }, tenant, datos)).toBe("repetido");
    expect(c.plantillas.map((p) => p.nombre)).toEqual(["lead_aviso", "lead_bienvenida"]);
    expect(store.leads[0]!.estado).toBe("contactado");
  });

  it("si falla el envio queda en nuevo y se puede reintentar", async () => {
    const store = new MemoryStore();
    const malo = { enviarTexto: async () => {}, enviarPlantilla: async () => Promise.reject(new Error("x")) };
    expect(await registrarLead({ store, canal: malo }, tenant, datos)).toBe("error_envio");
    expect(await registrarLead({ store, canal: canal().canal }, tenant, datos)).toBe("contactado");
  });

  it("respeta el tope diario", async () => {
    const store = new MemoryStore();
    const c = canal();
    for (let i = 0; i < TOPE_DIARIO; i++)
      await registrarLead({ store, canal: c.canal }, tenant, { ...datos, whatsapp: String(8110000000 + i) });
    expect(await registrarLead({ store, canal: c.canal }, tenant, datos)).toBe("tope");
  });

  it("manda un solo seguimiento despues de 24 h", async () => {
    const store = new MemoryStore();
    const c = canal();
    await registrarLead({ store, canal: c.canal }, tenant, datos);
    const manana = () => new Date(Date.now() + 25 * 3600_000);
    expect(await mandarSeguimientos({ store, canal: c.canal }, tenant)).toBe(0);
    expect(await mandarSeguimientos({ store, canal: c.canal, ahora: manana }, tenant)).toBe(1);
    expect(await mandarSeguimientos({ store, canal: c.canal, ahora: manana }, tenant)).toBe(0);
  });

  it("no manda seguimiento si ya contesto, y el modelo recibe el contexto", async () => {
    const store = new MemoryStore();
    const c = canal();
    const m = llmFalso();
    await registrarLead({ store, canal: c.canal }, tenant, datos);
    await procesarEntrante({ store, llm: m.llm, canal: c.canal }, tenant, { id: "1", de: "5218100000000", tipo: "texto", texto: "Unos 50" });
    expect(JSON.stringify(m.llamadas[0]!.system)).toContain("Las delicias");
    expect(store.leads[0]!.estado).toBe("en_conversacion");
    const manana = () => new Date(Date.now() + 25 * 3600_000);
    expect(await mandarSeguimientos({ store, canal: c.canal, ahora: manana }, tenant)).toBe(0);
  });

  it("los endpoints exigen secreto", async () => {
    const app = crearApp({
      store: new MemoryStore(), llm: llmFalso().llm, tenants: [tenant], canalPara: () => canal().canal,
      appSecret: "s", verifyToken: "v", leadSecret: "abc", cronSecret: "def", programar: () => {},
    });
    const post = (auth: string) =>
      app.request("/leads", { method: "POST", headers: { authorization: auth }, body: JSON.stringify(datos) });
    expect((await post("Bearer mal")).status).toBe(401);
    expect((await post("Bearer abc")).status).toBe(202);
    expect((await app.request("/cron/seguimiento")).status).toBe(401);
  });
});
