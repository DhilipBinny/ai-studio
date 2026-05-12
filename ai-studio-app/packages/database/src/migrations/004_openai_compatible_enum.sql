ALTER TYPE provider_type ADD VALUE IF NOT EXISTS 'openai_compatible' AFTER 'custom';

INSERT INTO schema_migrations (version, name) VALUES (4, 'openai_compatible_enum');
