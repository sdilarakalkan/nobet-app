import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Props = {
  visible: boolean;
  baslik: string;
  onKapat: () => void;
  children: ReactNode;
};

// Alt sekmeden yukarı açılan, projenin genelinde kullanılan aynı bottom-sheet
// görünümü (yarı saydam arka plan + yuvarlak üst köşeli beyaz kart). profil.tsx
// içinde aynı deseni yerel olarak tanımlıyor — burada ortak, birden fazla
// ekranın (ör. anasayfa.tsx'teki bildirim listesi) kullanabilmesi için.
export default function AltPanelModal({ visible, baslik, onKapat, children }: Props) {
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

const styles = StyleSheet.create({
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
    paddingBottom: 32,
    maxHeight: '86%',
  },
  modalBaslikSatiri: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalBaslikYazi: { fontSize: 18, fontWeight: '700', color: '#0B1C30' },
  modalKapatButon: { padding: 4 },
  modalIcerikScroll: { maxHeight: 420 },
});
