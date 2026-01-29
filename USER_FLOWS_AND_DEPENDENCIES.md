# TaskTitan FORGE – User Flows & Dependency Chains

This document lists **user-facing interactions** and, for each, the **dependency chain** and **files involved**. Use it to trace what code runs when a user does something.

---

## 1. Authentication & Session

### 1.1 Sign in (Cognito)
**User action:** Clicks “Sign in” and completes Cognito hosted UI.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/sign-in/page.tsx` | Renders sign-in page with SignInButton |
| 2 | `webapp/src/app/sign-in/SignInButton.tsx` | Triggers Cognito redirect |
| 3 | `webapp/src/lib/amplifyServerUtils.ts` | Amplify server context |
| 4 | (Cognito hosted UI – external) | Auth flow |

**After redirect – session:**
| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/auth-callback/page.tsx` | Handles callback, redirects to app |
| 2 | `webapp/src/lib/auth.ts` | `getSession()` – fetches Cognito session, ensures User in DynamoDB |
| 3 | `webapp/src/lib/dynamodb/service.ts` | `getEntities()` → `user.get` / `user.create` |
| 4 | `webapp/src/lib/dynamodb/index.ts` | DynamoDB client |

**Files touched:** `sign-in/page.tsx`, `SignInButton.tsx`, `auth-callback/page.tsx`, `auth.ts`, `amplifyServerUtils.ts`, `dynamodb/service.ts`, `dynamodb/index.ts`

---

### 1.2 Sign up (Cognito)
**User action:** Clicks “Sign up” and completes registration.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/sign-in/page.tsx` | Renders SignUpButton |
| 2 | `webapp/src/app/sign-in/SignUpButton.tsx` | Redirects to Cognito sign-up |

**Files touched:** `sign-in/page.tsx`, `SignUpButton.tsx`

---

### 1.3 Demo mode
**User action:** Clicks “Try Demo Mode”.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/sign-in/page.tsx` | Renders DemoButton |
| 2 | `webapp/src/app/sign-in/DemoButton.tsx` | Sets demo cookie, redirects |
| 3 | `webapp/src/lib/auth.ts` | `getSession()` – reads demo cookie, returns demo user |
| 4 | `webapp/src/lib/demo/constants.ts` | `DEMO_COOKIE_NAME`, `DEMO_USER` |

**Files touched:** `sign-in/page.tsx`, `DemoButton.tsx`, `auth.ts`, `demo/constants.ts`

---

### 1.4 Any authenticated page (session)
**User action:** Opens any page while signed in (or in demo).

| Step | File | Role |
|------|------|------|
| 1 | Page component (e.g. `page.tsx`) | Calls `getSession()` |
| 2 | `webapp/src/lib/auth.ts` | Returns session (Cognito or demo) |
| 3 | `webapp/src/lib/safe-action.ts` | Server actions use same session via `authActionClient` (cookies + Cognito or demo) |

**Files touched:** `auth.ts`, `safe-action.ts`, plus the specific page

---

## 2. Dashboard (Home)

### 2.1 View dashboard
**User action:** Opens `/` (home).

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/(root)/page.tsx` | Server component: `getSession()`, then fetch teams/projects |
| 2 | `webapp/src/lib/auth.ts` | Session |
| 3 | `webapp/src/lib/dynamodb/service.ts` | `getEntities()` → membership.byUser, team.get, project.byTeam, membership.primary, component.byProject |
| 4 | `webapp/src/components/Header.tsx` | Layout/nav |

**Files touched:** `(root)/page.tsx`, `auth.ts`, `dynamodb/service.ts`, `Header.tsx`

---

## 3. Teams

### 3.1 List teams
**User action:** Opens `/team`.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/team/page.tsx` | `getSession()`, fetch memberships + teams + members + project counts |
| 2 | `webapp/src/lib/dynamodb/service.ts` | membership.byUser, team.get, membership.primary, project.byTeam, user.get |

**Files touched:** `team/page.tsx`, `auth.ts`, `dynamodb/service.ts`

---

