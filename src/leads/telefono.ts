/** WhatsApp entrega los celulares de Mexico como 521 + 10 digitos; el formulario manda 10. Una sola forma: 52 + 10. */
export function telefonoCanonico(bruto: string): string {
  const d = bruto.replace(/\D/g, "");
  if (d.length === 10) return `52${d}`;
  if (d.length === 13 && d.startsWith("521")) return `52${d.slice(3)}`;
  return d;
}
