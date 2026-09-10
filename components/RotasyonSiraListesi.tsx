import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { RotasyonSiraUyesi } from '@/lib/rotasyonSirasi';

type Props = {
  uyeler: RotasyonSiraUyesi[];
  siradakiId: string | null;
  telafiIdSet: Set<string>;
};

const bashHarfleri = (adSoyad: string) =>
  adSoyad ? adSoyad.split(' ').map((k) => k[0]).join('').slice(0, 2).toUpperCase() : '';

// nobet.tsx (Otomatik sekmesi, admin/mudur) ve anasayfa.tsx (personel Ana
// Sayfa kartı, salt-okunur) tarafından ortak kullanılıyor — ikisi de AYNI
// görseli göstermeli, bu yüzden tek yerde.
export default function RotasyonSiraListesi({ uyeler, siradakiId, telafiIdSet }: Props) {
  const { t } = useTranslation();

  if (uyeler.length === 0) {
    return <Text style={styles.bosYazi}>{t('rotasyon.siraListesiBos')}</Text>;
  }

  return (
    <View style={styles.disKapsayici}>
      {uyeler.map((uye, i) => {
        const siradaki = uye.id === siradakiId;
        const telafiBekliyor = telafiIdSet.has(uye.id);
        return (
          <View key={uye.id} style={[styles.satir, siradaki && styles.satirSiradaki]}>
            <Text style={styles.siraNo}>{i + 1}</Text>
            <View style={[styles.avatar, siradaki && styles.avatarSiradaki]}>
              <Text style={[styles.avatarYazi, siradaki && styles.avatarYaziSiradaki]}>
                {bashHarfleri(uye.ad_soyad)}
              </Text>
            </View>
            <Text style={[styles.isim, siradaki && styles.isimSiradaki]}>{uye.ad_soyad}</Text>
            {siradaki && (
              <View style={styles.siradakiRozet}>
                <Ionicons name="arrow-forward-circle" size={13} color="#006F64" />
                <Text style={styles.siradakiRozetYazi}>{t('rotasyon.siradaki')}</Text>
              </View>
            )}
            {telafiBekliyor && (
              <View style={styles.telafiRozet}>
                <Text style={styles.telafiRozetYazi}>{t('rotasyon.telafiBekliyor')}</Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  disKapsayici: { marginTop: 4 },
  bosYazi: { fontSize: 13, color: '#75777E', paddingVertical: 8 },
  satir: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  satirSiradaki: { backgroundColor: '#EAFBF7' },
  siraNo: { width: 16, fontSize: 12, color: '#8A8D94', fontWeight: '600' },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#DCE9FF', justifyContent: 'center', alignItems: 'center' },
  avatarSiradaki: { backgroundColor: '#006F64' },
  avatarYazi: { fontSize: 11, fontWeight: 'bold', color: '#0B1C30' },
  avatarYaziSiradaki: { color: '#FFFFFF' },
  isim: { flex: 1, fontSize: 13, color: '#0B1C30', fontWeight: '500' },
  isimSiradaki: { fontWeight: '700' },
  siradakiRozet: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#DCF5E8', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  siradakiRozetYazi: { fontSize: 10, fontWeight: '700', color: '#006F64' },
  telafiRozet: { backgroundColor: '#FFF1DC', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  telafiRozetYazi: { fontSize: 10, fontWeight: '700', color: '#B26A00' },
});
