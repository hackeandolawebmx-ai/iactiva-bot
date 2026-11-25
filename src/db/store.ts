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

export type EstadoLead =
  | "nuevo" | "contactado" | "en_conversacion" | "escalado" | "llamada" | "propuesta" | "cerrado" | "descartado";

export interface Lead {
  id: string;
  tenant: string;
  contacto_id: string;
  negocio: string;
  nombre: string;
  dolor: string;
  detalle: string;
  ref: string;
  estado: EstadoLead;
  contactado: Date | null;
  seguimiento_enviado: Date | null;
  creado: Date;
}

export type NuevoLead = Pick<Lead, "tenant" | "contacto_id" | "negocio" | "nombre" | "dolor" | "detalle" | "ref">;

/** Una conversacion con lo necesario para pintarla en el panel. */
export interface ResumenConversacion {
  conversacion: Conversacion;
  contacto: Contacto;
  lead: Lead | null;
  ultimo: Mensaje | null;
}

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
  listarConversaciones(tenant: string, limite: number): Promise<ResumenConversacion[]>;
  /** null si no existe o es de otro negocio. */
  getResumenConversacion(tenant: string, conversacionId: string): Promise<ResumenConversacion | null>;
  getContacto(id: string): Promise<Contacto | null>;

  /** null = ese contacto ya tenia un lead. */
  crearLead(l: NuevoLead): Promise<Lead | null>;
  getLead(tenant: string, contactoId: string): Promise<Lead | null>;
  actualizarLead(id: string, cambios: Partial<Pick<Lead, "estado" | "contactado">>): Promise<void>;
  leadsContactadosDesde(tenant: string, desde: Date): Promise<number>;
  /** Leads en estado contactado, sin seguimiento, contactados antes de la fecha. */
  leadsSinRespuesta(tenant: string, antesDe: Date): Promise<Lead[]>;
  /** true solo la primera vez que se marca el seguimiento. */
  reclamarSeguimiento(id: string, cuando: Date): Promise<boolean>;

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
