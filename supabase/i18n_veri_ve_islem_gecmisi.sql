-- ============================================================================
-- Nöbet App - Kullanıcı verisi i18n (nöbet türü / pozisyon / takım isimleri)
-- + İşlem Geçmişi'nin yapısal (çevrilebilir) hale getirilmesi
--
-- Bu dosya henüz Supabase'de çalıştırılmadı. Gözden geçirdikten sonra
-- Supabase SQL Editor'de veya migration olarak çalıştırabilirsin.
--
-- Bağımlılık: public.nobet_turleri, public.tatil_gunleri (schema.sql),
-- public.pozisyonlar, public.takimlar (normalizasyon.sql),
-- public.personel_detay (personel_detay_view.sql), public.islem_gecmisi
-- (schema.sql) — hepsinin zaten çalıştırılmış olması gerekir.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. İngilizce isim sütunları
-- ----------------------------------------------------------------------------

alter table public.nobet_turleri
  add column isim_en text;

alter table public.pozisyonlar
  add column pozisyon_adi_en text;

alter table public.takimlar
  add column takim_adi_en text;

comment on column public.nobet_turleri.isim_en is
  'isim alanının İngilizce karşılığı; boşsa arayüzde isim (Türkçe) yedek olarak gösterilir';
comment on column public.pozisyonlar.pozisyon_adi_en is
  'pozisyon_adi alanının İngilizce karşılığı; boşsa arayüzde pozisyon_adi (Türkçe) yedek olarak gösterilir';
comment on column public.takimlar.takim_adi_en is
  'takim_adi alanının İngilizce karşılığı; boşsa arayüzde takim_adi (Türkçe) yedek olarak gösterilir';

-- ----------------------------------------------------------------------------
-- 2. Mevcut kayıtları makul İngilizce çevirileriyle doldur
-- ----------------------------------------------------------------------------

-- nöbet türleri (bilinen isimler; listede olmayanlar boş kalır, sonradan
-- Supabase'den elle doldurulabilir)
update public.nobet_turleri set isim_en = 'Daily Shift' where isim = 'Günlük Nöbeti';
update public.nobet_turleri set isim_en = 'Weekly Shift' where isim = 'Haftalık Nöbeti';
update public.nobet_turleri set isim_en = 'Night Shift' where isim = 'Gece Nöbeti';
update public.nobet_turleri set isim_en = 'Weekend Shift' where isim = 'Hafta Sonu Nöbeti';
update public.nobet_turleri set isim_en = 'Public Holiday Shift' where isim = 'Resmi Tatil Nöbeti';
update public.nobet_turleri set isim_en = 'Prod Shift' where isim = 'Prod Nöbeti';

-- pozisyonlar
update public.pozisyonlar set pozisyon_adi_en = 'Software' where pozisyon_adi = 'Yazılım';
update public.pozisyonlar set pozisyon_adi_en = 'Analysis' where pozisyon_adi = 'Analiz';
update public.pozisyonlar set pozisyon_adi_en = 'Technical Manager' where pozisyon_adi = 'Teknik Müdür';
update public.pozisyonlar set pozisyon_adi_en = 'Support' where pozisyon_adi = 'Destek';

-- takımlar: "X Takımı" -> "Team X" kalıbına uyan TÜM takımları otomatik
-- çevirir (örn. "A Takımı" -> "Team A", "B Takımı" -> "Team B", ...),
-- kalıba uymayan özel isimli takımlar boş kalır (elle doldurulabilir).
update public.takimlar
set takim_adi_en = regexp_replace(takim_adi, '^(.*) Takımı$', 'Team \1')
where takim_adi ~ ' Takımı$';

-- ----------------------------------------------------------------------------
-- 3. personel_detay view: pozisyonlar_en / takimlar_en ekle
--
-- Her alt öğe kendi İngilizce ismi boşsa Türkçesine düşer (coalesce), böylece
-- pozisyonlar_en/takimlar_en hiçbir zaman kısmen boş bir liste olmaz; sıralama
-- her iki dilde de aynı (Türkçe isme göre) kalır ki dil değişince liste sırası
-- kaymasın.
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
  ) as takimlar_en
from public.personel p;

comment on view public.personel_detay is
  'personel + pozisyon(lar) + takım(lar) tek satırda, virgülle ayrılmış (TR ve EN)';

grant select on public.personel_detay to authenticated;

-- ----------------------------------------------------------------------------
-- 4. islem_gecmisi: yapısal (çevrilebilir) loglama için yeni sütunlar
--
-- islem_aciklamasi KALDIRILMIYOR — geriye dönük uyumluluk için duruyor; eski
-- kayıtlar hep Türkçe düz metin olarak kalacak (bilinçli, geriye dönük
-- çevrilmeyecek). Bundan sonraki loglar hem islem_aciklamasi'nı (Türkçe düz
-- metin, eskisi gibi) HEM DE islem_tipi + parametreler'i dolduracak;
-- uygulama, İşlem Geçmişi'ni gösterirken islem_tipi doluysa parametreler'den
-- o an aktif dile göre cümleyi kendi kuracak, boşsa islem_aciklamasi'nı
-- olduğu gibi (Türkçe) gösterecek.
-- ----------------------------------------------------------------------------

alter table public.islem_gecmisi
  add column islem_tipi text;

alter table public.islem_gecmisi
  add column parametreler jsonb;

comment on column public.islem_gecmisi.islem_tipi is
  'Örn. nobet_olusturuldu, nobet_onaylandi, nobet_reddedildi, takas_kabul, takas_red, izin_onaylandi, izin_reddedildi. Boşsa eski kayıt demektir, islem_aciklamasi olduğu gibi gösterilir.';
comment on column public.islem_gecmisi.parametreler is
  'islem_tipi ile birlikte, cümleyi o an aktif dilde kurmak için gereken değişkenler (ör. {"kullanici_adi": "...", "nobet_turu_tr": "...", "nobet_turu_en": "...", "tarih": "..."})';
