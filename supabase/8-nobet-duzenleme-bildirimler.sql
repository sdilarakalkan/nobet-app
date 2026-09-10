-- ============================================================================
-- Admin/Müdür'ün otomatik oluşturulan nöbetleri elle düzenlemesi — ADIM 1/2:
-- veritabanı (bildirimler tablosu + RLS + nobet_duzenle() fonksiyonu).
--
-- ADIM 2 (bu dosyanın onayından SONRA): UI — Otomatik sekmesindeki Sıra
-- Listesi'ne "Düzenle" butonu/modalı ve bildirim zili/ekranı.
--
-- Bu dosya idempotent'tir, tekrar çalıştırılabilir.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) bildirimler
-- ----------------------------------------------------------------------------

create table if not exists public.bildirimler (
  id bigint generated always as identity primary key,
  personel_id uuid not null references public.personel (id) on delete cascade,
  baslik text not null,
  mesaj text not null,
  okundu boolean not null default false,
  ilgili_nobet_id bigint references public.nobetler (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.bildirimler is 'Uygulama içi bildirimler (push değil) — ör. bir nöbet admin tarafından elle değiştirildiğinde ilgili kişi(ler)e düşer';
comment on column public.bildirimler.ilgili_nobet_id is 'Bildirime konu olan nobetler satırı; o nöbet silinirse bildirim kalır ama bağlantı null olur';

create index if not exists bildirimler_personel_id_idx on public.bildirimler (personel_id, created_at desc);
create index if not exists bildirimler_personel_okunmamis_idx on public.bildirimler (personel_id) where okundu = false;

-- ----------------------------------------------------------------------------
-- 2) RLS — herkes SADECE kendi bildirimlerini görür/okundu işaretler.
--    BİLİNÇLİ OLARAK insert policy'si YOK: bildirimler sadece aşağıdaki
--    nobet_duzenle() gibi SECURITY DEFINER fonksiyonlar üzerinden (RLS'i
--    bypass ederek) oluşturulur — hiçbir authenticated/anon kullanıcı
--    doğrudan (kendine veya başkasına) bildirim insert edemez.
-- ----------------------------------------------------------------------------

alter table public.bildirimler enable row level security;

drop policy if exists "bildirimler_select_own" on public.bildirimler;
create policy "bildirimler_select_own"
  on public.bildirimler for select
  to authenticated
  using (personel_id = auth.uid());

-- Sadece "okundu" işaretlemek için (bildirime tıklayınca); kendi satırı
-- dışında bir şeye dokunamaz.
drop policy if exists "bildirimler_update_own" on public.bildirimler;
create policy "bildirimler_update_own"
  on public.bildirimler for update
  to authenticated
  using (personel_id = auth.uid())
  with check (personel_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 3) nobet_duzenle(p_nobet_id, p_yeni_tarih, p_yeni_personel_id)
--
-- BİLİNÇLİ OLARAK "security definer": bildirimler'e insert yapabilmesi için
-- (o tabloda hiç insert policy'si yok) yükseltilmiş yetkiyle çalışması
-- gerekiyor. RLS bypass edildiği için yetki kontrolü BURADA elle yapılıyor:
-- Müdür (is_global_admin) her nöbeti düzenleyebilir; Takım Admini SADECE
-- hem eski hem (kişi değişiyorsa) yeni kişi kendi yönettiği takım(lar)ın
-- üyesiyse düzenleyebilir (personel_takim_yonetiliyor_mu — nobetler_update_
-- scoped_admin'in kullandığı AYNI kapsam kuralı).
--
-- Geçmiş tarihli nöbetler DEĞİŞTİRİLEMEZ (ne kaynak ne hedef tarih geçmişte
-- olabilir) — bu, UI'daki "sadece gelecek tarihli nöbetlerde Düzenle butonu
-- göster" kuralının backend'deki garantisi; UI bypass edilse bile korunur.
--
-- personel_id/tarih değişirse nobetler_personel_rol_kontrol trigger'ı
-- (hedef kişi rol='personel' mi) ve nobetler_personel_tur_tarih_key unique
-- index'i (aynı kişi+tür+tarih ikinci kez atanamaz) zaten otomatik devrede.
-- ----------------------------------------------------------------------------

create or replace function public.nobet_duzenle(
  p_nobet_id bigint,
  p_yeni_tarih date,
  p_yeni_personel_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nobet record;
  v_eski_ad text;
  v_yeni_ad text;
  v_kisi_degisti boolean;
  v_tarih_degisti boolean;
begin
  select * into v_nobet from public.nobetler where id = p_nobet_id;
  if not found then
    raise exception 'Nöbet bulunamadı: %', p_nobet_id;
  end if;

  if v_nobet.tarih < current_date then
    raise exception 'Geçmiş tarihli nöbetler düzenlenemez.';
  end if;

  if p_yeni_tarih < current_date then
    raise exception 'Nöbet geçmiş bir tarihe taşınamaz.';
  end if;

  if not (
    public.is_global_admin()
    or (
      public.personel_takim_yonetiliyor_mu(v_nobet.personel_id)
      and public.personel_takim_yonetiliyor_mu(p_yeni_personel_id)
    )
  ) then
    raise exception 'Bu nöbeti düzenleme yetkiniz yok.';
  end if;

  select ad_soyad into v_eski_ad from public.personel where id = v_nobet.personel_id;
  select ad_soyad into v_yeni_ad from public.personel where id = p_yeni_personel_id;

  v_kisi_degisti := p_yeni_personel_id <> v_nobet.personel_id;
  v_tarih_degisti := p_yeni_tarih <> v_nobet.tarih;

  if not v_kisi_degisti and not v_tarih_degisti then
    return jsonb_build_object('durum', 'degisiklik_yok');
  end if;

  begin
    update public.nobetler
    set personel_id = p_yeni_personel_id,
        tarih = p_yeni_tarih,
        atama_tipi = 'manuel',
        atayan_admin_id = auth.uid()
    where id = p_nobet_id;
  exception when unique_violation then
    raise exception '% kişisinin % tarihinde zaten bu türde bir nöbeti var.',
      coalesce(v_yeni_ad, 'Seçilen kişi'), to_char(p_yeni_tarih, 'DD.MM.YYYY');
  end;

  if v_kisi_degisti then
    insert into public.bildirimler (personel_id, baslik, mesaj, ilgili_nobet_id)
    values (
      v_nobet.personel_id,
      'Nöbet Devredildi',
      format('%s tarihli nöbetiniz %s''e devredildi.', to_char(v_nobet.tarih, 'DD.MM.YYYY'), coalesce(v_yeni_ad, 'başka bir personel')),
      p_nobet_id
    );
    insert into public.bildirimler (personel_id, baslik, mesaj, ilgili_nobet_id)
    values (
      p_yeni_personel_id,
      'Yeni Nöbet Atandı',
      format('%s tarihinde size bir nöbet atandı.', to_char(p_yeni_tarih, 'DD.MM.YYYY')),
      p_nobet_id
    );
  elsif v_tarih_degisti then
    insert into public.bildirimler (personel_id, baslik, mesaj, ilgili_nobet_id)
    values (
      p_yeni_personel_id,
      'Nöbet Tarihi Değişti',
      format('Nöbetinizin tarihi %s''den %s''e değiştirildi.', to_char(v_nobet.tarih, 'DD.MM.YYYY'), to_char(p_yeni_tarih, 'DD.MM.YYYY')),
      p_nobet_id
    );
  end if;

  return jsonb_build_object(
    'durum', 'guncellendi',
    'kisi_degisti', v_kisi_degisti,
    'tarih_degisti', v_tarih_degisti
  );
end;
$$;

comment on function public.nobet_duzenle(bigint, date, uuid) is
  'Admin/Müdür bir nöbetin tarihini ve/veya kişisini elle değiştirir (atama_tipi=''manuel'' olur, atayan_admin_id=auth.uid()); etkilenen kişi(ler)e bildirimler satırı düşer. Geçmiş tarihli nöbetler ve geçmişe taşıma reddedilir.';

-- ----------------------------------------------------------------------------
-- Doğrulama
-- ----------------------------------------------------------------------------

select polname as policy_adi, pg_get_expr(polqual, polrelid) as using_ifadesi
from pg_policy
where polrelid = 'public.bildirimler'::regclass;
