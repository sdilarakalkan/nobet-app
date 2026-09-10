-- ============================================================================
-- personel_detay view'ı
--
-- Daha önce "zaten var" sanılıyordu ama Supabase'de hiç oluşturulmamıştı —
-- bu yüzden app/(tabs)/nobet.tsx ve app/(tabs)/profil.tsx'teki
-- .from('personel_detay') sorguları sessizce boş/hatalı dönüyordu.
--
-- Bağımlılık: bu view, personel (schema.sql) ile pozisyonlar/takimlar/
-- personel_pozisyon/personel_takim (normalizasyon.sql) tablolarını
-- birleştiriyor. Önce ikisinin de çalıştırılmış olması gerekir.
--
-- id, email, ad_soyad, rol: personel'den birebir.
-- pozisyonlar, takimlar: virgülle ayrılmış metin (string_agg), hiç atanmamışsa
-- null gelir (uygulama tarafında zaten '-' ile karşılanıyor).
--
-- RLS notu: view kendi başına RLS'e sahip olamaz, sorguyu çalıştıran rolün
-- (authenticated) alttaki personel/personel_pozisyon/personel_takim
-- tablolarındaki mevcut RLS politikaları normal şekilde uygulanır — ekstra
-- bir işlem gerekmiyor.
-- ============================================================================

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
  ) as takimlar
from public.personel p;

comment on view public.personel_detay is 'personel + pozisyon(lar) + takım(lar) tek satırda, virgülle ayrılmış';

grant select on public.personel_detay to authenticated;

-- Doğrulama: kendi hesabınla giriş yapmış gibi değil ama SQL Editor'de veri var mı diye bak.
select * from public.personel_detay order by ad_soyad;
