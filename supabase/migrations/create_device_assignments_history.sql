-- Device Assignments History Table
-- Tracks all device-to-user assignments over time, including previous assignments

CREATE TABLE IF NOT EXISTS device_assignments_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE NOT NULL,
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
    azure_device_id VARCHAR(255), -- Azure device ID for tracking
    assignment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(), -- When device was assigned to this user
    unassignment_date TIMESTAMP WITH TIME ZONE, -- When device was unassigned from this user (NULL if current)
    registered_date TIMESTAMP WITH TIME ZONE, -- Azure registration date for this user
    is_current BOOLEAN DEFAULT true, -- True if this is the current assignment
    sync_id UUID REFERENCES sync_logs(id) ON DELETE SET NULL, -- Which sync created this record
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_device_assignments_history_device_id ON device_assignments_history(device_id);
CREATE INDEX IF NOT EXISTS idx_device_assignments_history_employee_id ON device_assignments_history(employee_id);
CREATE INDEX IF NOT EXISTS idx_device_assignments_history_azure_device_id ON device_assignments_history(azure_device_id);
CREATE INDEX IF NOT EXISTS idx_device_assignments_history_is_current ON device_assignments_history(is_current);
CREATE INDEX IF NOT EXISTS idx_device_assignments_history_employee_current ON device_assignments_history(employee_id, is_current) WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_device_assignments_history_employee_previous ON device_assignments_history(employee_id, is_current) WHERE is_current = false;

-- RLS Policies
ALTER TABLE device_assignments_history ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything (for API routes)
CREATE POLICY "Service role can do everything on device_assignments_history"
    ON device_assignments_history
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Policy: Authenticated users can read their own device assignment history
CREATE POLICY "Users can read their own device assignment history"
    ON device_assignments_history
    FOR SELECT
    TO authenticated
    USING (
        auth.uid()::text = (
            SELECT entra_id FROM employees WHERE id = device_assignments_history.employee_id
        )
    );


