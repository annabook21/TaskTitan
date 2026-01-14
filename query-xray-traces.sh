#!/bin/bash
# Query X-Ray traces for TaskTitan auth performance analysis
# Usage: ./query-xray-traces.sh [minutes] [filter-type]
# Examples:
#   ./query-xray-traces.sh 10              # Last 10 minutes, all traces
#   ./query-xray-traces.sh 15 cold-start    # Last 15 minutes, cold starts only
#   ./query-xray-traces.sh 30 slow          # Last 30 minutes, slow traces (>500ms)

set -e

MINUTES=${1:-10}
FILTER_TYPE=${2:-all}
REGION=${AWS_REGION:-us-east-1}
SERVICE_NAME=${XRAY_SERVICE_NAME:-TaskTitanWebapp}

# Calculate timestamps (works on macOS and Linux)
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  END_TIME=$(date -u +%s)
  START_TIME=$(date -u -v-${MINUTES}M +%s)
else
  # Linux
  END_TIME=$(date -u +%s)
  START_TIME=$(date -u -d "${MINUTES} minutes ago" +%s)
fi

echo "Querying X-Ray traces for service: $SERVICE_NAME"
echo "Time range: Last $MINUTES minutes"
echo "Region: $REGION"
echo "Tip: set XRAY_SERVICE_NAME to your Lambda function name if needed"
echo ""

# Build filter expression based on filter type
case $FILTER_TYPE in
  cold-start)
    FILTER_EXPR='service("'$SERVICE_NAME'") AND annotation.cold_start = true'
    echo "Filter: Cold start traces only"
    ;;
  unauthenticated)
    FILTER_EXPR='service("'$SERVICE_NAME'") AND annotation.authenticated = false'
    echo "Filter: Unauthenticated requests only"
    ;;
  sign-in)
    FILTER_EXPR='service("'$SERVICE_NAME'") AND annotation.auth_action = "sign-in"'
    echo "Filter: Sign-in auth action only"
    ;;
  slow)
    FILTER_EXPR='service("'$SERVICE_NAME'") AND duration > 500'
    echo "Filter: Slow traces (>500ms) only"
    ;;
  auth-middleware)
    FILTER_EXPR='service("'$SERVICE_NAME'") AND name = "auth-middleware"'
    echo "Filter: Auth middleware subsegments only"
    ;;
  *)
    FILTER_EXPR='service("'$SERVICE_NAME'")'
    echo "Filter: All traces"
    ;;
esac

echo ""

# Query traces
RESULT=$(aws xray get-trace-summaries \
  --start-time "$START_TIME" \
  --end-time "$END_TIME" \
  --filter-expression "$FILTER_EXPR" \
  --region "$REGION" \
  2>&1)

if [ $? -ne 0 ]; then
  echo "Error querying X-Ray:"
  echo "$RESULT"
  exit 1
fi

# Parse and display results
TRACE_COUNT=$(echo "$RESULT" | jq -r '.TraceSummaries | length')
echo "Found $TRACE_COUNT trace(s)"
echo ""

if [ "$TRACE_COUNT" -eq 0 ]; then
  echo "No traces found. Try:"
  echo "  - Increasing the time range (e.g., 30 minutes)"
  echo "  - Checking that traces are being generated (visit your app)"
  echo "  - Verifying the service name matches: $SERVICE_NAME"
  exit 0
fi

# Display summary table
echo "Trace Summary:"
echo "=============="
echo "$RESULT" | jq -r '.TraceSummaries[] | 
  "Trace ID: \(.Id) 
  Duration: \((if .Duration then (.Duration * 1000 | floor) else "N/A" end))ms
  Response Time: \((if .ResponseTime then (.ResponseTime * 1000 | floor) else "N/A" end))ms
  Has Error: \(.HasError // false)
  HTTP Status: \(.Http.HttpStatus // "N/A")
  Timestamp: \(.StartTime // "N/A")
  ---"'

# Show trace IDs for detailed inspection
echo ""
echo "Trace IDs (use these to get full details):"
echo "$RESULT" | jq -r '.TraceSummaries[].Id' | while read -r trace_id; do
  echo "  $trace_id"
done

echo ""
echo "To get detailed trace information, run:"
echo "  aws xray batch-get-traces --trace-ids <TRACE_ID> --region $REGION | jq '.Traces[0]'"