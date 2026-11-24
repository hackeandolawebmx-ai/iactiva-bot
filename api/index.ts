import { handle } from "hono/vercel";
import { waitUntil } from "@vercel/functions";
import { crearApp } from "../src/app";
import { crearStore } from "../src/db";
import { llmReal } from "../src/agent/run";
import { cargarTodas } from "../src/tenants/load";
import { canalWhatsApp } from "../src/whatsapp/client";

// Entrada de Vercel (runtime Node). Dependencias construidas una sola vez.
// Mismo cableado que src/server.ts, pero el webhook responde 200 y el
// procesamiento sigue en segundo plano con waitUntil.
export const app = crearApp({
  store: crearStore(),
  llm: llmReal(),
  tenants: cargarTodas(),
  canalPara: (t) => canalWhatsApp(t.whatsapp.phone_number_id),
  appSecret: process.env.META_APP_SECRET ?? "",
  verifyToken: process.env.META_VERIFY_TOKEN ?? "",
  programar: (p) => waitUntil(p),
});

const handler = handle(app);

export const GET = handler;
export const POST = handler;
export default handler;
