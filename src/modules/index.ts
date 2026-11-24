import { faq } from "./faq.js";
import { citas } from "./citas.js";
import { escalamiento } from "./escalamiento.js";
import type { Module } from "./types.js";

/** Para agregar un modulo: crearlo en esta carpeta y registrarlo aqui. El nucleo no cambia. */
const registro: Record<string, Module> = Object.fromEntries([faq, citas, escalamiento].map((m) => [m.nombre, m]));

export function getModulo(nombre: string): Module | undefined {
  return registro[nombre];
}

export function nombresDeModulos(): string[] {
  return Object.keys(registro);
}

export type { Module, ToolDef, ToolContext } from "./types.js";
