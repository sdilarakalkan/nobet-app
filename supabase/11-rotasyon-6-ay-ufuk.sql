-- ============================================================================
-- Otomatik Nöbet Rotasyonu — 6 aylık ufuk doldurma + tespit edilen hatalar.
--
-- TESPİT EDİLEN SORUNLAR (bu dosya öncesi):
--
-- 1) Ufuk çok kısa: rotasyon_ay_olustur() SADECE tek bir (yıl, ay) çifti
--    için çalışıyordu ve pg_cron (5-rotasyonlar-pg-cron.sql) ayda sadece
--    BİR kez, o anki ayı oluşturuyordu. Yani bir rotasyon aktif edildiğinde
--    veya cron ilk çalıştığında sadece "bu ay" dolduruluyordu — birkaç
--    hafta sonrasının bile nöbeti yoktu, takvimde "hiç görünmüyor" izlenimi
--    buradan geliyordu.
--
-- 2) round-robin GERÇEKTE ilerliyor (mevcut_sira_index doğru güncelleniyor,
--    kod incelendi — bug bu fonksiyonda değil) AMA fonksiyon SADECE
--    çağrıldığında ilerliyor. Ufuk kısa olduğu için (madde 1) fonksiyon çok
--    seyrek/az sayıda tarih için çalışıyor, bu yüzden sıra "hiç ilerlemiyor"
--    gibi görünüyordu — aslında ilerliyordu ama neredeyse hiç yeni tarih
--    üretilmediği için fark edilmiyordu. Kök neden yine madde 1.
--
-- 3) tatil_gunleri hiç kontrol edilmiyordu — bir Cuma resmi tatile denk
--    gelse bile normal şekilde nöbet atanıyordu.
--
-- ÇÖZÜM: rotasyon_ay_olustur(rotasyon_id, yıl, ay) yerine, "şu andan itibaren
-- N ay ileriye kadar olan TÜM eksik tarihleri tek seferde dolduran"
-- rotasyon_ufku_doldur(rotasyon_id, hedef_tarih) fonksiyonu. Bir tarihe kadar
-- doldurulduğu artık ay değil GÜN bazında (son_olusturulan_tarih) takip
-- ediliyor — bu, "bu ay zaten oluşturulmuş" yerine "şu tarihe kadar zaten
-- oluşturulmuş" demeye izin veriyor, yani fonksiyon istenilen HERHANGİ bir
-- ufuk için (6 ay, 1 ay, test için 1 hafta ne olursa) güvenle tekrar
-- çağrılabilir, hep sadece EKSİK kalan aralığı doldurur.
--
-- Bu dosya idempotent'tir, tekrar çalıştırılabilir.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) rotasyonlar.son_olusturulan_tarih — yeni, GÜN hassasiyetinde takip.
--    Eski son_olusturulan_ay sütunu SİLİNMİYOR (geriye dönük/bilgi amaçlı
--    kalsın), ama artık mantık bu yeni sütuna göre çalışıyor.
-- ----------------------------------------------------------------------------

alter table public.rotasyonlar
  add column if not exists son_olusturulan_tarih date;

comment on column public.rotasyonlar.son_olusturulan_tarih is
  'rotasyon_ufku_doldur() bu tarihe kadar (dahil) nöbet ürettiğini işaretler; null = hiç oluşturulmadı. son_olusturulan_ay artık kullanılmıyor, sadece geriye dönük bilgi amaçlı duruyor.';

-- Var olan satırlar için kaba bir başlangıç noktası: son_olusturulan_ay
-- doluysa o ayın son günü kadar zaten dolu kabul edilsin (yanlış negatif
-- "eksik" tespiti yerine yanlış pozitif "zaten dolu" tercih edildi — ilk
-- rotasyon_ufku_doldur() çağrısı zaten eksik kalan kısmı tamamlayacak).
update public.rotasyonlar
set son_olusturulan_tarih = (son_olusturulan_ay + interval '1 month' - interval '1 day')::date
where son_olusturulan_tarih is null and son_olusturulan_ay is not null;

-- ----------------------------------------------------------------------------
-- 2) Eski rotasyon_ay_olustur(bigint, integer, integer) kaldırılıyor —
--    yerini rotasyon_ufku_doldur alıyor. Hiçbir yerde (client, cron, trigger)
--    artık çağrılmıyor.
-- ----------------------------------------------------------------------------

