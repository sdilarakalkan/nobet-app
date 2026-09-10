-- ============================================================================
-- Otomatik Nöbet Rotasyonu — ADIM 1/3: şema + fonksiyon
--
-- Bu adımda SADECE veritabanı katmanı var: rotasyonlar tablosu, telafi
-- kuyruğu tablosu, RLS, rotasyon_ay_olustur() fonksiyonu. pg_cron kurulumu
-- ve admin ekranı SONRAKİ adımlarda (onayından sonra).
--
-- Bu dosya idempotent'tir, tekrar çalıştırılabilir.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) rotasyonlar
--
-- haftanin_gunu: integer, ISO hafta günü — 1=Pazartesi ... 7=Pazar. Bu,
-- projede zaten kullanılan HAFTA_GUNU_SIRA (nobet.tsx) ve Postgres'in
-- EXTRACT(ISODOW FROM tarih) fonksiyonuyla birebir aynı numaralandırma —
-- yani tarih hesaplarken ekstra bir çeviri tablosuna gerek kalmıyor.
--
-- mevcut_sira_index: normal round-robin'in "sıradaki kişi" işaretçisi.
-- SADECE normal rotasyon bir tarihi doldurduğunda ilerler — telafi
-- kuyruğundan yapılan atamalar bu işaretçiyi DEĞİŞTİRMEZ (aşağıdaki
-- rotasyon_telafi_kuyrugu ve fonksiyon yorumuna bakınız).
--
-- son_olusturulan_ay: en son BAŞARIYLA oluşturulan ayın 1'i (ör. 2026-08-01
-- = Ağustos 2026 oluşturuldu). null = hiç oluşturulmadı.
--
-- DÜZELTME: takim_id başta yanlışlıkla uuid yazılmıştı — public.takimlar.id
-- gerçekte bigint (normalizasyon.sql dosyası artık güncel değil, canlıda
-- takimlar/personel_takim/pozisyonlar/personel_pozisyon hepsi bigint). Bu
-- tip uyuşmazlığı yüzünden takim_id -> takimlar(id) foreign key'i zaten
-- kurulamazdı, yani bu iki tablo muhtemelen hiç oluşmamıştı; yine de
-- garantiye almak için önce (varsa) düşürüp doğru tiple yeniden kuruyoruz.
-- ----------------------------------------------------------------------------

drop table if exists public.rotasyon_telafi_kuyrugu cascade;
drop table if exists public.rotasyonlar cascade;

create table public.rotasyonlar (
  id bigint generated always as identity primary key,
  isim text not null,
  takim_id bigint not null references public.takimlar (id) on delete cascade,
  nobet_turu_id bigint not null references public.nobet_turleri (id) on delete restrict,
  haftanin_gunu integer not null check (haftanin_gunu between 1 and 7),
  aktif boolean not null default true,
  mevcut_sira_index integer not null default 0,
  son_olusturulan_ay date,
  olusturan_admin_id uuid references public.personel (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.rotasyonlar is 'Bir takım için otomatik/haftalık nöbet rotasyonu tanımı';
comment on column public.rotasyonlar.haftanin_gunu is 'ISO hafta günü: 1=Pazartesi ... 7=Pazar (EXTRACT(ISODOW ...) ile aynı)';
comment on column public.rotasyonlar.mevcut_sira_index is 'Normal round-robin işaretçisi — telafi kuyruğundan yapılan atamalarda değişmez';
comment on column public.rotasyonlar.son_olusturulan_ay is 'En son başarıyla oluşturulan ayın 1''i; null = hiç oluşturulmadı';

create index if not exists rotasyonlar_takim_id_idx on public.rotasyonlar (takim_id);
create index if not exists rotasyonlar_aktif_idx on public.rotasyonlar (aktif);

-- ----------------------------------------------------------------------------
-- 2) rotasyon_telafi_kuyrugu — "borç" listesi
--
-- Bir kişi normal sırasında izinli olduğu için atlandığında buraya bir
-- kayıt düşer. Rotasyon her yeni tarih doldururken ÖNCE bu kuyruğun EN
-- ESKİ kaydına bakar: o kişi o tarihte müsaitse normal sırayı atlayıp ONA
-- atanır ve kayıt silinir; hâlâ izinliyse kayıt kuyrukta kalmaya devam
-- eder (yeniden denenir). Bir kişinin aynı rotasyonda birden fazla bekleyen
-- borcu olmaz (unique kısıt + on conflict do nothing) — "bir borç" yeterli,
-- kaç kez atlanırsa atlansın tek kayıt temsil eder.
-- ----------------------------------------------------------------------------

create table if not exists public.rotasyon_telafi_kuyrugu (
  id bigint generated always as identity primary key,
  rotasyon_id bigint not null references public.rotasyonlar (id) on delete cascade,
  personel_id uuid not null references public.personel (id) on delete cascade,
  atlanan_tarih date not null,
  created_at timestamptz not null default now(),
  constraint rotasyon_telafi_kuyrugu_unique unique (rotasyon_id, personel_id)
);

comment on table public.rotasyon_telafi_kuyrugu is
  'Rotasyon sırasında izinli olduğu için atlanan kişilerin "bir sonraki müsait tarihte telafi nöbeti" bekleyen kuyruğu (FIFO, created_at ile)';

create index if not exists rotasyon_telafi_kuyrugu_rotasyon_id_idx on public.rotasyon_telafi_kuyrugu (rotasyon_id, created_at);

-- ----------------------------------------------------------------------------
-- 3) Yardımcı fonksiyon: hedef_takim_id, giriş yapmış kullanıcının yönettiği
--    bir takım mı? (personel_takim_yonetiliyor_mu bir KİŞİnin takımına
--    bakıyordu; bu, doğrudan bir TAKIM id'sine bakıyor — rotasyonlar RLS'i
--    ve ileride admin ekranı için gerekiyor.)
-- ----------------------------------------------------------------------------

