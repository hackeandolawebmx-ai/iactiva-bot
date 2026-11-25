import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/db/memory.js";
import { procesarEntrante } from "../src/core/pipeline.js";
import { canalGrabador, fichaDePrueba, llmFalso } from "./helpers.js";

describe("primer mensaje con aviso informativo", () => {
  it("contesta en un solo mensaje con el aviso y el modelo recibe al cliente al final", async () => {
    const tenant = fichaDePrueba({
      privacidad: { aviso: "Aviso", pide_consentimiento: false, avisar_al_inicio: true },
    });
    const m = llmFalso("Hola, soy Chip");
    const c = canalGrabador();
    await procesarEntrante({ store: new MemoryStore(), llm: m.llm, canal: c.canal }, tenant, {
      id: "1", de: "5218100000000", tipo: "texto", texto: "Hola",
    });
    expect(c.enviados.map((e) => e.texto)).toEqual(["Hola, soy Chip\n\nAviso"]);
    expect(m.llamadas[0]!.messages.at(-1)!.role).toBe("user");
  });
});
