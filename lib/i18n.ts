import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import en from "../locales/en.json";
import tr from "../locales/tr.json";

export const DIL_TERCIHI_ANAHTARI = "dilTercihi";
export type DesteklenenDil = "tr" | "en";

const cihazDiliTahminiAl = (): DesteklenenDil => {
  const kodlar = Localization.getLocales();
  const ilkKod = kodlar && kodlar[0] ? kodlar[0].languageCode : null;
  return ilkKod === "en" ? "en" : "tr";
};

i18next.use(initReactI18next).init({
  resources: {
    tr: { translation: tr },
    en: { translation: en },
  },
  lng: cihazDiliTahminiAl(),
  fallbackLng: "tr",
  interpolation: { escapeValue: false },
});

// Uygulama açılışında, cihaza daha önce kaydedilmiş bir dil tercihi varsa
// (kullanıcı Dil Seçimi'nden bilinçli olarak seçtiyse) onu cihaz diline
// tercihen uygular. Kayıtlı tercih yoksa cihaz dili tahmini geçerli kalır.
export const dilTercihiniYukleVeUygula = async () => {
  try {
    const kayitli = await AsyncStorage.getItem(DIL_TERCIHI_ANAHTARI);
    if (kayitli === "tr" || kayitli === "en") {
      await i18next.changeLanguage(kayitli);
    }
  } catch (e) {
    console.log("HATA (dil tercihi yükleme):", e);
  }
};

// Dil Seçimi ekranından çağrılır: dili anında değiştirir (react-i18next
// kullanan tüm bileşenler otomatik yeniden render olur) ve cihaza kalıcı
// olarak kaydeder.
export const dilDegistirVeKaydet = async (dil: DesteklenenDil) => {
  await i18next.changeLanguage(dil);
  try {
    await AsyncStorage.setItem(DIL_TERCIHI_ANAHTARI, dil);
  } catch (e) {
    console.log("HATA (dil tercihi kaydetme):", e);
  }
};

export default i18next;
