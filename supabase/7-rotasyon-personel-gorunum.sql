-- ============================================================================
-- Otomatik Nöbet Rotasyonu — ek: personel kendi takımının rotasyonunu
-- SADECE GÖRÜNTÜLEYEBİLSİN (Ana Sayfa'daki "Nöbet Rotasyonu" kartı için)
--
-- Şu ana kadar rotasyonlar/rotasyon_telafi_kuyrugu SADECE Müdür (is_global_
-- admin) ve o takımı yöneten Takım Admini (takim_yonetiliyor_mu) tarafından
-- görülebiliyordu. Bu script SELECT politikalarını genişletiyor: sıradan bir
-- personel_takim üyesi de KENDİ takımının rotasyon(lar)ını ve telafi
-- kuyruğunu görebilsin — ama insert/update/delete politikaları DEĞİŞMİYOR,
-- yani personel hâlâ hiçbir şeyi oluşturamaz/düzenleyemez/silemez (sadece
-- SELECT genişliyor).
--
-- personel_takim tablosunun SELECT politikası ("personel_takim_select_
-- authenticated", using (true)) zaten TÜM authenticated kullanıcılara açık
-- — bu script'te DOKUNULMUYOR, ekstra bir değişikliğe gerek yok (kontrol
-- edildi: supabase/normalizasyon.sql satır 166-169).
--
-- Bu dosya idempotent'tir, tekrar çalıştırılabilir.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Yardımcı fonksiyon: giriş yapmış kullanıcı hedef_takim_id'nin (personel_
--    takim üzerinden) bir üyesi mi? (takim_yonetiliyor_mu bunun "yöneten mi"
--    karşılığıydı; bu "üyesi mi" sorusuna bakıyor.)
-- ----------------------------------------------------------------------------

create or replace function public.kullanicinin_takimda_mi(hedef_takim_id bigint)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.personel_takim pt
    where pt.takim_id = hedef_takim_id
      and pt.personel_id = auth.uid()
  );
$$;

-- ----------------------------------------------------------------------------
-- 2) rotasyonlar — SELECT'i personel'in kendi takımına genişlet
--    (insert/update/delete politikaları AYNEN kalıyor, admin-scoped)
-- ----------------------------------------------------------------------------

drop policy if exists "rotasyonlar_select_scoped_admin" on public.rotasyonlar;
create policy "rotasyonlar_select_scoped"
  on public.rotasyonlar for select
  to authenticated
  using (
    public.is_global_admin()
    or public.takim_yonetiliyor_mu(takim_id)
    or public.kullanicinin_takimda_mi(takim_id)
  );

-- ----------------------------------------------------------------------------
-- 3) rotasyon_telafi_kuyrugu — aynı genişletme SELECT için (personel, "sıra
--    listesi"nde kimin telafi beklediğini görebilsin diye)
-- ----------------------------------------------------------------------------

drop policy if exists "rotasyon_telafi_kuyrugu_select" on public.rotasyon_telafi_kuyrugu;
create policy "rotasyon_telafi_kuyrugu_select"
  on public.rotasyon_telafi_kuyrugu for select
  to authenticated
  using (
    exists (
      select 1 from public.rotasyonlar r
      where r.id = rotasyon_id
        and (
          public.is_global_admin()
          or public.takim_yonetiliyor_mu(r.takim_id)
          or public.kullanicinin_takimda_mi(r.takim_id)
        )
    )
  );

-- ----------------------------------------------------------------------------
-- Doğrulama
-- ----------------------------------------------------------------------------

select polname as policy_adi, pg_get_expr(polqual, polrelid) as using_ifadesi
from pg_policy
where polrelid in ('public.rotasyonlar'::regclass, 'public.rotasyon_telafi_kuyrugu'::regclass)
  and polcmd = 'r';
