-- ============================================================================
-- ADIM 2/2 — SADECE 1-enum-mudur-ekle.sql çalışıp "Success" gösterdikten
-- SONRA çalıştır (o dosya ayrı bir transaction'da commit olmalı, aksi halde
-- burada "unsafe use of new value of enum type" hatası alırsın).
--
-- Rol modeli artık:
--   'personel' -> sıradan personel (değişmedi)
--   'admin'    -> Takım Admini (ESKİDEN rol='admin' + admin_kapsam='takim')
--   'mudur'    -> Müdür / global yönetici (ESKİDEN rol='admin' + admin_kapsam='global')
--
-- admin_kapsam sütunu YOK — hiç oluşturulmamıştı, oluşturulacaksa bile bu
-- script'te DROP ediliyor (aşağıda, "if exists" ile güvenli).
--
-- Bu dosya idempotent'tir, tekrar çalıştırılabilir. Hiçbir tablo/policy/
-- fonksiyon daha önce gerçekten oluşturulmamıştı (bir önceki turda
-- doğrulandı) — yani bu, "delta" değil, EKSİKSİZ kurulum script'idir.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) takim_yoneticileri (many-to-many: bir şef birden çok takımı, bir takımın
--    birden çok şefi olabilir)
--
-- DÜZELTME: takim_id başta yanlışlıkla uuid yazılmıştı — public.takimlar.id
-- gerçekte bigint (normalizasyon.sql dosyası artık güncel değil, canlıda
-- takimlar/personel_takim/pozisyonlar/personel_pozisyon hepsi bigint).
-- "create table if not exists" var olan yanlış tipli bir tabloyu DÜZELTMEZ,
-- bu yüzden önce (varsa, yanlış tipli haliyle) düşürüp doğru tiple yeniden
-- kuruyoruz — bu tabloda henüz gerçek veri olmadığı için güvenli.
-- ----------------------------------------------------------------------------

drop table if exists public.takim_yoneticileri cascade;

create table public.takim_yoneticileri (
  id bigint generated always as identity primary key,
  takim_id bigint not null references public.takimlar (id) on delete cascade,
  personel_id uuid not null references public.personel (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint takim_yoneticileri_unique unique (takim_id, personel_id)
);

comment on table public.takim_yoneticileri is 'Hangi Takım Admini (rol=admin) personelinin hangi takım(lar)ı yönettiği';

create index if not exists takim_yoneticileri_takim_id_idx on public.takim_yoneticileri (takim_id);
create index if not exists takim_yoneticileri_personel_id_idx on public.takim_yoneticileri (personel_id);

-- ----------------------------------------------------------------------------
-- 2) Yardımcı fonksiyonlar
-- ----------------------------------------------------------------------------

-- is_admin(): "Takım Admini VEYA Müdür" — nöbet_turleri, nobet_gruplari,
-- tatil_gunleri, personel update/delete, degisim_talepleri, nobet_ortaklik_
-- talepleri, islem_gecmisi gibi mevcut admin-only politikalarda kullanılıyor.
-- Müdürün bu yerlerde eskisi gibi TAM yetkisi olması için 'mudur' burada da
-- true dönmeli — yoksa Müdür, Takım Admini'nin yapabildiği bazı genel
-- işlemleri (ör. yeni nöbet türü eklemeyi) kaybederdi.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.personel
    where id = auth.uid() and rol in ('admin', 'mudur')
  );
$$;

-- is_global_admin(): SADECE Müdür.
create or replace function public.is_global_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.personel
    where id = auth.uid() and rol = 'mudur'
  );
$$;

-- is_takim_admin(): SADECE Takım Admini (rol='admin').
create or replace function public.is_takim_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.personel
    where id = auth.uid() and rol = 'admin'
  );
$$;

-- Giriş yapmış kullanıcı Takım Admini ise yönettiği takım id'leri;
-- değilse (personel, ya da Müdür) boş set döner.
-- DÜZELTME: setof uuid değil setof bigint — takim_yoneticileri.takim_id
-- (ve zaten personel_takim.takim_id) bigint. "create or replace" dönüş
-- tipini DEĞİŞTİREMEZ (Postgres hata verir) — önce eskisini düşürüyoruz.
drop function if exists public.kullanicinin_yonetilen_takimlari();

create function public.kullanicinin_yonetilen_takimlari()
returns setof bigint
language sql
security definer
set search_path = public
stable
as $$
  select ty.takim_id
  from public.takim_yoneticileri ty
  where ty.personel_id = auth.uid()
    and public.is_takim_admin();
