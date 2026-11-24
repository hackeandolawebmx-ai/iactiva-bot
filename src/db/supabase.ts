import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Cita, Contacto, Conversacion, Mensaje, NuevaCita, NuevoMensaje, Store } from "./store";

const UNICO = "23505"; // unique_violation
const EMPALME = "23P01"; // exclusion_violation (citas_sin_empalme)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fila = any;

const aConversacion = (f: Fila): Conversacion => ({
  ...f,
  ultimo_entrante: f.ultimo_entrante ? new Date(f.ultimo_entrante) : null,
});
const aMensaje = (f: Fila): Mensaje => ({ ...f, creado: new Date(f.creado) });
const aCita = (f: Fila): Cita => ({ ...f, inicio: new Date(f.inicio), fin: new Date(f.fin) });

function ok<T>(r: { data: T; error: { message: string; code?: string } | null }, que: string): T {
  if (r.error) throw new Error(`Supabase (${que}): ${r.error.message}`);
  return r.data;
}

/** Persistencia en Supabase. Usa la service role key: solo debe correr en el backend. */
export class SupabaseStore implements Store {
  private db: SupabaseClient;

  constructor(url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY) {
    if (!url || !key) throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
    this.db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async reclamarMensaje(id: string) {
    const { error } = await this.db.from("mensajes_procesados").insert({ wa_message_id: id });
    if (!error) return true;
    if (error.code === UNICO) return false;
    throw new Error(`Supabase (idempotencia): ${error.message}`);
  }

  async upsertContacto(tenant: string, telefono: string, nombre?: string): Promise<Contacto> {
    const buscar = () =>
      this.db.from("contactos").select("*").eq("tenant", tenant).eq("telefono", telefono).maybeSingle();
    let c = ok(await buscar(), "contacto");
    if (!c) {
      const ins = await this.db.from("contactos").insert({ tenant, telefono, nombre }).select().single();
      if (ins.error && ins.error.code !== UNICO) throw new Error(`Supabase (contacto): ${ins.error.message}`);
      c = ins.data ?? ok(await buscar(), "contacto");
    } else if (nombre && !c.nombre) {
      c = ok(await this.db.from("contactos").update({ nombre }).eq("id", c.id).select().single(), "contacto");
    }
    return c as Contacto;
  }

  async actualizarContacto(id: string, cambios: Partial<Contacto>) {
    return ok(await this.db.from("contactos").update(cambios).eq("id", id).select().single(), "contacto") as Contacto;
  }

  async getConversacion(tenant: string, contactoId: string) {
    const buscar = () =>
      this.db.from("conversaciones").select("*").eq("tenant", tenant).eq("contacto_id", contactoId).maybeSingle();
    let c = ok(await buscar(), "conversacion");
    if (!c) {
      const ins = await this.db.from("conversaciones").insert({ tenant, contacto_id: contactoId }).select().single();
      if (ins.error && ins.error.code !== UNICO) throw new Error(`Supabase (conversacion): ${ins.error.message}`);
      c = ins.data ?? ok(await buscar(), "conversacion");
    }
    return aConversacion(c);
  }

  async actualizarConversacion(id: string, cambios: Partial<Conversacion>) {
    const q = Object.keys(cambios).length
      ? this.db.from("conversaciones").update(cambios).eq("id", id).select().single()
      : this.db.from("conversaciones").select("*").eq("id", id).single();
    return aConversacion(ok(await q, "conversacion"));
  }

  async addMensaje(m: NuevoMensaje) {
    return aMensaje(ok(await this.db.from("mensajes").insert(m).select().single(), "mensaje"));
  }

  async ultimosMensajes(conversacionId: string, limite: number) {
    const filas = ok(
      await this.db
        .from("mensajes")
        .select("*")
        .eq("conversacion_id", conversacionId)
        .order("creado", { ascending: false })
        .limit(limite),
      "mensajes",
    ) as Fila[];
    return filas.reverse().map(aMensaje);
  }

  async logEvento(tipo: string, payload: unknown) {
    // Un fallo al registrar no debe tumbar el flujo del mensaje.
    const { error } = await this.db.from("eventos_webhook").insert({ tipo, payload: payload ?? null });
    if (error) console.error("No se pudo registrar el evento", tipo, error.message);
  }

  async crearCita(c: NuevaCita) {
    const r = await this.db.from("citas").insert(c).select().single();
    if (r.error?.code === EMPALME) return null;
    return aCita(ok(r, "cita"));
  }

  async getCita(id: string) {
    const f = ok(await this.db.from("citas").select("*").eq("id", id).maybeSingle(), "cita");
    return f ? aCita(f) : null;
  }

  async citasEntre(tenant: string, desde: Date, hasta: Date) {
    const filas = ok(
      await this.db
        .from("citas")
        .select("*")
        .eq("tenant", tenant)
        .neq("estado", "cancelada")
        .lt("inicio", hasta.toISOString())
        .gt("fin", desde.toISOString())
        .order("inicio"),
      "citas",
    ) as Fila[];
    return filas.map(aCita);
  }

  async citasDeContacto(tenant: string, contactoId: string, desde: Date) {
    const filas = ok(
      await this.db
        .from("citas")
        .select("*")
        .eq("tenant", tenant)
        .eq("contacto_id", contactoId)
        .neq("estado", "cancelada")
        .gt("fin", desde.toISOString())
        .order("inicio"),
      "citas",
    ) as Fila[];
    return filas.map(aCita);
  }

  async moverCita(id: string, inicio: Date, fin: Date) {
    const r = await this.db.from("citas").update({ inicio, fin }).eq("id", id).select().single();
    if (r.error?.code === EMPALME) return null;
    return aCita(ok(r, "cita"));
  }

  async cancelarCita(id: string) {
    ok(await this.db.from("citas").update({ estado: "cancelada" }).eq("id", id).select(), "cita");
  }
}
