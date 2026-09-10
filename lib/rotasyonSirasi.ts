import { supabase } from './supabase';

export type RotasyonSiraUyesi = {
  id: string;
  ad_soyad: string;
};

export type RotasyonSiraBilgisi = {
  uyeler: RotasyonSiraUyesi[];
  siradakiId: string | null;
  telafiIdSet: Set<string>;
};

type RotasyonGirdi = {
  id: number;
  takim_id: number;
  mevcut_sira_index: number;
};

// Otomatik sekmesi (nobet.tsx) ve personel Ana Sayfa kartı (anasayfa.tsx)
// AYNI "Sıra Listesi" görselini kullanıyor — kod tekrarını önlemek için
// ortak bir yerde. Sıralama mantığı supabase/4-rotasyonlar-sema.sql'deki
// rotasyon_ay_olustur() fonksiyonuyla BİREBİR aynı olmalı: personel_takim'e
// eklenme sırasına (created_at ASC) göre, SADECE rol='personel' üyeler.
export const rotasyonSiraListeleriGetir = async (
  rotasyonlar: RotasyonGirdi[]
): Promise<Record<number, RotasyonSiraBilgisi>> => {
  const sonuc: Record<number, RotasyonSiraBilgisi> = {};
  if (!rotasyonlar || rotasyonlar.length === 0) return sonuc;

  const takimIdler = [...new Set(rotasyonlar.map((r) => r.takim_id))];
  const rotasyonIdler = rotasyonlar.map((r) => r.id);

  const [uyeSonuc, telafiSonuc] = await Promise.all([
    supabase
      .from('personel_takim')
      .select('personel_id, takim_id, created_at, personel:personel_id ( ad_soyad, rol )')
      .in('takim_id', takimIdler)
      .order('created_at', { ascending: true }),
    supabase
      .from('rotasyon_telafi_kuyrugu')
      .select('rotasyon_id, personel_id')
      .in('rotasyon_id', rotasyonIdler),
  ]);

  if (uyeSonuc.error) console.log('HATA (personel_takim/sıra listesi):', JSON.stringify(uyeSonuc.error));
  if (telafiSonuc.error) console.log('HATA (rotasyon_telafi_kuyrugu):', JSON.stringify(telafiSonuc.error));

  // rotasyon_ay_olustur() da nöbete SADECE rol='personel' olanları alıyor
  // (Takım Admini/Müdür nöbete girmiyor) — sıra listesi bu yüzden aynı
  // filtreyle eşleşiyor.
  const tumUyeler = ((uyeSonuc.data as any[]) || []).filter((u) => u.personel?.rol === 'personel');
  const telafiKayitlari = (telafiSonuc.data as any[]) || [];

  rotasyonlar.forEach((r) => {
    const uyeler: RotasyonSiraUyesi[] = tumUyeler
      .filter((u) => u.takim_id === r.takim_id)
      .map((u) => ({ id: u.personel_id, ad_soyad: u.personel?.ad_soyad || '' }));

    const siradakiId = uyeler.length > 0 ? uyeler[r.mevcut_sira_index % uyeler.length].id : null;

    const telafiIdSet = new Set<string>(
      telafiKayitlari.filter((t) => t.rotasyon_id === r.id).map((t) => t.personel_id)
    );

    sonuc[r.id] = { uyeler, siradakiId, telafiIdSet };
  });

  return sonuc;
};
