import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable, Animated, ScrollView, RefreshControl, ActivityIndicator, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { bildirimGoster } from '../../lib/bildirim';
import i18n from '../../lib/i18n';
import { personelAramaEslesiyorMu } from '../../lib/metinNormallestir';

// renk_kodu (#RRGGBB) hex'ini parse edip beyaza/siyaha doğru karıştırarak
// saat rozeti için açık (arka plan) / koyu (yazı) varyantlarını türetir.
const hexeAyristir = (hex) => {
  const temiz = (hex || '#75777E').replace('#', '');
  const tam = temiz.length === 3 ? temiz.split('').map((k) => k + k).join('') : temiz;
  const sayi = parseInt(tam, 16);
  if (tam.length !== 6 || Number.isNaN(sayi)) return { r: 117, g: 119, b: 126 };
  return { r: (sayi >> 16) & 255, g: (sayi >> 8) & 255, b: sayi & 255 };
};
const rgbeCevir = ({ r, g, b }) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const renkKaristir = (hex, hedef, oran) => {
  const { r, g, b } = hexeAyristir(hex);
  return rgbeCevir({ r: r + (hedef.r - r) * oran, g: g + (hedef.g - g) * oran, b: b + (hedef.b - b) * oran });
};
const renkAcikTon = (hex) => renkKaristir(hex, { r: 255, g: 255, b: 255 }, 0.82);
const renkKoyuTon = (hex) => renkKaristir(hex, { r: 0, g: 0, b: 0 }, 0.35);

