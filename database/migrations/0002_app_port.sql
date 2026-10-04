-- Optional published port for public apps (Tunnel replica friendly)
ALTER TABLE applications ADD COLUMN port INTEGER;
