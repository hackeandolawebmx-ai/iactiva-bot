import { describe, expect, it } from "vitest";
import { cargarFicha } from "../src/tenants/load";

describe("ficha de iactiva", () => {
  it("es valida y no ofrece precios ni citas", () => {
    const f = cargarFicha("iactiva");
    expect(f.slug).toBe("iactiva");
    expect(f.modulos.map((m) => m.nombre)).toEqual(["faq", "escalamiento"]);
  });
});
