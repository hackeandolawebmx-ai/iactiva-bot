import type { Canal } from "../core/pipeline";

async function graph(path: string, body: unknown, token: string): Promise<void> {
  const version = process.env.META_GRAPH_VERSION || "v23.0";
  const res = await fetch(`https://graph.facebook.com/${version}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Graph API ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/** Canal real de WhatsApp Cloud API para un numero (phone_number_id). */
export function canalWhatsApp(phoneNumberId: string, token = process.env.META_SYSTEM_USER_TOKEN): Canal {
  if (!token) throw new Error("Falta META_SYSTEM_USER_TOKEN");
  return {
    // Marcar como leido y mostrar "escribiendo" van en la misma llamada de la Cloud API.
    marcarLeido: (id) =>
      graph(
        `${phoneNumberId}/messages`,
        { messaging_product: "whatsapp", status: "read", message_id: id, typing_indicator: { type: "text" } },
        token,
      ),
    enviarBotones: (a, texto, botones) =>
      graph(
        `${phoneNumberId}/messages`,
        {
          messaging_product: "whatsapp",
          to: a,
          type: "interactive",
          interactive: {
            type: "button",
            body: { text: texto },
            action: {
              buttons: botones.slice(0, 3).map((b, i) => ({ type: "reply", reply: { id: `b${i}`, title: b.slice(0, 20) } })),
            },
          },
        },
        token,
      ),
    enviarTexto: (a, texto) =>
      graph(
        `${phoneNumberId}/messages`,
        { messaging_product: "whatsapp", to: a, type: "text", text: { body: texto, preview_url: false } },
        token,
      ),
  };
}
