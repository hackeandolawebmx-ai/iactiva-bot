import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => void p }));

let server: Server;
let base: string;

beforeAll(async () => {
  process.env.META_VERIFY_TOKEN = "token-vercel";
  process.env.META_APP_SECRET = "secreto";
  process.env.ANTHROPIC_API_KEY ??= "test";
  const { default: handler } = await import("../api/index.js");
  // El handler de Node de Vercel tiene firma (req, res): se prueba con un servidor real.
  server = createServer(handler);
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((ok) => server.close(ok));
});

describe("api/index.ts (entrada de Vercel, runtime Node)", () => {
  it("el default export es un handler (req, res), no devuelve Response", () => {
    return import("../api/index.js").then(({ default: h }) => {
      expect(typeof h).toBe("function");
      expect(h.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("GET /webhook con el token correcto devuelve 200 y el challenge", async () => {
    const r = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=token-vercel&hub.challenge=98765`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("98765");
  });

  it("GET /webhook con token malo devuelve 403", async () => {
    const r = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=malo&hub.challenge=1`);
    expect(r.status).toBe(403);
  });

  it("cargarTodas() encuentra tenants/iactiva.json", async () => {
    const { cargarTodas } = await import("../src/tenants/load.js");
    expect(cargarTodas().map((t) => t.whatsapp.phone_number_id)).toContain("1373207305886569");
  });
});