$$;

-- hedef_personel_id, giriş yapmış kullanıcının yönettiği bir takımın üyesi mi?
create or replace function public.personel_takim_yonetiliyor_mu(hedef_personel_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.personel_takim pt
    where pt.personel_id = hedef_personel_id
      and pt.takim_id in (select public.kullanicinin_yonetilen_takimlari())
  );
$$;

-- ----------------------------------------------------------------------------
-- 3) RLS — takim_yoneticileri (sadece Müdür atayabilir/kaldırabilir)
-- ----------------------------------------------------------------------------

alter table public.takim_yoneticileri enable row level security;

drop policy if exists "takim_yoneticileri_select_authenticated" on public.takim_yoneticileri;
create policy "takim_yoneticileri_select_authenticated"
  on public.takim_yoneticileri for select
  to authenticated
  using (true);

drop policy if exists "takim_yoneticileri_insert_global_admin" on public.takim_yoneticileri;
create policy "takim_yoneticileri_insert_global_admin"
  on public.takim_yoneticileri for insert
  to authenticated
  with check (public.is_global_admin());

drop policy if exists "takim_yoneticileri_update_global_admin" on public.takim_yoneticileri;
create policy "takim_yoneticileri_update_global_admin"
  on public.takim_yoneticileri for update
  to authenticated
  using (public.is_global_admin())
  with check (public.is_global_admin());

drop policy if exists "takim_yoneticileri_delete_global_admin" on public.takim_yoneticileri;
create policy "takim_yoneticileri_delete_global_admin"
  on public.takim_yoneticileri for delete
  to authenticated
  using (public.is_global_admin());

-- ----------------------------------------------------------------------------
-- 4) izin_talepleri — admin bypass'ı Müdür/Takım Admini'ne göre daralt
-- ----------------------------------------------------------------------------

drop policy if exists "izin_talepleri_select_own_or_admin" on public.izin_talepleri;
drop policy if exists "izin_talepleri_select_own_or_scoped_admin" on public.izin_talepleri;
create policy "izin_talepleri_select_own_or_scoped_admin"
  on public.izin_talepleri for select
  to authenticated
  using (
    personel_id = auth.uid()
    or public.is_global_admin()
    or public.personel_takim_yonetiliyor_mu(personel_id)
  );

drop policy if exists "izin_talepleri_update_own_pending_or_admin" on public.izin_talepleri;
drop policy if exists "izin_talepleri_update_own_pending_or_scoped_admin" on public.izin_talepleri;
create policy "izin_talepleri_update_own_pending_or_scoped_admin"
  on public.izin_talepleri for update
  to authenticated
  using (
    (personel_id = auth.uid() and durum = 'bekleyen')
    or public.is_global_admin()
    or public.personel_takim_yonetiliyor_mu(personel_id)
  )
  with check (
    (personel_id = auth.uid() and durum = 'bekleyen')
    or public.is_global_admin()
    or public.personel_takim_yonetiliyor_mu(personel_id)
  );

drop policy if exists "izin_talepleri_delete_own_pending_or_admin" on public.izin_talepleri;
drop policy if exists "izin_talepleri_delete_own_pending_or_scoped_admin" on public.izin_talepleri;
create policy "izin_talepleri_delete_own_pending_or_scoped_admin"
  on public.izin_talepleri for delete
  to authenticated
  using (
    (personel_id = auth.uid() and durum = 'bekleyen')
    or public.is_global_admin()
    or public.personel_takim_yonetiliyor_mu(personel_id)
  );

-- ----------------------------------------------------------------------------
-- 5) nobetler — güncelleme/silme admin bypass'ı da daraltılıyor: Takım
--    Admini SADECE yönettiği takım(lar)ın üyelerine ait nöbet kayıtlarını
--    güncelleyebilir/silebilir, Müdür değişmeden her şeyi yapabilir.
--    (nobetler'in SELECT'i, nobetler_update_own_onay ve nobetler_delete_
--    own_pending_onay ayrı politikalar — dokunulmadan duruyor.)
-- ----------------------------------------------------------------------------

drop policy if exists "nobetler_update_admin" on public.nobetler;
drop policy if exists "nobetler_update_scoped_admin" on public.nobetler;
create policy "nobetler_update_scoped_admin"
  on public.nobetler for update
  to authenticated
  using (
    public.is_global_admin()
    or public.personel_takim_yonetiliyor_mu(personel_id)
  )
  with check (
    public.is_global_admin()
    or public.personel_takim_yonetiliyor_mu(personel_id)
  );

