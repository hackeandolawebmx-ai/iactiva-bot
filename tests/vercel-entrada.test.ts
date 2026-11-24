import { describe, expect, it, vi } from "vitest";

vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => void p }));

describe("api/index.ts (entrada de Vercel)", () => {
  it("carga la ficha de iactiva desde process.cwd() y responde el challenge de Meta", async () => {
    process.env.META_VERIFY_TOKEN = "token-vercel";
    process.env.META_APP_SECRET = "secreto";
    process.env.ANTHROPIC_API_KEY ??= "test";
    const { default: handler } = await import("../api/index.js");
    const r = await handler(
      new Request("http://localhost/webhook?hub.mode=subscribe&hub.verify_token=token-vercel&hub.challenge=98765"),
    );
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("98765");
  });

  it("rechaza el verify token incorrecto", async () => {
    const { default: handler } = await import("../api/index.js");
    const r = await handler(new Request("http://localhost/webhook?hub.mode=subscribe&hub.verify_token=malo&hub.challenge=1"));
    expect(r.status).toBe(403);
  });

  it("cargarTodas() encuentra tenants/iactiva.json", async () => {
    const { cargarTodas } = await import("../src/tenants/load.js");
    expect(cargarTodas().map((t) => t.whatsapp.phone_number_id)).toContain("1373207305886569");
  });
});
