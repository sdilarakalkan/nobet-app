-- ============================================================================
-- Nöbete özel saat override alanları.
--
-- Şu ana kadar bir nöbetin saati SADECE bağlı olduğu nobet_turleri kaydından
-- (saat_baslangic/saat_bitis, NOT NULL) geliyordu — tek bir nöbetin saatini,
-- türünü değiştirmeden, elle ayarlamanın bir yolu yoktu.
--
-- Bu dosya nobetler'e iki NULLABLE "override" sütunu ekliyor:
--   - saat_baslangic_ozel, saat_bitis_ozel
-- Doluysa (admin/müdür "Nöbeti Düzenle" ekranından elle ayarladıysa) o
-- nöbetin saatini nobet_turleri'ndeki varsayılanın YERİNE kullanılır; boşsa
-- (varsayılan/çoğunluk durum) davranış eskisiyle birebir aynı kalır — tür
-- saatine geri düşülür. Bu yüzden geriye dönük UYUMLU: mevcut hiçbir satır
-- etkilenmez, hiçbir mevcut sorgu/trigger/RLS bozulmaz.
--
-- Kasıtlı olarak baslangic < bitis check constraint'i YOK: nobet_turleri'nde
-- de böyle bir kısıt yok (gece nöbeti gibi gece yarısını geçen -ör. 22:00-
-- 06:00- vardiyalar geçerli, bitis saati baslangic'tan küçük olabilir).
--
-- Bu dosya idempotent'tir, tekrar çalıştırılabilir.
-- ============================================================================

alter table public.nobetler
  add column if not exists saat_baslangic_ozel time,
  add column if not exists saat_bitis_ozel time;

comment on column public.nobetler.saat_baslangic_ozel is
  'Doluysa bu nöbetin başlangıç saatini nobet_turleri.saat_baslangic yerine ezer (admin/müdür elle düzenlemesi); boşsa nöbet türünün varsayılan saati kullanılır.';
comment on column public.nobetler.saat_bitis_ozel is
  'Doluysa bu nöbetin bitiş saatini nobet_turleri.saat_bitis yerine ezer (admin/müdür elle düzenlemesi); boşsa nöbet türünün varsayılan saati kullanılır.';

-- RLS: nobetler'in mevcut SELECT/UPDATE politikaları (schema.sql,
-- supabase/2-ekip-sefi-mudur.sql) satır bazlı çalışıyor ve kolon listesine
-- bağlı değil — yeni sütunlar için ayrıca bir politika eklemeye gerek yok;
-- "nobetler_update_scoped_admin" zaten Müdür'e her nöbeti, Takım Admini'ne
-- SADECE yönettiği takım(lar)ın üyelerine ait nöbeti güncelleme izni veriyor.

-- ----------------------------------------------------------------------------
-- Doğrulama
-- ----------------------------------------------------------------------------

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'nobetler'
order by ordinal_position;
