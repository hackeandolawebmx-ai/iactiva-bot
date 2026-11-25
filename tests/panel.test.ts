import { describe, expect, it } from "vitest";
import { crearApp } from "../src/app.js";
import { MemoryStore } from "../src/db/memory.js";
import { canalGrabador, fichaDePrueba, llmFalso } from "./helpers.js";

const CLAVE = "clave-de-prueba-larga";

async function montar(opciones: { adminKey?: string; fallaEnvio?: boolean } = { adminKey: CLAVE }) {
  const store = new MemoryStore();
  const tenant = fichaDePrueba();
  const c = canalGrabador();
  if (opciones.fallaEnvio) c.canal.enviarTexto = async () => Promise.reject(new Error("Graph 400"));
  const app = crearApp({
    store,
    llm: llmFalso().llm,
    tenants: [tenant],
    canalPara: () => c.canal,
    appSecret: "s",
    verifyToken: "v",
    adminKey: opciones.adminKey,
    programar: () => {},
  });
  const contacto = await store.upsertContacto(tenant.slug, "528100000000", "Ana <script>x</script>");
  const conv = await store.getConversacion(tenant.slug, contacto.id);
  await store.actualizarConversacion(conv.id, { ultimo_entrante: new Date() });
  await store.addMensaje({ conversacion_id: conv.id, rol: "cliente", contenido: "<img src=x onerror=alert(1)>" });
  const lead = await store.crearLead({
    tenant: tenant.slug, contacto_id: contacto.id, negocio: "Tacos", nombre: "Ana", dolor: "pedidos", detalle: "", ref: "reel1",
  });
  const post = (ruta: string, datos: Record<string, string>, cabeceras: Record<string, string> = {}) =>
    app.request(ruta, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...cabeceras },
      body: new URLSearchParams(datos).toString(),
    });
  const entrar = async () => {
    const r = await post("/admin/login", { clave: CLAVE });
    return { cookie: r.headers.get("set-cookie")!.split(";")[0]! };
  };
  return { app, store, tenant, conv, contacto, lead: lead!, post, entrar, enviados: c.enviados };
}

describe("panel /admin", () => {
  it("sin ADMIN_KEY o con una corta no existe", async () => {
    for (const adminKey of [undefined, "corta"]) {
      const { app } = await montar({ adminKey });
      expect((await app.request("/admin")).status).toBe(503);
    }
  });

  it("sin sesion no muestra datos ni deja actuar", async () => {
    const { app, conv, post, enviados, store, contacto, tenant } = await montar();
    const inicio = await (await app.request("/admin")).text();
    expect(inicio).toContain("Contraseña");
    expect(inicio).not.toContain("Tacos");
    expect((await app.request(`/admin/c/${conv.id}`)).status).toBe(303);
    expect((await post(`/admin/c/${conv.id}/responder`, { texto: "hola" })).status).toBe(303);
    expect((await post(`/admin/c/${conv.id}/chip`, { pausar: "1" })).status).toBe(303);
    expect(enviados).toHaveLength(0);
    expect((await store.getConversacion(tenant.slug, contacto.id)).pausada).toBe(false);
  });

  it("rechaza clave mala, cookie falsa y limita los intentos", async () => {
    const { app, post } = await montar();
    expect((await post("/admin/login", { clave: "mala" })).status).toBe(401);
    const falsa = await app.request("/admin", { headers: { cookie: `panel=${Date.now() + 100000}.abc` } });
    expect(await falsa.text()).not.toContain("Tacos");
    for (let i = 0; i < 4; i++) await post("/admin/login", { clave: "mala" });
    expect((await post("/admin/login", { clave: CLAVE })).status).toBe(429);
  });

  it("la cookie es segura y la lista escapa el contenido", async () => {
    const { app, post, entrar, conv } = await montar();
    const r = await post("/admin/login", { clave: CLAVE });
    expect(r.headers.get("set-cookie")).toMatch(/HttpOnly.*Secure.*SameSite=Strict/);
    const cabeceras = await entrar();
    for (const ruta of ["/admin", `/admin/c/${conv.id}`]) {
      const res = await app.request(ruta, { headers: cabeceras });
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain("Tacos");
      expect(html).toContain("reel1");
      expect(html).not.toContain("<img src=x");
      expect(html).not.toContain("<script>x");
      expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    }
  });

  it("responder envia, guarda como humano y pausa a Chip", async () => {
    const { post, entrar, conv, enviados, store, contacto, tenant } = await montar();
    const r = await post(`/admin/c/${conv.id}/responder`, { texto: " Va, te llamo " }, await entrar());
    expect(r.headers.get("location")).toContain("m=enviado");
    expect(enviados).toEqual([{ a: "528100000000", texto: "Va, te llamo" }]);
    expect((await store.ultimosMensajes(conv.id, 1))[0]).toMatchObject({ rol: "humano", contenido: "Va, te llamo" });
    expect((await store.getConversacion(tenant.slug, contacto.id)).pausada).toBe(true);
  });

  it("fuera de 24 h no envia", async () => {
    const { post, entrar, conv, enviados, store } = await montar();
    await store.actualizarConversacion(conv.id, { ultimo_entrante: new Date(Date.now() - 25 * 3600 * 1000) });
    const r = await post(`/admin/c/${conv.id}/responder`, { texto: "hola" }, await entrar());
    expect(r.headers.get("location")).toContain("m=ventana");
    expect(enviados).toHaveLength(0);
  });

  it("si WhatsApp falla no guarda el mensaje ni deja pausado a Chip", async () => {
    const { post, entrar, conv, store, contacto, tenant } = await montar({ adminKey: CLAVE, fallaEnvio: true });
    const r = await post(`/admin/c/${conv.id}/responder`, { texto: "hola" }, await entrar());
    expect(r.headers.get("location")).toContain("m=fallo");
    expect(await store.ultimosMensajes(conv.id, 10)).toHaveLength(1);
    expect((await store.getConversacion(tenant.slug, contacto.id)).pausada).toBe(false);
  });

  it("pausa, reactiva y cambia el estado del lead", async () => {
    const { post, entrar, conv, store, contacto, tenant } = await montar();
    const h = await entrar();
    await post(`/admin/c/${conv.id}/chip`, { pausar: "1" }, h);
    expect((await store.getConversacion(tenant.slug, contacto.id)).pausada).toBe(true);
    await post(`/admin/c/${conv.id}/chip`, { pausar: "0" }, h);
    expect((await store.getConversacion(tenant.slug, contacto.id)).pausada).toBe(false);
    await post(`/admin/c/${conv.id}/estado`, { estado: "propuesta" }, h);
    expect((await store.getLead(tenant.slug, contacto.id))?.estado).toBe("propuesta");
    expect((await post(`/admin/c/${conv.id}/estado`, { estado: "otro" }, h)).status).toBe(400);
  });

  it("rechaza formularios de otro sitio y conversaciones de otro negocio", async () => {
    const { app, post, entrar, conv, store, enviados } = await montar();
    const h = await entrar();
    const ajeno = await post(`/admin/c/${conv.id}/responder`, { texto: "x" }, { ...h, origin: "https://malo.example" });
    expect(ajeno.status).toBe(403);
    expect(enviados).toHaveLength(0);
    const otro = await store.upsertContacto("otro", "528111111111");
    const convOtro = await store.getConversacion("otro", otro.id);
    expect((await app.request(`/admin/c/${convOtro.id}`, { headers: h })).status).toBe(404);
    expect((await app.request("/admin/c/no-es-id", { headers: h })).status).toBe(404);
  });
});
