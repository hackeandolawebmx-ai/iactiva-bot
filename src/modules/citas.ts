import { z } from "zod";
import type { Module, ToolContext, ToolDef } from "./types.js";
import type { Cita } from "../db/store.js";
import { aMinutos, aUtc, deMinutos, diaDeLaSemana, fechaValida, legible } from "../core/tiempo.js";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "hora en formato HH:mm");

/** Configuracion del modulo en la ficha. La disponibilidad sale de este horario menos las citas ya guardadas. */
export const CitasConfig = z.object({
  /** Tamano de la rejilla de horarios y duracion por defecto de una cita. */
  duracion_min: z.number().int().positive().default(30),
  /** Bloques de atencion por dia: { "lun": [["09:00","14:00"],["16:00","19:00"]] }. Dia ausente = cerrado. */
  horario: z.partialRecord(z.enum(["lun", "mar", "mie", "jue", "vie", "sab", "dom"]), z.array(z.tuple([hhmm, hhmm]))),
  /** Minutos minimos entre ahora y la cita. */
  anticipacion_min: z.number().int().nonnegative().default(60),
  /** Hasta cuantos dias adelante se puede agendar. */
  dias_adelante: z.number().int().positive().default(30),
  /** Horas minimas de anticipacion para mover o cancelar. 0 = sin limite. */
  cambios_min_horas: z.number().nonnegative().default(0),
});
type Cfg = z.infer<typeof CitasConfig>;

const cfgDe = (ctx: ToolContext): Cfg => CitasConfig.parse(ctx.config);

function duracionDe(ctx: ToolContext, cfg: Cfg, servicio?: string): number {
  const s = ctx.tenant.negocio.servicios.find((x) => x.nombre.toLowerCase() === servicio?.trim().toLowerCase());
  return s?.duracion_min ?? cfg.duracion_min;
}

/** Valida un horario pedido contra la configuracion. Devuelve error legible o el rango en UTC. */
export function validarHorario(
  cfg: Cfg,
  tz: string,
  fecha: string,
  hora: string,
  duracion: number,
  ahora: Date,
): { error: string } | { inicio: Date; fin: Date } {
  if (!fechaValida(fecha)) return { error: `Fecha invalida "${fecha}". Usa el formato AAAA-MM-DD con una fecha real.` };
  if (!hhmm.safeParse(hora).success) return { error: `Hora invalida "${hora}". Usa el formato HH:mm de 24 horas.` };
  const bloques = cfg.horario[diaDeLaSemana(fecha)] ?? [];
  if (bloques.length === 0) return { error: `El negocio no atiende ese dia (${fecha}).` };
  const ini = aMinutos(hora);
  const bloque = bloques.find(([a, b]) => ini >= aMinutos(a) && ini + duracion <= aMinutos(b));
  if (!bloque) return { error: `Las ${hora} quedan fuera del horario de atencion de ese dia.` };
  if ((ini - aMinutos(bloque[0])) % cfg.duracion_min !== 0) {
    return { error: `Las citas van cada ${cfg.duracion_min} minutos. ${hora} no es un horario valido; consulta la disponibilidad.` };
  }
  const inicio = aUtc(fecha, hora, tz);
  const fin = new Date(inicio.getTime() + duracion * 60000);
  if (inicio.getTime() < ahora.getTime() + cfg.anticipacion_min * 60000) {
    return { error: "Ese horario ya paso o esta demasiado cerca. Ofrece un horario posterior." };
  }
  if (inicio.getTime() > ahora.getTime() + cfg.dias_adelante * 86400000) {
    return { error: `Solo se agenda hasta ${cfg.dias_adelante} dias adelante.` };
  }
  return { inicio, fin };
}

/** Horarios libres de un dia para una duracion dada. */
export async function horariosLibres(ctx: ToolContext, cfg: Cfg, fecha: string, duracion: number, exceptoCita?: string) {
  const tz = ctx.tenant.zona_horaria;
  const bloques = cfg.horario[diaDeLaSemana(fecha)] ?? [];
  const ocupadas = (
    await ctx.store.citasEntre(ctx.tenant.slug, aUtc(fecha, "00:00", tz), new Date(aUtc(fecha, "00:00", tz).getTime() + 86400000))
  ).filter((c) => c.id !== exceptoCita);
  const libres: string[] = [];
  for (const [a, b] of bloques) {
    for (let m = aMinutos(a); m + duracion <= aMinutos(b); m += cfg.duracion_min) {
      const v = validarHorario(cfg, tz, fecha, deMinutos(m), duracion, ctx.ahora);
      if ("error" in v) continue;
      if (!ocupadas.some((c) => c.inicio < v.fin && v.inicio < c.fin)) libres.push(deMinutos(m));
    }
  }
  return libres;
}

