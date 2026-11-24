import type { Module } from "./types.js";

export const faq: Module = {
  nombre: "faq",
  instrucciones: () =>
    [
      "Modulo de preguntas frecuentes:",
      "- Responde dudas sobre servicios, precios, horarios, ubicacion y politicas usando SOLO la informacion de la ficha del negocio.",
      "- Si el dato no esta en la ficha, dilo con honestidad y ofrece que una persona del negocio le conteste. No inventes ni deduzcas precios, horarios ni disponibilidad.",
    ].join("\n"),
};