drop function if exists public.rotasyon_ay_olustur(bigint, integer, integer);

-- ----------------------------------------------------------------------------
-- 3) rotasyon_ufku_doldur(p_rotasyon_id, p_hedef_tarih)
--
-- p_hedef_tarih verilmezse varsayılan CURRENT_DATE + 6 ay. Sadece
-- (son_olusturulan_tarih, hedef_tarih] aralığındaki EKSİK haftanin_gunu
-- tarihlerini doldurur — zaten doldurulmuş bir ufuk için tekrar çağrılırsa
-- 'zaten_guncel' döner, hiçbir şey yapmaz (idempotent).
--
-- BİLİNÇLİ OLARAK "security invoker" (varsayılan, definer DEĞİL) — eski
-- rotasyon_ay_olustur() ile AYNI yetkilendirme modeli: yetki kontrolü
-- TAMAMEN RLS'e yaslanıyor (rotasyonlar_select_scoped_admin). Yetkisiz bir
-- Takım Admini başka takımın rotasyon id'siyle çağırırsa satırı hiç göremez.
--
-- GEÇMİŞE DÖNÜK DOLDURMA YOK: başlangıç noktası her zaman en az CURRENT_DATE.
--
-- TATİL GÜNLERİ (YENİ): tatil_gunleri'nde olan bir tarih tamamen ATLANIR —
-- o hafta için ne normal round-robin ne telafi kuyruğu işletilir, sıra
-- kimseden "harcanmaz" (mevcut_sira_index o iterasyonda değişmez). Yani bir
-- resmi tatile denk gelen nöbet, sırası gelen kişiyi atlamadan sonraki
-- tekrara ertelenmiş olur.
-- ----------------------------------------------------------------------------

create or replace function public.rotasyon_ufku_doldur(
  p_rotasyon_id bigint,
  p_hedef_tarih date default null
)
returns jsonb
language plpgsql
as $$
declare
  v_rotasyon record;
  v_hedef date := coalesce(p_hedef_tarih, (current_date + interval '6 months')::date);
  v_baslangic date;
  v_uyeler uuid[];
  v_uye_sayisi integer;
  v_index integer;
  v_tarih date;
  v_deneme integer;
  v_aday uuid;
  v_atandi boolean;
  v_atanan_sayisi integer := 0;
  v_telafi_atanan_sayisi integer := 0;
  v_atlanan_sayisi integer := 0;
  v_atlanan_tarihler date[] := '{}';
  v_tatil_sayisi integer := 0;
  v_tatil_tarihleri date[] := '{}';
  v_telafi_id bigint;
  v_telafi_kisi uuid;
