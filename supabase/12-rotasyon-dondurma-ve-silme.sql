-- ============================================================================
-- Rotasyon aktif/pasif/silme davranışının DÜZELTİLMESİ.
--
-- ÖNCEKİ DAVRANIŞ (10-rotasyon-pasif-nobetleri-temizle.sql, artık GEÇERSİZ):
-- rotasyon pasif yapılınca henüz gerçekleşmemiş nöbetler SİLİNİYORDU. Bu
-- dosya o davranışı tamamen kaldırıyor ve yerine "dondurma" (freeze) modelini
-- getiriyor:
--
-- 1) PASİF: nöbet kayıtları SİLİNMEZ, sadece rotasyonun kendisi pasif olduğu
--    sürece tüm listeleme ekranlarından (Ana Sayfa takvimi, Bugünkü Nöbetler,
--    Yaklaşan Nöbetler, admin/müdür dashboard'u, takas ekranı) GİZLENİR.
-- 2) AKTİF: gizleme sadece bir view filtresi olduğu için, rotasyon tekrar
--    aktif olur olmaz nöbetler otomatik (ekstra bir "geri yükleme" işlemi
--    olmadan) tekrar görünür olur. Ufuk pasif kaldığı süre boyunca ilerlemediği
--    için (rotasyonlar_aylik_calistir sadece aktif=true olanları işler),
--    reaktivasyonda 11-rotasyon-6-ay-ufuk.sql'deki
--    rotasyon_aktif_edilince_ufku_doldur_trigger zaten devreye girip eksik
--    kalan ufku (mevcut_sira_index'in kaldığı yerden) tamamlıyor — bu dosya
--    o tetikleyiciye DOKUNMUYOR, hâlâ doğru çalışıyor.
-- 3) SİLME (rotasyon satırının DELETE edilmesi, pasife çekmek DEĞİL): bu
--    durumda gelecekteki nöbetler GERÇEKTEN silinir, geçmiş nöbetler
--    dokunulmadan kalır (geçmiş kayıt).
--
-- NEDEN "nobetler tablosunda rotasyon_id sütunu YOK" HEURİSTİĞİ TERK EDİLDİ:
-- 10-rotasyon-pasif-nobetleri-temizle.sql bir nöbetin hangi rotasyondan
-- geldiğini nobet_turu_id + atama_tipi='otomatik' + takım üyeliği ile TAHMİN
-- ediyordu. Bu, aynı takımda aynı nöbet türü için birden fazla rotasyon
-- olması ya da bir kişinin birden fazla takımda olması durumunda YANLIŞ
-- eşleşme riski taşıyordu. Artık nobetler.rotasyon_id doğrudan tutuluyor —
-- hem "dondurma" filtresi hem "silme" işlemi artık tahmine değil gerçek bir
-- foreign key'e dayanıyor.
--
-- Bu dosya idempotent'tir, tekrar çalıştırılabilir.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) nobetler.rotasyon_id — bir nöbetin hangi rotasyon tarafından
--    üretildiğini (varsa) doğrudan tutar. Manuel oluşturulan nöbetlerde NULL.
--    ON DELETE SET NULL: rotasyon satırı silindiğinde GEÇMİŞ nöbetler
--    (aşağıdaki BEFORE DELETE trigger'ı sadece GELECEK olanları gerçekten
--    siler) bağlantısız ama kayıtlı kalsın diye — CASCADE kullanılırsa geçmiş
--    nöbetler de silinir, bu "geçmiş nöbetlere dokunma" kuralını bozar.
-- ----------------------------------------------------------------------------

alter table public.nobetler
  add column if not exists rotasyon_id bigint references public.rotasyonlar (id) on delete set null;

comment on column public.nobetler.rotasyon_id is
  'Bu nöbeti üreten rotasyon (varsa); rotasyon_ufku_doldur() tarafından set edilir, manuel nöbetlerde NULL. Rotasyon silinirse geçmiş nöbetlerde NULL''a düşer (bkz. rotasyon_silinince_gelecek_nobetleri_temizle), gelecek nöbetler ise aynı trigger tarafından zaten gerçekten silinmiş olur.';

create index if not exists nobetler_rotasyon_id_idx
  on public.nobetler (rotasyon_id)
  where rotasyon_id is not null;

