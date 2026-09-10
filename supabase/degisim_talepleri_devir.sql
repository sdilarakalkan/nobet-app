-- ============================================================================
-- Nöbet App - Değişim (devir) talepleri: mesaj + kabul RPC'si
-- Bu dosya henüz Supabase'de çalıştırılmadı. Gözden geçirdikten sonra
-- Supabase SQL Editor'de veya migration olarak çalıştırabilirsin.
--
-- Bağımlılık: public.degisim_talepleri, public.nobetler (schema.sql).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. degisim_talepleri.mesaj
-- Talebi gönderen personelin eklediği opsiyonel not.
-- ----------------------------------------------------------------------------

alter table public.degisim_talepleri
  add column mesaj text;

comment on column public.degisim_talepleri.mesaj is
  'Talebi gönderen personelin eklediği opsiyonel not';

-- ----------------------------------------------------------------------------
-- 2. degisim_talebini_kabul_et(p_talep_id)
--
-- Bu bir DEVİR: kabul edildiğinde nöbetin sahipliği talep edenden hedef
-- personele (kabul eden) aktarılır. nobetler tablosunun update RLS'i
-- sadece admin'e izin verdiği için (nobetler_update_admin), personel bu
-- transferi doğrudan update ile yapamaz — bu yüzden security definer bir
-- fonksiyon kullanıyoruz. Fonksiyon içinde:
--   - Talebi çağıran kullanıcının hedef_personel_id'si olduğu,
--   - Talebin hâlâ 'bekleyen' durumda olduğu,
--   - Nöbetin hâlâ talep eden kişiye ait olduğu (çifte transferi önlemek için)
-- kontrol edilir; aksi halde işlem reddedilir. Böylece personel sadece
-- KENDİSİNE yönelik bekleyen bir devir talebini kabul edebilir, başka
-- hiçbir nöbeti değiştiremez.
-- ----------------------------------------------------------------------------

create or replace function public.degisim_talebini_kabul_et(p_talep_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_talep public.degisim_talepleri%rowtype;
begin
  select * into v_talep
  from public.degisim_talepleri
  where id = p_talep_id
  for update;

  if not found then
    raise exception 'Talep bulunamadı';
  end if;

  if v_talep.hedef_personel_id <> auth.uid() then
    raise exception 'Bu talebi kabul etme yetkiniz yok';
  end if;

  if v_talep.durum <> 'bekleyen' then
    raise exception 'Bu talep zaten sonuçlandırılmış';
  end if;

  update public.nobetler
  set personel_id = v_talep.hedef_personel_id
  where id = v_talep.nobet_id
    and personel_id = v_talep.talep_eden_personel_id;

  if not found then
    raise exception 'Nöbet artık talep edende değil, devredilemedi';
  end if;

  update public.degisim_talepleri
  set durum = 'onaylanan'
  where id = p_talep_id;
end;
$$;

grant execute on function public.degisim_talebini_kabul_et(bigint) to authenticated;

-- Reddetme işlemi ayrı bir fonksiyon gerektirmiyor: degisim_talepleri için
-- mevcut "degisim_talepleri_update_involved_or_admin" RLS politikası zaten
-- hedef_personel_id = auth.uid() olan kullanıcının durumu güncellemesine
-- izin veriyor, uygulama tarafında doğrudan update ile yapılabilir.
