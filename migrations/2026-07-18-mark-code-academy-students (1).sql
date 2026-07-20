-- ============================================================
-- Marks the given list of students as 'Code Academy' (everyone
-- else stays 'Regular', the default from the previous migration).
-- ============================================================

UPDATE students
SET    student_class = 'Code Academy',
       updated_at    = NOW()
WHERE  email IN (
    'arturas.jacevicius@amsterdam.tech',
    'augustas.medonis@amsterdam.tech',
    'emilis.butrimas@amsterdam.tech',
    'ieva.patackait@amsterdam.tech',
    'justas.glodenis@amsterdam.tech',
    'lukas.banevicius@amsterdam.tech',
    'neilas.sunklodas@amsterdam.tech',
    'nojus.jasevicius@amsterdam.tech',
    'vytautas.pavilonis@amsterdam.tech',
    'zygimantas.poderis@amsterdam.tech',
    'arvydas.gimbutis@amsterdam.tech',
    'aurimas.cepulis@amsterdam.tech',
    'domantas.urbonavicius@amsterdam.tech',
    'jaunius.zulonas@amsterdam.tech',
    'kipras.karalevicius@amsterdam.tech',
    'pijus.bilinskas@amsterdam.tech',
    'rimgaudas.jurkaitis@amsterdam.tech',
    'tadas.milvydas@amsterdam.tech',
    'tautvydas.baciulis@amsterdam.tech',   -- ASCII version (see note below)
    'tautvydas.bačiulis@amsterdam.tech',   -- literal version as pasted, in case that's actually correct
    'ugnius.virmauskas@amsterdam.tech',
    'zilvinas.gruodis@amsterdam.tech'
);

-- Verify: this should return exactly 21 rows (20 people, +1 extra
-- attempt for the two Tautvydas Bačiulis email variants -- only one of
-- them will actually match a real row, which is expected).
SELECT email, first_name, last_name, student_class
FROM students
WHERE student_class = 'Code Academy'
ORDER BY last_name;

-- Sanity check: confirms whether every name on the list was actually
-- found. If this returns fewer than 20 rows, cross-check the emails
-- printed against your source list for typos.
SELECT COUNT(*) AS code_academy_count
FROM students
WHERE student_class = 'Code Academy';
