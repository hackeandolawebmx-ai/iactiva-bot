export interface Contacto {
  id: string;
  tenant: string;
  telefono: string;
  nombre?: string;
  consentimiento: boolean;
  opt_out: boolean;
}

export interface Conversacion {
  id: string;
  tenant: string;
  contacto_id: string;
  pausada: boolean;
  resumen: string;
  mensajes_desde_resumen: number;
  ultimo_entrante: Date | null;
}

export interface Mensaje {
  id: string;
  conversacion_id: string;
  rol: "cliente" | "bot" | "humano";
  contenido: string;
  tokens_in?: number;
  tokens_out?: number;
  latencia_ms?: number;
  herramientas?: { name: string; input: unknown; output: string }[];
  creado: Date;
}

export type NuevoMensaje = Omit<Mensaje, "id" | "creado">;

export interface Cita {
  id: string;
  tenant: string;
  contacto_id: string;
  servicio: string;
  nombre: string;
  inicio: Date;
  fin: Date;
  estado: "confirmada" | "cancelada";
}

export type NuevaCita = Omit<Cita, "id" | "estado">;

/** Contrato de persistencia. Implementaciones: memoria (laboratorio y pruebas) y Supabase (hito 2). */
export interface Store {
  /** true si es la primera vez que se ve este id (idempotencia). false si es duplicado. */
  reclamarMensaje(waMessageId: string): Promise<boolean>;
  upsertContacto(tenant: string, telefono: string, nombre?: string): Promise<Contacto>;
  actualizarContacto(id: string, cambios: Partial<Pick<Contacto, "consentimiento" | "opt_out" | "nombre">>): Promise<Contacto>;
  getConversacion(tenant: string, contactoId: string): Promise<Conversacion>;
  actualizarConversacion(
    id: string,
    cambios: Partial<Pick<Conversacion, "pausada" | "resumen" | "mensajes_desde_resumen" | "ultimo_entrante">>,
  ): Promise<Conversacion>;
  addMensaje(m: NuevoMensaje): Promise<Mensaje>;
  ultimosMensajes(conversacionId: string, limite: number): Promise<Mensaje[]>;
  logEvento(tipo: string, payload: unknown): Promise<void>;

  /** Crea la cita solo si no se empalma con otra activa del mismo negocio. null = horario ocupado. */
  crearCita(c: NuevaCita): Promise<Cita | null>;
  getCita(id: string): Promise<Cita | null>;
  /** Citas activas (no canceladas) que tocan el rango [desde, hasta). */
  citasEntre(tenant: string, desde: Date, hasta: Date): Promise<Cita[]>;
  citasDeContacto(tenant: string, contactoId: string, desde: Date): Promise<Cita[]>;
  /** Mueve una cita. null = el nuevo horario esta ocupado. */
  moverCita(id: string, inicio: Date, fin: Date): Promise<Cita | null>;
  cancelarCita(id: string): Promise<void>;
}
