import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator, Alert, TextInput, Platform, Modal, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';
import { bildirimGoster } from '../../../lib/bildirim';
import i18n from '../../../lib/i18n';
import { rotasyonSiraListeleriGetir } from '../../../lib/rotasyonSirasi';
import { personelAramaEslesiyorMu } from '../../../lib/metinNormallestir';
import { gorunurTakimlariGetir } from '../../../lib/gorunurTakimlar';
import NobetDuzenleModal from '../../../components/NobetDuzenleModal';

// ISO hafta sırası: Pazartesi = 1 ... Pazar = 7
const HAFTA_GUNU_SIRA = {
  pazartesi: 1,
  sali: 2,
  carsamba: 3,
  persembe: 4,
  cuma: 5,
  cumartesi: 6,
  pazar: 7,
};

// Bulunulan hafta içindeki hedef günü döndürür; o gün bu haftada geçtiyse
// (bugünden önceyse) bir sonraki haftanın aynı gününü döndürür.
const haftaGunuTarihiHesapla = (haftaGunu) => {
  const hedefSira = HAFTA_GUNU_SIRA[haftaGunu];
  if (!hedefSira) return null;
  const bugun = new Date();
  bugun.setHours(0, 0, 0, 0);
  const bugunSira = bugun.getDay() === 0 ? 7 : bugun.getDay();
  const pazartesi = new Date(bugun);
  pazartesi.setDate(bugun.getDate() - (bugunSira - 1));
  const hedefTarih = new Date(pazartesi);
  hedefTarih.setDate(pazartesi.getDate() + (hedefSira - 1));
  if (hedefTarih < bugun) hedefTarih.setDate(hedefTarih.getDate() + 7);
  return hedefTarih;
};

// "HH:MM:SS" formatındaki saat metnini, sadece saat/dakikası kullanılan bir
// Date nesnesine çevirir (saatFormatla / supabaseSaatFormatla bu şekilde okuyor).
const saatMetniniDateYap = (saatMetni) => {
  if (!saatMetni) return null;
  const [saat, dakika, saniye] = saatMetni.split(':').map(Number);
  const d = new Date();
  d.setHours(saat || 0, dakika || 0, saniye || 0, 0);
  return d;
};

// "YYYY-MM-DD" metnini, UTC kaymasına uğramadan yerel tarihe, o an aktif
// dile göre çevirip gösterir.
const tarihStrGoster = (tarihStr) => {
  if (!tarihStr) return '';
  const [y, ay, g] = tarihStr.split('-').map(Number);
  return new Date(y, ay - 1, g).toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'tr-TR');
};

