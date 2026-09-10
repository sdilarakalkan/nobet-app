// ADIM 2/2 — seed-users-5.mjs'i ÇALIŞTIRDIKTAN SONRA çalıştır.
//
// seed-users-5.mjs'te oluşturulan 5 kişiyi (email'lerinden bulur), mevcut
// public.takimlar'daki takımlara RASTGELE dağıtır — kaç takım olduğunu
// sabitlemez, tabloda ne varsa onu kullanır. Her kişi en az bir takıma
// atanır (dağılım dengeli olması garanti değil, istenen de bu).
//
// Çalıştır:
//   node --env-file=supabase/.env.seed.local supabase/seed-team-assign-5.mjs

import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error('EXPO_PUBLIC_SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli.');
  console.error('supabase/.env.seed.local dosyasını oluşturup --env-file ile çalıştır.');
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const YENI_PERSONEL_EMAIL = [
  'emine.kara@test.local',
  'burak.aydin@test.local',
  'selin.celik@test.local',
  'kerem.dogan@test.local',
  'deniz.aksoy@test.local',
];

const rastgeleSec = (dizi) => dizi[Math.floor(Math.random() * dizi.length)];

async function main() {
  const { data: takimlar, error: takimHata } = await admin.from('takimlar').select('id, takim_adi');
  if (takimHata) {
    console.error('HATA (takimlar):', takimHata.message);
    process.exit(1);
  }
  if (!takimlar || takimlar.length === 0) {
    console.error('public.takimlar tablosu boş — önce en az bir takım oluşturman gerekiyor.');
    process.exit(1);
  }
  console.log(`Mevcut takımlar (${takimlar.length}):`, takimlar.map((t) => t.takim_adi).join(', '));

  const { data: personeller, error: personelHata } = await admin
    .from('personel')
    .select('id, ad_soyad, email')
    .in('email', YENI_PERSONEL_EMAIL);
  if (personelHata) {
    console.error('HATA (personel):', personelHata.message);
    process.exit(1);
  }
  if (!personeller || personeller.length === 0) {
    console.error('Bu email listesindeki personel bulunamadı — önce seed-users-5.mjs\'i çalıştırdın mı?');
    process.exit(1);
  }

  for (const kisi of personeller) {
    const secilenTakim = rastgeleSec(takimlar);
    const { error } = await admin
      .from('personel_takim')
      .insert({ personel_id: kisi.id, takim_id: secilenTakim.id });

    if (error) {
      if (error.code === '23505') {
        console.log(`ATLANDI (zaten atanmış) -> ${kisi.ad_soyad} : ${secilenTakim.takim_adi}`);
      } else {
        console.error(`HATA (personel_takim) -> ${kisi.ad_soyad}:`, error.message);
      }
      continue;
    }
    console.log(`ATANDI -> ${kisi.ad_soyad} : ${secilenTakim.takim_adi}`);
  }

  console.log('\nTamamlandı. Doğrulamak için Supabase SQL Editor\'de:');
  console.log(`
select p.ad_soyad, string_agg(t.takim_adi, ', ') as takimlar
from public.personel p
join public.personel_takim pt on pt.personel_id = p.id
join public.takimlar t on t.id = pt.takim_id
where p.email in (${YENI_PERSONEL_EMAIL.map((e) => `'${e}'`).join(', ')})
group by p.id, p.ad_soyad
order by p.ad_soyad;
`);
}

main();
