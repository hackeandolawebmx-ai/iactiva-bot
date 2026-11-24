import type { Tenant } from "../tenants/schema.js";
import type { Contacto, Store } from "../db/store.js";

export interface ToolContext {
  tenant: Tenant;
  contacto: Contacto;
  store: Store;
  conversacionId: string;
  /** Configuracion del modulo tal como viene en la ficha. */
  config: Record<string, unknown>;
  ahora: Date;
  /** Lo que la herramienta quiere agregar a la respuesta (por ejemplo botones). */
  salida: { botones?: string[] };
  /** Avisa al responsable del negocio (escalamiento.numero). */
  notificarResponsable(texto: string): Promise<void>;
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

/** Un modulo aporta instrucciones al prompt, herramientas y (mas adelante) tareas programadas. */
export interface Module {
  nombre: string;
  /** Lanza Error si la configuracion de la ficha no sirve. Se llama al validar la ficha. */
  validarConfig?(config: Record<string, unknown>): void;
  instrucciones(tenant: Tenant, config: Record<string, unknown>): string;
  tools?(): ToolDef[];
}
