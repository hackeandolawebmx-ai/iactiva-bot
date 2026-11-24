import { faq } from "./faq";
import { citas } from "./citas";
import { escalamiento } from "./escalamiento";
import type { Module } from "./types";

/** Para agregar un modulo: crearlo en esta carpeta y registrarlo aqui. El nucleo no cambia. */
const registro: Record<string, Module> = Object.fromEntries([faq, citas, escalamiento].map((m) => [m.nombre, m]));

export function getModulo(nombre: string): Module | undefined {
  return registro[nombre];
}

export function nombresDeModulos(): string[] {
  return Object.keys(registro);
}

export type { Module, ToolDef, ToolContext } from "./types";
