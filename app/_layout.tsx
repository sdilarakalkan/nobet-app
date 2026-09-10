import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { dilTercihiniYukleVeUygula } from '../lib/i18n';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export default function RootLayout() {
  useEffect(() => {
    dilTercihiniYukleVeUygula();
  }, []);

  return (
    // nobet.tsx'teki "Nöbet Düzeni" sürükle-bırak sıralaması (react-native-
    // draggable-flatlist) gesture-handler tabanlı; Android'de sürükleme
    // jestlerinin güvenilir çalışması için kök seviyesinde sarmalanması
    // gerekiyor.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </GestureHandlerRootView>
  );
}