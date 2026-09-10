// Test personeli oluşturma script'i (5 yeni kişi) — SADECE senin kendi
// bilgisayarında, kendi terminalinde çalıştırman için. service_role anahtarı
// RLS'i tamamen bypass eder, bu yüzden asla Claude'a / repoya / commit'e
// girmemeli.
//
// Kurulum (daha önce supabase/.env.seed.local oluşturduysan bu adım gerekmez):
//   1) supabase/.env.seed.local dosyası oluştur (bu isim .gitignore'da zaten
//      korunuyor — .env*.local her zaman yok sayılıyor):
//        EXPO_PUBLIC_SUPABASE_URL=https://frllwnhjkfbbkwsudtoc.supabase.co
//        SUPABASE_SERVICE_ROLE_KEY=<Supabase Dashboard > Settings > API > service_role>
//   2) Çalıştır:
//        node --env-file=supabase/.env.seed.local supabase/seed-users-5.mjs
//
// Bu script:
//   - 5 yeni sahte kullanıcı için gerçek bir auth.users kaydı açar (email
//     onayı zaten "confirmed" olarak işaretlenir, şifre gerekmez çünkü
//     sadece test verisi — normalde login denemeyeceksin)
//   - Her biri için personel tablosuna rol='personel' ile satır ekler
//     (admin/mudur OLMAZLAR)
//   - Her birine, public.pozisyonlar tablosunda ZATEN VAR OLAN pozisyonlar
//     arasından rastgele birini atar (yeni pozisyon OLUŞTURMAZ — pozisyonlar
//     tablosu boşsa script bunu söyleyip durur)
//   - Takım ataması YAPMAZ — bu, ayrı bir adım (seed-team-assign-5.mjs)

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
  { email: 'emine.kara@test.local', ad_soyad: 'Emine Kara' },
  { email: 'burak.aydin@test.local', ad_soyad: 'Burak Aydın' },
  { email: 'selin.celik@test.local', ad_soyad: 'Selin Çelik' },
  { email: 'kerem.dogan@test.local', ad_soyad: 'Kerem Doğan' },
  { email: 'deniz.aksoy@test.local', ad_soyad: 'Deniz Aksoy' },
];

const geciciSifre = () => `Test-${Math.random().toString(36).slice(2, 10)}!1`;
const rastgeleSec = (dizi) => dizi[Math.floor(Math.random() * dizi.length)];

async function main() {
  const { data: pozisyonlar, error: pozHata } = await admin.from('pozisyonlar').select('id, pozisyon_adi');
  if (pozHata) {
    console.error('HATA (pozisyonlar):', pozHata.message);
    process.exit(1);
  }
  if (!pozisyonlar || pozisyonlar.length === 0) {
    console.error('public.pozisyonlar tablosu boş — önce en az bir pozisyon eklemen gerekiyor, bu script yeni pozisyon oluşturmuyor.');
    process.exit(1);
  }
  console.log(`Mevcut pozisyonlar (${pozisyonlar.length}):`, pozisyonlar.map((p) => p.pozisyon_adi).join(', '));

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
      rol: 'personel',
    });

    if (personelError) {
      console.error(`HATA (personel) -> ${kisi.ad_soyad}:`, personelError.message);
      continue;
    }

    const secilenPozisyon = rastgeleSec(pozisyonlar);
    const { error: pozAtamaHata } = await admin
      .from('personel_pozisyon')
      .insert({ personel_id: userId, pozisyon_id: secilenPozisyon.id });
    if (pozAtamaHata) {
      console.error(`HATA (personel_pozisyon) -> ${kisi.ad_soyad}:`, pozAtamaHata.message);
    }

    sonuc.push({ id: userId, ad_soyad: kisi.ad_soyad, email: kisi.email, pozisyon: secilenPozisyon.pozisyon_adi });
    console.log(`OLUŞTURULDU -> ${kisi.ad_soyad} (personel, ${secilenPozisyon.pozisyon_adi}) id=${userId}`);
  }

  console.log('\nÖzet:', JSON.stringify(sonuc, null, 2));
  console.log('\nŞimdi supabase/seed-team-assign-5.mjs\'i çalıştırarak bu 5 kişiyi');
  console.log('mevcut takımlara rastgele dağıtabilirsin.');
}

main();
