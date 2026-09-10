import { Stack } from 'expo-router';

// Nöbet sekmesi artık kendi stack'ine sahip — "Yeni Rotasyon Oluştur" (bkz.
// yeni-rotasyon.tsx) modal/overlay yerine tam sayfa olarak, tab bar'ı
// (Ana Sayfa/Nöbet/Değişim/Profil) kaybetmeden bu stack içinde açılıyor.
// headerShown: false — her iki ekran da (index.tsx, yeni-rotasyon.tsx)
// kendi üst çubuğunu (başlık/geri butonu) kendi içinde çiziyor, projenin
// geri kalanındaki tüm sekmelerle aynı desen.
export default function NobetStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="yeni-rotasyon" />
    </Stack>
  );
}