-- Geriye dönük doldurma: daha önce (bu sütun yokken) üretilmiş 'otomatik'
-- nöbetleri, eski heuristiğin aynısıyla ama SADECE tek bir aday rotasyon
-- varsa (belirsizlik yoksa) eşleştir. Birden fazla aday varsa dokunulmaz
-- (rotasyon_id NULL kalır — en kötü ihtimalle "dondurma" filtresine takılmaz,
-- eski davranış gibi her zaman görünür kalır, YANLIŞ dondurulmaz).
with eslesme as (
  select
    n.id as nobet_id,
    r.id as rotasyon_id,
    count(*) over (partition by n.id) as aday_sayisi
  from public.nobetler n
  join public.personel_takim pt on pt.personel_id = n.personel_id
  join public.rotasyonlar r on r.takim_id = pt.takim_id and r.nobet_turu_id = n.nobet_turu_id
  where n.atama_tipi = 'otomatik'
    and n.rotasyon_id is null
)
update public.nobetler n
set rotasyon_id = e.rotasyon_id
from eslesme e
where e.nobet_id = n.id
  and e.aday_sayisi = 1;

-- ----------------------------------------------------------------------------
-- 2) rotasyon_ufku_doldur() — 11-rotasyon-6-ay-ufuk.sql'deki gövdeyle AYNI,
--    tek fark: her iki insert'e (telafi kuyruğundan atama + normal
--    round-robin ataması) artık rotasyon_id = p_rotasyon_id ekleniyor.
--    round-robin/telafi mantığının geri kalanı BİREBİR AYNI, dokunulmadı.
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
        insert into public.nobetler (personel_id, nobet_turu_id, tarih, atama_tipi, atayan_admin_id, rotasyon_id)
        values (v_telafi_kisi, v_rotasyon.nobet_turu_id, v_tarih, 'otomatik', v_rotasyon.olusturan_admin_id, p_rotasyon_id)
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
          insert into public.nobetler (personel_id, nobet_turu_id, tarih, atama_tipi, atayan_admin_id, rotasyon_id)
          values (v_aday, v_rotasyon.nobet_turu_id, v_tarih, 'otomatik', v_rotasyon.olusturan_admin_id, p_rotasyon_id)
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
  'Bir rotasyonun (son_olusturulan_tarih, hedef_tarih] aralığındaki eksik tekrarlarını oluşturur (varsayılan ufuk: bugünden 6 ay ileri). Tatil günlerini atlar, telafi kuyruğunu önceliklendirir, round-robin sırasını (mevcut_sira_index) ilerletir, her nöbete rotasyon_id yazar. İdempotent — ufuk zaten doluysa no-op döner.';

-- ----------------------------------------------------------------------------
-- 3) ESKİ "pasif olunca sil" trigger'ı ve fonksiyonu TAMAMEN KALDIRILIYOR —
--    bu davranış artık geçersiz (bkz. dosya başlığı). Reaktivasyon mantığı
--    (rotasyon_aktif_edilince_ufku_doldur_trigger, 11-rotasyon-6-ay-
--    ufuk.sql'de) buna bağımlı DEĞİLDİ, dokunmadan doğru çalışmaya devam
--    ediyor.
-- ----------------------------------------------------------------------------

drop trigger if exists rotasyon_pasif_nobetleri_temizle_trigger on public.rotasyonlar;
drop function if exists public.rotasyon_pasif_nobetleri_temizle();

-- ----------------------------------------------------------------------------
-- 4) nobetler_gorunur — "dondurma" filtresinin tek gerçek kaynağı. Pasif bir
--    rotasyona bağlı (rotasyon_id dolu, ilgili rotasyonlar.aktif=false),
--    henüz gerçekleşmemiş (tarih >= bugün) nöbetler bu view'den HARİÇ
--    tutulur. Manuel nöbetler (rotasyon_id NULL) ve GEÇMİŞ nöbetler (tarih <
--    bugün, rotasyon pasif olsa bile — geçmiş kayıt olarak kalmalı) her
--    zaman görünür.
--
--    Listeleme (SELECT) yapan tüm ekranlar bu view'i kullanmalı; INSERT/
--    UPDATE/DELETE işlemleri hâlâ doğrudan nobetler tablosuna yapılır (view
--    join içerdiği için otomatik-update edilebilir değil).
--
--    personel_yonetilen (2-ekip-sefi-mudur.sql) ile AYNI desen: düz view,
--    security_invoker YOK — nobetler'in SELECT RLS'i zaten authenticated'e
--    tamamen açık (nobetler_select_authenticated), bu view sadece ek bir
--    görünürlük FİLTRESİ katıyor, yetkiyi GENİŞLETMİYOR.
-- ----------------------------------------------------------------------------