const bugunStrYap = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const g = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${g}`;
};

// "YYYY-MM-DD" metnini, UTC kaymasına uğramadan yerel tarihe, o an aktif
// dile göre çevirip gösterir.
const tarihStrGoster = (tarihStr) => {
  if (!tarihStr) return '';
  const [y, m, g] = tarihStr.split('-').map(Number);
  return new Date(y, m - 1, g).toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'tr-TR');
};

const saatStrGoster = (saatStr) => (saatStr ? saatStr.slice(0, 5) : '');

const bashHarfleri = (adSoyad) =>
  adSoyad ? adSoyad.split(' ').map((k) => k[0]).join('').slice(0, 2).toUpperCase() : '';

// Kullanıcı verisi (nöbet türü/pozisyon/takım isimleri) için: aktif dil
// İngilizce ise _en alanını, o da boşsa Türkçesini; Türkçe ise doğrudan
// Türkçesini gösterir.
const yerelAdGoster = (trDeger, enDeger) => (i18n.language === 'en' ? enDeger || trDeger : trDeger) || '';

export default function Degisim() {
  const { t } = useTranslation();
  const { nobetId: yonlendirilenNobetId } = useLocalSearchParams();
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [userId, setUserId] = useState('');

  const [kendiNobetleri, setKendiNobetleri] = useState([]);
  const [seciliNobetId, setSeciliNobetId] = useState(null);
  const [personelListesi, setPersonelListesi] = useState([]);
  const [aramaMetni, setAramaMetni] = useState('');
  const [seciliPersonelId, setSeciliPersonelId] = useState(null);
  const [mesaj, setMesaj] = useState('');
  const [gonderiliyor, setGonderiliyor] = useState(false);

  // Her nöbet kartının seçili-onay ikonu için ayrı bir fade animasyon değeri;
  // nobet.id'ye göre kalıcı (render'lar arası) tutulur.
  const onayFadeDegerleri = useRef({}).current;
  const onayFadeAl = (id) => {
    if (!onayFadeDegerleri[id]) onayFadeDegerleri[id] = new Animated.Value(0);
    return onayFadeDegerleri[id];
  };

  // sessiz=true: aşağı çekerek yenilemede (yenile) tam sayfa yükleniyor
  // spinner'ını (yukleniyor) tetiklemeden aynı veriyi baştan çeker —
  // RefreshControl zaten kendi dönen göstergesini gösteriyor.
  const veriGetir = useCallback(async (sessiz = false) => {
    if (!sessiz) setYukleniyor(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { if (!sessiz) setYukleniyor(false); return; }
    setUserId(user.id);

    // Bu sekme SADECE personel için — Müdür/admin (takım şefi) tab bar'da bu
    // sekmeyi hiç görmüyor (bkz. app/(tabs)/_layout.tsx, href:null), ama
    // doğrudan bağlantı/geri gezinme gibi bir yolla buraya gelinirse diye
    // burada da ikinci bir savunma hattı olarak Ana Sayfa'ya yönlendiriliyor.
    const { data: kendi, error: kendiHata } = await supabase.from('personel').select('rol').eq('id', user.id).single();
    if (kendiHata) console.log('HATA (personel/rol):', JSON.stringify(kendiHata));
    if (kendi?.rol === 'admin' || kendi?.rol === 'mudur') {
      router.replace('/anasayfa');
      return;
    }

    const { data: nobetVeri, error: nobetHata } = await supabase
      .from('nobetler_gorunur')
      .select('id, tarih, nobet_turleri ( isim, isim_en, renk_kodu, saat_baslangic, saat_bitis )')
      .eq('personel_id', user.id)
      .eq('onay_durumu', 'onaylanan')
      .gte('tarih', bugunStrYap())
      .order('tarih', { ascending: true });
    if (nobetHata) console.log('HATA (nobetler):', JSON.stringify(nobetHata));
    setKendiNobetleri(nobetVeri || []);

    const { data: personeller, error: personelHata } = await supabase
      .from('personel_detay')
      .select('*')
      .neq('id', user.id);
    if (personelHata) console.log('HATA (personel_detay):', JSON.stringify(personelHata));
    // Listede her zaman ad_soyad'a göre alfabetik (Türkçe karakterler doğru
    // sıralanacak şekilde) gösterilir.
    setPersonelListesi(
      (personeller || []).slice().sort((a, b) => (a.ad_soyad || '').localeCompare(b.ad_soyad || '', 'tr'))
    );

    if (!sessiz) setYukleniyor(false);
  }, []);

  useEffect(() => { veriGetir(); }, [veriGetir]);

  // Aşağı çekerek yenileme (pull-to-refresh): ekranın ana verisini
  // (veriGetir) yeniden çeker.
  const yenile = async () => {
    setYenileniyor(true);
    await veriGetir(true);
    setYenileniyor(false);
  };

  // Ana Sayfa'daki takvimden "Nöbet Değiştir" ile geldiyse, o nöbeti
  // kendi nöbetleri yüklendiğinde 1. Adım'da otomatik seçili getir.
  useEffect(() => {
    if (!yonlendirilenNobetId || kendiNobetleri.length === 0) return;
    const eslesen = kendiNobetleri.find((n) => String(n.id) === String(yonlendirilenNobetId));
    if (eslesen) setSeciliNobetId(eslesen.id);
  }, [yonlendirilenNobetId, kendiNobetleri]);

  useEffect(() => {
    kendiNobetleri.forEach((nobet) => {
      Animated.timing(onayFadeAl(nobet.id), {
        toValue: seciliNobetId === nobet.id ? 1 : 0,
        duration: 180,
        useNativeDriver: true,
      }).start();
    });
    // onayFadeAl, sabit onayFadeDegerleri ref'ini okuyup/yazan yerel bir
    // yardımcı; her render'da yeniden oluşsa da davranışı değişmiyor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seciliNobetId, kendiNobetleri]);

  // Sadece ad_soyad'a değil, pozisyon/rol alanlarına (varsa İngilizce
  // karşılığına da) göre de, büyük/küçük harf ve Türkçe karakter duyarlı,
  // çok kelimeli (ör. "teknik müdür") arama yapar. Türkçe küçük harfe
  // çevirme locale'e GÜVENMEDEN yapılır (bkz. turkceKucultVeNormallestir).
  const filtrelenmisPersonel = personelListesi.filter((p) =>
    personelAramaEslesiyorMu([p.ad_soyad, p.pozisyonlar, p.pozisyonlar_en, p.rol], aramaMetni)
  );

  const seciliNobet = kendiNobetleri.find((n) => n.id === seciliNobetId) || null;
  const seciliPersonel = personelListesi.find((p) => p.id === seciliPersonelId) || null;

  const talepGonder = async () => {
    if (!seciliNobetId || !seciliPersonelId) {
      bildirimGoster(t('common.eksikBilgi'), t('degisim.eksikBilgiNobetKisi'));
      return;
    }
    setGonderiliyor(true);
    const { error } = await supabase.from('degisim_talepleri').insert({
      nobet_id: seciliNobetId,
      talep_eden_personel_id: userId,
      hedef_personel_id: seciliPersonelId,
      mesaj: mesaj.trim() || null,
      durum: 'bekleyen',
    });
    setGonderiliyor(false);
    if (error) {
      bildirimGoster(t('common.hata'), t('degisim.talepGonderilemedi', { mesaj: error.message }));
      return;
    }
    bildirimGoster(t('common.basarili'), t('degisim.talepGonderildiMesaj'));
    setSeciliNobetId(null);
    setSeciliPersonelId(null);
    setMesaj('');
  };

  if (yukleniyor) {
    return (
      <View style={styles.ortala}>
        <ActivityIndicator size="large" color="#0D1C32" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.icerik}
      refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={yenile} tintColor="#0D1C32" colors={['#0D1C32']} />}
    >
      <Text style={styles.baslik}>{t('degisim.pageBaslik')}</Text>
      <Text style={styles.aciklamaYazi}>{t('degisim.aciklamaYazi')}</Text>

      <View style={styles.kart}>
        <View style={styles.bolumBaslikSatiri}>
          <Ionicons name="calendar-outline" size={18} color="#006B5F" />
          <Text style={styles.bolumBaslik}>{t('degisim.adim1Baslik')}</Text>
        </View>
        <View style={styles.ayirici} />

        {kendiNobetleri.map((nobet) => {
          const secili = seciliNobetId === nobet.id;
          const renk = nobet.nobet_turleri?.renk_kodu || '#75777E';
          const saatAraligi = `${saatStrGoster(nobet.nobet_turleri?.saat_baslangic)} - ${saatStrGoster(
            nobet.nobet_turleri?.saat_bitis
          )}`;
          return (
            <Pressable
              key={nobet.id}
              onPress={() => setSeciliNobetId(nobet.id)}
              style={({ pressed, hovered }) => [
                styles.nobetKarti,
                secili && styles.nobetKartiAktif,
                !secili && (pressed || hovered) && styles.nobetKartiKoyuKenar,
              ]}
            >
              <View style={styles.nobetKartiUstSatir}>
                <View style={styles.nobetKartiSolGrup}>
                  <View style={[styles.renkNoktasi, { backgroundColor: renk }]} />
                  <Text style={styles.nobetTuruYazi}>
                    {yerelAdGoster(nobet.nobet_turleri?.isim, nobet.nobet_turleri?.isim_en) || t('degisim.varsayilanNobetAdi')}
                  </Text>
                </View>

                <View style={styles.nobetKartiSagGrup}>
                  <View style={[styles.saatRozeti, { backgroundColor: renkAcikTon(renk) }]}>
                    <Text style={[styles.saatRozetiYazi, { color: renkKoyuTon(renk) }]}>{saatAraligi}</Text>
                  </View>
                  <Animated.View style={{ opacity: onayFadeAl(nobet.id), transform: [{ scale: onayFadeAl(nobet.id) }] }}>
                    <Ionicons name="checkmark-circle" size={20} color="#0D1C32" />
                  </Animated.View>
                </View>
              </View>

              <Text style={styles.nobetTarihYazi}>{tarihStrGoster(nobet.tarih)}</Text>
            </Pressable>
          );
        })}
        {kendiNobetleri.length === 0 && <Text style={styles.bosYazi}>{t('degisim.yaklasanNobetYok')}</Text>}
      </View>

      <View style={styles.kart}>
        <View style={styles.bolumBaslikSatiri}>
          <Ionicons name="people-outline" size={18} color="#006B5F" />
          <Text style={styles.bolumBaslik}>{t('degisim.adim2Baslik')}</Text>
        </View>
        <View style={styles.ayirici} />

        <View style={styles.aramaKutusu}>
          <Ionicons name="search" size={18} color="#75777E" />
          <TextInput
            style={styles.aramaInput}
            placeholder={t('degisim.aramaPlaceholder')}
            value={aramaMetni}
            onChangeText={setAramaMetni}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={{ marginTop: 8 }}>
          {filtrelenmisPersonel.map((kisi) => {
            const secili = seciliPersonelId === kisi.id;
            const detay = [
              yerelAdGoster(kisi.pozisyonlar, kisi.pozisyonlar_en),
              yerelAdGoster(kisi.takimlar, kisi.takimlar_en),
            ]
              .filter(Boolean)
              .join(' • ');
            return (
              <TouchableOpacity
                key={kisi.id}
                style={[styles.secimSatiri, secili && styles.secimSatiriAktif]}
                onPress={() => setSeciliPersonelId(kisi.id)}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarYazi}>{bashHarfleri(kisi.ad_soyad)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.satirBaslik}>{kisi.ad_soyad}</Text>
                  <Text style={styles.satirAltYazi}>{detay || '-'}</Text>
                </View>
                <Ionicons
                  name={secili ? 'radio-button-on' : 'radio-button-off'}
                  size={22}
                  color={secili ? '#0D1C32' : '#75777E'}
                />
              </TouchableOpacity>
            );
          })}
          {filtrelenmisPersonel.length === 0 && <Text style={styles.bosYazi}>{t('degisim.personelBulunamadi')}</Text>}
        </View>
      </View>

      <View style={styles.kart}>
        <View style={styles.bolumBaslikSatiri}>
          <Ionicons name="chatbubble-ellipses-outline" size={18} color="#006B5F" />
          <Text style={styles.bolumBaslik}>{t('degisim.adim3Baslik')}</Text>
        </View>
        <View style={styles.ayirici} />

        <Text style={styles.etiket}>{t('degisim.notOpsiyonel')}</Text>
        <TextInput
          style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
          placeholder={t('degisim.mesajPlaceholder')}
          value={mesaj}
          onChangeText={setMesaj}
          multiline
        />

        <View style={styles.ozetKutusu}>
          <Text style={styles.ozetYazi}>
            {seciliNobet
              ? `${tarihStrGoster(seciliNobet.tarih)} ${yerelAdGoster(seciliNobet.nobet_turleri?.isim, seciliNobet.nobet_turleri?.isim_en)}`
              : t('degisim.nobetSecilmedi')}
          </Text>
          <Ionicons name="arrow-forward" size={16} color="#44474D" />
          <Text style={styles.ozetYazi}>{seciliPersonel ? seciliPersonel.ad_soyad : t('degisim.secimBekleniyor')}</Text>
        </View>

        <TouchableOpacity
          style={[
            styles.anaButon,
            { marginTop: 14 },
            (!seciliNobetId || !seciliPersonelId || gonderiliyor) && styles.anaButonPasif,
          ]}
          onPress={talepGonder}
          disabled={!seciliNobetId || !seciliPersonelId || gonderiliyor}
        >
          <Ionicons name="paper-plane-outline" size={18} color="#FFFFFF" />
          <Text style={styles.anaButonYazi}>{gonderiliyor ? t('degisim.gonderiliyor') : t('degisim.talepGonderButon')}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FF' },
  icerik: { padding: 16, paddingTop: 60, paddingBottom: 40 },
  ortala: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8F9FF' },
  baslik: { fontSize: 24, fontWeight: 'bold', color: '#0B1C30', marginBottom: 6 },
  aciklamaYazi: { fontSize: 14, color: '#44474D', marginBottom: 20 },
  kart: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#EFF4FF',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  bolumBaslikSatiri: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  bolumBaslik: { fontSize: 16, fontWeight: '600', color: '#0B1C30' },
  ayirici: { borderBottomWidth: 1, borderBottomColor: '#EFF4FF', marginBottom: 12 },
  etiket: { fontSize: 12, color: '#44474D', marginBottom: 6, fontWeight: '500' },
  input: {
    borderWidth: 1,
    borderColor: '#C5C6CD',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0B1C30',
  },
  aramaKutusu: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#C5C6CD',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  aramaInput: { flex: 1, fontSize: 14, color: '#0B1C30' },
  secimSatiri: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EFF4FF',
    marginBottom: 8,
  },
  secimSatiriAktif: { borderColor: '#0D1C32', backgroundColor: '#F1F6FF' },
  renkNoktasi: { width: 12, height: 12, borderRadius: 6 },
  nobetKarti: {
    borderWidth: 1.5,
    borderColor: '#E4E7EE',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    padding: 14,
    marginBottom: 10,
  },
  nobetKartiAktif: { borderColor: '#0D1C32', backgroundColor: '#F1F6FF' },
  nobetKartiKoyuKenar: { borderColor: '#9A9DA6' },
  nobetKartiUstSatir: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  nobetKartiSolGrup: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  nobetKartiSagGrup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nobetTuruYazi: { fontSize: 15, fontWeight: '700', color: '#0B1C30', flexShrink: 1 },
  saatRozeti: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  saatRozetiYazi: { fontSize: 12, fontWeight: '700' },
  nobetTarihYazi: { fontSize: 12, color: '#8A8D94', marginTop: 8 },
  satirBaslik: { fontSize: 14, fontWeight: '600', color: '#0B1C30' },
  satirAltYazi: { fontSize: 12, color: '#44474D', marginTop: 2 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#DCE9FF', justifyContent: 'center', alignItems: 'center' },
  avatarYazi: { fontSize: 14, fontWeight: 'bold', color: '#0B1C30' },
  bosYazi: { fontSize: 13, color: '#75777E', paddingVertical: 12 },
  ozetKutusu: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F1F6FF',
    borderRadius: 8,
    padding: 12,
    marginTop: 14,
  },
  ozetYazi: { flex: 1, fontSize: 13, fontWeight: '600', color: '#0B1C30' },
  anaButon: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#000000',
    paddingVertical: 14,
    borderRadius: 999,
  },
  anaButonPasif: { opacity: 0.4 },
  anaButonYazi: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