### 3.2 Create team
**User action:** Clicks “New team”, fills form, submits.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/team/new/page.tsx` | Renders form |
| 2 | `webapp/src/app/team/new/NewTeamForm.tsx` | Client form, calls `createTeam` |
| 3 | `webapp/src/app/team/actions.ts` | `createTeam` – validate, dualWrite (DynamoDB only) |
| 4 | `webapp/src/lib/dynamodb/dual-write.ts` | Wrapper around DynamoDB write |
| 5 | `webapp/src/lib/dynamodb/service.ts` | team.create, membership.create, teamWorkflowConfig.upsert |
| 6 | `webapp/src/lib/dynamodb/auth-helpers.ts` | (none for create; used in other team actions) |
| 7 | `webapp/src/lib/workflow-templates.ts` | Default workflow settings |
| 8 | `webapp/src/lib/safe-action.ts` | Auth + validation |

**Files touched:** `team/new/page.tsx`, `NewTeamForm.tsx`, `team/actions.ts`, `dual-write.ts`, `service.ts`, `workflow-templates.ts`, `safe-action.ts`

---

### 3.3 View team detail
**User action:** Opens `/team/[id]`.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/team/[id]/page.tsx` | `getSession()`, verify access, fetch team + members + projects |
| 2 | `webapp/src/lib/dynamodb/auth-helpers.ts` | `verifyTeamMembership` |
| 3 | `webapp/src/lib/dynamodb/service.ts` | team.get, membership.primary, project.byTeam, user.get, teamWorkflowConfig.get |

**Files touched:** `team/[id]/page.tsx`, `auth.ts`, `auth-helpers.ts`, `service.ts`

---

### 3.4 Invite member / update role / remove member
**User action:** Uses team member actions (invite, change role, remove).

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/team/[id]/InviteMemberForm.tsx` or similar | Calls server action |
| 2 | `webapp/src/app/team/actions.ts` | `inviteMember`, `updateMemberRole`, `removeMember` |
| 3 | `webapp/src/lib/dynamodb/auth-helpers.ts` | `verifyTeamMembership`, `isTeamOwner` |
| 4 | `webapp/src/lib/dynamodb/dual-write.ts` | DynamoDB writes |
| 5 | `webapp/src/lib/dynamodb/service.ts` | membership.create/update/delete, user.get (by email for invite) |

**Files touched:** `team/actions.ts`, `auth-helpers.ts`, `dual-write.ts`, `service.ts`, plus UI component (e.g. `InviteMemberForm.tsx`, `InviteButton.tsx`)

---

### 3.4a Delete team
**User action:** Deletes a team from team detail (owner only).

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/team/[id]/DeleteTeamButton.tsx` | Calls `deleteTeam` |
| 2 | `webapp/src/app/team/actions.ts` | `deleteTeam` – verify owner, cascade delete (memberships, projects, etc.) |
| 3 | `webapp/src/lib/dynamodb/auth-helpers.ts` | `isTeamOwner` |
| 4 | `webapp/src/lib/dynamodb/batch-ops.ts` | batchDelete for related entities |
| 5 | `webapp/src/lib/dynamodb/service.ts` | team.delete + memberships, projects, components, etc. |

**Files touched:** `team/[id]/DeleteTeamButton.tsx`, `team/actions.ts`, `auth-helpers.ts`, `batch-ops.ts`, `service.ts`

---

