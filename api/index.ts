import { getRequestListener } from "@hono/node-server";
import { waitUntil } from "@vercel/functions";
import { crearApp } from "../src/app.js";
import { crearStore } from "../src/db/index.js";
import { llmReal } from "../src/agent/run.js";
import { cargarTodas } from "../src/tenants/load.js";
import { canalWhatsApp } from "../src/whatsapp/client.js";

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

// Runtime Node de Vercel: la firma es (req, res). getRequestListener es el
// adaptador de @hono/node-server (en v2 no existe el subpath /vercel).
export default getRequestListener(app.fetch);
