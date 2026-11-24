/** Utilidades de fecha con zona horaria (sin dependencias). */

function desfaseMin(d: Date, tz: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const comoUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return (comoUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000;
}

/** Convierte fecha "YYYY-MM-DD" y hora "HH:mm" locales de la zona a un instante UTC. */
export function aUtc(fecha: string, hora: string, tz: string): Date {
  const [y, m, d] = fecha.split("-").map(Number) as [number, number, number];
  const [hh, mm] = hora.split(":").map(Number) as [number, number];
  const supuesto = Date.UTC(y, m - 1, d, hh, mm);
  let r = supuesto - desfaseMin(new Date(supuesto), tz) * 60000;
  r = supuesto - desfaseMin(new Date(r), tz) * 60000; // segunda pasada por cambios de horario
  return new Date(r);
}

/** Fecha y hora locales de un instante en la zona dada. */
export function partesLocales(d: Date, tz: string): { fecha: string; hora: string } {
  const local = new Date(d.getTime() + desfaseMin(d, tz) * 60000);
  const iso = local.toISOString();
  return { fecha: iso.slice(0, 10), hora: iso.slice(11, 16) };
}

export function fechaValida(fecha: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const d = new Date(`${fecha}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
}

export const DIAS = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"] as const;
export type Dia = (typeof DIAS)[number];

export function diaDeLaSemana(fecha: string): Dia {
  return DIAS[new Date(`${fecha}T00:00:00Z`).getUTCDay()]!;
}

export function aMinutos(hora: string): number {
  const [h, m] = hora.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

export function deMinutos(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Texto legible: "martes 17 de noviembre, 10:30". */
export function legible(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}
