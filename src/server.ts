import { serve } from "@hono/node-server";
import { crearApp } from "./app.js";
import { crearStore } from "./db/index.js";
import { llmReal } from "./agent/run.js";
import { cargarTodas } from "./tenants/load.js";
import { canalWhatsApp } from "./whatsapp/client.js";

// Servidor local para desarrollo (pnpm dev). En Vercel se usa api/index.ts.
const app = crearApp({
  store: crearStore(),
  llm: llmReal(),
  tenants: cargarTodas(),
  canalPara: (t) => canalWhatsApp(t.whatsapp.phone_number_id),
  appSecret: process.env.META_APP_SECRET ?? "",
  verifyToken: process.env.META_VERIFY_TOKEN ?? "",
  leadSecret: process.env.LEAD_SECRET,
  cronSecret: process.env.CRON_SECRET,
  programar: (p) => void p,
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`Servidor local en http://localhost:${port}  (webhook: /webhook)`);
