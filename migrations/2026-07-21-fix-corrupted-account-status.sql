-- ============================================================
-- One-time cleanup: a missing value-key on the admin status-change
-- dropdown (components/admin/student_details/StudentHeaderCard.vue)
-- let the whole {label, value} option object get bound instead of
-- just the string, which then got stringified into account_status.
-- Fixed in code going forward; this repairs the one row already
-- affected (August Brunnberg Frigo, id 38ce5f9e-209e-45e2-b27b-58d39257b721),
-- and defensively catches any other row with the same corruption
-- pattern in case there are others.
-- ============================================================

UPDATE students
SET    account_status = 'Inactive',
       is_active       = false,
       updated_at      = NOW()
WHERE  account_status LIKE '{%"value"%}'
  AND  account_status LIKE '%Inactive%';

UPDATE students
SET    account_status = 'Active',
       is_active       = true,
       updated_at      = NOW()
WHERE  account_status LIKE '{%"value"%}'
  AND  account_status LIKE '%Active%'
  AND  account_status NOT LIKE '%Inactive%';

UPDATE students
SET    account_status = 'Frozen',
       is_active       = false,
       updated_at      = NOW()
WHERE  account_status LIKE '{%"value"%}'
  AND  account_status LIKE '%Frozen%';

UPDATE students
SET    account_status = 'Graduated',
       is_active       = false,
       updated_at      = NOW()
WHERE  account_status LIKE '{%"value"%}'
  AND  account_status LIKE '%Graduated%';

-- Verify: should return zero rows once the above has run.
SELECT id, first_name, last_name, account_status
FROM students
WHERE account_status LIKE '{%';
