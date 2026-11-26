-- Ejecuta esto una vez en Supabase: SQL Editor > New query > Run
create table public.notes (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null default '',
  body text not null default '',
  created bigint not null,
  updated bigint not null,
  deleted boolean not null default false,
  rev bigint not null default 0,
  primary key (user_id, id)
);
create index notes_user_rev on public.notes (user_id, rev);

alter table public.notes enable row level security;
create policy "solo mis notas" on public.notes for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- rev lo pone el servidor: permite sincronizar sin depender del reloj de cada dispositivo
create function public.set_rev() returns trigger language plpgsql as $$
begin new.rev := (extract(epoch from clock_timestamp()) * 1000)::bigint; return new; end $$;
create trigger notes_rev before insert or update on public.notes
  for each row execute function public.set_rev();
