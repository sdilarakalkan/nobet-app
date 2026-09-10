// Test personeli oluşturma script'i — SADECE senin kendi bilgisayarında,
// kendi terminalinde çalıştırman için. service_role anahtarı RLS'i tamamen
// bypass eder, bu yüzden asla Claude'a / repoya / commit'e girmemeli.
//
// Kurulum:
//   1) supabase/.env.seed.local dosyası oluştur (bu isim .gitignore'da zaten
//      korunuyor — .env*.local her zaman yok sayılıyor):
//        EXPO_PUBLIC_SUPABASE_URL=https://frllwnhjkfbbkwsudtoc.supabase.co
//        SUPABASE_SERVICE_ROLE_KEY=<Supabase Dashboard > Settings > API > service_role>
//   2) Çalıştır:
//        node --env-file=supabase/.env.seed.local supabase/seed-users.mjs
//
// Bu script:
//   - 3 yeni sahte kullanıcı için gerçek bir auth.users kaydı açar
//     (email onayı zaten "confirmed" olarak işaretlenir, şifre gerekmez
//     çünkü sadece test verisi — normalde login denemeyeceksin)
//   - Her biri için personel tablosuna ad_soyad + rol ile satır ekler
//   - Sonunda oluşturulan id'leri ekrana yazdırır

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

const YENI_PERSONEL = [
  { email: 'elif.sahin@test.local', ad_soyad: 'Elif Şahin', rol: 'personel', pozisyon: 'Tasarım' },
  { email: 'can.ozturk@test.local', ad_soyad: 'Can Öztürk', rol: 'personel', pozisyon: 'Destek' },
  { email: 'zeynep.arslan@test.local', ad_soyad: 'Zeynep Arslan', rol: 'admin', pozisyon: 'Analiz' },
];

const geciciSifre = () => `Test-${Math.random().toString(36).slice(2, 10)}!1`;

async function main() {
  const sonuc = [];

  for (const kisi of YENI_PERSONEL) {
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: kisi.email,
      password: geciciSifre(),
      email_confirm: true,
    });

    if (authError) {
      console.error(`HATA (auth.users) -> ${kisi.ad_soyad}:`, authError.message);
      continue;
    }

    const userId = authData.user.id;

    const { error: personelError } = await admin.from('personel').insert({
      id: userId,
      email: kisi.email,
      ad_soyad: kisi.ad_soyad,
      rol: kisi.rol,
    });

    if (personelError) {
      console.error(`HATA (personel) -> ${kisi.ad_soyad}:`, personelError.message);
      continue;
    }

    let pozisyonId = null;
    const { data: pozData } = await admin
      .from('pozisyonlar')
      .select('id')
      .eq('pozisyon_adi', kisi.pozisyon)
      .maybeSingle();

    if (pozData) {
      pozisyonId = pozData.id;
    } else {
      const { data: yeniPoz, error: pozHata } = await admin
        .from('pozisyonlar')
        .insert({ pozisyon_adi: kisi.pozisyon })
        .select('id')
        .single();
      if (pozHata) {
        console.error(`HATA (pozisyonlar) -> ${kisi.pozisyon}:`, pozHata.message);
      } else {
        pozisyonId = yeniPoz.id;
      }
    }

    if (pozisyonId) {
      await admin.from('personel_pozisyon').insert({ personel_id: userId, pozisyon_id: pozisyonId });
    }

    sonuc.push({ id: userId, ad_soyad: kisi.ad_soyad, rol: kisi.rol, pozisyon: kisi.pozisyon });
    console.log(`OLUŞTURULDU -> ${kisi.ad_soyad} (${kisi.rol}, ${kisi.pozisyon}) id=${userId}`);
  }

  console.log('\nÖzet:', JSON.stringify(sonuc, null, 2));
  console.log('\nŞimdi supabase/seed-veri.sql dosyasını SQL Editor\'de çalıştırarak');
  console.log('nöbet türlerini, takımları ve tüm personelin takım dağılımını oluşturabilirsin.');
}

main();
