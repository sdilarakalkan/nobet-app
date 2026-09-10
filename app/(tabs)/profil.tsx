import { supabase } from '@/lib/supabase';
import { bildirimGoster } from '@/lib/bildirim';
import i18n, { dilDegistirVeKaydet } from '@/lib/i18n';
import type { DesteklenenDil } from '@/lib/i18n';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

type PersonelDetay = {
  id: string;
  email: string;
  ad_soyad: string;
  rol: 'personel' | 'admin' | 'mudur';
  pozisyonlar: string | null;
  takimlar: string | null;
  pozisyonlar_en: string | null;
  takimlar_en: string | null;
  bildirim_aktif: boolean;
};

type IslemKaydi = {
  id: number;
  islem_aciklamasi: string;
  islem_tipi: string | null;
  parametreler: Record<string, string> | null;
  tarih: string;
};

type PersonelSatiri = {
  id: string;
  ad_soyad: string;
  pozisyonlar: string | null;
  takimlar: string | null;
  pozisyonlar_en: string | null;
  takimlar_en: string | null;
  rol: 'personel' | 'admin' | 'mudur';
};

type NobetTuru = {
  id: number;
  isim: string;
  isim_en: string | null;
  renk_kodu: string;
  saat_baslangic: string;
  saat_bitis: string;
  tekrar_sikligi: 'gunluk' | 'haftalik';
};

const bashHarfleri = (adSoyad: string | null | undefined) =>
  adSoyad ? adSoyad.split(' ').map((k) => k[0]).join('').slice(0, 2).toUpperCase() : '';

const saatStrGoster = (saatStr: string | null | undefined) => (saatStr ? saatStr.slice(0, 5) : '');

const zamanGoster = (tarih: string) =>
  new Date(tarih).toLocaleString(i18n.language === 'en' ? 'en-US' : 'tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

// "YYYY-MM-DD" metnini, UTC kaymasına uğramadan yerel tarihe, o an aktif
// dile göre çevirip gösterir.
const tarihStrGoster = (tarihStr: string | null | undefined) => {
  if (!tarihStr) return '';
  const [y, m, g] = tarihStr.split('-').map(Number);
  return new Date(y, m - 1, g).toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'tr-TR');
};

// Kullanıcı verisi (nöbet türü/pozisyon/takım isimleri) için: aktif dil
// İngilizce ise _en alanını, o da boşsa Türkçesini; Türkçe ise doğrudan
// Türkçesini gösterir.
const yerelAdGoster = (trDeger: string | null | undefined, enDeger: string | null | undefined) =>
  (i18n.language === 'en' ? enDeger || trDeger : trDeger) || '';

// Alt sekmeden yukarı açılan, projenin genelinde kullanılan aynı bottom-sheet
// görünümü (yarı saydam arka plan + yuvarlak üst köşeli beyaz kart).
function AltPanelModal({
  visible,
  baslik,
  onKapat,
  children,
}: {
  visible: boolean;
  baslik: string;
  onKapat: () => void;
  children: ReactNode;
}) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onKapat}>
      <TouchableOpacity style={styles.modalArkaPlan} activeOpacity={1} onPress={onKapat}>
        <TouchableOpacity activeOpacity={1} style={styles.modalKart} onPress={() => {}}>
          <View style={styles.modalBaslikSatiri}>
            <Text style={styles.modalBaslikYazi}>{baslik}</Text>
            <TouchableOpacity onPress={onKapat} style={styles.modalKapatButon}>
              <Ionicons name="close" size={22} color="#75777E" />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalIcerikScroll}>{children}</ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function IslemSatiri({
  icon,
  etiket,
  sagYazi,
  onPress,
}: {
  icon: string;
  etiket: string;
  sagYazi?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.islemSatiri} onPress={onPress}>
      <View style={styles.islemIkonKutu}>
        <Ionicons name={icon as any} size={18} color="#006B5F" />
      </View>
      <Text style={styles.islemEtiket}>{etiket}</Text>
      {sagYazi ? <Text style={styles.islemSagYazi}>{sagYazi}</Text> : null}
      <Ionicons name="chevron-forward" size={18} color="#C5C6CD" />
    </TouchableOpacity>
  );
}

