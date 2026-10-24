-- Additive staging only. Originals referenced by documents are never garbage collected.
CREATE TABLE knowledge_imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id uuid NOT NULL REFERENCES knowledge_spaces(id),
 actor_id uuid NOT NULL REFERENCES users(id), operation_id uuid NOT NULL, payload_hash text NOT NULL,
 filename text NOT NULL, extension text NOT NULL, mime_type text NOT NULL, sha256 text NOT NULL,
 bytes bigint NOT NULL, storage_key text NOT NULL UNIQUE, folder_id uuid REFERENCES knowledge_folders(id),
 state text NOT NULL CHECK(state IN ('uploading','queued','parsing','awaiting_confirmation','failed','completed','cancelled','cleaning','cleaned')),
 markdown text, converter text, warnings jsonb NOT NULL DEFAULT '[]', pages jsonb NOT NULL DEFAULT '[]',
 assets jsonb NOT NULL DEFAULT '[]', metrics jsonb NOT NULL DEFAULT '{}', error text,
 document_id uuid REFERENCES knowledge_documents(id), document_revision integer,
 reparse_document_id uuid REFERENCES knowledge_documents(id), expected_revision integer,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_id,operation_id)
);
CREATE INDEX knowledge_import_space_hash ON knowledge_imports(space_id,sha256);
CREATE INDEX knowledge_import_pending ON knowledge_imports(state,created_at);
