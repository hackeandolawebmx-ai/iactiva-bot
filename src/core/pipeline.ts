import type { Tenant } from "../tenants/schema";
import type { Store } from "../db/store";
import { responder, resumirSiToca, type Llm, type RespuestaAgente } from "../agent/run";

export interface Entrante {
  id: string;
  de: string;
  nombre?: string;
  tipo: "texto" | "interactivo" | "ubicacion" | "imagen" | "audio" | "otro";
  texto?: string;
  mediaId?: string;
  ubicacion?: { lat: number; lng: number; nombre?: string };
}

/** Canal de salida: WhatsApp real, consola del laboratorio o pagina web. */
export interface Canal {
  marcarLeido?(mensajeId: string): Promise<void>;
  escribiendo?(mensajeId: string): Promise<void>;
  enviarTexto(a: string, texto: string): Promise<void>;
  /** Texto con botones de respuesta rapida. Si el canal no lo soporta se manda como texto. */
  enviarBotones?(a: string, texto: string, botones: string[]): Promise<void>;
}

export interface Deps {
  store: Store;
  llm: Llm;
  canal: Canal;
  limitador?: Limitador;
  ahora?: () => Date;
}

/** Limite simple por contacto: N mensajes por ventana. En memoria (por instancia). */
export class Limitador {
  private marcas = new Map<string, number[]>();
  constructor(
    private max = 20,
    private ventanaMs = 10 * 60 * 1000,
  ) {}
  permitir(llave: string, ahora = Date.now()): boolean {
    const v = (this.marcas.get(llave) ?? []).filter((t) => ahora - t < this.ventanaMs);
    if (v.length >= this.max) {
      this.marcas.set(llave, v);
      return false;
    }
    v.push(ahora);
    this.marcas.set(llave, v);
    return true;
  }
}

const ACEPTA = /^\s*(acepto|si acepto|de acuerdo|ok acepto)\s*[.!]?\s*$/i;
const BAJA = /^\s*(baja|stop)\s*[.!]?\s*$/i;
const REACTIVAR = /^\s*reactivar\s+\+?(\d{8,15})\s*$/i;
const soloDigitos = (s: string) => s.replace(/\D/g, "");

export function textoDe(m: Entrante): string {
  if (m.tipo === "ubicacion" && m.ubicacion) {
    const u = m.ubicacion;
    return `[El cliente compartio una ubicacion: ${u.lat}, ${u.lng}${u.nombre ? ` (${u.nombre})` : ""}]`;
  }
  return m.texto ?? "";
}

export async function procesarEntrante(deps: Deps, tenant: Tenant, m: Entrante): Promise<RespuestaAgente | null> {
  const { store, llm, canal } = deps;

  if (!(await store.reclamarMensaje(m.id))) {
    await store.logEvento("mensaje_duplicado", { id: m.id, tenant: tenant.slug });
    return null;
  }

  // El responsable reactiva al bot para un cliente escribiendo: REACTIVAR <telefono>
  const orden = REACTIVAR.exec(m.texto ?? "");
  if (orden && soloDigitos(m.de) === soloDigitos(tenant.escalamiento.numero)) {
    const cliente = await store.upsertContacto(tenant.slug, orden[1]!);
    const c = await store.getConversacion(tenant.slug, cliente.id);
    await store.actualizarConversacion(c.id, { pausada: false });
    await store.logEvento("bot_reactivado", { tenant: tenant.slug, contacto: cliente.id });
    await canal.enviarTexto(m.de, `Bot reactivado para ${orden[1]}.`);
    return null;
  }

  const contacto = await store.upsertContacto(tenant.slug, m.de, m.nombre);
  const conv = await store.getConversacion(tenant.slug, contacto.id);
  await store.actualizarConversacion(conv.id, { ultimo_entrante: new Date() });

  const entrante = textoDe(m) || `[${m.tipo}]`;
  await store.addMensaje({ conversacion_id: conv.id, rol: "cliente", contenido: entrante });

  if (conv.pausada) {
    await store.logEvento("conversacion_pausada", { contacto: contacto.id });
    return null; // un humano atiende; el bot calla
  }

  const decir = async (texto: string) => {
    await canal.enviarTexto(m.de, texto);
    await store.addMensaje({ conversacion_id: conv.id, rol: "bot", contenido: texto });
  };

  await canal.marcarLeido?.(m.id).catch(() => {});

  if (BAJA.test(m.texto ?? "")) {
    await store.actualizarContacto(contacto.id, { opt_out: true });
    await decir("Listo, ya no te enviaremos mensajes programados. Si quieres volver, escribenos cuando gustes.");
    return null;
  }

  if (deps.limitador && !deps.limitador.permitir(`${tenant.slug}:${m.de}`)) {
    await store.logEvento("rate_limit", { contacto: contacto.id });
    return null;
  }

  if (tenant.privacidad.pide_consentimiento && !contacto.consentimiento) {
    if (m.tipo === "texto" && ACEPTA.test(m.texto ?? "")) {
      await store.actualizarContacto(contacto.id, { consentimiento: true });
      await decir(tenant.personalidad.saludo);
    } else {
      await decir(`${tenant.privacidad.aviso}\n\nResponde ACEPTO para continuar.`);
    }
    return null;
  }

  if (m.tipo === "imagen" || m.tipo === "audio" || m.tipo === "otro") {
    // Gancho: aqui se procesaran medios mas adelante (m.mediaId).
    await store.logEvento("medio_recibido", { tipo: m.tipo, mediaId: m.mediaId });
    await decir("Por ahora solo puedo leer mensajes de texto. Me escribes lo que necesitas?");
    return null;
  }

  await canal.escribiendo?.(m.id).catch(() => {});

  const r = await responder({
    llm,
    tenant,
    contacto,
    store,
    conversacionId: conv.id,
    resumen: (await store.actualizarConversacion(conv.id, {})).resumen,
    ahora: deps.ahora?.(),
    notificarResponsable: (aviso) => canal.enviarTexto(tenant.escalamiento.numero, aviso),
  });
  const texto = r.texto || "Perdona, no pude responder eso. Te paso con una persona del equipo.";
  if (r.botones?.length && canal.enviarBotones) await canal.enviarBotones(m.de, texto, r.botones);
  else await canal.enviarTexto(m.de, texto);
  await store.addMensaje({
    conversacion_id: conv.id,
    rol: "bot",
    contenido: texto,
    tokens_in: r.tokens_in,
    tokens_out: r.tokens_out,
    latencia_ms: r.latencia_ms,
    herramientas: r.herramientas,
  });
  const actual = await store.actualizarConversacion(conv.id, {});
  await store.actualizarConversacion(conv.id, { mensajes_desde_resumen: actual.mensajes_desde_resumen + 2 });
  await resumirSiToca({ llm, tenant, store, conversacionId: conv.id }).catch((e) =>
    store.logEvento("error_resumen", String(e)),
  );
  return r;
}
