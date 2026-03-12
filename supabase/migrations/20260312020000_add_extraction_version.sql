-- Track extraction pipeline version per paper for automatic re-extraction on updates
ALTER TABLE papers ADD COLUMN extraction_version int NOT NULL DEFAULT 0;
