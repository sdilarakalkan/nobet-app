// Hermes'te (React Native'in JS motoru) toLocaleLowerCase('tr') tutarsız
// çalışıyor — ör. "İlgın" içinde "ıl" araması bazen eşleşmiyor ama "ılg"
// eşleşiyor gibi karakter bazlı tutarsızlıklar oluşuyor. Bu yüzden Türkçe
// büyük/küçük harf dönüşümü locale'e GÜVENMEDEN, İ/I/Ş/Ğ/Ü/Ö/Ç harflerini
// elle eşleyip standart .toLowerCase() ile tamamlanarak yapılır.
export const turkceKucultVeNormallestir = (metin: string | null | undefined): string => {
  if (!metin) return '';
  return metin
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .replace(/Ş/g, 'ş')
    .replace(/Ğ/g, 'ğ')
    .replace(/Ü/g, 'ü')
    .replace(/Ö/g, 'ö')
    .replace(/Ç/g, 'ç')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
};

// Personel arama kutularında (nobet.tsx, degisim.tsx, NobetDuzenleModal.tsx)
// ORTAK kullanılan çok alanlı + çok kelimeli eşleştirme. Arama metni birden
// fazla kelimeden oluşuyorsa (ör. "teknik müdür"), kelimelerin sırası önemli
// olmadan HER birinin verilen alanların (ad_soyad, pozisyonlar, pozisyonlar_en,
// rol vb.) birleşiminde geçmesi yeterlidir.
export const personelAramaEslesiyorMu = (
  alanlar: Array<string | null | undefined>,
  aramaMetni: string
): boolean => {
  const arama = turkceKucultVeNormallestir(aramaMetni);
  if (!arama) return true;
  const birlesikMetin = alanlar.map(turkceKucultVeNormallestir).join(' ');
  return arama.split(' ').every((kelime) => birlesikMetin.includes(kelime));
};
