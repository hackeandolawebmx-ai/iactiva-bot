import { Hono } from "hono";
import type { Tenant } from "./tenants/schema.js";
import type { Store } from "./db/store.js";
import type { Llm } from "./agent/run.js";
import { procesarEntrante, Limitador, type Canal } from "./core/pipeline.js";
import { firmaValida } from "./webhook/signature.js";
import { parsearPayload } from "./webhook/parse.js";

export interface AppDeps {
  store: Store;
  llm: Llm;
  tenants: Tenant[];
  canalPara: (tenant: Tenant) => Canal;
  appSecret: string;
  verifyToken: string;
  /** En Vercel: waitUntil. En pruebas: un colector de promesas. */
  programar: (p: Promise<unknown>) => void;
}

export function crearApp(deps: AppDeps) {
  const app = new Hono();
  const limitador = new Limitador();

  app.get("/", (c) => c.text("iactiva-wabot ok"));

  // Verificacion de Meta
  app.get("/webhook", (c) => {
    const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = c.req.query();
    if (mode === "subscribe" && token && token === deps.verifyToken && challenge) return c.text(challenge, 200);
    return c.text("forbidden", 403);
  });

  app.post("/webhook", async (c) => {
    const crudo = await c.req.text();
    if (!firmaValida(crudo, c.req.header("x-hub-signature-256"), deps.appSecret)) {
      await deps.store.logEvento("firma_invalida", { ip: c.req.header("x-forwarded-for") });
      return c.text("firma invalida", 401);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(crudo);
    } catch {
      return c.text("json invalido", 400);
    }

    // Responder 200 de inmediato; procesar despues.
    deps.programar(procesar(payload));
    return c.text("ok", 200);
  });

  async function procesar(payload: unknown) {
    try {
      for (const ev of parsearPayload(payload)) {
        const tenant = deps.tenants.find((t) => t.whatsapp.phone_number_id === ev.phone_number_id);
        if (!tenant) {
          await deps.store.logEvento("numero_no_registrado", { phone_number_id: ev.phone_number_id });
          continue;
        }
        if (ev.estados.length) await deps.store.logEvento("estados", ev.estados);
        for (const m of ev.mensajes) {
          try {
            await procesarEntrante(
              { store: deps.store, llm: deps.llm, canal: deps.canalPara(tenant), limitador },
              tenant,
              m,
            );
          } catch (e) {
            await deps.store.logEvento("error_mensaje", { id: m.id, error: String(e) });
          }
        }
      }
    } catch (e) {
      await deps.store.logEvento("error_webhook", String(e));
    }
  }

  return app;
}
