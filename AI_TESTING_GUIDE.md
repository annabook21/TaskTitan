# AI Features Testing Guide

This guide provides step-by-step instructions for testing all 10 AI features with Team Bravo demo data after deploying to AWS.

## Prerequisites

1. **Deploy to AWS**:
```bash
cd cdk
npm run build
npm run cdk deploy
```

2. **Generate Team Bravo Data**:
   - Navigate to your deployed app (e.g., `https://tasktitan.live`)
   - Sign in with your AWS Cognito account
   - Click your profile (top right) → "Seed Team Bravo Data"
   - Wait ~5-10 seconds for data generation
   - Verify success message appears

3. **Access CloudWatch Logs**:
```bash
# Monitor for errors during testing
aws logs tail /aws/lambda/TaskTitanWebapp --follow
```

---

## Test 1: Component Generation (✅ Already uses sentinels)

**Purpose**: Verify AI can generate component hierarchies from natural language

**Steps**:
1. Navigate to Team Bravo → Projects → Customer Portal
2. Find the "AI Generate Components" button
3. Enter prompt: `"Add user profile editing with avatar upload and image cropping"`
4. Click "Generate Components"
5. Wait ~5-10 seconds

**Expected Results**:
- Components created with hierarchy (Feature → Stories → Tasks)
- No parsing errors in CloudWatch logs
- Components have proper names, descriptions, estimates

**Validation**:
```bash
# Check for JSON parsing errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/TaskTitanWebapp \
  --filter-pattern "JSON.parse" \
  --start-time $(date -u -d '5 minutes ago' +%s)000
```

---

## Test 2: AI Sprint Planning

**Purpose**: Verify AI can suggest components to add to sprint based on capacity

**Steps**:
1. Navigate to Team Bravo → Sprints → Sprint 1
2. Click "AI Plan Sprint" button
3. Set capacity: 40 hours
4. Click "Generate Plan"
5. Wait ~5-10 seconds

**Expected Results**:
- AI suggests components with reasoning
- Total hours displayed (should be ≤40)
- Warnings shown if any (e.g., missing dependencies)
- "Apply Plan" button enabled if components found

**Validation**:
- Check CloudWatch for `planSprint` function logs
- Verify JSON response includes `selectedComponentIds`, `totalHours`, `reasoning`, `warnings`

---

## Test 3: AI Sprint Suggestion

**Purpose**: Verify AI can suggest sprint name, goal, and capacity based on backlog

**Steps**:
1. Navigate to Team Bravo → Sprints
2. Click "Create New Sprint"
3. Click "AI Suggest Sprint Details" button
4. Wait ~5-10 seconds

**Expected Results**:
- Name suggestion (e.g., "Sprint 3: Payment & Order Processing")
- Goal suggestion (2-3 sentences)
- Recommended capacity (e.g., 40-60 hours)
- Reasoning explaining the suggestions

**Validation**:
- Check CloudWatch for `suggestSprintDetails` function logs
- Verify all fields populated in form

---

## Test 4: Natural Language Component Creation

**Purpose**: Verify AI can create single component from natural language

**Steps**:
1. Navigate to any Team Bravo project
2. Find the natural language input field
3. Enter: `"Create a feature for real-time notifications using WebSocket connections"`
4. Click "Create Component"
5. Wait ~5 seconds

**Expected Results**:
- Component created with:
  - Proper name (e.g., "Real-time WebSocket Notifications")
  - Detailed description
  - Estimated hours (e.g., 8-16)
  - Priority (e.g., MEDIUM)
  - Acceptance criteria (3-5 bullet points)

**Validation**:
- Check CloudWatch for `createComponentFromNaturalLanguage` logs
- Verify component appears in project backlog

---

## Test 5: Component Breakdown Suggestions

**Purpose**: Verify AI can suggest breaking down large components

**Steps**:
1. Navigate to "Product Catalog & Inventory Management" epic
2. Click "AI Suggest Breakdown" button
3. Wait ~10 seconds

**Expected Results**:
- Suggested Features/Stories with:
  - Names and descriptions
  - Estimated hours
  - Priorities
  - Dependencies noted
- Overall strategy explanation

**Validation**:
- Check CloudWatch for `suggestComponentBreakdown` logs
- Suggestions should be realistic and follow best practices

---

## Test 6: Component Template Application

**Purpose**: Verify AI can apply templates with context

**Steps**:
1. Navigate to any Team Bravo project
2. Click "Apply Template" button
3. Select "CRUD Operations" template
4. Context: `"User profile management with privacy settings"`
5. Click "Apply Template"
6. Wait ~10 seconds

**Expected Results**:
- Multiple components created:
  - List View (with filtering/sorting)
  - Create Form
  - Edit Form
  - Delete Confirmation
  - API Routes
- Implementation notes provided

**Validation**:
- Check CloudWatch for `applyComponentTemplate` logs
- All components should appear in project

---

## Test 7: Context Summarization

**Purpose**: Verify AI can summarize decision context

**Steps**:
1. Find component with context (e.g., "OAuth Integration")
2. Click to expand context panel
3. Click "Generate AI Summary" button
4. Wait ~5 seconds

**Expected Results**:
- Summary appears with:
  - Key points (2-3 sentences)
  - Decision highlights
  - Alternative approaches mentioned
  - Reasoning captured

**Validation**:
- Check CloudWatch for `summarizeComponentContext` logs
- Summary should be concise and accurate

---

## Test 8: Wireframe Generation ⭐

**Purpose**: Verify AI can generate HTML wireframes from component descriptions

