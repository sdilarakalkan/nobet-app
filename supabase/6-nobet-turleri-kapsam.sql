-- ============================================================================
-- Otomatik Nöbet Rotasyonu — ek: nöbet türlerinde kapsam (scope)
--
-- Amaç: Rotasyon oluşturma formundaki "Nöbet Türü" seçimi artık kapsamlı —
-- Müdür TÜM türleri görür; Takım Admini SADECE kendi oluşturduğu türleri
-- VEYA sahibi belirtilmemiş (olusturan_admin_id null — mevcut/eski türler,
-- ör. "Gece Nöbeti") türleri görür. Bu filtre İSTEMCİ tarafında uygulanıyor
-- (app/(tabs)/nobet.tsx, Otomatik sekmesi) — nobet_turleri'nin genel SELECT
-- RLS'i ("herkes okuyabilir") BİLİNÇLİ OLARAK değişmiyor, çünkü Manuel
-- sekmesinde (ve nöbet oluştururken genel olarak) TÜM türlerin herkese
-- görünmesi gerekiyor; sadece rotasyon formunun dropdown'ı daralıyor.
--
-- Uygulamada şu an nobet_turleri'ne INSERT yapan bir form yok (sadece
-- Profil > Nöbet Türleri altında salt-okunur bir liste var) — bu yüzden bu
-- script SADECE sütunu ekliyor. İleride bir "yeni nöbet türü oluştur" formu
-- eklenirse, o formun insert'i olusturan_admin_id'yi o anki kullanıcının
-- id'siyle doldurmalı (auth.uid()) ki yeni eklenen türler otomatik olarak
-- kendi oluşturanına özel kalsın.
--
-- Bu dosya idempotent'tir, tekrar çalıştırılabilir.
-- ============================================================================

alter table public.nobet_turleri
  add column if not exists olusturan_admin_id uuid references public.personel (id) on delete set null;

comment on column public.nobet_turleri.olusturan_admin_id is
  'Bu türü oluşturan Takım Admini/Müdür. NULL = sahibi belirtilmemiş (eski/mevcut tür, herkese görünür kalır). Rotasyon formunun nöbet türü dropdown''ını kapsamlamak için kullanılır — genel SELECT erişimini kısıtlamaz.';

create index if not exists nobet_turleri_olusturan_admin_id_idx on public.nobet_turleri (olusturan_admin_id);

-- ----------------------------------------------------------------------------
-- Doğrulama
-- ----------------------------------------------------------------------------

select id, isim, olusturan_admin_id from public.nobet_turleri order by id;
