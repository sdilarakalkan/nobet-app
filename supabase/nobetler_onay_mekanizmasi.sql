-- ============================================================================
-- Nöbet App - nobetler onay mekanizması (onay_durumu + gosterildi)
-- Bu dosya henüz Supabase'de çalıştırılmadı. Gözden geçirdikten sonra
-- Supabase SQL Editor'de veya migration olarak çalıştırabilirsin.
--
-- GÜNCELLEME: Bu dosyadaki sütunlar, trigger ve RLS politikaları artık
-- supabase/schema.sql içine de (nobetler tablosunun tanımına ve RLS
-- bölümüne) kalıcı olarak eklendi. Yani:
--   - schema.sql'i SIFIRDAN çalıştırıyorsan (yeni kurulum ya da mevcut
--     tabloları drop/recreate ederek sıfırlıyorsan) bu dosyaya HİÇ gerek
--     yok, her şey zaten schema.sql'de geliyor.
--   - Bu dosya sadece, schema.sql zaten çalışmış ve nobetler tablosu bu
--     sütunlar OLMADAN halihazırda VAR olan bir veritabanını tek seferlik
--     güncellemek için hâlâ gerekli (alter table + backfill + trigger/RLS).
--     Böyle bir veritabanında bunu bir kez çalıştırdıktan sonra bir daha
--     çalıştırma (sütunlar zaten var olacağı için "add column" hata verir).
--
-- Bağımlılık: public.nobetler, public.personel, public.is_admin(),
-- public.talep_durumu enum'ı (hepsi schema.sql içinde).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Yeni sütunlar
-- ----------------------------------------------------------------------------

alter table public.nobetler
  add column onay_durumu talep_durumu not null default 'onaylanan';

alter table public.nobetler
  add column gosterildi boolean not null default false;

comment on column public.nobetler.onay_durumu is
  'Nöbetin kendisi dışındaki personel için onay durumu; kendi nöbetlerinde ve admin/otomatik atamalarda her zaman onaylanan';
comment on column public.nobetler.gosterildi is
  'true olduğunda "Onay Bekleyen Nöbetler" bölümünde artık gösterilmez';

-- Bu değişiklikten ÖNCE oluşturulmuş kayıtlar zaten fiilen geçerli/onaylı
-- kabul edilir ve "Onay Bekleyen Nöbetler" bölümünde aniden belirmesinler
-- diye gösterildi=true olarak işaretlenir. Bundan sonraki tüm satırlar
-- aşağıdaki trigger tarafından hesaplanır.
update public.nobetler set onay_durumu = 'onaylanan', gosterildi = true;

-- ----------------------------------------------------------------------------
-- 2. Trigger: onay_durumu / gosterildi sunucu tarafında hesaplanır
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

drop trigger if exists nobetler_onay_hesapla_trigger on public.nobetler;
create trigger nobetler_onay_hesapla_trigger
  before insert on public.nobetler
  for each row
  execute function public.nobetler_onay_hesapla();

-- ----------------------------------------------------------------------------
-- 3. RLS güncellemeleri
-- ----------------------------------------------------------------------------

-- Artık personel de (başkaları için "bekleyen" satırlar dahil) nöbet
-- oluşturabildiğinden insert admin'e özel olamaz. onay_durumu/gosterildi
-- zaten yukarıdaki trigger ile güvenceye alındığı için insert'ü herkese
-- (authenticated) açmak güvenli.
drop policy if exists "nobetler_insert_admin" on public.nobetler;
create policy "nobetler_insert_authenticated"
  on public.nobetler for insert
  to authenticated
  with check (true);

-- Personel kendi satırındaki bekleyen bir talebi onaylayabilir (Kabul Et)
-- ya da zaten onaylanmış+gösterilmemiş bir satırı "gördüm" diye işaretleyip
-- (Tamam/Kapat) listeden kaldırabilir. nobetler_update_admin politikası
-- (schema.sql) admin için ayrıca duruyor, bu politika ona ek olarak çalışır.
create policy "nobetler_update_own_onay"
  on public.nobetler for update
  to authenticated
  using (
    personel_id = auth.uid()
    and (onay_durumu = 'bekleyen' or (onay_durumu = 'onaylanan' and gosterildi = false))
  )
  with check (personel_id = auth.uid());

-- Personel kendi bekleyen satırını reddettiğinde satır tamamen silinir.
create policy "nobetler_delete_own_pending_onay"
  on public.nobetler for delete
  to authenticated
  using (personel_id = auth.uid() and onay_durumu = 'bekleyen');
