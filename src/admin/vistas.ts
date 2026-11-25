import { html, raw } from "hono/html";
import type { EstadoLead, Mensaje, ResumenConversacion } from "../db/store.js";

export const ESTADOS: Record<EstadoLead, string> = {
  nuevo: "Nuevo",
  contactado: "Contactado",
  en_conversacion: "En conversación",
  escalado: "Escalado",
  llamada: "Llamada",
  propuesta: "Propuesta",
  cerrado: "Cerrado",
  descartado: "Descartado",
};

export const AVISOS: Record<string, string> = {
  enviado: "Mensaje enviado. Chip quedó en pausa en este chat.",
  pausado: "Chip quedó en pausa en este chat.",
  reactivado: "Chip volvió a contestar en este chat.",
  estado: "Estado actualizado.",
  ventana: "No se envió: pasaron más de 24 h desde su último mensaje. Escríbele desde tu WhatsApp.",
  vacio: "No se envió: el mensaje estaba vacío o era demasiado largo.",
  fallo: "WhatsApp rechazó el mensaje. No se envió.",
};

const DIA = 24 * 60 * 60 * 1000;
export const ventanaAbierta = (r: ResumenConversacion, ahora: Date) =>
  !!r.conversacion.ultimo_entrante && ahora.getTime() - r.conversacion.ultimo_entrante.getTime() < DIA;
/** Chip esta en pausa y todavia no le contestas tu. */
export const teToca = (r: ResumenConversacion) => r.conversacion.pausada && r.ultimo?.rol !== "humano";

export const actividad = (r: ResumenConversacion) =>
  (r.ultimo?.creado ?? r.conversacion.ultimo_entrante ?? r.lead?.creado ?? new Date(0)).getTime();

const fecha = (d: Date) =>
  new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Monterrey",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);

const nombreDe = (r: ResumenConversacion) => r.lead?.nombre || r.contacto.nombre || r.contacto.telefono;

type Html = ReturnType<typeof html>;

const CSS = `
:root{--fondo:#f5f5f2;--caja:#fff;--tinta:#17181a;--gris:#63666d;--borde:#dedfda;--acento:#14532d;--bot:#eef1ea;--yo:#dcefe2;--alerta:#9a3412;--alerta-f:#ffedd5}
@media (prefers-color-scheme:dark){:root{--fondo:#111214;--caja:#1b1d20;--tinta:#ececea;--gris:#9a9da4;--borde:#2f3236;--acento:#86efac;--bot:#25282c;--yo:#1d3a29;--alerta:#fdba74;--alerta-f:#43210d}}
*{box-sizing:border-box}
body{margin:0;background:var(--fondo);color:var(--tinta);font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:720px;margin:0 auto;padding:12px 12px 48px}
header{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px}
h1{font-size:19px;margin:0}h2{font-size:14px;margin:0 0 8px}
a{color:var(--acento)}
.caja{background:var(--caja);border:1px solid var(--borde);border-radius:12px;padding:12px;margin-bottom:10px}
.fila{display:block;text-decoration:none;color:inherit}
.linea{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.gris{color:var(--gris);font-size:13px}.linea .gris{flex-shrink:0;white-space:nowrap}.linea b{min-width:0}
.corta{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.chip{display:inline-block;border:1px solid var(--borde);border-radius:99px;padding:1px 9px;font-size:12px;color:var(--gris);margin:4px 4px 0 0}
.chip.toca{background:var(--alerta-f);color:var(--alerta);border-color:transparent;font-weight:600}
.cuentas{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px}
.cuentas div{background:var(--caja);border:1px solid var(--borde);border-radius:12px;padding:8px;text-align:center}
.cuentas b{display:block;font-size:20px}.cuentas span{font-size:12px;color:var(--gris)}
nav a{display:inline-block;padding:6px 12px;border:1px solid var(--borde);border-radius:99px;margin:0 4px 10px 0;text-decoration:none;font-size:13px}
nav a.activa{background:var(--acento);color:var(--caja);border-color:var(--acento)}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:right;padding:5px 4px;border-top:1px solid var(--borde)}th:first-child,td:first-child{text-align:left}
.msg{max-width:85%;border-radius:14px;padding:8px 12px;margin:0 0 8px;white-space:pre-wrap;overflow-wrap:anywhere}
.msg.cliente{background:var(--caja);border:1px solid var(--borde)}
.msg.bot{background:var(--bot);margin-left:auto}.msg.humano{background:var(--yo);margin-left:auto}
.msg small{display:block;color:var(--gris);font-size:11px;margin-top:3px}
button,select,input,textarea{font:inherit;color:inherit;border:1px solid var(--borde);border-radius:10px;background:var(--caja);padding:9px 12px}
input,textarea{width:100%;font-size:16px}
button{cursor:pointer}button.principal{background:var(--acento);color:var(--caja);border-color:var(--acento);font-weight:600}
.acciones{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.aviso{background:var(--alerta-f);color:var(--alerta);border-radius:10px;padding:10px 12px;margin-bottom:10px}
`;

