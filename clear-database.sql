-- SQL Script to Clear All Data from TaskTitan Database
-- This will delete all teams, projects, sprints, etc.
-- Users are preserved as they come from Cognito

-- WARNING: This will delete ALL your data!
-- Make sure you want to proceed before running this.

BEGIN;

-- Delete in the correct order to respect foreign key constraints

-- 1. Delete Activities (depends on Project and User)
DELETE FROM "Activity";

-- 2. Delete Assignments (depends on Component and User)
DELETE FROM "Assignment";

-- 3. Delete Dependencies (depends on Component)
DELETE FROM "Dependency";

-- 4. Delete Components (depends on Project, Sprint, and Parent Component)
DELETE FROM "Component";

-- 5. Delete Sprints (depends on Team)
DELETE FROM "Sprint";

-- 6. Delete Projects (depends on Team and User)
DELETE FROM "Project";

-- 7. Delete Memberships (depends on Team and User)
DELETE FROM "Membership";

-- 8. Delete Teams (root table)
DELETE FROM "Team";

-- Note: We do NOT delete Users as they are managed by Cognito

COMMIT;

-- Verify the cleanup
SELECT
    'Activities' as table_name, COUNT(*) as remaining_rows FROM "Activity"
UNION ALL SELECT 'Assignments', COUNT(*) FROM "Assignment"
UNION ALL SELECT 'Dependencies', COUNT(*) FROM "Dependency"
UNION ALL SELECT 'Components', COUNT(*) FROM "Component"
UNION ALL SELECT 'Sprints', COUNT(*) FROM "Sprint"
UNION ALL SELECT 'Projects', COUNT(*) FROM "Project"
UNION ALL SELECT 'Memberships', COUNT(*) FROM "Membership"
UNION ALL SELECT 'Teams', COUNT(*) FROM "Team"
UNION ALL SELECT 'Users (preserved)', COUNT(*) FROM "User";
