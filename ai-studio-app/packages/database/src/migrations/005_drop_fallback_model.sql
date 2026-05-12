ALTER TABLE agents DROP COLUMN IF EXISTS fallback_model_id;

INSERT INTO schema_migrations (version, name) VALUES (5, 'drop_fallback_model');
