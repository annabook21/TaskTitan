# TaskTitan Documentation

## Table of Contents

1. [Getting Started](#getting-started)
2. [Component Planning](#component-planning)
3. [AI Generation](#ai-generation)
4. [Importing Data](#importing-data)

---

## Getting Started

TaskTitan is a component-based project planning tool that helps teams break down projects into manageable work items. Here's how to get started.

### Step 1: Create a Team

Teams are the foundation of TaskTitan. Each team has members with different roles and can manage multiple projects.

**Team Roles:**
- **Owner** — Full control, can delete the team
- **Admin** — Can manage members and settings
- **Member** — Can create and edit projects/components

### Step 2: Choose a Workflow

When creating a team, select a workflow template that matches your methodology:

- **Scrum** — 2-week sprints with planning and retrospectives
- **Kanban** — Continuous flow with WIP limits, no time-boxed iterations
- **Shape Up** — 6-week cycles with 2-week cooldown periods
- **Custom** — Configure your own workflow settings

### Step 3: Create a Project

Projects belong to teams and contain all your work items (components). Give your project a clear name and description — the AI uses this to generate relevant components.

### Step 4: Plan Sprints (Scrum/Shape Up)

If using time-boxed iterations, create sprints with start/end dates and capacity hours. The AI can help suggest which components to include based on priority and dependencies.

**Sprint Statuses:**
- **Planning** — Sprint is being prepared
- **Active** — Currently in progress
- **Completed** — Sprint finished
- **Cancelled** — Sprint was cancelled

---

## Component Planning

Components are the work items in TaskTitan. They follow agile best practices and can be organized hierarchically.

### Component Types

#### EPIC
- **Size:** Large initiative (40-200 hours)
- **Purpose:** Groups related features
- **Example:** "User Authentication System"

#### FEATURE
- **Size:** Distinct capability (16-40 hours)
- **Purpose:** Spans 1-3 sprints
- **Example:** "Social Login"

#### STORY
- **Size:** User-facing change (2-16 hours)
- **Purpose:** Fits in one sprint
- **Example:** "Enable User Login"

#### TASK
- **Size:** Technical work item (1-8 hours)
- **Example:** "Configure Database Connection"

#### BUG
- **Size:** Defect to fix (1-16 hours)
- **Example:** "Fix Login Button Not Responding"

### Component Statuses

Components flow through these statuses:
1. **Planning** — Being prepared
2. **In Progress** — Currently being worked on
3. **Blocked** — Blocked by a dependency or issue
4. **Review** — Ready for review/testing
5. **Completed** — Finished

### INVEST Criteria

TaskTitan encourages components that follow the INVEST criteria for well-defined work items:

- **I**ndependent — Can be developed without waiting for others
- **N**egotiable — Details can be refined through discussion
- **V**aluable — Delivers clear value to users or business
- **E**stimable — Effort can be reasonably estimated
- **S**mall — Completable within appropriate timeframe
- **T**estable — Has clear acceptance criteria

### Dependencies & Hierarchy

Components can have parent-child relationships and dependencies:

- **Parent/Child:** Epics contain Features, Features contain Stories
- **Dependencies:** "Component A depends on Component B" means B must complete first
- **Blocking:** Components can block others, tracked in the UI

---

## AI Generation

TaskTitan uses Amazon Bedrock with Claude to provide AI-powered features. No external API keys needed — everything runs within AWS.

### Component Generation

When you create a project, the AI can analyze your description and generate a complete sprint plan:

- Generates Stories and Tasks based on your project description
- Creates 2-4 sprints with clear goals (for Scrum teams)
- Estimates hours and sets priorities
- Identifies dependencies between components
- Respects your team's workflow (Scrum, Kanban, Shape Up)

**Tip:** Write detailed project descriptions for better AI suggestions. Include features, target users, and technical requirements.

### Natural Language Creation

Describe a component in plain English, and the AI will structure it properly:

**Example input:**
> "We need a login page that supports Google and GitHub OAuth, with remember me checkbox"

**AI generates:**
- Proper name: "Implement OAuth Login with Social Providers"
- Type: STORY
- Estimated hours: 12
- Acceptance criteria with testable conditions

### Component Breakdown

Have a large component? The AI can suggest how to break it into smaller, manageable subtasks. Just click "Refine" on any component.

### Chat-Based Refinement

Have a conversation with the AI to refine components. Ask questions like:
- "What about error handling?"
- "Should we add caching?"

The AI will suggest improvements based on your conversation.

### AI Sprint Planning

Let the AI help you plan sprints by suggesting which backlog items to include:
- Considers priority and dependencies
- Respects sprint capacity (with 80% buffer for realistic planning)
- Groups related work items
- Suggests sprint names and goals

### Component Templates

Start from pre-built templates for common patterns:

- Login/Authentication Flow
- CRUD Operations
- Search & Filtering
- Dashboard & Analytics
- File Upload
- Notifications

---

## Importing Data

Migrate your existing work items from other tools using the Import Wizard. TaskTitan supports multiple formats and uses AI to map your data automatically.

### Supported Formats

- **CSV Files** — Any spreadsheet exported as CSV
- **JSON Files** — Structured data exports
- **Jira Exports** — CSV exports from Jira Cloud/Server
- **Trello / Asana** — Board and task exports

### Mappable Fields

The AI automatically detects and maps common column names:

- Name / Summary
- Description
- Type / Issue Type
- Status
- Priority
- Assignee / Owner
- Estimated Hours
- Due Date
- Sprint
- Tags / Labels
- Parent / Epic Link
- Dependencies

### AI-Powered Import

- **Auto-detection:** Recognizes Jira, Trello, and Asana export formats
- **Smart Mapping:** Suggests column-to-field mappings with confidence scores
- **Data Cleanup:** Normalizes status values, types, and priorities automatically
- **Validation:** Highlights errors with inline editing to fix before import

### Import Process

1. **Upload** — Drop your CSV or JSON file
2. **Review Mappings** — AI suggests mappings, adjust as needed
3. **Clean Data** — Optionally let AI fix inconsistencies
4. **Import** — Components are created with hierarchy and dependencies

**Tip:** Download a CSV template from the import page to see the expected format before creating your own export.

---

## Need More Help?

Try the demo mode to explore features risk-free, or reach out to our team.
