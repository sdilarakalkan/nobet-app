-- ============================================================================
-- Nöbet App - Veritabanı Şeması
--
-- personel HARİÇ tüm tabloların id'leri bigint (1, 2, 3, ...) kullanır.
-- personel.id, Supabase Auth (auth.users) ile birebir eşleştiği için uuid
-- olarak kalır ve bu dosya personel tablosuna hiç dokunmaz (drop etmez).
--
-- Bu dosya idempotent'tir: personel dışındaki tabloları düşürüp (varsa
-- test verileriyle birlikte) yeniden oluşturur. Hem taze kurulum hem de
-- önceki (uuid id'li) sürümü sıfırlamak için güvenle tekrar çalıştırılabilir.
-- ============================================================================

-- gen_random_uuid() için gerekli (personel.id ve personel'e referans veren
-- uuid kolonlar için hâlâ kullanılıyor)
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- ENUM TİPLERİ
-- ----------------------------------------------------------------------------

do $$ begin
  create type personel_rolu as enum ('personel', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tekrar_sikligi_tipi as enum ('gunluk', 'haftalik');
exception when duplicate_object then null; end $$;

do $$ begin
  create type atama_tipi_enum as enum ('otomatik', 'manuel');
exception when duplicate_object then null; end $$;

do $$ begin
  create type talep_durumu as enum ('bekleyen', 'onaylanan', 'reddedilen');
exception when duplicate_object then null; end $$;

do $$ begin
  create type uye_rolu as enum ('birincil', 'ikincil');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 1. personel  (DOKUNULMAZ — uuid olarak kalır, drop edilmez)
-- id, auth.users ile birebir eşleşir (Supabase Auth kullanıcısı = personel)
-- ----------------------------------------------------------------------------

create table if not exists public.personel (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  ad_soyad text not null,
  rol personel_rolu not null default 'personel',
  created_at timestamptz not null default now()
);

comment on table public.personel is 'Ofis personeli ve rolleri';

-- ----------------------------------------------------------------------------
-- SIFIRLAMA — personel HARİÇ diğer tüm tabloları (ve test verilerini) siler.
-- CASCADE, bu tablolara referans veren kısıtları/nesneleri de temizler.
-- ----------------------------------------------------------------------------

drop table if exists public.islem_gecmisi cascade;
drop table if exists public.nobet_ortaklik_talepleri cascade;
drop table if exists public.degisim_talepleri cascade;
drop table if exists public.izin_talepleri cascade;
drop table if exists public.nobetler cascade;
drop table if exists public.nobet_gruplari cascade;
drop table if exists public.takimlar cascade;
drop table if exists public.tatil_gunleri cascade;
drop table if exists public.nobet_turleri cascade;

-- ----------------------------------------------------------------------------
-- 2. nobet_turleri
-- ----------------------------------------------------------------------------

create table public.nobet_turleri (
  id bigint generated always as identity primary key,
  isim text not null,
  renk_kodu text not null,
  saat_baslangic time not null,
  saat_bitis time not null,
  gereken_kisi_sayisi integer not null default 1 check (gereken_kisi_sayisi > 0),
  tekrar_sikligi tekrar_sikligi_tipi not null,
  created_at timestamptz not null default now()
);

comment on table public.nobet_turleri is 'Tanımlı nöbet türleri (ör. gece nöbeti, hafta sonu nöbeti)';

-- NOT: public.takimlar burada OLUŞTURULMUYOR — asıl tanımı supabase/normalizasyon.sql
-- içinde (uuid id'li, personel_takim junction tablosuyla birlikte). Yukarıdaki
-- SIFIRLAMA bölümündeki "drop table if exists public.takimlar" satırı, bu dosyanın
-- eski bir çalıştırmasından kalmış olabilecek çakışan bir sürümü temizlemek için
-- duruyor; normalizasyon.sql'i schema.sql'den SONRA çalıştır.

-- ----------------------------------------------------------------------------
-- 3. nobet_gruplari
-- ----------------------------------------------------------------------------

create table public.nobet_gruplari (
  id bigint generated always as identity primary key,
  grup_adi text not null,
  aciklama text not null,
  nobet_turu_id bigint not null references public.nobet_turleri (id) on delete restrict,
  baslangic_tarih date not null,
  bitis_tarih date not null,
  baslangic_saat time,
  bitis_saat time,
  olusturan_admin_id uuid references public.personel (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint nobet_gruplari_tarih_sirasi check (bitis_tarih >= baslangic_tarih)
);

comment on table public.nobet_gruplari is 'Tek seferde oluşturulan, birden çok personeli kapsayan nöbet grupları';

-- ----------------------------------------------------------------------------
-- 4. nobetler
-- ----------------------------------------------------------------------------

create table public.nobetler (
  id bigint generated always as identity primary key,
  personel_id uuid not null references public.personel (id) on delete cascade,
  nobet_turu_id bigint not null references public.nobet_turleri (id) on delete restrict,
  tarih date not null,
  atama_tipi atama_tipi_enum not null default 'otomatik',
  atayan_admin_id uuid references public.personel (id) on delete set null,
  grup_id bigint references public.nobet_gruplari (id) on delete cascade,
  rol uye_rolu not null default 'birincil',
  onay_durumu talep_durumu not null default 'onaylanan',
  gosterildi boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.nobetler is 'Personele atanmış nöbetler';
comment on column public.nobetler.grup_id is 'Bu nöbetin ait olduğu grup (nobet_gruplari), tekil atamalarda boş';
comment on column public.nobetler.rol is 'Grup içindeki nöbet rolü (birincil/ikincil)';
comment on column public.nobetler.onay_durumu is
  'Nöbetin kendisi dışındaki personel için onay durumu; kendi nöbetlerinde ve admin/otomatik atamalarda her zaman onaylanan';
comment on column public.nobetler.gosterildi is
  'true olduğunda "Onay Bekleyen Nöbetler" bölümünde artık gösterilmez';

-- Aynı personelin aynı gün aynı nöbet türüne iki kez atanmasını engelle
create unique index nobetler_personel_tur_tarih_key
  on public.nobetler (personel_id, nobet_turu_id, tarih);

-- ----------------------------------------------------------------------------
-- 5. izin_talepleri
-- ----------------------------------------------------------------------------

create table public.izin_talepleri (
  id bigint generated always as identity primary key,
  personel_id uuid not null references public.personel (id) on delete cascade,
  baslangic_tarih date not null,
  bitis_tarih date not null,
  sebep text,
  durum talep_durumu not null default 'bekleyen',
  created_at timestamptz not null default now(),
  constraint izin_tarih_sirasi check (bitis_tarih >= baslangic_tarih)
);

comment on table public.izin_talepleri is 'Personel izin talepleri';

-- ----------------------------------------------------------------------------
-- 6. degisim_talepleri
-- ----------------------------------------------------------------------------

create table public.degisim_talepleri (
  id bigint generated always as identity primary key,
  nobet_id bigint not null references public.nobetler (id) on delete cascade,
  talep_eden_personel_id uuid not null references public.personel (id) on delete cascade,
  hedef_personel_id uuid not null references public.personel (id) on delete cascade,
  durum talep_durumu not null default 'bekleyen',
  created_at timestamptz not null default now(),
  constraint degisim_farkli_personel check (talep_eden_personel_id <> hedef_personel_id)
);

comment on table public.degisim_talepleri is 'Nöbet değişim (takas) talepleri';

-- ----------------------------------------------------------------------------
-- 7. nobet_ortaklik_talepleri
-- ----------------------------------------------------------------------------

create table public.nobet_ortaklik_talepleri (
  id bigint generated always as identity primary key,
  talep_eden_personel_id uuid not null references public.personel (id) on delete cascade,
  hedef_personel_id uuid not null references public.personel (id) on delete cascade,
  nobet_turu_id bigint not null references public.nobet_turleri (id) on delete restrict,
  tarih date not null,
  durum talep_durumu not null default 'bekleyen',
  created_at timestamptz not null default now(),
  constraint nobet_ortaklik_farkli_personel check (talep_eden_personel_id <> hedef_personel_id)
);

comment on table public.nobet_ortaklik_talepleri is 'Personelin birlikte nöbet tutmak için başka bir personele gönderdiği talepler';

-- ----------------------------------------------------------------------------
-- 8. tatil_gunleri
-- ----------------------------------------------------------------------------

create table public.tatil_gunleri (
  id bigint generated always as identity primary key,
  tarih date not null unique,
  aciklama text,
  created_at timestamptz not null default now()
);

comment on table public.tatil_gunleri is 'Resmi tatil ve özel günler';

-- ----------------------------------------------------------------------------
-- 9. islem_gecmisi
-- ----------------------------------------------------------------------------

create table public.islem_gecmisi (
  id bigint generated always as identity primary key,
  kullanici_id uuid references public.personel (id) on delete set null,
  islem_aciklamasi text not null,
  tarih timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.islem_gecmisi is 'Denetim / işlem geçmişi kaydı (audit log)';

-- ----------------------------------------------------------------------------
-- İNDEKSLER
-- ----------------------------------------------------------------------------

create index nobet_gruplari_nobet_turu_id_idx on public.nobet_gruplari (nobet_turu_id);
create index nobet_gruplari_olusturan_admin_id_idx on public.nobet_gruplari (olusturan_admin_id);
create index nobet_gruplari_baslangic_tarih_idx on public.nobet_gruplari (baslangic_tarih);

create index nobetler_personel_id_idx on public.nobetler (personel_id);
create index nobetler_nobet_turu_id_idx on public.nobetler (nobet_turu_id);
create index nobetler_tarih_idx on public.nobetler (tarih);
create index nobetler_grup_id_idx on public.nobetler (grup_id);

create index izin_talepleri_personel_id_idx on public.izin_talepleri (personel_id);
create index izin_talepleri_durum_idx on public.izin_talepleri (durum);

create index degisim_talepleri_nobet_id_idx on public.degisim_talepleri (nobet_id);
create index degisim_talepleri_talep_eden_idx on public.degisim_talepleri (talep_eden_personel_id);
create index degisim_talepleri_hedef_idx on public.degisim_talepleri (hedef_personel_id);
create index degisim_talepleri_durum_idx on public.degisim_talepleri (durum);

create index nobet_ortaklik_talepleri_talep_eden_idx on public.nobet_ortaklik_talepleri (talep_eden_personel_id);
create index nobet_ortaklik_talepleri_hedef_idx on public.nobet_ortaklik_talepleri (hedef_personel_id);
create index nobet_ortaklik_talepleri_durum_idx on public.nobet_ortaklik_talepleri (durum);

create index islem_gecmisi_kullanici_id_idx on public.islem_gecmisi (kullanici_id);
create index islem_gecmisi_tarih_idx on public.islem_gecmisi (tarih);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Recursion'ı önlemek için security definer fonksiyon: mevcut kullanıcı admin mi?
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.personel
    where id = auth.uid() and rol = 'admin'
  );
$$;

-- ----------------------------------------------------------------------------
-- personel  (DOKUNULMAZ — policy'ler değişmedi)
-- ----------------------------------------------------------------------------

alter table public.personel enable row level security;

drop policy if exists "personel_select_authenticated" on public.personel;
create policy "personel_select_authenticated"
  on public.personel for select
  to authenticated
  using (true);

drop policy if exists "personel_insert_self" on public.personel;
create policy "personel_insert_self"
  on public.personel for insert
  to authenticated
  with check (id = auth.uid());

drop policy if exists "personel_update_self_or_admin" on public.personel;
create policy "personel_update_self_or_admin"
  on public.personel for update
  to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists "personel_delete_admin" on public.personel;
create policy "personel_delete_admin"
  on public.personel for delete
  to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- nobet_turleri
-- ----------------------------------------------------------------------------

alter table public.nobet_turleri enable row level security;

create policy "nobet_turleri_select_authenticated"
  on public.nobet_turleri for select
  to authenticated
  using (true);

create policy "nobet_turleri_write_admin"
  on public.nobet_turleri for insert
  to authenticated
  with check (public.is_admin());

create policy "nobet_turleri_update_admin"
  on public.nobet_turleri for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "nobet_turleri_delete_admin"
  on public.nobet_turleri for delete
  to authenticated
  using (public.is_admin());

-- NOT: public.takimlar RLS'i burada tanımlanmıyor — tablo normalizasyon.sql'de
-- oluşturuluyor, RLS politikaları da orada.

-- ----------------------------------------------------------------------------
-- nobet_gruplari
-- ----------------------------------------------------------------------------

alter table public.nobet_gruplari enable row level security;

create policy "nobet_gruplari_select_authenticated"
  on public.nobet_gruplari for select
  to authenticated
  using (true);

create policy "nobet_gruplari_insert_admin"
  on public.nobet_gruplari for insert
  to authenticated
  with check (public.is_admin());

create policy "nobet_gruplari_update_admin"
  on public.nobet_gruplari for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "nobet_gruplari_delete_admin"
  on public.nobet_gruplari for delete
  to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- nobetler: onay_durumu / gosterildi hesaplama trigger'ı
--
-- Bu iki alan istemciden gelen değerden BAĞIMSIZ olarak burada hesaplanır;
-- böylece bir personelin insert sırasında kendi/başkasının kaydını
-- onay_durumu='onaylanan' göndererek onay sürecini atlatması mümkün olmaz.
--
--   - personel_id = auth.uid() (kendi nöbeti)              -> onaylanan, gosterildi=true
--   - is_admin() OR atama_tipi = 'otomatik'                 -> onaylanan, gosterildi=false
--   - aksi halde (personel + manuel, başkası için)          -> bekleyen,  gosterildi=false
-- ----------------------------------------------------------------------------

create or replace function public.nobetler_onay_hesapla()
returns trigger
language plpgsql
as $$
begin
  if new.personel_id = auth.uid() then
    new.onay_durumu := 'onaylanan';
    new.gosterildi := true;
  elsif public.is_admin() or new.atama_tipi = 'otomatik' then
    new.onay_durumu := 'onaylanan';
    new.gosterildi := false;
  else
    new.onay_durumu := 'bekleyen';
    new.gosterildi := false;
  end if;
  return new;
end;
$$;

create trigger nobetler_onay_hesapla_trigger
  before insert on public.nobetler
  for each row
  execute function public.nobetler_onay_hesapla();

-- ----------------------------------------------------------------------------
-- nobetler
-- ----------------------------------------------------------------------------

alter table public.nobetler enable row level security;

create policy "nobetler_select_authenticated"
  on public.nobetler for select
  to authenticated
  using (true);

-- Personel de (başkaları için "bekleyen" satırlar dahil) nöbet
-- oluşturabildiğinden insert admin'e özel değil; onay_durumu/gosterildi
-- yukarıdaki trigger ile güvenceye alındığı için bunu herkese (authenticated)
-- açmak güvenli.
create policy "nobetler_insert_authenticated"
  on public.nobetler for insert
  to authenticated
  with check (true);

create policy "nobetler_update_admin"
  on public.nobetler for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Personel kendi satırındaki bekleyen bir talebi onaylayabilir (Kabul Et)
-- ya da zaten onaylanmış+gösterilmemiş bir satırı "gördüm" diye işaretleyip
-- (Tamam/Kapat) listeden kaldırabilir. Yukarıdaki nobetler_update_admin
-- politikasına ek olarak çalışır.
create policy "nobetler_update_own_onay"
  on public.nobetler for update
  to authenticated
  using (
    personel_id = auth.uid()
    and (onay_durumu = 'bekleyen' or (onay_durumu = 'onaylanan' and gosterildi = false))
  )
  with check (personel_id = auth.uid());

create policy "nobetler_delete_admin"
  on public.nobetler for delete
  to authenticated
  using (public.is_admin());

-- Personel kendi bekleyen satırını reddettiğinde satır tamamen silinir.
create policy "nobetler_delete_own_pending_onay"
  on public.nobetler for delete
  to authenticated
  using (personel_id = auth.uid() and onay_durumu = 'bekleyen');

-- ----------------------------------------------------------------------------
-- izin_talepleri
-- ----------------------------------------------------------------------------

alter table public.izin_talepleri enable row level security;

create policy "izin_talepleri_select_own_or_admin"
  on public.izin_talepleri for select
  to authenticated
  using (personel_id = auth.uid() or public.is_admin());

create policy "izin_talepleri_insert_self"
  on public.izin_talepleri for insert
  to authenticated
  with check (personel_id = auth.uid());

create policy "izin_talepleri_update_own_pending_or_admin"
  on public.izin_talepleri for update
  to authenticated
  using (
    (personel_id = auth.uid() and durum = 'bekleyen') or public.is_admin()
  )
  with check (
    (personel_id = auth.uid() and durum = 'bekleyen') or public.is_admin()
  );

create policy "izin_talepleri_delete_own_pending_or_admin"
  on public.izin_talepleri for delete
  to authenticated
  using (
    (personel_id = auth.uid() and durum = 'bekleyen') or public.is_admin()
  );

-- ----------------------------------------------------------------------------
-- degisim_talepleri
-- ----------------------------------------------------------------------------

alter table public.degisim_talepleri enable row level security;

create policy "degisim_talepleri_select_involved_or_admin"
  on public.degisim_talepleri for select
  to authenticated
  using (
    talep_eden_personel_id = auth.uid()
    or hedef_personel_id = auth.uid()
    or public.is_admin()
  );

create policy "degisim_talepleri_insert_self"
  on public.degisim_talepleri for insert
  to authenticated
  with check (
    talep_eden_personel_id = auth.uid()
    and exists (
      select 1 from public.nobetler n
      where n.id = nobet_id and n.personel_id = auth.uid()
    )
  );

create policy "degisim_talepleri_update_involved_or_admin"
  on public.degisim_talepleri for update
  to authenticated
  using (
    hedef_personel_id = auth.uid()
    or (talep_eden_personel_id = auth.uid() and durum = 'bekleyen')
    or public.is_admin()
  )
  with check (
    hedef_personel_id = auth.uid()
    or (talep_eden_personel_id = auth.uid() and durum = 'bekleyen')
    or public.is_admin()
  );

create policy "degisim_talepleri_delete_own_pending_or_admin"
  on public.degisim_talepleri for delete
  to authenticated
  using (
    (talep_eden_personel_id = auth.uid() and durum = 'bekleyen') or public.is_admin()
  );

-- ----------------------------------------------------------------------------
-- nobet_ortaklik_talepleri
-- ----------------------------------------------------------------------------

alter table public.nobet_ortaklik_talepleri enable row level security;

create policy "nobet_ortaklik_talepleri_select_involved_or_admin"
  on public.nobet_ortaklik_talepleri for select
  to authenticated
  using (
    talep_eden_personel_id = auth.uid()
    or hedef_personel_id = auth.uid()
    or public.is_admin()
  );

create policy "nobet_ortaklik_talepleri_insert_self"
  on public.nobet_ortaklik_talepleri for insert
  to authenticated
  with check (talep_eden_personel_id = auth.uid());

create policy "nobet_ortaklik_talepleri_update_involved_or_admin"
  on public.nobet_ortaklik_talepleri for update
  to authenticated
  using (
    hedef_personel_id = auth.uid()
    or (talep_eden_personel_id = auth.uid() and durum = 'bekleyen')
    or public.is_admin()
  )
  with check (
    hedef_personel_id = auth.uid()
    or (talep_eden_personel_id = auth.uid() and durum = 'bekleyen')
    or public.is_admin()
  );

create policy "nobet_ortaklik_talepleri_delete_own_pending_or_admin"
  on public.nobet_ortaklik_talepleri for delete
  to authenticated
  using (
    (talep_eden_personel_id = auth.uid() and durum = 'bekleyen') or public.is_admin()
  );

-- ----------------------------------------------------------------------------
-- tatil_gunleri
-- ----------------------------------------------------------------------------

alter table public.tatil_gunleri enable row level security;

create policy "tatil_gunleri_select_authenticated"
  on public.tatil_gunleri for select
  to authenticated
  using (true);

create policy "tatil_gunleri_insert_admin"
  on public.tatil_gunleri for insert
  to authenticated
  with check (public.is_admin());

create policy "tatil_gunleri_update_admin"
  on public.tatil_gunleri for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "tatil_gunleri_delete_admin"
  on public.tatil_gunleri for delete
  to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- islem_gecmisi
-- ----------------------------------------------------------------------------

alter table public.islem_gecmisi enable row level security;

create policy "islem_gecmisi_select_own_or_admin"
  on public.islem_gecmisi for select
  to authenticated
  using (kullanici_id = auth.uid() or public.is_admin());

create policy "islem_gecmisi_insert_self"
  on public.islem_gecmisi for insert
  to authenticated
  with check (kullanici_id = auth.uid());

-- Denetim kaydı değiştirilemez/silinemez (update/delete politikası yok = varsayılan olarak engelli)
