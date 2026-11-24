import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../src/db/memory";
import { getModulo, type ToolContext } from "../src/modules";
import { validarFicha } from "../src/tenants/load";
import { aUtc } from "../src/core/tiempo";
import { fichaDePrueba } from "./helpers";

const tenant = fichaDePrueba();
const config = tenant.modulos.find((m) => m.nombre === "citas")!.config;
const herramientas = getModulo("citas")!.tools!();
// Lunes 16 de noviembre de 2026, 10:00 en Ciudad de Mexico
const AHORA = aUtc("2026-11-16", "10:00", "America/Mexico_City");

let store: MemoryStore;
let ctx: ToolContext;
let otro: ToolContext;

const usar = (nombre: string, input: Record<string, unknown>, c: ToolContext = ctx) =>
  herramientas.find((h) => h.name === nombre)!.run(input, c);

beforeEach(async () => {
  store = new MemoryStore();
  const base = { tenant, store, conversacionId: "conv", config, ahora: AHORA, salida: {}, notificarResponsable: async () => {} };
  ctx = { ...base, contacto: await store.upsertContacto(tenant.slug, "5215500000001") };
  otro = { ...base, contacto: await store.upsertContacto(tenant.slug, "5215500000002") };
});

const cita = (extra: Record<string, unknown> = {}) => ({
  servicio: "Consulta general",
  fecha: "2026-11-17",
  hora: "10:00",
  nombre: "Ana Lopez",
  ...extra,
});

describe("zona horaria", () => {
  it("convierte hora local de Mexico a UTC", () => {
    expect(aUtc("2026-11-17", "10:00", "America/Mexico_City").toISOString()).toBe("2026-11-17T16:00:00.000Z");
  });
});

describe("consultar_disponibilidad", () => {
  it("lista horarios dentro del horario de atencion y excluye los ocupados", async () => {
    await usar("agendar_cita", cita());
    const r = await usar("consultar_disponibilidad", { fecha: "2026-11-17", servicio: "Consulta general" });
    expect(r).toContain("09:00");
    expect(r).toContain("18:30");
    expect(r).not.toContain("10:00");
    expect(r).not.toContain("14:00"); // comida
    expect(r).not.toContain("19:00"); // no cabe antes del cierre
  });
  it("hoy solo ofrece horarios con la anticipacion minima", async () => {
    const r = await usar("consultar_disponibilidad", { fecha: "2026-11-16" });
    expect(r).not.toContain("09:00");
    expect(r).not.toContain("10:30"); // menos de 60 min
    expect(r).toContain("11:00");
  });
  it("domingo no tiene horarios", async () => {
    expect(await usar("consultar_disponibilidad", { fecha: "2026-11-22" })).toMatch(/No hay horarios/);
  });
});

describe("agendar_cita", () => {
  it("agenda en un horario valido", async () => {
    expect(await usar("agendar_cita", cita())).toMatch(/^Cita agendada/);
    expect(await usar("mis_citas", {})).toContain("Ana Lopez");
  });
  it("rechaza citas imposibles", async () => {
    const casos: [Record<string, unknown>, RegExp][] = [
      [{ fecha: "2026-11-13" }, /ya paso/], // pasado
      [{ fecha: "2026-11-16", hora: "10:30" }, /demasiado cerca/], // sin anticipacion
      [{ fecha: "2026-11-22" }, /no atiende/], // domingo
      [{ hora: "15:00" }, /fuera del horario/], // comida
      [{ hora: "18:45" }, /fuera del horario/], // no cabe
      [{ hora: "03:00" }, /fuera del horario/],
      [{ hora: "10:10" }, /cada 30 minutos/], // fuera de la rejilla
      [{ fecha: "2026-02-30" }, /Fecha invalida/],
      [{ fecha: "manana" }, /Fecha invalida/],
      [{ hora: "25:00" }, /Hora invalida/],
      [{ fecha: "2027-03-01" }, /dias adelante/],
      [{ servicio: "Cirugia plastica" }, /no existe/],
      [{ nombre: "" }, /falta el nombre/],
    ];
    for (const [extra, esperado] of casos) {
      expect(await usar("agendar_cita", cita(extra)), JSON.stringify(extra)).toMatch(esperado);
    }
    expect(await usar("mis_citas", {})).toMatch(/no tiene citas/);
  });
  it("no permite dos citas en el mismo horario y ofrece alternativas", async () => {
    await usar("agendar_cita", cita());
    const r = await usar("agendar_cita", cita({ nombre: "Luis" }), otro);
    expect(r).toMatch(/ya esta ocupado/);
    expect(r).toContain("10:30");
  });
});

