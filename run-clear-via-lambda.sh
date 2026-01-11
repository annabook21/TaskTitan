#!/bin/bash

# This script invokes the migration Lambda to clear all data

echo "🗑️  Clearing all data from TaskTitan database via Lambda..."
echo ""
echo "⚠️  WARNING: This will delete:"
echo "   - All teams"
echo "   - All projects"
echo "   - All components"
echo "   - All sprints"
echo "   - All memberships"
echo "   - All activities, assignments, and dependencies"
echo ""
echo "   Users will be preserved (Cognito-managed)"
echo ""
read -p "Are you sure you want to proceed? (type 'yes' to confirm): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 1
fi

# Create Lambda payload
cat > /tmp/clear-data-payload.json << 'EOF'
{
  "command": "custom",
  "sql": [
    "DELETE FROM \"Activity\";",
    "DELETE FROM \"Assignment\";",
    "DELETE FROM \"Dependency\";",
    "DELETE FROM \"Component\";",
    "DELETE FROM \"Sprint\";",
    "DELETE FROM \"Project\";",
    "DELETE FROM \"Membership\";",
    "DELETE FROM \"Team\";"
  ]
}
EOF

echo ""
echo "Invoking Lambda function..."

aws lambda invoke \
  --function-name TaskTitanStack-WebappMigrationRunnerAC67C012-DjTW509ewwrC \
  --payload file:///tmp/clear-data-payload.json \
  --cli-binary-format raw-in-base64-out \
  /tmp/clear-data-response.json

echo ""
echo "Response:"
cat /tmp/clear-data-response.json | jq .

echo ""
echo "✨ Database cleared! You can now create new teams with proper ownership."
