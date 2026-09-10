-- ============================================================================
-- Nöbet App - izin_talepleri test verisi
-- Bu dosya henüz Supabase'de çalıştırılmadı. Sadece Admin Dashboard'daki
-- "Bekleyen Talepler" bölümünü test edebilmek için örnek veri ekler.
--
-- Sabit personel_id yazmak yerine, tablodaki ilk 3 personeli (created_at
-- sırasına göre) otomatik seçip her birine farklı tarih aralığı ve sebep
-- ile 'bekleyen' durumda bir izin talebi ekliyor. Kaç personel olduğuna
-- bakılmaksızın güvenle çalışır (3'ten az personel varsa daha az satır ekler).
-- ============================================================================

with adaylar as (
  select id, row_number() over (order by created_at) as sira
  from public.personel
  limit 3
)
insert into public.izin_talepleri (personel_id, baslangic_tarih, bitis_tarih, sebep, durum)
select
  id,
  case sira
    when 1 then date '2026-09-01'
    when 2 then date '2026-09-08'
    else date '2026-09-15'
  end as baslangic_tarih,
  case sira
    when 1 then date '2026-09-03'
    when 2 then date '2026-09-08'
    else date '2026-09-19'
  end as bitis_tarih,
  case sira
    when 1 then 'Yıllık izin'
    when 2 then 'Sağlık raporu'
    else 'Aile ziyareti'
  end as sebep,
  'bekleyen'
from adaylar;
