-- ============================================================================
-- Nöbet App - Pozisyon / Takım Normalizasyonu
-- Bu dosya henüz Supabase'de çalıştırılmadı. Gözden geçirdikten sonra
-- Supabase SQL Editor'de veya migration olarak çalıştırabilirsin.
--
-- Bağımlılık: public.personel tablosu ve public.is_admin() fonksiyonu
-- supabase/schema.sql içinde tanımlı olmalı.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. pozisyonlar
-- ----------------------------------------------------------------------------

create table public.pozisyonlar (
  id uuid primary key default gen_random_uuid(),
  pozisyon_adi text not null unique,
  created_at timestamptz not null default now()
);

comment on table public.pozisyonlar is 'Tanımlı personel pozisyonları';

-- ----------------------------------------------------------------------------
-- 2. takimlar
-- ----------------------------------------------------------------------------

create table public.takimlar (
  id uuid primary key default gen_random_uuid(),
  takim_adi text not null unique,
  created_at timestamptz not null default now()
);

comment on table public.takimlar is 'Tanımlı takımlar';

-- ----------------------------------------------------------------------------
-- 3. personel_pozisyon (junction tablo)
-- Bir personel birden fazla pozisyona sahip olabilir
-- ----------------------------------------------------------------------------

create table public.personel_pozisyon (
  id uuid primary key default gen_random_uuid(),
  personel_id uuid not null references public.personel (id) on delete cascade,
  pozisyon_id uuid not null references public.pozisyonlar (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint personel_pozisyon_unique unique (personel_id, pozisyon_id)
);

comment on table public.personel_pozisyon is 'Personel-pozisyon eşleştirme (çoka çok)';

-- ----------------------------------------------------------------------------
-- 4. personel_takim (junction tablo)
-- Bir personel birden fazla takıma ait olabilir
-- ----------------------------------------------------------------------------

create table public.personel_takim (
  id uuid primary key default gen_random_uuid(),
  personel_id uuid not null references public.personel (id) on delete cascade,
  takim_id uuid not null references public.takimlar (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint personel_takim_unique unique (personel_id, takim_id)
);

comment on table public.personel_takim is 'Personel-takım eşleştirme (çoka çok)';

-- ----------------------------------------------------------------------------
-- İNDEKSLER
-- ----------------------------------------------------------------------------

create index personel_pozisyon_personel_id_idx on public.personel_pozisyon (personel_id);
create index personel_pozisyon_pozisyon_id_idx on public.personel_pozisyon (pozisyon_id);

create index personel_takim_personel_id_idx on public.personel_takim (personel_id);
create index personel_takim_takim_id_idx on public.personel_takim (takim_id);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- Not: public.is_admin() fonksiyonu schema.sql içinde tanımlı.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- pozisyonlar
-- ----------------------------------------------------------------------------

alter table public.pozisyonlar enable row level security;

create policy "pozisyonlar_select_authenticated"
  on public.pozisyonlar for select
  to authenticated
  using (true);

create policy "pozisyonlar_insert_admin"
  on public.pozisyonlar for insert
  to authenticated
  with check (public.is_admin());

create policy "pozisyonlar_update_admin"
  on public.pozisyonlar for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "pozisyonlar_delete_admin"
  on public.pozisyonlar for delete
  to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- takimlar
-- ----------------------------------------------------------------------------

alter table public.takimlar enable row level security;

create policy "takimlar_select_authenticated"
  on public.takimlar for select
  to authenticated
  using (true);

create policy "takimlar_insert_admin"
  on public.takimlar for insert
  to authenticated
  with check (public.is_admin());

create policy "takimlar_update_admin"
  on public.takimlar for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "takimlar_delete_admin"
  on public.takimlar for delete
  to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- personel_pozisyon
-- ----------------------------------------------------------------------------

alter table public.personel_pozisyon enable row level security;

create policy "personel_pozisyon_select_authenticated"
  on public.personel_pozisyon for select
  to authenticated
  using (true);

create policy "personel_pozisyon_insert_admin"
  on public.personel_pozisyon for insert
  to authenticated
  with check (public.is_admin());

create policy "personel_pozisyon_update_admin"
  on public.personel_pozisyon for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "personel_pozisyon_delete_admin"
  on public.personel_pozisyon for delete
  to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- personel_takim
-- ----------------------------------------------------------------------------

alter table public.personel_takim enable row level security;

create policy "personel_takim_select_authenticated"
  on public.personel_takim for select
  to authenticated
  using (true);

create policy "personel_takim_insert_admin"
  on public.personel_takim for insert
  to authenticated
  with check (public.is_admin());

create policy "personel_takim_update_admin"
  on public.personel_takim for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "personel_takim_delete_admin"
  on public.personel_takim for delete
  to authenticated
  using (public.is_admin());
