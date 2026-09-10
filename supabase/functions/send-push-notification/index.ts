// send-push-notification
//
// bildirimler tablosuna yeni bir satır eklendiğinde, supabase/14-push-
// bildirim-webhook.sql'deki trigger (pg_net.http_post ile) bu fonksiyonu
// tetikler. Fonksiyon:
//   1. Gövdede gelen bildirim_id'ye ait satırı (baslik, mesaj, personel_id)
//      okur.
//   2. O personelin kayıtlı Expo push token'ını (personel.expo_push_token,
//      bkz. lib/pushToken.ts -> registerForPushNotificationsAsync) VE
//      bildirim_aktif tercihini (Profil ekranındaki "Bildirimler" toggle'ı,
//      bkz. supabase/15-bildirim-aktif.sql) çeker.
//   3. bildirim_aktif=false ise Expo'ya HİÇ istek atmadan sessizce çıkar —
//      uygulama içi bildirim (bildirimler satırı, zil/panel) bundan
//      etkilenmez, sadece cihaza push gitmez.
//   4. Aksi halde Expo'nun push notification API'sine
//      (https://exp.host/--/api/v2/push/send) bu token'a bildirim gönderir.
//
// GÜVENLİK: Bu fonksiyon --no-verify-jwt ile deploy edilir (trigger'dan gelen
// istekte normal bir Supabase JWT'si YOK, sadece paylaşılan bir sır var).
// İsteğin gerçekten bizim veritabanımızdaki trigger'dan geldiğini doğrulamak
// için X-Webhook-Secret header'ı PUSH_WEBHOOK_SECRET ortam değişkeniyle
// karşılaştırılıyor — eşleşmezse istek reddedilir.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const PUSH_WEBHOOK_SECRET = Deno.env.get('PUSH_WEBHOOK_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

Deno.serve(async (req: Request) => {
  // Sadece paylaşılan sırrı bilen (yani bizim trigger'ımız) çağırabilir.
  if (!PUSH_WEBHOOK_SECRET || req.headers.get('x-webhook-secret') !== PUSH_WEBHOOK_SECRET) {
    return new Response('Yetkisiz istek.', { status: 401 });
  }

  let govde: { bildirim_id?: number };
  try {
    govde = await req.json();
  } catch {
    return new Response('Geçersiz istek gövdesi.', { status: 400 });
  }

  const bildirimId = govde.bildirim_id;
  if (!bildirimId) {
    return new Response('bildirim_id eksik.', { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  const { data: bildirim, error: bildirimHata } = await supabase
    .from('bildirimler')
    .select('id, baslik, mesaj, personel_id')
    .eq('id', bildirimId)
    .single();

  if (bildirimHata || !bildirim) {
    console.log('HATA (bildirim bulunamadı):', bildirimHata?.message);
    return new Response('Bildirim bulunamadı.', { status: 404 });
  }

  const { data: kisi, error: kisiHata } = await supabase
    .from('personel')
    .select('expo_push_token, bildirim_aktif')
    .eq('id', bildirim.personel_id)
    .single();

  if (kisiHata) {
    console.log('HATA (personel/push token):', kisiHata.message);
  }

  if (kisi && kisi.bildirim_aktif === false) {
    // Kullanıcı Profil ekranından push bildirimleri kapatmış — uygulama içi
    // bildirim (bildirimler satırı) zaten oluştu, sadece cihaza push gitmiyor.
    return new Response(JSON.stringify({ durum: 'atlandi', neden: 'bildirim_kapali' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!kisi?.expo_push_token) {
    // Kişinin cihaz kaydı yok ya da bildirim izni vermemiş — hata değil,
    // uygulama-içi bildirim (bildirimler satırı) zaten oluştu, sessizce çık.
    return new Response(JSON.stringify({ durum: 'atlandi', neden: 'push_token_yok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const pushMesaji = {
    to: kisi.expo_push_token,
    title: bildirim.baslik,
    body: bildirim.mesaj,
    sound: 'default',
    data: { bildirimId: bildirim.id },
  };

  const expoYaniti = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(pushMesaji),
  });

  const expoSonucu = await expoYaniti.json();
  console.log('Expo push sonucu:', JSON.stringify(expoSonucu));

  return new Response(JSON.stringify({ durum: 'gonderildi', expo: expoSonucu }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