const describir = (c: Cita, tz: string) => `[${c.id}] ${c.servicio}, ${legible(c.inicio, tz)}, a nombre de ${c.nombre}`;

/** Busca una cita activa del contacto. Nunca devuelve citas de otra persona. */
async function citaPropia(ctx: ToolContext, id: unknown): Promise<Cita | null> {
  const c = await ctx.store.getCita(String(id ?? ""));
  if (!c || c.tenant !== ctx.tenant.slug || c.contacto_id !== ctx.contacto.id || c.estado === "cancelada") return null;
  return c;
}

function cambioPermitido(cfg: Cfg, c: Cita, ahora: Date): string | null {
  if (c.inicio.getTime() <= ahora.getTime()) return "Esa cita ya paso.";
  if (cfg.cambios_min_horas > 0 && c.inicio.getTime() - ahora.getTime() < cfg.cambios_min_horas * 3600000) {
    return `Por politica, los cambios y cancelaciones requieren ${cfg.cambios_min_horas} horas de anticipacion. Ofrece pasar con una persona del negocio.`;
  }
  return null;
}

const tools: ToolDef[] = [
  {
    name: "consultar_disponibilidad",
    description:
      "Devuelve los horarios libres de un dia. Usala SIEMPRE antes de ofrecer u aceptar un horario; nunca supongas disponibilidad.",
    input_schema: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "Dia a consultar, AAAA-MM-DD" },
        servicio: { type: "string", description: "Nombre del servicio tal como esta en la ficha (opcional)" },
      },
      required: ["fecha"],
    },
    async run(input, ctx) {
      const cfg = cfgDe(ctx);
      const fecha = String(input.fecha ?? "");
      if (!fechaValida(fecha)) return `Fecha invalida "${fecha}". Usa AAAA-MM-DD con una fecha real.`;
      const libres = await horariosLibres(ctx, cfg, fecha, duracionDe(ctx, cfg, input.servicio as string | undefined));
      return libres.length ? `Horarios libres el ${fecha}: ${libres.join(", ")}` : `No hay horarios libres el ${fecha}.`;
    },
  },
  {
    name: "agendar_cita",
    description:
      "Agenda una cita. Llamala solo cuando el cliente ya confirmo expresamente servicio, fecha, hora y nombre. Si devuelve error, no hay cita: explica el motivo y ofrece alternativas.",
    input_schema: {
      type: "object",
      properties: {
        servicio: { type: "string", description: "Nombre del servicio tal como esta en la ficha" },
        fecha: { type: "string", description: "AAAA-MM-DD" },
        hora: { type: "string", description: "HH:mm en 24 horas" },
        nombre: { type: "string", description: "Nombre de quien asistira" },
      },
      required: ["servicio", "fecha", "hora", "nombre"],
    },
    async run(input, ctx) {
      const cfg = cfgDe(ctx);
      const tz = ctx.tenant.zona_horaria;
      const servicios = ctx.tenant.negocio.servicios;
      const pedido = String(input.servicio ?? "").trim();
      const servicio = servicios.find((s) => s.nombre.toLowerCase() === pedido.toLowerCase());
      if (servicios.length && !servicio) {
        return `Error: el servicio "${pedido}" no existe. Servicios validos: ${servicios.map((s) => s.nombre).join(", ")}.`;
      }
      const nombre = String(input.nombre ?? "").trim();
      if (nombre.length < 2) return "Error: falta el nombre de quien asistira.";
      const duracion = duracionDe(ctx, cfg, pedido);
      const fecha = String(input.fecha ?? "");
      const v = validarHorario(cfg, tz, fecha, String(input.hora ?? ""), duracion, ctx.ahora);
      if ("error" in v) return `Error: ${v.error}`;
      const cita = await ctx.store.crearCita({
        tenant: ctx.tenant.slug,
        contacto_id: ctx.contacto.id,
        servicio: servicio?.nombre ?? pedido,
        nombre,
        inicio: v.inicio,
        fin: v.fin,
      });
      if (!cita) {
        const libres = await horariosLibres(ctx, cfg, fecha, duracion);
        return `Error: ese horario ya esta ocupado. ${libres.length ? `Libres ese dia: ${libres.join(", ")}` : "Ese dia ya no hay lugares."}`;
      }
      if (!ctx.contacto.nombre) await ctx.store.actualizarContacto(ctx.contacto.id, { nombre });
      return `Cita agendada: ${describir(cita, tz)}.`;
    },
  },
  {
    name: "mis_citas",
    description: "Lista las citas futuras de este cliente con su identificador. Usala antes de mover o cancelar.",
    input_schema: { type: "object", properties: {} },
    async run(_input, ctx) {
      const citas = await ctx.store.citasDeContacto(ctx.tenant.slug, ctx.contacto.id, ctx.ahora);
      return citas.length
        ? citas.map((c) => describir(c, ctx.tenant.zona_horaria)).join("\n")
        : "Este cliente no tiene citas futuras.";
    },
  },
  {
    name: "mover_cita",
    description: "Cambia la fecha y hora de una cita de este cliente. Requiere el identificador que devuelve mis_citas.",
    input_schema: {
      type: "object",
      properties: {
        cita_id: { type: "string" },
        fecha: { type: "string", description: "Nueva fecha AAAA-MM-DD" },
        hora: { type: "string", description: "Nueva hora HH:mm" },
      },
      required: ["cita_id", "fecha", "hora"],
    },
    async run(input, ctx) {
      const cfg = cfgDe(ctx);
      const tz = ctx.tenant.zona_horaria;
      const cita = await citaPropia(ctx, input.cita_id);
      if (!cita) return "Error: no existe una cita activa de este cliente con ese identificador. Usa mis_citas.";
      const bloqueo = cambioPermitido(cfg, cita, ctx.ahora);
      if (bloqueo) return `Error: ${bloqueo}`;
      const duracion = Math.round((cita.fin.getTime() - cita.inicio.getTime()) / 60000);
      const fecha = String(input.fecha ?? "");
      const v = validarHorario(cfg, tz, fecha, String(input.hora ?? ""), duracion, ctx.ahora);
      if ("error" in v) return `Error: ${v.error}`;
      const movida = await ctx.store.moverCita(cita.id, v.inicio, v.fin);
      if (!movida) {
        const libres = await horariosLibres(ctx, cfg, fecha, duracion, cita.id);
        return `Error: ese horario ya esta ocupado. La cita sigue en su horario original. ${libres.length ? `Libres ese dia: ${libres.join(", ")}` : ""}`;
      }
      return `Cita movida: ${describir(movida, tz)}.`;
    },
  },
  {
    name: "cancelar_cita",
    description: "Cancela una cita de este cliente. Llamala solo cuando el cliente confirmo que quiere cancelar.",
    input_schema: { type: "object", properties: { cita_id: { type: "string" } }, required: ["cita_id"] },
    async run(input, ctx) {
      const cfg = cfgDe(ctx);
      const cita = await citaPropia(ctx, input.cita_id);
      if (!cita) return "Error: no existe una cita activa de este cliente con ese identificador. Usa mis_citas.";
      const bloqueo = cambioPermitido(cfg, cita, ctx.ahora);
      if (bloqueo) return `Error: ${bloqueo}`;
      await ctx.store.cancelarCita(cita.id);
      return `Cita cancelada: ${describir(cita, ctx.tenant.zona_horaria)}.`;
    },
  },
];

