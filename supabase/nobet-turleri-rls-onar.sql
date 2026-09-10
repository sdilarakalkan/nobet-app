-- ============================================================================
-- nobet_turleri "0 kayıt dönüyor" teşhisi + garanti onarım
--
-- Önce 1) ve 2)'yi çalıştırıp sonucu bana yapıştır — asıl sebep hangisiyse
-- (veri yok mu, RLS mi) netleşir. 3) her durumda güvenle çalıştırılabilir:
-- mevcut policy'ler ne halde olursa olsun, olması gereken tek policy'yi
-- (herkes okuyabilir) garantiye alır.
-- ============================================================================

-- 1) Tabloda gerçekten kaç satır var? (SQL Editor RLS'i görmezden gelir,
--    bu yüzden burada 0 çıkması "veri hiç girilmemiş" demektir.)
select count(*) as kayit_sayisi from public.nobet_turleri;
select id, isim, saat_baslangic, saat_bitis from public.nobet_turleri order by id;

-- 2) Tabloda ŞU AN hangi select policy'leri tanımlı? (Beklenen: tek satır,
--    "nobet_turleri_select_authenticated", using_ifadesi = "true")
select
  polname as policy_adi,
  case polcmd
    when 'r' then 'select'
    when 'a' then 'insert'
    when 'w' then 'update'
    when 'd' then 'delete'
    else polcmd::text
  end as islem,
  pg_get_expr(polqual, polrelid) as using_ifadesi
from pg_policy
where polrelid = 'public.nobet_turleri'::regclass;

-- RLS bu tabloda açık mı? (relrowsecurity = true olmalı)
select relrowsecurity, relforcerowsecurity
from pg_class
where oid = 'public.nobet_turleri'::regclass;

-- 3) GARANTİ ONARIM — ne olursa olsun doğru duruma getirir.
alter table public.nobet_turleri enable row level security;

drop policy if exists "nobet_turleri_select_authenticated" on public.nobet_turleri;
create policy "nobet_turleri_select_authenticated"
  on public.nobet_turleri for select
  to authenticated
  using (true);

-- Eğer 1)'de kayıt sayısı gerçekten 0 çıktıysa, RLS'in suçu yok — veri hiç
-- girilmemiş demektir. O zaman supabase/seed-veri.sql'i (henüz çalıştırmadıysan)
-- SQL Editor'de çalıştırman gerekiyor.
