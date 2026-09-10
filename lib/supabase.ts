import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Web'de (SSR/statik render sırasında `window` henüz yok) AsyncStorage
    // eşzamanlı olarak window'a erişmeye çalışıp sunucu tarafını çökertiyor.
    // Web'de storage'ı belirtmeyip supabase-js'in kendi güvenli localStorage
    // adaptörünü (isBrowser() kontrollü) kullanmasına izin veriyoruz.
    storage: Platform.OS === "web" ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Supabase'in RN için resmi önerdiği desen: uygulama arka plandayken JS
// zamanlayıcıları duraklayabiliyor, otomatik token yenileme (autoRefreshToken)
// bu yüzden geri plandan dönüldüğünde güvenilir çalışmayabiliyor — token süresi
// dolmuş halde bulunup kullanıcının "oturumu düşmüş" gibi görmesine yol
// açabiliyor. Uygulama ön plana her geldiğinde yenilemeyi elle tetikleyip
// arka plana geçince durduruyoruz. Web'de gerekmiyor (sekme arka planda da
// JS donmuyor, AppState zaten hep "active").
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (durum) => {
    if (durum === "active") {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
