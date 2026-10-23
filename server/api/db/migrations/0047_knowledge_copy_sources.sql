-- Additive provenance only. No user documents, canvas history or revisions are rewritten.
CREATE TABLE IF NOT EXISTS knowledge_copy_sources (
 document_id uuid PRIMARY KEY REFERENCES knowledge_documents(id),
 source_space_id uuid NOT NULL,
 source_document_id uuid NOT NULL,
 source_revision integer NOT NULL CHECK (source_revision > 0),
 source_hash text NOT NULL,
 copied_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
