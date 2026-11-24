import type { Module, ToolDef } from "./types";

const tools: ToolDef[] = [
  {
    name: "escalar_a_humano",
    description:
      "Pasa la conversacion a una persona del negocio: le avisa al responsable con un resumen y pausa al bot en esta conversacion. Usala cuando el cliente pida hablar con una persona, cuando no tengas el dato que pide, o en los casos de escalamiento de la ficha.",
    input_schema: {
      type: "object",
      properties: {
        motivo: { type: "string", description: "Por que se escala, en una frase" },
        resumen: { type: "string", description: "Resumen breve de lo que el cliente necesita y lo ya platicado" },
      },
      required: ["motivo", "resumen"],
    },
    async run(input, ctx) {
      const motivo = String(input.motivo ?? "").slice(0, 200);
      const resumen = String(input.resumen ?? "").slice(0, 600);
      await ctx.store.actualizarConversacion(ctx.conversacionId, { pausada: true });
      await ctx.store.logEvento("escalamiento", { tenant: ctx.tenant.slug, contacto: ctx.contacto.id, motivo });
      const aviso =
        `${ctx.tenant.nombre}: un cliente necesita atencion.\n` +
        `Cliente: ${ctx.contacto.nombre ?? "sin nombre"} (${ctx.contacto.telefono})\n` +
        `Motivo: ${motivo}\nResumen: ${resumen}\n` +
        `El bot quedo en pausa con este cliente. Para reactivarlo responde: REACTIVAR ${ctx.contacto.telefono}`;
      try {
        await ctx.notificarResponsable(aviso);
      } catch (e) {
        await ctx.store.logEvento("error_aviso_responsable", String(e));
        return "La conversacion quedo en pausa para atencion humana, pero el aviso al responsable fallo. Dile al cliente que alguien del negocio le contestara lo antes posible.";
      }
      return "Listo: se aviso al responsable y el bot quedo en pausa. Despidete diciendo que una persona del negocio le contestara por este mismo chat. No prometas tiempos.";
    },
  },
];

export const escalamiento: Module = {
  nombre: "escalamiento",
  instrucciones: (t) =>
    [
      "Modulo de escalamiento:",
      "- Llama a escalar_a_humano cuando el cliente pida hablar con una persona, cuando no tengas la informacion, o en estos casos:",
      ...t.escalamiento.casos.map((c) => `  - ${c}`),
      "- No des el numero del responsable al cliente. Despues de escalar, despidete en un solo mensaje.",
    ].join("\n"),
  tools: () => tools,
};