**Steps**:
1. Find "Stripe Payment Integration" component
2. Scroll to "Generate Wireframe" button (sparkle icon)
3. Click button
4. Wait ~10-15 seconds
5. Click "View Wireframe" when ready
6. Click "Export" to download HTML

**Expected Results**:
- HTML wireframe renders in modal with:
  - Semantic HTML structure
  - Tailwind CSS styling
  - Interactive elements (forms, buttons)
  - Realistic layout
- Export downloads standalone HTML file

**Validation**:
- Check CloudWatch for `generateWireframe` logs
- Verify S3 upload succeeded
- HTML should be valid and render properly

**Try Other Components**:
- "Product Variant System" → Complex form with dropdowns
- "OAuth Integration" → Login flow with social buttons

---

## Test 9: Import Data Cleanup

**Purpose**: Verify AI can clean and structure messy import data

**Steps**:
1. Create test CSV file:
```csv
Name,Description,Status
Login Page,user can login,in prog
Sign Up,user registration form,todo
Reset Pass,forgot password flow,
```

2. Navigate to any project → Import Data
3. Upload CSV file
4. Wait ~5-10 seconds

**Expected Results**:
- Data cleaned:
  - "in prog" → "IN_PROGRESS"
  - "todo" → "PLANNING"
  - Empty status filled with "PLANNING"
- Warnings shown for any issues
- Components ready for import

**Validation**:
- Check CloudWatch for `cleanupImportData` logs
- Verify JSON response has `components` and `warnings` arrays

---

## Test 10: Import Data Analysis

**Purpose**: Verify AI can analyze import data and suggest project structure

**Steps**:
1. Export GitHub issues to JSON
2. Navigate to Import Data
3. Upload JSON file
4. Wait ~10 seconds

**Expected Results**:
- AI suggests:
  - Project name
  - Project description
  - Component hierarchy (Epics → Features → Stories)
  - Priorities assigned
  - Estimates provided

**Validation**:
- Check CloudWatch for `analyzeImportData` logs
- Suggestions should be organized and realistic

---

## CloudWatch Monitoring

### Check for Parsing Errors
```bash
aws logs filter-log-events \
  --log-group-name /aws/lambda/TaskTitanWebapp \
  --filter-pattern "JSON.parse" \
  --start-time $(date -u -d '30 minutes ago' +%s)000
```

### Check for Bedrock API Errors
```bash
aws logs filter-log-events \
  --log-group-name /aws/lambda/TaskTitanWebapp \
  --filter-pattern "Bedrock" \
  --start-time $(date -u -d '30 minutes ago' +%s)000
```

### Monitor Function Execution Times
```bash
aws logs filter-log-events \
  --log-group-name /aws/lambda/TaskTitanWebapp \
  --filter-pattern "Duration:" \
  --start-time $(date -u -d '30 minutes ago' +%s)000
```

---

## Success Criteria

All tests should pass with:
- ✅ **Zero JSON parsing errors** in CloudWatch logs
- ✅ **All AI features return valid responses** within 15 seconds
- ✅ **Sentinel delimiters working** (check raw Bedrock responses if needed)
- ✅ **Fallback parsing never needed** (sentinels should always be present)
- ✅ **Cost per request** within expected range (~$0.01-0.05)

---

## Troubleshooting

### Issue: JSON Parsing Errors
- **Cause**: Claude not following sentinel delimiter instructions
- **Fix**: Check prompt includes example with `<<<JSON` / `JSON>>>`
- **Fallback**: 3-tier strategy should catch this automatically

### Issue: Slow Response Times
- **Cause**: Large context or complex prompts
- **Fix**: Check token count in CloudWatch logs
- **Expected**: 2-10 seconds for most operations

### Issue: Bedrock Throttling
- **Cause**: Too many requests (10/min default quota)
- **Fix**: Request quota increase in AWS Console
- **Temporary**: Add exponential backoff retry logic

### Issue: Wireframe Generation Fails
- **Cause**: Component description too vague
- **Fix**: Ensure description has UI/UX details
- **Check**: S3 bucket permissions for upload

---

## Cost Analysis

After running all 10 tests:

```bash
# Check Bedrock API costs (approximate)
aws ce get-cost-and-usage \
  --time-period Start=$(date -u -d '1 day ago' +%Y-%m-%d),End=$(date -u +%Y-%m-%d) \
  --granularity DAILY \
  --metrics "UnblendedCost" \
  --filter file://bedrock-filter.json
```

**Expected Cost per Test**:
- Component Generation: ~$0.02-0.05
- Sprint Planning: ~$0.03-0.06
- Wireframe Generation: ~$0.05-0.10
- Context Summarization: ~$0.01-0.02
- **Total Test Suite**: ~$0.30-0.50

---

## Next Steps After Testing

1. **If all tests pass**:
   - Document results in shareholder demo notes
   - Schedule demo walkthrough
   - Prepare fallback plan for live demo

2. **If any tests fail**:
   - Review CloudWatch logs for specific errors
   - Check if sentinel delimiters are in response
   - Verify Bedrock model ID is correct
   - Test individual function in isolation

3. **Performance Optimization** (if needed):
   - Reduce prompt verbosity
   - Cache common responses
   - Implement request batching

---

## Demo Day Checklist

Before shareholder demo:
- [ ] All 10 AI features tested successfully
- [ ] Team Bravo data regenerated (fresh state)
- [ ] CloudWatch dashboard open for monitoring
- [ ] Fallback plan documented (what to do if AI fails live)
- [ ] Screenshots prepared as backup
- [ ] Cost monitoring enabled
- [ ] Rollback plan ready (previous deployment available)

**Good luck with the demo!** 🚀
