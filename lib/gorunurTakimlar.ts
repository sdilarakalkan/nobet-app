import { supabase } from './supabase';

// Nöbet ekranındaki "Takımlardan Seç" sekmesinde ve "Otomatik" sekmesindeki
// "Yeni Rotasyon Oluştur" formunda (app/(tabs)/nobet/index.tsx ve
// app/(tabs)/nobet/yeni-rotasyon.tsx) HANGİ takımların seçenek olarak
// sunulacağını belirler — ikisi de AYNI kapsam mantığını kullanmalı, o yüzden
// burada tek bir yerde tutuluyor. Müdür (rol=mudur): tüm takımlar. Takım
// Admini (rol=admin): sadece takim_yoneticileri'nde kendisine atanmış
// takım(lar). Sıradan personel: sadece kendi personel_takim'indeki takım(lar).
export const gorunurTakimlariGetir = async (rolDegeri, uid) => {
  if (rolDegeri === 'mudur') {
    const { data, error } = await supabase.from('takimlar').select('*');
    if (error) console.log('HATA (takimlar/mudur):', JSON.stringify(error));
    return data || [];
  }

  const kaynakTablo = rolDegeri === 'admin' ? 'takim_yoneticileri' : 'personel_takim';
  const { data: iliskiler, error: iliskiHata } = await supabase
    .from(kaynakTablo)
    .select('takim_id')
    .eq('personel_id', uid);
  if (iliskiHata) console.log(`HATA (${kaynakTablo}):`, JSON.stringify(iliskiHata));

  const takimIdler = [...new Set((iliskiler || []).map((r) => r.takim_id))];
  if (takimIdler.length === 0) return [];

  const { data: takimVeri, error: takimHata } = await supabase.from('takimlar').select('*').in('id', takimIdler);
  if (takimHata) console.log('HATA (takimlar):', JSON.stringify(takimHata));
  return takimVeri || [];
};
