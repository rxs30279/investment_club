-- Create unit_values table for storing extracted unit value data
CREATE TABLE IF NOT EXISTS unit_values (
  id SERIAL PRIMARY KEY,
  valuation_date DATE NOT NULL UNIQUE,
  unit_value DECIMAL(10, 2) NOT NULL,
  total_assets DECIMAL(12, 2),
  total_units DECIMAL(12, 2),
  source_report_id INTEGER REFERENCES treasurer_reports(id),
  extracted_text TEXT,
  confidence INTEGER DEFAULT 0,
  manually_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster date-based queries
CREATE INDEX IF NOT EXISTS idx_unit_values_date ON unit_values(valuation_date);

-- Create index for source report lookups
CREATE INDEX IF NOT EXISTS idx_unit_values_source_report ON unit_values(source_report_id);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_unit_values_updated_at ON unit_values;
CREATE TRIGGER update_unit_values_updated_at
    BEFORE UPDATE ON unit_values
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add unit_value, total_assets, and total_units columns to treasurer_reports if they don't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'treasurer_reports' AND column_name = 'unit_value') THEN
        ALTER TABLE treasurer_reports ADD COLUMN unit_value DECIMAL(10, 2);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'treasurer_reports' AND column_name = 'total_assets') THEN
        ALTER TABLE treasurer_reports ADD COLUMN total_assets DECIMAL(12, 2);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'treasurer_reports' AND column_name = 'total_units') THEN
        ALTER TABLE treasurer_reports ADD COLUMN total_units DECIMAL(12, 2);
    END IF;
END $$;