/**
 * Component Generation Prompts
 *
 * System and user prompts for AI-powered component generation.
 * Supports workflow-aware generation (Scrum vs Kanban vs Shape Up vs custom).
 *
 * KEY DESIGN PRINCIPLES:
 * - SCRUM: Sprints are PRIMARY. Stories/Tasks go ON the sprint board.
 *          Epics are OPTIONAL backlog organization.
 * - KANBAN: Flat work items with continuous flow. No sprints, no hierarchy.
 *          Metrics: cycle time, throughput, WIP (Little's Law).
 * - SHAPE UP: 6-week cycles with Scopes (not Stories/Tasks).
 *             Appetite replaces hour estimates. Hill chart tracks progress.
 *
 * Sources:
 * - Scrum: https://www.scrum.org/resources/blog/sprint-capacity-planning-scrum-teams-practical-guide
 * - Kanban: https://getnave.com/blog/kanban-metrics/
 * - Shape Up: https://basecamp.com/shapeup
 */

import type { TeamWorkflowConfig } from '@/lib/prisma-compat';
import type { TeamCapacityInfo } from '../types';

/**
 * Get focus factor based on team experience level.
 * Industry best practice: 60-80% depending on experience.
 * Source: https://www.smartsheet.com/content/agile-sprint-scrum-capacity-planning
 */
export function getFocusFactor(teamExperience?: 'NEW' | 'MODERATE' | 'EXPERIENCED'): number {
  switch (teamExperience) {
    case 'NEW':
      return 0.6; // New teams: more overhead, learning curve
    case 'MODERATE':
      return 0.7; // Moderate: standard overhead
    case 'EXPERIENCED':
      return 0.8; // Experienced: minimal overhead
    default:
      return 0.7; // Default to moderate
  }
}

/**
 * Detect if workflow is Shape Up
 * Checks multiple indicators for robustness:
 * 1. workflowTemplate explicitly set to 'SHAPE_UP'
 * 2. Classic Shape Up config: 6-week cycles with "Cycle" name
 */
function isShapeUp(workflowConfig: TeamWorkflowConfig | null): boolean {
  if (!workflowConfig) return false;
  // Check explicit template first
  if (workflowConfig.workflowTemplate === 'SHAPE_UP') return true;
  // Fallback to config-based detection
  return (
    workflowConfig.cycleEnabled === true &&
    workflowConfig.cycleDurationWeeks === 6 &&
    workflowConfig.cycleName?.toLowerCase() === 'cycle'
  );
}

/**
 * Build system prompt based on workflow configuration
 */