begin
  select * into v_rotasyon from public.rotasyonlar where id = p_rotasyon_id;
  if not found then
    raise exception 'Rotasyon bulunamadı ya da bu rotasyonu görme yetkiniz yok: %', p_rotasyon_id;
  end if;

  if not v_rotasyon.aktif then
    raise exception 'Rotasyon pasif durumda, ufuk doldurulamaz.';
  end if;

  -- İdempotentlik: başlangıç noktası zaten hedefi geçtiyse yapacak bir şey yok.
  v_baslangic := greatest(current_date, coalesce(v_rotasyon.son_olusturulan_tarih + 1, current_date));
  if v_baslangic > v_hedef then
    return jsonb_build_object('durum', 'zaten_guncel', 'ufuk', to_char(v_hedef, 'YYYY-MM-DD'));
  end if;

  -- Takım üyeleri (SADECE rol='personel'), takıma eklenme sırasına göre.
  select array_agg(p.id order by pt.created_at asc)
  into v_uyeler
  from public.personel_takim pt
  join public.personel p on p.id = pt.personel_id
  where pt.takim_id = v_rotasyon.takim_id
    and p.rol = 'personel';

  v_uye_sayisi := coalesce(array_length(v_uyeler, 1), 0);

  if v_uye_sayisi = 0 then
    insert into public.islem_gecmisi (kullanici_id, islem_aciklamasi, islem_tipi, parametreler)
    values (
      auth.uid(),
      format('%s rotasyonu için ufuk doldurulamadı: takımda personel yok.', v_rotasyon.isim),
      'rotasyon_uye_yok',
      jsonb_build_object('rotasyon_adi', v_rotasyon.isim, 'ay', to_char(v_hedef, 'YYYY-MM'))
    );
    update public.rotasyonlar set son_olusturulan_tarih = v_hedef where id = p_rotasyon_id;
    return jsonb_build_object('durum', 'uye_yok', 'ufuk', to_char(v_hedef, 'YYYY-MM-DD'));
  end if;

  v_index := v_rotasyon.mevcut_sira_index % v_uye_sayisi;

  for v_tarih in
    select d::date
    from generate_series(v_baslangic, v_hedef, interval '1 day') as d
    where extract(isodow from d) = v_rotasyon.haftanin_gunu
  loop
    -- Resmi tatil: bu tekrarı tamamen atla, sırayı kimseden harcamadan
    -- bir sonraki tekrara ertele.
    if exists (select 1 from public.tatil_gunleri tg where tg.tarih = v_tarih) then
      v_tatil_sayisi := v_tatil_sayisi + 1;
      v_tatil_tarihleri := v_tatil_tarihleri || v_tarih;
      continue;
    end if;

    v_atandi := false;

    -- 1) ÖNCE telafi kuyruğunun en eski kaydına bak.
    select id, personel_id into v_telafi_id, v_telafi_kisi
    from public.rotasyon_telafi_kuyrugu
    where rotasyon_id = p_rotasyon_id
    order by created_at asc
    limit 1;

    if v_telafi_kisi is not null then
      if not exists (
        select 1 from public.izin_talepleri it
        where it.personel_id = v_telafi_kisi
          and it.durum = 'onaylanan'
          and v_tarih between it.baslangic_tarih and it.bitis_tarih
      ) then
        insert into public.nobetler (personel_id, nobet_turu_id, tarih, atama_tipi, atayan_admin_id)
        values (v_telafi_kisi, v_rotasyon.nobet_turu_id, v_tarih, 'otomatik', v_rotasyon.olusturan_admin_id)
        on conflict (personel_id, nobet_turu_id, tarih) do nothing;

        delete from public.rotasyon_telafi_kuyrugu where id = v_telafi_id;

        v_atandi := true;
        v_atanan_sayisi := v_atanan_sayisi + 1;
        v_telafi_atanan_sayisi := v_telafi_atanan_sayisi + 1;
      end if;
      -- hâlâ izinliyse: kuyrukta kalır, dokunmadan normal rotasyona düşülür.
    end if;

    -- 2) Telafi bu tarihi doldurmadıysa normal round-robin dener.
    if not v_atandi then
      v_deneme := 0;

      while v_deneme < v_uye_sayisi loop
        v_aday := v_uyeler[v_index + 1]; -- Postgres dizileri 1 tabanlı

        if not exists (
          select 1 from public.izin_talepleri it
          where it.personel_id = v_aday
            and it.durum = 'onaylanan'
            and v_tarih between it.baslangic_tarih and it.bitis_tarih
        ) then
          insert into public.nobetler (personel_id, nobet_turu_id, tarih, atama_tipi, atayan_admin_id)
          values (v_aday, v_rotasyon.nobet_turu_id, v_tarih, 'otomatik', v_rotasyon.olusturan_admin_id)
          on conflict (personel_id, nobet_turu_id, tarih) do nothing;

          v_index := (v_index + 1) % v_uye_sayisi;
          v_atandi := true;
          v_atanan_sayisi := v_atanan_sayisi + 1;
          exit;
        else
          -- Sırası geldi ama izinli -> telafi kuyruğuna (zaten varsa dokunma).
          insert into public.rotasyon_telafi_kuyrugu (rotasyon_id, personel_id, atlanan_tarih)
          values (p_rotasyon_id, v_aday, v_tarih)
          on conflict (rotasyon_id, personel_id) do nothing;

          v_index := (v_index + 1) % v_uye_sayisi;
          v_deneme := v_deneme + 1;
        end if;
      end loop;
    end if;

    if not v_atandi then
      v_atlanan_sayisi := v_atlanan_sayisi + 1;
      v_atlanan_tarihler := v_atlanan_tarihler || v_tarih;
    end if;
  end loop;

  update public.rotasyonlar
  set son_olusturulan_tarih = v_hedef,
      son_olusturulan_ay = date_trunc('month', v_hedef)::date,
      mevcut_sira_index = v_index
  where id = p_rotasyon_id;

  insert into public.islem_gecmisi (kullanici_id, islem_aciklamasi, islem_tipi, parametreler)
  values (
    auth.uid(),
    format(
      '%s rotasyonu %s tarihine kadar dolduruldu: %s nöbet atandı (%s telafi kuyruğundan)%s%s.',
      v_rotasyon.isim,
      to_char(v_hedef, 'YYYY-MM-DD'),
      v_atanan_sayisi,
      v_telafi_atanan_sayisi,
      case when v_atlanan_sayisi > 0
        then format(', %s tarihte kimse uygun değildi (herkes izinli)', v_atlanan_sayisi)
        else ''
      end,
      case when v_tatil_sayisi > 0
        then format(', %s tarih resmi tatil olduğu için atlandı', v_tatil_sayisi)
        else ''
      end
    ),
    'rotasyon_ay_olusturuldu',
    jsonb_build_object(
      'rotasyon_adi', v_rotasyon.isim,
      'ay', to_char(v_hedef, 'YYYY-MM'),
      'atanan', v_atanan_sayisi,
      'telafi', v_telafi_atanan_sayisi,
      'atlanan', v_atlanan_sayisi
    )
  );

  return jsonb_build_object(
    'durum', 'olusturuldu',
    'ufuk', to_char(v_hedef, 'YYYY-MM-DD'),
    'atanan', v_atanan_sayisi,
    'telafi_ile_atanan', v_telafi_atanan_sayisi,
    'atlanan', v_atlanan_sayisi,
    'atlanan_tarihler', to_jsonb(v_atlanan_tarihler),
    'tatil', v_tatil_sayisi,
    'tatil_tarihleri', to_jsonb(v_tatil_tarihleri)
  );
