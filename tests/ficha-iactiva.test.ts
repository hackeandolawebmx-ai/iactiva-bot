import { describe, expect, it } from "vitest";
import { cargarFicha } from "../src/tenants/load.js";

describe("ficha de iactiva", () => {
  it("es valida y no ofrece precios ni citas", () => {
    const f = cargarFicha("iactiva");
    expect(f.slug).toBe("iactiva");
    expect(f.modulos.map((m) => m.nombre)).toEqual(["faq", "escalamiento"]);
  });

  it("informa el aviso de privacidad al inicio sin bloquear la conversacion", () => {
    const f = cargarFicha("iactiva");
    expect(f.privacidad.pide_consentimiento).toBe(false);
    expect(f.privacidad.avisar_al_inicio).toBe(true);
    expect(f.privacidad.aviso).toMatch(/iactiva\.mx\/aviso-de-privacidad/);
  });
});
