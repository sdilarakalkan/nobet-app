import { Ionicons } from '@expo/vector-icons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Modal, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AltPanelModal from '../../components/AltPanelModal';
import NobetDuzenleModal from '../../components/NobetDuzenleModal';
import RotasyonSiraListesi from '../../components/RotasyonSiraListesi';
import { bildirimGoster } from '../../lib/bildirim';
import i18n from '../../lib/i18n';
import { rotasyonSiraListeleriGetir } from '../../lib/rotasyonSirasi';
import { supabase } from '../../lib/supabase';

const tarihStrYap = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const g = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${g}`;
};
const bugunStrYap = () => tarihStrYap(new Date());

// "YYYY-MM-DD" metnini, UTC kaymasına uğramadan yerel tarihe, o an aktif
// dile göre (i18n.language) çevirip gösterir.
const tarihStrGoster = (tarihStr) => {
  if (!tarihStr) return '';
  const [y, m, g] = tarihStr.split('-').map(Number);
  return new Date(y, m - 1, g).toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'tr-TR');
};

const saatStrGoster = (saatStr) => (saatStr ? saatStr.slice(0, 5) : '');

// Bir nöbetin GEÇERLİ saatini döndürür: nobet.saat_baslangic_ozel/
// saat_bitis_ozel (admin/müdür'ün app/(tabs)/nobet.tsx düzenleme ekranından
// elle ayarladığı override, supabase/9-nobet-ozel-saat.sql) doluysa onu,
// boşsa bağlı olduğu nobet_turleri kaydının varsayılan saatini kullanır.
const nobetSaatBaslangicAl = (nobet) => nobet?.saat_baslangic_ozel || nobet?.nobet_turleri?.saat_baslangic;
const nobetSaatBitisAl = (nobet) => nobet?.saat_bitis_ozel || nobet?.nobet_turleri?.saat_bitis;

// Kullanıcı verisi (nöbet türü/pozisyon/takım isimleri) için: aktif dil
// İngilizce ise _en alanını, o da boşsa Türkçesini; Türkçe ise doğrudan
// Türkçesini gösterir.
const yerelAdGoster = (trDeger, enDeger) => (i18n.language === 'en' ? enDeger || trDeger : trDeger) || '';

const bashHarfleri = (adSoyad) =>
  adSoyad ? adSoyad.split(' ').map((k) => k[0]).join('').slice(0, 2).toUpperCase() : '';

// renk_kodu (#RRGGBB) hex'ini parse edip beyaza/siyaha doğru karıştırarak
// rozetler için açık (arka plan) / koyu (yazı) varyantlarını türetir.
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

// Bugünden hedef tarihe kaç gün olduğunu hesaplar (bugün = 0).
const gunFarkiHesapla = (tarihStr) => {
  const [y, m, g] = tarihStr.split('-').map(Number);
  const hedef = new Date(y, m - 1, g);
  hedef.setHours(0, 0, 0, 0);
  const bugun = new Date();
  bugun.setHours(0, 0, 0, 0);
  return Math.round((hedef.getTime() - bugun.getTime()) / 86400000);
};

const haftaSonuMu = (tarih) => tarih.getDay() === 0 || tarih.getDay() === 6;

const takvimHucreleriOlustur = (ay) => {
  const yil = ay.getFullYear();
  const aySira = ay.getMonth();
  const ilkGun = new Date(yil, aySira, 1);
  const sonGun = new Date(yil, aySira + 1, 0);
  const ilkGunSirasi = ilkGun.getDay() === 0 ? 7 : ilkGun.getDay(); // Pazartesi=1 ... Pazar=7
  const hucreler = [];
  for (let i = 1; i < ilkGunSirasi; i++) hucreler.push(null);
  for (let g = 1; g <= sonGun.getDate(); g++) hucreler.push(new Date(yil, aySira, g));
  return hucreler;
};

const zamanGoster = (tarih) =>
  new Date(tarih).toLocaleString(i18n.language === 'en' ? 'en-US' : 'tr-TR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

// Hem admin hem personel dashboard üst satırında kullanılan TEK zil ikonu —
// okunmamış bildirim + bekleyen onay talebi (izin/nöbet onayı/nöbet takası)
// TOPLAM sayısını rozet olarak gösterir, tıklayınca birleşik listeyi açar.
function BildirimZili({ sayi, onPress }) {
  return (
    <TouchableOpacity style={styles.bildirimZili} onPress={onPress}>
      <Ionicons name="notifications-outline" size={26} color="#0B1C30" />
      {sayi > 0 && (
        <View style={styles.bildirimRozet}>
          <Text style={styles.bildirimRozetYazi}>{sayi > 9 ? '9+' : sayi}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function AnaSayfa() {
  const { t } = useTranslation();
  const aylar = t('common.aylar', { returnObjects: true });
  const gunKisaltmalari = t('common.gunKisaltmalari', { returnObjects: true });
  const gunTamIsimleri = t('common.gunTamIsimleri', { returnObjects: true });
  const bugunUzunTarihYaz = () => {
    const d = new Date();
    return `${d.getDate()} ${aylar[d.getMonth()]} ${d.getFullYear()} ${gunTamIsimleri[d.getDay()]}`;
  };

  // islem_tipi doluysa (yeni kayıt) parametreler'den o an aktif dilde
  // cümleyi kurar; boşsa (eski kayıt) islem_aciklamasi'nı olduğu gibi
  // (Türkçe) gösterir.
  const islemCumlesiOlustur = (kayit) => {
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
      case 'nobet_duzenlendi':
        return t('gecmisSablon.nobetDuzenlendi', {
          kullanici: p.kullanici_adi,
          tur: yerelAdGoster(p.nobet_turu_tr, p.nobet_turu_en),
          tarih: tarihStrGoster(p.tarih),
        });
      case 'nobet_silindi':
        return t('gecmisSablon.nobetSilindi', {
          kullanici: p.kullanici_adi,
          silinenKisi: p.silinen_kisi_adi,
          tur: yerelAdGoster(p.nobet_turu_tr, p.nobet_turu_en),
          tarih: tarihStrGoster(p.tarih),
        });
      case 'takas_kabul':
        return t('gecmisSablon.takasKabul', { kullanici: p.kullanici_adi });
      case 'takas_red':
        return t('gecmisSablon.takasRed', { kullanici: p.kullanici_adi });
      case 'izin_onaylandi':
        return t('gecmisSablon.izinOnaylandi', { izinSahibi: p.izin_sahibi_adi });
      case 'izin_reddedildi':
        return t('gecmisSablon.izinReddedildi', { izinSahibi: p.izin_sahibi_adi });
      case 'rotasyon_olusturuldu':
        return t('gecmisSablon.rotasyonOlusturuldu', {
          kullanici: p.kullanici_adi,
          rotasyonAdi: p.rotasyon_adi,
          takimAdi: yerelAdGoster(p.takim_adi_tr, p.takim_adi_en),
          tur: yerelAdGoster(p.nobet_turu_tr, p.nobet_turu_en),
          gun: gunTamIsimleri[p.haftanin_gunu % 7],
        });
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

  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [userId, setUserId] = useState('');
  const [kendiAdSoyad, setKendiAdSoyad] = useState('');
  const [rol, setRol] = useState('personel');

  // ---- Bildirimler + onay talepleri (hem admin hem personel dashboard'unda
  // ORTAK, tek zil/panelde birleşik gösteriliyor — bkz. birlesikBildirimListesi) ----
  const [bildirimler, setBildirimler] = useState([]);
  const [bildirimlerAcik, setBildirimlerAcik] = useState(false);
  const [bildirimlerYukleniyor, setBildirimlerYukleniyor] = useState(false);
  const okunmamisBildirimSayisi = bildirimler.filter((b) => !b.okundu).length;
  // Onay gerektiren (izin/nöbet onayı/takas) taleplerde "okundu" kavramı yok
  // — durum hâlâ 'bekleyen' olduğu sürece rozette sayılmaya devam etmeli.
  // Ama panel bir kez açılıp görüldükten sonra "yeni" vurgusu kalksın diye,
  // panelAc() panelin o anki bekleyen id'lerini bu ref'e yazar (state DEĞİL
  // — sadece render'da okunan, gereksiz re-render'a yol açmayan bir "görüldü"
  // damgası).
  const gorulenBekleyenIdleriRef = useRef(new Set());
  // Kendi (hem admin/müdür hem personel) onay bekleyen nöbet atamaları —
  // eskiden nobet.tsx'te ayrı bir bölümdü, artık sadece burada gösteriliyor.
  const [onayBekleyenNobetler, setOnayBekleyenNobetler] = useState([]);
  const [islemYapilanNobetId, setIslemYapilanNobetId] = useState(null);
  // Kendine gelen nöbet takas talepleri — eskiden degisim.tsx'teki "Gelen
  // Talepler" sekmesindeydi, artık sadece burada gösteriliyor.
  const [gelenTalepler, setGelenTalepler] = useState([]);
  const [islemYapilanTalepId, setIslemYapilanTalepId] = useState(null);

  // ---- Personel Dashboard ----
  const [ayGosterilen, setAyGosterilen] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [ayNobetleri, setAyNobetleri] = useState([]);
  const [ayTatilleri, setAyTatilleri] = useState([]);
  // Takvimde gösterilecek personel_id kapsamı: mudur için null (kapsam yok,
  // herkes görünür), admin/personel için id listesi. Rol/kullanıcı bazlı,
  // sadece bir kere hesaplanır — ay değiştiğinde tekrar sorgulanmaz.
  const [takvimKapsamIdler, setTakvimKapsamIdler] = useState(null);
  const [yaklasanNobetler, setYaklasanNobetler] = useState([]);
  const [seciliGunTarih, setSeciliGunTarih] = useState(null);
  const [kendiRotasyonlar, setKendiRotasyonlar] = useState([]);
  const [kendiRotasyonSiraVerisi, setKendiRotasyonSiraVerisi] = useState({});
  const [kendiRotasyonYukleniyor, setKendiRotasyonYukleniyor] = useState(true);
  // Personel dashboard'undaki "Bugünkü Nöbetler" kartı — takvimin kapsamından
  // (takvimKapsamIdler) BAĞIMSIZ, kendi taramasını kendi yapar (admin
  // dashboard'undaki bugunkuNobetler/adminVerileriGetir ile AYNI yaklaşım).
  const [bugunkuTakimNobetleri, setBugunkuTakimNobetleri] = useState([]);

  // ---- Admin Dashboard ----
  const [toplamPersonel, setToplamPersonel] = useState(0);
  const [bugunkuNobetler, setBugunkuNobetler] = useState([]);
  const [pozisyonMap, setPozisyonMap] = useState({});
  const [bekleyenIzinler, setBekleyenIzinler] = useState([]);
  const [sistemBildirimleri, setSistemBildirimleri] = useState([]);
  const [islemYapilanIzinId, setIslemYapilanIzinId] = useState(null);
  // Gün-detay modalındaki bir nöbete dokununca (SADECE admin/müdür) dolan,
  // NobetDuzenleModal'ı (components/NobetDuzenleModal.tsx) açan id — sayfa
  // değiştirmeden Ana Sayfa üzerinde düzenleme/silme yapılabilmesi için.
  const [duzenlenecekNobetId, setDuzenlenecekNobetId] = useState(null);
  // Gün-detay panelindeki ve "Bugünkü Nöbetler" kartındaki çöp kutusu
  // ikonuyla satır-üstü hızlı silme sırasında, o satırın butonunu devre dışı
  // bırakmak için (çift tıklamayı önler) — modal açmadan doğrudan silme.
  const [silinenNobetId, setSilinenNobetId] = useState(null);

  useEffect(() => {
    (async () => {
      setYukleniyor(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setYukleniyor(false); return; }
      setUserId(user.id);

      const { data: kendi, error } = await supabase
        .from('personel')
        .select('ad_soyad, rol')
        .eq('id', user.id)
        .single();
      if (error) console.log('HATA (personel):', JSON.stringify(error));
      setKendiAdSoyad(kendi?.ad_soyad || '');
      setRol(kendi?.rol || 'personel');

      setYukleniyor(false);
    })();
  }, []);

  // Takvim + gün-detay modalı artık paylaşımlı: müdür (global kapsam) TÜM
  // personelin nöbetini görür; admin ve personel için kapsamIdler (bkz.
  // takvimKapsamiGetir) ile personel_id listesine daraltılır. nobetler'in
  // SELECT RLS'i zaten herkese açık olduğundan daraltma istemci tarafında
  // .in('personel_id', ...) ile yapılıyor. nobetler_gorunur kullanılıyor:
  // pasif bir rotasyona bağlı, henüz gerçekleşmemiş nöbetler burada hiç
  // dönmez (dondurulmuş sayılır) — bkz. 12-rotasyon-dondurma-ve-silme.sql.
  // Kullanıcı ay değiştirdikçe (ayDegistir) bu sorgu her seferinde yeniden
  // çalıştığı için, rotasyonun ürettiği 6 aylık ufkun tamamı gezilebilir.
  const ayVerileriGetir = useCallback(async (mevcutRol, kapsamIdler, ay) => {
    const ilkGun = new Date(ay.getFullYear(), ay.getMonth(), 1);
    const sonGun = new Date(ay.getFullYear(), ay.getMonth() + 1, 0);
    const ilkGunStr = tarihStrYap(ilkGun);
    const sonGunStr = tarihStrYap(sonGun);

    // nobet_turu_id burada ayrıca seçiliyor: takvimdeki gün noktalarını
    // (bkz. takvimKartiRenderla) TÜRE göre gruplamak/sıralamak için — sadece
    // renk_kodu'ya göre gruplamak, aynı renk kullanan farklı türleri
    // yanlışlıkla tek nokta sayardı.
    const nobetTemelSorgu = supabase
      .from('nobetler_gorunur')
      .select('id, tarih, personel_id, nobet_turu_id, saat_baslangic_ozel, saat_bitis_ozel, personel!personel_id ( ad_soyad ), nobet_turleri ( isim, isim_en, renk_kodu, saat_baslangic, saat_bitis )')
      .eq('onay_durumu', 'onaylanan')
      .gte('tarih', ilkGunStr)
      .lte('tarih', sonGunStr);

    const nobetSorgusu =
      mevcutRol === 'mudur'
        ? nobetTemelSorgu
        : kapsamIdler.length > 0
          ? nobetTemelSorgu.in('personel_id', kapsamIdler)
          : Promise.resolve({ data: [], error: null });

    const [nobetSonuc, tatilSonuc] = await Promise.all([
      nobetSorgusu,
      supabase.from('tatil_gunleri').select('tarih, aciklama').gte('tarih', ilkGunStr).lte('tarih', sonGunStr),
    ]);
    if (nobetSonuc.error) console.log('HATA (ay nöbetleri):', JSON.stringify(nobetSonuc.error));
    if (tatilSonuc.error) console.log('HATA (ay tatilleri):', JSON.stringify(tatilSonuc.error));
    setAyNobetleri(nobetSonuc.data || []);
    setAyTatilleri(tatilSonuc.data || []);
  }, []);

  // Takvimin göreceği personel_id kapsamını rol'e göre BİR KERE hesaplar
  // (ay değiştiğinde tekrar çalışmaz): müdür için kapsam yok (null, tüm
  // personel), admin için personel_yonetilen (adminVerileriGetir'daki ile
  // aynı mantık — kendi yönettiği takım(lar)ın üyeleri), personel için
  // personel_takim üzerinden kendi üyesi olduğu takım(lar)ın TÜM üyeleri
  // (kendiRotasyonlariGetir'daki personel_takim sorgusuyla aynı yaklaşım).
  const takvimKapsamiGetir = useCallback(async (uid, mevcutRol) => {
    if (mevcutRol === 'mudur') {
      setTakvimKapsamIdler(null);
      return;
    }

    if (mevcutRol === 'admin') {
      const { data, error } = await supabase.from('personel_yonetilen').select('id');
      if (error) console.log('HATA (personel_yonetilen/takvim kapsamı):', JSON.stringify(error));
      setTakvimKapsamIdler((data || []).map((p) => p.id));
      return;
    }

    const { data: iliskiler, error: iliskiHata } = await supabase
      .from('personel_takim')
      .select('takim_id')
      .eq('personel_id', uid);
    if (iliskiHata) console.log('HATA (personel_takim/takvim kapsamı):', JSON.stringify(iliskiHata));

    const takimIdler = [...new Set((iliskiler || []).map((r) => r.takim_id))];
    if (takimIdler.length === 0) {
      setTakvimKapsamIdler([uid]);
      return;
    }

    const { data: takimUyeleri, error: uyeHata } = await supabase
      .from('personel_takim')
      .select('personel_id')
      .in('takim_id', takimIdler);
    if (uyeHata) console.log('HATA (personel_takim/takım üyeleri):', JSON.stringify(uyeHata));

    const uyeIdler = [...new Set((takimUyeleri || []).map((r) => r.personel_id))];
    setTakvimKapsamIdler(uyeIdler.length > 0 ? uyeIdler : [uid]);
  }, []);

  const yaklasanNobetleriGetir = useCallback(async (uid) => {
    const { data, error } = await supabase
      .from('nobetler_gorunur')
      .select('id, tarih, atama_tipi, atayan_admin_id, saat_baslangic_ozel, saat_bitis_ozel, nobet_turleri ( isim, isim_en, renk_kodu, saat_baslangic, saat_bitis )')
      .eq('personel_id', uid)
      .eq('onay_durumu', 'onaylanan')
      .gte('tarih', bugunStrYap())
      .order('tarih', { ascending: true })
      .limit(11);
    if (error) console.log('HATA (yaklaşan nöbetler):', JSON.stringify(error));
    setYaklasanNobetler(data || []);
  }, []);

  // Personel dashboard'undaki "Bugünkü Nöbetler" kartı — SADECE GÖRÜNTÜLEME,
  // buton yok. Artık kendi nöbetiyle sınırlı DEĞİL: kendi (personel_takim
  // üzerinden) üyesi olduğu takım(lar)ın TÜM üyelerinin bugünkü nöbetlerini
  // gösterir (takvimKapsamiGetir'in personel dalıyla AYNI "takım üyeleri"
  // mantığı, ama takvimin kendisine hiç dokunmadan, kendi bağımsız sorgusuyla
  // — admin dashboard'undaki adminVerileriGetir/bugunkuNobetler ile AYNI
  // desen). nobetler_gorunur kullanılıyor: pasif bir rotasyona bağlı,
  // dondurulmuş nöbetler burada da görünmez.
  const kendiTakimBugunkuNobetleriGetir = useCallback(async (uid) => {
    const { data: iliskiler, error: iliskiHata } = await supabase
      .from('personel_takim')
      .select('takim_id')
      .eq('personel_id', uid);
    if (iliskiHata) console.log('HATA (personel_takim/bugünkü nöbetler kapsamı):', JSON.stringify(iliskiHata));

    const takimIdler = [...new Set((iliskiler || []).map((r) => r.takim_id))];
    if (takimIdler.length === 0) {
      setBugunkuTakimNobetleri([]);
      return;
    }

    const { data: takimUyeleri, error: uyeHata } = await supabase
      .from('personel_takim')
      .select('personel_id')
      .in('takim_id', takimIdler);
    if (uyeHata) console.log('HATA (personel_takim/bugünkü nöbetler takım üyeleri):', JSON.stringify(uyeHata));

    const uyeIdler = [...new Set((takimUyeleri || []).map((r) => r.personel_id))];
    if (uyeIdler.length === 0) {
      setBugunkuTakimNobetleri([]);
      return;
    }

    const { data, error } = await supabase
      .from('nobetler_gorunur')
      .select('id, personel_id, personel:personel_id ( ad_soyad ), nobet_turleri ( isim, isim_en, renk_kodu, saat_baslangic, saat_bitis )')
      .eq('tarih', bugunStrYap())
      .eq('onay_durumu', 'onaylanan')
      .in('personel_id', uyeIdler);
    if (error) console.log('HATA (nobetler_gorunur/bugünkü takım nöbetleri):', JSON.stringify(error));
    setBugunkuTakimNobetleri(data || []);
  }, []);

  // "Nöbet Rotasyonu" kartı — SADECE GÖRÜNTÜLEME. Kendi (personel_takim
  // üzerinden) üyesi olduğu takım(lar)ın AKTİF rotasyon(lar)ını ve sıra
  // listesini gösterir; hiçbir oluşturma/düzenleme butonu yok. rotasyonlar
  // tablosunun SELECT RLS'i (supabase/7-rotasyon-personel-gorunum.sql)
  // personelin kendi takımına genişletildiği için bu sorgu çalışır.
  const kendiRotasyonlariGetir = useCallback(async (uid) => {
    setKendiRotasyonYukleniyor(true);
    const { data: iliskiler, error: iliskiHata } = await supabase
      .from('personel_takim')
      .select('takim_id')
      .eq('personel_id', uid);
    if (iliskiHata) console.log('HATA (personel_takim/kendi takım):', JSON.stringify(iliskiHata));

    const takimIdler = [...new Set((iliskiler || []).map((r) => r.takim_id))];
    if (takimIdler.length === 0) {
      setKendiRotasyonlar([]);
      setKendiRotasyonSiraVerisi({});
      setKendiRotasyonYukleniyor(false);
      return;
    }

    const { data: rotasyonVeri, error: rotasyonHata } = await supabase
      .from('rotasyonlar')
      .select('id, isim, takim_id, haftanin_gunu, mevcut_sira_index, nobet_turleri ( isim, isim_en )')
      .in('takim_id', takimIdler)
      .eq('aktif', true);
    if (rotasyonHata) console.log('HATA (rotasyonlar/kendi):', JSON.stringify(rotasyonHata));

    setKendiRotasyonlar(rotasyonVeri || []);
    setKendiRotasyonSiraVerisi(await rotasyonSiraListeleriGetir(rotasyonVeri || []));
    setKendiRotasyonYukleniyor(false);
  }, []);

  const islemLogla = useCallback(async (aciklama, islemTipi, parametreler) => {
    const { error } = await supabase
      .from('islem_gecmisi')
      .insert({ kullanici_id: userId, islem_aciklamasi: aciklama, islem_tipi: islemTipi, parametreler });
    if (error) console.log('HATA (islem_gecmisi):', JSON.stringify(error));
  }, [userId]);

  // Zil + rozet — hem admin hem personel dashboard'unda ortak. bildirimler'in
  // RLS'i (supabase/8-nobet-duzenleme-bildirimler.sql) zaten personel_id =
  // auth.uid() ile kapsamlı, ekstra filtre gerekmiyor.
  const bildirimleriGetir = useCallback(async (uid) => {
    setBildirimlerYukleniyor(true);
    const { data, error } = await supabase
      .from('bildirimler')
      .select('id, baslik, mesaj, okundu, created_at')
      .eq('personel_id', uid)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) console.log('HATA (bildirimler):', JSON.stringify(error));
    setBildirimler(data || []);
    setBildirimlerYukleniyor(false);
  }, []);

  const bildirimOkunduIsaretle = async (bildirim) => {
    if (bildirim.okundu) return;
    setBildirimler((onceki) => onceki.map((b) => (b.id === bildirim.id ? { ...b, okundu: true } : b)));
    const { error } = await supabase.from('bildirimler').update({ okundu: true }).eq('id', bildirim.id);
    if (error) console.log('HATA (bildirim okundu işaretle):', JSON.stringify(error));
  };

  // Bildirim paneli açılınca TÜM okunmamış bildirimleri toplu olarak
  // okundu=true yapar — kullanıcı her birine tek tek dokunmadan kırmızı
  // rozet düşer (panelAc() tarafından çağrılır). Zaten okundu olanlara
  // dokunmuyor (WHERE okundu=false), yani gereksiz bir UPDATE atmıyor.
  const bildirimleriOkunduIsaretle = useCallback(async (uid) => {
    setBildirimler((onceki) => (onceki.every((b) => b.okundu) ? onceki : onceki.map((b) => ({ ...b, okundu: true }))));
    const { error } = await supabase
      .from('bildirimler')
      .update({ okundu: true })
      .eq('personel_id', uid)
      .eq('okundu', false);
    if (error) console.log('HATA (bildirimleri toplu okundu işaretle):', JSON.stringify(error));
  }, []);

  // Kendine atanmış, henüz kabul/reddedilmemiş ya da onaylanıp da hâlâ
  // "gösterilmedi" işaretli nöbetler — hem admin/müdür hem personel için
  // aynı sorgu (personel_id = kendi id'si). Eskiden nobet.tsx'in kendi
  // onayBekleyenleriGetir'iydi, davranış birebir taşındı.
  const onayBekleyenleriGetir = useCallback(async (uid) => {
    const { data, error } = await supabase
      .from('nobetler_gorunur')
      .select('id, tarih, onay_durumu, saat_baslangic_ozel, saat_bitis_ozel, created_at, nobet_turleri ( isim, isim_en, renk_kodu, saat_baslangic, saat_bitis )')
      .eq('personel_id', uid)
      .eq('gosterildi', false)
      .order('tarih', { ascending: true });
    if (error) console.log('HATA (nobetler/onay bekleyen):', JSON.stringify(error));
    setOnayBekleyenNobetler(data || []);
  }, []);

  // Kendine gelen, henüz karar verilmemiş nöbet takas talepleri. Eskiden
  // degisim.tsx'in kendi gelenTalepleriGetir'iydi; SADECE 'bekleyen' olanlar
  // çekiliyor (kabul/reddedilmiş eski talepler artık burada gösterilmiyor).
  const gelenTalepleriGetir = useCallback(async (uid) => {
    const { data, error } = await supabase
      .from('degisim_talepleri')
      .select(
        `id, durum, mesaj, created_at,
         nobetler ( tarih, nobet_turleri ( isim, isim_en, renk_kodu ) ),
         talep_eden:personel!talep_eden_personel_id ( ad_soyad )`
      )
      .eq('hedef_personel_id', uid)
      .eq('durum', 'bekleyen')
      .order('created_at', { ascending: false });
    if (error) console.log('HATA (degisim_talepleri):', JSON.stringify(error));
    setGelenTalepler(data || []);
  }, []);

  const adminVerileriGetir = useCallback(async () => {
    const bugun = bugunStrYap();

    // personel_detay (tüm şirket) DEĞİL, personel_yonetilen: global admin
    // için herkes, Ekip Şefi (admin_kapsam='takim') için sadece yönettiği
    // takım(lar)ın üyeleri. "Toplam Personel" ve "Bugünkü Nöbetler" bu
    // listeye göre kapsamlanıyor. nobetler'in kendi SELECT RLS'i hâlâ
    // herkese açık (paylaşımlı takvim) olduğundan, "Bugünkü Nöbetler"i
    // takıma göre daraltmak istemciden .in(personel_id, ...) ile yapılıyor.
    const { data: yonetilenPersonel, error: yonetilenHata } = await supabase
      .from('personel_yonetilen')
      .select('id, pozisyonlar, pozisyonlar_en');
    if (yonetilenHata) console.log('HATA (personel_yonetilen):', JSON.stringify(yonetilenHata));

    const yonetilenIdler = (yonetilenPersonel || []).map((p) => p.id);
    const pozMap = {};
    (yonetilenPersonel || []).forEach((d) => { pozMap[d.id] = { tr: d.pozisyonlar, en: d.pozisyonlar_en }; });
    setPozisyonMap(pozMap);
    setToplamPersonel(yonetilenIdler.length);

    const [nobetSonuc, izinSonuc, gecmisSonuc] = await Promise.all([
      yonetilenIdler.length > 0
        ? supabase
            .from('nobetler_gorunur')
            .select('id, tarih, personel_id, saat_baslangic_ozel, saat_bitis_ozel, personel!personel_id ( ad_soyad ), nobet_turleri ( isim, isim_en, renk_kodu, saat_baslangic, saat_bitis )')
            .eq('tarih', bugun)
            .eq('onay_durumu', 'onaylanan')
            .in('personel_id', yonetilenIdler)
        : Promise.resolve({ data: [], error: null }),
      // izin_talepleri'nin kendi RLS'i (schema tarafında) zaten admin_kapsam'a
      // göre daraltıldı — Ekip Şefi burada zaten sadece kendi takımının
      // taleplerini görür, ekstra filtre gerekmiyor.
      supabase
        .from('izin_talepleri')
        .select('id, baslangic_tarih, bitis_tarih, sebep, created_at, personel ( ad_soyad )')
        .eq('durum', 'bekleyen')
        .order('created_at', { ascending: false }),
      supabase
        .from('islem_gecmisi')
        .select('id, islem_aciklamasi, islem_tipi, parametreler, tarih, personel ( ad_soyad )')
        .order('tarih', { ascending: false })
        .limit(10),
    ]);

    if (nobetSonuc.error) console.log('HATA (bugünkü nöbetler):', JSON.stringify(nobetSonuc.error));
    if (izinSonuc.error) console.log('HATA (izin_talepleri):', JSON.stringify(izinSonuc.error));
    if (gecmisSonuc.error) console.log('HATA (islem_gecmisi):', JSON.stringify(gecmisSonuc.error));

    setBugunkuNobetler(nobetSonuc.data || []);
    setBekleyenIzinler(izinSonuc.data || []);
    setSistemBildirimleri(gecmisSonuc.data || []);
  }, []);

  // Bildirimler + onay bekleyen talepler: mount'ta olduğu gibi, Ana Sayfa'ya
  // her dönüşte de (ör. başka bir sekmede bir talebe karar verilip geri
  // dönüldüğünde) güncel kalsın diye sadece useEffect değil, useFocusEffect
  // kullanılıyor.
  useFocusEffect(
    useCallback(() => {
      if (userId) bildirimleriGetir(userId);
    }, [userId, bildirimleriGetir])
  );

  useFocusEffect(
    useCallback(() => {
      if (userId) onayBekleyenleriGetir(userId);
    }, [userId, onayBekleyenleriGetir])
  );

  useFocusEffect(
    useCallback(() => {
      if (userId) gelenTalepleriGetir(userId);
    }, [userId, gelenTalepleriGetir])
  );

  // Takvim kapsamı (hangi personel_id'lerin görüneceği) rol'e bağlı, sık
  // değişmeyen bir veri — sadece bir kere hesaplanır, odaklanma başına
  // tekrar sorgulanmaz.
  useEffect(() => {
    if (userId && rol) takvimKapsamiGetir(userId, rol);
  }, [userId, rol, takvimKapsamiGetir]);

  // Takvimdeki (ve gün-detay modalındaki) nöbetler — ör. Nöbet sekmesinde
  // yeni bir nöbet oluşturulup Ana Sayfa'ya dönüldüğünde burada hemen
  // görünsün diye Ana Sayfa her odaklandığında yeniden çekiliyor.
  useFocusEffect(
    useCallback(() => {
      if (!userId || !rol) return;
      // mudur hariç, kapsam (takvimKapsamiGetir) yüklenene kadar bekle.
      if (rol !== 'mudur' && takvimKapsamIdler === null) return;
      ayVerileriGetir(rol, takvimKapsamIdler || [], ayGosterilen);
    }, [userId, rol, takvimKapsamIdler, ayGosterilen, ayVerileriGetir])
  );

  // Personel dashboard'undaki "Sıradaki Nöbet"/"Gelecek Nöbetler" kartları —
  // aynı sebeple (yeni oluşturulan bir nöbet hemen görünsün) odaklanma
  // bazlı yenileniyor.
  useFocusEffect(
    useCallback(() => {
      if (rol === 'personel' && userId) yaklasanNobetleriGetir(userId);
    }, [rol, userId, yaklasanNobetleriGetir])
  );

  // "Bugünkü Nöbetler" kartı (takım-geneli) — aynı sebeple odaklanma bazlı.
  useFocusEffect(
    useCallback(() => {
      if (rol === 'personel' && userId) kendiTakimBugunkuNobetleriGetir(userId);
    }, [rol, userId, kendiTakimBugunkuNobetleriGetir])
  );

  // "Nöbet Rotasyonu" kartı Ana Sayfa'ya her dönüşte (ör. Nöbet sekmesinde
  // bir rotasyon aktif/pasif yapılıp geri dönüldüğünde) güncel kalsın diye
  // sadece mount'ta değil, ekran her odaklandığında yeniden çekiliyor.
  useFocusEffect(
    useCallback(() => {
      if (rol === 'personel' && userId) kendiRotasyonlariGetir(userId);
    }, [rol, userId, kendiRotasyonlariGetir])
  );

  // Müdür (rol='mudur', eski admin_kapsam='global' karşılığı) ve Takım
  // Admini (rol='admin') aynı yönetici dashboard'unu kullanır — veri kapsamı
  // is_global_admin()/is_takim_admin() ile RLS ve personel_yonetilen view'ı
  // üzerinden zaten otomatik ayrılıyor, burada ekstra dallanma gerekmiyor.
  const yoneticiMi = rol === 'admin' || rol === 'mudur';

  // Admin dashboard'undaki "Bugünkü Nöbetler"/"Bekleyen Talepler" — aynı
  // sebeple (yeni oluşturulan bir nöbet hemen görünsün) odaklanma bazlı.
  useFocusEffect(
    useCallback(() => {
      if (yoneticiMi && userId) adminVerileriGetir();
    }, [yoneticiMi, userId, adminVerileriGetir])
  );

  // Aşağı çekerek yenileme (pull-to-refresh): ekrandaki TÜM ana verileri
  // (bildirimler, onay talepleri, takvim, rol'e göre admin/personel'e özel
  // kartlar) yeniden çeker.
  const yenile = async () => {
    if (!userId) return;
    setYenileniyor(true);
    const gorevler = [bildirimleriGetir(userId), onayBekleyenleriGetir(userId), gelenTalepleriGetir(userId)];
    if (rol === 'mudur' || takvimKapsamIdler !== null) {
      gorevler.push(ayVerileriGetir(rol, takvimKapsamIdler || [], ayGosterilen));
    }
    if (rol === 'personel') {
      gorevler.push(yaklasanNobetleriGetir(userId), kendiRotasyonlariGetir(userId), kendiTakimBugunkuNobetleriGetir(userId));
    }
    if (yoneticiMi) {
      gorevler.push(adminVerileriGetir());
    }
    await Promise.all(gorevler);
    setYenileniyor(false);
  };

  const ayDegistir = (delta) => {
    setAyGosterilen((onceki) => new Date(onceki.getFullYear(), onceki.getMonth() + delta, 1));
  };

  const seciliGunTarihStr = seciliGunTarih ? tarihStrYap(seciliGunTarih) : null;
  // Paylaşımlı takvim: o gün nöbeti olan TÜM personel (tek kişi değil).
  const seciliGunNobetleri = seciliGunTarihStr ? ayNobetleri.filter((n) => n.tarih === seciliGunTarihStr) : [];
  const seciliGunTatil = seciliGunTarihStr ? ayTatilleri.find((t) => t.tarih === seciliGunTarihStr) : null;
  const gunModalBasligi = seciliGunTarih
    ? `${seciliGunTarih.getDate()} ${aylar[seciliGunTarih.getMonth()]} ${gunTamIsimleri[seciliGunTarih.getDay()]}`
    : '';

  // "Nöbet Değiştir" sadece giriş yapan kullanıcının KENDİ nöbeti için
  // gösterilir/çalışır — başkasının nöbeti bilgi amaçlı görünür.
  const nobetDegistirmeyeGit = (nobetId) => {
    setSeciliGunTarih(null);
    router.push({ pathname: '/degisim', params: { nobetId: String(nobetId) } });
  };

  // SADECE admin/müdür (yoneticiMi) — gün-detay modalındaki bir nöbet
  // satırına dokununca artık başka sayfaya GİTMEZ; gün-detay modalını kapatıp
  // NobetDuzenleModal'ı (components/NobetDuzenleModal.tsx) bu nöbetin
  // id'siyle açar — kullanıcı Ana Sayfa'dan hiç ayrılmadan tarih/tür/saat/
  // personel değiştirebilir veya nöbeti silebilir.
  const nobetDuzenlemeyeGit = (nobet) => {
    setSeciliGunTarih(null);
    setDuzenlenecekNobetId(nobet.id);
  };

  const duzenlemeModaliKapat = () => setDuzenlenecekNobetId(null);

  // Kaydetme/silme başarılı olduğunda: modalı kapat, takvim verisini
  // (ayNobetleri/ayTatilleri) ve — değişen/silinen nöbet bugüne aitse —
  // "Bugünkü Nöbetler" kartını da güncel duruma göre tazele.
  const duzenlemeSonrasiTazele = () => {
    setDuzenlenecekNobetId(null);
    ayVerileriGetir(rol, takvimKapsamIdler || [], ayGosterilen);
    if (yoneticiMi) adminVerileriGetir();
  };

  // Gün-detay panelindeki ve "Bugünkü Nöbetler" kartındaki çöp kutusu
  // ikonuyla, modal açmadan doğrudan hızlı silme — nobet_duzenle ile AYNI
  // desende bir RPC'ye (nobet_sil, supabase/13-nobet-sil.sql) gidiyor, ASLA
  // doğrudan nobetler.delete() çağrılmıyor. RPC etkilenen kişiye bildirim
  // düşürür; rotasyon kaynaklı bir nöbet olsa bile SADECE o günü siler,
  // rotasyonun kendisine dokunmaz. Silme başarılı olunca takvim + "Bugünkü
  // Nöbetler" kartı tazelenir (Yaklaşan Nöbetler için ayrı bir ekran —
  // nobet.tsx'in rotasyon kartları/kendi profili — zaten odaklanma bazlı
  // (useFocusEffect) tazelendiğinden buradan ekstra bir şey yapmaya gerek
  // yok).
  const nobetSil = (nobet) => {
    Alert.alert(
      t('anasayfa.nobetSilOnayBaslik'),
      t('anasayfa.nobetSilOnayMesaj'),
      [
        { text: t('nobet.iptalButon'), style: 'cancel' },
        {
          text: t('anasayfa.sil'),
          style: 'destructive',
          onPress: async () => {
            setSilinenNobetId(nobet.id);
            const { error } = await supabase.rpc('nobet_sil', { p_nobet_id: nobet.id });
            setSilinenNobetId(null);
            if (error) {
              bildirimGoster(t('common.hata'), t('anasayfa.nobetSilinemedi', { mesaj: error.message }));
              return;
            }
            await islemLogla(
              `${kendiAdSoyad} ${nobet.personel?.ad_soyad || ''} için bir nöbeti sildi: ${yerelAdGoster(nobet.nobet_turleri?.isim, nobet.nobet_turleri?.isim_en)} - ${tarihStrGoster(nobet.tarih)}`,
              'nobet_silindi',
              {
                kullanici_adi: kendiAdSoyad,
                silinen_kisi_adi: nobet.personel?.ad_soyad || '',
                nobet_turu_tr: nobet.nobet_turleri?.isim || '',
                nobet_turu_en: nobet.nobet_turleri?.isim_en || '',
                tarih: nobet.tarih,
              }
            );
            ayVerileriGetir(rol, takvimKapsamIdler || [], ayGosterilen);
            if (yoneticiMi) adminVerileriGetir();
          },
        },
      ]
    );
  };

  const izinKarariVer = async (izin, yeniDurum) => {
    setIslemYapilanIzinId(izin.id);
    const { error } = await supabase.from('izin_talepleri').update({ durum: yeniDurum }).eq('id', izin.id);
    setIslemYapilanIzinId(null);
    if (error) {
      bildirimGoster(t('common.hata'), t('anasayfa.islemBasarisiz', { mesaj: error.message }));
      return;
    }
    const izinSahibiAdi = izin.personel?.ad_soyad || 'bir personelin';
    await islemLogla(
      `Admin ${izinSahibiAdi}'nın izin talebini ${yeniDurum === 'onaylanan' ? 'onayladı' : 'reddetti'}`,
      yeniDurum === 'onaylanan' ? 'izin_onaylandi' : 'izin_reddedildi',
      { izin_sahibi_adi: izinSahibiAdi }
    );
    setBekleyenIzinler((onceki) => onceki.filter((i) => i.id !== izin.id));
    adminVerileriGetir();
  };

  // Onay bekleyen nöbet atamaları — eskiden nobet.tsx'teydi, davranış
  // (kabul/reddet/kapat) birebir taşındı.
  const nobetKabulEt = async (nobetId) => {
    setIslemYapilanNobetId(nobetId);
    const { error } = await supabase
      .from('nobetler')
      .update({ onay_durumu: 'onaylanan', gosterildi: true })
      .eq('id', nobetId);
    setIslemYapilanNobetId(null);
    if (error) {
      bildirimGoster(t('common.hata'), t('nobet.nobetKabulEdilemedi', { mesaj: error.message }));
      return;
    }
    islemLogla(`${kendiAdSoyad} nöbet atamasını onayladı`, 'nobet_onaylandi', { kullanici_adi: kendiAdSoyad });
    setOnayBekleyenNobetler((onceki) => onceki.filter((n) => n.id !== nobetId));
  };

  const nobetReddet = async (nobetId) => {
    setIslemYapilanNobetId(nobetId);
    const { error } = await supabase.from('nobetler').delete().eq('id', nobetId);
    setIslemYapilanNobetId(null);
    if (error) {
      bildirimGoster(t('common.hata'), t('nobet.nobetReddedilemedi', { mesaj: error.message }));
      return;
    }
    islemLogla(`${kendiAdSoyad} nöbet atamasını reddetti`, 'nobet_reddedildi', { kullanici_adi: kendiAdSoyad });
    setOnayBekleyenNobetler((onceki) => onceki.filter((n) => n.id !== nobetId));
  };

  const nobetKapat = async (nobetId) => {
    setIslemYapilanNobetId(nobetId);
    const { error } = await supabase.from('nobetler').update({ gosterildi: true }).eq('id', nobetId);
    setIslemYapilanNobetId(null);
    if (error) {
      bildirimGoster(t('common.hata'), t('nobet.islemBasarisiz', { mesaj: error.message }));
      return;
    }
    setOnayBekleyenNobetler((onceki) => onceki.filter((n) => n.id !== nobetId));
  };

  // Gelen nöbet takas talepleri — eskiden degisim.tsx'teydi, davranış
  // (kabul/reddet) birebir taşındı.
  const talebiKabulEt = async (talepId) => {
    setIslemYapilanTalepId(talepId);
    const { error } = await supabase.rpc('degisim_talebini_kabul_et', { p_talep_id: talepId });
    setIslemYapilanTalepId(null);
    if (error) {
      bildirimGoster(t('common.hata'), t('degisim.talepKabulEdilemedi', { mesaj: error.message }));
      return;
    }
    islemLogla(`${kendiAdSoyad} nöbet takas talebini kabul etti`, 'takas_kabul', { kullanici_adi: kendiAdSoyad });
    setGelenTalepler((onceki) => onceki.filter((t) => t.id !== talepId));
  };

  const talebiReddet = async (talepId) => {
    setIslemYapilanTalepId(talepId);
    const { error } = await supabase.from('degisim_talepleri').update({ durum: 'reddedilen' }).eq('id', talepId);
    setIslemYapilanTalepId(null);
    if (error) {
      bildirimGoster(t('common.hata'), t('degisim.talepReddedilemedi', { mesaj: error.message }));
      return;
    }
    islemLogla(`${kendiAdSoyad} nöbet takas talebini reddetti`, 'takas_red', { kullanici_adi: kendiAdSoyad });
    setGelenTalepler((onceki) => onceki.filter((t) => t.id !== talepId));
  };

  const takasAciklamaCumlesi = (talep) => {
    const ad = talep.talep_eden?.ad_soyad || t('degisim.birPersonel');
    const tarih = talep.nobetler ? tarihStrGoster(talep.nobetler.tarih) : '';
    const tur = yerelAdGoster(talep.nobetler?.nobet_turleri?.isim, talep.nobetler?.nobet_turleri?.isim_en);
    return t('degisim.aciklamaCumlesi', { ad, tarih, tur });
  };

  const atamaBadgeAl = (nobet) => {
    if (nobet.atayan_admin_id) return { icon: 'admin-panel-settings', metin: t('anasayfa.adminAtamasi') };
    if (nobet.atama_tipi === 'otomatik') return { icon: 'auto-awesome', metin: t('anasayfa.otomatikAtandi') };
    return null;
  };

  const nobetKartiRenderla = (nobet, buyukKart) => {
    const renk = nobet.nobet_turleri?.renk_kodu || '#75777E';
    const gun = gunFarkiHesapla(nobet.tarih);
    const kalanYazi = gun === 0 ? t('anasayfa.bugun') : gun === 1 ? t('anasayfa.yarin') : t('anasayfa.gunKaldi', { gun });
    const badge = atamaBadgeAl(nobet);
    return (
      <View key={nobet.id} style={[styles.nobetKartKucuk, buyukKart && styles.nobetKartBuyuk]}>
        <View style={styles.nobetKartUstSatir}>
          <View style={styles.nobetKartSolGrup}>
            <View style={[styles.renkNoktasi, { backgroundColor: renk }]} />
            <Text style={styles.nobetTuruYazi}>
              {yerelAdGoster(nobet.nobet_turleri?.isim, nobet.nobet_turleri?.isim_en) || t('anasayfa.nobetVarsayilan')}
            </Text>
          </View>
          <View style={[styles.saatRozeti, { backgroundColor: renkAcikTon(renk) }]}>
            <Text style={[styles.saatRozetiYazi, { color: renkKoyuTon(renk) }]}>
              {saatStrGoster(nobetSaatBaslangicAl(nobet))} - {saatStrGoster(nobetSaatBitisAl(nobet))}
            </Text>
          </View>
        </View>
        <View style={styles.nobetKartAltSatir}>
          <Text style={styles.nobetTarihYazi}>{tarihStrGoster(nobet.tarih)}</Text>
          <Text style={[styles.kalanGunYazi, buyukKart && styles.kalanGunYaziBuyuk]}>{kalanYazi}</Text>
        </View>
        {badge && (
          <View style={styles.atamaBadgeSatiri}>
            <MaterialIcons name={badge.icon} size={14} color="#44474D" />
            <Text style={styles.atamaBadgeYazi}>{badge.metin}</Text>
          </View>
        )}
      </View>
    );
  };

  // Zil paneli TEK bir birleşik listede akar: normal bildirimler + bekleyen
  // onay talepleri (izin/nöbet onayı/nöbet takası), en yeniden eskiye
  // (created_at'e göre). Her rol sadece kendi görebileceği veriyi görür —
  // bekleyenIzinler zaten sadece admin/müdür için doluyor (adminVerileriGetir
  // yoneticiMi'ye özel), diğer ikisi personel_id/hedef_personel_id = kendi
  // id'si filtresiyle zaten kendi kapsamına daralıyor; burada ekstra bir
  // yetki kontrolüne gerek yok.
  const birlesikBildirimListesi = [
    ...bildirimler.map((veri) => ({ tur: 'bildirim', veri, zaman: veri.created_at })),
    ...bekleyenIzinler.map((veri) => ({ tur: 'izin_talebi', veri, zaman: veri.created_at })),
    ...onayBekleyenNobetler.map((veri) => ({ tur: 'nobet_onay', veri, zaman: veri.created_at })),
    ...gelenTalepler.map((veri) => ({ tur: 'degisim_talebi', veri, zaman: veri.created_at })),
  ].sort((a, b) => new Date(b.zaman) - new Date(a.zaman));

  // onayBekleyenNobetler İKİ türü karışık tutar: gerçekten onay bekleyen
  // (onay_durumu='bekleyen') VE sadece "gösterilmedi" işaretli, zaten onaylı/
  // bilgilendirme amaçlı atamalar (ör. Müdür'ün doğrudan atadığı, ekstra bir
  // işlem gerektirmeyen nöbet). Rozet SADECE gerçekten yanıt bekleyenleri
  // saymalı — bilgilendirme amaçlı olanlar "Kapat" ile kullanıcı kendi
  // zamanında kapatana kadar listede kalsın ama kırmızı sayıyı şişirmesin.
  const gercektenBekleyenNobetleri = onayBekleyenNobetler.filter((n) => n.onay_durumu === 'bekleyen');
  const bekleyenTalepSayisi = bekleyenIzinler.length + gercektenBekleyenNobetleri.length + gelenTalepler.length;
  const bildirimZiliSayisi = okunmamisBildirimSayisi + bekleyenTalepSayisi;

  // Zil'e tıklanınca: panel açılır (1) VE bu anda yanıt bekleyen (izin/nöbet
  // onayı/takas) taleplerin id'leri "görüldü" damgalanır (2) — rozetteki sayı
  // durum hâlâ 'bekleyen' olduğu sürece AYNI kalır (item 3'teki kural), ama
  // kartlardaki "yeni" vurgusu (bkz. birlesikTurEtiketiRenderla) kalkar.
  // bildirimler tablosu için ayrıca gerçek bir okundu=true toplu güncellemesi
  // de burada tetiklenir (bildirimleriOkunduIsaretle).
  const panelAc = () => {
    gorulenBekleyenIdleriRef.current = new Set([
      ...bekleyenIzinler.map((i) => `izin-${i.id}`),
      ...gercektenBekleyenNobetleri.map((n) => `nobet-${n.id}`),
      ...gelenTalepler.map((t) => `takas-${t.id}`),
    ]);
    setBildirimlerAcik(true);
    if (userId) bildirimleriOkunduIsaretle(userId);
  };

  const birlesikTurEtiketiRenderla = (icon, renk, etiket, yeni = false) => (
    <View style={styles.birlesikTurSatiri}>
      <Ionicons name={icon} size={12} color={renk} />
      <Text style={[styles.birlesikTurYazi, { color: renk }]}>{etiket}</Text>
      {yeni && <View style={styles.yeniNoktasi} />}
    </View>
  );

  const birlesikOgeRenderla = (oge) => {
    if (oge.tur === 'bildirim') {
      const b = oge.veri;
      return (
        <TouchableOpacity
          key={`bildirim-${b.id}`}
          style={[styles.bildirimSatiri, !b.okundu && styles.bildirimSatiriOkunmamis]}
          onPress={() => bildirimOkunduIsaretle(b)}
        >
          {!b.okundu && <View style={styles.bildirimNoktasi} />}
          <View style={{ flex: 1 }}>
            {birlesikTurEtiketiRenderla('notifications-outline', '#75777E', t('anasayfa.turBildirim'))}
            <Text style={styles.satirBaslik}>{b.baslik}</Text>
            <Text style={styles.satirAltYazi}>{b.mesaj}</Text>
            <Text style={styles.zamanCizelgeZaman}>{zamanGoster(b.created_at)}</Text>
          </View>
        </TouchableOpacity>
      );
    }

    if (oge.tur === 'izin_talebi') {
      const izin = oge.veri;
      return (
        <View key={`izin-${izin.id}`} style={styles.izinKarti}>
          {birlesikTurEtiketiRenderla(
            'hourglass-outline',
            '#BA1A1A',
            t('anasayfa.turIzinTalebi'),
            !gorulenBekleyenIdleriRef.current.has(`izin-${izin.id}`)
          )}
          <Text style={styles.satirBaslik}>{izin.personel?.ad_soyad || t('anasayfa.birPersonel')}</Text>
          <Text style={styles.satirAltYazi}>
            {tarihStrGoster(izin.baslangic_tarih)} - {tarihStrGoster(izin.bitis_tarih)}
          </Text>
          {izin.sebep ? <Text style={styles.izinSebep}>{izin.sebep}</Text> : null}
          <View style={styles.talepButonSatiri}>
            <TouchableOpacity
              style={[styles.reddetButon, { flex: 1 }]}
              onPress={() => izinKarariVer(izin, 'reddedilen')}
              disabled={islemYapilanIzinId === izin.id}
            >
              <Text style={styles.reddetButonYazi}>{t('anasayfa.reddet')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.anaButon, { flex: 1 }]}
              onPress={() => izinKarariVer(izin, 'onaylanan')}
              disabled={islemYapilanIzinId === izin.id}
            >
              <Text style={styles.anaButonYazi}>
                {islemYapilanIzinId === izin.id ? t('anasayfa.isleniyor') : t('anasayfa.onayla')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    if (oge.tur === 'nobet_onay') {
      const nobet = oge.veri;
      return (
        <View key={`nobet-${nobet.id}`} style={styles.onaySatiri}>
          <View style={[styles.renkNoktasi, { backgroundColor: nobet.nobet_turleri?.renk_kodu || '#75777E' }]} />
          <View style={{ flex: 1 }}>
            {birlesikTurEtiketiRenderla(
              'alert-circle-outline',
              '#BA1A1A',
              t('anasayfa.turNobetOnayi'),
              nobet.onay_durumu === 'bekleyen' && !gorulenBekleyenIdleriRef.current.has(`nobet-${nobet.id}`)
            )}
            <Text style={styles.satirBaslik}>
              {yerelAdGoster(nobet.nobet_turleri?.isim, nobet.nobet_turleri?.isim_en) || t('anasayfa.nobetVarsayilan')}
            </Text>
            <Text style={styles.satirAltYazi}>
              {tarihStrGoster(nobet.tarih)} · {saatStrGoster(nobetSaatBaslangicAl(nobet))}-
              {saatStrGoster(nobetSaatBitisAl(nobet))}
            </Text>
          </View>

          {nobet.onay_durumu === 'bekleyen' ? (
            <View style={styles.onayButonSatiri}>
              <TouchableOpacity
                style={styles.reddetButonKucuk}
                onPress={() => nobetReddet(nobet.id)}
                disabled={islemYapilanNobetId === nobet.id}
              >
                <Text style={styles.reddetButonKucukYazi}>{t('nobet.reddet')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.kabulButonKucuk}
                onPress={() => nobetKabulEt(nobet.id)}
                disabled={islemYapilanNobetId === nobet.id}
              >
                <Text style={styles.kabulButonKucukYazi}>{t('nobet.kabulEt')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.onayButonSatiri}>
              <Text style={styles.onaylandiYazi}>{t('nobet.onaylandi')}</Text>
              <TouchableOpacity
                onPress={() => nobetKapat(nobet.id)}
                disabled={islemYapilanNobetId === nobet.id}
                style={styles.kapatButon}
              >
                <Ionicons name="checkmark-circle-outline" size={20} color="#75777E" />
              </TouchableOpacity>
            </View>
          )}
        </View>
      );
    }

    // degisim_talebi
    const talep = oge.veri;
    return (
      <View key={`takas-${talep.id}`} style={styles.talepKarti}>
        <View style={styles.talepUstSatir}>
          <View style={styles.avatar}>
            <Text style={styles.avatarYazi}>{bashHarfleri(talep.talep_eden?.ad_soyad)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            {birlesikTurEtiketiRenderla(
              'swap-horizontal-outline',
              '#006F64',
              t('anasayfa.turTakasTalebi'),
              !gorulenBekleyenIdleriRef.current.has(`takas-${talep.id}`)
            )}
            <Text style={styles.satirBaslik}>{talep.talep_eden?.ad_soyad || t('anasayfa.birPersonel')}</Text>
          </View>
        </View>

        <Text style={styles.talepAciklama}>{takasAciklamaCumlesi(talep)}</Text>
        {talep.mesaj ? <Text style={styles.talepMesaj}>{'"'}{talep.mesaj}{'"'}</Text> : null}

        <View style={styles.talepButonSatiri}>
          <TouchableOpacity
            style={[styles.reddetButon, { flex: 1 }]}
            onPress={() => talebiReddet(talep.id)}
            disabled={islemYapilanTalepId === talep.id}
          >
            <Text style={styles.reddetButonYazi}>{t('degisim.reddet')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.anaButon, { flex: 1 }]}
            onPress={() => talebiKabulEt(talep.id)}
            disabled={islemYapilanTalepId === talep.id}
          >
            <Text style={styles.anaButonYazi}>
              {islemYapilanTalepId === talep.id ? t('degisim.isleniyor') : t('degisim.kabulEt')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const birlesikListeRenderla = () =>
    bildirimlerYukleniyor ? (
      <ActivityIndicator size="small" color="#0D1C32" style={{ marginVertical: 20 }} />
    ) : (
      <>
        {birlesikBildirimListesi.map(birlesikOgeRenderla)}
        {birlesikBildirimListesi.length === 0 && <Text style={styles.bosYazi}>{t('anasayfa.bildirimYok')}</Text>}
      </>
    );

  // Takvim + gün-detay modalı: hem admin/müdür hem personel dashboard'unda
  // ortak kullanılıyor, bu yüzden ayLejantVerisi ve seçili gün türetilen
  // değerleri component'in üst seviyesinde hesaplanıyor.
  const ayLejantVerisi = Array.from(
    new Map(
      ayNobetleri
        .filter((n) => n.nobet_turleri)
        .map((n) => [yerelAdGoster(n.nobet_turleri.isim, n.nobet_turleri.isim_en), n.nobet_turleri.renk_kodu])
    ).entries()
  );

  const takvimKartiRenderla = () => (
    <View style={styles.kart}>
      <View style={styles.takvimBaslikSatiri}>
        <TouchableOpacity onPress={() => ayDegistir(-1)} style={styles.ayOkButon}>
          <Ionicons name="chevron-back" size={20} color="#0B1C30" />
        </TouchableOpacity>
        <Text style={styles.ayBaslikYazi}>
          {aylar[ayGosterilen.getMonth()]} {ayGosterilen.getFullYear()}
        </Text>
        <TouchableOpacity onPress={() => ayDegistir(1)} style={styles.ayOkButon}>
          <Ionicons name="chevron-forward" size={20} color="#0B1C30" />
        </TouchableOpacity>
      </View>

      <View style={styles.gunBasliklariSatiri}>
        {gunKisaltmalari.map((g) => (
          <Text key={g} style={styles.gunBasligiYazi}>{g}</Text>
        ))}
      </View>

      <View style={styles.takvimIzgara}>
        {takvimHucreleriOlustur(ayGosterilen).map((tarih, i) => {
          if (!tarih) return <View key={`bos-${i}`} style={styles.gunHucre} />;
          const tarihStr = tarihStrYap(tarih);
          const gunNobetleri = ayNobetleri.filter((n) => n.tarih === tarihStr && n.nobet_turleri);
          const tatilGun = ayTatilleri.find((t) => t.tarih === tarihStr);
          const buGun = tarihStr === bugunStrYap();
          const haftaSonuGun = haftaSonuMu(tarih);
          // Nokta gösterimi (SADECE bu — gün-detay panelindeki tam liste hâlâ
          // gunNobetleri/seciliGunNobetleri'ni kullanıyor, dokunulmadı):
          // aynı türden (nobet_turu_id) kaç kayıt olursa olsun tek nokta,
          // farklı türler için ayrı nokta. Sıra nobet_turu_id'ye (nobet_
          // turleri tablosundaki oluşturulma sırasına) göre, rastgele değil.
          const gunTurleri = Array.from(
            new Map(gunNobetleri.map((n) => [n.nobet_turu_id, n.nobet_turleri])).entries()
          ).sort(([aId], [bId]) => aId - bId);
          const gosterilenNoktalar = gunTurleri.slice(0, 3);
          const fazlaSayisi = gunTurleri.length - gosterilenNoktalar.length;
          return (
            <TouchableOpacity
              key={tarihStr}
              activeOpacity={0.6}
              onPress={() => setSeciliGunTarih(tarih)}
              style={[
                styles.gunHucre,
                tatilGun && styles.gunHucreTatil,
                buGun && styles.gunHucreBugun,
              ]}
            >
              <Text
                style={[
                  styles.gunSayisi,
                  !tatilGun && haftaSonuGun && styles.gunSayisiHaftaSonu,
                  buGun && styles.gunSayisiBugun,
                ]}
              >
                {tarih.getDate()}
              </Text>
              {gunTurleri.length > 0 && (
                <View style={styles.gunNoktaSatiri}>
                  {gosterilenNoktalar.map(([turId, tur]) => (
                    <View key={turId} style={[styles.gunNoktasi, { backgroundColor: tur.renk_kodu }]} />
                  ))}
                  {fazlaSayisi > 0 && <Text style={styles.gunFazlaYazi}>+{fazlaSayisi}</Text>}
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.lejantSatiri}>
        {ayLejantVerisi.map(([isim, renk]) => (
          <View key={isim} style={styles.lejantOge}>
            <View style={[styles.lejantNoktasi, { backgroundColor: renk }]} />
            <Text style={styles.lejantYazi}>{isim}</Text>
          </View>
        ))}
        {ayTatilleri.length > 0 && (
          <View style={styles.lejantOge}>
            <View style={[styles.lejantNoktasi, { backgroundColor: '#D92D20' }]} />
            <Text style={styles.lejantYazi}>{t('anasayfa.tatil')}</Text>
          </View>
        )}
        <View style={styles.lejantOge}>
          <View style={[styles.lejantNoktasi, { backgroundColor: '#C7D2E0' }]} />
          <Text style={styles.lejantYazi}>{t('anasayfa.haftaSonu')}</Text>
        </View>
      </View>
    </View>
  );

  const gunModalRenderla = () => (
    <Modal
      transparent
      visible={!!seciliGunTarih}
      animationType="fade"
      onRequestClose={() => setSeciliGunTarih(null)}
    >
      <TouchableOpacity
        style={styles.gunModalArkaPlan}
        activeOpacity={1}
        onPress={() => setSeciliGunTarih(null)}
      >
        <TouchableOpacity activeOpacity={1} style={styles.gunModalKart} onPress={() => {}}>
          <View style={styles.gunModalBaslikSatiri}>
            <Text style={styles.gunModalBaslikYazi}>{gunModalBasligi}</Text>
            <TouchableOpacity onPress={() => setSeciliGunTarih(null)} style={styles.gunModalKapatButon}>
              <Ionicons name="close" size={22} color="#75777E" />
            </TouchableOpacity>
          </View>

          {seciliGunTatil && (
            <View style={styles.gunModalTatilKutu}>
              <Text style={styles.gunModalTatilYazi}>
                🎉 {seciliGunTatil.aciklama || t('anasayfa.resmiTatil')}
                {seciliGunTatil.aciklama ? ` - ${t('anasayfa.resmiTatil')}` : ''}
              </Text>
            </View>
          )}

          {seciliGunNobetleri.length > 0 && (
            <View style={styles.gunModalNobetListesi}>
              {seciliGunNobetleri.map((nobet) => {
                const kendiNobetiMi = nobet.personel_id === userId;
                // Satırın kendisi SADECE admin/müdür için dokunulabilir
                // (düzenlemeye götürür); personel görünümünde sade bir View.
                const SatirSarici = yoneticiMi ? TouchableOpacity : View;
                return (
                  <View key={nobet.id} style={styles.gunModalNobetBlok}>
                    <View style={styles.gunModalUstSatir}>
                      <Text style={styles.gunModalPersonelAdiYazi}>{nobet.personel?.ad_soyad || '-'}</Text>
                      {yoneticiMi && (
                        <View style={styles.satirYoneticiButonlari}>
                          <TouchableOpacity
                            style={styles.satirIkonButon}
                            onPress={() => nobetDuzenlemeyeGit(nobet)}
                            disabled={silinenNobetId === nobet.id}
                          >
                            <Ionicons name="create-outline" size={15} color="#0D1C32" />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.satirIkonButon}
                            onPress={() => nobetSil(nobet)}
                            disabled={silinenNobetId === nobet.id}
                          >
                            {silinenNobetId === nobet.id ? (
                              <ActivityIndicator size="small" color="#BA1A1A" />
                            ) : (
                              <Ionicons name="trash-outline" size={15} color="#BA1A1A" />
                            )}
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                    <SatirSarici
                      style={styles.nobetKartUstSatir}
                      {...(yoneticiMi ? { activeOpacity: 0.7, onPress: () => nobetDuzenlemeyeGit(nobet) } : {})}
                    >
                      <View style={styles.nobetKartSolGrup}>
                        <View
                          style={[styles.renkNoktasi, { backgroundColor: nobet.nobet_turleri?.renk_kodu || '#75777E' }]}
                        />
                        <Text style={styles.nobetTuruYazi}>
                          {yerelAdGoster(nobet.nobet_turleri?.isim, nobet.nobet_turleri?.isim_en) ||
                            t('anasayfa.nobetVarsayilan')}
                        </Text>
                      </View>
                      <View style={[styles.saatRozeti, { backgroundColor: renkAcikTon(nobet.nobet_turleri?.renk_kodu) }]}>
                        <Text style={[styles.saatRozetiYazi, { color: renkKoyuTon(nobet.nobet_turleri?.renk_kodu) }]}>
                          {saatStrGoster(nobetSaatBaslangicAl(nobet))} - {saatStrGoster(nobetSaatBitisAl(nobet))}
                        </Text>
                      </View>
                    </SatirSarici>

                    {kendiNobetiMi && (
                      <TouchableOpacity style={styles.gunModalDegistirButon} onPress={() => nobetDegistirmeyeGit(nobet.id)}>
                        <Ionicons name="swap-horizontal-outline" size={18} color="#FFFFFF" />
                        <Text style={styles.gunModalDegistirButonYazi}>{t('anasayfa.nobetDegistir')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {!seciliGunTatil && seciliGunNobetleri.length === 0 && (
            <Text style={styles.bosYazi}>{t('anasayfa.buGunNobetYok')}</Text>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );

  if (yukleniyor) {
    return (
      <View style={styles.ortala}>
        <ActivityIndicator size="large" color="#0D1C32" />
      </View>
    );
  }

  if (yoneticiMi) {
    const gunduzSayisi = bugunkuNobetler.filter((n) => {
      const saat = nobetSaatBaslangicAl(n);
      if (!saat) return false;
      const saatSayi = parseInt(saat.slice(0, 2), 10);
      return saatSayi >= 6 && saatSayi < 18;
    }).length;
    const geceSayisi = bugunkuNobetler.length - gunduzSayisi;

    return (
      <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.icerik}
        refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={yenile} tintColor="#0D1C32" colors={['#0D1C32']} />}
      >
        <View style={styles.adminUstSatir}>
          <View style={{ flex: 1 }}>
            <Text style={styles.selamlama}>{t('anasayfa.merhabaAdmin')}</Text>
            <Text style={styles.tarihUzunYazi}>{bugunUzunTarihYaz()}</Text>
          </View>
          <BildirimZili sayi={bildirimZiliSayisi} onPress={panelAc} />
        </View>

        <View style={styles.istatistikSatiri}>
          <View style={styles.istatistikKart}>
            <Ionicons name="people-outline" size={22} color="#006B5F" />
            <Text style={styles.istatistikSayi}>{toplamPersonel}</Text>
            <Text style={styles.istatistikEtiket}>{t('anasayfa.toplamPersonel')}</Text>
          </View>
          <View style={styles.istatistikKart}>
            <Ionicons name="calendar-outline" size={22} color="#0D1C32" />
            <Text style={styles.istatistikSayi}>{bugunkuNobetler.length}</Text>
            <Text style={styles.istatistikEtiket}>{t('anasayfa.bugunkuNobetler')}</Text>
            {bugunkuNobetler.length > 0 && (
              <Text style={styles.istatistikAltYazi}>
                {t('anasayfa.gunduzGece', { gunduz: gunduzSayisi, gece: geceSayisi })}
              </Text>
            )}
          </View>
          <View style={styles.istatistikKart}>
            <Ionicons name="hourglass-outline" size={22} color="#BA1A1A" />
            <Text style={styles.istatistikSayi}>{bekleyenTalepSayisi}</Text>
            <Text style={styles.istatistikEtiket}>{t('anasayfa.bekleyenTalepler')}</Text>
          </View>
        </View>

        {takvimKartiRenderla()}

        <View style={styles.kart}>
          <Text style={styles.bolumBaslik}>{t('anasayfa.bugunkuNobetler')}</Text>
          {bugunkuNobetler.map((nobet) => (
            <View key={nobet.id} style={styles.personelSatiri}>
              <View style={styles.avatar}>
                <Text style={styles.avatarYazi}>{bashHarfleri(nobet.personel?.ad_soyad)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.satirBaslik}>{nobet.personel?.ad_soyad || '-'}</Text>
                <Text style={styles.satirAltYazi}>
                  {yerelAdGoster(pozisyonMap[nobet.personel_id]?.tr, pozisyonMap[nobet.personel_id]?.en) || '-'}
                </Text>
              </View>
              <View style={[styles.saatRozeti, { backgroundColor: renkAcikTon(nobet.nobet_turleri?.renk_kodu) }]}>
                <Text style={[styles.saatRozetiYazi, { color: renkKoyuTon(nobet.nobet_turleri?.renk_kodu) }]}>
                  {saatStrGoster(nobetSaatBaslangicAl(nobet))} - {saatStrGoster(nobetSaatBitisAl(nobet))}
                </Text>
              </View>
              {yoneticiMi && (
                <View style={styles.satirYoneticiButonlari}>
                  <TouchableOpacity
                    style={styles.satirIkonButon}
                    onPress={() => nobetDuzenlemeyeGit(nobet)}
                    disabled={silinenNobetId === nobet.id}
                  >
                    <Ionicons name="create-outline" size={15} color="#0D1C32" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.satirIkonButon}
                    onPress={() => nobetSil(nobet)}
                    disabled={silinenNobetId === nobet.id}
                  >
                    {silinenNobetId === nobet.id ? (
                      <ActivityIndicator size="small" color="#BA1A1A" />
                    ) : (
                      <Ionicons name="trash-outline" size={15} color="#BA1A1A" />
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
          {bugunkuNobetler.length === 0 && <Text style={styles.bosYazi}>{t('anasayfa.bugunNobetYokAdmin')}</Text>}
        </View>

        <View style={styles.kart}>
          <Text style={styles.bolumBaslik}>{t('anasayfa.sistemBildirimleri')}</Text>
          {sistemBildirimleri.map((olay, i) => (
            <View key={olay.id} style={styles.zamanCizelgeSatiri}>
              <View style={styles.zamanCizelgeIsaretSutunu}>
                <View style={styles.zamanCizelgeNokta} />
                {i !== sistemBildirimleri.length - 1 && <View style={styles.zamanCizelgeCizgi} />}
              </View>
              <View style={{ flex: 1, paddingBottom: 16 }}>
                <Text style={styles.zamanCizelgeMetin}>{islemCumlesiOlustur(olay)}</Text>
                <Text style={styles.zamanCizelgeZaman}>{zamanGoster(olay.tarih)}</Text>
              </View>
            </View>
          ))}
          {sistemBildirimleri.length === 0 && <Text style={styles.bosYazi}>{t('anasayfa.islemKaydiYok')}</Text>}
        </View>
      </ScrollView>

      {gunModalRenderla()}

      <NobetDuzenleModal
        visible={!!duzenlenecekNobetId}
        nobetId={duzenlenecekNobetId}
        userId={userId}
        kendiAdSoyad={kendiAdSoyad}
        onKapat={duzenlemeModaliKapat}
        onKaydedildi={duzenlemeSonrasiTazele}
        onSilindi={duzenlemeSonrasiTazele}
      />

      <AltPanelModal visible={bildirimlerAcik} baslik={t('anasayfa.bildirimler')} onKapat={() => setBildirimlerAcik(false)}>
        {birlesikListeRenderla()}
      </AltPanelModal>
      </>
    );
  }

  // ---- Personel Dashboard ----
  const siradakiNobet = yaklasanNobetler[0] || null;
  const gelecekNobetler = yaklasanNobetler.slice(1, 9);

  return (
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.icerik}
      refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={yenile} tintColor="#0D1C32" colors={['#0D1C32']} />}
    >
      <View style={styles.personelUstSatir}>
        <Text style={styles.selamlama}>
          {t('anasayfa.merhaba', { isim: kendiAdSoyad ? kendiAdSoyad.split(' ')[0] : '' })}
        </Text>
        <BildirimZili sayi={bildirimZiliSayisi} onPress={panelAc} />
      </View>

      {takvimKartiRenderla()}

      {gunModalRenderla()}

      <View style={styles.kart}>
        <Text style={styles.bolumBaslik}>{t('anasayfa.bugunkuNobetler')}</Text>
        {bugunkuTakimNobetleri.map((nobet) => (
          <View key={nobet.id} style={styles.personelSatiri}>
            <View style={styles.avatar}>
              <Text style={styles.avatarYazi}>{bashHarfleri(nobet.personel?.ad_soyad)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.satirBaslik}>{nobet.personel?.ad_soyad || '-'}</Text>
              <Text style={styles.satirAltYazi}>
                {yerelAdGoster(nobet.nobet_turleri?.isim, nobet.nobet_turleri?.isim_en) || t('anasayfa.nobetVarsayilan')}
              </Text>
            </View>
            <View style={[styles.saatRozeti, { backgroundColor: renkAcikTon(nobet.nobet_turleri?.renk_kodu) }]}>
              <Text style={[styles.saatRozetiYazi, { color: renkKoyuTon(nobet.nobet_turleri?.renk_kodu) }]}>
                {saatStrGoster(nobetSaatBaslangicAl(nobet))} - {saatStrGoster(nobetSaatBitisAl(nobet))}
              </Text>
            </View>
          </View>
        ))}
        {bugunkuTakimNobetleri.length === 0 && <Text style={styles.bosYazi}>{t('anasayfa.bugunNobetYokAdmin')}</Text>}
      </View>

      {!kendiRotasyonYukleniyor && kendiRotasyonlar.length > 0 && (
        <View style={styles.kart}>
          <Text style={styles.bolumBaslik}>{t('anasayfa.nobetRotasyonu')}</Text>
          {kendiRotasyonlar.map((rotasyon, i) => (
            <View key={rotasyon.id} style={i > 0 ? styles.rotasyonBolucu : null}>
              <Text style={styles.satirBaslik}>{rotasyon.isim}</Text>
              <Text style={styles.satirAltYazi}>
                {yerelAdGoster(rotasyon.nobet_turleri?.isim, rotasyon.nobet_turleri?.isim_en)} ·{' '}
                {gunTamIsimleri[rotasyon.haftanin_gunu % 7]}
              </Text>
              <RotasyonSiraListesi
                uyeler={kendiRotasyonSiraVerisi[rotasyon.id]?.uyeler || []}
                siradakiId={kendiRotasyonSiraVerisi[rotasyon.id]?.siradakiId || null}
                telafiIdSet={kendiRotasyonSiraVerisi[rotasyon.id]?.telafiIdSet || new Set()}
              />
            </View>
          ))}
        </View>
      )}

      {!kendiRotasyonYukleniyor && kendiRotasyonlar.length === 0 && (
        <View style={styles.kart}>
          <Text style={styles.bolumBaslik}>{t('anasayfa.nobetRotasyonu')}</Text>
          <Text style={styles.bosYazi}>{t('anasayfa.nobetRotasyonuYok')}</Text>
        </View>
      )}

      {siradakiNobet && (
        <View style={styles.kart}>
          <Text style={styles.bolumBaslik}>{t('anasayfa.siradakiNobet')}</Text>
          {nobetKartiRenderla(siradakiNobet, true)}
        </View>
      )}

      {gelecekNobetler.length > 0 && (
        <View style={styles.kart}>
          <Text style={styles.bolumBaslik}>{t('anasayfa.gelecekNobetler')}</Text>
          {gelecekNobetler.map((n) => nobetKartiRenderla(n, false))}
        </View>
      )}

      {!siradakiNobet && (
        <View style={styles.kart}>
          <Text style={styles.bosYazi}>{t('anasayfa.yaklasanNobetYok')}</Text>
        </View>
      )}
    </ScrollView>

    <AltPanelModal visible={bildirimlerAcik} baslik={t('anasayfa.bildirimler')} onKapat={() => setBildirimlerAcik(false)}>
      {birlesikListeRenderla()}
    </AltPanelModal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FF' },
  icerik: { padding: 16, paddingTop: 60, paddingBottom: 40 },
  ortala: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8F9FF' },
  selamlama: { fontSize: 22, fontWeight: 'bold', color: '#0B1C30', marginBottom: 16 },
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
  bolumBaslik: { fontSize: 16, fontWeight: '600', color: '#0B1C30', marginBottom: 10 },
  bosYazi: { fontSize: 13, color: '#75777E', paddingVertical: 12 },

  // Takvim
  takvimBaslikSatiri: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  ayOkButon: { padding: 6 },
  ayBaslikYazi: { fontSize: 16, fontWeight: '700', color: '#0B1C30' },
  gunBasliklariSatiri: { flexDirection: 'row' },
  gunBasligiYazi: { width: '14.2857%', textAlign: 'center', fontSize: 11, color: '#75777E', fontWeight: '600' },
  takvimIzgara: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  gunHucre: { width: '14.2857%', alignItems: 'center', paddingVertical: 6, borderRadius: 8, minHeight: 40 },
  gunHucreTatil: { backgroundColor: '#FDEDEE' },
  gunHucreBugun: { borderWidth: 1.5, borderColor: '#0D1C32' },
  gunSayisi: { fontSize: 13, color: '#0B1C30' },
  gunSayisiHaftaSonu: { color: '#8A8D94' },
  gunSayisiBugun: { fontWeight: '700' },
  gunNoktaSatiri: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', gap: 2, marginTop: 4 },
  gunNoktasi: { width: 6, height: 6, borderRadius: 3 },
  gunFazlaYazi: { fontSize: 8, color: '#75777E', fontWeight: '700' },
  lejantSatiri: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#EFF4FF' },
  lejantOge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lejantNoktasi: { width: 8, height: 8, borderRadius: 4 },
  lejantYazi: { fontSize: 12, color: '#44474D' },

  // Nöbet kartları (Sıradaki / Gelecek)
  nobetKartKucuk: {
    borderWidth: 1,
    borderColor: '#EFF4FF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  nobetKartBuyuk: { backgroundColor: '#F1F6FF', borderColor: '#0D1C32', padding: 14 },
  nobetKartUstSatir: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  nobetKartSolGrup: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  renkNoktasi: { width: 12, height: 12, borderRadius: 6 },
  nobetTuruYazi: { fontSize: 15, fontWeight: '700', color: '#0B1C30', flexShrink: 1 },
  saatRozeti: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  saatRozetiYazi: { fontSize: 12, fontWeight: '700' },
  nobetKartAltSatir: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  nobetTarihYazi: { fontSize: 12, color: '#8A8D94' },
  kalanGunYazi: { fontSize: 12, color: '#006F64', fontWeight: '600' },
  kalanGunYaziBuyuk: { fontSize: 13 },
  atamaBadgeSatiri: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  atamaBadgeYazi: { fontSize: 11, color: '#44474D', fontWeight: '500' },

  // Admin üst kısım
  adminUstSatir: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  tarihUzunYazi: { fontSize: 13, color: '#44474D', marginTop: 4, textTransform: 'capitalize' },

  // İstatistik kartları
  istatistikSatiri: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  istatistikKart: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#EFF4FF',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  istatistikSayi: { fontSize: 22, fontWeight: 'bold', color: '#0B1C30', marginTop: 6 },
  istatistikEtiket: { fontSize: 11, color: '#75777E', marginTop: 2 },
  istatistikAltYazi: { fontSize: 10, color: '#8A8D94', marginTop: 4 },

  // Bugünkü nöbetler / genel satır
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
  satirBaslik: { fontSize: 14, fontWeight: '600', color: '#0B1C30' },
  satirAltYazi: { fontSize: 12, color: '#44474D', marginTop: 2 },
  // Gün-detay paneli + "Bugünkü Nöbetler" kartındaki satır-üstü Düzenle/Sil
  // ikon butonları — SADECE admin/müdür (yoneticiMi) için render edilir.
  satirYoneticiButonlari: { flexDirection: 'row', gap: 6 },
  satirIkonButon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F6FF',
  },

  // Bekleyen izin talepleri
  izinKarti: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EFF4FF' },
  izinSebep: { fontSize: 13, color: '#44474D', fontStyle: 'italic', marginTop: 6 },
  talepButonSatiri: { flexDirection: 'row', gap: 12, marginTop: 10 },
  anaButon: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#000000',
    paddingVertical: 12,
    borderRadius: 999,
  },
  anaButonYazi: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  reddetButon: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#C5C6CD',
    backgroundColor: '#FFFFFF',
  },
  reddetButonYazi: { color: '#BA1A1A', fontSize: 14, fontWeight: '600' },

  // Sistem bildirimleri (timeline)
  zamanCizelgeSatiri: { flexDirection: 'row', gap: 12 },
  zamanCizelgeIsaretSutunu: { alignItems: 'center', width: 12 },
  zamanCizelgeNokta: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#0D1C32', marginTop: 4 },
  zamanCizelgeCizgi: { flex: 1, width: 2, backgroundColor: '#EFF4FF', marginTop: 2 },
  zamanCizelgeMetin: { fontSize: 13, color: '#0B1C30', lineHeight: 18 },
  zamanCizelgeZaman: { fontSize: 11, color: '#8A8D94', marginTop: 2 },

  // Gün detay modalı
  gunModalArkaPlan: {
    flex: 1,
    backgroundColor: 'rgba(11, 28, 48, 0.4)',
    justifyContent: 'flex-end',
  },
  gunModalKart: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
  },
  gunModalBaslikSatiri: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  gunModalBaslikYazi: { fontSize: 18, fontWeight: '700', color: '#0B1C30' },
  gunModalKapatButon: { padding: 4 },
  gunModalTatilKutu: {
    backgroundColor: '#FDEDEE',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  gunModalTatilYazi: { fontSize: 14, color: '#BA1A1A', fontWeight: '600' },
  gunModalNobetListesi: { gap: 10 },
  gunModalNobetBlok: {
    borderWidth: 1,
    borderColor: '#EFF4FF',
    borderRadius: 10,
    padding: 12,
  },
  gunModalUstSatir: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  gunModalPersonelAdiYazi: { fontSize: 13, fontWeight: '600', color: '#44474D' },
  gunModalDegistirButon: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#000000',
    paddingVertical: 12,
    borderRadius: 999,
    marginTop: 12,
  },
  gunModalDegistirButonYazi: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },

  // Personel "Nöbet Rotasyonu" kartı
  rotasyonBolucu: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#EFF4FF' },

  // Bildirim zili + rozet
  personelUstSatir: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  bildirimZili: { padding: 8, borderRadius: 999, backgroundColor: '#EFF4FF' },
  bildirimRozet: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#D92D20',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  bildirimRozetYazi: { fontSize: 10, fontWeight: '700', color: '#FFFFFF' },
  bildirimSatiri: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EFF4FF',
  },
  bildirimSatiriOkunmamis: { backgroundColor: '#F1F6FF' },
  bildirimNoktasi: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#0D1C32', marginTop: 6 },
  birlesikTurSatiri: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 },
  birlesikTurYazi: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  // Onay bekleyen (izin/nöbet onayı/takas) kartlarında "henüz görülmedi"
  // vurgusu — panel açılıp görülünce kalkar (durum hâlâ bekleyen olsa bile).
  yeniNoktasi: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#0D1C32', marginLeft: 2 },
  onaySatiri: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EFF4FF',
  },
  onayButonSatiri: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kabulButonKucuk: { backgroundColor: '#000000', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  kabulButonKucukYazi: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  reddetButonKucuk: {
    borderWidth: 1,
    borderColor: '#C5C6CD',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  reddetButonKucukYazi: { color: '#BA1A1A', fontSize: 12, fontWeight: '600' },
  onaylandiYazi: { color: '#BA1A1A', fontSize: 12, fontWeight: '700' },
  kapatButon: { padding: 4 },
  talepKarti: {
    borderBottomWidth: 1,
    borderBottomColor: '#EFF4FF',
    paddingVertical: 14,
  },
  talepUstSatir: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  talepAciklama: { fontSize: 13, color: '#0B1C30', marginTop: 10, lineHeight: 18 },
  talepMesaj: { fontSize: 13, color: '#44474D', fontStyle: 'italic', marginTop: 6 },
});