end;
$$;

comment on function public.rotasyon_ufku_doldur(bigint, date) is
  'Bir rotasyonun (son_olusturulan_tarih, hedef_tarih] aralığındaki eksik tekrarlarını oluşturur (varsayılan ufuk: bugünden 6 ay ileri). Tatil günlerini atlar, telafi kuyruğunu önceliklendirir, round-robin sırasını (mevcut_sira_index) ilerletir. İdempotent — ufuk zaten doluysa no-op döner.';

-- ----------------------------------------------------------------------------
-- 4) rotasyon_pasif_nobetleri_temizle() — 10-rotasyon-pasif-nobetleri-
--    temizle.sql'deki trigger fonksiyonunu GÜNCELLİYOR (trigger'ın kendisi
--    aynı isimle zaten kurulu, sadece gövdesi değişiyor).
--
--    YENİ: nöbetleri sildikten sonra son_olusturulan_tarih (ve
--    son_olusturulan_ay) NULL'a çekiliyor. Bunu yapmazsak: rotasyon tekrar
--    aktif edildiğinde rotasyon_ufku_doldur() "zaten 6 ay ileriye kadar
--    doluyum" sanıp hiçbir şey üretmez — az önce sildiğimiz nöbetler bir
--    daha asla geri gelmez. Bu, madde 5'te ("aktif/pasif davranışı") tespit
--    edilen asıl hataydı.
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

  -- Ufuk takibini sıfırla — reaktivasyonda rotasyon_ufku_doldur() az önce
  -- silinen aralığı YENİDEN üretsin diye (bkz. yukarıdaki yorum).
  update public.rotasyonlar
  set son_olusturulan_tarih = null,
      son_olusturulan_ay = null
  where id = new.id;

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

-- Trigger zaten var (10-rotasyon-pasif-nobetleri-temizle.sql), gövde
-- create or replace ile güncellendi — burada yeniden oluşturmaya gerek yok,
-- ama idempotentlik için (dosya sırası karışırsa bile) yine de garantiye alalım.
drop trigger if exists rotasyon_pasif_nobetleri_temizle_trigger on public.rotasyonlar;
create trigger rotasyon_pasif_nobetleri_temizle_trigger
  after update of aktif on public.rotasyonlar
  for each row
  when (old.aktif = true and new.aktif = false)
  execute function public.rotasyon_pasif_nobetleri_temizle();

