import { createHmac, timingSafeEqual } from "node:crypto";

/** Valida X-Hub-Signature-256 ("sha256=<hex>") sobre el cuerpo CRUDO. */
export function firmaValida(cuerpoCrudo: string, cabecera: string | null | undefined, appSecret: string): boolean {
  if (!cabecera || !appSecret) return false;
  const [algoritmo, recibida] = cabecera.split("=");
  if (algoritmo !== "sha256" || !recibida) return false;
  const esperada = createHmac("sha256", appSecret).update(cuerpoCrudo, "utf8").digest("hex");
  const a = Buffer.from(esperada, "hex");
  const b = Buffer.from(recibida, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function firmar(cuerpoCrudo: string, appSecret: string): string {
  return "sha256=" + createHmac("sha256", appSecret).update(cuerpoCrudo, "utf8").digest("hex");
}
