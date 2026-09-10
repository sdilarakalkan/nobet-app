-- ============================================================================
-- Nöbet App - nobet_turleri.hafta_gunu
-- Bu dosya henüz Supabase'de çalıştırılmadı. Gözden geçirdikten sonra
-- Supabase SQL Editor'de veya migration olarak çalıştırabilirsin.
--
-- Amaç: Haftalık tekrar eden nöbet türlerinin (tekrar_sikligi = 'haftalik')
-- hangi haftanın gününde olduğunu tutmak. Günlük türlerde null kalır.
-- ============================================================================

create type hafta_gunu_tipi as enum (
  'pazartesi', 'sali', 'carsamba', 'persembe', 'cuma', 'cumartesi', 'pazar'
);

alter table public.nobet_turleri
  add column hafta_gunu hafta_gunu_tipi;

comment on column public.nobet_turleri.hafta_gunu is
  'tekrar_sikligi = haftalik olan türler için haftanın günü; gunluk türlerde null';

-- Günlük türlerde hafta_gunu boş kalmalı (haftalık türlerde zorunlu değil,
-- sadece anlamsız kombinasyonu engelliyoruz)
alter table public.nobet_turleri
  add constraint nobet_turleri_hafta_gunu_gunluk_check
  check (tekrar_sikligi = 'haftalik' or hafta_gunu is null);

-- Mevcut "Haftalık Nöbeti" türünü Perşembe olarak işaretle
update public.nobet_turleri
set hafta_gunu = 'persembe'
where isim = 'Haftalık Nöbeti';