### 3.5 Team workflow settings
**User action:** Opens `/team/[id]/workflow` or updates settings.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/team/[id]/workflow/page.tsx` | Load config, render form |
| 2 | `webapp/src/lib/dynamodb/auth-helpers.ts` | `verifyTeamMembership` |
| 3 | `webapp/src/lib/dynamodb/service.ts` | team.get, teamWorkflowConfig.get |
| 4 | `webapp/src/app/team/[id]/workflow/WorkflowSettingsForm.tsx` | Calls `updateWorkflowConfig` |
| 5 | `webapp/src/app/team/[id]/workflow/actions.ts` | `getWorkflowConfig`, `updateWorkflowConfig`, `getCurrentCycle` |
| 6 | `webapp/src/lib/dynamodb/service.ts` | teamWorkflowConfig.get, upsert |

**Files touched:** `team/[id]/workflow/page.tsx`, `WorkflowSettingsForm.tsx`, `team/[id]/workflow/actions.ts`, `auth-helpers.ts`, `service.ts`

---

### 3.6 Team metrics
**User action:** Opens `/team/[id]/metrics`.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/team/[id]/metrics/page.tsx` | Verify access, load workflow config |
| 2 | `webapp/src/lib/dynamodb/auth-helpers.ts` | `verifyTeamMembership` |
| 3 | `webapp/src/lib/dynamodb/service.ts` | teamWorkflowConfig.get |
| 4 | `webapp/src/app/team/[id]/metrics/MetricsClient.tsx` | Client UI, may call metric actions |
| 5 | `webapp/src/app/team/[id]/metrics/actions.ts` | Compute cycle time, throughput, WIP, etc. |
| 6 | `webapp/src/lib/dynamodb/service.ts` | component, assignment, componentStatusHistory queries |

**Files touched:** `team/[id]/metrics/page.tsx`, `MetricsClient.tsx`, `team/[id]/metrics/actions.ts`, `auth-helpers.ts`, `service.ts`

---

## 4. Projects

### 4.1 List projects
**User action:** Opens `/projects`.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/projects/page.tsx` | memberships → teams → projects → component counts/status |
| 2 | `webapp/src/lib/dynamodb/service.ts` | membership.byUser, team.get, project.byTeam, component.byProject |

**Files touched:** `projects/page.tsx`, `auth.ts`, `service.ts`

---

### 4.2 Create project
**User action:** Clicks “New project”, picks team, submits.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/projects/new/page.tsx` | Load teams, render form |
| 2 | `webapp/src/lib/dynamodb/service.ts` | membership.byUser, team.get (for team list) |
| 3 | `webapp/src/app/projects/new/NewProjectForm.tsx` | Calls `createProject` |
| 4 | `webapp/src/app/projects/actions/project-crud.ts` | `createProject` – verifyTeamMembership, dualWrite, service transaction |
| 5 | `webapp/src/lib/dynamodb/auth-helpers.ts` | `verifyTeamMembership` |
| 6 | `webapp/src/lib/dynamodb/dual-write.ts` | — |
| 7 | `webapp/src/lib/dynamodb/service.ts` | project + activity in transaction |
| 8 | `webapp/src/lib/dynamodb/transactions.ts` | (if used by project create) |

**Files touched:** `projects/new/page.tsx`, `NewProjectForm.tsx`, `projects/actions/project-crud.ts`, `auth-helpers.ts`, `dual-write.ts`, `service.ts`, `transactions.ts` (if applicable)

---

### 4.3 View project detail
**User action:** Opens `/projects/[id]`.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/projects/[id]/page.tsx` | Load project, verify access, load components, assignments, dependencies, sprints, activity, workflow config |
| 2 | `webapp/src/lib/dynamodb/auth-helpers.ts` | `verifyProjectAccess` |
| 3 | `webapp/src/lib/dynamodb/service.ts` | project.get, team.get, membership.primary, sprint.byTeam, teamWorkflowConfig.get, component.byProject, activity.primary, assignment.primary, dependency, componentStatusHistory, componentPreview, sprint.get |

**Files touched:** `projects/[id]/page.tsx`, `auth.ts`, `auth-helpers.ts`, `service.ts`, plus child components (e.g. `ComponentCard.tsx`, `TimelineView.tsx`, `DependencyGraph.tsx`, `SprintTimeline.tsx`, `GitHubIntegrationSettings.tsx`)

---

### 4.4 Create / update / delete component
**User action:** Creates or edits a component on project detail.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/projects/[id]/components/CreateComponentForm.tsx` or similar | Calls create/update component action |
| 2 | `webapp/src/app/projects/actions/component-crud.ts` | `createComponent`, `updateComponent`, `deleteComponent` (and status/priority updates) |
| 3 | `webapp/src/lib/dynamodb/auth-helpers.ts` | `verifyProjectAccess`, `verifyComponentAccess` |
| 4 | `webapp/src/lib/dynamodb/dual-write.ts` | — |
| 5 | `webapp/src/lib/dynamodb/service.ts` | component, componentStatusHistory, activity (and batch-ops for delete) |
| 6 | `webapp/src/lib/dynamodb/batch-ops.ts` | (for cascade delete) |

