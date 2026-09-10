-- ============================================================================
-- Bir rotasyon pasif yapıldığında, o rotasyonun daha önce ürettiği ama
-- HENÜZ GERÇEKLEŞMEMİŞ (bugün veya ileri tarihli) nöbetlerin otomatik
-- silinmesi.
--
-- Sorun: rotasyon.aktif = false yapmak SADECE rotasyon_ay_olustur()'un yeni
-- ay üretmesini durduruyordu (bkz. 4-rotasyonlar-sema.sql: "if not
-- v_rotasyon.aktif then raise exception"). O rotasyon tarafından ÖNCEDEN
-- üretilmiş, tarihi henüz geçmemiş nöbetler nobetler tablosunda kalmaya
-- devam ediyor ve Ana Sayfa/nöbet listelerinde görünmeye devam ediyordu.
--
-- nobetler tablosunda rotasyon_id sütunu YOK (nobet.tsx'teki
-- rotasyonYaklasanNobetler ile aynı kısıt) — bir nöbetin hangi rotasyondan
-- geldiği nobet_turu_id + atama_tipi='otomatik' + kişinin rotasyonun
-- takımına üyeliği ile eşleştiriliyor (rotasyon_ay_olustur()'un insert'ine
-- birebir bakınız: atama_tipi hep 'otomatik').
--
-- GEÇMİŞ NÖBETLERE DOKUNULMUYOR: sadece tarih >= current_date olanlar
-- silinir ("henüz gerçekleşmemiş" — nobet_duzenle()'nin de kullandığı aynı
-- sınır, bkz. 8-nobet-duzenleme-bildirimler.sql). Zaten yaşanmış nöbetler
-- geçmiş kayıt olarak kalır.
--
-- BAĞLI KAYITLAR (foreign key güvenliği):
--   - bildirimler.ilgili_nobet_id -> on delete SET NULL: bildirim silinmez,
--     sadece bağlantısı boşa düşer.
--   - degisim_talepleri.nobet_id -> on delete CASCADE: o nöbete ait bekleyen
--     takas talepleri otomatik silinir.
--   - nobet_ortaklik_talepleri: nobetler'e FK ile bağlı DEĞİL (nobet_turu_id
--     + tarih üzerinden gevşek ilişkili) — silinecek bir şey yok, FK hatası
--     riski yok.
-- Yani hem bildirimler hem degisim_talepleri şemadaki mevcut ON DELETE
-- kısıtları sayesinde zaten tutarlı kalıyor, ekstra bir DELETE'e gerek yok.
--
-- Rotasyon tekrar aktif yapılırsa silinen nöbetler GERİ GELMEZ — sadece bir
-- sonraki rotasyon_ay_olustur() çağrısında yeniden üretilmeye başlanır
-- (bilinçli tercih, geçmişe dönük yeniden doldurma zaten yok).
--
-- Bu dosya idempotent'tir, tekrar çalıştırılabilir.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Trigger fonksiyonu — BİLİNÇLİ OLARAK "security definer": nobetler_delete_
-- admin RLS politikası is_admin() şartı arıyor (bkz. schema.sql); rotasyonlar
-- üzerindeki UPDATE zaten rotasyonlar_update_scoped_admin ile (Müdür ya da o
-- takımı yöneten Takım Admini) doğru şekilde yetkilendirilmiş olduğundan,
-- tetiklenen temizlik burada RLS'e bağımlı kalmadan güvenilir şekilde çalışır.
-- ----------------------------------------------------------------------------

create or replace function public.rotasyon_pasif_nobetleri_temizle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.nobetler n
  where n.nobet_turu_id = new.nobet_turu_id
    and n.atama_tipi = 'otomatik'
    and n.tarih >= current_date
    and n.personel_id in (
      select pt.personel_id
      from public.personel_takim pt
      where pt.takim_id = new.takim_id
    );

  insert into public.islem_gecmisi (kullanici_id, islem_aciklamasi, islem_tipi, parametreler)
  values (
    auth.uid(),
    format('%s rotasyonu pasif yapıldı, henüz gerçekleşmemiş nöbetleri silindi.', new.isim),
    'rotasyon_pasif_nobet_silindi',
    jsonb_build_object('rotasyon_adi', new.isim)
  );

  return new;
end;
$$;

comment on function public.rotasyon_pasif_nobetleri_temizle() is
  'rotasyonlar.aktif true''dan false''a düşünce, o rotasyonun ürettiği (nobet_turu_id + atama_tipi=otomatik + takım üyeliği ile eşleşen) bugün/ileri tarihli nöbetleri siler; geçmiş nöbetlere dokunmaz.';

drop trigger if exists rotasyon_pasif_nobetleri_temizle_trigger on public.rotasyonlar;
create trigger rotasyon_pasif_nobetleri_temizle_trigger
  after update of aktif on public.rotasyonlar
  for each row
  when (old.aktif = true and new.aktif = false)
  execute function public.rotasyon_pasif_nobetleri_temizle();

-- ----------------------------------------------------------------------------
-- Doğrulama
-- ----------------------------------------------------------------------------

select tgname, tgrelid::regclass, tgenabled
from pg_trigger
where tgname = 'rotasyon_pasif_nobetleri_temizle_trigger';