-- DÜZELTME: parametre uuid değil bigint (takimlar.id bigint). "create or
-- replace" parametre tipini değiştiremez (aynı isimle farklı imzalı ikinci
-- bir fonksiyon oluştururdu) — önce eski (uuid) halini düşürüyoruz.
drop function if exists public.takim_yonetiliyor_mu(uuid);

create or replace function public.takim_yonetiliyor_mu(hedef_takim_id bigint)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select hedef_takim_id in (select public.kullanicinin_yonetilen_takimlari());
$$;

-- ----------------------------------------------------------------------------
-- 4) RLS — rotasyonlar
--    Müdür (is_global_admin) hepsini görür/yönetir. Takım Admini sadece
--    yönettiği takımın rotasyonlarını görür/yönetir. Sıradan personel bu
--    tabloya hiç erişemez (saf admin-yönetim verisi).
-- ----------------------------------------------------------------------------

alter table public.rotasyonlar enable row level security;

drop policy if exists "rotasyonlar_select_scoped_admin" on public.rotasyonlar;
create policy "rotasyonlar_select_scoped_admin"
  on public.rotasyonlar for select
  to authenticated
  using (
    public.is_global_admin()
    or public.takim_yonetiliyor_mu(takim_id)
  );

drop policy if exists "rotasyonlar_insert_scoped_admin" on public.rotasyonlar;
create policy "rotasyonlar_insert_scoped_admin"
  on public.rotasyonlar for insert
  to authenticated
  with check (
    public.is_global_admin()
    or public.takim_yonetiliyor_mu(takim_id)
  );

drop policy if exists "rotasyonlar_update_scoped_admin" on public.rotasyonlar;
create policy "rotasyonlar_update_scoped_admin"
  on public.rotasyonlar for update
  to authenticated
  using (
    public.is_global_admin()
    or public.takim_yonetiliyor_mu(takim_id)
  )
  with check (
    public.is_global_admin()
    or public.takim_yonetiliyor_mu(takim_id)
  );

drop policy if exists "rotasyonlar_delete_scoped_admin" on public.rotasyonlar;
create policy "rotasyonlar_delete_scoped_admin"
  on public.rotasyonlar for delete
  to authenticated
  using (
    public.is_global_admin()
    or public.takim_yonetiliyor_mu(takim_id)
  );