function pagina(titulo: string, cuerpo: Html, refrescar?: number) {
  return html`<!doctype html>
<html lang="es-MX">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
${refrescar ? html`<meta http-equiv="refresh" content="${refrescar}">` : ""}
<title>${titulo}</title>
<style>${raw(CSS)}</style>
</head>
<body><main>${cuerpo}</main></body>
</html>`;
}

export function vistaLogin(error?: string) {
  return pagina(
    "Entrar | iactiva",
    html`<header><h1>Panel de Chip</h1></header>
${error ? html`<div class="aviso">${error}</div>` : ""}
<form class="caja" method="post" action="/admin/login">
<p><label>Contraseña<input type="password" name="clave" autocomplete="current-password" required autofocus></label></p>
<button class="principal" type="submit">Entrar</button>
</form>`,
  );
}

export type Filtro = "todas" | "toca" | "leads";
const CALIFICADOS: EstadoLead[] = ["escalado", "llamada", "propuesta", "cerrado"];

export function vistaLista(todas: ResumenConversacion[], filtro: Filtro, ahora: Date) {
  const leads = todas.filter((r) => r.lead);
  const porOrigen = new Map<string, { leads: number; contestaron: number; calificados: number; cerrados: number }>();
  for (const r of leads) {
    const k = r.lead!.ref || "sin ref";
    const o = porOrigen.get(k) ?? { leads: 0, contestaron: 0, calificados: 0, cerrados: 0 };
    o.leads++;
    if (r.conversacion.ultimo_entrante) o.contestaron++;
    if (CALIFICADOS.includes(r.lead!.estado)) o.calificados++;
    if (r.lead!.estado === "cerrado") o.cerrados++;
    porOrigen.set(k, o);
  }
  const suma = (k: "contestaron" | "calificados" | "cerrados") => [...porOrigen.values()].reduce((n, o) => n + o[k], 0);
  const tocan = todas.filter(teToca);
  const visibles = (filtro === "toca" ? tocan : filtro === "leads" ? leads : todas)
    .slice()
    .sort((a, b) => Number(teToca(b)) - Number(teToca(a)) || actividad(b) - actividad(a));
  const pestana = (f: Filtro, texto: string) =>
    html`<a class="${filtro === f ? "activa" : ""}" href="/admin?ver=${f}">${texto}</a>`;

  return pagina(
    tocan.length ? `(${tocan.length}) Panel de Chip` : "Panel de Chip",
    html`<header><h1>Panel de Chip</h1>
<form method="post" action="/admin/salir"><button type="submit">Salir</button></form></header>
<div class="cuentas">
<div><b>${leads.length}</b><span>Leads</span></div>
<div><b>${suma("contestaron")}</b><span>Contestaron</span></div>
<div><b>${suma("calificados")}</b><span>Calificados</span></div>
<div><b>${suma("cerrados")}</b><span>Cerrados</span></div>
</div>
<nav>${pestana("todas", `Todas (${todas.length})`)}${pestana("toca", `Te toca (${tocan.length})`)}${pestana("leads", `Leads (${leads.length})`)}</nav>
${visibles.length === 0 ? html`<div class="caja gris">No hay conversaciones aquí.</div>` : ""}
${visibles.map(
  (r) => html`<a class="caja fila" href="/admin/c/${r.conversacion.id}">
<div class="linea"><b class="corta">${nombreDe(r)}${r.lead ? ` · ${r.lead.negocio}` : ""}</b><span class="gris">${r.ultimo ? fecha(r.ultimo.creado) : ""}</span></div>
<div class="gris corta">${r.ultimo ? `${r.ultimo.rol === "cliente" ? "" : r.ultimo.rol === "bot" ? "Chip: " : "Tú: "}${r.ultimo.contenido}` : "Sin mensajes"}</div>
<div>${teToca(r) ? html`<span class="chip toca">Te toca</span>` : ""}${r.conversacion.pausada && !teToca(r) ? html`<span class="chip">Chip en pausa</span>` : ""}${r.lead ? html`<span class="chip">${ESTADOS[r.lead.estado]}</span>` : ""}${r.lead?.ref ? html`<span class="chip">${r.lead.ref}</span>` : ""}${ventanaAbierta(r, ahora) ? html`<span class="chip">Puedes responder</span>` : ""}${r.contacto.opt_out ? html`<span class="chip">Baja</span>` : ""}</div>
</a>`,
)}
${
  porOrigen.size
    ? html`<div class="caja"><h2>Por origen</h2><table>
<tr><th>Origen</th><th>Leads</th><th>Contestaron</th><th>Calif.</th><th>Cerrados</th></tr>
${[...porOrigen].sort((a, b) => b[1].leads - a[1].leads).map(([k, o]) => html`<tr><td>${k}</td><td>${o.leads}</td><td>${o.contestaron}</td><td>${o.calificados}</td><td>${o.cerrados}</td></tr>`)}
</table></div>`
    : ""
}`,
    60,
  );
}

