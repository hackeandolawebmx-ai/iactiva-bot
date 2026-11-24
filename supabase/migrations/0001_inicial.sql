-- Esquema inicial de iactiva-wabot.
-- RLS activo en todas las tablas y sin politicas: solo el backend (service role) puede leer o escribir.

create extension if not exists btree_gist;

create table tenants (
  slug text primary key,
  phone_number_id text unique,
  nombre text not null,
  giro text not null,
  ficha jsonb not null,
  actualizado timestamptz not null default now()
);

create table contactos (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  telefono text not null,
  nombre text,
  consentimiento boolean not null default false,
  opt_out boolean not null default false,
  creado timestamptz not null default now(),
  unique (tenant, telefono)
);

create table conversaciones (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  contacto_id uuid not null references contactos (id) on delete cascade,
  pausada boolean not null default false,
  resumen text not null default '',
  mensajes_desde_resumen integer not null default 0,
  ultimo_entrante timestamptz,
  creado timestamptz not null default now(),
  unique (tenant, contacto_id)
);

create table mensajes (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references conversaciones (id) on delete cascade,
  rol text not null check (rol in ('cliente', 'bot', 'humano')),
  contenido text not null,
  tokens_in integer,
  tokens_out integer,
  latencia_ms integer,
  herramientas jsonb,
  creado timestamptz not null default clock_timestamp()
);
create index mensajes_conversacion_idx on mensajes (conversacion_id, creado);

create table citas (
  id text primary key default substr(md5(gen_random_uuid()::text), 1, 8),
  tenant text not null,
  contacto_id uuid not null references contactos (id) on delete cascade,
  servicio text not null,
  nombre text not null,
  inicio timestamptz not null,
  fin timestamptz not null,
  estado text not null default 'confirmada' check (estado in ('confirmada', 'cancelada')),
  creado timestamptz not null default now(),
  check (fin > inicio),
  -- Dos citas activas del mismo negocio no pueden empalmarse, ni con peticiones simultaneas.
  constraint citas_sin_empalme exclude using gist (tenant with =, tstzrange(inicio, fin) with &&)
    where (estado <> 'cancelada')
);
create index citas_contacto_idx on citas (tenant, contacto_id, inicio);

create table pedidos (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  contacto_id uuid not null references contactos (id) on delete cascade,
  detalle jsonb not null,
  estado text not null default 'nuevo',
  creado timestamptz not null default now()
);

create table eventos_webhook (
  id bigint generated always as identity primary key,
  tipo text not null,
  payload jsonb,
  creado timestamptz not null default now()
);

-- Idempotencia: ids de mensajes de WhatsApp ya procesados.
create table mensajes_procesados (
  wa_message_id text primary key,
  creado timestamptz not null default now()
);

alter table tenants enable row level security;
alter table contactos enable row level security;
alter table conversaciones enable row level security;
alter table mensajes enable row level security;
alter table citas enable row level security;
alter table pedidos enable row level security;
alter table eventos_webhook enable row level security;
alter table mensajes_procesados enable row level security;