const bugunStrYap = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const g = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${g}`;
};

// Kullanıcı verisi (nöbet türü/pozisyon/takım isimleri) için: aktif dil
// İngilizce ise _en alanını, o da boşsa Türkçesini; Türkçe ise doğrudan
// Türkçesini gösterir.
const yerelAdGoster = (trDeger, enDeger) => (i18n.language === 'en' ? enDeger || trDeger : trDeger) || '';

// Web'deki ham <input type="date"> için — StyleSheet.create() ÜZERİNDEN
// DEĞİL: react-native-web'in optimize modunda StyleSheet.create çıktısı
// (bir kayıt id'si/atomic class referansı olabiliyor) düz bir DOM input'un
// style prop'una doğrudan geçirilemeyebiliyor; bu yüzden gerçek bir CSS-in-JS
// düz objesi kullanılıyor.
const webTarihInputStyle = {
  border: '1px solid #C5C6CD',
  borderRadius: 8,
  padding: 10,
  fontSize: 13,
  color: '#0B1C30',
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};

export default function Nobet() {
  const { t } = useTranslation();
  // Anasayfa takviminden bir nöbete tıklanınca (SADECE admin/müdür) buraya
  // ?nobetId=... ile gelinir — bu durumda ekran "Yeni Nöbet Ekle" yerine tek
  // bir mevcut nöbeti düzenleme moduna geçer (bkz. aşağıdaki `if (nobetId)`
  // erken dönüşü). nobetId yoksa ekranın davranışı/akışı birebir eskisi gibidir.
  const { nobetId: nobetIdParam } = useLocalSearchParams();
  const nobetId = Array.isArray(nobetIdParam) ? nobetIdParam[0] : nobetIdParam;
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [rol, setRol] = useState('personel');
  const [kendiAdSoyad, setKendiAdSoyad] = useState('');
  const [userId, setUserId] = useState('');
  // "Personel Ara", "Takımlardan Seç" ve "Partner Davet Et" sekmelerinin
  // ÜÇÜ de aynı personelListesi'ni paylaşır — sayfa açılır açılmaz değil,
  // bu üç sekmeden HERHANGİ biri ilk kez açıldığında bir kere (lazy) çekilir
  // ve sonraki sekme geçişlerinde tekrar sorgu atılmaz (personelListesiYuklendi
  // bayrağı). "Personel Ara" bu listeyi aramaMetni'ne göre istemci tarafında
  // filtreler (bkz. filtrelenmisPersonel).
  const [personelListesi, setPersonelListesi] = useState([]);
  const [personelListesiYukleniyor, setPersonelListesiYukleniyor] = useState(false);
  const [personelListesiYuklendi, setPersonelListesiYuklendi] = useState(false);
  const [takimlar, setTakimlar] = useState([]);
  const [nobetTurleri, setNobetTurleri] = useState([]);
  const [seciliTur, setSeciliTur] = useState(null); // nobet_turleri.id artık bigint (sayı)
  const [baslangicTarih, setBaslangicTarih] = useState(null);
  const [bitisTarih, setBitisTarih] = useState(null);
  const [baslangicSaat, setBaslangicSaat] = useState(null);
  const [bitisSaat, setBitisSaat] = useState(null);
  const [gosterPicker, setGosterPicker] = useState(null);
  const [pickerGeciciDeger, setPickerGeciciDeger] = useState(null);
  const [grupAdi, setGrupAdi] = useState('');
  const [aciklama, setAciklama] = useState('');
  const [aramaMetni, setAramaMetni] = useState('');
  const [seciliUyeler, setSeciliUyeler] = useState([]);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  // Sayfa ilk açıldığında hiçbir sekme (Personel Ara/Takımlardan Seç/Partner
  // Davet Et) seçili değil — kullanıcı birine tıklayana kadar hiçbiri
  // render olmaz (bkz. aşağıdaki {aktifSekme === '...' && (...)} blokları).
  const [aktifSekme, setAktifSekme] = useState(null);
  const [resmiTatiller, setResmiTatiller] = useState([]);

  // Manuel/Otomatik ana sekmeler — SADECE admin/mudur'a görünür (aşağıda
  // yoneticiMi ile korunuyor). Personel'de sekme çubuğu hiç render olmaz,
  // aktifAnaSekme her zaman 'manuel' kalır, yani ekran eskisiyle birebir.
  const [aktifAnaSekme, setAktifAnaSekme] = useState('manuel');
  const [rotasyonlar, setRotasyonlar] = useState([]);
  const [rotasyonSiraVerisi, setRotasyonSiraVerisi] = useState({});
  const [rotasyonYaklasanNobetler, setRotasyonYaklasanNobetler] = useState({});
  const [rotasyonYukleniyor, setRotasyonYukleniyor] = useState(false);
  const [duzenlenenNobet, setDuzenlenenNobet] = useState(null); // { id, rotasyonId, tarih, personel_id, personelAdi }
  const [duzenleYeniTarih, setDuzenleYeniTarih] = useState(null);
  const [duzenleYeniPersonelId, setDuzenleYeniPersonelId] = useState(null);
  const [duzenleGosterPicker, setDuzenleGosterPicker] = useState(false);
  const [duzenlemeKaydediliyor, setDuzenlemeKaydediliyor] = useState(false);

  // Müdür (rol='mudur') ve Takım Admini (rol='admin') bu ekranda AYNI
  // "yönetici" akışını izler (grup nöbeti oluşturma) — kapsam farkı (tüm
  // şirket / sadece yönettiği takım) "Takımlardan Seç" sekmesindeki
  // gorunurTakimlariGetir ile RLS üzerinden zaten ayrılıyor.
  const yoneticiMi = rol === 'admin' || rol === 'mudur';

  // Otomatik sekmesi için rotasyon listesi — rotasyonlar'ın RLS'i zaten
  // Müdür/Takım Admini'ne göre kapsamlıyor (takim_yonetiliyor_mu), burada
  // ekstra filtre gerekmiyor.
  const rotasyonlariGetir = useCallback(async () => {
    setRotasyonYukleniyor(true);
    const { data, error } = await supabase
      .from('rotasyonlar')
      .select('*, takimlar ( takim_adi, takim_adi_en ), nobet_turleri ( isim, isim_en )')
      .order('created_at', { ascending: false });
    if (error) {
      console.log('HATA (rotasyonlar):', JSON.stringify(error));
      bildirimGoster(t('common.hata'), t('rotasyon.listeYuklenemedi', { mesaj: error.message }));
    }
    const rotasyonListesi = data || [];
    setRotasyonlar(rotasyonListesi);

    const siraVerisi = await rotasyonSiraListeleriGetir(rotasyonListesi);
    setRotasyonSiraVerisi(siraVerisi);

    // Yaklaşan (bugün DAHİL, bugünden itibaren) nöbet örnekleri — "Düzenle"
    // için gerekli. nobetler.rotasyon_id doğrudan eşleştiriyor (bkz.
    // 12-rotasyon-dondurma-ve-silme.sql) — eski nobet_turu_id + takım üyeliği
    // heuristiği kaldırıldı. nobetler_gorunur kullanılıyor: rotasyon pasifse
    // (dondurulmuşsa) bu liste otomatik boş döner, tekrar aktif olunca
    // otomatik geri gelir — kartın kendi aktif/pasif durumuyla tutarlı.
    // nobet_duzenle() bugünü düzenlemeye izin veriyor (sadece GEÇMİŞ
    // tarihleri reddediyor), yani gte('tarih', bugün) backend kuralıyla
    // tutarlı.
    const rotasyonIdler = rotasyonListesi.map((r) => r.id);
    const yaklasanMap = {};
    if (rotasyonIdler.length > 0) {
      const { data: yaklasanVeri, error: yaklasanHata } = await supabase
        .from('nobetler_gorunur')
        .select('id, tarih, personel_id, nobet_turu_id, rotasyon_id, personel:personel_id ( ad_soyad )')
        .in('rotasyon_id', rotasyonIdler)
        .gte('tarih', bugunStrYap())
        .order('tarih', { ascending: true });
      if (yaklasanHata) console.log('HATA (nobetler/yaklaşan):', JSON.stringify(yaklasanHata));

      rotasyonListesi.forEach((r) => {
        yaklasanMap[r.id] = (yaklasanVeri || []).filter((n) => n.rotasyon_id === r.id);
      });
    }
    setRotasyonYaklasanNobetler(yaklasanMap);

    setRotasyonYukleniyor(false);
  }, [t]);

  // sessiz=true: aşağı çekerek yenilemede (yenile) tam sayfa yükleniyor
  // spinner'ını (yukleniyor) tetiklemeden aynı veriyi baştan çeker —
  // RefreshControl zaten kendi dönen göstergesini gösteriyor, ikisi
  // birden ekranı gereksiz yere sıfırlamasın diye ayrılıyor.
  const veriGetir = useCallback(async (sessiz = false) => {
    if (!sessiz) setYukleniyor(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { if (!sessiz) setYukleniyor(false); return; }
    setUserId(user.id);

    const { data: kendi, error: kendiHata } = await supabase.from('personel').select('ad_soyad, rol').eq('id', user.id).single();
    if (kendiHata) console.log('HATA (personel/rol):', JSON.stringify(kendiHata));
    setRol(kendi?.rol || 'personel');
    setKendiAdSoyad(kendi?.ad_soyad || '');

    const takimVeri = await gorunurTakimlariGetir(kendi?.rol || 'personel', user.id);
    setTakimlar(takimVeri);

    const { data: turler, error: turHata } = await supabase.from('nobet_turleri').select('*');
    if (turHata) console.log('HATA (nobet_turleri):', JSON.stringify(turHata));
    console.log('nobet_turleri sonucu:', turler ? `${turler.length} kayıt` : turler);
    setNobetTurleri(turler || []);
    if (turler && turler.length > 0) setSeciliTur(turler[0].id);

    const { data: tatiller, error: tatilHata } = await supabase.from('tatil_gunleri').select('*');
    if (tatilHata) console.log('HATA (tatil_gunleri):', JSON.stringify(tatilHata));
    setResmiTatiller(tatiller || []);

    if (kendi?.rol === 'admin' || kendi?.rol === 'mudur') {
      await rotasyonlariGetir();
    }

    if (!sessiz) setYukleniyor(false);
  }, [rotasyonlariGetir]);

  useEffect(() => { veriGetir(); }, [veriGetir]);

  // "Yeni Rotasyon Oluştur" artık ayrı bir sayfa (yeni-rotasyon.tsx) —
  // oradan (oluşturarak ya da vazgeçerek) buraya her dönüldüğünde rotasyon
  // listesi güncel kalsın diye odaklanma bazlı yeniden çekiliyor. rol henüz
  // yüklenmediyse (ilk açılış, veriGetir tamamlanmadan) atlanır.
  useFocusEffect(
    useCallback(() => {
      if (rol === 'admin' || rol === 'mudur') rotasyonlariGetir();
    }, [rol, rotasyonlariGetir])
  );

  // Aşağı çekerek yenileme (pull-to-refresh): ekranın ana verisini
  // (veriGetir) yeniden çeker.
  const yenile = async () => {
    setYenileniyor(true);
    await veriGetir(true);
    setYenileniyor(false);
  };

  // "Personel Ara" / "Takımlardan Seç" / "Partner Davet Et" sekmelerinden
  // HERHANGİ biri ilk kez açıldığında TÜM uygun personeli bir kere çeker —
  // sonraki sekme geçişlerinde (ya da arama kutusuna yazarken) tekrar sorgu
  // atmaz (personelListesiYuklendi bayrağı).
  const personelListesiniGetir = useCallback(async () => {
    setPersonelListesiYukleniyor(true);
    const { data, error } = await supabase
      .from('personel_detay')
      .select('*')
      .eq('rol', 'personel')
      .neq('id', userId);
    if (error) console.log('HATA (personel_detay):', JSON.stringify(error));
    // Listede her zaman ad_soyad'a göre alfabetik (Türkçe karakterler doğru
    // sıralanacak şekilde) gösterilir.
    setPersonelListesi(
      (data || []).slice().sort((a, b) => (a.ad_soyad || '').localeCompare(b.ad_soyad || '', 'tr'))
    );
    setPersonelListesiYuklendi(true);
    setPersonelListesiYukleniyor(false);
  }, [userId]);

  useEffect(() => {
    if (
      (aktifSekme === 'ara' || aktifSekme === 'takim' || aktifSekme === 'davet') &&
      !personelListesiYuklendi &&
      userId
    ) {
      personelListesiniGetir();
    }
  }, [aktifSekme, personelListesiYuklendi, userId, personelListesiniGetir]);

  // Nöbet türü seçildiğinde/değiştiğinde tarih ve saatler o türün varsayılan
  // değerleriyle önceden doldurulur; kullanıcı bunları elle değiştirebilir.
  useEffect(() => {
    if (!seciliTur) return;
    const tur = nobetTurleri.find((t) => t.id === seciliTur);
    if (!tur) return;

    if (tur.tekrar_sikligi === 'gunluk') {
      const bugun = new Date();
      bugun.setHours(0, 0, 0, 0);
      setBaslangicTarih(bugun);
      setBitisTarih(bugun);
      setBaslangicSaat(saatMetniniDateYap(tur.saat_baslangic));
      setBitisSaat(saatMetniniDateYap(tur.saat_bitis));
    } else if (tur.tekrar_sikligi === 'haftalik' && tur.hafta_gunu) {
      // Haftalık tür 7 gün süren bir aralık değil, her hafta tekrar eden
      // tek günlük (o günün tamamını kapsayan) bir nöbet.
      const gun = haftaGunuTarihiHesapla(tur.hafta_gunu);
      if (gun) {
        setBaslangicTarih(gun);
        setBitisTarih(gun);
        const gunBaslangic = new Date(gun);
        gunBaslangic.setHours(0, 0, 0, 0);
        const gunBitis = new Date(gun);
        gunBitis.setHours(23, 59, 0, 0);
        setBaslangicSaat(gunBaslangic);
        setBitisSaat(gunBitis);
      }
    }
  }, [seciliTur, nobetTurleri]);

  const gosterimFormatla = (tarih) => {
    if (!tarih) return t('nobet.tarihSec');
    return tarih.toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'tr-TR');
  };
  const supabaseTarihFormatla = (tarih) => {
    if (!tarih) return null;
    const y = tarih.getFullYear();
    const m = String(tarih.getMonth() + 1).padStart(2, '0');
    const d = String(tarih.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  const saatFormatla = (saat) => {
    if (!saat) return t('nobet.saatSec');
    return saat.toLocaleTimeString(i18n.language === 'en' ? 'en-US' : 'tr-TR', { hour: '2-digit', minute: '2-digit' });
  };
  const supabaseSaatFormatla = (saat) => {
    if (!saat) return null;
    return saat.toTimeString().slice(0, 5);
  };

  // tarih, tatil_gunleri listesinde varsa o kaydı döndürür (rol ayrımı yok,
  // herkes için aynı kontrol).
  const tatilBul = (tarih) => {
    if (!tarih || resmiTatiller.length === 0) return null;
    const tarihStr = supabaseTarihFormatla(tarih);
    return resmiTatiller.find((t) => t.tarih === tarihStr) || null;
  };

  // Seçilen Başlangıç/Bitiş Tarihi bir resmi tatile denk geliyorsa uyarı
  // gösterir; kullanıcı "Vazgeç" derse seçimi bir önceki değere geri alır,
  // aksi halde seçim (Devam Et) engellenmeden geçerli kalır.
  const tatilUyarisiGoster = (alan, yeniTarih, oncekiTarih) => {
    const tatil = tatilBul(yeniTarih);
    if (!tatil) return;
    Alert.alert(
      t('nobet.resmiTatilOnayBaslik'),
      t('nobet.resmiTatilOnayMesaj', { aciklama: tatil.aciklama || gosterimFormatla(yeniTarih) }),
      [
        { text: t('nobet.vazgec'), style: 'cancel', onPress: () => pickerDegerAyarla(alan, oncekiTarih) },
        { text: t('nobet.devamEt'), style: 'default' },
      ]
    );
  };

  // Android'de native takvim/saat dialog'u zaten OS seviyesinde doğru
  // konumlanıyor ve "Tamam"a her basıldığında güncel değeri döndürüyor,
  // bu yüzden Android bu fonksiyonu kullanmaya devam ediyor.
  const pickerDegisti = (event, secilenDeger) => {
    const tip = gosterPicker;
    const oncekiDeger = pickerDegerAl(tip);
    setGosterPicker(Platform.OS === 'ios' ? gosterPicker : null);
    if (event.type !== 'set' || !secilenDeger) {
      if (Platform.OS === 'android') setGosterPicker(null);
      return;
    }
    if (tip === 'baslangicTarih') setBaslangicTarih(secilenDeger);
    if (tip === 'bitisTarih') setBitisTarih(secilenDeger);
    if (tip === 'baslangicSaat') setBaslangicSaat(secilenDeger);
    if (tip === 'bitisSaat') setBitisSaat(secilenDeger);
    if (tip === 'baslangicTarih' || tip === 'bitisTarih') tatilUyarisiGoster(tip, secilenDeger, oncekiDeger);
    if (Platform.OS === 'android') setGosterPicker(null);
  };

  const pickerDegerAl = (alan) => {
    if (alan === 'baslangicTarih') return baslangicTarih;
    if (alan === 'bitisTarih') return bitisTarih;
    if (alan === 'baslangicSaat') return baslangicSaat;
    if (alan === 'bitisSaat') return bitisSaat;
    return null;
  };

  const pickerDegerAyarla = (alan, deger) => {
    if (alan === 'baslangicTarih') setBaslangicTarih(deger);
    if (alan === 'bitisTarih') setBitisTarih(deger);
    if (alan === 'baslangicSaat') setBaslangicSaat(deger);
    if (alan === 'bitisSaat') setBitisSaat(deger);
  };

  // iOS'ta "default"/"spinner" picker sayfa akışının içine, olduğu yere
  // (formun en altına) gömülü şekilde render oluyor ve kullanıcı hiç
  // dokunmadan onaylarsa onChange hiç tetiklenmiyor (değer değişmediği için).
  // Bunu, geçici bir state tutup gerçek bir Modal içinde gösterip "Tamam"a
  // basıldığında geçici değeri (değişmemiş olsa bile) commit ederek çözüyoruz.
  const pickerAc = (alan) => {
    setPickerGeciciDeger(pickerDegerAl(alan) || new Date());
    setGosterPicker(alan);
  };

  const pickerOnayla = () => {
    if (gosterPicker) {
      const alan = gosterPicker;
      const oncekiDeger = pickerDegerAl(alan);
      const yeniDeger = pickerGeciciDeger || new Date();
      pickerDegerAyarla(alan, yeniDeger);
      if (alan === 'baslangicTarih' || alan === 'bitisTarih') tatilUyarisiGoster(alan, yeniDeger, oncekiDeger);
    }
    setGosterPicker(null);
  };

  const pickerIptal = () => {
    setGosterPicker(null);
  };

  const uyeToggle = (kisi) => {
    setSeciliUyeler((onceki) => {
      const varMi = onceki.find((u) => u.id === kisi.id);
      if (varMi) return onceki.filter((u) => u.id !== kisi.id);
      return [...onceki, { ...kisi, uyeRol: 'birincil' }];
    });
  };

  const uyeCikar = (id) => {
    setSeciliUyeler((onceki) => onceki.filter((u) => u.id !== id));
  };

  // "Nöbet Düzeni" listesinde bir üyenin Birincil/İkincil rolünü değiştirir.
  // Öncelik artık sürükle-bırak sırasından DEĞİL, doğrudan kişinin seçili
  // uyeRol alanından geliyor — hem görünürdeki etiket (oncelikEtiketiAl) hem
  // de kaydedilen nobetler.rol (nobetleriOlustur) aynı alanı okuyor, böylece
  // ikisi hiçbir zaman birbirinden sapmıyor.
  const uyeRolDegistir = (id) => {
    setSeciliUyeler((onceki) =>
      onceki.map((u) => (u.id === id ? { ...u, uyeRol: u.uyeRol === 'ikincil' ? 'birincil' : 'ikincil' } : u))
    );
  };

  // Kişinin seçili rolüne (uyeRol) göre gösterilecek öncelik etiketi.
  const oncelikEtiketiAl = (uyeRol) => (uyeRol === 'ikincil' ? t('nobet.ikincil') : t('nobet.birincil'));

  // Bir takımın üyelerini personelListesi'nden süzer — hem seçim (takimSec)
  // hem seçili gösterim (takimSeciliMi) AYNI mantığı kullanır.
  const takimUyeleriniGetir = (takimId) =>
    personelListesi.filter((p) => p.takimlar && takimlar.find((t) => t.id === takimId && p.takimlar.includes(t.takim_adi)));

  const takimSec = (takimId) => {
    const takimUyeleri = takimUyeleriniGetir(takimId);
    // Önceki takımın seçimine EKLEMİYORUZ — seçim, tıklanan takımın
    // üyeleriyle tamamen değiştiriliyor (replace), önceki seçim siliniyor.
    setSeciliUyeler(takimUyeleri.map((kisi) => ({ ...kisi, uyeRol: 'birincil' })));
  };

  // "Takımlardan Seç" sekmesinde bir takımın seçili (kalın/vurgulu)
  // görünmesi için: seciliUyeler'deki kişi kümesi o takımın TÜM
  // üyeleriyle birebir aynı olmalı — takimSec zaten seçimi o takımın
  // üyeleriyle tamamen değiştiriyor, yani eşleşme = "şu an seçili takım bu".
  const takimSeciliMi = (takimId) => {
    const takimUyeleri = takimUyeleriniGetir(takimId);
    if (takimUyeleri.length === 0 || takimUyeleri.length !== seciliUyeler.length) return false;
    const seciliIdSeti = new Set(seciliUyeler.map((u) => u.id));
    return takimUyeleri.every((kisi) => seciliIdSeti.has(kisi.id));
  };

  // "Personel Ara" ve "Takımlardan Seç" birbirinden bağımsız seçim
  // yöntemleri; biri diğerine geçilince önceki sekmeden kalan seçim
  // yanlışlıkla taşınmış gibi görünmesin diye seciliUyeler sessizce
  // sıfırlanır (her iki yönde de). "Partner Davet Et" bu kurala dahil değil.
  const sekmeDegistir = (yeniSekme) => {
    const araTakimGecisi =
      (aktifSekme === 'ara' && yeniSekme === 'takim') || (aktifSekme === 'takim' && yeniSekme === 'ara');
    if (araTakimGecisi) setSeciliUyeler([]);
    setAktifSekme(yeniSekme);
  };

  // Sadece ad_soyad'a değil, pozisyon/rol alanlarına (varsa İngilizce
  // karşılığına da) göre de, büyük/küçük harf ve Türkçe karakter duyarlı,
  // çok kelimeli (ör. "teknik müdür") arama yapar. Türkçe küçük harfe
  // çevirme locale'e GÜVENMEDEN yapılır (bkz. turkceKucultVeNormallestir).
  const filtrelenmisPersonel = personelListesi.filter((p) =>
    personelAramaEslesiyorMu([p.ad_soyad, p.pozisyonlar, p.pozisyonlar_en, p.rol], aramaMetni)
  );

  // "Nöbet Düzeni" listesi: Birincil olanlar üstte, İkincil olanlar altta —
  // bir üyenin rolü değiştiğinde (uyeRolDegistir) liste otomatik olarak bu
  // sıraya göre yeniden dizilir. Array.prototype.sort kararlı (stable)
  // olduğundan, aynı rol içindeki seçim sırası korunur.
  const siraliUyeler = [...seciliUyeler].sort(
    (a, b) => (a.uyeRol === 'ikincil' ? 1 : 0) - (b.uyeRol === 'ikincil' ? 1 : 0)
  );

  // Nöbet oluşturma artık rol farkı gözetmeden AYNI yolu izliyor: SADECE
  // seciliUyeler'de bilfiil işaretlenmiş kişiler için doğrudan nobetler
  // satırı eklenir — işlemi yapan kişi kendini "Personel Ara"/"Takımlardan
  // Seç" üzerinden ayrıca seçmediyse ona otomatik nöbet atanmaz. Kimin
  // onaylanmış/beklemede/gizli göründüğü (onay_durumu, gosterildi)
  // istemciden bağımsız olarak veritabanındaki nobetler_onay_hesapla
  // trigger'ı tarafından hesaplanır — burada sadece atama_tipi:'manuel'
  // gönderiyoruz, geri kalanını trigger dolduruyor.
  const nobetleriOlustur = async () => {
    if (!seciliTur || !baslangicTarih || seciliUyeler.length === 0) {
      bildirimGoster(t('common.eksikBilgi'), t('nobet.eksikBilgiTurTarihKisi'));
      return;
    }
    if (yoneticiMi && !bitisTarih) {
      bildirimGoster(t('common.eksikBilgi'), t('nobet.eksikBilgiBitisTarihi'));
      return;
    }
    if (!grupAdi.trim() || !aciklama.trim()) {
      bildirimGoster(t('common.eksikBilgi'), t('nobet.eksikBilgiGrupAciklama'));
      return;
    }
    setGonderiliyor(true);

    let grupId = null;
    if (yoneticiMi) {
      const { data: grup, error: grupHata } = await supabase
        .from('nobet_gruplari')
        .insert({
          grup_adi: grupAdi.trim(),
          aciklama: aciklama.trim(),
          nobet_turu_id: seciliTur,
          baslangic_tarih: supabaseTarihFormatla(baslangicTarih),
          bitis_tarih: supabaseTarihFormatla(bitisTarih),
          baslangic_saat: supabaseSaatFormatla(baslangicSaat),
          bitis_saat: supabaseSaatFormatla(bitisSaat),
          olusturan_admin_id: userId,
        })
        .select()
        .single();

      if (grupHata || !grup) {
        setGonderiliyor(false);
        bildirimGoster(t('common.hata'), t('nobet.grubuOlusturulamadi', { mesaj: grupHata ? grupHata.message : '' }));
        return;
      }
      grupId = grup.id;
    }

    // Kayıtlar SADECE seciliUyeler'den oluşturulur — işlemi yapan kişi
    // kendini ayrıca seçmediyse listeye dahil edilmez.
    const kayitlar = seciliUyeler.map((uye) => {
      // "Nöbet Düzeni" listesindeki (uyeRolDegistir ile değiştirilebilen)
      // seçili rol doğrudan kullanılıyor (uye_rolu enum'ı sadece 'birincil'/
      // 'ikincil' değerlerini alıyor, bkz. supabase/schema.sql).
      return {
        personel_id: uye.id,
        nobet_turu_id: seciliTur,
        tarih: supabaseTarihFormatla(baslangicTarih),
        atama_tipi: 'manuel',
        atayan_admin_id: yoneticiMi ? userId : null,
        grup_id: grupId,
        rol: uye.uyeRol === 'ikincil' ? 'ikincil' : 'birincil',
      };
    });

    const { error } = await supabase.from('nobetler').insert(kayitlar);
    setGonderiliyor(false);
    if (error) {
      bildirimGoster(t('common.hata'), t('nobet.nobetOlusturulamadi', { mesaj: error.message }));
      return;
    }

    const isimler = seciliUyeler.map((u) => u.ad_soyad).join(', ');
    const secilenTur = nobetTurleri.find((tr) => tr.id === seciliTur);
    const turIsim = secilenTur?.isim || '';
    islemLogla(
      `${kendiAdSoyad} yeni bir nöbet oluşturdu: ${turIsim} - ${gosterimFormatla(baslangicTarih)}`,
      'nobet_olusturuldu',
      {
        kullanici_adi: kendiAdSoyad,
        nobet_turu_tr: secilenTur?.isim || '',
        nobet_turu_en: secilenTur?.isim_en || '',
        tarih: supabaseTarihFormatla(baslangicTarih),
      }
    );
    bildirimGoster(
      t('common.basarili'),
      yoneticiMi
        ? t('nobet.grupOlusturulduMesaj', { isimler, tarih: gosterimFormatla(baslangicTarih) })
        : t('nobet.onayTalebiGonderildiMesaj', { isimler })
    );
    setSeciliUyeler([]);
    setGrupAdi('');
    setAciklama('');
    setBaslangicTarih(null);
    setBitisTarih(null);
  };

  // Basit loglama: ilgili işlemden hemen sonra çağrılır, ayrı bir trigger
  // sistemi kurulmadan islem_gecmisi'ne tek satır eklenir. islem_aciklamasi
  // her zaman Türkçe düz metin olarak dolduruluyor (geriye dönük uyumluluk);
  // islem_tipi + parametreler ise İşlem Geçmişi'nin ileride o an aktif dilde
  // yeniden kurulabilmesi için ekleniyor. Hata olursa sessizce konsola
  // yazılır — kullanıcı akışını kesmemesi için.
  const islemLogla = async (aciklama, islemTipi, parametreler) => {
    const { error } = await supabase
      .from('islem_gecmisi')
      .insert({ kullanici_id: userId, islem_aciklamasi: aciklama, islem_tipi: islemTipi, parametreler });
    if (error) console.log('HATA (islem_gecmisi):', JSON.stringify(error));
  };

  const sifirla = () => {
    setSeciliUyeler([]);
    setGrupAdi('');
    setAciklama('');
    setBaslangicTarih(null);
    setBitisTarih(null);
    setBaslangicSaat(null);
    setBitisSaat(null);
  };


  const rotasyonAktifDegistir = async (rotasyon) => {
    const { error } = await supabase.from('rotasyonlar').update({ aktif: !rotasyon.aktif }).eq('id', rotasyon.id);
    if (error) {
      bildirimGoster(t('common.hata'), t('rotasyon.guncellemeHatasi', { mesaj: error.message }));
      return;
    }
    rotasyonlariGetir();
  };

  const rotasyonSil = (rotasyon) => {
    Alert.alert(
      t('rotasyon.silOnayBaslik'),
      t('rotasyon.silOnayMesaj', { isim: rotasyon.isim }),
      [
        { text: t('rotasyon.vazgec'), style: 'cancel' },
        {
          text: t('rotasyon.sil'),
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.from('rotasyonlar').delete().eq('id', rotasyon.id);
            if (error) {
              bildirimGoster(t('common.hata'), t('rotasyon.silmeHatasi', { mesaj: error.message }));
              return;
            }
            rotasyonlariGetir();
          },
        },
      ]
    );
  };

  const gunTamIsimleri = t('common.gunTamIsimleri', { returnObjects: true });

  // "Düzenle" — nobet.id ile birlikte hangi rotasyona ait olduğunu (kişi
  // dropdown'ını o rotasyonun takım üyeleriyle sınırlamak için) taşıyoruz.
  const duzenlemeAc = (rotasyonId, nobet) => {
    setDuzenlenenNobet({
      id: nobet.id,
      rotasyonId,
      tarih: nobet.tarih,
      personel_id: nobet.personel_id,
      personelAdi: nobet.personel?.ad_soyad || '',
    });
    const [y, ay, g] = nobet.tarih.split('-').map(Number);
    setDuzenleYeniTarih(new Date(y, ay - 1, g));
    setDuzenleYeniPersonelId(nobet.personel_id);
  };

  const duzenlemeKapat = () => {
    setDuzenlenenNobet(null);
    setDuzenleYeniTarih(null);
    setDuzenleYeniPersonelId(null);
    setDuzenleGosterPicker(false);
  };

  const duzenlemeTarihDegisti = (event, secilenDeger) => {
    setDuzenleGosterPicker(Platform.OS === 'ios' ? duzenleGosterPicker : false);
    if (event.type !== 'set' || !secilenDeger) {
      if (Platform.OS === 'android') setDuzenleGosterPicker(false);
      return;
    }
    setDuzenleYeniTarih(secilenDeger);
    if (Platform.OS === 'android') setDuzenleGosterPicker(false);
  };

  const duzenlemeKaydet = async () => {
    if (!duzenlenenNobet || !duzenleYeniTarih || !duzenleYeniPersonelId) return;
    setDuzenlemeKaydediliyor(true);
    const { error } = await supabase.rpc('nobet_duzenle', {
      p_nobet_id: duzenlenenNobet.id,
      p_yeni_tarih: supabaseTarihFormatla(duzenleYeniTarih),
      p_yeni_personel_id: duzenleYeniPersonelId,
    });
    setDuzenlemeKaydediliyor(false);

    if (error) {
      console.log('HATA (nobet_duzenle):', JSON.stringify(error));
      bildirimGoster(t('common.hata'), t('rotasyon.nobetGuncellenemedi', { mesaj: error.message }));
      return;
    }

    // NobetDuzenleModal.tsx'in (Ana Sayfa) kaydet()'i ile AYNI desen/AYNI
    // islem_tipi ('nobet_duzenlendi') — iki farklı yerden yapılan aynı işlem
    // aynı şekilde loglansın diye. nobet_duzenle() RPC'si sadece bildirimler'e
    // yazıyor (islem_gecmisi'ne dokunmuyor), o yüzden loglama burada, client
    // tarafında yapılıyor.
    const rotasyonBilgisi = rotasyonlar.find((r) => r.id === duzenlenenNobet.rotasyonId);
    islemLogla(
      `${kendiAdSoyad} bir nöbeti düzenledi: ${rotasyonBilgisi?.nobet_turleri?.isim || ''} - ${supabaseTarihFormatla(duzenleYeniTarih)}`,
      'nobet_duzenlendi',
      {
        kullanici_adi: kendiAdSoyad,
        nobet_turu_tr: rotasyonBilgisi?.nobet_turleri?.isim || '',
        nobet_turu_en: rotasyonBilgisi?.nobet_turleri?.isim_en || '',
        tarih: supabaseTarihFormatla(duzenleYeniTarih),
      }
    );

    bildirimGoster(t('common.basarili'), t('rotasyon.nobetGuncellendi'));
    duzenlemeKapat();
    rotasyonlariGetir();
  };

  if (yukleniyor) {
    return (
      <View style={styles.ortala}>
        <ActivityIndicator size="large" color="#0D1C32" />
      </View>
    );
  }

  // Tek Nöbet Düzenleme — anasayfa takviminden (SADECE admin/müdür)
  // ?nobetId=... ile açılır. Form/kaydet/sil mantığı artık burada TEKRAR
  // YAZILMIYOR: anasayfa.tsx'in Ana Sayfa'dan ayrılmadan açtığı pop-up ile
  // AYNI paylaşılan bileşen (components/NobetDuzenleModal.tsx) kullanılıyor.
  // Aşağıdaki normal "Yeni Nöbet Ekle" akışı (manuel/otomatik oluşturma) bu
  // dalda hiç render olmaz.
  if (nobetId) {
    return (
      <NobetDuzenleModal
        visible
        nobetId={nobetId}
        userId={userId}
        kendiAdSoyad={kendiAdSoyad}
        onKapat={() => router.back()}
        onKaydedildi={() => router.back()}
        onSilindi={() => router.back()}
      />
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.icerik}
      refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={yenile} tintColor="#0D1C32" colors={['#0D1C32']} />}
    >
      <Text style={styles.baslik}>{t('nobet.pageBaslik')}</Text>
      <Text style={styles.aciklamaYazi}>
        {yoneticiMi ? t('nobet.aciklamaAdmin') : t('nobet.aciklamaPersonel')}
      </Text>

      {yoneticiMi && (
        <View style={styles.anaSekmeSatiri}>
          <TouchableOpacity
            style={[styles.anaSekmeButon, aktifAnaSekme === 'manuel' && styles.anaSekmeButonAktif]}
            onPress={() => setAktifAnaSekme('manuel')}
          >
            <Text style={[styles.anaSekmeYazi, aktifAnaSekme === 'manuel' && styles.anaSekmeYaziAktif]}>
              {t('nobet.manuelSekmesi')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.anaSekmeButon, aktifAnaSekme === 'otomatik' && styles.anaSekmeButonAktif]}
            onPress={() => setAktifAnaSekme('otomatik')}
          >
            <Text style={[styles.anaSekmeYazi, aktifAnaSekme === 'otomatik' && styles.anaSekmeYaziAktif]}>
              {t('nobet.otomatikSekmesi')}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {aktifAnaSekme === 'otomatik' && yoneticiMi ? (
        <>
          {takimlar.length === 0 ? (
            <View style={styles.kart}>
              <Text style={styles.bosYazi}>{t('rotasyon.takimYok')}</Text>
            </View>
          ) : (
            <View style={styles.kart}>
              {/* "Yeni Rotasyon Oluştur" artık ayrı bir sayfa (nobet/
                  yeni-rotasyon.tsx) — Nöbet sekmesinin kendi stack'i içinde,
                  tab bar kaybolmadan açılıyor. Liste bu sayfadan dönüldüğünde
                  (yukarıdaki useFocusEffect) otomatik güncelleniyor. */}
              <TouchableOpacity style={styles.yeniRotasyonButon} onPress={() => router.push('/nobet/yeni-rotasyon')}>
                <Ionicons name="add-circle-outline" size={18} color="#FFFFFF" />
                <Text style={styles.yeniRotasyonButonYazi}>{t('rotasyon.yeniRotasyon')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {rotasyonYukleniyor ? (
            <ActivityIndicator size="small" color="#0D1C32" style={{ marginVertical: 20 }} />
          ) : (
            <>
              {rotasyonlar.map((rotasyon) => {
                const siraBilgisi = rotasyonSiraVerisi[rotasyon.id];
                const siradakiKisi = (siraBilgisi?.uyeler || []).find((u) => u.id === siraBilgisi?.siradakiId);
                const yaklasanListe = (rotasyonYaklasanNobetler[rotasyon.id] || []).slice(0, 5);
                return (
                  <View key={rotasyon.id} style={styles.kart}>
                    <View style={styles.kartUstSatir}>
                      <Text style={styles.kartBaslik}>{rotasyon.isim}</Text>
                      <View style={styles.rotasyonDurumSatiri}>
                        <Text style={[styles.durumRozetYazi, !rotasyon.aktif && styles.durumRozetYaziPasif]}>
                          {rotasyon.aktif ? t('rotasyon.aktif') : t('rotasyon.pasif')}
                        </Text>
                        <Switch
                          value={rotasyon.aktif}
                          onValueChange={() => rotasyonAktifDegistir(rotasyon)}
                          trackColor={{ false: '#C5C6CD', true: '#0D1C32' }}
                          thumbColor="#FFFFFF"
                        />
                      </View>
                    </View>

                    <Text style={styles.kartAltYazi}>
                      {yerelAdGoster(rotasyon.takimlar?.takim_adi, rotasyon.takimlar?.takim_adi_en)} ·{' '}
                      {t('rotasyon.herGunKurali', { gun: gunTamIsimleri[rotasyon.haftanin_gunu % 7] })} ·{' '}
                      {yerelAdGoster(rotasyon.nobet_turleri?.isim, rotasyon.nobet_turleri?.isim_en)}
                    </Text>

                    {siradakiKisi && (
                      <View style={styles.siradakiSatiri}>
                        <Ionicons name="arrow-forward-circle" size={16} color="#006F64" />
                        <Text style={styles.siradakiYazi}>
                          {t('rotasyon.siradaki')}: <Text style={styles.siradakiIsim}>{siradakiKisi.ad_soyad}</Text>
                        </Text>
                      </View>
                    )}

                    <Text style={[styles.etiket, { marginTop: 12 }]}>{t('rotasyon.yaklasanNobetler')}</Text>
                    {yaklasanListe.length === 0 ? (
                      <Text style={styles.bosYazi}>{t('rotasyon.yaklasanNobetYok')}</Text>
                    ) : (
                      yaklasanListe.map((nobet) => (
                        <View key={nobet.id} style={styles.yaklasanNobetSatiri}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.yaklasanNobetTarih}>{tarihStrGoster(nobet.tarih)}</Text>
                            <Text style={styles.yaklasanNobetKisi}>{nobet.personel?.ad_soyad || ''}</Text>
                          </View>
                          <TouchableOpacity
                            style={styles.duzenleButon}
                            onPress={() => duzenlemeAc(rotasyon.id, nobet)}
                          >
                            <Ionicons name="create-outline" size={16} color="#0D1C32" />
                            <Text style={styles.duzenleButonYazi}>{t('rotasyon.duzenle')}</Text>
                          </TouchableOpacity>
                        </View>
                      ))
                    )}

                    <View style={styles.kartButonSatiri}>
                      <TouchableOpacity style={[styles.silIkonButon, { marginLeft: 'auto' }]} onPress={() => rotasyonSil(rotasyon)}>
                        <Ionicons name="trash-outline" size={18} color="#BA1A1A" />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}

              {rotasyonlar.length === 0 && (
                <View style={styles.kart}>
                  <Text style={styles.bosYazi}>{t('rotasyon.rotasyonYok')}</Text>
                </View>
              )}
            </>
          )}
        </>
      ) : (
      <>
      <View style={styles.kart}>
        <View style={styles.bolumBaslikSatiri}>
          <Ionicons name="time-outline" size={18} color="#006B5F" />
          <Text style={styles.bolumBaslik}>{t('nobet.genelNobetDetaylari')}</Text>
        </View>
        <View style={styles.ayirici} />

        <View style={styles.satirIkili}>
          <View style={{ flex: 1 }}>
            <Text style={styles.etiket}>{t('nobet.baslangicTarihi')}</Text>
            <TouchableOpacity style={styles.inputTikla} onPress={() => pickerAc('baslangicTarih')}>
              <Ionicons name="calendar-outline" size={18} color="#75777E" />
              <Text style={styles.inputYazi}>{gosterimFormatla(baslangicTarih)}</Text>
            </TouchableOpacity>
            {tatilBul(baslangicTarih) && (
              <Text style={styles.tatilUyariYazi}>{t('nobet.resmiTatilEtiket', { aciklama: tatilBul(baslangicTarih).aciklama || '' })}</Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.etiket}>{t('nobet.bitisTarihi')}</Text>
            <TouchableOpacity style={styles.inputTikla} onPress={() => pickerAc('bitisTarih')}>
              <Ionicons name="calendar-outline" size={18} color="#75777E" />
              <Text style={styles.inputYazi}>{gosterimFormatla(bitisTarih)}</Text>
            </TouchableOpacity>
            {tatilBul(bitisTarih) && (
              <Text style={styles.tatilUyariYazi}>{t('nobet.resmiTatilEtiket', { aciklama: tatilBul(bitisTarih).aciklama || '' })}</Text>
            )}
          </View>
        </View>

        <View style={[styles.satirIkili, { marginTop: 12 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.etiket}>{t('nobet.baslangicSaati')}</Text>
            <TouchableOpacity style={styles.inputTikla} onPress={() => pickerAc('baslangicSaat')}>
              <Ionicons name="time-outline" size={18} color="#75777E" />
              <Text style={styles.inputYazi}>{saatFormatla(baslangicSaat)}</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.etiket}>{t('nobet.bitisSaati')}</Text>
            <TouchableOpacity style={styles.inputTikla} onPress={() => pickerAc('bitisSaat')}>
              <Ionicons name="time-outline" size={18} color="#75777E" />
              <Text style={styles.inputYazi}>{saatFormatla(bitisSaat)}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={[styles.etiket, { marginTop: 12 }]}>{t('nobet.nobetTuru')}</Text>
        <View style={styles.turSatiri}>
          {nobetTurleri.map((tur) => (
            <TouchableOpacity
              key={tur.id}
              style={[styles.turButon, seciliTur === tur.id && styles.turButonAktif]}
              onPress={() => setSeciliTur(tur.id)}
            >
              <Text style={[styles.turYazi, seciliTur === tur.id && styles.turYaziAktif]}>
                {yerelAdGoster(tur.isim, tur.isim_en)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {Platform.OS === 'ios' ? (
          <Modal transparent visible={!!gosterPicker} animationType="fade" onRequestClose={pickerIptal}>
            <TouchableOpacity style={styles.pickerArkaPlan} activeOpacity={1} onPress={pickerIptal}>
              <TouchableOpacity activeOpacity={1} style={styles.pickerKart} onPress={() => {}}>
                {gosterPicker && (
                  <DateTimePicker
                    value={pickerGeciciDeger || new Date()}
                    mode={gosterPicker === 'baslangicSaat' || gosterPicker === 'bitisSaat' ? 'time' : 'date'}
                    display="spinner"
                    onChange={(event, secilenDeger) => {
                      if (secilenDeger) setPickerGeciciDeger(secilenDeger);
                    }}
                  />
                )}
                {/* DateTimePicker (spinner/default) resmi tatilleri kendi
                    takviminde renklendirmeyi desteklemiyor; en yakın karşılığı
                    olarak seçili gün tatilse burada canlı olarak belirtiyoruz. */}
                {(gosterPicker === 'baslangicTarih' || gosterPicker === 'bitisTarih') && tatilBul(pickerGeciciDeger) && (
                  <Text style={styles.tatilUyariYazi}>
                    {t('nobet.resmiTatilEtiket', { aciklama: tatilBul(pickerGeciciDeger).aciklama || '' })}
                  </Text>
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
          <>
            {gosterPicker && (gosterPicker === 'baslangicTarih' || gosterPicker === 'bitisTarih') && (
              <DateTimePicker
                value={(gosterPicker === 'baslangicTarih' ? baslangicTarih : bitisTarih) || new Date()}
                mode="date"
                display="default"
                onChange={pickerDegisti}
              />
            )}
            {gosterPicker && (gosterPicker === 'baslangicSaat' || gosterPicker === 'bitisSaat') && (
              <DateTimePicker
                value={(gosterPicker === 'baslangicSaat' ? baslangicSaat : bitisSaat) || new Date()}
                mode="time"
                display="default"
                onChange={pickerDegisti}
              />
            )}
          </>
        )}
      </View>

      <View style={styles.kart}>
        <Text style={styles.etiket}>
          {t('nobet.grupAdi')} <Text style={styles.zorunluYildiz}>*</Text>
        </Text>
        <TextInput style={styles.input} placeholder={t('nobet.grupAdiPlaceholder')} value={grupAdi} onChangeText={setGrupAdi} />
        <Text style={[styles.etiket, { marginTop: 12 }]}>
          {t('nobet.nobetAciklamasi')} <Text style={styles.zorunluYildiz}>*</Text>
        </Text>
        <TextInput
          style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
          placeholder={t('nobet.nobetAciklamasiPlaceholder')}
          value={aciklama}
          onChangeText={setAciklama}
          multiline
        />
      </View>

      <View style={styles.kart}>
        <View style={styles.bolumBaslikSatiri}>
          <Ionicons name="people-outline" size={18} color="#006B5F" />
          <Text style={styles.bolumBaslik}>{t('nobet.ekipVeDetaylar')}</Text>
        </View>
        <View style={styles.ayirici} />

        <View style={styles.sekmeSatiri}>
          <TouchableOpacity
            style={[styles.sekmeButon, aktifSekme === 'ara' && styles.sekmeButonAktif]}
            onPress={() => sekmeDegistir('ara')}
          >
            <Text style={[styles.sekmeYazi, aktifSekme === 'ara' && styles.sekmeYaziAktif]}>{t('nobet.personelAra')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sekmeButon, aktifSekme === 'takim' && styles.sekmeButonAktif]}
            onPress={() => sekmeDegistir('takim')}
          >
            <Text style={[styles.sekmeYazi, aktifSekme === 'takim' && styles.sekmeYaziAktif]}>{t('nobet.takimlardanSec')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sekmeButon, aktifSekme === 'davet' && styles.sekmeButonAktif]}
            onPress={() => sekmeDegistir('davet')}
          >
            <Text style={[styles.sekmeYazi, aktifSekme === 'davet' && styles.sekmeYaziAktif]}>{t('nobet.partnerDavetEt')}</Text>
          </TouchableOpacity>
        </View>

        {aktifSekme === 'ara' && (
          <>
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
            <View style={{ marginTop: 8 }}>
              {personelListesiYukleniyor && <ActivityIndicator size="small" color="#0D1C32" style={{ marginVertical: 20 }} />}
              {filtrelenmisPersonel.map((kisi) => {
                const secili = !!seciliUyeler.find((u) => u.id === kisi.id);
                return (
                  <TouchableOpacity key={kisi.id} style={styles.personelSatiri} onPress={() => uyeToggle(kisi)}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarYazi}>
                        {kisi.ad_soyad ? kisi.ad_soyad.split(' ').map((k) => k[0]).join('').slice(0, 2).toUpperCase() : ''}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.personelIsim}>{kisi.ad_soyad}</Text>
                      <Text style={styles.personelPozisyon}>{yerelAdGoster(kisi.pozisyonlar, kisi.pozisyonlar_en)}</Text>
                    </View>
                    <Ionicons name={secili ? 'checkbox' : 'square-outline'} size={22} color={secili ? '#0D1C32' : '#75777E'} />
                  </TouchableOpacity>
                );
              })}
              {!personelListesiYukleniyor && filtrelenmisPersonel.length === 0 && (
                <Text style={styles.bosYazi}>{t('nobet.personelBulunamadi')}</Text>
              )}
            </View>
          </>
        )}

        {aktifSekme === 'takim' && (
          <View style={{ marginTop: 8 }}>
            {personelListesiYukleniyor && <ActivityIndicator size="small" color="#0D1C32" style={{ marginVertical: 20 }} />}
            {takimlar.map((takim) => {
              const secili = takimSeciliMi(takim.id);
              return (
                <TouchableOpacity
                  key={takim.id}
                  style={[styles.takimSatiri, secili && styles.takimSatiriSecili]}
                  onPress={() => takimSec(takim.id)}
                >
                  <Ionicons name="people" size={18} color="#006B5F" />
                  <Text style={[styles.takimYazi, secili && styles.takimYaziSecili]}>
                    {yerelAdGoster(takim.takim_adi, takim.takim_adi_en)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {aktifSekme === 'davet' && (
          <View style={{ marginTop: 8 }}>
            <Text style={styles.altBaslik}>{t('nobet.davetEdilecekKisiSec')}</Text>
            {personelListesiYukleniyor && <ActivityIndicator size="small" color="#0D1C32" style={{ marginVertical: 20 }} />}
            {personelListesi.map((kisi) => {
              const secili = !!seciliUyeler.find((u) => u.id === kisi.id);
              return (
                <TouchableOpacity key={kisi.id} style={styles.personelSatiri} onPress={() => uyeToggle(kisi)}>
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
                    name="person-add-outline"
                    size={20}
                    color={secili ? '#0D1C32' : '#006B5F'}
                  />
                </TouchableOpacity>
              );
            })}
            {!personelListesiYukleniyor && personelListesi.length === 0 && (
              <Text style={styles.bosYazi}>{t('nobet.personelBulunamadi')}</Text>
            )}
          </View>
        )}
      </View>

      <View style={styles.kart}>
        <View style={styles.bolumBaslikSatiri}>
          <Ionicons name="calendar-outline" size={18} color="#006B5F" />
          <Text style={styles.bolumBaslik}>{t('nobet.nobetDuzeni')}</Text>
        </View>
        <Text style={styles.etiket}>{t('nobet.baslangicNobetSirasi')}</Text>

        {siraliUyeler.length > 0 ? (
          siraliUyeler.map((uye) => (
            <View key={uye.id} style={styles.siraSatiri}>
              <Text style={styles.siraIsim}>{uye.ad_soyad}</Text>
              <TouchableOpacity onPress={() => uyeRolDegistir(uye.id)} style={styles.rolRozet}>
                <Ionicons name="swap-vertical-outline" size={12} color="#006F64" />
                <Text style={styles.rolRozetYazi}>{oncelikEtiketiAl(uye.uyeRol)}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => uyeCikar(uye.id)} style={styles.cikarButon}>
                <Ionicons name="close" size={18} color="#BA1A1A" />
              </TouchableOpacity>
            </View>
          ))
        ) : (
          <Text style={styles.bosYazi}>{t('nobet.siralamakIcinUyeSec')}</Text>
        )}

        <Text style={styles.bilgiNotu}>{t('nobet.oncelikNotu')}</Text>
      </View>

      <View style={styles.altButonSatiri}>
        <TouchableOpacity style={styles.iptalButon} onPress={sifirla}>
          <Text style={styles.iptalButonYazi}>{t('nobet.iptalButon')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.anaButon, { flex: 1 }]}
          onPress={nobetleriOlustur}
          disabled={gonderiliyor}
        >
          <Ionicons name="checkmark-done-outline" size={18} color="#FFFFFF" />
          <Text style={styles.anaButonYazi}>
            {gonderiliyor
              ? t('nobet.gonderiliyor')
              : yoneticiMi
              ? t('nobet.nobetiOlusturButon', { sayi: seciliUyeler.length })
              : t('nobet.talepGonderButon', { sayi: seciliUyeler.length })}
          </Text>
        </TouchableOpacity>
      </View>
      </>
      )}

      <Modal transparent visible={!!duzenlenenNobet} animationType="fade" onRequestClose={duzenlemeKapat}>
        <TouchableOpacity style={styles.duzenleModalArkaPlan} activeOpacity={1} onPress={duzenlemeKapat}>
          <TouchableOpacity activeOpacity={1} style={styles.duzenleModalKart} onPress={() => {}}>
            <View style={styles.duzenleModalBaslikSatiri}>
              <Text style={styles.duzenleModalBaslikYazi}>{t('rotasyon.nobetDuzenle')}</Text>
              <TouchableOpacity onPress={duzenlemeKapat} style={styles.duzenleModalKapatButon}>
                <Ionicons name="close" size={22} color="#75777E" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.duzenleModalScroll}>
              <Text style={styles.etiket}>{t('rotasyon.suankiBilgi')}</Text>
              <Text style={styles.duzenleMevcutYazi}>
                {duzenlenenNobet ? `${tarihStrGoster(duzenlenenNobet.tarih)} · ${duzenlenenNobet.personelAdi}` : ''}
              </Text>

              <Text style={[styles.etiket, { marginTop: 16 }]}>{t('rotasyon.yeniTarih')}</Text>
              {Platform.OS === 'web' ? (
                // @react-native-community/datetimepicker'ın web implementasyonu
                // yok (paket kaynağında src/datetimepicker.js — .ios/.android
                // dışındaki genel fallback — sadece "not supported" uyarısı
                // basıp null render ediyor). Web'de gerçek bir tarayıcı
                // <input type="date"> kullanıyoruz; native'de (iOS/Android)
                // aşağıdaki mevcut DateTimePicker akışı değişmeden çalışıyor.
                <input
                  type="date"
                  value={duzenleYeniTarih ? supabaseTarihFormatla(duzenleYeniTarih) : ''}
                  onChange={(e) => {
                    const deger = e.target.value;
                    if (!deger) return;
                    const [y, ay, g] = deger.split('-').map(Number);
                    setDuzenleYeniTarih(new Date(y, ay - 1, g));
                  }}
                  style={webTarihInputStyle}
                />
              ) : (
                <>
                  <TouchableOpacity style={styles.inputTikla} onPress={() => setDuzenleGosterPicker(true)}>
                    <Ionicons name="calendar-outline" size={18} color="#75777E" />
                    <Text style={styles.inputYazi}>
                      {duzenleYeniTarih ? gosterimFormatla(duzenleYeniTarih) : t('nobet.tarihSec')}
                    </Text>
                  </TouchableOpacity>

                  {Platform.OS === 'ios' ? (
                    <Modal
                      transparent
                      visible={duzenleGosterPicker}
                      animationType="fade"
                      onRequestClose={() => setDuzenleGosterPicker(false)}
                    >
                      <TouchableOpacity
                        style={styles.pickerArkaPlan}
                        activeOpacity={1}
                        onPress={() => setDuzenleGosterPicker(false)}
                      >
                        <TouchableOpacity activeOpacity={1} style={styles.pickerKart} onPress={() => {}}>
                          <DateTimePicker
                            value={duzenleYeniTarih || new Date()}
                            mode="date"
                            display="spinner"
                            onChange={(event, secilenDeger) => {
                              if (secilenDeger) setDuzenleYeniTarih(secilenDeger);
                            }}
                          />
                          <View style={styles.pickerButonSatiri}>
                            <TouchableOpacity style={styles.pickerIptalButon} onPress={() => setDuzenleGosterPicker(false)}>
                              <Text style={styles.pickerIptalYazi}>{t('nobet.iptalButon')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.pickerOnayButon} onPress={() => setDuzenleGosterPicker(false)}>
                              <Text style={styles.pickerOnayYazi}>{t('nobet.tamamButon')}</Text>
                            </TouchableOpacity>
                          </View>
                        </TouchableOpacity>
                      </TouchableOpacity>
                    </Modal>
                  ) : (
                    duzenleGosterPicker && (
                      <DateTimePicker
                        value={duzenleYeniTarih || new Date()}
                        mode="date"
                        display="default"
                        onChange={duzenlemeTarihDegisti}
                      />
                    )
                  )}
                </>
              )}

              <Text style={[styles.etiket, { marginTop: 16 }]}>{t('rotasyon.yeniKisi')}</Text>
              {(rotasyonSiraVerisi[duzenlenenNobet?.rotasyonId]?.uyeler || []).map((uye) => (
                <TouchableOpacity
                  key={uye.id}
                  style={styles.duzenleKisiSatiri}
                  onPress={() => setDuzenleYeniPersonelId(uye.id)}
                >
                  <Text style={styles.duzenleKisiYazi}>{uye.ad_soyad}</Text>
                  <Ionicons
                    name={duzenleYeniPersonelId === uye.id ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={duzenleYeniPersonelId === uye.id ? '#0D1C32' : '#C5C6CD'}
                  />
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={[styles.anaButon, { marginTop: 16 }]}
              onPress={duzenlemeKaydet}
              disabled={duzenlemeKaydediliyor}
            >
              <Text style={styles.anaButonYazi}>
                {duzenlemeKaydediliyor ? t('rotasyon.kaydediliyor') : t('rotasyon.kaydet')}
              </Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
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
  satirIkili: { flexDirection: 'row', gap: 12 },
  etiket: { fontSize: 12, color: '#44474D', marginBottom: 6, fontWeight: '500' },
  zorunluYildiz: { color: '#D92D20' },
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
  input: {
    borderWidth: 1,
    borderColor: '#C5C6CD',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0B1C30',
  },
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
  sekmeSatiri: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  sekmeButon: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#DCE9FF',
    alignItems: 'center',
  },
  sekmeButonAktif: { backgroundColor: '#6DF5E1' },
  sekmeYazi: { fontSize: 12, color: '#44474D', fontWeight: '500' },
  sekmeYaziAktif: { color: '#006F64', fontWeight: '600' },
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
  takimSatiri: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EFF4FF',
  },
  takimSatiriSecili: { backgroundColor: '#EFF4FF' },
  takimYazi: { flex: 1, fontSize: 14, color: '#0B1C30', fontWeight: '500' },
  takimYaziSecili: { fontWeight: '700', color: '#006F64' },
  rolRozet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF4FF',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  rolRozetYazi: { fontSize: 11, color: '#006F64', fontWeight: '600' },
  cikarButon: { padding: 6 },
  altBaslik: { fontSize: 13, fontWeight: '600', color: '#0B1C30', marginBottom: 8 },
  siraSatiri: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EFF4FF',
  },
  siraIsim: { flex: 1, fontSize: 14, fontWeight: '600', color: '#0B1C30' },
  bilgiNotu: { fontSize: 11, color: '#75777E', marginTop: 10 },
  altButonSatiri: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  iptalButon: { paddingVertical: 14, paddingHorizontal: 12 },
  iptalButonYazi: { color: '#75777E', fontSize: 15, fontWeight: '600' },
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
  anaSekmeSatiri: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  anaSekmeButon: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#DCE9FF',
    alignItems: 'center',
  },
  anaSekmeButonAktif: { backgroundColor: '#0D1C32' },
  anaSekmeYazi: { fontSize: 13, color: '#44474D', fontWeight: '600' },
  anaSekmeYaziAktif: { color: '#FFFFFF' },
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
  kartUstSatir: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  kartBaslik: { fontSize: 16, fontWeight: '700', color: '#0B1C30', flexShrink: 1 },
  kartAltYazi: { fontSize: 13, color: '#44474D', marginTop: 2 },
  rotasyonDurumSatiri: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  durumRozetYazi: { fontSize: 11, fontWeight: '600', color: '#006F64' },
  durumRozetYaziPasif: { color: '#75777E' },
  siradakiSatiri: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    backgroundColor: '#EAFBF7',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  siradakiYazi: { fontSize: 13, color: '#44474D' },
  siradakiIsim: { fontWeight: '700', color: '#006F64' },
  kartButonSatiri: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  silIkonButon: {
    padding: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#F6C6C2',
  },
  yaklasanNobetSatiri: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EFF4FF',
  },
  yaklasanNobetTarih: { fontSize: 13, fontWeight: '600', color: '#0B1C30' },
  yaklasanNobetKisi: { fontSize: 12, color: '#44474D', marginTop: 2 },
  duzenleButon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#C5C6CD',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  duzenleButonYazi: { fontSize: 11, fontWeight: '600', color: '#0D1C32' },
  duzenleModalArkaPlan: {
    flex: 1,
    backgroundColor: 'rgba(11, 28, 48, 0.4)',
    justifyContent: 'flex-end',
  },
  duzenleModalKart: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
    maxHeight: '86%',
  },
  duzenleModalScroll: { maxHeight: 420 },
  duzenleModalBaslikSatiri: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  duzenleModalBaslikYazi: { fontSize: 18, fontWeight: '700', color: '#0B1C30' },
  duzenleModalKapatButon: { padding: 4 },
  duzenleMevcutYazi: { fontSize: 14, color: '#0B1C30', fontWeight: '600' },
  duzenleKisiSatiri: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EFF4FF',
  },
  duzenleKisiYazi: { fontSize: 14, color: '#0B1C30', fontWeight: '500' },
});