drop policy if exists "nobetler_delete_admin" on public.nobetler;
drop policy if exists "nobetler_delete_scoped_admin" on public.nobetler;
create policy "nobetler_delete_scoped_admin"
  on public.nobetler for delete
  to authenticated
  using (
    public.is_global_admin()
    or public.personel_takim_yonetiliyor_mu(personel_id)
  );

-- ----------------------------------------------------------------------------
-- 6) personel_yonetilen — admin toplu-yönetim ekranlarının kullanacağı,
--    kapsam-kısıtlı view. personel/personel_detay'ın kendisi DEĞİŞMEDİ.
--
--    - Müdür        -> herkesi görür
--    - Takım Admini -> sadece yönettiği takım(lar)ın üyelerini görür
--    - personel     -> hiçbir satır dönmez (bu view admin ekranları için;
--      genel arama için personel_detay kullanılmalı)
-- ----------------------------------------------------------------------------

create or replace view public.personel_yonetilen as
select pd.*
from public.personel_detay pd
where
  public.is_global_admin()
  or public.personel_takim_yonetiliyor_mu(pd.id);

comment on view public.personel_yonetilen is
  'Admin toplu-yönetim ekranları (dashboard, Personel Yönetimi) için kapsam-kısıtlı personel listesi. Bireysel arama için bunun yerine personel_detay kullanılmalı.';

grant select on public.personel_yonetilen to authenticated;

-- ----------------------------------------------------------------------------
-- 7) Kendi hesabını Müdür yap
-- ----------------------------------------------------------------------------

update public.personel
set rol = 'mudur'
where email = 's.dilarakalkan@hotmail.com';

-- ----------------------------------------------------------------------------
-- 8) Ahmet Yılmaz, Ayşe Demir, Emirhan Yılmaz'ı (rol='admin' zaten,
--    dokunulmuyor) Takım Admini olarak birer takıma ata. Takım isimlerini
--    bilmediğimiz için takimlar'ı takim_adi'ye göre sıralayıp 1./2./3.
--    takımı kullanıyoruz. Elinde 3'ten az takım varsa Emirhan'ınki (sira=3)
--    eşleşmez ve sessizce 0 satır eklenir — o durumda ya yeni bir takım
--    oluşturman ya da onu mevcut bir takıma (Ahmet/Ayşe ile aynı) atamamı
--    istemen gerekir.
-- ----------------------------------------------------------------------------

with sirali_takimlar as (
  select id, takim_adi, row_number() over (order by takim_adi) as sira
  from public.takimlar
)
insert into public.takim_yoneticileri (takim_id, personel_id)
select t.id, p.id
from sirali_takimlar t
join public.personel p on p.ad_soyad = 'Ahmet Yılmaz'
where t.sira = 1
on conflict (takim_id, personel_id) do nothing;

with sirali_takimlar as (
  select id, takim_adi, row_number() over (order by takim_adi) as sira
  from public.takimlar
)
insert into public.takim_yoneticileri (takim_id, personel_id)
select t.id, p.id
from sirali_takimlar t
join public.personel p on p.ad_soyad = 'Ayşe Demir'
where t.sira = 2
on conflict (takim_id, personel_id) do nothing;

with sirali_takimlar as (
  select id, takim_adi, row_number() over (order by takim_adi) as sira
  from public.takimlar
)
insert into public.takim_yoneticileri (takim_id, personel_id)
select t.id, p.id
from sirali_takimlar t
join public.personel p on p.ad_soyad = 'Emirhan Yılmaz'
where t.sira = 3
on conflict (takim_id, personel_id) do nothing;

-- ----------------------------------------------------------------------------
-- 9) admin_kapsam sütununu kaldır (hiç kullanılmayacak — hiç oluşturulmamış
--    olsa bile "if exists" sayesinde bu satır güvenle no-op olur)
-- ----------------------------------------------------------------------------

alter table public.personel drop column if exists admin_kapsam;

-- ----------------------------------------------------------------------------
-- Doğrulama
-- ----------------------------------------------------------------------------

select
  p.ad_soyad,
  p.rol,
  string_agg(tk.takim_adi, ', ') as yonettigi_takimlar
from public.personel p
left join public.takim_yoneticileri ty on ty.personel_id = p.id
left join public.takimlar tk on tk.id = ty.takim_id
where p.rol in ('admin', 'mudur')
group by p.id, p.ad_soyad, p.rol
order by p.rol, p.ad_soyad;
