-- ============================================================================
-- Admin/Müdür'ün TEK bir nöbeti (Ana Sayfa'daki takvim gün-detay panelinden
-- veya "Bugünkü Nöbetler" kartından) silmesi.
--
-- nobet_duzenle() (8-nobet-duzenleme-bildirimler.sql) ile AYNI desen:
-- BİLİNÇLİ OLARAK "security definer" — bildirimler'e insert yapabilmesi için
-- (o tabloda hiç insert policy'si yok) yükseltilmiş yetkiyle çalışması
-- gerekiyor. RLS bypass edildiği için yetki kontrolü BURADA elle yapılıyor:
-- Müdür (is_global_admin) her nöbeti silebilir; Takım Admini SADECE nöbet
-- sahibi kendi yönettiği takım(lar)ın üyesiyse silebilir
-- (personel_takim_yonetiliyor_mu — nobetler_delete_scoped_admin RLS'inin
-- kullandığı AYNI kapsam kuralı, bkz. 2-ekip-sefi-mudur.sql).
--
-- BİLİNÇLİ OLARAK client'tan doğrudan nobetler.delete() ÇAĞRILMIYOR — hem
-- bildirim atabilmek hem de yetki mantığını tek yerde (nobet_duzenle ile
-- aynı yerde) tutmak için bu RPC üzerinden gidiliyor.
--
-- Geçmiş tarihli nöbetler silinemez (nobet_duzenle'deki AYNI kural).
--
-- ROTASYONA DOKUNMAZ: silinen nöbetin rotasyon_id'si dolu olsa bile bu
-- SADECE o tek nöbet kaydını siler — rotasyonlar tablosuna, son_olusturulan_
-- tarih'e ya da mevcut_sira_index'e HİÇ dokunmaz. rotasyon_ufku_doldur()
-- sadece (son_olusturulan_tarih, hedef] aralığındaki EKSİK tarihleri
-- doldurduğu için, bu tarih zaten "üretilmiş" sayılıp bir daha otomatik
-- doldurulmaz — yani silme kalıcıdır (bilinçli tercih: admin "bu güne bu
-- kişiden/takımdan kimse gelmesin" diyebiliyor).
--
-- Bu dosya idempotent'tir, tekrar çalıştırılabilir.
-- ============================================================================

create or replace function public.nobet_sil(p_nobet_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nobet record;
  v_kisi_ad text;
  v_tur_isim text;
  v_tur_isim_en text;
begin
  select * into v_nobet from public.nobetler where id = p_nobet_id;
  if not found then
    raise exception 'Nöbet bulunamadı: %', p_nobet_id;
  end if;

  if v_nobet.tarih < current_date then
    raise exception 'Geçmiş tarihli nöbetler silinemez.';
  end if;

  if not (
    public.is_global_admin()
    or public.personel_takim_yonetiliyor_mu(v_nobet.personel_id)
  ) then
    raise exception 'Bu nöbeti silme yetkiniz yok.';
  end if;

  select ad_soyad into v_kisi_ad from public.personel where id = v_nobet.personel_id;
  select isim, isim_en into v_tur_isim, v_tur_isim_en from public.nobet_turleri where id = v_nobet.nobet_turu_id;

  -- Bildirim önce (nöbet hâlâ dururken) atılıyor; hemen sonraki delete,
  -- bildirimler.ilgili_nobet_id'yi (on delete set null) otomatik boşaltır —
  -- bildirimin kendisi silinmez, sadece bağlantısı düşer.
  insert into public.bildirimler (personel_id, baslik, mesaj, ilgili_nobet_id)
  values (
    v_nobet.personel_id,
    'Nöbet İptal Edildi',
    format('%s tarihli %s nöbetiniz iptal edildi.', to_char(v_nobet.tarih, 'DD.MM.YYYY'), coalesce(v_tur_isim, 'nöbet')),
    p_nobet_id
  );

  delete from public.nobetler where id = p_nobet_id;

  return jsonb_build_object(
    'durum', 'silindi',
    'personel_id', v_nobet.personel_id,
    'silinen_kisi_adi', v_kisi_ad,
    'tarih', to_char(v_nobet.tarih, 'YYYY-MM-DD'),
    'nobet_turu_tr', v_tur_isim,
    'nobet_turu_en', v_tur_isim_en
  );
end;
$$;

comment on function public.nobet_sil(bigint) is
  'Admin/Müdür TEK bir nöbeti siler (rotasyon kaynaklı olsa bile SADECE o günü siler, rotasyona dokunmaz); etkilenen kişiye bildirimler satırı düşer. Geçmiş tarihli nöbetler silinemez. Yetki: Müdür her şeyi, Takım Admini sadece yönettiği takımın üyelerini (nobet_duzenle ile aynı kapsam kuralı).';
