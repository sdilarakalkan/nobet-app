-- ============================================================================
-- ADIM 1/2 — SADECE bunu çalıştır, "Success" gördükten sonra 2. dosyaya geç.
--
-- PostgreSQL kısıtı: ALTER TYPE ... ADD VALUE, eklenen değeri AYNI
-- transaction/script içinde kullanmana izin vermez ("unsafe use of new
-- value of enum type" hatası alırsın). Bu yüzden bu tek satır ayrı bir
-- "Run" olarak çalıştırılıp commit edilmeli, sonra 2-ekip-sefi-mudur.sql
-- (mudur değerini gerçekten KULLANAN her şey) ayrı bir "Run" ile gelmeli.
-- ============================================================================

alter type personel_rolu add value if not exists 'mudur';