const QUIEN = { cliente: "", bot: "Chip · ", humano: "Tú · " } as const;

export function vistaChat(r: ResumenConversacion, mensajes: Mensaje[], ahora: Date, aviso?: string) {
  const id = r.conversacion.id;
  const l = r.lead;
  return pagina(
    `${nombreDe(r)} | iactiva`,
    html`<header><a href="/admin">&larr; Conversaciones</a><a href="/admin/c/${id}">Actualizar</a></header>
${aviso ? html`<div class="aviso">${aviso}</div>` : ""}
<div class="caja">
<h1>${nombreDe(r)}</h1>
<div class="gris">+${r.contacto.telefono} · <a href="https://wa.me/${r.contacto.telefono}" target="_blank" rel="noopener noreferrer">Abrir en mi WhatsApp</a></div>
${
  l
    ? html`<p><b>${l.negocio}</b><br>Dolor: ${l.dolor}${l.detalle ? html`<br>Detalle: ${l.detalle}` : ""}<br><span class="gris">Formulario del ${fecha(l.creado)}${l.ref ? ` · origen ${l.ref}` : ""}</span></p>
<form class="acciones" method="post" action="/admin/c/${id}/estado">
<select name="estado" aria-label="Estado del lead">${Object.entries(ESTADOS).map(([v, t]) => html`<option value="${v}" ${v === l.estado ? "selected" : ""}>${t}</option>`)}</select>
<button type="submit">Guardar estado</button></form>`
    : ""
}
<form class="acciones" method="post" action="/admin/c/${id}/chip" style="margin-top:8px">
<span class="gris">${r.conversacion.pausada ? "Chip está en pausa." : "Chip está contestando."}</span>
<input type="hidden" name="pausar" value="${r.conversacion.pausada ? "0" : "1"}">
<button type="submit">${r.conversacion.pausada ? "Reactivar Chip" : "Pausar Chip"}</button>
</form>
</div>
${mensajes.length === 0 ? html`<div class="caja gris">Sin mensajes todavía.</div>` : ""}
${mensajes.map((m) => html`<div class="msg ${m.rol}">${m.contenido}<small>${QUIEN[m.rol]}${fecha(m.creado)}</small></div>`)}
<div id="responder">
${r.contacto.opt_out ? html`<div class="aviso">Pidió BAJA. Escríbele solo si él te vuelve a buscar.</div>` : ""}
${
  ventanaAbierta(r, ahora)
    ? html`<form class="caja" method="post" action="/admin/c/${id}/responder">
<textarea name="texto" rows="3" maxlength="4000" placeholder="Escribe tu respuesta (sale del número de Chip)" required></textarea>
<p class="gris">Al enviar, Chip se pausa en este chat.</p>
<button class="principal" type="submit">Enviar</button></form>`
    : html`<div class="caja gris">WhatsApp solo permite texto libre dentro de las 24 h desde su último mensaje. Usa "Abrir en mi WhatsApp".</div>`
}
</div>`,
  );
}