export default function Profil() {
  const { t, i18n: i18nOrnegi } = useTranslation();
  const [profil, setProfil] = useState<PersonelDetay | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [hata, setHata] = useState('');
  const [cikisYapiliyor, setCikisYapiliyor] = useState(false);
  // personel.bildirim_aktif'i günceller (bkz. bildirimAktifDegistir) — o
  // sırada Switch'i devre dışı bırakıp çift tıklamayı önler.
  const [bildirimGuncelleniyor, setBildirimGuncelleniyor] = useState(false);

  const [islemGecmisiAcik, setIslemGecmisiAcik] = useState(false);
  const [islemGecmisi, setIslemGecmisi] = useState<IslemKaydi[]>([]);
  const [islemGecmisiYukleniyor, setIslemGecmisiYukleniyor] = useState(false);

  const [personelYonetimiAcik, setPersonelYonetimiAcik] = useState(false);
  const [tumPersonel, setTumPersonel] = useState<PersonelSatiri[]>([]);
  const [tumPersonelYukleniyor, setTumPersonelYukleniyor] = useState(false);

  const [nobetTurleriAcik, setNobetTurleriAcik] = useState(false);
  const [nobetTurleri, setNobetTurleri] = useState<NobetTuru[]>([]);
  const [nobetTurleriYukleniyor, setNobetTurleriYukleniyor] = useState(false);

  const [dilSeciciAcik, setDilSeciciAcik] = useState(false);

  // sessiz=true: aşağı çekerek yenilemede (yenile) tam sayfa yükleniyor
  // spinner'ını (yukleniyor) tetiklemeden aynı veriyi baştan çeker —
  // RefreshControl zaten kendi dönen göstergesini gösteriyor.
  const profilGetir = useCallback(async (sessiz = false) => {
    if (!sessiz) setYukleniyor(true);
    setHata('');

    const {
      data: { user },
      error: kullaniciHatasi,
    } = await supabase.auth.getUser();

    if (kullaniciHatasi || !user) {
      setHata(t('profil.kullaniciBilgisiYok'));
      if (!sessiz) setYukleniyor(false);
      return;
    }

    const { data, error } = await supabase
      .from('personel_detay')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error) {
      setHata(t('profil.profilYuklenemedi'));
    } else {
      setProfil(data);
    }
    if (!sessiz) setYukleniyor(false);
  }, [t]);

  useEffect(() => {
    profilGetir();
    // Bu efekt sadece mount'ta bir kerelik profil çekiyor; t()'nin dile göre
    // değişen referansı yüzünden tekrar tekrar çalışmasını istemiyoruz.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aşağı çekerek yenileme (pull-to-refresh): ekranın ana verisini
  // (profilGetir) yeniden çeker.
  const yenile = async () => {
    setYenileniyor(true);
    await profilGetir(true);
    setYenileniyor(false);
  };

  // Push bildirimleri aç/kapa — personel.bildirim_aktif'i doğrudan
  // günceller (lib/pushToken.ts'nin expo_push_token'ı yazma şekliyle AYNI
  // desen: RLS zaten "id = auth.uid()" olduğu sürece kendi satırını
  // güncellemeye izin veriyor, ayrı bir RPC gerekmiyor). false olunca
  // send-push-notification Edge Function bu kişiye artık push GÖNDERMEZ
  // (bkz. supabase/14-push-bildirim-webhook.sql, supabase/15-bildirim-
  // aktif.sql) — uygulama içi bildirimler (zil/panel) etkilenmez.
  const bildirimAktifDegistir = async (yeniDeger: boolean) => {
    if (!profil) return;
    setBildirimGuncelleniyor(true);
    const { error } = await supabase
      .from('personel')
      .update({ bildirim_aktif: yeniDeger })
      .eq('id', profil.id);
    setBildirimGuncelleniyor(false);

    if (error) {
      console.log('HATA (bildirim_aktif güncelle):', JSON.stringify(error));
      bildirimGoster(t('common.hata'), t('profil.bildirimAktifGuncellenemedi', { mesaj: error.message }));
      return;
    }

    setProfil((onceki) => (onceki ? { ...onceki, bildirim_aktif: yeniDeger } : onceki));
    bildirimGoster(
      t('common.basarili'),
      yeniDeger ? t('profil.bildirimAktifAcildiMesaj') : t('profil.bildirimAktifKapandiMesaj')
    );
  };

  const islemGecmisiniAc = async () => {
    setIslemGecmisiAcik(true);
    if (!profil) return;
    setIslemGecmisiYukleniyor(true);
    const { data, error } = await supabase
      .from('islem_gecmisi')
      .select('id, islem_aciklamasi, islem_tipi, parametreler, tarih')
      .eq('kullanici_id', profil.id)
      .order('tarih', { ascending: false });
    if (error) {
      console.log('HATA (islem_gecmisi):', JSON.stringify(error));
      bildirimGoster(t('common.hata'), t('profil.islemGecmisiYuklenemedi', { mesaj: error.message }));
    }
    setIslemGecmisi(data || []);
    setIslemGecmisiYukleniyor(false);
  };

  const personelYonetimineAc = async () => {
    setPersonelYonetimiAcik(true);
    setTumPersonelYukleniyor(true);
    // personel_detay (tüm şirket) DEĞİL, personel_yonetilen — bu view RLS
    // içinde global admin için herkesi, Ekip Şefi (admin_kapsam='takim') için
    // sadece yönettiği takım(lar)ın üyelerini döndürüyor.
    const { data, error } = await supabase
      .from('personel_yonetilen')
      .select('id, ad_soyad, pozisyonlar, takimlar, pozisyonlar_en, takimlar_en, rol')
      .order('ad_soyad', { ascending: true });
    if (error) {
      console.log('HATA (personel_yonetilen):', JSON.stringify(error));
      bildirimGoster(t('common.hata'), t('profil.personelListesiYuklenemedi', { mesaj: error.message }));
    }
    setTumPersonel(data || []);
    setTumPersonelYukleniyor(false);
  };

  const nobetTurleriniAc = async () => {
    setNobetTurleriAcik(true);
    setNobetTurleriYukleniyor(true);
    const { data, error } = await supabase
      .from('nobet_turleri')
      .select('id, isim, isim_en, renk_kodu, saat_baslangic, saat_bitis, tekrar_sikligi')
      .order('isim', { ascending: true });
    if (error) {
      console.log('HATA (nobet_turleri):', JSON.stringify(error));
      bildirimGoster(t('common.hata'), t('profil.nobetTurleriYuklenemedi', { mesaj: error.message }));
    }
    setNobetTurleri(data || []);
    setNobetTurleriYukleniyor(false);
  };

  const yakindaGoster = (ozellik: string) => {
    bildirimGoster(t('common.yakinda'), t('profil.ozellikYakinda', { ozellik }));
  };

  const dilSec = async (dil: DesteklenenDil) => {
    await dilDegistirVeKaydet(dil);
    setDilSeciciAcik(false);
  };

  // islem_tipi doluysa (yeni kayıt) parametreler'den o an aktif dilde
  // cümleyi kurar; boşsa (eski kayıt) islem_aciklamasi'nı olduğu gibi
  // (Türkçe) gösterir.
  const islemCumlesiOlustur = (kayit: IslemKaydi) => {
    if (!kayit.islem_tipi) return kayit.islem_aciklamasi;
    const p = kayit.parametreler || {};
    switch (kayit.islem_tipi) {
      case 'nobet_olusturuldu':
        return t('gecmisSablon.nobetOlusturuldu', {
          kullanici: p.kullanici_adi,
          tur: yerelAdGoster(p.nobet_turu_tr, p.nobet_turu_en),
          tarih: tarihStrGoster(p.tarih),
        });
      case 'nobet_onaylandi':
        return t('gecmisSablon.nobetOnaylandi', { kullanici: p.kullanici_adi });
      case 'nobet_reddedildi':
        return t('gecmisSablon.nobetReddedildi', { kullanici: p.kullanici_adi });
      case 'takas_kabul':
        return t('gecmisSablon.takasKabul', { kullanici: p.kullanici_adi });
      case 'takas_red':
        return t('gecmisSablon.takasRed', { kullanici: p.kullanici_adi });
      case 'izin_onaylandi':
        return t('gecmisSablon.izinOnaylandi', { izinSahibi: p.izin_sahibi_adi });
      case 'izin_reddedildi':
        return t('gecmisSablon.izinReddedildi', { izinSahibi: p.izin_sahibi_adi });
      case 'rotasyon_ay_olusturuldu':
        return (
          t('gecmisSablon.rotasyonAyOlusturuldu', {
            rotasyonAdi: p.rotasyon_adi,
            ay: p.ay,
            atanan: p.atanan,
            telafi: p.telafi,
          }) + (Number(p.atlanan) > 0 ? t('gecmisSablon.rotasyonAtlananEk', { atlanan: p.atlanan }) : '')
        );
      case 'rotasyon_uye_yok':
        return t('gecmisSablon.rotasyonUyeYok', { rotasyonAdi: p.rotasyon_adi, ay: p.ay });
      case 'rotasyon_hata':
        return t('gecmisSablon.rotasyonHata', { rotasyonAdi: p.rotasyon_adi, hata: p.hata });
      default:
        return kayit.islem_aciklamasi;
    }
  };

  const cikisYap = async () => {
    setCikisYapiliyor(true);
    await supabase.auth.signOut();
    router.replace('/');
  };

  if (yukleniyor) {
    return (
      <View style={styles.ortala}>
        <ActivityIndicator size="large" color="#0B1C30" />
      </View>
    );
  }

  if (hata || !profil) {
    return (
      <View style={styles.ortala}>
        <Text style={styles.hataYazi}>{hata || t('profil.profilBulunamadi')}</Text>
      </View>
    );
  }

  // "admin" burada geniş anlamda "yönetici menüsünü görsün" demek — hem
  // rol='admin' (Takım Admini) hem rol='mudur' (Müdür) bu kapsama girer.
  const admin = profil.rol === 'admin' || profil.rol === 'mudur';

  return (
    <View style={styles.disKapsayici}>
      <View style={styles.ustBar}>
        <Text style={styles.ustBarBaslik}>{t('profil.baslik')}</Text>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.icerik}
        refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={yenile} tintColor="#0D1C32" colors={['#0D1C32']} />}
      >
        <View style={styles.profilKarti}>
          <View style={styles.avatar}>
            <Text style={styles.avatarYazi}>{bashHarfleri(profil.ad_soyad)}</Text>
          </View>
          <View style={styles.bilgiBlok}>
            <Text style={styles.isim}>{profil.ad_soyad}</Text>
            <Text style={styles.pozisyon}>
              {yerelAdGoster(profil.pozisyonlar, profil.pozisyonlar_en) ||
                (profil.rol === 'mudur' ? t('profil.mudur') : admin ? t('profil.yonetici') : '')}
            </Text>
            {profil.takimlar ? (
              <View style={styles.rozet}>
                <Ionicons name="business-outline" size={14} color="#000000" />
                <Text style={styles.rozetYazi}>{yerelAdGoster(profil.takimlar, profil.takimlar_en)}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.emailSatir}>
          <MaterialIcons name="mail-outline" size={15} color="#44474D" />
          <Text style={styles.emailYazi}>{profil.email}</Text>
        </View>

        <View style={styles.kart}>
          <Text style={styles.bolumBaslik}>{t('profil.bildirimTercihleri')}</Text>

          <View style={[styles.toggleSatiri, styles.toggleSatiriSon]}>
            <Text style={styles.toggleYazi}>{t('profil.bildirimler')}</Text>
            <Switch
              value={profil.bildirim_aktif}
              onValueChange={bildirimAktifDegistir}
              disabled={bildirimGuncelleniyor}
              trackColor={{ false: '#C5C6CD', true: '#0D1C32' }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        <View style={styles.kart}>
          {admin ? (
            <>
              <IslemSatiri icon="people-outline" etiket={t('profil.personelYonetimi')} onPress={personelYonetimineAc} />
              <IslemSatiri icon="briefcase-outline" etiket={t('profil.nobetTurleri')} onPress={nobetTurleriniAc} />
              <IslemSatiri
                icon="options-outline"
                etiket={t('profil.sistemTercihleri')}
                onPress={() => yakindaGoster(t('profil.sistemTercihleri'))}
              />
              <IslemSatiri
                icon="language-outline"
                etiket={t('profil.dilSecimi')}
                sagYazi={t('common.dilAdi')}
                onPress={() => setDilSeciciAcik(true)}
              />
            </>
          ) : (
            <>
              <IslemSatiri icon="time-outline" etiket={t('profil.islemGecmisi')} onPress={islemGecmisiniAc} />
              <IslemSatiri
                icon="language-outline"
                etiket={t('profil.dilSecimi')}
                sagYazi={t('common.dilAdi')}
                onPress={() => setDilSeciciAcik(true)}
              />
            </>
          )}
        </View>

        <TouchableOpacity
          style={[styles.cikisButon, cikisYapiliyor && styles.cikisButonDevreDisi]}
          onPress={cikisYap}
          disabled={cikisYapiliyor}
        >
          <Ionicons name="log-out-outline" size={18} color="#D92D20" />
          <Text style={styles.cikisButonYazi}>
            {cikisYapiliyor ? t('profil.cikisYapiliyor') : t('profil.guvenliCikis')}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <AltPanelModal visible={islemGecmisiAcik} baslik={t('profil.islemGecmisi')} onKapat={() => setIslemGecmisiAcik(false)}>
        {islemGecmisiYukleniyor ? (
          <ActivityIndicator size="small" color="#0D1C32" style={{ marginVertical: 20 }} />
        ) : (
          <>
            {islemGecmisi.map((kayit, i) => (
              <View key={kayit.id} style={styles.zamanCizelgeSatiri}>
                <View style={styles.zamanCizelgeIsaretSutunu}>
                  <View style={styles.zamanCizelgeNokta} />
                  {i !== islemGecmisi.length - 1 && <View style={styles.zamanCizelgeCizgi} />}
                </View>
                <View style={{ flex: 1, paddingBottom: 16 }}>
                  <Text style={styles.zamanCizelgeMetin}>{islemCumlesiOlustur(kayit)}</Text>
                  <Text style={styles.zamanCizelgeZaman}>{zamanGoster(kayit.tarih)}</Text>
                </View>
              </View>
            ))}
            {islemGecmisi.length === 0 && <Text style={styles.bosYazi}>{t('profil.islemKaydiYokKendi')}</Text>}
          </>
        )}
      </AltPanelModal>

      <AltPanelModal visible={personelYonetimiAcik} baslik={t('profil.personelYonetimi')} onKapat={() => setPersonelYonetimiAcik(false)}>
        {tumPersonelYukleniyor ? (
          <ActivityIndicator size="small" color="#0D1C32" style={{ marginVertical: 20 }} />
        ) : (
          <>
            {tumPersonel.map((kisi) => {
              const detay = [
                yerelAdGoster(kisi.pozisyonlar, kisi.pozisyonlar_en),
                yerelAdGoster(kisi.takimlar, kisi.takimlar_en),
              ]
                .filter(Boolean)
                .join(' • ');
              return (
                <View key={kisi.id} style={styles.listeSatiri}>
                  <View style={styles.avatarKucuk}>
                    <Text style={styles.avatarKucukYazi}>{bashHarfleri(kisi.ad_soyad)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.satirBaslik}>{kisi.ad_soyad}</Text>
                    <Text style={styles.satirAltYazi}>{detay || '-'}</Text>
                  </View>
                  <View style={[styles.rolRozet, kisi.rol !== 'personel' && styles.rolRozetAdmin]}>
                    <Text style={[styles.rolRozetYazi, kisi.rol !== 'personel' && styles.rolRozetYaziAdmin]}>
                      {kisi.rol === 'mudur' ? t('profil.mudur') : kisi.rol === 'admin' ? t('profil.admin') : t('profil.personel')}
                    </Text>
                  </View>
                </View>
              );
            })}
            {tumPersonel.length === 0 && <Text style={styles.bosYazi}>{t('profil.personelBulunamadi')}</Text>}
          </>
        )}
      </AltPanelModal>

      <AltPanelModal visible={nobetTurleriAcik} baslik={t('profil.nobetTurleri')} onKapat={() => setNobetTurleriAcik(false)}>
        {nobetTurleriYukleniyor ? (
          <ActivityIndicator size="small" color="#0D1C32" style={{ marginVertical: 20 }} />
        ) : (
          <>
            {nobetTurleri.map((tur) => (
              <View key={tur.id} style={styles.listeSatiri}>
                <View style={[styles.renkNoktasi, { backgroundColor: tur.renk_kodu || '#75777E' }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.satirBaslik}>{yerelAdGoster(tur.isim, tur.isim_en)}</Text>
                  <Text style={styles.satirAltYazi}>
                    {saatStrGoster(tur.saat_baslangic)} - {saatStrGoster(tur.saat_bitis)}
                  </Text>
                </View>
                <View style={styles.kapaliRozet}>
                  <Text style={styles.kapaliRozetYazi}>
                    {tur.tekrar_sikligi === 'haftalik' ? t('profil.haftalik') : t('profil.gunluk')}
                  </Text>
                </View>
              </View>
            ))}
            {nobetTurleri.length === 0 && <Text style={styles.bosYazi}>{t('profil.nobetTuruYok')}</Text>}
          </>
        )}
      </AltPanelModal>

      <AltPanelModal visible={dilSeciciAcik} baslik={t('profil.dilSecimi')} onKapat={() => setDilSeciciAcik(false)}>
        <TouchableOpacity style={styles.dilSatiri} onPress={() => dilSec('tr')}>
          <Text style={styles.dilSatiriYazi}>Türkçe</Text>
          {i18nOrnegi.language === 'tr' && <Ionicons name="checkmark" size={20} color="#0D1C32" />}
        </TouchableOpacity>
        <TouchableOpacity style={[styles.dilSatiri, styles.dilSatiriSon]} onPress={() => dilSec('en')}>
          <Text style={styles.dilSatiriYazi}>English</Text>
          {i18nOrnegi.language === 'en' && <Ionicons name="checkmark" size={20} color="#0D1C32" />}
        </TouchableOpacity>
      </AltPanelModal>
    </View>
  );
}

const styles = StyleSheet.create({
  disKapsayici: { flex: 1, backgroundColor: '#F8F9FF' },
  ustBar: {
    paddingTop: 56,
    paddingHorizontal: 24,
    paddingBottom: 12,
    backgroundColor: '#F8F9FF',
    borderBottomWidth: 1,
    borderBottomColor: '#EFF4FF',
  },
  ustBarBaslik: { fontSize: 20, fontWeight: 'bold', color: '#0B1C30' },
  container: {
    flex: 1,
    backgroundColor: '#F8F9FF',
  },
  icerik: { padding: 24, paddingBottom: 48 },
  ortala: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8F9FF',
  },
  hataYazi: {
    color: '#D92D20',
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  profilKarti: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#DCE9FF',
    borderWidth: 2,
    borderColor: '#E5EEFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarYazi: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0B1C30',
  },
  bilgiBlok: {
    flexDirection: 'column',
    justifyContent: 'center',
  },
  isim: {
    fontSize: 20,
    fontWeight: '600',
    color: '#0B1C30',
  },
  pozisyon: {
    fontSize: 14,
    color: '#44474D',
    marginTop: 4,
  },
  rozet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DCE9FF',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  rozetYazi: {
    fontSize: 12,
    fontWeight: '500',
    color: '#000000',
  },
  emailSatir: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 20,
    marginBottom: 20,
  },
  emailYazi: {
    fontSize: 14,
    color: '#44474D',
  },
  kart: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#EFF4FF',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  bolumBaslik: { fontSize: 16, fontWeight: '600', color: '#0B1C30', marginBottom: 8 },
  toggleSatiri: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EFF4FF',
  },
  toggleSatiriSon: { borderBottomWidth: 0 },
  toggleYazi: { fontSize: 14, color: '#0B1C30', fontWeight: '500' },
  islemSatiri: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EFF4FF',
  },
  islemIkonKutu: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#EFF4FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  islemEtiket: { flex: 1, fontSize: 14, fontWeight: '500', color: '#0B1C30' },
  islemSagYazi: { fontSize: 13, color: '#75777E' },
  bosYazi: { fontSize: 13, color: '#75777E', paddingVertical: 20, textAlign: 'center' },
  cikisButon: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#D92D20',
  },
  cikisButonDevreDisi: {
    opacity: 0.6,
  },
  cikisButonYazi: {
    color: '#D92D20',
    fontSize: 16,
    fontWeight: '600',
  },

  // Alt panel modallar (ortak chrome)
  modalArkaPlan: {
    flex: 1,
    backgroundColor: 'rgba(11, 28, 48, 0.4)',
    justifyContent: 'flex-end',
  },
  modalKart: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  modalBaslikSatiri: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalBaslikYazi: { fontSize: 18, fontWeight: '700', color: '#0B1C30' },
  modalKapatButon: { padding: 4 },
  modalIcerikScroll: { maxHeight: '100%' },

  // İşlem geçmişi (timeline)
  zamanCizelgeSatiri: { flexDirection: 'row', gap: 12 },
  zamanCizelgeIsaretSutunu: { alignItems: 'center', width: 12 },
  zamanCizelgeNokta: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#0D1C32', marginTop: 4 },
  zamanCizelgeCizgi: { flex: 1, width: 2, backgroundColor: '#EFF4FF', marginTop: 2 },
  zamanCizelgeMetin: { fontSize: 13, color: '#0B1C30', lineHeight: 18 },
  zamanCizelgeZaman: { fontSize: 11, color: '#8A8D94', marginTop: 2 },

  // Personel Yönetimi / Nöbet Türleri liste satırları
  listeSatiri: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EFF4FF',
  },
  avatarKucuk: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#DCE9FF', justifyContent: 'center', alignItems: 'center' },
  avatarKucukYazi: { fontSize: 12, fontWeight: 'bold', color: '#0B1C30' },
  satirBaslik: { fontSize: 14, fontWeight: '600', color: '#0B1C30' },
  satirAltYazi: { fontSize: 12, color: '#44474D', marginTop: 2 },
  renkNoktasi: { width: 12, height: 12, borderRadius: 6 },
  rolRozet: { backgroundColor: '#EFF4FF', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  rolRozetAdmin: { backgroundColor: '#0D1C32' },
  rolRozetYazi: { fontSize: 11, color: '#006F64', fontWeight: '600' },
  rolRozetYaziAdmin: { color: '#FFFFFF' },
  kapaliRozet: { backgroundColor: '#EFF4FF', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  kapaliRozetYazi: { fontSize: 11, color: '#44474D', fontWeight: '700' },

  // Dil Seçimi
  dilSatiri: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EFF4FF',
  },
  dilSatiriSon: { borderBottomWidth: 0 },
  dilSatiriYazi: { fontSize: 15, fontWeight: '500', color: '#0B1C30' },
});