-- ----------------------------------------------------------------------------
-- 5) RLS — rotasyon_telafi_kuyrugu
--    rotasyon_ay_olustur "security invoker" olduğu için (bkz. aşağı), bir
--    admin bu fonksiyonu elle tetiklediğinde fonksiyonun İÇİNDEKİ insert/
--    delete işlemleri de çağıranın RLS'ine tabi olur — bu yüzden burada da
--    aynı takım-kapsamlı kuralı tekrarlamak ZORUNLU (yoksa manuel tetikleme
--    kırılır, sadece pg_cron/superuser çalışırdı).
-- ----------------------------------------------------------------------------

alter table public.rotasyon_telafi_kuyrugu enable row level security;

drop policy if exists "rotasyon_telafi_kuyrugu_select" on public.rotasyon_telafi_kuyrugu;
create policy "rotasyon_telafi_kuyrugu_select"
  on public.rotasyon_telafi_kuyrugu for select
  to authenticated
  using (
    exists (
      select 1 from public.rotasyonlar r
      where r.id = rotasyon_id
        and (public.is_global_admin() or public.takim_yonetiliyor_mu(r.takim_id))
    )
  );

drop policy if exists "rotasyon_telafi_kuyrugu_insert" on public.rotasyon_telafi_kuyrugu;
create policy "rotasyon_telafi_kuyrugu_insert"
  on public.rotasyon_telafi_kuyrugu for insert
  to authenticated
  with check (
    exists (
      select 1 from public.rotasyonlar r
      where r.id = rotasyon_id
        and (public.is_global_admin() or public.takim_yonetiliyor_mu(r.takim_id))
    )
  );

drop policy if exists "rotasyon_telafi_kuyrugu_delete" on public.rotasyon_telafi_kuyrugu;
create policy "rotasyon_telafi_kuyrugu_delete"
  on public.rotasyon_telafi_kuyrugu for delete
  to authenticated
  using (
    exists (
      select 1 from public.rotasyonlar r
      where r.id = rotasyon_id
        and (public.is_global_admin() or public.takim_yonetiliyor_mu(r.takim_id))
    )
  );

-- ----------------------------------------------------------------------------
-- 6) rotasyon_ay_olustur(p_rotasyon_id, p_yil, p_ay)
--
-- BİLİNÇLİ OLARAK "security invoker" (varsayılan, definer DEĞİL): yetki
-- kontrolünü elle tekrar yazmak yerine TAMAMEN RLS'e yaslanıyoruz (hem
-- rotasyonlar hem rotasyon_telafi_kuyrugu'nda). Yetkisiz bir Takım Admini
-- başka takımın rotasyon id'siyle çağırırsa, daha ilk SELECT'te satırı hiç
-- göremez -> "Rotasyon bulunamadı". pg_cron (postgres superuser olarak)
-- RLS'i zaten bypass ettiği için tüm takımlar için sorunsuz çalışır.
--
-- GEÇMİŞE DÖNÜK DOLDURMA YOK: üretilen tarih listesi her zaman
-- CURRENT_DATE'ten büyük/eşit olanlarla sınırlı. Yani hem "ay ortasında
-- yeni rotasyon" hem de aylar sonra çalışan bir pg_cron kurtarması,
-- bugünden ÖNCEKİ günleri asla doldurmaz — o tarihler boş kalır.
--
-- GENİŞLETME NOKTASI (şimdilik boş, ileride "istisna kuralları" için):
-- tarih listesi hesaplandıktan sonra, atama döngüsünden ÖNCE, her tarih
-- için "bu tarihi ertele/değiştir" kontrolü buraya eklenebilir (ör. ayrı
-- bir rotasyon_istisnalari tablosu). Şu an böyle bir kural yok.
-- ----------------------------------------------------------------------------

create or replace function public.rotasyon_ay_olustur(
  p_rotasyon_id bigint,
  p_yil integer,
  p_ay integer
)
returns jsonb
language plpgsql
as $$
declare
  v_rotasyon record;
  v_ay_ilk_gun date;
  v_ay_son_gun date;
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
  v_telafi_id bigint;
  v_telafi_kisi uuid;