export const citas: Module = {
  nombre: "citas",
  validarConfig(config) {
    const r = CitasConfig.safeParse(config);
    if (!r.success) {
      throw new Error(r.error.issues.map((i) => `modulos.citas.config.${i.path.join(".")}: ${i.message}`).join("\n"));
    }
    for (const [dia, bloques] of Object.entries(r.data.horario)) {
      for (const [a, b] of bloques ?? []) {
        if (aMinutos(a) >= aMinutos(b)) throw new Error(`modulos.citas.config.horario.${dia}: ${a} debe ser antes de ${b}`);
      }
    }
  },
  instrucciones: () => {
    return [
      "Modulo de citas:",
      "- Para agendar necesitas servicio, dia, hora y nombre. Pide lo que falte, de a una cosa por mensaje.",
      "- Antes de proponer o aceptar un horario llama a consultar_disponibilidad. Ofrece solo horarios que esa herramienta devolvio.",
      "- Antes de agendar, mover o cancelar, repite los datos y pide confirmacion con ofrecer_botones (por ejemplo: Confirmar, Cambiar). Solo despues de que el cliente confirme llama a la herramienta.",
      "- Una cita existe unicamente si agendar_cita respondio 'Cita agendada'. Si respondio error, dilo y ofrece alternativas. Nunca digas que quedo agendada sin esa respuesta.",
      "- Para mover o cancelar usa primero mis_citas. Solo puedes tocar citas de este mismo cliente.",
      "- Convierte fechas relativas (manana, el viernes) a AAAA-MM-DD usando la fecha actual que se te da.",
    ].join("\n");
  },
  tools: () => tools,
};
