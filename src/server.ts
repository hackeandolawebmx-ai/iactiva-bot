import { serve } from "@hono/node-server";
import { crearApp } from "./app";
import { crearStore } from "./db";
import { llmReal } from "./agent/run";
import { cargarTodas } from "./tenants/load";
import { canalWhatsApp } from "./whatsapp/client";

// Servidor local para desarrollo (pnpm dev). En Vercel se usa api/index.ts.
const app = crearApp({
  store: crearStore(),
  llm: llmReal(),
  tenants: cargarTodas(),
  canalPara: (t) => canalWhatsApp(t.whatsapp.phone_number_id),
  appSecret: process.env.META_APP_SECRET ?? "",
  verifyToken: process.env.META_VERIFY_TOKEN ?? "",
  programar: (p) => void p,
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`Servidor local en http://localhost:${port}  (webhook: /webhook)`);