begin
  select * into v_rotasyon from public.rotasyonlar where id = p_rotasyon_id;
  if not found then
    raise exception 'Rotasyon bulunamadı ya da bu rotasyonu görme yetkiniz yok: %', p_rotasyon_id;
  end if;

  if not v_rotasyon.aktif then
    raise exception 'Rotasyon pasif durumda, ay oluşturulamaz.';
  end if;

  v_ay_ilk_gun := make_date(p_yil, p_ay, 1);

  -- İdempotentlik: bu ay (veya daha eskisi) zaten oluşturulmuşsa dokunma.
  if v_rotasyon.son_olusturulan_ay is not null and v_ay_ilk_gun <= v_rotasyon.son_olusturulan_ay then
    return jsonb_build_object('durum', 'zaten_olusturulmus', 'ay', to_char(v_ay_ilk_gun, 'YYYY-MM'));
  end if;

  v_ay_son_gun := (v_ay_ilk_gun + interval '1 month' - interval '1 day')::date;

  -- Takım üyeleri (SADECE rol='personel' — Takım Admini/Müdür nöbete
  -- girmiyor, bu kural nobetler_personel_rol_kontrol trigger'ıyla da
  -- garanti altında, burada baştan filtreliyoruz ki gereksiz denemeye
  -- girmesin), takıma eklenme sırasına göre.
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
      format('%s rotasyonu için %s ayı oluşturulamadı: takımda personel yok.', v_rotasyon.isim, to_char(v_ay_ilk_gun, 'YYYY-MM')),
      'rotasyon_uye_yok',
      jsonb_build_object('rotasyon_adi', v_rotasyon.isim, 'ay', to_char(v_ay_ilk_gun, 'YYYY-MM'))
    );
    update public.rotasyonlar set son_olusturulan_ay = v_ay_ilk_gun where id = p_rotasyon_id;
    return jsonb_build_object('durum', 'uye_yok', 'ay', to_char(v_ay_ilk_gun, 'YYYY-MM'));
  end if;

  v_index := v_rotasyon.mevcut_sira_index % v_uye_sayisi;

  for v_tarih in
    select d::date
    from generate_series(v_ay_ilk_gun, v_ay_son_gun, interval '1 day') as d
    where extract(isodow from d) = v_rotasyon.haftanin_gunu
      and d::date >= current_date  -- geçmişe dönük doldurma yok
  loop
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
  set son_olusturulan_ay = v_ay_ilk_gun,
      mevcut_sira_index = v_index
  where id = p_rotasyon_id;

  insert into public.islem_gecmisi (kullanici_id, islem_aciklamasi, islem_tipi, parametreler)
  values (
    auth.uid(),
    format(
      '%s rotasyonu için %s ayı oluşturuldu: %s nöbet atandı (%s telafi kuyruğundan)%s.',
      v_rotasyon.isim,
      to_char(v_ay_ilk_gun, 'YYYY-MM'),
      v_atanan_sayisi,
      v_telafi_atanan_sayisi,
      case when v_atlanan_sayisi > 0
        then format(', %s tarihte kimse uygun değildi (herkes izinli)', v_atlanan_sayisi)
        else ''
      end
    ),
    'rotasyon_ay_olusturuldu',
    jsonb_build_object(
      'rotasyon_adi', v_rotasyon.isim,
      'ay', to_char(v_ay_ilk_gun, 'YYYY-MM'),
      'atanan', v_atanan_sayisi,
      'telafi', v_telafi_atanan_sayisi,
      'atlanan', v_atlanan_sayisi
    )
  );

  return jsonb_build_object(
    'durum', 'olusturuldu',
    'ay', to_char(v_ay_ilk_gun, 'YYYY-MM'),
    'atanan', v_atanan_sayisi,
    'telafi_ile_atanan', v_telafi_atanan_sayisi,
    'atlanan', v_atlanan_sayisi,
    'atlanan_tarihler', to_jsonb(v_atlanan_tarihler)
  );
end;
$$;

comment on function public.rotasyon_ay_olustur(bigint, integer, integer) is
  'Bir rotasyonun belirtilen ayını (bugünden itibaren, geçmişe dönük doldurmadan) oluşturur: her tarihte önce telafi kuyruğunun en eskisi denenir, o uygun değilse/yoksa normal round-robin (izinlileri telafi kuyruğuna ekleyerek atlar) devam eder. İdempotent — aynı ay için tekrar çağrılırsa no-op döner.';