**Files touched:** `projects/actions/component-crud.ts`, `auth-helpers.ts`, `dual-write.ts`, `service.ts`, `batch-ops.ts`, plus form/UI components

---

### 4.5 Dependencies (add/remove)
**User action:** Adds or removes a dependency between components.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/projects/[id]/components/DependencyGraph.tsx` or context UI | Calls dependency actions |
| 2 | `webapp/src/app/projects/actions/dependencies.ts` | `addDependency`, `removeDependency` |
| 3 | `webapp/src/lib/dynamodb/auth-helpers.ts` | `verifyComponentAccess` (both components) |
| 4 | `webapp/src/lib/dynamodb/service.ts` | dependency.create/delete |

**Files touched:** `projects/actions/dependencies.ts`, `auth-helpers.ts`, `service.ts`, plus DependencyGraph or related UI

---

### 4.6 Assignments (assign/unassign user)
**User action:** Assigns or unassigns a user to a component.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/projects/[id]/components/AssignmentPanel.tsx` | Calls assignment actions |
| 2 | `webapp/src/app/projects/actions/assignments.ts` | `assignUser`, `unassignUser`, bulk assign |
| 3 | `webapp/src/lib/dynamodb/auth-helpers.ts` | `verifyProjectAccess`, `verifyComponentAccess` |
| 4 | `webapp/src/lib/dynamodb/service.ts` | assignment.create/delete, activity |

**Files touched:** `projects/actions/assignments.ts`, `auth-helpers.ts`, `service.ts`, `AssignmentPanel.tsx`

---

### 4.7 GitHub integration (project settings + PR linking)
**User action (A):** Configures GitHub repo or webhook on project.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/projects/[id]/components/GitHubIntegrationSettings.tsx` | Calls GitHub settings action |
| 2 | `webapp/src/app/projects/actions/github-settings.ts` | Save repo URL / webhook secret |
| 3 | `webapp/src/lib/dynamodb/auth-helpers.ts` | `verifyProjectAccess` |
| 4 | `webapp/src/lib/dynamodb/service.ts` | project.update |

**Files touched:** `projects/actions/github-settings.ts`, `auth-helpers.ts`, `service.ts`, `GitHubIntegrationSettings.tsx`

**User action (B):** Links a GitHub PR to a component (or unlinks).

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/projects/[id]/components/PRLinkInput.tsx` or PR status UI | Calls linkComponentToPR |
| 2 | `webapp/src/app/projects/actions/component-github.ts` | `linkComponentToPR` – verifyComponentAccess, update component PR fields |
| 3 | `webapp/src/lib/dynamodb/auth-helpers.ts` | `verifyComponentAccess` |
| 4 | `webapp/src/lib/dynamodb/service.ts` | component.update (githubPrUrl, githubPrNumber, etc.) |

**Files touched:** `projects/actions/component-github.ts`, `auth-helpers.ts`, `service.ts`, `PRLinkInput.tsx` / PR status UI

---

