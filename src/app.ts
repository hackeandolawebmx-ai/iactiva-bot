import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { LeadSchema, registrarLead, mandarSeguimientos } from "./leads/leads.js";
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
  /** Secreto compartido con la web para POST /leads. */
  leadSecret?: string;
  /** Vercel Cron lo manda como Bearer en GET /cron/seguimiento. */
  cronSecret?: string;
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

  const autorizado = (cabecera: string | undefined, secreto: string) => {
    const h = (s: string) => createHash("sha256").update(s).digest();
    return timingSafeEqual(h(cabecera ?? ""), h(`Bearer ${secreto}`));
  };
  const negocioDeLeads = () => deps.tenants.find((t) => t.slug === "iactiva") ?? deps.tenants[0]!;

  app.post("/leads", async (c) => {
    if (!deps.leadSecret) return c.text("sin configurar", 503);
    if (!autorizado(c.req.header("authorization"), deps.leadSecret)) return c.text("no autorizado", 401);
    const datos = LeadSchema.safeParse(await c.req.json().catch(() => null));
    if (!datos.success) return c.json({ error: "datos invalidos" }, 400);
    const tenant = negocioDeLeads();
    deps.programar(
      registrarLead({ store: deps.store, canal: deps.canalPara(tenant) }, tenant, datos.data).catch((e) =>
        deps.store.logEvento("error_lead", String(e)),
      ),
    );
    return c.json({ ok: true }, 202);
  });

  app.get("/cron/seguimiento", async (c) => {
    if (!deps.cronSecret) return c.text("sin configurar", 503);
    if (!autorizado(c.req.header("authorization"), deps.cronSecret)) return c.text("no autorizado", 401);
    const tenant = negocioDeLeads();
    const enviados = await mandarSeguimientos({ store: deps.store, canal: deps.canalPara(tenant) }, tenant);
    return c.json({ ok: true, enviados });
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
