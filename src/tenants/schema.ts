import { z } from "zod";

const texto = z.string().min(1);

export const TenantSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "slug: solo minusculas, numeros y guiones"),
  nombre: texto,
  giro: texto,
  idioma: z.string().default("es-MX"),
  zona_horaria: z.string().default("America/Mexico_City"),
  whatsapp: z.object({
    phone_number_id: texto,
    waba_id: texto,
  }),
  personalidad: z.object({
    nombre_asistente: texto,
    tono: texto,
    saludo: texto,
  }),
  negocio: z.object({
    descripcion: texto,
    servicios: z
      .array(
        z.object({
          nombre: texto,
          precio: z.number().nonnegative().optional(),
          moneda: z.string().default("MXN"),
          descripcion: z.string().optional(),
          duracion_min: z.number().int().positive().optional(),
        }),
      )
      .default([]),
    horarios: z.array(z.object({ dia: texto, horario: texto })).default([]),
    ubicacion: z
      .object({
        direccion: texto,
        referencias: z.string().optional(),
        mapa_url: z.string().optional(),
      })
      .optional(),
    politicas: z.array(texto).default([]),
  }),
  reglas: z.array(texto).default([]),
  modulos: z
    .array(
      z.object({
        nombre: texto,
        config: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .min(1),
  escalamiento: z.object({
    numero: texto,
    casos: z.array(texto).default([]),
  }),
  // Los modelos Claude 5 ya no aceptan temperatura en la API, por eso solo se elige el modelo.
  modelo: z
    .object({
      nombre: z.string().default("claude-haiku-5-5"),
    })
    .default({ nombre: "claude-haiku-5-5" }),
  privacidad: z.object({
    aviso: texto,
    pide_consentimiento: z.boolean(),
    // Sin pedir ACEPTO: manda el aviso una sola vez al primer mensaje y sigue conversando.
    avisar_al_inicio: z.boolean().default(false),
  }),
});

export type Tenant = z.infer<typeof TenantSchema>;
export type TenantInput = z.input<typeof TenantSchema>;
