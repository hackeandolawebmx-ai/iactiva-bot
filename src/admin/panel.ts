import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Limitador, type Canal } from "../core/pipeline.js";
import type { EstadoLead, Store } from "../db/store.js";
import type { Tenant } from "../tenants/schema.js";
import { AVISOS, ESTADOS, ventanaAbierta, vistaChat, vistaLista, vistaLogin, type Filtro } from "./vistas.js";

export interface DepsPanel {
  store: Store;
  tenant: () => Tenant;
  canalPara: (tenant: Tenant) => Canal;
  /** ADMIN_KEY: contraseña del panel. Sin ella (o muy corta) el panel no existe. */
  adminKey?: string;
  ahora?: () => Date;
}

export const LARGO_MINIMO_CLAVE = 12;
const COOKIE = "panel";
const DURACION = 30 * 24 * 60 * 60; // segundos
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const huella = (s: string) => createHash("sha256").update(s).digest();
const igual = (a: string, b: string) => timingSafeEqual(huella(a), huella(b));
const firmar = (exp: string, clave: string) => createHmac("sha256", clave).update(`panel:${exp}`).digest("base64url");

export function crearPanel(deps: DepsPanel) {
  const panel = new Hono();
  // En memoria por instancia: frena intentos seguidos; la defensa real es una clave larga.
  const intentos = new Limitador(5, 15 * 60 * 1000);
  const ahora = () => deps.ahora?.() ?? new Date();
  const clave = () => (deps.adminKey && deps.adminKey.length >= LARGO_MINIMO_CLAVE ? deps.adminKey : null);

  panel.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "same-origin");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    if (!clave()) return c.text("panel sin configurar", 503);
    // Un formulario enviado desde otro sitio no se acepta.
    if (c.req.method === "POST") {
      const origen = c.req.header("origin");
      const anfitrion = c.req.header("host") ?? new URL(c.req.url).host;
      if (c.req.header("sec-fetch-site") === "cross-site" || (origen && !mismoAnfitrion(origen, anfitrion))) {
        return c.text("origen no permitido", 403);
      }
    }
    await next();
  });

  const conSesion = (c: Context) => {
    const [exp, firma] = (getCookie(c, COOKIE) ?? "").split(".");
    if (!exp || !firma || !(Number(exp) > ahora().getTime())) return false;
    return igual(firma, firmar(exp, clave()!));
  };

  panel.post("/login", async (c) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (!intentos.permitir(ip, ahora().getTime())) {
      return c.html(vistaLogin("Demasiados intentos. Espera 15 minutos."), 429);
    }
    const cuerpo = await c.req.parseBody();
    if (!igual(String(cuerpo["clave"] ?? ""), clave()!)) {
      await deps.store.logEvento("panel_clave_incorrecta", { ip });
      return c.html(vistaLogin("Contraseña incorrecta."), 401);
    }
    const exp = String(ahora().getTime() + DURACION * 1000);
    setCookie(c, COOKIE, `${exp}.${firmar(exp, clave()!)}`, {
      path: "/admin",
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      maxAge: DURACION,
    });
    return c.redirect("/admin", 303);
  });

  panel.get("/", async (c) => {
    if (!conSesion(c)) return c.html(vistaLogin());
    const ver = c.req.query("ver");
    const filtro: Filtro = ver === "toca" || ver === "leads" ? ver : "todas";
    return c.html(vistaLista(await deps.store.listarConversaciones(deps.tenant().slug, 200), filtro, ahora()));
  });

  // Todo lo que sigue exige sesion.
  panel.use("*", async (c, next) => {
    if (!conSesion(c)) return c.redirect("/admin", 303);
    await next();
  });

  panel.post("/salir", (c) => {
    deleteCookie(c, COOKIE, { path: "/admin", secure: true });
    return c.redirect("/admin", 303);
  });

  const buscar = async (id: string) =>
    UUID.test(id) ? deps.store.getResumenConversacion(deps.tenant().slug, id) : null;
  const volver = (c: Context, id: string, aviso: keyof typeof AVISOS) =>
    c.redirect(`/admin/c/${id}?m=${aviso}#responder`, 303);

  panel.get("/c/:id", async (c) => {
    const r = await buscar(c.req.param("id"));
    if (!r) return c.text("no existe", 404);
    const mensajes = await deps.store.ultimosMensajes(r.conversacion.id, 200);
    const m = c.req.query("m") ?? "";
    return c.html(vistaChat(r, mensajes, ahora(), Object.hasOwn(AVISOS, m) ? AVISOS[m] : undefined));
  });

  panel.post("/c/:id/responder", async (c) => {
    const r = await buscar(c.req.param("id"));
    if (!r) return c.text("no existe", 404);
    const id = r.conversacion.id;
    const texto = String((await c.req.parseBody())["texto"] ?? "").replace(/\r\n/g, "\n").trim();
    if (!texto || texto.length > 4000) return volver(c, id, "vacio");
    if (!ventanaAbierta(r, ahora())) return volver(c, id, "ventana");
    // Se pausa antes de enviar para que Chip no conteste encima.
    await deps.store.actualizarConversacion(id, { pausada: true });
    try {
      await deps.canalPara(deps.tenant()).enviarTexto(r.contacto.telefono, texto);
    } catch (e) {
      await deps.store.actualizarConversacion(id, { pausada: r.conversacion.pausada });
      await deps.store.logEvento("error_panel_envio", { conversacion: id, error: String(e) });
      return volver(c, id, "fallo");
    }
    await deps.store.addMensaje({ conversacion_id: id, rol: "humano", contenido: texto });
    return volver(c, id, "enviado");
  });

  panel.post("/c/:id/chip", async (c) => {
    const r = await buscar(c.req.param("id"));
    if (!r) return c.text("no existe", 404);
    const pausar = (await c.req.parseBody())["pausar"] === "1";
    await deps.store.actualizarConversacion(r.conversacion.id, { pausada: pausar });
    return volver(c, r.conversacion.id, pausar ? "pausado" : "reactivado");
  });

  panel.post("/c/:id/estado", async (c) => {
    const r = await buscar(c.req.param("id"));
    if (!r?.lead) return c.text("no existe", 404);
    const estado = String((await c.req.parseBody())["estado"] ?? "");
    if (!Object.hasOwn(ESTADOS, estado)) return c.text("estado invalido", 400);
    await deps.store.actualizarLead(r.lead.id, { estado: estado as EstadoLead });
    return volver(c, r.conversacion.id, "estado");
  });

  return panel;
}

function mismoAnfitrion(origen: string, anfitrion: string) {
  try {
    return new URL(origen).host === anfitrion;
  } catch {
    return false;
  }
}
