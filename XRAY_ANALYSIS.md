# X-Ray Trace Analysis - Auth Redirect Performance

## Analysis Date
2026-01-14 (Last 30 minutes of traces)

## Key Findings

### Slow 302 Redirect Trace
**Trace ID:** `1-69679669-027ad4c06f0389d22c44b361`  
**Total Duration:** 1,821ms (1.8 seconds)  
**HTTP Status:** 302 (Redirect to Cognito)

**Breakdown:**
- **Cold Start Init:** 1,366ms (75% of total time) ⚠️
- **Lambda Execution:** 182ms (10% of total time)
- **Overhead:** 10ms
- **Total:** ~1,558ms (remaining time likely network/CloudFront overhead)

### Other Redirect Traces
Most other 302 redirects are fast:
- Fastest: 16ms
- Average (excluding slow one): ~40ms
- Slowest (excluding the 1.8s one): 343ms

### Cold Start Impact
The slow trace shows a **cold start initialization taking 1.36 seconds**. This is the primary bottleneck for the first request after Lambda goes cold.

## Root Cause Analysis

### Primary Issue: Lambda Cold Starts
1. **Cold Start Init: 1,366ms** - This is the main culprit
   - Module initialization
   - SSM parameter fetch (if no custom domain)
   - Next.js server initialization
   - Dependency loading

2. **Actual Execution: 182ms** - Once warm, execution is fast
   - Auth middleware check
   - Redirect generation

### Current Infrastructure
- **Provisioned Concurrency:** 1 (configured in `cdk/lib/constructs/webapp.ts`)
- **Memory:** 1024 MB
- **Architecture:** ARM64

## Recommendations

### Immediate Actions

1. **Deploy the new instrumentation code** to get detailed subsegment data:
   - SSM fetch timing
   - Auth middleware timing
   - Auth route handler timing
   - Cold start detection

2. **Increase Provisioned Concurrency** (if budget allows):
   ```typescript
   // In cdk/lib/constructs/webapp.ts
   provisionedConcurrentExecutions: 2, // Increase from 1
   ```
   - Cost: ~$13.50/month per concurrent execution
   - Benefit: Reduces cold starts for concurrent requests

### Medium-term Optimizations

3. **Use Custom Domain** (if not already):
   - Eliminates SSM parameter fetch entirely
   - Reduces cold start time by ~50-100ms

4. **Monitor Cold Start Frequency**:
   - After deploying instrumentation, check CloudWatch Logs for `cold_start: true`
   - If cold starts are frequent, consider increasing provisioned concurrency

5. **Optimize Bundle Size**:
   - Review Next.js bundle size
   - Consider code splitting for auth routes
   - Lazy load non-critical dependencies

## Next Steps

1. **Deploy the new code** with X-Ray instrumentation
2. **Trigger auth flows** to generate new traces
3. **Query X-Ray again** to see detailed subsegments:
   ```bash
   ./query-xray-traces.sh 10 all
   ```
4. **Check CloudWatch Logs** for structured timing logs:
   ```bash
   # In CloudWatch Logs Insights
   fields @timestamp, extra.duration_ms, extra.cold_start
   | filter message = "Auth middleware completed"
   | sort extra.duration_ms desc
   ```

## Expected Improvements After Deployment

Once the new instrumentation is deployed, you'll be able to see:
- Exact SSM fetch duration (if applicable)
- Auth middleware execution time breakdown
- Auth route handler timing
- Cold start vs warm start comparison
- Annotation-based filtering in X-Ray console

## AWS CLI Commands Used

```bash
# Get all traces
aws xray get-trace-summaries \
  --start-time $(date -u -v-30M +%s) \
  --end-time $(date -u +%s) \
  --filter-expression 'service("TaskTitanStack-WebappHandler8DD158A3-KQugXm0kfLsb")' \
  --region us-east-1

# Get 302 redirects
aws xray get-trace-summaries \
  --start-time $(date -u -v-30M +%s) \
  --end-time $(date -u +%s) \
  --filter-expression 'service("TaskTitanStack-WebappHandler8DD158A3-KQugXm0kfLsb") AND http.status = 302' \
  --region us-east-1

# Get detailed trace
aws xray batch-get-traces \
  --trace-ids "1-69679669-027ad4c06f0389d22c44b361" \
  --region us-east-1
```