### 4.8 AI: generate components / refine / smart create
**User action:** Uses “AI generate”, “Refine with AI”, or “Smart create” on project.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/projects/[id]/components/AIGeneratePanelWrapper.tsx`, `SmartComponentCreator.tsx`, `ComponentRefineModal.tsx` | Call AI actions |
| 2 | `webapp/src/app/projects/actions/ai-generation.ts`, `component-refinement.ts`, `smart-component.ts` | Call Bedrock, then create/update components |
| 3 | `webapp/src/lib/ai/bedrock-client.ts` | Bedrock invoke |
| 4 | `webapp/src/lib/ai/generators/*.ts` | Prompts and response parsing |
| 5 | `webapp/src/lib/dynamodb/auth-helpers.ts` | `verifyProjectAccess` |
| 6 | `webapp/src/lib/dynamodb/service.ts` | component create/update, activity |
| 7 | `webapp/src/lib/dynamodb/transactions.ts` | (if bulk create uses transaction) |

**Files touched:** AI panel/refine/smart UI components, `projects/actions/ai-generation.ts`, `component-refinement.ts`, `smart-component.ts`, `lib/ai/bedrock-client.ts`, `lib/ai/generators/*`, `auth-helpers.ts`, `service.ts`, `transactions.ts` (if used)

---

### 4.9 Wireframe preview
**User action:** Asks for wireframe preview for a component.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/projects/[id]/components/PreviewModal.tsx` or similar | Calls preview action |
| 2 | `webapp/src/app/projects/[id]/components/preview-actions.ts` | Generate and store preview |
| 3 | `webapp/src/lib/ai/generators/wireframe-generator.ts` | Bedrock wireframe |
| 4 | `webapp/src/lib/dynamodb/service.ts` | componentPreview.create/update |

**Files touched:** `preview-actions.ts`, `wireframe-generator.ts`, `service.ts`, Preview UI

---

### 4.10 Delete project
**User action:** Deletes project from project detail.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/projects/[id]/DeleteProjectButton.tsx` | Calls deleteProject |
| 2 | `webapp/src/app/projects/actions/project-crud.ts` | `deleteProject` – verifyProjectAccess, saga/cascade delete |
| 3 | `webapp/src/lib/dynamodb/auth-helpers.ts` | `verifyProjectAccess` |
| 4 | `webapp/src/lib/dynamodb/batch-ops.ts` | batchDelete (components, assignments, dependencies, etc.) |
| 5 | `webapp/src/lib/dynamodb/service.ts` | project.delete + all child entities |

**Files touched:** `DeleteProjectButton.tsx`, `projects/actions/project-crud.ts`, `auth-helpers.ts`, `batch-ops.ts`, `service.ts`

---

## 5. Sprints

### 5.1 List sprints
**User action:** Opens `/team/[id]/sprints`.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/team/[id]/sprints/page.tsx` | verifyTeamMembership, load sprints + workflow config |
| 2 | `webapp/src/lib/dynamodb/auth-helpers.ts` | `verifyTeamMembership` |
| 3 | `webapp/src/lib/dynamodb/service.ts` | sprint.byTeam, teamWorkflowConfig.get |

**Files touched:** `team/[id]/sprints/page.tsx`, `auth-helpers.ts`, `service.ts`

---

### 5.2 Create sprint
**User action:** Opens “New sprint”, fills form, submits.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/team/[id]/sprints/new/page.tsx` | Load team, last sprint, workflow config |
| 2 | `webapp/src/lib/dynamodb/auth-helpers.ts` | `verifyTeamMembership` |
| 3 | `webapp/src/lib/dynamodb/service.ts` | sprint.byTeam (for defaults) |
| 4 | `webapp/src/app/team/[id]/sprints/new/NewSprintForm.tsx` | Calls createSprint |
| 5 | `webapp/src/app/sprints/actions/sprint-crud.ts` | `createSprint` |
| 6 | `webapp/src/lib/dynamodb/dual-write.ts` | — |
| 7 | `webapp/src/lib/dynamodb/service.ts` | sprint.create |

**Files touched:** `team/[id]/sprints/new/page.tsx`, `NewSprintForm.tsx`, `sprints/actions/sprint-crud.ts`, `auth-helpers.ts`, `dual-write.ts`, `service.ts`

---

### 5.3 View sprint detail
**User action:** Opens `/team/[id]/sprints/[sprintId]`.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/team/[id]/sprints/[sprintId]/page.tsx` | verifySprintAccess, load sprint, projects, components, assignments |
| 2 | `webapp/src/lib/dynamodb/auth-helpers.ts` | `verifySprintAccess` |
| 3 | `webapp/src/lib/dynamodb/service.ts` | sprint.get, project.byTeam, component.byProject, assignment.primary, user.get |

**Files touched:** `team/[id]/sprints/[sprintId]/page.tsx`, `auth-helpers.ts`, `service.ts`, `SprintComponents.tsx`, `SprintControls.tsx`, etc.

---

### 5.4 Add/remove component from sprint / update sprint
**User action:** Adds or removes components from sprint, or updates sprint (e.g. start/complete).

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/team/[id]/sprints/[sprintId]/SprintControls.tsx` or similar | Calls sprint actions |
| 2 | `webapp/src/app/sprints/actions/sprint-crud.ts` | `updateSprint`, add/remove components |
| 3 | `webapp/src/lib/dynamodb/auth-helpers.ts` | `verifySprintAccess` |
| 4 | `webapp/src/lib/dynamodb/service.ts` | sprint.update, component.update (sprintId) |

**Files touched:** `sprints/actions/sprint-crud.ts`, `auth-helpers.ts`, `service.ts`, Sprint UI components

---

### 5.5 AI sprint planning / refinement
**User action:** Uses “AI plan sprint” or “Refine with AI” on sprint.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/team/[id]/sprints/[sprintId]/AISprintPlanner.tsx`, `SprintRefineButton.tsx` | Call AI sprint actions |
| 2 | `webapp/src/app/sprints/actions/sprint-planning.ts`, `sprint-refinement.ts` | Bedrock + sprint/component updates |
| 3 | `webapp/src/lib/ai/generators/sprint-generator.ts` | AI suggestions |
| 4 | `webapp/src/lib/dynamodb/service.ts` | sprint.get, component.byProject, component.update, etc. |

**Files touched:** `sprint-planning.ts`, `sprint-refinement.ts`, `sprint-generator.ts`, `service.ts`, `auth-helpers.ts`, AISprintPlanner, SprintRefineButton

---

## 6. My Tasks

### 6.1 View my tasks
**User action:** Opens `/my-tasks`.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/my-tasks/page.tsx` | assignment.byUser, then component, componentStatusHistory, project, sprint, team per assignment |
| 2 | `webapp/src/lib/dynamodb/service.ts` | assignment.byUser, component.get, componentStatusHistory.primary, project.get, sprint.get, team.get |

**Files touched:** `my-tasks/page.tsx`, `auth.ts`, `service.ts`

---

## 7. Import

### 7.1 Data import wizard
**User action:** Opens `/import` and runs import steps.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/import/page.tsx` | Renders ImportWizard |
| 2 | `webapp/src/app/import/ImportWizard.tsx` | Steps, calls import actions |
| 3 | `webapp/src/app/import/actions.ts` | Parse/validate, create team/project/components (optional AI) |
| 4 | `webapp/src/lib/dynamodb/service.ts` | team, project, component, membership, etc. |
| 5 | `webapp/src/lib/ai/generators/import-generator.ts` | (if AI-assisted import) |

**Files touched:** `import/page.tsx`, `ImportWizard.tsx`, `import/actions.ts`, `service.ts`, `import-generator.ts` (if used)

---

## 8. API Routes (system / integrations)

### 8.1 Health check
**Caller:** App Runner / load balancer health check.

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/api/health/route.ts` | GET → entities.team.scan(limit 1) |
| 2 | `webapp/src/lib/dynamodb/service.ts` | getEntities(), team.scan |

**Files touched:** `api/health/route.ts`, `dynamodb/service.ts`, `dynamodb/index.ts`

---

### 8.2 GitHub webhook
**Caller:** GitHub (on PR events).

| Step | File | Role |
|------|------|------|
| 1 | `webapp/src/app/api/webhooks/github/route.ts` | Verify signature, find project by repo URL, dispatch handler |
| 2 | `webapp/src/lib/github-integration.ts` | handlePullRequestEvent, handlePullRequestReviewEvent – update component PR status, create activity, optionally runJob (notify) |
| 3 | `webapp/src/lib/dynamodb/service.ts` | project.scan (by githubRepoUrl), component queries/update, activity.create |
| 4 | `webapp/src/lib/jobs.ts` | runJob (notify) |
| 5 | `webapp/src/jobs/async-job/notify.ts` | (Lambda handler for notify job) |

**Files touched:** `api/webhooks/github/route.ts`, `github-integration.ts`, `service.ts`, `jobs.ts`, `jobs/async-job/notify.ts`

---

## 9. Shared / Cross-cutting

These files are used across many of the flows above:

| File | Used for |
|------|----------|
| `webapp/src/lib/auth.ts` | Session (Cognito or demo), ensure User in DynamoDB |
| `webapp/src/lib/safe-action.ts` | Auth context for server actions, demo cookie, error handling |
| `webapp/src/lib/dynamodb/index.ts` | DynamoDB client and table name |
| `webapp/src/lib/dynamodb/service.ts` | ElectroDB entities and `getEntities()` / `getService()` |
| `webapp/src/lib/dynamodb/auth-helpers.ts` | verifyTeamMembership, verifyProjectAccess, verifyComponentAccess, verifySprintAccess |
| `webapp/src/lib/dynamodb/dual-write.ts` | Wrapper for DynamoDB-only writes (Prisma path no-op) |
| `webapp/src/lib/amplifyServerUtils.ts` | Amplify server context for Cognito |
| `webapp/src/components/Header.tsx` | Nav and layout on most pages |
| `webapp/src/app/layout.tsx` | Root layout: metadata, globals.css, ClientErrorHandler, Toaster (sonner) |
| `webapp/src/app/ClientErrorHandler.tsx` | Global error boundary (wraps app) |
| `webapp/src/lib/workflow-templates.ts` | Workflow presets (SCRUM, KANBAN, etc.) used by team create/workflow |

---

## 10. Quick reference: files by layer

| Layer | Files |
|-------|--------|
| **Pages (entry)** | `(root)/page.tsx`, `(root)/loading.tsx`, `sign-in/page.tsx`, `sign-in/loading.tsx`, `auth-callback/page.tsx`, `auth-callback/loading.tsx`, `team/page.tsx`, `team/[id]/page.tsx`, `team/[id]/workflow/page.tsx`, `team/[id]/metrics/page.tsx`, `team/[id]/sprints/page.tsx`, `team/[id]/sprints/new/page.tsx`, `team/[id]/sprints/[sprintId]/page.tsx`, `projects/page.tsx`, `projects/new/page.tsx`, `projects/[id]/page.tsx`, `my-tasks/page.tsx`, `import/page.tsx`, `privacy/page.tsx`, `profile/page.tsx`, `docs/page.tsx` |
| **App shell** | `app/layout.tsx`, `app/ClientErrorHandler.tsx`, `app/globals.css` |
| **Server actions** | `team/actions.ts`, `team/[id]/workflow/actions.ts`, `team/[id]/metrics/actions.ts`, `projects/actions/project-crud.ts`, `projects/actions/component-crud.ts`, `projects/actions/dependencies.ts`, `projects/actions/assignments.ts`, `projects/actions/github-settings.ts`, `projects/actions/component-github.ts`, `projects/actions/ai-generation.ts`, `projects/actions/component-refinement.ts`, `projects/actions/smart-component.ts`, `projects/[id]/components/preview-actions.ts`, `projects/[id]/components/context-actions.ts`, `sprints/actions/sprint-crud.ts`, `sprints/actions/sprint-planning.ts`, `sprints/actions/sprint-refinement.ts`, `import/actions.ts` |
| **API routes** | `api/health/route.ts`, `api/webhooks/github/route.ts`, `api/auth/[slug]/route.ts`, `api/auth/sign-up/route.ts`, `api/cognito-token/route.ts` |
| **DynamoDB** | `lib/dynamodb/index.ts`, `lib/dynamodb/service.ts`, `lib/dynamodb/auth-helpers.ts`, `lib/dynamodb/dual-write.ts`, `lib/dynamodb/batch-ops.ts`, `lib/dynamodb/transactions.ts`, `lib/dynamodb/feature-flags.ts` |
| **Auth & context** | `lib/auth.ts`, `lib/safe-action.ts`, `lib/amplifyServerUtils.ts` |
| **Infrastructure & utilities** | `middleware.ts`, `lib/events.ts`, `lib/logger.ts`, `lib/tracer.ts`, `lib/dev-guard.ts`, `lib/utils.ts`, `lib/terminology.ts` |
| **AI** | `lib/ai/bedrock-client.ts`, `lib/ai/generators/*.ts`, `lib/ai/prompts/*.ts`, `lib/ai/utils/response-parsing.ts` |
| **Integration** | `lib/github-integration.ts`, `lib/jobs.ts` |

**Page purposes (undocumented earlier):**
- `privacy/page.tsx` – Privacy policy page
- `profile/page.tsx` – User profile page
- `docs/page.tsx` – Documentation page
- `(root)/loading.tsx` – Root loading state (suspense fallback)
- `sign-in/loading.tsx` – Sign-in route loading state
- `auth-callback/loading.tsx` – Auth callback loading state

**Middleware (`middleware.ts`):** Protects all routes except `api/auth`, `api/health`, `_next/*`, `favicon.ico`, `sign-in`, `privacy`, `docs`. Redirects unauthenticated users to `/sign-in` (demo cookie and local dev bypass auth).

---

## 11. Demo infrastructure

Demo mode is production-supported: users can try the app without signing up. When the demo cookie is set, pages render client-side Demo components that read/write from `lib/demo` (browser storage).

**Demo page components (route-specific):**
- `(root)/DemoDashboard.tsx`
- `team/DemoTeamListPage.tsx`, `team/new/DemoNewTeamPage.tsx`, `team/[id]/DemoTeamDetailPage.tsx`, `team/[id]/DemoInviteMemberForm.tsx`, `team/[id]/DemoMetricsPage.tsx`, `team/[id]/DemoSprintsPage.tsx`, `team/[id]/sprints/new/DemoNewSprintPage.tsx`, `team/[id]/sprints/[sprintId]/DemoSprintDetailPage.tsx`
- `projects/DemoProjectsPage.tsx`, `projects/new/DemoNewProjectPage.tsx`, `projects/[id]/DemoProjectDetailPage.tsx`
- `my-tasks/DemoMyTasksPage.tsx`
- `profile/DemoProfilePage.tsx`

**Demo support:**
- `lib/demo/constants.ts` – Demo user and cookie name
- `lib/demo/demo-mode.ts` – Demo mode detection/helpers
- `lib/demo/demo-seed.ts` – Seed data for demo
- `lib/demo/demo-store.ts` – Browser storage abstraction
- `lib/demo/index.ts` – Exports
- `lib/demo/types.ts` – Demo-related types
- `components/DemoBadge.tsx` – “Demo” badge in UI
- `hooks/use-demo-action.ts` – Client hook for demo server-action handling
- `team/[id]/SeedDemoButton.tsx` – Seeds demo data (used in demo/team detail)

---

## 12. Other files (reference)

Not tied to a single user flow but used across the app or for tooling:

| Category | Files | Purpose |
|----------|--------|--------|
| **UI components** | `components/ui/sonner.tsx` | Toaster (used in layout) |
| **Project detail UI** | `projects/[id]/components/CopyBranchButton.tsx` | Copy branch name for component |
| **Barrel exports** | `projects/actions/index.ts`, `sprints/actions/index.ts` | Re-export actions for `@/app/projects/actions` etc. |
| **Test & quality** | `projects/actions/component-crud.test.ts`, `project-crud.test.ts`, `sprints/actions/sprint-crud.test.ts`, `team/actions.test.ts` | Unit/integration tests for server actions |
| **Scripts** | `src/scripts/seed-demo-team.ts` | Demo seed script |
| **Test setup** | `src/test/setup.ts`, `src/test/action-helpers.ts`, `src/test/prisma-mock.ts` | Vitest setup and mocks |

You can use this map to see which files are involved for any user action and to trace dependency chains end-to-end.
