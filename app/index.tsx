import { supabase } from '@/lib/supabase';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function GirisEkrani() {
  const [email, setEmail] = useState('');
  const [sifre, setSifre] = useState('');
  const [sifreGoster, setSifreGoster] = useState(false);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hataMesaji, setHataMesaji] = useState('');
  // persistSession (lib/supabase.ts) sayesinde oturum diskte duruyor olsa
  // bile, bu ekran daha önce hiç kontrol etmeden doğrudan giriş formunu
  // gösteriyordu — "her kapatıp açtığımda tekrar giriş isteniyor" şikayetinin
  // asıl sebebi buydu (oturum kaybolmuyordu, arayüz hiç sormuyordu). Şimdi
  // mount'ta mevcut oturumu kontrol edip varsa doğrudan Ana Sayfa'ya
  // yönlendiriyor; kontrol bitene kadar formu GÖSTERMEYEREK (login formunun
  // bir anlığına yanıp sönmesini önlemek için) bir yükleniyor göstergesi
  // gösteriyoruz.
  const [oturumKontrolEdiliyor, setOturumKontrolEdiliyor] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace('/(tabs)/anasayfa');
        return;
      }
      setOturumKontrolEdiliyor(false);
    });
  }, []);

  if (oturumKontrolEdiliyor) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#0D1C32" />
      </View>
    );
  }

  const girisYap = async () => {
    if (!email.trim() || !sifre.trim()) {
      // Alert.alert web'de sessizce hiçbir şey göstermiyor (react-native-web'de no-op),
      // bu yüzden web'de window.alert'e düşüyoruz.
      if (Platform.OS === 'web') {
        window.alert('Lütfen e-posta ve şifrenizi girin.');
      } else {
        Alert.alert('Eksik bilgi', 'Lütfen e-posta ve şifrenizi girin.');
      }
      return;
    }

    setHataMesaji('');
    setYukleniyor(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: sifre,
    });

    setYukleniyor(false);

    if (error) {
      setHataMesaji(
        error.message === 'Invalid login credentials'
          ? 'E-posta veya şifre hatalı.'
          : error.message
      );
      return;
    }

    router.replace('/(tabs)/anasayfa');
  };

  return (
    <View style={styles.container}>
      <View style={styles.kart}>
        <Text style={styles.baslik}>Nöbet Takip</Text>
        <Text style={styles.aciklama}>Sisteme giriş yapmak için bilgilerinizi giriniz.</Text>

        <View style={styles.inputSarmalayici}>
          <MaterialIcons name="mail-outline" size={20} color="#75777E" style={styles.inputIkon} />
          <TextInput
            style={styles.input}
            placeholder="E-posta"
            placeholderTextColor="#75777E"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            editable={!yukleniyor}
            textContentType="username"
            autoComplete="email"
          />
        </View>

        <View style={styles.inputSarmalayici}>
          <MaterialIcons name="lock-outline" size={20} color="#75777E" style={styles.inputIkon} />
          <TextInput
            style={styles.input}
            placeholder="Şifre"
            placeholderTextColor="#75777E"
            value={sifre}
            onChangeText={setSifre}
            secureTextEntry={!sifreGoster}
            editable={!yukleniyor}
            textContentType="password"
            autoComplete="password"
            importantForAutofill="yes"
          />
          <TouchableOpacity onPress={() => setSifreGoster((onceki) => !onceki)} hitSlop={8}>
            <MaterialIcons
              name={sifreGoster ? 'visibility-off' : 'visibility'}
              size={20}
              color="#75777E"
            />
          </TouchableOpacity>
        </View>

        {hataMesaji ? <Text style={styles.hata}>{hataMesaji}</Text> : null}

        <TouchableOpacity
          style={[styles.buton, yukleniyor && styles.butonDevreDisi]}
          onPress={girisYap}
          disabled={yukleniyor}
        >
          <Text style={styles.butonYazi}>{yukleniyor ? 'Giriş yapılıyor...' : 'Giriş Yap'}</Text>
        </TouchableOpacity>

        <Text style={styles.link}>Şifremi Unuttum</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#F8F9FF',
  },
  kart: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 28,
    shadowColor: '#0D1C32',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  baslik: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#0D1C32',
    textAlign: 'center',
  },
  aciklama: {
    fontSize: 13,
    color: '#44474D',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 28,
  },
  inputSarmalayici: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#C5C6CD',
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  inputIkon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 16,
    color: '#0D1C32',
  },
  hata: {
    color: '#D92D20',
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  buton: {
    backgroundColor: '#0D1C32',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  butonDevreDisi: {
    opacity: 0.6,
  },
  butonYazi: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  link: {
    color: '#006B5F',
    textAlign: 'center',
    marginTop: 20,
    fontSize: 14,
  },
});
