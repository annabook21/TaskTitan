# FORGE Branch Fix Plan

## Scope and constraint (mandatory)

- **All work must be done in the FORGE branch codebase only:**  
  `/Users/anna/Desktop/TaskTitan`
- **Do not modify the UAS worktree or any path under:**  
  `/Users/anna/.cursor/worktrees/TaskTitan/uas`  
  or any other worktree/repo. If the current workspace is UAS, do not make edits there; ask the user to open the FORGE repo or confirm the FORGE path before making any changes.
- Before editing any file, confirm the path is under `/Users/anna/Desktop/TaskTitan`. If it is not, stop and do not edit.

---

## Issues to fix (FORGE only)

These corrections apply only to files under `/Users/anna/Desktop/TaskTitan/webapp-static/` and `/Users/anna/Desktop/TaskTitan/cdk/` as noted.

---

### 1. KanbanBoard – user-visible error when drag status update fails (Important)

**File:** `webapp-static/src/components/KanbanBoard.tsx`

**Current behavior:** On `updateComponent` failure in the drag-drop handler, only `console.error` is called; the user sees no feedback.

**Change:**
- Add optional prop: `onStatusUpdateError?: (err: Error) => void`.
- In the `catch` block of `handleDrop`, call `onStatusUpdateError?.(err instanceof Error ? err : new Error(String(err)))` and remove or keep `console.error` only for dev (see item 3).
- In `ProjectDetailPage.tsx`, pass `onStatusUpdateError` that sets a small local error state (e.g. `statusUpdateError`) and display it (e.g. toast or inline banner); clear it after a few seconds or on next drag.

**Validation:** Drag a card to a new column, simulate failure (e.g. disconnect network); user should see an error message.

---

### 2. Catch-all route – authenticated users should not land on sign-in (Moderate)

**File:** `webapp-static/src/App.tsx`

**Current behavior:** `<Route path="*" element={<Navigate to="/" replace />} />` sends every unknown path to `/` (SignInPage). Authenticated users who mistype (e.g. `/hom`) get sent to sign-in.

**Change:**
- Replace the catch-all with a small **NotFoundPage** component that:
  - Uses `useAuth()` (or equivalent) to check if the user is authenticated.
  - If authenticated: show a “Page not found” message and a link to `/home` (or `<Navigate to="/home" replace />`).
  - If not authenticated: `<Navigate to="/" replace />` (sign-in).
- In `App.tsx`, add a route: `<Route path="*" element={<NotFoundPage />} />` (and ensure it is the last route).

**Alternative (minimal):** Create a wrapper that reads auth and renders either `<Navigate to="/home" replace />` or `<Navigate to="/" replace />` for `path="*"`. No dedicated 404 UI.

**Validation:** While signed in, go to `/nonexistent`; you should see 404 or redirect to `/home`, not sign-in.

---

### 3. Console statements in production paths (Moderate)

**Files (all under `webapp-static/src/`):**

| File | Location | Action |
|------|----------|--------|
| `pages/AuthCallbackPage.tsx` | ~line 27 | Remove `console.error('Auth callback error:', err);` or replace with a logger. Error is already shown via `setError(...)`. |
| `components/ErrorBoundary.tsx` | ~line 26 | Keep or replace: either leave for dev or use optional `onError` only (no console in prod). Document that `onError` can be used for reporting. |
| `pages/ProjectNewPage.tsx` | ~line 175 | Remove `console.error('AI generation failed:', aiErr);`. Optionally set a non-blocking error state so user sees “AI generation failed; project was created.” |
| `components/KanbanBoard.tsx` | ~line 55 | Remove once user-visible error is added (item 1). |
| `pages/HomePage.tsx` | ~line 107 | Remove `console.error('Failed to load dashboard data:', err);` or replace with logger. User already sees empty dashboard on error. |

**Change:** Apply the “Action” per file. Prefer removing or routing through a single `logError(err, context)` helper that can be no-op or send to monitoring in production.

