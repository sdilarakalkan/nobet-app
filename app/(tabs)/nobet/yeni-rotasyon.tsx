import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';
import { bildirimGoster } from '../../../lib/bildirim';
import i18n from '../../../lib/i18n';
import { gorunurTakimlariGetir } from '../../../lib/gorunurTakimlar';

// "YYYY-MM-DD" metnini, UTC kaymasına uğramadan yerel tarihe, o an aktif
// dile göre çevirip gösterir (nobet/index.tsx'teki AYNI yardımcı — her
// ekran kendi kopyasını tutuyor, projenin genel deseni bu).
const tarihStrGoster = (tarihStr) => {
  if (!tarihStr) return '';
  const [y, ay, g] = tarihStr.split('-').map(Number);
  return new Date(y, ay - 1, g).toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'tr-TR');
};

// Kullanıcı verisi (nöbet türü/takım isimleri) için: aktif dil İngilizce ise
// _en alanını, o da boşsa Türkçesini; Türkçe ise doğrudan Türkçesini gösterir.
const yerelAdGoster = (trDeger, enDeger) => (i18n.language === 'en' ? enDeger || trDeger : trDeger) || '';

// "Otomatik" sekmesindeki "Yeni Rotasyon Oluştur" — eskiden nobet/index.tsx
// içinde açılıp kapanan bir kart bloğuydu, artık ayrı bir sayfa (nobet
// stack'inin içinde, tab bar kaybolmadan). Form alanları/doğrulamalar/
// rotasyon_ufku_doldur çağrısı BİREBİR AYNI — sadece görünüm tam sayfa.
export default function YeniRotasyon() {
  const { t } = useTranslation();
  const [yukleniyor, setYukleniyor] = useState(true);
  const [rol, setRol] = useState('personel');
  const [userId, setUserId] = useState('');
  const [kendiAdSoyad, setKendiAdSoyad] = useState('');
  const [takimlar, setTakimlar] = useState([]);
  const [nobetTurleri, setNobetTurleri] = useState([]);

  const [yeniRotasyonIsim, setYeniRotasyonIsim] = useState('');
  const [yeniRotasyonTakimId, setYeniRotasyonTakimId] = useState(null);
  const [yeniRotasyonNobetTuruId, setYeniRotasyonNobetTuruId] = useState(null);
  const [yeniRotasyonHaftaninGunu, setYeniRotasyonHaftaninGunu] = useState(null);
  const [rotasyonGonderiliyor, setRotasyonGonderiliyor] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setYukleniyor(false); return; }
      setUserId(user.id);

      const { data: kendi, error: kendiHata } = await supabase
        .from('personel')
        .select('ad_soyad, rol')
        .eq('id', user.id)
        .single();
      if (kendiHata) console.log('HATA (personel/rol):', JSON.stringify(kendiHata));
      setRol(kendi?.rol || 'personel');
      setKendiAdSoyad(kendi?.ad_soyad || '');

      const takimVeri = await gorunurTakimlariGetir(kendi?.rol || 'personel', user.id);
      setTakimlar(takimVeri);

      const { data: turler, error: turHata } = await supabase.from('nobet_turleri').select('*');
      if (turHata) console.log('HATA (nobet_turleri):', JSON.stringify(turHata));
      setNobetTurleri(turler || []);

      setYukleniyor(false);
    })();
  }, []);

  const islemLogla = async (aciklama, islemTipi, parametreler) => {
    const { error } = await supabase
      .from('islem_gecmisi')
      .insert({ kullanici_id: userId, islem_aciklamasi: aciklama, islem_tipi: islemTipi, parametreler });
    if (error) console.log('HATA (islem_gecmisi):', JSON.stringify(error));
  };

  // "Nöbet Türü" seçimi: Müdür tüm türleri görür; Takım Admini sadece kendi
  // oluşturduğu (olusturan_admin_id = kendi id'si) VEYA sahibi belirtilmemiş
  // (null — eski/mevcut) türleri görür. nobet_turleri tablosunun genel
  // SELECT RLS'i değişmedi — bu sadece rotasyon formuna özel istemci filtresi.
  const otomatikGorunurNobetTurleri =
    rol === 'mudur'
      ? nobetTurleri
      : nobetTurleri.filter((tur) => tur.olusturan_admin_id === userId || tur.olusturan_admin_id === null);

  const gunTamIsimleri = t('common.gunTamIsimleri', { returnObjects: true });

  const rotasyonSonucMesajiGoster = (sonuc) => {
    if (!sonuc) return;
    if (sonuc.durum === 'zaten_guncel') {
      bildirimGoster(t('common.basarili'), t('rotasyon.zatenGuncelMesaj', { tarih: tarihStrGoster(sonuc.ufuk) }));
    } else if (sonuc.durum === 'uye_yok') {
      bildirimGoster(t('common.hata'), t('rotasyon.uyeYokMesaj'));
    } else if (sonuc.durum === 'olusturuldu') {
      const atlananEk =
        sonuc.atlanan && sonuc.atlanan > 0 ? t('rotasyon.atlananEk', { atlanan: sonuc.atlanan }) : '';
      bildirimGoster(
        t('common.basarili'),
        t('rotasyon.olusturulduMesaj', {
          tarih: tarihStrGoster(sonuc.ufuk),
          atanan: sonuc.atanan || 0,
          telafi: sonuc.telafi_ile_atanan || 0,
          atlananEk,
        })
      );
    }
  };

  const rotasyonOlustur = async () => {
    if (!yeniRotasyonIsim.trim() || !yeniRotasyonTakimId || !yeniRotasyonNobetTuruId || !yeniRotasyonHaftaninGunu) {
      bildirimGoster(t('common.eksikBilgi'), t('rotasyon.eksikAlanMesaj'));
      return;
    }
    setRotasyonGonderiliyor(true);

    const { data: yeniRotasyon, error } = await supabase
      .from('rotasyonlar')
      .insert({
        isim: yeniRotasyonIsim.trim(),
        takim_id: yeniRotasyonTakimId,
        nobet_turu_id: yeniRotasyonNobetTuruId,
        haftanin_gunu: yeniRotasyonHaftaninGunu,
        olusturan_admin_id: userId,
      })
      .select('id')
      .single();

    if (error || !yeniRotasyon) {
      setRotasyonGonderiliyor(false);
      console.log('HATA (rotasyonlar insert):', JSON.stringify(error));
      bildirimGoster(t('common.hata'), t('rotasyon.olusturmaHatasi', { mesaj: error ? error.message : '' }));
      return;
    }

    // Rotasyonun KENDİSİNİN kurulması, aşağıdaki rotasyon_ufku_doldur'un
    // logladığı "ufuk dolduruldu/kaç nöbet atandı" olayından BAĞIMSIZ, ayrı
    // bir olay olarak loglanır — o RPC başarısız olsa bile (ör. takımda
    // henüz personel yoksa) rotasyonun kurulduğu bilgisi kaybolmaz.
    const takimBilgisi = takimlar.find((tk) => tk.id === yeniRotasyonTakimId);
    const nobetTuruBilgisi = nobetTurleri.find((tur) => tur.id === yeniRotasyonNobetTuruId);
    islemLogla(
      `${kendiAdSoyad} yeni bir rotasyon oluşturdu: ${yeniRotasyonIsim.trim()} (${takimBilgisi?.takim_adi || ''})`,
      'rotasyon_olusturuldu',
      {
        kullanici_adi: kendiAdSoyad,
        rotasyon_adi: yeniRotasyonIsim.trim(),
        takim_adi_tr: takimBilgisi?.takim_adi || '',
        takim_adi_en: takimBilgisi?.takim_adi_en || '',
        nobet_turu_tr: nobetTuruBilgisi?.isim || '',
        nobet_turu_en: nobetTuruBilgisi?.isim_en || '',
        haftanin_gunu: yeniRotasyonHaftaninGunu,
      }
    );

    // Yeni rotasyon oluşturulduğunda 6 aylık ufku hemen doldur — reaktivasyon
    // trigger'ıyla (rotasyon_aktif_edilince_ufku_doldur) AYNI RPC, sadece
    // burada INSERT bir UPDATE olmadığı için trigger tetiklenmiyor, o yüzden
    // istemci elle çağırıyor.
    const { data: sonuc, error: rpcHata } = await supabase.rpc('rotasyon_ufku_doldur', {
      p_rotasyon_id: yeniRotasyon.id,
    });
    setRotasyonGonderiliyor(false);

    if (rpcHata) {
      // Rotasyon satırı GERÇEKTEN kaydedildi (yukarıdaki insert başarılıydı) —
      // ama nöbetleri üreten asıl adım (rotasyon_ufku_doldur) başarısız oldu.
      // Bunu sessizce yutup "oluşturuldu" göstermek yerine AÇIKÇA bildiriyoruz;
      // aktif anahtarını kapatıp tekrar açmak rotasyon_aktif_edilince_ufku_
      // doldur_trigger'ı (bkz. 11-rotasyon-6-ay-ufuk.sql) tetikleyip aynı
      // RPC'yi yeniden dener — gerçek bir yeniden deneme yolu.
      console.log('HATA (rotasyon_ufku_doldur):', JSON.stringify(rpcHata));
      bildirimGoster(t('common.hata'), t('rotasyon.ufukOlusturmaHatasi', { mesaj: rpcHata.message }));
    } else {
      rotasyonSonucMesajiGoster(sonuc);
    }

    // Nöbet ekranındaki (Otomatik sekmesi) rotasyon listesi, oradaki
    // useFocusEffect sayesinde buradan dönüldüğünde otomatik yenileniyor.
    router.back();
  };

  if (yukleniyor) {
    return (
      <View style={styles.ortala}>
        <ActivityIndicator size="large" color="#0D1C32" />
      </View>
    );
  }

  return (
    <View style={styles.disKapsayici}>
      <View style={styles.ustBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.geriButon} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color="#0B1C30" />
        </TouchableOpacity>
        <Text style={styles.ustBarBaslik}>{t('rotasyon.yeniRotasyonOlustur')}</Text>
        <View style={styles.geriButon} />
      </View>

      <ScrollView style={styles.container} contentContainerStyle={styles.icerik}>
        {takimlar.length === 0 ? (
          <View style={styles.kart}>
            <Text style={styles.bosYazi}>{t('rotasyon.takimYok')}</Text>
          </View>
        ) : (
          <View style={styles.kart}>
            <Text style={styles.etiket}>{t('rotasyon.isimEtiket')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('rotasyon.isimPlaceholder')}
              value={yeniRotasyonIsim}
              onChangeText={setYeniRotasyonIsim}
            />

            <Text style={[styles.etiket, { marginTop: 12 }]}>{t('rotasyon.takimEtiket')}</Text>
            <View style={styles.cipSatiri}>
              {takimlar.map((tk) => (
                <TouchableOpacity
                  key={tk.id}
                  style={[styles.cip, yeniRotasyonTakimId === tk.id && styles.cipAktif]}
                  onPress={() => setYeniRotasyonTakimId(tk.id)}
                >
                  <Text style={[styles.cipYazi, yeniRotasyonTakimId === tk.id && styles.cipYaziAktif]}>
                    {yerelAdGoster(tk.takim_adi, tk.takim_adi_en)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.etiket, { marginTop: 12 }]}>{t('rotasyon.nobetTuruEtiket')}</Text>
            {otomatikGorunurNobetTurleri.length === 0 ? (
              <Text style={styles.bosYazi}>{t('rotasyon.nobetTuruYokUyari')}</Text>
            ) : (
              <View style={styles.cipSatiri}>
                {otomatikGorunurNobetTurleri.map((tur) => (
                  <TouchableOpacity
                    key={tur.id}
                    style={[styles.cip, yeniRotasyonNobetTuruId === tur.id && styles.cipAktif]}
                    onPress={() => setYeniRotasyonNobetTuruId(tur.id)}
                  >
                    <Text style={[styles.cipYazi, yeniRotasyonNobetTuruId === tur.id && styles.cipYaziAktif]}>
                      {yerelAdGoster(tur.isim, tur.isim_en)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <Text style={[styles.etiket, { marginTop: 12 }]}>{t('rotasyon.haftaninGunuEtiket')}</Text>
            <View style={styles.cipSatiri}>
              {[1, 2, 3, 4, 5, 6, 7].map((gun) => (
                <TouchableOpacity
                  key={gun}
                  style={[styles.cip, yeniRotasyonHaftaninGunu === gun && styles.cipAktif]}
                  onPress={() => setYeniRotasyonHaftaninGunu(gun)}
                >
                  <Text style={[styles.cipYazi, yeniRotasyonHaftaninGunu === gun && styles.cipYaziAktif]}>
                    {gunTamIsimleri[gun % 7]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.formButonSatiri}>
              <TouchableOpacity style={styles.iptalButon} onPress={() => router.back()}>
                <Text style={styles.iptalButonYazi}>{t('rotasyon.vazgec')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.yeniRotasyonButon, { flex: 1 }]}
                onPress={rotasyonOlustur}
                disabled={rotasyonGonderiliyor}
              >
                <Text style={styles.yeniRotasyonButonYazi}>
                  {rotasyonGonderiliyor ? t('rotasyon.olusturuluyor') : t('rotasyon.olusturButon')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  disKapsayici: { flex: 1, backgroundColor: '#F8F9FF' },
  ustBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: '#F8F9FF',
    borderBottomWidth: 1,
    borderBottomColor: '#EFF4FF',
  },
  geriButon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  ustBarBaslik: { fontSize: 17, fontWeight: '700', color: '#0B1C30' },
  container: { flex: 1, backgroundColor: '#F8F9FF' },
  icerik: { padding: 16, paddingBottom: 40 },
  ortala: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8F9FF' },
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
  bosYazi: { fontSize: 13, color: '#75777E', paddingVertical: 12 },
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
  cipSatiri: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#C5C6CD',
    backgroundColor: '#F8F9FF',
  },
  cipAktif: { backgroundColor: '#000000', borderColor: '#000000' },
  cipYazi: { fontSize: 13, color: '#44474D', fontWeight: '500' },
  cipYaziAktif: { color: '#FFFFFF' },
  formButonSatiri: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  iptalButon: { paddingVertical: 14, paddingHorizontal: 12 },
  iptalButonYazi: { color: '#75777E', fontSize: 15, fontWeight: '600' },
  yeniRotasyonButon: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0D1C32',
    borderRadius: 999,
    paddingVertical: 14,
  },
  yeniRotasyonButonYazi: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
