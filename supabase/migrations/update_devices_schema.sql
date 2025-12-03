-- Update devices table to support Azure devices and track if device is in NinjaOne
-- Make ninja_device_id nullable (Azure devices won't have this)
ALTER TABLE devices ALTER COLUMN ninja_device_id DROP NOT NULL;

-- Add azure_device_id column for Azure device tracking
ALTER TABLE devices ADD COLUMN IF NOT EXISTS azure_device_id VARCHAR(255);

-- Add is_in_ninja flag to track if device exists in NinjaOne
ALTER TABLE devices ADD COLUMN IF NOT EXISTS is_in_ninja BOOLEAN DEFAULT false;

-- Add unique constraint on azure_device_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_azure_id ON devices(azure_device_id) WHERE azure_device_id IS NOT NULL;

-- Add index for filtering by is_in_ninja
CREATE INDEX IF NOT EXISTS idx_devices_is_in_ninja ON devices(is_in_ninja);

