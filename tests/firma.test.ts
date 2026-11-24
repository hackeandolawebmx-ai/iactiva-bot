import { describe, expect, it } from "vitest";
import { firmaValida, firmar } from "../src/webhook/signature";

const SECRET = "secreto-de-prueba";
const CUERPO = JSON.stringify({ hola: "mundo", acentos: "áéí" });

describe("firma del webhook", () => {
  it("acepta una firma correcta", () => {
    expect(firmaValida(CUERPO, firmar(CUERPO, SECRET), SECRET)).toBe(true);
  });
  it("rechaza si el cuerpo fue alterado", () => {
    expect(firmaValida(CUERPO + " ", firmar(CUERPO, SECRET), SECRET)).toBe(false);
  });
  it("rechaza con otro secreto", () => {
    expect(firmaValida(CUERPO, firmar(CUERPO, "otro"), SECRET)).toBe(false);
  });
  it("rechaza sin cabecera, con algoritmo distinto o sin secreto configurado", () => {
    expect(firmaValida(CUERPO, undefined, SECRET)).toBe(false);
    expect(firmaValida(CUERPO, "sha1=abc", SECRET)).toBe(false);
    expect(firmaValida(CUERPO, firmar(CUERPO, SECRET), "")).toBe(false);
  });
  it("rechaza una firma de longitud incorrecta sin lanzar error", () => {
    expect(firmaValida(CUERPO, "sha256=abcd", SECRET)).toBe(false);
  });
});
