import { MemoryStore } from "./memory.js";
import { SupabaseStore } from "./supabase.js";
import type { Store } from "./store.js";

/** Supabase si hay credenciales en el entorno; si no, memoria (se pierde al reiniciar). */
export function crearStore(): Store {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return new SupabaseStore();
  console.warn("Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY: los datos viven en memoria y se pierden al reiniciar.");
  return new MemoryStore();
}

export type { Store } from "./store.js";