**Validation:** Run app, trigger each error path; no unnecessary console output in production build (or only via explicit logger).

---

### 4. ComponentDetailModal – validate priority and estimatedHours (Minor)

**File:** `webapp-static/src/components/ComponentDetailModal.tsx`

**Current behavior:** `parseInt(priority, 10)` and `parseFloat(estimatedHours)` can yield `NaN` if the user types non-numeric input.

**Change:**
- For priority: `const p = priority.trim() === '' ? undefined : parseInt(priority, 10);` then use `(p !== undefined && !Number.isNaN(p)) ? p : undefined` (or clamp to valid range if schema has one).
- For estimatedHours: same idea with `parseFloat` and `Number.isNaN`.
- Optionally show inline validation (e.g. “Enter a number”) when the value is non-empty and not a valid number.

**Validation:** Enter letters in Priority or Estimated hours, save; no NaN sent to API and/or user sees validation message.

---

### 5. NotificationBell – surface load failure (Minor)

**File:** `webapp-static/src/components/NotificationBell.tsx`

**Current behavior:** `loadUnreadCount` and `loadNotifications` use empty `catch` blocks; user never knows if notifications failed to load.

**Change:**
- Add local state, e.g. `loadError: string | null`.
- In the catch blocks, set `loadError` to a short message (e.g. “Couldn’t load notifications”) and clear it on next successful load or when dropdown is opened again.
- Optionally show a subtle indicator in the bell area (e.g. tooltip or small text when dropdown is open) when `loadError` is set; or a “Retry” control in the dropdown.

**Validation:** Simulate notification API failure; user sees some indication that loading failed (and can retry if implemented).

---

## Implementation order

1. **Constraint:** Always verify target path is FORGE (`/Users/anna/Desktop/TaskTitan`); never edit UAS.
2. **Item 2** – Catch-all / NotFoundPage (quick, improves UX for typos).
3. **Item 1** – KanbanBoard user-visible error (and remove console in KanbanBoard as part of item 3).
4. **Item 3** – Remove or replace console statements in all listed files.
5. **Item 4** – ComponentDetailModal numeric validation.
6. **Item 5** – NotificationBell load error state and optional retry/indicator.

---

## “Never touch UAS” – how to enforce

- **In this plan:** The first section is the mandatory scope; follow it on every task.
- **In Cursor:** Add a project or global rule (e.g. in `.cursor/rules` or instructions) that states:  
  “When the user asks for changes to FORGE or TaskTitan, all edits must be under `/Users/anna/Desktop/TaskTitan`. Never edit files under `/Users/anna/.cursor/worktrees/TaskTitan/uas` (UAS worktree). If the open workspace is UAS, do not apply edits; ask the user to open the FORGE repo or confirm the FORGE path first.”
- **Before each edit:** Check the path of the file you are about to change. If it is not under `/Users/anna/Desktop/TaskTitan`, do not change it.

---

## Files to touch (summary)

| Priority | File(s) |
|----------|---------|
| Constraint | All work under `/Users/anna/Desktop/TaskTitan` only; never UAS. |
| 2 | `webapp-static/src/App.tsx`, new `webapp-static/src/pages/NotFoundPage.tsx` (or inline wrapper) |
| 1 | `webapp-static/src/components/KanbanBoard.tsx`, `webapp-static/src/pages/ProjectDetailPage.tsx` |
| 3 | `webapp-static/src/pages/AuthCallbackPage.tsx`, `webapp-static/src/components/ErrorBoundary.tsx`, `webapp-static/src/pages/ProjectNewPage.tsx`, `webapp-static/src/components/KanbanBoard.tsx`, `webapp-static/src/pages/HomePage.tsx` |
| 4 | `webapp-static/src/components/ComponentDetailModal.tsx` |
| 5 | `webapp-static/src/components/NotificationBell.tsx` |