create or replace view public.nobetler_gorunur as
select n.*
from public.nobetler n
left join public.rotasyonlar r on r.id = n.rotasyon_id
where n.rotasyon_id is null
   or r.aktif = true
   or n.tarih < current_date;

comment on view public.nobetler_gorunur is
  'nobetler''in "dondurma" filtreli hali: pasif bir rotasyona bağlı, henüz gerçekleşmemiş nöbetler burada görünmez (ama tabloda silinmeden durur, rotasyon tekrar aktif olunca otomatik geri görünür). Tüm listeleme ekranları nobetler yerine bunu kullanmalı; yazma işlemleri hâlâ nobetler tablosuna yapılır.';

grant select on public.nobetler_gorunur to authenticated;

-- ----------------------------------------------------------------------------
-- 5) Rotasyon GERÇEKTEN silinince (pasife çekmek değil, DELETE) gelecekteki
--    nöbetlerini gerçekten sil. BEFORE DELETE: satır silinmeden önce çalışır,
--    böylece "eski rotasyon_id" hâlâ nobetler'de mevcutken temizlik yapılır.
--    Geçmiş nöbetlere DOKUNULMAZ — onlar için nobetler.rotasyon_id kolonunun
--    ON DELETE SET NULL kısıtı devreye girer (rotasyon satırı gerçekten
--    silinince otomatik NULL'a düşerler, geçmiş kayıt olarak kalırlar).
--
--    Silinen nöbetlere bağlı bildirimler/degisim_talepleri, nobetler.id
--    üzerindeki mevcut ON DELETE kısıtları (SET NULL / CASCADE, bkz.
--    10-rotasyon-pasif-nobetleri-temizle.sql'in başındaki not) sayesinde
--    zaten tutarlı kalıyor — ekstra bir DELETE'e gerek yok.
--
--    security definer: nobetler_delete_scoped_admin politikası
--    personel_takim_yonetiliyor_mu(personel_id) arıyor; rotasyonlar üzerindeki
--    DELETE zaten rotasyonlar_delete_scoped_admin ile doğru yetkilendirildiği
--    için, tetiklenen temizlik RLS'e tekrar bağımlı kalmadan güvenilir
--    çalışır (10-rotasyon-pasif-nobetleri-temizle.sql'deki AYNI gerekçe).
-- ----------------------------------------------------------------------------

create or replace function public.rotasyon_silinince_gelecek_nobetleri_temizle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_silinen_sayisi integer;
begin
  delete from public.nobetler
  where rotasyon_id = old.id
    and tarih >= current_date;

  get diagnostics v_silinen_sayisi = row_count;

  insert into public.islem_gecmisi (kullanici_id, islem_aciklamasi, islem_tipi, parametreler)
  values (
    auth.uid(),
    format('%s rotasyonu silindi, %s adet henüz gerçekleşmemiş nöbet de silindi.', old.isim, v_silinen_sayisi),
    'rotasyon_silindi',
    jsonb_build_object('rotasyon_adi', old.isim, 'silinen_nobet_sayisi', v_silinen_sayisi)
  );

  return old;
end;
$$;

comment on function public.rotasyon_silinince_gelecek_nobetleri_temizle() is
  'rotasyonlar''dan bir satır DELETE edilince (pasife çekmek değil), o rotasyonun henüz gerçekleşmemiş (tarih >= bugün) nöbetlerini gerçekten siler; geçmiş nöbetler dokunulmadan kalır (rotasyon_id NULL''a düşer, ON DELETE SET NULL).';

drop trigger if exists rotasyon_silinince_gelecek_nobetleri_temizle_trigger on public.rotasyonlar;
create trigger rotasyon_silinince_gelecek_nobetleri_temizle_trigger
  before delete on public.rotasyonlar
  for each row
  execute function public.rotasyon_silinince_gelecek_nobetleri_temizle();

-- ----------------------------------------------------------------------------
-- Doğrulama
-- ----------------------------------------------------------------------------

select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'nobetler' and column_name = 'rotasyon_id';

select viewname from pg_views where schemaname = 'public' and viewname = 'nobetler_gorunur';

select tgname, tgrelid::regclass, tgenabled, tgtype
from pg_trigger
where tgname in (
  'rotasyon_pasif_nobetleri_temizle_trigger',       -- artık YOK dönmeli
  'rotasyon_silinince_gelecek_nobetleri_temizle_trigger',
  'rotasyon_aktif_edilince_ufku_doldur_trigger'      -- 11-dosyasından, hâlâ VAR olmalı
);