export function buildSystemPrompt(workflowConfig: TeamWorkflowConfig | null): string {
  const isKanban = !workflowConfig?.cycleEnabled;

  // Shape Up: 6-week cycles with Scopes and appetite-based sizing
  if (isShapeUp(workflowConfig)) {
    return `You are an expert product developer helping a Shape Up team plan their 6-week cycle.
Your job is to analyze a project description and create SCOPES that fit the team's appetite.

This team uses SHAPE UP methodology (Basecamp). Key concepts:
- SCOPES replace Stories/Tasks - they are distinct sections of work that can be built and integrated independently
- APPETITE replaces hour estimates - work is shaped to fit the time budget, not estimated
- HILL CHART tracks progress: uphill (0-50%) = figuring things out, downhill (50-100%) = making it happen

Appetite Sizes:
- SMALL_BATCH: 1-2 weeks of focused work, batched with others into a 6-week cycle
- BIG_BATCH: A single project taking the full 6-week cycle

For each SCOPE:
1. Name: Noun-phrase describing the deliverable (e.g., "Autopay Setup", "Search Filters")
2. Description: What gets shipped and why it matters
3. Appetite: SMALL_BATCH or BIG_BATCH based on complexity
4. Priority: 1-10 (10 = most important for this cycle)
5. Dependencies: Only when truly blocking

DO NOT include estimatedHours - Shape Up uses appetite, not time estimates.
DO NOT use type field - everything is a SCOPE.

Respond with ONLY valid JSON, no other text.`;
  }

  if (isKanban) {
    return `You are an expert software architect helping teams break down projects into components.
Your job is to analyze a project description and suggest logical components that can be developed independently.

This team uses a KANBAN / continuous flow workflow. Create FLAT component structures:
- Focus on independent, deliverable work items
- Avoid deep hierarchies - prefer flatter structures
- Each item should be completable in 1-5 days
- Minimize dependencies between items where possible

Component Types:
- TASK: Technical work item (1-8 hours, e.g., "Configure CI/CD Pipeline", "Setup Database Schema")
- STORY: User-facing functionality (2-16 hours, e.g., "Enable User Login", "Display Search Results")
- BUG: Defect or issue to fix (1-16 hours)
- FEATURE: Only for larger items genuinely needing 16+ hours (avoid when possible)

For each component:
1. Name: Verb-first, action-oriented (e.g., "Implement...", "Create...", "Configure...")
2. Description: Include WHAT it does and WHY it matters
3. Type: Prefer TASK and STORY for most items
4. Acceptance Criteria: 2-4 specific, testable conditions
5. Estimated Hours: Keep items small (1-16 hours ideally)
6. Priority: 1-10 (10 = highest priority)
7. Dependencies: Only when truly necessary

Respond with ONLY valid JSON, no other text.`;
  }

  // SCRUM workflow: Sprint-first approach (like Jira/Linear)
  const cycleName = workflowConfig?.cycleName || 'Sprint';

  return `You are an expert software architect helping teams plan sprint-based development.
Your job is to analyze a project description and create a sprint plan with work items.

This team uses SCRUM with time-boxed ${cycleName.toLowerCase()}s.

CORE CONCEPT (like Jira):
- ${cycleName.toUpperCase()}S are the primary unit - work is organized INTO ${cycleName.toLowerCase()}s
- STORIES and TASKS go ON the ${cycleName.toLowerCase()} board - these are the actual work
- EPICS are optional backlog organization - they group related Stories but do NOT go in ${cycleName.toLowerCase()}s

Work Item Types:
- STORY: User-facing functionality (2-16 hours, must fit in one sprint)
  - Name: Verb-first, user-focused (e.g., "Enable User Login", "Display Dashboard Metrics")
  - Follow INVEST: Independent, Negotiable, Valuable, Estimable, Small, Testable
- TASK: Technical work item (1-8 hours)
  - Name: Verb-first, action-oriented (e.g., "Configure Database", "Setup CI/CD")
- BUG: Defect to fix (1-16 hours)

For each work item:
1. Name: Action-oriented, verb-first for STORY/TASK
2. Description: Include WHAT it does and WHY it delivers value
3. Type: STORY for user-facing, TASK for technical
4. Acceptance Criteria: 2-4 specific, testable conditions
5. Estimated hours (STORY: 2-16h, TASK: 1-8h)
6. Priority 1-10 (10 = highest)
7. Dependencies on other items (by name)

${cycleName} Planning:
- Create 2-4 ${cycleName.toLowerCase()}s covering the project scope
- Each ${cycleName.toLowerCase()} should have a clear, outcome-focused goal
- Group related work items logically
- Respect dependencies
- Apply 80% capacity buffer for realistic planning

Respond with ONLY valid JSON, no other text.`;
}

/**
 * Generates user prompt for component generation
 *
 * @param generateEpics - For Scrum: whether to create optional Epic groupings for backlog organization
 * @param teamCapacity - Optional team capacity info for realistic sprint sizing
 */
