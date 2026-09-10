-- ============================================================================
-- Test verisi seed script'i
--
-- ÖNCE supabase/seed-users.mjs çalıştırılmış olmalı (3 yeni sahte personel
-- auth.users + personel tablosuna eklenmiş olmalı) — bu script mevcut TÜM
-- personeli (eski 4 + yeni 3 = 7 kişi) yeni oluşturulacak takımlara dağıtır.
--
-- Bu script tekrar tekrar güvenle çalıştırılabilir (idempotent):
-- - takimlar/pozisyonlar isimleri unique olduğu için "on conflict do nothing"
-- - nöbet_turleri için "where not exists" koruması var
-- - personel_takim eşleştirmesi her çalıştırmada personel sayısına göre
--   round-robin yeniden hesaplanır, "on conflict do nothing" ile tekrarı önler
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Nöbet türleri (3 farklı isim/saat/renk)
-- ----------------------------------------------------------------------------

insert into public.nobet_turleri (isim, renk_kodu, saat_baslangic, saat_bitis, gereken_kisi_sayisi, tekrar_sikligi)
select 'Gece Nöbeti', '#0B1C30', '20:00', '08:00', 2, 'gunluk'
where not exists (select 1 from public.nobet_turleri where isim = 'Gece Nöbeti');

insert into public.nobet_turleri (isim, renk_kodu, saat_baslangic, saat_bitis, gereken_kisi_sayisi, tekrar_sikligi)
select 'Hafta Sonu Nöbeti', '#D92D20', '08:00', '20:00', 1, 'haftalik'
where not exists (select 1 from public.nobet_turleri where isim = 'Hafta Sonu Nöbeti');

insert into public.nobet_turleri (isim, renk_kodu, saat_baslangic, saat_bitis, gereken_kisi_sayisi, tekrar_sikligi)
select 'Resmi Tatil Nöbeti', '#006B5F', '00:00', '23:59', 2, 'haftalik'
where not exists (select 1 from public.nobet_turleri where isim = 'Resmi Tatil Nöbeti');

-- ----------------------------------------------------------------------------
-- 2) Takımlar (3 adet)
-- ----------------------------------------------------------------------------

insert into public.takimlar (takim_adi) values
  ('Backend Takımı'),
  ('Saha Ekibi'),
  ('Destek Takımı')
on conflict (takim_adi) do nothing;

-- ----------------------------------------------------------------------------
-- 3) Tüm personeli (eski + yeni, kaç kişi varsa) 3 takıma round-robin dağıt
-- ----------------------------------------------------------------------------

insert into public.personel_takim (personel_id, takim_id)
select p.id, t.id
from (
  select id, row_number() over (order by created_at) as sira
  from public.personel
) p
join (
  select id, row_number() over (order by takim_adi) as sira
  from public.takimlar
  where takim_adi in ('Backend Takımı', 'Saha Ekibi', 'Destek Takımı')
) t on t.sira = ((p.sira - 1) % 3) + 1
on conflict (personel_id, takim_id) do nothing;

-- ----------------------------------------------------------------------------
-- 4) Özet — kimin hangi takıma/pozisyona/role düştüğünü görmek için
-- ----------------------------------------------------------------------------

select
  p.ad_soyad,
  p.rol,
  string_agg(distinct poz.pozisyon_adi, ', ') as pozisyonlar,
  string_agg(distinct tk.takim_adi, ', ') as takimlar
from public.personel p
left join public.personel_pozisyon pp on pp.personel_id = p.id
left join public.pozisyonlar poz on poz.id = pp.pozisyon_id
left join public.personel_takim pt on pt.personel_id = p.id
left join public.takimlar tk on tk.id = pt.takim_id
group by p.id, p.ad_soyad, p.rol
order by p.ad_soyad;
