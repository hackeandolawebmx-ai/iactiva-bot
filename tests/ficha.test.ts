import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validarFicha } from "../src/tenants/load.js";

const plantilla = () =>
  JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "consultorio.json"), "utf8"));

describe("validacion de la ficha", () => {
  it("la plantilla de consultorio es valida y aplica defaults", () => {
    const t = validarFicha(plantilla());
    expect(t.giro).toBe("consultorio");
    expect(t.modelo.nombre).toBe("claude-haiku-5-5");
  });
  it("rechaza un slug con mayusculas o espacios", () => {
    expect(() => validarFicha({ ...plantilla(), slug: "Mi Negocio" })).toThrow(/slug/);
  });
  it("rechaza si falta un campo obligatorio y lista el problema", () => {
    const f = plantilla();
    delete f.privacidad;
    expect(() => validarFicha(f)).toThrow(/privacidad/);
  });
  it("rechaza un modulo que no existe", () => {
    const f = plantilla();
    f.modulos = [{ nombre: "inexistente", config: {} }];
    expect(() => validarFicha(f)).toThrow(/inexistente/);
  });
  it("rechaza precios negativos", () => {
    const f = plantilla();
    f.negocio.servicios[0].precio = -5;
    expect(() => validarFicha(f)).toThrow(/precio/);
  });
});