-- ----------------------------------------------------------------------------
-- 5) YENİ: rotasyon aktif > false'tan true'ya dönünce 6 aylık ufku otomatik
--    doldur (madde 5'in "tekrar aktif yapılırsa ufku yeniden doldursun"
--    isteği). round-robin sırası (mevcut_sira_index) bu sırada HİÇ
--    sıfırlanmıyor — rotasyon_ufku_doldur() zaten kaldığı index'ten devam
--    ediyor, burada ekstra bir şey yapmaya gerek yok.
--
--    security definer: rotasyon_ufku_doldur() invoker-mode olduğu için,
--    definer bir trigger içinden çağrılması onu rotasyonlar_aylik_calistir
--    ile AYNI şekilde RLS bypass eden bağlamda çalıştırır.
-- ----------------------------------------------------------------------------

create or replace function public.rotasyon_aktif_edilince_ufku_doldur()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.rotasyon_ufku_doldur(new.id, (current_date + interval '6 months')::date);
  exception when others then
    insert into public.islem_gecmisi (kullanici_id, islem_aciklamasi, islem_tipi, parametreler)
    values (
      auth.uid(),
      format('%s rotasyonu aktif yapıldı ama ufuk doldurulamadı: %s', new.isim, sqlerrm),
      'rotasyon_hata',
      jsonb_build_object('rotasyon_adi', new.isim, 'hata', sqlerrm)
    );
  end;
  return new;
end;
$$;

comment on function public.rotasyon_aktif_edilince_ufku_doldur() is
  'rotasyonlar.aktif false''dan true''ya dönünce 6 aylık ufku otomatik doldurur; hata olursa islem_gecmisi''ne düşer, UPDATE''i engellemez.';

drop trigger if exists rotasyon_aktif_edilince_ufku_doldur_trigger on public.rotasyonlar;
create trigger rotasyon_aktif_edilince_ufku_doldur_trigger
  after update of aktif on public.rotasyonlar
  for each row
  when (old.aktif = false and new.aktif = true)
  execute function public.rotasyon_aktif_edilince_ufku_doldur();

-- ----------------------------------------------------------------------------
-- 6) pg_cron: aylık "süpürme" fonksiyonu artık TÜM aktif rotasyonlar için
--    6 aylık ufku yeniden hedefliyor (rotasyon_ufku_doldur zaten idempotent
--    olduğu için, ufuk hâlâ güncelse no-op döner — koşullu filtrelemeye
--    gerek yok, "her ay çalışıp eksik olan yeni ayı ekleme" davranışı bu
--    şekilde doğal olarak sağlanıyor).
-- ----------------------------------------------------------------------------

create or replace function public.rotasyonlar_aylik_calistir()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rotasyon record;
  v_hedef date := (current_date + interval '6 months')::date;
begin
  for v_rotasyon in
    select id, isim from public.rotasyonlar where aktif = true
  loop
    begin
      perform public.rotasyon_ufku_doldur(v_rotasyon.id, v_hedef);
    exception when others then
      insert into public.islem_gecmisi (kullanici_id, islem_aciklamasi, islem_tipi, parametreler)
      values (
        null,
        format('%s rotasyonu otomatik ufuk doldurma HATASI: %s', v_rotasyon.isim, sqlerrm),
        'rotasyon_hata',
        jsonb_build_object('rotasyon_adi', v_rotasyon.isim, 'hata', sqlerrm)
      );
    end;
  end loop;
end;
$$;

comment on function public.rotasyonlar_aylik_calistir() is
  'pg_cron tarafından aylık çağrılır: TÜM aktif rotasyonlar için ufku bugünden 6 ay ileriye tazeler (rotasyon_ufku_doldur idempotent, sadece eksik kalanı doldurur). Kullanıcıya açık bir RPC değildir.';

revoke execute on function public.rotasyonlar_aylik_calistir() from public;
revoke execute on function public.rotasyonlar_aylik_calistir() from authenticated;
revoke execute on function public.rotasyonlar_aylik_calistir() from anon;

-- Zamanlama değişmedi (her ayın 1'i, 03:00 UTC) — sadece çağırdığı fonksiyon
-- değişti, bu yüzden cron.schedule'ı yeniden kurmaya gerek yok; yine de
-- dosya idempotent kalsın diye (ör. ilk kurulumda pg_cron daha önce hiç
-- kurulmadıysa) burada da tanımlıyoruz.
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

select tgname, tgrelid::regclass, tgenabled
from pg_trigger
where tgname in ('rotasyon_pasif_nobetleri_temizle_trigger', 'rotasyon_aktif_edilince_ufku_doldur_trigger');
