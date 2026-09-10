-- ============================================================================
-- Otomatik Nöbet Rotasyonu — ADIM 2/3: pg_cron kurulumu
--
-- ÖNCE (bu dosyayı çalıştırmadan önce) pg_cron extension'ını aç:
--   Supabase Dashboard > Database > Extensions > "pg_cron" ara > Enable.
--   (SQL Editor'den `create extension pg_cron;` de dener misin diye
--   sorarsan: Supabase projelerinin çoğunda extension'ı Dashboard'dan
--   açmak gerekiyor çünkü doğru şemaya (genelde "extensions" ya da
--   "pg_catalog") kurulum ayrıcalığı SQL Editor'ün varsayılan rolünde her
--   zaman olmuyor — Dashboard'daki "Enable" butonu bunu doğru şekilde
--   hallediyor, en garantili yol bu.)
--
-- Bu dosya idempotent'tir: aynı isimdeki cron job'ı varsa önce kaldırıp
-- yeniden kurar, tekrar tekrar çalıştırman güvenlidir.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Aylık "süpürme" fonksiyonu
--
-- Tüm AKTİF rotasyonları gezer; son_olusturulan_ay bu ayın 1'inden gerideyse
-- (ya da hiç oluşturulmadıysa) rotasyon_ay_olustur'u BU AY için çağırır.
--
-- Neden ara aylar tek tek çağrılmıyor: rotasyon_ay_olustur artık
-- CURRENT_DATE'ten önceki hiçbir tarihi doldurmuyor (bir önceki adımda
-- kararlaştırdık). Yani pg_cron birkaç ay aksasa bile, atlanan ara aylar
-- için çağrı yapmanın hiçbir faydası yok — o tarihlerin tamamı zaten
-- geçmişte kalmış olurdu. Doğrudan BU AYI istemek, ara ayları tek tek
-- gezmekle tamamen aynı sonucu (0 atama) verir ama çok daha basittir.
--
-- Bir rotasyonda hata çıkarsa (ör. beklenmedik veri durumu) diğer
-- rotasyonların işlenmesi durmasın diye her biri kendi BEGIN/EXCEPTION
-- bloğunda çalışır; hata olursa islem_gecmisi'ne (kullanici_id=null,
-- yani "sistem") bir hata kaydı düşer.
-- ----------------------------------------------------------------------------

create or replace function public.rotasyonlar_aylik_calistir()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rotasyon record;
  v_yil integer := extract(year from current_date);
  v_ay integer := extract(month from current_date);
  v_bu_ay_ilk_gun date := make_date(v_yil, v_ay, 1);
begin
  for v_rotasyon in
    select id, isim
    from public.rotasyonlar
    where aktif = true
      and (son_olusturulan_ay is null or son_olusturulan_ay < v_bu_ay_ilk_gun)
  loop
    begin
      perform public.rotasyon_ay_olustur(v_rotasyon.id, v_yil, v_ay);
    exception when others then
      insert into public.islem_gecmisi (kullanici_id, islem_aciklamasi, islem_tipi, parametreler)
      values (
        null,
        format('%s rotasyonu otomatik ay oluşturma HATASI: %s', v_rotasyon.isim, sqlerrm),
        'rotasyon_hata',
        jsonb_build_object('rotasyon_adi', v_rotasyon.isim, 'hata', sqlerrm)
      );
    end;
  end loop;
end;
$$;

comment on function public.rotasyonlar_aylik_calistir() is
  'pg_cron tarafından aylık çağrılır: son_olusturulan_ay''ı bu aydan geride kalan tüm aktif rotasyonlar için bu ayı oluşturur. Kullanıcıya açık bir RPC değildir (EXECUTE public''ten alınıyor).';

-- Bu fonksiyon sadece pg_cron/servis bağlamı için — normal kullanıcılar
-- (authenticated/anon) doğrudan çağırmasın diye çalıştırma izni kaldırılıyor.
revoke execute on function public.rotasyonlar_aylik_calistir() from public;
revoke execute on function public.rotasyonlar_aylik_calistir() from authenticated;
revoke execute on function public.rotasyonlar_aylik_calistir() from anon;

-- ----------------------------------------------------------------------------
-- 2) Zamanlamayı kur — her ayın 1'i, 03:00 UTC
--    (İstersen cron ifadesini değiştir: dakika saat gün ay haftagünü)
-- ----------------------------------------------------------------------------

select cron.unschedule(jobid) from cron.job where jobname = 'rotasyonlar-aylik-calistir';

select cron.schedule(
  'rotasyonlar-aylik-calistir',
  '0 3 1 * *',
  $$select public.rotasyonlar_aylik_calistir();$$
);

-- ----------------------------------------------------------------------------
-- Doğrulama
-- ----------------------------------------------------------------------------

select jobid, jobname, schedule, active, command
from cron.job
where jobname = 'rotasyonlar-aylik-calistir';
