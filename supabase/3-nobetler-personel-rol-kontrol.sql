-- ============================================================================
-- nobetler.personel_id sadece rol='personel' olan birine atanabilsin
--
-- UI zaten sadece rol='personel' olanları listeliyor (Personel Ara,
-- Takımlardan Seç, Partner Davet Et — üçü de aynı personelListesi'nden
-- besleniyor ve artık .eq('rol', 'personel') ile filtreleniyor). Bu trigger,
-- bir hata veya API'nin doğrudan çağrılması (UI'yi bypass etme) durumunda
-- son bir güvenlik katmanı: Takım Admini/Müdür rolündeki birine nöbet
-- atanmaya çalışılırsa INSERT/UPDATE'i tamamen reddeder.
--
-- Neden CHECK CONSTRAINT değil: PostgreSQL'de CHECK constraint'ler başka
-- bir tabloya bakamaz (subquery/başka tablo referansı yasak) — bu yüzden
-- BEFORE INSERT/UPDATE trigger kullanmak zorunludur. nobetler_onay_hesapla
-- ile aynı dosyada (schema.sql) zaten bu desen kullanılıyor.
--
-- Bu dosya idempotent'tir, tekrar çalıştırılabilir.
-- ============================================================================

create or replace function public.nobetler_personel_rol_kontrol()
returns trigger
language plpgsql
as $$
declare
  hedef_rol personel_rolu;
begin
  select rol into hedef_rol from public.personel where id = new.personel_id;

  if hedef_rol is null then
    raise exception 'nobetler.personel_id (%) public.personel içinde bulunamadı', new.personel_id;
  end if;

  if hedef_rol <> 'personel' then
    raise exception
      'Bir nöbet sadece rol=personel olan birine atanabilir (hedef kişinin rolü: %)', hedef_rol;
  end if;

  return new;
end;
$$;

comment on function public.nobetler_personel_rol_kontrol() is
  'nobetler.personel_id sadece rol=personel olan personele atanabilsin diye insert/update öncesi kontrol eder (Takım Admini/Müdür nöbet alamaz).';

drop trigger if exists nobetler_personel_rol_kontrol_trigger on public.nobetler;
create trigger nobetler_personel_rol_kontrol_trigger
  before insert or update of personel_id on public.nobetler
  for each row
  execute function public.nobetler_personel_rol_kontrol();
