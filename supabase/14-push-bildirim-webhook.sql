-- ============================================================================
-- Push bildirimleri — bildirimler tablosuna yeni bir satır eklenince
-- send-push-notification Edge Function'ını (supabase/functions/send-push-
-- notification/index.ts) pg_net ile tetikleyen trigger.
--
-- AKIŞ: bildirimler INSERT -> bu trigger -> pg_net.http_post ile Edge
-- Function'a POST -> Edge Function bildirimi ve alıcının expo_push_token'ını
-- okuyup Expo'nun push API'sine (https://exp.host/--/api/v2/push/send)
-- gönderiyor. Uygulama-içi bildirim (bildirimler satırı, zil/panel) zaten
-- normal akışla oluşuyor — bu SADECE ek olarak cihaza push bildirimi
-- düşürüyor, mevcut hiçbir davranışı değiştirmiyor.
--
-- GÜVENLİK / SIR SAKLAMA — DÜZELTME: İlk denemede "alter database postgres
-- set app.settings.push_webhook_secret = ..." kullanılmıştı, ama hosted
-- Supabase'de SQL Editor'ün bağlandığı rol gerçek bir cluster superuser'ı
-- DEĞİL — bu komut "permission denied to set parameter" hatası veriyor
-- (custom GUC'lar için ALTER DATABASE superuser/DB sahibi gerektiriyor,
-- hosted ortamda bu yetki verilmiyor). BUNUN YERİNE Supabase Vault
-- (supabase_vault uzantısı, TÜM hosted projelerde varsayılan olarak kurulu)
-- kullanılıyor: sır vault.secrets'a ŞİFRELİ olarak yazılır, trigger içinden
-- vault.decrypted_secrets view'ından okunur — hosted ortamda superuser
-- gerektirmeyen, Supabase'in resmi önerdiği yöntem bu.
--
-- Trigger, Edge Function'a X-Webhook-Secret header'ında bu sırrı gönderir;
-- Edge Function bunu kendi PUSH_WEBHOOK_SECRET ortam değişkeniyle
-- karşılaştırıp doğrular. BİLİNÇLİ OLARAK service role key gibi yüksek
-- yetkili bir anahtar KULLANILMIYOR — sadece bir paylaşılan sır; sızsa bile
-- en kötü ihtimalle biri fonksiyonu id bazlı çağırıp gereksiz bir push
-- attırabilir (veri okuma/yazma yetkisi vermiyor).
--
-- ÇALIŞTIRMADAN ÖNCE:
--   v_edge_function_url zaten senin proje referansınla (frllwnhjkfbbkwsudtoc)
--   dolduruldu — farklı bir Supabase projesindeysen değiştir.
--
-- ÇALIŞTIRDIKTAN SONRA, AYRICA bir kere (dosyanın en altındaki "SIRRI VAULT'A
-- YAZ" bölümünü oku) sırrı Vault'a yazman gerekiyor.
--
-- Bu dosya idempotent'tir, tekrar çalıştırılabilir (vault.create_secret
-- HARİÇ — o, en altta AYRI ve sadece BİR KERE çalıştırılacak bir adım).
-- ============================================================================

create extension if not exists pg_net with schema extensions;

-- Hosted Supabase'de normalde zaten kurulu olur; garantiye almak için
-- idempotent şekilde burada da belirtiliyor (zaten kuruluysa no-op).
create extension if not exists supabase_vault;

-- personel.expo_push_token — lib/pushToken.ts (registerForPushNotificationsAsync)
-- tarafından yazılıyor ama bu sütun şu ana kadar hiç oluşturulmamıştı.
alter table public.personel
  add column if not exists expo_push_token text;

comment on column public.personel.expo_push_token is
  'Expo push notification token (Notifications.getExpoPushTokenAsync), lib/pushToken.ts tarafından yazılır. Cihaz kaydı yoksa/bildirim izni verilmediyse NULL.';

create or replace function public.bildirim_push_tetikle()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_edge_function_url text := 'https://frllwnhjkfbbkwsudtoc.supabase.co/functions/v1/send-push-notification';
  v_webhook_sirri text;
begin
  select decrypted_secret into v_webhook_sirri
  from vault.decrypted_secrets
  where name = 'push_webhook_secret'
  limit 1;

  perform net.http_post(
    url := v_edge_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Webhook-Secret', coalesce(v_webhook_sirri, '')
    ),
    body := jsonb_build_object('bildirim_id', new.id)
  );
  return new;
exception when others then
  -- Push tetikleme başarısız olsa bile uygulama-içi bildirim (bildirimler
  -- satırı) zaten oluştu — hatayı yutup INSERT'i ASLA engellemiyoruz.
  raise warning 'bildirim_push_tetikle hatası: %', sqlerrm;
  return new;
end;
$$;

comment on function public.bildirim_push_tetikle() is
  'bildirimler''e yeni satır eklenince send-push-notification Edge Function''ını pg_net ile tetikler; Edge Function Expo push API''sine gönderim yapar. Paylaşılan sırrı vault.decrypted_secrets''tan (name=''push_webhook_secret'') okur. Hata olursa sessizce loglanır (raise warning), INSERT''i engellemez.';

drop trigger if exists bildirim_push_tetikle_trigger on public.bildirimler;
create trigger bildirim_push_tetikle_trigger
  after insert on public.bildirimler
  for each row
  execute function public.bildirim_push_tetikle();

-- ----------------------------------------------------------------------------
-- Doğrulama
-- ----------------------------------------------------------------------------

select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'personel' and column_name = 'expo_push_token';

select extname from pg_extension where extname in ('pg_net', 'supabase_vault');

select tgname, tgrelid::regclass, tgenabled
from pg_trigger
where tgname = 'bildirim_push_tetikle_trigger';

-- ============================================================================
-- SIRRI VAULT'A YAZ — yukarıdaki her şey çalıştırıldıktan SONRA, AYRI bir
-- sorgu olarak, SADECE BİR KERE çalıştır. '<AYNI-uzun-rastgele-deger>' yerine
-- Edge Function'a "supabase secrets set PUSH_WEBHOOK_SECRET=..." ile
-- verdiğin DEĞERİN BİREBİR AYNISINI yaz:
--
--   select vault.create_secret(
--     '<AYNI-uzun-rastgele-deger>',
--     'push_webhook_secret',
--     'send-push-notification Edge Function icin paylasilan webhook sirri'
--   );
--
-- İLERİDE sırrı DEĞİŞTİRMEN gerekirse (create_secret aynı isimle ikinci kez
-- çağrılırsa "duplicate key" hatası verir, isim unique):
--
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'push_webhook_secret'),
--     '<YENİ-deger>'
--   );
-- ============================================================================
