CREATE TABLE IF NOT EXISTS knowledge_spaces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL,
 owner_user_id uuid REFERENCES users(id), project_id uuid REFERENCES projects(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind='personal' AND owner_user_id IS NOT NULL AND project_id IS NULL) OR
        (kind='project' AND owner_user_id IS NULL AND project_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_personal_owner ON knowledge_spaces(owner_user_id) WHERE kind='personal';
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_project_owner ON knowledge_spaces(project_id) WHERE kind='project';
CREATE TABLE IF NOT EXISTS knowledge_folders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id uuid NOT NULL REFERENCES knowledge_spaces(id),
 parent_id uuid REFERENCES knowledge_folders(id), name text NOT NULL CHECK(length(btrim(name))>0),
 revision integer NOT NULL DEFAULT 1, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_folder_sibling ON knowledge_folders(space_id,coalesce(parent_id,'00000000-0000-0000-0000-000000000000'::uuid),name) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS knowledge_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id uuid NOT NULL REFERENCES knowledge_spaces(id),
 folder_id uuid REFERENCES knowledge_folders(id), title text NOT NULL CHECK(length(btrim(title))>0),
 markdown text NOT NULL DEFAULT '', revision integer NOT NULL DEFAULT 1, content_hash text NOT NULL,
 deleted_at timestamptz, created_by uuid NOT NULL REFERENCES users(id), updated_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple',title || ' ' || markdown)) STORED
);
CREATE INDEX IF NOT EXISTS knowledge_document_space ON knowledge_documents(space_id,updated_at DESC,id);
CREATE INDEX IF NOT EXISTS knowledge_document_fts ON knowledge_documents USING gin(search_vector);
CREATE TABLE IF NOT EXISTS knowledge_versions (
 document_id uuid NOT NULL REFERENCES knowledge_documents(id), revision integer NOT NULL,
 title text NOT NULL, markdown text NOT NULL, content_hash text NOT NULL, folder_id uuid,
 deleted_at timestamptz, actor_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(document_id,revision)
);
CREATE TABLE IF NOT EXISTS knowledge_tags (
 document_id uuid NOT NULL REFERENCES knowledge_documents(id), tag text NOT NULL,
 PRIMARY KEY(document_id,tag)
);
CREATE INDEX IF NOT EXISTS knowledge_tag_lookup ON knowledge_tags(tag,document_id);
CREATE TABLE IF NOT EXISTS knowledge_document_names (
 document_id uuid NOT NULL REFERENCES knowledge_documents(id), space_id uuid NOT NULL REFERENCES knowledge_spaces(id), name text NOT NULL,
 PRIMARY KEY(document_id,name)
);
CREATE INDEX IF NOT EXISTS knowledge_name_lookup ON knowledge_document_names(space_id,name);
CREATE TABLE IF NOT EXISTS knowledge_links (
 source_id uuid NOT NULL REFERENCES knowledge_documents(id), ordinal integer NOT NULL,
 target_text text NOT NULL, display_text text, target_id uuid REFERENCES knowledge_documents(id),
 bound_target_id uuid REFERENCES knowledge_documents(id),
 candidates uuid[] NOT NULL DEFAULT '{}', status text NOT NULL CHECK(status IN ('resolved','missing','ambiguous')),
 PRIMARY KEY(source_id,ordinal)
);
CREATE INDEX IF NOT EXISTS knowledge_backlinks ON knowledge_links(target_id,source_id);
CREATE TABLE IF NOT EXISTS knowledge_operations (
 actor_id uuid NOT NULL REFERENCES users(id), operation_id uuid NOT NULL, space_id uuid REFERENCES knowledge_spaces(id),
 payload_hash text NOT NULL, receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,operation_id)
);
CREATE TABLE IF NOT EXISTS knowledge_audit (
 id bigserial PRIMARY KEY, actor_id uuid NOT NULL REFERENCES users(id), space_id uuid NOT NULL REFERENCES knowledge_spaces(id),
 operation_id uuid NOT NULL, action text NOT NULL, target_id uuid, revision integer, created_at timestamptz NOT NULL DEFAULT now()
);
-- Reserved model only; no P1 API grants access through these rows.
CREATE TABLE IF NOT EXISTS knowledge_document_project_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid NOT NULL REFERENCES knowledge_documents(id),
 target_project_id uuid NOT NULL REFERENCES projects(id), granted_by_owner uuid NOT NULL REFERENCES users(id),
 capability text NOT NULL CHECK(capability IN ('read','reference')), pinned_revision integer, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
