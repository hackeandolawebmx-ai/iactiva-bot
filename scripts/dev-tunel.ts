import { spawn, spawnSync } from "node:child_process";

// Levanta el servidor local y un tunel de Cloudflare (sin cuenta) para recibir el webhook de Meta.
const port = process.env.PORT ?? "3000";

if (spawnSync("cloudflared", ["--version"], { shell: true }).status !== 0) {
  console.error("Falta cloudflared. Instalalo con:  winget install Cloudflare.cloudflared");
  process.exit(1);
}

const servidor = spawn("pnpm", ["dev"], { stdio: "inherit", shell: true });
const tunel = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${port}`], { shell: true });

let avisado = false;
const buscarUrl = (chunk: Buffer) => {
  const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString());
  if (m && !avisado) {
    avisado = true;
    console.log(`\nTunel listo. En Meta (WhatsApp > Configuracion > Webhook) usa:`);
    console.log(`  URL de devolucion de llamada: ${m[0]}/webhook`);
    console.log(`  Token de verificacion: el valor de META_VERIFY_TOKEN de tu .env`);
    console.log(`La URL cambia cada vez que reinicias este comando.\n`);
  }
};
tunel.stdout.on("data", buscarUrl);
tunel.stderr.on("data", buscarUrl);

const cerrar = () => {
  servidor.kill();
  tunel.kill();
  process.exit(0);
};
process.on("SIGINT", cerrar);
servidor.on("exit", cerrar);
tunel.on("exit", cerrar);
