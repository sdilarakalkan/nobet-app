import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { bildirimGoster } from '../lib/bildirim';
import i18n from '../lib/i18n';
import { personelAramaEslesiyorMu } from '../lib/metinNormallestir';
import AltPanelModal from './AltPanelModal';

// "YYYY-MM-DD" -> yerel Date (UTC kaymasına uğramadan).
const supabaseTarihFormatla = (tarih) => {
  if (!tarih) return null;
  const y = tarih.getFullYear();
  const m = String(tarih.getMonth() + 1).padStart(2, '0');
  const d = String(tarih.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// Date -> "HH:MM" (saniye olmadan, nobetler.saat_*_ozel time kolonlarına yazılır).
const supabaseSaatFormatla = (saat) => (saat ? saat.toTimeString().slice(0, 5) : null);

// "HH:MM:SS" (ya da null) -> sadece saat/dakikası kullanılan bir Date, ya da null.
const saatMetniniDateYap = (saatMetni) => {
  if (!saatMetni) return null;
  const [saat, dakika, saniye] = saatMetni.split(':').map(Number);
  const d = new Date();
  d.setHours(saat || 0, dakika || 0, saniye || 0, 0);
  return d;
};

const yerelAdGoster = (trDeger, enDeger) => (i18n.language === 'en' ? enDeger || trDeger : trDeger) || '';

// Admin/Müdür'ün Ana Sayfa takvimindeki gün-detay modalından tek bir nöbeti
// (tarih, nöbet türü/saati, atanan personel) sayfa değiştirmeden düzenlemesi
// veya silmesi için — app/(tabs)/anasayfa.tsx ve app/(tabs)/nobet.tsx
// tarafından ortak kullanılan, tamamen kendi kendine yeten (kendi verisini
// kendi çeken) bir modal. UPDATE (kaydet) doğrudan nobetler tablosuna,
// nobetler_update_scoped_admin RLS'ine (supabase/2-ekip-sefi-mudur.sql) göre
// gidiyor — Müdür'e her nöbeti, Takım Admini'ne SADECE yönettiği takım(lar)ın
// üyelerine ait nöbeti değiştirme izni veriyor. DELETE (sil) ise doğrudan
// tabloya değil nobet_sil() RPC'sine gidiyor (supabase/13-nobet-sil.sql) —
// aynı yetki kapsamını RPC içinde uygular AMA ayrıca etkilenen kişiye
// bildirimler satırı da düşürür (RLS'in tek başına yapamayacağı bir şey).
// Saat alanları boş bırakılırsa null gönderilir ve nöbet türünün varsayılan
// saati kullanılmaya devam eder (supabase/9-nobet-ozel-saat.sql, bkz.
// nobetSaatBaslangicAl/nobetSaatBitisAl).
export default function NobetDuzenleModal({ visible, nobetId, userId, kendiAdSoyad, onKapat, onKaydedildi, onSilindi }) {
  const { t } = useTranslation();

  const [yukleniyor, setYukleniyor] = useState(true);
  const [bulunamadi, setBulunamadi] = useState(false);
  const [nobetTurleri, setNobetTurleri] = useState([]);
  const [personelListesi, setPersonelListesi] = useState([]);
  const [resmiTatiller, setResmiTatiller] = useState([]);
  const [orijinal, setOrijinal] = useState(null); // { tarih, nobet_turu_id, personelAdi } — silme logu için

  const [tarih, setTarih] = useState(null);
  const [tur, setTur] = useState(null);
  const [personelId, setPersonelId] = useState(null);
  const [baslangicSaat, setBaslangicSaat] = useState(null);
  const [bitisSaat, setBitisSaat] = useState(null);
  const [aramaMetni, setAramaMetni] = useState('');

  const [gosterPicker, setGosterPicker] = useState(null); // 'tarih' | 'baslangicSaat' | 'bitisSaat' | null
  const [pickerGeciciDeger, setPickerGeciciDeger] = useState(null);

  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [siliniyor, setSiliniyor] = useState(false);

  useEffect(() => {
    if (!visible || !nobetId) return;
    (async () => {
      setYukleniyor(true);
      setBulunamadi(false);
      const [turSonuc, personelSonuc, tatilSonuc, nobetSonuc] = await Promise.all([
        supabase.from('nobet_turleri').select('*'),
        supabase.from('personel_detay').select('*').eq('rol', 'personel').neq('id', userId),
        supabase.from('tatil_gunleri').select('*'),
        supabase
          .from('nobetler')
          .select('id, tarih, nobet_turu_id, personel_id, saat_baslangic_ozel, saat_bitis_ozel, personel:personel_id ( ad_soyad )')
          .eq('id', nobetId)
          .single(),
      ]);
      if (turSonuc.error) console.log('HATA (nobet_turleri):', JSON.stringify(turSonuc.error));
      if (personelSonuc.error) console.log('HATA (personel_detay):', JSON.stringify(personelSonuc.error));
      if (tatilSonuc.error) console.log('HATA (tatil_gunleri):', JSON.stringify(tatilSonuc.error));
      setNobetTurleri(turSonuc.data || []);
      // Listede her zaman ad_soyad'a göre alfabetik (Türkçe karakterler doğru
      // sıralanacak şekilde) gösterilir.
      setPersonelListesi(
        (personelSonuc.data || []).slice().sort((a, b) => (a.ad_soyad || '').localeCompare(b.ad_soyad || '', 'tr'))
      );
      setResmiTatiller(tatilSonuc.data || []);

      if (nobetSonuc.error || !nobetSonuc.data) {
        console.log('HATA (nobetler/düzenlenecek nöbet):', JSON.stringify(nobetSonuc.error));
        setBulunamadi(true);
        setYukleniyor(false);
        return;
      }

      const veri = nobetSonuc.data;
      const [y, ay, g] = veri.tarih.split('-').map(Number);
      setTarih(new Date(y, ay - 1, g));
      setTur(veri.nobet_turu_id);
      setPersonelId(veri.personel_id);
      setBaslangicSaat(saatMetniniDateYap(veri.saat_baslangic_ozel));
      setBitisSaat(saatMetniniDateYap(veri.saat_bitis_ozel));
      setOrijinal({ tarih: veri.tarih, nobet_turu_id: veri.nobet_turu_id, personelAdi: veri.personel?.ad_soyad || '' });
      setYukleniyor(false);
    })();
  }, [visible, nobetId, userId]);

  useEffect(() => {
    if (!visible) setAramaMetni('');
  }, [visible]);

  const gosterimFormatla = (d) => (d ? d.toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'tr-TR') : t('nobet.tarihSec'));
  const saatFormatla = (d) =>
    d ? d.toLocaleTimeString(i18n.language === 'en' ? 'en-US' : 'tr-TR', { hour: '2-digit', minute: '2-digit' }) : t('nobet.saatSec');
  const tarihStrGoster = (tarihStr) => {
    if (!tarihStr) return '';
    const [y, ay, g] = tarihStr.split('-').map(Number);
    return new Date(y, ay - 1, g).toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'tr-TR');
  };

  const tatilBul = (d) => {
    if (!d || resmiTatiller.length === 0) return null;
    const tarihStr = supabaseTarihFormatla(d);
    return resmiTatiller.find((rt) => rt.tarih === tarihStr) || null;
  };

  const pickerDegerAl = (alan) => {
    if (alan === 'tarih') return tarih;
    if (alan === 'baslangicSaat') return baslangicSaat;
    if (alan === 'bitisSaat') return bitisSaat;
    return null;
  };
  const pickerDegerAyarla = (alan, deger) => {
    if (alan === 'tarih') setTarih(deger);
    if (alan === 'baslangicSaat') setBaslangicSaat(deger);
    if (alan === 'bitisSaat') setBitisSaat(deger);
  };
  const pickerAc = (alan) => {
    setPickerGeciciDeger(pickerDegerAl(alan) || new Date());
    setGosterPicker(alan);
  };
  const pickerOnayla = () => {
    if (gosterPicker) pickerDegerAyarla(gosterPicker, pickerGeciciDeger || new Date());
    setGosterPicker(null);
  };
  const pickerIptal = () => setGosterPicker(null);
  const pickerDegisti = (event, secilenDeger) => {
    const alan = gosterPicker;
    setGosterPicker(null);
    if (event.type !== 'set' || !secilenDeger) return;
    pickerDegerAyarla(alan, secilenDeger);
  };

  const islemLogla = async (aciklama, islemTipi, parametreler) => {
    const { error } = await supabase
      .from('islem_gecmisi')
      .insert({ kullanici_id: userId, islem_aciklamasi: aciklama, islem_tipi: islemTipi, parametreler });
    if (error) console.log('HATA (islem_gecmisi):', JSON.stringify(error));
  };

  const kaydet = async () => {
    if (!tarih || !tur || !personelId) {
      bildirimGoster(t('common.eksikBilgi'), t('nobet.eksikBilgiTurTarihKisi'));
      return;
    }
    setKaydediliyor(true);
    const { error } = await supabase
      .from('nobetler')
      .update({
        tarih: supabaseTarihFormatla(tarih),
        nobet_turu_id: tur,
        personel_id: personelId,
        saat_baslangic_ozel: supabaseSaatFormatla(baslangicSaat),
        saat_bitis_ozel: supabaseSaatFormatla(bitisSaat),
        atama_tipi: 'manuel',
        atayan_admin_id: userId,
      })
      .eq('id', nobetId);
    setKaydediliyor(false);

    if (error) {
      bildirimGoster(t('common.hata'), t('nobet.nobetGuncellenemedi', { mesaj: error.message }));
      return;
    }

    const turBilgisi = nobetTurleri.find((tr) => tr.id === tur);
    await islemLogla(
      `${kendiAdSoyad} bir nöbeti düzenledi: ${turBilgisi?.isim || ''} - ${gosterimFormatla(tarih)}`,
      'nobet_duzenlendi',
      {
        kullanici_adi: kendiAdSoyad,
        nobet_turu_tr: turBilgisi?.isim || '',
        nobet_turu_en: turBilgisi?.isim_en || '',
        tarih: supabaseTarihFormatla(tarih),
      }
    );
    bildirimGoster(t('common.basarili'), t('nobet.nobetGuncellendiMesaj'));
    onKaydedildi?.();
  };

  const sil = () => {
    Alert.alert(
      t('anasayfa.nobetSilOnayBaslik'),
      t('anasayfa.nobetSilOnayMesaj'),
      [
        { text: t('nobet.iptalButon'), style: 'cancel' },
        {
          text: t('anasayfa.sil'),
          style: 'destructive',
          onPress: async () => {
            setSiliniyor(true);
            const { error } = await supabase.rpc('nobet_sil', { p_nobet_id: nobetId });
            setSiliniyor(false);
            if (error) {
              bildirimGoster(t('common.hata'), t('anasayfa.nobetSilinemedi', { mesaj: error.message }));
              return;
            }
            const turBilgisi = nobetTurleri.find((tr) => tr.id === orijinal?.nobet_turu_id);
            await islemLogla(
              `${kendiAdSoyad} ${orijinal?.personelAdi || ''} için bir nöbeti sildi: ${turBilgisi?.isim || ''} - ${tarihStrGoster(orijinal?.tarih)}`,
              'nobet_silindi',
              {
                kullanici_adi: kendiAdSoyad,
                silinen_kisi_adi: orijinal?.personelAdi || '',
                nobet_turu_tr: turBilgisi?.isim || '',
                nobet_turu_en: turBilgisi?.isim_en || '',
                tarih: orijinal?.tarih,
              }
            );
            onSilindi?.();
          },
        },
      ]
    );
  };

  // Sadece ad_soyad'a değil, pozisyon/rol alanlarına (varsa İngilizce
  // karşılığına da) göre de, büyük/küçük harf ve Türkçe karakter duyarlı,
  // çok kelimeli (ör. "teknik müdür") arama yapar. Türkçe küçük harfe
  // çevirme locale'e GÜVENMEDEN yapılır (bkz. turkceKucultVeNormallestir).
  const filtrelenmisPersonel = personelListesi.filter((p) =>
    personelAramaEslesiyorMu([p.ad_soyad, p.pozisyonlar, p.pozisyonlar_en, p.rol], aramaMetni)
  );
  const seciliPersonel = personelListesi.find((p) => p.id === personelId);

  return (
    <AltPanelModal visible={visible} baslik={t('nobet.duzenlemeBasligi')} onKapat={onKapat}>
      {yukleniyor ? (
        <ActivityIndicator size="small" color="#0D1C32" style={{ marginVertical: 20 }} />
      ) : bulunamadi ? (
        <Text style={styles.bosYazi}>{t('nobet.nobetBulunamadi')}</Text>
      ) : (
        <>
          <Text style={styles.aciklamaYazi}>{t('nobet.duzenlemeAciklama')}</Text>

          <Text style={styles.etiket}>{t('nobet.tarih')}</Text>
          <TouchableOpacity style={styles.inputTikla} onPress={() => pickerAc('tarih')}>
            <Ionicons name="calendar-outline" size={18} color="#75777E" />
            <Text style={styles.inputYazi}>{gosterimFormatla(tarih)}</Text>
          </TouchableOpacity>
          {tatilBul(tarih) && (
            <Text style={styles.tatilUyariYazi}>
              {t('nobet.resmiTatilEtiket', { aciklama: tatilBul(tarih).aciklama || '' })}
            </Text>
          )}

          <Text style={[styles.etiket, { marginTop: 12 }]}>{t('nobet.nobetTuru')}</Text>
          <View style={styles.turSatiri}>
            {nobetTurleri.map((turOgesi) => (
              <TouchableOpacity
                key={turOgesi.id}
                style={[styles.turButon, tur === turOgesi.id && styles.turButonAktif]}
                onPress={() => setTur(turOgesi.id)}
              >
                <Text style={[styles.turYazi, tur === turOgesi.id && styles.turYaziAktif]}>
                  {yerelAdGoster(turOgesi.isim, turOgesi.isim_en)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.etiket, { marginTop: 12 }]}>{t('nobet.saatOzelBaslik')}</Text>
          <Text style={styles.bilgiNotu}>{t('nobet.saatOzelNotu')}</Text>
          <View style={[styles.satirIkili, { marginTop: 8 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.etiket}>{t('nobet.saatBaslangicOzel')}</Text>
              <View style={styles.saatOzelSatiri}>
                <TouchableOpacity style={[styles.inputTikla, { flex: 1 }]} onPress={() => pickerAc('baslangicSaat')}>
                  <Ionicons name="time-outline" size={18} color="#75777E" />
                  <Text style={styles.inputYazi}>{baslangicSaat ? saatFormatla(baslangicSaat) : t('nobet.turSaatiKullan')}</Text>
                </TouchableOpacity>
                {baslangicSaat && (
                  <TouchableOpacity onPress={() => setBaslangicSaat(null)} style={styles.saatOzelTemizleButon}>
                    <Ionicons name="close-circle" size={20} color="#75777E" />
                  </TouchableOpacity>
                )}
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.etiket}>{t('nobet.saatBitisOzel')}</Text>
              <View style={styles.saatOzelSatiri}>
                <TouchableOpacity style={[styles.inputTikla, { flex: 1 }]} onPress={() => pickerAc('bitisSaat')}>
                  <Ionicons name="time-outline" size={18} color="#75777E" />
                  <Text style={styles.inputYazi}>{bitisSaat ? saatFormatla(bitisSaat) : t('nobet.turSaatiKullan')}</Text>
                </TouchableOpacity>
                {bitisSaat && (
                  <TouchableOpacity onPress={() => setBitisSaat(null)} style={styles.saatOzelTemizleButon}>
                    <Ionicons name="close-circle" size={20} color="#75777E" />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>

          {Platform.OS === 'ios' ? (
            <Modal transparent visible={!!gosterPicker} animationType="fade" onRequestClose={pickerIptal}>
              <TouchableOpacity style={styles.pickerArkaPlan} activeOpacity={1} onPress={pickerIptal}>
                <TouchableOpacity activeOpacity={1} style={styles.pickerKart} onPress={() => {}}>
                  {gosterPicker && (
                    <DateTimePicker
                      value={pickerGeciciDeger || new Date()}
                      mode={gosterPicker === 'tarih' ? 'date' : 'time'}
                      display="spinner"
                      onChange={(event, secilenDeger) => {
                        if (secilenDeger) setPickerGeciciDeger(secilenDeger);
                      }}
                    />
                  )}
                  <View style={styles.pickerButonSatiri}>
                    <TouchableOpacity style={styles.pickerIptalButon} onPress={pickerIptal}>
                      <Text style={styles.pickerIptalYazi}>{t('nobet.iptalButon')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.pickerOnayButon} onPress={pickerOnayla}>
                      <Text style={styles.pickerOnayYazi}>{t('nobet.tamamButon')}</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              </TouchableOpacity>
            </Modal>
          ) : (
            gosterPicker && (
              <DateTimePicker
                value={pickerDegerAl(gosterPicker) || new Date()}
                mode={gosterPicker === 'tarih' ? 'date' : 'time'}
                display="default"
                onChange={pickerDegisti}
              />
            )
          )}

          <Text style={[styles.etiket, { marginTop: 12 }]}>{t('nobet.atananPersonel')}</Text>
          <View style={styles.aramaKutusu}>
            <Ionicons name="search" size={18} color="#75777E" />
            <TextInput
              style={styles.aramaInput}
              placeholder={t('nobet.aramaPlaceholder')}
              value={aramaMetni}
              onChangeText={setAramaMetni}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <View style={{ marginTop: 4 }}>
            {filtrelenmisPersonel.map((kisi) => (
              <TouchableOpacity key={kisi.id} style={styles.personelSatiri} onPress={() => setPersonelId(kisi.id)}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarYazi}>
                    {kisi.ad_soyad ? kisi.ad_soyad.split(' ').map((k) => k[0]).join('').slice(0, 2).toUpperCase() : ''}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.personelIsim}>{kisi.ad_soyad}</Text>
                  <Text style={styles.personelPozisyon}>{yerelAdGoster(kisi.pozisyonlar, kisi.pozisyonlar_en)}</Text>
                </View>
                <Ionicons
                  name={personelId === kisi.id ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={personelId === kisi.id ? '#0D1C32' : '#C5C6CD'}
                />
              </TouchableOpacity>
            ))}
            {filtrelenmisPersonel.length === 0 && <Text style={styles.bosYazi}>{t('nobet.personelBulunamadi')}</Text>}
          </View>
          {seciliPersonel && (
            <Text style={styles.bilgiNotu}>{t('nobet.seciliPersonelNotu', { isim: seciliPersonel.ad_soyad })}</Text>
          )}

          <View style={styles.altButonSatiri}>
            <TouchableOpacity style={styles.silButon} onPress={sil} disabled={siliniyor}>
              <Ionicons name="trash-outline" size={18} color="#BA1A1A" />
              <Text style={styles.silButonYazi}>{t('anasayfa.sil')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.anaButon, { flex: 1 }]} onPress={kaydet} disabled={kaydediliyor}>
              <Ionicons name="checkmark-done-outline" size={18} color="#FFFFFF" />
              <Text style={styles.anaButonYazi}>
                {kaydediliyor ? t('nobet.gonderiliyor') : t('nobet.degisiklikleriKaydet')}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </AltPanelModal>
  );
}

const styles = StyleSheet.create({
  aciklamaYazi: { fontSize: 13, color: '#44474D', marginBottom: 16 },
  etiket: { fontSize: 12, color: '#44474D', marginBottom: 6, fontWeight: '500' },
  inputTikla: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#C5C6CD',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputYazi: { fontSize: 13, color: '#0B1C30' },
  tatilUyariYazi: { fontSize: 11, color: '#C0392B', marginTop: 4, fontWeight: '500' },
  turSatiri: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  turButon: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#C5C6CD',
    backgroundColor: '#F8F9FF',
  },
  turButonAktif: { backgroundColor: '#000000', borderColor: '#000000' },
  turYazi: { fontSize: 13, color: '#44474D', fontWeight: '500' },
  turYaziAktif: { color: '#FFFFFF' },
  satirIkili: { flexDirection: 'row', gap: 12 },
  saatOzelSatiri: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  saatOzelTemizleButon: { padding: 2 },
  bilgiNotu: { fontSize: 11, color: '#75777E', marginTop: 10 },
  aramaKutusu: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#C5C6CD',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 6,
  },
  aramaInput: { flex: 1, fontSize: 14, color: '#0B1C30' },
  personelSatiri: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EFF4FF',
  },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#DCE9FF', justifyContent: 'center', alignItems: 'center' },
  avatarYazi: { fontSize: 14, fontWeight: 'bold', color: '#0B1C30' },
  personelIsim: { fontSize: 14, fontWeight: '600', color: '#0B1C30' },
  personelPozisyon: { fontSize: 12, color: '#44474D', marginTop: 2 },
  bosYazi: { fontSize: 13, color: '#75777E', paddingVertical: 12 },
  altButonSatiri: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  silButon: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#C5C6CD',
    backgroundColor: '#FFFFFF',
  },
  silButonYazi: { color: '#BA1A1A', fontSize: 14, fontWeight: '600' },
  anaButon: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#000000',
    paddingVertical: 14,
    borderRadius: 999,
  },
  anaButonYazi: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  pickerArkaPlan: {
    flex: 1,
    backgroundColor: 'rgba(11, 28, 48, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerKart: {
    width: '86%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingTop: 8,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  pickerButonSatiri: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#EFF4FF',
    marginTop: 4,
  },
  pickerIptalButon: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  pickerIptalYazi: { color: '#75777E', fontSize: 15, fontWeight: '600' },
  pickerOnayButon: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderLeftWidth: 1,
    borderLeftColor: '#EFF4FF',
  },
  pickerOnayYazi: { color: '#0B1C30', fontSize: 15, fontWeight: '700' },
});
