import { randomUUID } from "node:crypto";
import type { Cita, Contacto, Conversacion, Mensaje, NuevaCita, NuevoMensaje, Store } from "./store";

export class MemoryStore implements Store {
  private vistos = new Set<string>();
  private contactos = new Map<string, Contacto>();
  private conversaciones = new Map<string, Conversacion>();
  private mensajes: Mensaje[] = [];
  private citas: Cita[] = [];
  eventos: { tipo: string; payload: unknown }[] = [];

  async reclamarMensaje(id: string) {
    if (this.vistos.has(id)) return false;
    this.vistos.add(id);
    return true;
  }

  async upsertContacto(tenant: string, telefono: string, nombre?: string) {
    const llave = `${tenant}:${telefono}`;
    let c = this.contactos.get(llave);
    if (!c) {
      c = { id: randomUUID(), tenant, telefono, nombre, consentimiento: false, opt_out: false };
      this.contactos.set(llave, c);
    } else if (nombre && !c.nombre) {
      c.nombre = nombre;
    }
    return c;
  }

  async actualizarContacto(id: string, cambios: Partial<Contacto>) {
    const c = [...this.contactos.values()].find((x) => x.id === id);
    if (!c) throw new Error("contacto no existe");
    Object.assign(c, cambios);
    return c;
  }

  async getConversacion(tenant: string, contactoId: string) {
    const llave = `${tenant}:${contactoId}`;
    let c = this.conversaciones.get(llave);
    if (!c) {
      c = {
        id: randomUUID(),
        tenant,
        contacto_id: contactoId,
        pausada: false,
        resumen: "",
        mensajes_desde_resumen: 0,
        ultimo_entrante: null,
      };
      this.conversaciones.set(llave, c);
    }
    return c;
  }

  async actualizarConversacion(id: string, cambios: Partial<Conversacion>) {
    const c = [...this.conversaciones.values()].find((x) => x.id === id);
    if (!c) throw new Error("conversacion no existe");
    Object.assign(c, cambios);
    return c;
  }

  async addMensaje(m: NuevoMensaje) {
    const msg: Mensaje = { ...m, id: randomUUID(), creado: new Date() };
    this.mensajes.push(msg);
    return msg;
  }

  async ultimosMensajes(conversacionId: string, limite: number) {
    return this.mensajes.filter((m) => m.conversacion_id === conversacionId).slice(-limite);
  }

  async logEvento(tipo: string, payload: unknown) {
    this.eventos.push({ tipo, payload });
  }

  private ocupado(tenant: string, inicio: Date, fin: Date, excepto?: string) {
    return this.citas.some(
      (c) => c.tenant === tenant && c.estado !== "cancelada" && c.id !== excepto && c.inicio < fin && inicio < c.fin,
    );
  }

  async crearCita(c: NuevaCita) {
    if (this.ocupado(c.tenant, c.inicio, c.fin)) return null;
    const cita: Cita = { ...c, id: randomUUID().slice(0, 8), estado: "confirmada" };
    this.citas.push(cita);
    return cita;
  }

  async getCita(id: string) {
    return this.citas.find((c) => c.id === id) ?? null;
  }

  async citasEntre(tenant: string, desde: Date, hasta: Date) {
    return this.citas
      .filter((c) => c.tenant === tenant && c.estado !== "cancelada" && c.inicio < hasta && desde < c.fin)
      .sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
  }

  async citasDeContacto(tenant: string, contactoId: string, desde: Date) {
    return this.citas
      .filter((c) => c.tenant === tenant && c.contacto_id === contactoId && c.estado !== "cancelada" && c.fin > desde)
      .sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
  }

  async moverCita(id: string, inicio: Date, fin: Date) {
    const c = this.citas.find((x) => x.id === id);
    if (!c) throw new Error("cita no existe");
    if (this.ocupado(c.tenant, inicio, fin, id)) return null;
    c.inicio = inicio;
    c.fin = fin;
    return c;
  }

  async cancelarCita(id: string) {
    const c = this.citas.find((x) => x.id === id);
    if (c) c.estado = "cancelada";
  }
}
