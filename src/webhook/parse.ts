import type { Entrante } from "../core/pipeline";

export interface EventoParseado {
  phone_number_id: string;
  mensajes: Entrante[];
  /** Estados de entrega (sent/delivered/read/failed): por ahora solo se registran. */
  estados: unknown[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export function parsearPayload(payload: Json): EventoParseado[] {
  const out: EventoParseado[] = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const v = change?.value;
      const pnid = v?.metadata?.phone_number_id;
      if (!pnid) continue;
      const nombres = new Map<string, string>();
      for (const c of v.contacts ?? []) if (c?.wa_id) nombres.set(c.wa_id, c.profile?.name);
      const mensajes: Entrante[] = [];
      for (const msg of v.messages ?? []) {
        const base = { id: msg.id as string, de: msg.from as string, nombre: nombres.get(msg.from) };
        switch (msg.type) {
          case "text":
            mensajes.push({ ...base, tipo: "texto", texto: msg.text?.body });
            break;
          case "interactive": {
            const i = msg.interactive;
            const r = i?.button_reply ?? i?.list_reply;
            mensajes.push({ ...base, tipo: "interactivo", texto: r?.title ?? r?.id });
            break;
          }
          case "button": // respuesta a boton de plantilla
            mensajes.push({ ...base, tipo: "interactivo", texto: msg.button?.text ?? msg.button?.payload });
            break;
          case "location":
            mensajes.push({
              ...base,
              tipo: "ubicacion",
              ubicacion: { lat: msg.location?.latitude, lng: msg.location?.longitude, nombre: msg.location?.name },
            });
            break;
          case "image":
            mensajes.push({ ...base, tipo: "imagen", mediaId: msg.image?.id, texto: msg.image?.caption });
            break;
          case "audio":
            mensajes.push({ ...base, tipo: "audio", mediaId: msg.audio?.id });
            break;
          default:
            mensajes.push({ ...base, tipo: "otro" });
        }
      }
      out.push({ phone_number_id: pnid, mensajes, estados: v.statuses ?? [] });
    }
  }
  return out;
}
