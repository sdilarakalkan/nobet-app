import { registerForPushNotificationsAsync } from '@/lib/pushToken';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { router, Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

export default function TabsLayout() {
  const { t } = useTranslation();
  const [oturumKontrolEdiliyor, setOturumKontrolEdiliyor] = useState(true);
  const [oturumVar, setOturumVar] = useState(false);
  // "Değişim" sekmesinin tab bar'da gösterilip gösterilmeyeceğini belirler —
  // SADECE personel (rol='personel') görür; Müdür ve admin (takım şefi) için
  // sekme href:null ile tab bar'dan tamamen kaldırılır (bkz. aşağıdaki
  // Tabs.Screen). degisim.tsx kendi içinde de aynı rolleri geri yönlendirir
  // (ikinci savunma hattı — doğrudan bağlantıyla erişim de engellenir).
  const [rol, setRol] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setOturumVar(!!session);
      setOturumKontrolEdiliyor(false);
      if (!session) {
        router.replace('/');
      }
    });

    const { data: dinleyici } = supabase.auth.onAuthStateChange((_event, session) => {
      setOturumVar(!!session);
      if (!session) {
        router.replace('/');
      }
    });

    return () => {
      dinleyici.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!oturumVar) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase.from('personel').select('rol').eq('id', user.id).single();
      if (error) console.log('HATA (personel/rol - tab bar):', JSON.stringify(error));
      setRol(data?.rol || 'personel');

      // Push bildirim token'ını kaydet/güncelle (bkz. lib/pushToken.ts,
      // supabase/14-push-bildirim-webhook.sql). Oturum her açıldığında bir
      // kere çalışır; izin zaten verilmişse ucuz bir çağrı, expo_push_token'ı
      // güncel tutar. Reddedilirse (izin yok, fiziksel cihaz değil vb.)
      // sessizce loglanır, tab bar'ın açılışını ENGELLEMEZ. google-services.json
      // artık projede (bkz. app.json android.googleServicesFile) — Android'de
      // "Default FirebaseApp is not initialized" hatası bu yüzden artık
      // oluşmamalı.
      registerForPushNotificationsAsync(user.id).catch((hata) =>
        console.log('HATA (push token kaydı):', hata?.message || hata)
      );
    })();
  }, [oturumVar]);

  // rol henüz gelmediyse Tabs'ı hiç render etmiyoruz — yoksa Müdür/admin için
  // "Değişim" sekmesi bir an görünüp sonra kaybolurdu (flash).
  if (oturumKontrolEdiliyor || (oturumVar && rol === null)) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!oturumVar) {
    return null;
  }

  const degisimGorunsun = rol !== 'admin' && rol !== 'mudur';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#007AFF',
        tabBarInactiveTintColor: '#8A8D94',
      }}
    >
      <Tabs.Screen
        name="anasayfa"
        options={{
          title: t('tabs.anaSayfa'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="nobet"
        options={{
          title: t('tabs.nobet'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'briefcase' : 'briefcase-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="degisim"
        options={{
          title: t('tabs.degisim'),
          // href: null -> expo-router bu sekmeyi tab bar'dan tamamen
          // kaldırır (Müdür/admin için); personel için undefined bırakılıp
          // normal davranışına dokunulmuyor.
          href: degisimGorunsun ? undefined : null,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'swap-horizontal' : 'swap-horizontal-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profil"
        options={{
          title: t('tabs.profil'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
