import { getSession } from '@/lib/auth';
import Header from '@/components/Header';
import Link from 'next/link';
import {
  ArrowLeft,
  BookOpen,
  Zap,
  FileText,
  Sparkles,
  Upload,
  Users,
  GitBranch,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Search,
  ChevronRight,
} from 'lucide-react';

export default async function DocsPage() {
  let user = null;
  try {
    const session = await getSession();
    user = session.user;
  } catch {
    // Not logged in, that's fine for docs page
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-8">
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>

          <div className="flex items-center gap-4 mb-8">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-emerald-500/20 flex items-center justify-center">
              <BookOpen className="w-7 h-7 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Documentation</h1>
              <p className="text-slate-400">Learn how to use TaskTitan effectively</p>
            </div>
          </div>

          {/* Table of Contents */}
          <nav className="mb-12 p-6 bg-slate-900/50 border border-slate-800 rounded-xl">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-slate-400" />
              Table of Contents
            </h2>
            <ul className="space-y-2">
              <li>
                <a href="#getting-started" className="text-cyan-400 hover:text-cyan-300 flex items-center gap-2">
                  <ChevronRight className="w-4 h-4" />
                  Getting Started
                </a>
              </li>
              <li>
                <a href="#component-planning" className="text-cyan-400 hover:text-cyan-300 flex items-center gap-2">
                  <ChevronRight className="w-4 h-4" />
                  Component Planning
                </a>
              </li>
              <li>
                <a href="#ai-generation" className="text-cyan-400 hover:text-cyan-300 flex items-center gap-2">
                  <ChevronRight className="w-4 h-4" />
                  AI Generation
                </a>
              </li>
              <li>
                <a href="#importing-data" className="text-cyan-400 hover:text-cyan-300 flex items-center gap-2">
                  <ChevronRight className="w-4 h-4" />
                  Importing Data
                </a>
              </li>
            </ul>
          </nav>

          {/* Getting Started Section */}
          <section id="getting-started" className="mb-16">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                <Zap className="w-5 h-5 text-amber-400" />
              </div>
              <h2 className="text-2xl font-bold">Getting Started</h2>
            </div>

            <p className="text-slate-300 mb-6">
              TaskTitan is a component-based project planning tool that helps teams break down projects into manageable
              work items. Here&apos;s how to get started.
            </p>

            <div className="space-y-8">
              {/* Step 1 */}
              <div className="component-card">
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <Users className="w-5 h-5 text-violet-400" />
                  Step 1: Create a Team
                </h3>
                <p className="text-slate-400 text-sm mb-4">
                  Teams are the foundation of TaskTitan. Each team has members with different roles and can manage
                  multiple projects.
                </p>
                <div className="bg-slate-900/50 rounded-lg p-4">
                  <h4 className="text-sm font-medium mb-2 text-slate-300">Team Roles:</h4>
                  <ul className="space-y-1 text-sm text-slate-400">
                    <li>
                      <span className="text-emerald-400 font-medium">Owner</span> — Full control, can delete the team
                    </li>
                    <li>
                      <span className="text-cyan-400 font-medium">Admin</span> — Can manage members and settings
                    </li>
                    <li>
                      <span className="text-slate-300 font-medium">Member</span> — Can create and edit
                      projects/components
                    </li>
                  </ul>
                </div>
              </div>

              {/* Step 2 */}
              <div className="component-card">
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <GitBranch className="w-5 h-5 text-violet-400" />
                  Step 2: Choose a Workflow
                </h3>
                <p className="text-slate-400 text-sm mb-4">
                  When creating a team, select a workflow template that matches your methodology:
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="bg-slate-900/50 rounded-lg p-3">
                    <h4 className="text-sm font-medium text-cyan-400">Scrum</h4>
                    <p className="text-xs text-slate-500">2-week sprints with planning and retrospectives</p>
                  </div>
                  <div className="bg-slate-900/50 rounded-lg p-3">
                    <h4 className="text-sm font-medium text-emerald-400">Kanban</h4>
                    <p className="text-xs text-slate-500">Continuous flow with WIP limits</p>
                  </div>
                  <div className="bg-slate-900/50 rounded-lg p-3">
                    <h4 className="text-sm font-medium text-amber-400">Shape Up</h4>
                    <p className="text-xs text-slate-500">6-week cycles with 2-week cooldown</p>
                  </div>
                  <div className="bg-slate-900/50 rounded-lg p-3">
                    <h4 className="text-sm font-medium text-slate-300">Custom</h4>
                    <p className="text-xs text-slate-500">Configure your own settings</p>
                  </div>
                </div>
              </div>

              {/* Step 3 */}
              <div className="component-card">
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-violet-400" />
                  Step 3: Create a Project
                </h3>
                <p className="text-slate-400 text-sm">
                  Projects belong to teams and contain all your work items (components). Give your project a clear name
                  and description — the AI uses this to generate relevant components.
                </p>
              </div>

              {/* Step 4 */}
              <div className="component-card">
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-violet-400" />
                  Step 4: Plan Sprints
                </h3>
                <p className="text-slate-400 text-sm mb-4">
                  If using time-boxed iterations, create sprints with start/end dates and capacity hours.
                </p>
                <div className="bg-slate-900/50 rounded-lg p-4">
                  <h4 className="text-sm font-medium mb-2 text-slate-300">Sprint Statuses:</h4>
                  <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-1 text-xs rounded bg-slate-700 text-slate-300">Planning</span>
                    <span className="px-2 py-1 text-xs rounded bg-cyan-900/50 text-cyan-400">Active</span>
                    <span className="px-2 py-1 text-xs rounded bg-emerald-900/50 text-emerald-400">Completed</span>
                    <span className="px-2 py-1 text-xs rounded bg-red-900/50 text-red-400">Cancelled</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Component Planning Section */}
          <section id="component-planning" className="mb-16">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
                <FileText className="w-5 h-5 text-violet-400" />
              </div>
              <h2 className="text-2xl font-bold">Component Planning</h2>
            </div>

            <p className="text-slate-300 mb-6">
              Components are the work items in TaskTitan. They follow the INVEST criteria for well-defined work items
              and can be organized hierarchically, supporting various methodologies including Scrum, Kanban, and Shape
              Up.
            </p>

            {/* Component Types */}
            <div className="component-card mb-8">
              <h3 className="text-lg font-semibold mb-4">Component Types</h3>
              <div className="space-y-4">
                <div className="flex items-start gap-4 p-3 bg-slate-900/50 rounded-lg">
                  <span className="px-2 py-1 text-xs font-medium rounded bg-violet-900/50 text-violet-400">EPIC</span>
                  <div>
                    <p className="text-sm text-slate-300">Large initiative (40-200 hours)</p>
                    <p className="text-xs text-slate-500">Example: &quot;User Authentication System&quot;</p>
                  </div>
                </div>
                <div className="flex items-start gap-4 p-3 bg-slate-900/50 rounded-lg">
                  <span className="px-2 py-1 text-xs font-medium rounded bg-cyan-900/50 text-cyan-400">FEATURE</span>
                  <div>
                    <p className="text-sm text-slate-300">Distinct capability (16-40 hours)</p>
                    <p className="text-xs text-slate-500">Example: &quot;Social Login&quot;</p>
                  </div>
                </div>
                <div className="flex items-start gap-4 p-3 bg-slate-900/50 rounded-lg">
                  <span className="px-2 py-1 text-xs font-medium rounded bg-emerald-900/50 text-emerald-400">
                    STORY
                  </span>
                  <div>
                    <p className="text-sm text-slate-300">User-facing change (2-16 hours)</p>
                    <p className="text-xs text-slate-500">Example: &quot;Enable User Login&quot;</p>
                  </div>
                </div>
                <div className="flex items-start gap-4 p-3 bg-slate-900/50 rounded-lg">
                  <span className="px-2 py-1 text-xs font-medium rounded bg-slate-700 text-slate-300">TASK</span>
                  <div>
                    <p className="text-sm text-slate-300">Technical work item (1-8 hours)</p>
                    <p className="text-xs text-slate-500">Example: &quot;Configure Database Connection&quot;</p>
                  </div>
                </div>
                <div className="flex items-start gap-4 p-3 bg-slate-900/50 rounded-lg">
                  <span className="px-2 py-1 text-xs font-medium rounded bg-red-900/50 text-red-400">BUG</span>
                  <div>
                    <p className="text-sm text-slate-300">Defect to fix (1-16 hours)</p>
                    <p className="text-xs text-slate-500">Example: &quot;Fix Login Button Not Responding&quot;</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Component Statuses */}
            <div className="component-card mb-8">
              <h3 className="text-lg font-semibold mb-4">Component Statuses</h3>
              <p className="text-slate-400 text-sm mb-4">Components flow through these statuses:</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-3 py-1.5 text-xs rounded-full bg-slate-700 text-slate-300">Planning</span>
                <ChevronRight className="w-4 h-4 text-slate-600" />
                <span className="px-3 py-1.5 text-xs rounded-full bg-cyan-900/50 text-cyan-400">In Progress</span>
                <ChevronRight className="w-4 h-4 text-slate-600" />
                <span className="px-3 py-1.5 text-xs rounded-full bg-amber-900/50 text-amber-400">Blocked</span>
                <ChevronRight className="w-4 h-4 text-slate-600" />
                <span className="px-3 py-1.5 text-xs rounded-full bg-violet-900/50 text-violet-400">Review</span>
                <ChevronRight className="w-4 h-4 text-slate-600" />
                <span className="px-3 py-1.5 text-xs rounded-full bg-emerald-900/50 text-emerald-400">Completed</span>
              </div>
            </div>

            {/* INVEST Criteria */}
            <div className="component-card mb-8">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                INVEST Criteria
              </h3>
              <p className="text-slate-400 text-sm mb-4">
                TaskTitan encourages components that follow the INVEST criteria for well-defined work items:
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="p-3 bg-slate-900/50 rounded-lg">
                  <span className="text-emerald-400 font-medium">I</span>
                  <span className="text-slate-300">ndependent</span>
                  <p className="text-xs text-slate-500 mt-1">Can be developed without waiting for others</p>
                </div>
                <div className="p-3 bg-slate-900/50 rounded-lg">
                  <span className="text-emerald-400 font-medium">N</span>
                  <span className="text-slate-300">egotiable</span>
                  <p className="text-xs text-slate-500 mt-1">Details can be refined through discussion</p>
                </div>
                <div className="p-3 bg-slate-900/50 rounded-lg">
                  <span className="text-emerald-400 font-medium">V</span>
                  <span className="text-slate-300">aluable</span>
                  <p className="text-xs text-slate-500 mt-1">Delivers clear value to users or business</p>
                </div>
                <div className="p-3 bg-slate-900/50 rounded-lg">
                  <span className="text-emerald-400 font-medium">E</span>
                  <span className="text-slate-300">stimable</span>
                  <p className="text-xs text-slate-500 mt-1">Effort can be reasonably estimated</p>
                </div>
                <div className="p-3 bg-slate-900/50 rounded-lg">
                  <span className="text-emerald-400 font-medium">S</span>
                  <span className="text-slate-300">mall</span>
                  <p className="text-xs text-slate-500 mt-1">Completable within appropriate timeframe</p>
                </div>
                <div className="p-3 bg-slate-900/50 rounded-lg">
                  <span className="text-emerald-400 font-medium">T</span>
                  <span className="text-slate-300">estable</span>
                  <p className="text-xs text-slate-500 mt-1">Has clear acceptance criteria</p>
                </div>
              </div>
            </div>

            {/* Dependencies */}
            <div className="component-card">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <GitBranch className="w-5 h-5 text-violet-400" />
                Dependencies & Hierarchy
              </h3>
              <p className="text-slate-400 text-sm mb-4">
                Components can have parent-child relationships and dependencies:
              </p>
              <ul className="space-y-2 text-sm text-slate-400">
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400">•</span>
                  <span>
                    <span className="text-slate-300">Parent/Child:</span> Epics contain Features, Features contain
                    Stories
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400">•</span>
                  <span>
                    <span className="text-slate-300">Dependencies:</span> &quot;Component A depends on Component B&quot;
                    means B must complete first
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400">•</span>
                  <span>
                    <span className="text-slate-300">Blocking:</span> Components can block others, tracked in the UI
                  </span>
                </li>
              </ul>
            </div>
          </section>

          {/* AI Generation Section */}
          <section id="ai-generation" className="mb-16">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-emerald-400" />
              </div>
              <h2 className="text-2xl font-bold">AI Generation</h2>
            </div>

            <p className="text-slate-300 mb-6">
              TaskTitan uses Amazon Bedrock with Claude to provide AI-powered features. No external API keys needed —
              everything runs within AWS.
            </p>

            <div className="space-y-6">
              {/* Component Generation */}
              <div className="component-card">
                <h3 className="text-lg font-semibold mb-3">Component Generation</h3>
                <p className="text-slate-400 text-sm mb-4">
                  When you create a project, the AI can analyze your description and generate a complete sprint plan:
                </p>
                <ul className="space-y-2 text-sm text-slate-400">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                    Generates Stories and Tasks based on your project description
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                    Creates 2-4 sprints with clear goals (for Scrum teams)
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                    Estimates hours and sets priorities
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                    Identifies dependencies between components
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                    Respects your team&apos;s workflow (Scrum, Kanban, Shape Up)
                  </li>
                </ul>
                <div className="mt-4 p-3 bg-amber-900/20 border border-amber-800/50 rounded-lg">
                  <p className="text-sm text-amber-400">
                    <strong>Tip:</strong> Write detailed project descriptions for better AI suggestions. Include
                    features, target users, and technical requirements.
                  </p>
                </div>
              </div>

              {/* Natural Language */}
              <div className="component-card">
                <h3 className="text-lg font-semibold mb-3">Natural Language Creation</h3>
                <p className="text-slate-400 text-sm mb-4">
                  Describe a component in plain English, and the AI will structure it properly:
                </p>
                <div className="bg-slate-900/50 rounded-lg p-4 mb-4">
                  <p className="text-xs text-slate-500 mb-2">Example input:</p>
                  <p className="text-sm text-slate-300 italic">
                    &quot;We need a login page that supports Google and GitHub OAuth, with remember me checkbox&quot;
                  </p>
                </div>
                <div className="bg-emerald-900/20 border border-emerald-800/50 rounded-lg p-4">
                  <p className="text-xs text-emerald-400 mb-2">AI generates:</p>
                  <ul className="space-y-1 text-sm text-slate-300">
                    <li>
                      • <span className="text-slate-400">Name:</span> &quot;Implement OAuth Login with Social
                      Providers&quot;
                    </li>
                    <li>
                      • <span className="text-slate-400">Type:</span> STORY
                    </li>
                    <li>
                      • <span className="text-slate-400">Estimated hours:</span> 12
                    </li>
                    <li>
                      • <span className="text-slate-400">Acceptance criteria</span> with testable conditions
                    </li>
                  </ul>
                </div>
              </div>

              {/* Other AI Features */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="component-card">
                  <h4 className="font-semibold mb-2 text-sm">Component Breakdown</h4>
                  <p className="text-slate-400 text-xs">
                    Have a large component? The AI can suggest how to break it into smaller, manageable subtasks. Just
                    click &quot;Refine&quot; on any component.
                  </p>
                </div>
                <div className="component-card">
                  <h4 className="font-semibold mb-2 text-sm">Chat-Based Refinement</h4>
                  <p className="text-slate-400 text-xs">
                    Have a conversation with the AI to refine components. Ask questions like &quot;What about error
                    handling?&quot; or &quot;Should we add caching?&quot;
                  </p>
                </div>
                <div className="component-card">
                  <h4 className="font-semibold mb-2 text-sm">AI Sprint Planning</h4>
                  <p className="text-slate-400 text-xs">
                    Let the AI help you plan sprints by suggesting which backlog items to include, considering priority
                    and dependencies.
                  </p>
                </div>
                <div className="component-card">
                  <h4 className="font-semibold mb-2 text-sm">Component Templates</h4>
                  <p className="text-slate-400 text-xs">
                    Start from pre-built templates for common patterns: Login, CRUD Operations, Search, Dashboard, File
                    Upload, and more.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Importing Data Section */}
          <section id="importing-data" className="mb-16">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
                <Upload className="w-5 h-5 text-cyan-400" />
              </div>
              <h2 className="text-2xl font-bold">Importing Data</h2>
            </div>

            <p className="text-slate-300 mb-6">
              Migrate your existing work items from other tools using the Import Wizard. TaskTitan supports multiple
              formats and uses AI to map your data automatically.
            </p>

            <div className="space-y-6">
              {/* Supported Formats */}
              <div className="component-card">
                <h3 className="text-lg font-semibold mb-4">Supported Formats</h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="p-3 bg-slate-900/50 rounded-lg">
                    <h4 className="text-sm font-medium text-slate-300">CSV Files</h4>
                    <p className="text-xs text-slate-500">Any spreadsheet exported as CSV</p>
                  </div>
                  <div className="p-3 bg-slate-900/50 rounded-lg">
                    <h4 className="text-sm font-medium text-slate-300">JSON Files</h4>
                    <p className="text-xs text-slate-500">Structured data exports</p>
                  </div>
                  <div className="p-3 bg-slate-900/50 rounded-lg">
                    <h4 className="text-sm font-medium text-slate-300">Jira Exports</h4>
                    <p className="text-xs text-slate-500">CSV exports from Jira Cloud/Server</p>
                  </div>
                  <div className="p-3 bg-slate-900/50 rounded-lg">
                    <h4 className="text-sm font-medium text-slate-300">Trello / Asana</h4>
                    <p className="text-xs text-slate-500">Board and task exports</p>
                  </div>
                </div>
              </div>

              {/* AI-Powered Import */}
              <div className="component-card">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-emerald-400" />
                  AI-Powered Import
                </h3>
                <ul className="space-y-2 text-sm text-slate-400">
                  <li className="flex items-start gap-2">
                    <Search className="w-4 h-4 text-cyan-400 mt-0.5 flex-shrink-0" />
                    <span>
                      <span className="text-slate-300">Auto-detection:</span> Recognizes Jira, Trello, and Asana export
                      formats
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <GitBranch className="w-4 h-4 text-cyan-400 mt-0.5 flex-shrink-0" />
                    <span>
                      <span className="text-slate-300">Smart Mapping:</span> Suggests column-to-field mappings with
                      confidence scores
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Sparkles className="w-4 h-4 text-cyan-400 mt-0.5 flex-shrink-0" />
                    <span>
                      <span className="text-slate-300">Data Cleanup:</span> Normalizes status values, types, and
                      priorities automatically
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-cyan-400 mt-0.5 flex-shrink-0" />
                    <span>
                      <span className="text-slate-300">Validation:</span> Highlights errors with inline editing to fix
                      before import
                    </span>
                  </li>
                </ul>
              </div>

              {/* Import Process */}
              <div className="component-card">
                <h3 className="text-lg font-semibold mb-4">Import Process</h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-3 bg-slate-900/50 rounded-lg">
                    <span className="w-6 h-6 rounded-full bg-cyan-900/50 text-cyan-400 flex items-center justify-center text-xs font-medium">
                      1
                    </span>
                    <div>
                      <span className="text-sm text-slate-300">Upload</span>
                      <p className="text-xs text-slate-500">Drop your CSV or JSON file</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-slate-900/50 rounded-lg">
                    <span className="w-6 h-6 rounded-full bg-cyan-900/50 text-cyan-400 flex items-center justify-center text-xs font-medium">
                      2
                    </span>
                    <div>
                      <span className="text-sm text-slate-300">Review Mappings</span>
                      <p className="text-xs text-slate-500">AI suggests mappings, adjust as needed</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-slate-900/50 rounded-lg">
                    <span className="w-6 h-6 rounded-full bg-cyan-900/50 text-cyan-400 flex items-center justify-center text-xs font-medium">
                      3
                    </span>
                    <div>
                      <span className="text-sm text-slate-300">Clean Data</span>
                      <p className="text-xs text-slate-500">Optionally let AI fix inconsistencies</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-slate-900/50 rounded-lg">
                    <span className="w-6 h-6 rounded-full bg-emerald-900/50 text-emerald-400 flex items-center justify-center text-xs font-medium">
                      4
                    </span>
                    <div>
                      <span className="text-sm text-slate-300">Import</span>
                      <p className="text-xs text-slate-500">Components are created with hierarchy and dependencies</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Help Section */}
          <div className="p-6 bg-gradient-to-br from-cyan-900/20 to-emerald-900/20 border border-cyan-800/30 rounded-xl text-center">
            <h3 className="text-lg font-semibold mb-2">Need More Help?</h3>
            <p className="text-slate-400 text-sm mb-4">
              Try the demo mode to explore features risk-free, or reach out to our team.
            </p>
            <Link
              href="/?demo=true"
              className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              Try Demo Mode
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
