CREATE TABLE IF NOT EXISTS canvas_users (
  id uuid PRIMARY KEY,
  username text NOT NULL,
  password_hash text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  active_project_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS canvas_users_username_lower_idx
  ON canvas_users (lower(username));

CREATE TABLE IF NOT EXISTS canvas_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES canvas_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS canvas_sessions_user_idx ON canvas_sessions (user_id);
CREATE INDEX IF NOT EXISTS canvas_sessions_expiry_idx ON canvas_sessions (expires_at);

CREATE TABLE IF NOT EXISTS canvas_projects (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES canvas_users(id) ON DELETE CASCADE,
  name text NOT NULL,
  graph jsonb NOT NULL,
  viewport jsonb NOT NULL,
  batch jsonb,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS canvas_projects_owner_name_lower_idx
  ON canvas_projects (owner_id, lower(name));
CREATE INDEX IF NOT EXISTS canvas_projects_owner_idx ON canvas_projects (owner_id, updated_at DESC);

ALTER TABLE canvas_users DROP CONSTRAINT IF EXISTS canvas_users_active_project_fk;
ALTER TABLE canvas_users ADD CONSTRAINT canvas_users_active_project_fk
  FOREIGN KEY (active_project_id) REFERENCES canvas_projects(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS canvas_project_conversations (
  project_id uuid PRIMARY KEY REFERENCES canvas_projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES canvas_users(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS canvas_assets (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES canvas_users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
  node_id text,
  object_key text NOT NULL UNIQUE,
  name text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL,
  checksum text,
  status text NOT NULL CHECK (status IN ('uploading', 'ready')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS canvas_assets_owner_project_idx
  ON canvas_assets (owner_id, project_id);
