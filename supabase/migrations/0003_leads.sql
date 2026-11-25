-- Prospectos que llegan por los formularios de la web. RLS activo sin politicas: solo el backend.
create table leads (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  contacto_id uuid not null references contactos (id) on delete cascade,
  negocio text not null,
  nombre text not null,
  dolor text not null,
  detalle text not null default '',
  ref text not null default '',
  estado text not null default 'nuevo'
    check (estado in ('nuevo', 'contactado', 'en_conversacion', 'escalado', 'llamada', 'propuesta', 'cerrado', 'descartado')),
  contactado timestamptz,
  seguimiento_enviado timestamptz,
  creado timestamptz not null default now(),
  unique (tenant, contacto_id)
);
create index leads_pendientes_idx on leads (tenant, estado, contactado);

alter table leads enable row level security;
