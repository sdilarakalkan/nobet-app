-- ============================================================================
-- Profil ekranındaki "Bildirimler" aç/kapa toggle'ı — kullanıcı push bildirim
-- almak istiyor mu istemiyor mu.
--
-- personel.bildirim_aktif: varsayılan true (herkes push alır). Kullanıcı
-- Profil ekranından kapatırsa send-push-notification Edge Function (bkz.
-- supabase/14-push-bildirim-webhook.sql) bu kişiye push GÖNDERMEZ — ama
-- bildirimler tablosuna satır düşmeye (uygulama içi zil/panel) devam eder,
-- bu sütun SADECE cihaza giden push'u kontrol eder.
--
-- RLS: personel_update_self_or_admin (schema.sql) zaten "id = auth.uid()"
-- olduğu sürece kendi satırını güncellemeye izin veriyor — bu SÜTUN İÇİN
-- ayrı bir policy gerekmiyor, client doğrudan
-- supabase.from('personel').update({ bildirim_aktif: ... }).eq('id', kendi_id)
-- ile yazabilir (lib/pushToken.ts'nin expo_push_token'ı yazma şekliyle AYNI
-- desen).
--
-- Bu dosya idempotent'tir, tekrar çalıştırılabilir.
-- ============================================================================

alter table public.personel
  add column if not exists bildirim_aktif boolean not null default true;

comment on column public.personel.bildirim_aktif is
  'false ise send-push-notification Edge Function bu kişiye push GÖNDERMEZ (uygulama içi bildirimler etkilenmez). Profil ekranındaki "Bildirimler" toggle''ı ile değiştirilir.';

-- ----------------------------------------------------------------------------
-- personel_detay view'ı bildirim_aktif'i de döndürsün diye yeniden
-- tanımlanıyor (i18n_veri_ve_islem_gecmisi.sql'deki gövdeyle AYNI, tek fark
-- bildirim_aktif eklendi). Profil ekranı bu view'dan `select *` çekiyor.
--
-- DÜZELTME: bildirim_aktif İLK denemede rol'den hemen sonraya eklenmişti —
-- Postgres "create or replace view", var olan sütunları AYNI POZİSYONDA
-- bekler; araya yeni bir sütun sokmak sonraki sütunların "yeniden
-- adlandırıldığı" sanılmasına yol açıp hata veriyordu (42P16). Bunun yerine
-- yeni sütun listenin EN SONUNA eklendi — mevcut sütunların hepsi eskisiyle
-- birebir aynı isim/sırada, view DROP edilmeden (personel_yonetilen gibi
-- ona bağımlı view'lar bozulmadan) güvenle "create or replace" yapılabiliyor.
-- ----------------------------------------------------------------------------

create or replace view public.personel_detay as
select
  p.id,
  p.email,
  p.ad_soyad,
  p.rol,
  (
    select string_agg(poz.pozisyon_adi, ', ' order by poz.pozisyon_adi)
    from public.personel_pozisyon pp
    join public.pozisyonlar poz on poz.id = pp.pozisyon_id
    where pp.personel_id = p.id
  ) as pozisyonlar,
  (
    select string_agg(tk.takim_adi, ', ' order by tk.takim_adi)
    from public.personel_takim pt
    join public.takimlar tk on tk.id = pt.takim_id
    where pt.personel_id = p.id
  ) as takimlar,
  (
    select string_agg(coalesce(poz.pozisyon_adi_en, poz.pozisyon_adi), ', ' order by poz.pozisyon_adi)
    from public.personel_pozisyon pp
    join public.pozisyonlar poz on poz.id = pp.pozisyon_id
    where pp.personel_id = p.id
  ) as pozisyonlar_en,
  (
    select string_agg(coalesce(tk.takim_adi_en, tk.takim_adi), ', ' order by tk.takim_adi)
    from public.personel_takim pt
    join public.takimlar tk on tk.id = pt.takim_id
    where pt.personel_id = p.id
  ) as takimlar_en,
  p.bildirim_aktif
from public.personel p;

comment on view public.personel_detay is
  'personel + pozisyon(lar) + takım(lar) tek satırda, virgülle ayrılmış (TR ve EN) + bildirim_aktif';

grant select on public.personel_detay to authenticated;

-- ----------------------------------------------------------------------------
-- Doğrulama
-- ----------------------------------------------------------------------------

select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'personel' and column_name = 'bildirim_aktif';

select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'personel_detay' and column_name = 'bildirim_aktif';