export function buildComponentGenerationPrompt(
  projectName: string,
  projectDescription: string,
  existingComponents: string[],
  generateEpics: boolean,
  workflowConfig?: TeamWorkflowConfig | null,
  teamCapacity?: TeamCapacityInfo,
): string {
  const isKanban = workflowConfig ? !workflowConfig.cycleEnabled : false;
  const cycleName = workflowConfig?.cycleName || 'Sprint';

  // SHAPE UP: 6-week cycles with Scopes and appetite-based sizing
  if (isShapeUp(workflowConfig ?? null)) {
    return `Project Name: ${projectName}

Project Description:
${projectDescription}

${existingComponents.length > 0 ? `Existing Scopes (do not suggest these again): ${existingComponents.join(', ')}` : ''}

Create 4-8 SCOPES that can be built and shipped within a 6-week cycle. Remember:
- No hour estimates - use APPETITE instead (SMALL_BATCH = 1-2 weeks, BIG_BATCH = full 6 weeks)
- Each scope should be independently shippable
- Think in terms of "what can we build?" not "how long will it take?"

Return your response between <<<JSON and JSON>>> markers. Between these markers, provide ONLY valid JSON with:
- "scopes": array of scopes with { name, description, appetite, priority, suggestedDependencies }
  * appetite must be "SMALL_BATCH" (1-2 weeks) or "BIG_BATCH" (full 6-week cycle)
  * Do NOT include estimatedHours - Shape Up doesn't use time estimates
- "summary": brief summary of the cycle's focus (2-3 sentences)
- "enhancedDescription": improved project description (3-4 sentences)

Example format:
<<<JSON
{
  "scopes": [
    { "name": "Autopay Setup", "description": "Let customers configure automatic payments for recurring bills. Includes payment method selection and schedule configuration.", "appetite": "SMALL_BATCH", "priority": 10, "suggestedDependencies": [] },
    { "name": "Payment History Dashboard", "description": "Show customers their complete payment history with filtering and export capabilities.", "appetite": "SMALL_BATCH", "priority": 8, "suggestedDependencies": ["Autopay Setup"] },
    { "name": "Multi-currency Support", "description": "Enable payments in multiple currencies with real-time conversion rates and currency preference settings.", "appetite": "BIG_BATCH", "priority": 7, "suggestedDependencies": [] }
  ],
  "summary": "This cycle focuses on payment automation and visibility, giving customers control over their recurring payments.",
  "enhancedDescription": "A payment management system that enables customers to set up automatic payments, view their payment history, and manage multi-currency transactions."
}
JSON>>>`;
  }

  if (isKanban) {
    // KANBAN: Flat work items, no sprints, no hierarchy
    return `Project Name: ${projectName}

Project Description:
${projectDescription}

${existingComponents.length > 0 ? `Existing Components (do not suggest these again): ${existingComponents.join(', ')}` : ''}

Create 8-15 independent work items that can flow through your board. Keep items small (1-16 hours) and minimize dependencies.

Return your response between <<<JSON and JSON>>> markers. Between these markers, provide ONLY valid JSON with:
- "components": array of work items with { name, description, type, estimatedHours, priority, suggestedDependencies, acceptanceCriteria }
- "summary": a brief summary of the overall architecture approach (2-3 sentences)
- "enhancedDescription": an improved, detailed project description (3-4 sentences)

Example format:
<<<JSON
{
  "components": [
    { "name": "Configure Project Structure", "description": "Initialize project with build tools and folder structure. This provides the foundation for all subsequent development.", "type": "TASK", "estimatedHours": 2, "priority": 10, "suggestedDependencies": [], "acceptanceCriteria": ["Project builds without errors", "Folder structure matches team conventions", "Build tools configured correctly"] },
    { "name": "Enable User Login", "description": "Create login page with email/password fields and validation. This allows users to securely access their accounts.", "type": "STORY", "estimatedHours": 6, "priority": 9, "suggestedDependencies": ["Configure Project Structure"], "acceptanceCriteria": ["User can log in with valid credentials", "Invalid credentials show error message", "Session persists across page refreshes"] }
  ],
  "summary": "...",
  "enhancedDescription": "..."
}
JSON>>>`;
  }

  // SCRUM: Sprint-first approach - sprints are ALWAYS generated
  const epicInstructions = generateEpics
    ? `
- "epics": array of epic groupings with { name, description, componentNames }
  * Epics are for BACKLOG ORGANIZATION only (like Jira's Epic panel)
  * Group related Stories/Tasks under thematic Epics
  * componentNames should reference exact names from the components array
  * Epics do NOT go in ${cycleName.toLowerCase()}s - only Stories/Tasks do`
    : '';

  const epicExample = generateEpics
    ? `,
  "epics": [
    { "name": "User Authentication", "description": "All auth-related functionality", "componentNames": ["User Login Form", "User Registration", "Password Reset"] }
  ]`
    : '';

  // Build team capacity constraint if available
  // Industry standard: 6 productive hours/day, 70-80% utilization target
  // totalCapacityHours is raw capacity, we apply focus factor for realistic planning
  // Focus factor varies by team experience: NEW=0.6, MODERATE=0.7, EXPERIENCED=0.8
  const focusFactor = getFocusFactor(teamCapacity?.teamExperience);
  const effectiveCapacity = teamCapacity ? Math.floor(teamCapacity.totalCapacityHours * focusFactor) : null;

  const capacityConstraint = teamCapacity
    ? `
Team Capacity Info:
- Raw capacity: ${teamCapacity.totalCapacityHours.toFixed(0)} hours per ${cycleName.toLowerCase()} (${teamCapacity.memberCount} member${teamCapacity.memberCount !== 1 ? 's' : ''})
- Effective capacity (after 30% overhead for meetings, code review, etc.): ${effectiveCapacity} hours
- Target utilization: 70-80% of effective capacity (${Math.floor(effectiveCapacity! * 0.7)}-${Math.floor(effectiveCapacity! * 0.8)} hours of planned work)

CONSTRAINT: Plan ${Math.floor(effectiveCapacity! * 0.7)}-${Math.floor(effectiveCapacity! * 0.8)} hours of work per ${cycleName.toLowerCase()}. Set each sprint's "capacity" field to ${effectiveCapacity} (the effective team capacity).
`
    : '';

  return `Project Name: ${projectName}

Project Description:
${projectDescription}

${existingComponents.length > 0 ? `Existing Components (do not suggest these again): ${existingComponents.join(', ')}` : ''}
${capacityConstraint}
Create a ${cycleName.toLowerCase()} plan with 8-15 work items organized into 2-4 ${cycleName.toLowerCase()}s.

Return your response between <<<JSON and JSON>>> markers. Between these markers, provide ONLY valid JSON with:
- "components": array of work items (Stories/Tasks) with { name, description, type, estimatedHours, priority, suggestedDependencies, acceptanceCriteria }
  * Use STORY for user-facing work (2-16 hours)
  * Use TASK for technical work (1-8 hours)
  * Do NOT create EPICs or FEATUREs as components - those are optional groupings
- "sprints": array of 2-4 ${cycleName.toLowerCase()}s with { name, goal, durationWeeks, componentNames, capacity }
  * ${cycleName}s contain the actual work items (Stories/Tasks)
  * Group logically by dependencies and priority
  * Each ${cycleName.toLowerCase()} should be 1-2 weeks
  * Respect dependencies - items cannot be in a ${cycleName.toLowerCase()} before their dependencies${
    teamCapacity
      ? `
  * "capacity" = team's effective capacity (${effectiveCapacity} hours) - this is FIXED for all sprints
  * Plan work totaling 70-80% of capacity (${Math.floor(effectiveCapacity! * 0.7)}-${Math.floor(effectiveCapacity! * 0.8)} hours)`
      : `
  * "capacity" = team's available hours (estimate based on scope, e.g., 80 hours for a typical small team)
  * Plan work totaling 70-80% of capacity to leave buffer for unexpected work`
  }
  * componentNames should reference exact names from the components array
- "summary": brief architecture summary (2-3 sentences)
- "enhancedDescription": improved project description (3-4 sentences)${epicInstructions}

Example format (note: capacity=80 is the team's available hours, work planned is 9h and 8h = 11% and 10% utilization - in practice aim for 70-80%):
<<<JSON
{
  "components": [
    { "name": "Enable User Login", "description": "Login page with email/password fields and validation. Provides secure access to user accounts.", "type": "STORY", "estimatedHours": 6, "priority": 10, "suggestedDependencies": [], "acceptanceCriteria": ["User can log in with valid credentials", "Invalid credentials show error", "Session persists for 24 hours"] },
    { "name": "Configure Database Schema", "description": "Create user tables and indexes for authentication. This enables data persistence for user management.", "type": "TASK", "estimatedHours": 3, "priority": 10, "suggestedDependencies": [], "acceptanceCriteria": ["User table created with required fields", "Indexes created for email lookups", "Migration runs successfully"] },
    { "name": "Implement User Registration", "description": "Registration form with email verification flow. Allows new users to create accounts.", "type": "STORY", "estimatedHours": 8, "priority": 9, "suggestedDependencies": ["Configure Database Schema"], "acceptanceCriteria": ["User can register with email/password", "Verification email sent on registration", "Duplicate emails are rejected"] }
  ],
  "sprints": [
    { "name": "Foundation", "goal": "Our focus is establishing core infrastructure. We believe it delivers development velocity to the team. This will be confirmed when database and auth are operational.", "durationWeeks": 2, "componentNames": ["Configure Database Schema", "Enable User Login"], "capacity": 80 },
    { "name": "User Onboarding", "goal": "Our focus is enabling user self-service registration. We believe it delivers user acquisition capability. This will be confirmed when users can register and verify their accounts.", "durationWeeks": 2, "componentNames": ["Implement User Registration"], "capacity": 80 }
  ],
  "summary": "...",
  "enhancedDescription": "..."${epicExample}
}
JSON>>>`;
}
