import { Alert, Platform } from "react-native";

// react-native-web'de Alert.alert no-op'tur (hiçbir şey göstermez), bu yüzden
// web'de kullanıcıya geri bildirim hiç görünmüyordu. Web'de window.alert'e,
// native'de normal Alert.alert'e düşen tek OK butonlu basit bildirimler için
// ortak yardımcı.
export function bildirimGoster(baslik: string, mesaj?: string) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && typeof window.alert === "function") {
      window.alert(mesaj ? `${baslik}\n\n${mesaj}` : baslik);
    }
    return;
  }
  Alert.alert(baslik, mesaj);
}
