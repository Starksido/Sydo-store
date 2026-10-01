-- Sign-in now needs a confirmed email address. Accounts made before that couldn't confirm theirs,
-- so they're treated as confirmed rather than locked out.
UPDATE "user" SET "email_verified" = true WHERE "email_verified" = false;
