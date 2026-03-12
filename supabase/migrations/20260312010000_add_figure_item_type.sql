-- Add item_type column to figures table to distinguish figures from tables
ALTER TABLE figures ADD COLUMN item_type text NOT NULL DEFAULT 'figure';

-- Update index to include item_type for filtered queries
CREATE INDEX idx_figures_paper_type ON figures (paper_id, item_type, figure_no);
