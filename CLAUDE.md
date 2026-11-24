# iactiva-bot

Bot de WhatsApp de iActiva (bot.iactiva.mx) que atiende y califica prospectos en el numero real +52 81 8471 0371 (Chip). Dueno: Daniel (iActiva, iactiva.mx). Este es un proyecto de PRODUCCION con un solo negocio (iactiva). No es la fabrica de demos: esa es `iactiva-wabot`. Tampoco es la web: esa es `iactiva`.

## Reglas de trabajo
- Responder en espanol, de tu, directo, sin emojis.
- No enviar mensajes de WhatsApp reales sin confirmacion explicita de Daniel en el chat.
- No tocar el proyecto de Vercel `iactiva` (la web) ni el repo de la web. No tocar `iactiva-wabot`.
- No leer ni mostrar .env ni llaves. Daniel las carga en Vercel / .env sin pasarlas por chat.
- Ante duda entre robusto y simple, elegir simple y avisar.

## Objetivo
Contestar a quien escribe al numero de iActiva, calificar (negocio, giro, dolor, volumen, si decide) una pregunta a la vez, no dar precios, mandar a https://iactiva.mx/restaurantes o llamada de 15 min, y escalar a Daniel con resumen (`escalar_a_humano` al 528186811851).

## Decisiones
- Origen: nucleo copiado de iactiva-wabot (webhook con firma HMAC, pipeline, faq, escalamiento, agente). El modulo `citas` sigue en el codigo (sus pruebas lo usan) pero la ficha de iactiva no lo activa.
- TypeScript, Hono, Node, pnpm. Despliegue en Vercel, proyecto NUEVO `iactiva-bot` (por crear), dominio bot.iactiva.mx (CNAME en Cloudflare, lo crea Daniel).
- IA: SDK de Anthropic, `claude-haiku-5-5` (sin `temperature`).
- Solo Cloud API oficial de Meta. Prohibido Baileys/Evolution.
- Datos: en serverless MemoryStore se pierde entre invocaciones, asi que produccion usa Supabase. Decision (2026-11-24): se COMPARTE el proyecto Supabase `iactiva-wabot` (ref aqijfmsdkatuicmguhkf) con la fabrica, para todo lo que tenga que ver con bots. Motivo: la org esta en plan Free (max 2 proyectos activos) y un proyecto nuevo costaria Pro. El esquema ya coincide con `supabase/migrations/` (verificado: 8 tablas, `citas_sin_empalme`, `btree_gist` en `extensions`, RLS sin politicas). Todo es multi-tenant por la columna `tenant` (este bot escribe `tenant = 'iactiva'`); el bot no lee la tabla `tenants`, la ficha sale de `tenants/iactiva.json`. Reglas: nunca borrar ni migrar tablas sin revisar el efecto en la fabrica; migraciones compartidas; service role solo en variables de Vercel. Cuando haya trafico real, migrar a un proyecto Pro propio (copiar tablas filtrando por tenant).
- Ficha unica: `tenants/iactiva.json` (phone_number_id 1373207305886569, waba_id 1123855237083232).
- Numero registrado en la Cloud API; la app de WhatsApp Business ya no opera con el.

## Pendiente
- Validar la ficha con `pnpm test`.
- Daniel: llaves (ANTHROPIC_API_KEY, META_APP_SECRET, META_VERIFY_TOKEN, META_SYSTEM_USER_TOKEN) en Vercel; crear proyecto Vercel, CNAME bot.iactiva.mx, callback del webhook en Meta, publicar app, verificacion de negocio.
- Entrada de Vercel (api/index.ts) y asegurar que `tenants/` viaje en la funcion.
- Persistencia: apuntar `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` de Vercel a `iactiva-wabot` (Daniel, sin pasar la llave por chat) y redeployar; luego checklist de entrega a produccion.

## Comandos
- `pnpm test`, `pnpm typecheck`, `pnpm dev`, `pnpm lab iactiva` (requiere ANTHROPIC_API_KEY en .env)