describe("mover y cancelar", () => {
  const idDe = (texto: string) => /\[(\w+)\]/.exec(texto)![1]!;

  it("mueve una cita propia y libera el horario anterior", async () => {
    const id = idDe(await usar("agendar_cita", cita({ fecha: "2026-11-18" })));
    expect(await usar("mover_cita", { cita_id: id, fecha: "2026-11-19", hora: "12:00" })).toMatch(/^Cita movida/);
    expect(await usar("consultar_disponibilidad", { fecha: "2026-11-18" })).toContain("10:00");
    expect(await usar("consultar_disponibilidad", { fecha: "2026-11-19" })).not.toContain("12:00");
  });
  it("no mueve a un horario ocupado ni invalido, y la cita sigue donde estaba", async () => {
    const id = idDe(await usar("agendar_cita", cita({ fecha: "2026-11-18" })));
    await usar("agendar_cita", cita({ fecha: "2026-11-19", nombre: "Luis" }), otro);
    expect(await usar("mover_cita", { cita_id: id, fecha: "2026-11-19", hora: "10:00" })).toMatch(/ya esta ocupado/);
    expect(await usar("mover_cita", { cita_id: id, fecha: "2026-11-22", hora: "10:00" })).toMatch(/no atiende/);
    expect(await usar("mis_citas", {})).toMatch(/18 de noviembre/);
  });
  it("no deja tocar citas de otro cliente", async () => {
    const id = idDe(await usar("agendar_cita", cita({ fecha: "2026-11-18" })));
    expect(await usar("cancelar_cita", { cita_id: id }, otro)).toMatch(/no existe/);
    expect(await usar("mover_cita", { cita_id: id, fecha: "2026-11-19", hora: "12:00" }, otro)).toMatch(/no existe/);
    expect(await usar("mis_citas", {})).toContain(id);
  });
  it("cancela y libera el horario", async () => {
    const id = idDe(await usar("agendar_cita", cita({ fecha: "2026-11-18" })));
    expect(await usar("cancelar_cita", { cita_id: id })).toMatch(/^Cita cancelada/);
    expect(await usar("mis_citas", {})).toMatch(/no tiene citas/);
    expect(await usar("agendar_cita", cita({ fecha: "2026-11-18", nombre: "Luis" }), otro)).toMatch(/^Cita agendada/);
  });
  it("respeta la politica de anticipacion para cambios (4 horas)", async () => {
    const id = idDe(await usar("agendar_cita", cita({ fecha: "2026-11-16", hora: "12:00" })));
    expect(await usar("cancelar_cita", { cita_id: id })).toMatch(/4 horas/);
    expect(await usar("mover_cita", { cita_id: id, fecha: "2026-11-19", hora: "12:00" })).toMatch(/4 horas/);
  });
});

describe("configuracion del modulo en la ficha", () => {
  it("rechaza un horario mal escrito o invertido", () => {
    const con = (horario: unknown) => ({
      ...tenant,
      modulos: [{ nombre: "citas", config: { horario } }],
    });
    expect(() => validarFicha(con({ lun: [["9am", "14:00"]] }))).toThrow(/citas/);
    expect(() => validarFicha(con({ lun: [["14:00", "09:00"]] }))).toThrow(/antes de/);
    expect(() => validarFicha(con({ lunes: [["09:00", "14:00"]] }))).toThrow(/citas/);
  });
});
