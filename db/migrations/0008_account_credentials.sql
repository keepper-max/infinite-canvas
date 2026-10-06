ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_code text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'direct';
ALTER TABLE users ADD COLUMN IF NOT EXISTS school_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS channel_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'email_verified'
  ) THEN
    ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
    UPDATE users SET email_verified = true WHERE email IS NOT NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique
  ON users (phone)
  WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
  ON users (lower(email))
  WHERE email IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_login_identity_required'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_login_identity_required
      CHECK (phone IS NOT NULL OR email IS NOT NULL);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_status_allowed'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_status_allowed
      CHECK (status IN ('active', 'disabled'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS invite_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  source_type text NOT NULL DEFAULT 'social',
  school_id text,
  channel_id text,
  enabled boolean NOT NULL DEFAULT true,
  max_uses integer,
  use_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS invite_codes_upper_unique
  ON invite_codes (upper(code));

CREATE TABLE IF NOT EXISTS invite_code_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code_id uuid NOT NULL REFERENCES invite_codes(id),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
