# TaskTitan Feature Demo Guide
## Team Bravo: E-Commerce Platform Project

This guide walks you through a comprehensive demo of all TaskTitan features using a realistic e-commerce platform development scenario.

---

## Demo Setup (2 minutes)

### 1. Access the Application
1. Navigate to **https://tasktitan.live**
2. **Admire the new sign-in page!** (floating orbs, twinkling stars, gradient shimmer button)
3. Click **"Continue with AWS Cognito"**
4. Sign in with your account

### 2. Generate Demo Data
1. Once signed in, **click your profile** (top right)
2. Scroll down and click **"Seed Team Bravo Data"** button (or navigate to `/api/seed-bravo` and POST)
3. Wait ~5-10 seconds for data generation
4. You should see success message with summary

**What was created:**
- ✅ Team Bravo (12 members: Engineering Manager, Tech Lead, Senior/Mid/Junior Engineers, QA, Designer, PM)
- ✅ 3 Projects: Customer Portal, Checkout & Orders, Admin Dashboard
- ✅ 5 Epics across projects with full component hierarchy (30+ components)
- ✅ 2 Sprints (1 active, 1 planning) spanning multiple projects
- ✅ 5 decisions documented with context

---

## Feature Walkthrough (15-20 minutes)

### Phase 0: Workflow Freedom (3 min)

**Show Sprint Flexibility**
1. Go to **Team Bravo** → **Projects** → **Customer Portal** (or any of the 3 projects)
2. Notice components are in **both** Sprint 1 and Backlog (no enforcement!)
3. Click **Sprint Timeline** to see active sprint pulling work from multiple projects
4. Go to **Team Bravo** → **Workflow Settings**

**Key Points:**
- ✅ Soft WIP limits (recommended, not enforced)
- ✅ Sprints are optional (work can stay in backlog)
- ✅ Flexible cycles (1/2/4/6 weeks or none)
- ✅ No forced estimates

---

### Phase 1: AI Wireframe Preview (5 min)

**Generate a Wireframe**
1. Find component: **"OAuth Integration (Google, GitHub)"**
2. Scroll to find **"Generate Wireframe"** button (sparkle icon ✨)
3. Click and wait ~10-15 seconds
4. **Click "View Wireframe"** when ready
5. Marvel at the AI-generated HTML mockup!
6. Click **"Export"** to download standalone HTML file

**What's happening:**
- Claude Sonnet 4.5 reads the component description
- Generates semantic HTML + Tailwind CSS
- Creates interactive mockup with proper structure
- Saves to S3 for persistence
- Cost: ~$0.05 per wireframe

**Try another:**
- **"Stripe Payment Integration"** → More complex UI with payment form
- **"Product Variant System"** → Dynamic form with dropdowns/swatches

---

### Phase 2: Decision Journal / Component Context (7 min) ⭐ *BRAND NEW!*

**View Existing Context**
1. Open **"User Authentication & Authorization"** epic
2. Notice **"Has Context"** badge (violet)
3. Click to expand context panel

**What you see:**
- AI Summary (auto-generated from your notes)
- Original decision: "JWT-based auth with NextAuth.js v5"
- Rationale: Why this approach was chosen
- Alternatives considered: Session-based, Cognito, Auth0, Clerk
- Related links: Documentation references

**Add New Context**
1. Find a component without context (e.g., "Guest Checkout Flow")
2. Click **"Add Context / Decision"**
3. Fill out the form:

```
What was decided:
Allow checkout without account creation, with option to create account using order email after purchase completes.

Why this approach:
Studies show 25% cart abandonment due to forced registration. Guest checkout reduces friction and increases conversion. Post-purchase account creation captures customer data without upfront commitment.

Alternatives considered:
- Mandatory registration (too much friction)
- Social login only (excludes privacy-conscious users)
- Magic link (email deliverability issues)

Related Links:
https://baymard.com/blog/checkout-flow-average-form-fields
```

4. Click **"Save Context"**
5. Click **"Generate AI Summary"**
6. Wait ~5 seconds for Claude to process
7. See AI-generated summary with key points!

**Why This Matters:**
- 🧠 Preserves **WHY** decisions were made (not just WHAT)
- 📅 Future team members understand context 6 months later
- 🤝 Onboarding new devs is faster
- 💡 Prevents re-litigating old decisions
- 🎯 Unique to TaskTitan (Linear/Asana/Jira don't have this)

---

### Core Features Showcase (5 min)

**Component Hierarchy**
1. View **"Product Catalog & Inventory Management"** epic
2. Expand to see: Epic → Features → Stories → Tasks
3. Notice team assignments on each component
4. Click **Dependency Graph** tab to visualize relationships

**Sprint Management (Optional!)**
1. Go to **Sprint 1: Authentication & Infrastructure**
2. See only IN_PROGRESS components assigned
3. Notice backlog work is NOT forced into sprint
4. Try dragging a component between sprint and backlog (fluid!)

**Team Assignment**
1. Click avatar icon on any component
2. See Team Bravo members listed
3. Assign multiple people (pair programming!)
4. Assignments show on component cards

**Status Tracking**
1. Click status dropdown on any component
2. Change: Planning → In Progress → Review → Completed
3. Status history is tracked automatically
4. Check **Timeline View** for Gantt-style visualization

**GitHub Integration** (if you want to demo)
1. Go to **Project Settings** → **GitHub Integration**
2. Connect your repo
3. Components automatically update when PRs are opened
4. PR links appear on cards

---

## Feature Comparison (Quick Pitch)

**TaskTitan vs Competitors:**

| Feature | TaskTitan | Linear | Asana | YouTrack |
|---------|-----------|--------|-------|----------|
| **Decision Context** | ✅ AI-powered | ❌ | ❌ | ❌ |
| **AI Wireframes** | ✅ | ❌ | ❌ | ❌ |
| **Workflow Freedom** | ✅ Sprints optional | ⚠️ Cycles forced | ⚠️ Rigid workflows | ✅ |
| **Component Hierarchy** | ✅ 5 levels | ✅ 3 levels | ⚠️ Limited | ✅ |
| **Cost** | $5-10/mo | $8-16/user | $10-25/user | $8-16/user |
| **AI Features** | ✅ Context + Wireframes | ⚠️ Autocomplete only | ⚠️ Summaries only | ⚠️ Summaries |

**Unique Value Props:**
1. 🧠 **Decision Memory** - Only PM tool that documents WHY with AI assistance
2. 👁️ **Visual Mockups** - Generate wireframes from descriptions
3. 🔓 **True Flexibility** - Work with or without sprints
4. 💰 **Affordable** - 80% cheaper than Linear for small teams
5. ⚡ **Serverless** - Zero infrastructure to manage

---

## Demo Script (5-Minute Version)

**Opening:**
"TaskTitan is an AI-powered project management tool that solves a problem other tools ignore: preserving WHY decisions were made, not just WHAT needs doing."

**Demo Flow:**
1. **Show beautiful sign-in page** (30 sec)
   - "This is what greets users - modern, professional, sets expectations"

2. **Navigate to Team Bravo projects** (30 sec)
   - "12-person team managing 3 projects: Customer Portal, Checkout & Orders, Admin Dashboard"
   - "Realistic multi-project workflow - not everything in one monolith"
   - "Notice component hierarchy: Epic → Feature → Story → Task"

3. **Open "User Authentication" epic and show context** (2 min)
   - "Here's the decision: JWT auth with NextAuth.js"
   - "But more importantly, here's WHY: stateless, suitable for serverless, handles OAuth"
   - "And alternatives considered: session-based, Cognito, Auth0"
   - "AI summarized this for future readers"
   - **This is unique to TaskTitan**

4. **Generate a wireframe** (1 min)
   - "Watch AI create a visual mockup from component description"
   - "10 seconds later, we have an interactive HTML preview"
   - "Download it, share with stakeholders, iterate"

5. **Show Workflow Freedom** (1 min)
   - "Sprints pull work from multiple projects - realistic cross-project coordination"
   - "Sprints are optional - work can stay in backlog"
   - "WIP limits are suggestions, not enforcement"
   - "Adapt the tool to your team, not vice versa"

**Closing:**
"TaskTitan costs $5-10/month vs $500+/month for Linear with a team. It's built for small teams who want AI-powered planning without rigid processes or breaking the bank."

---

## Key Talking Points

**For Engineers:**
- "Decision context prevents re-litigating architectural choices"
- "Wireframes help frontend/backend alignment before coding"
- "Dependency graph prevents merge conflicts"

**For Product Managers:**
- "Capture why features were prioritized or deprioritized"
- "Onboard new team members faster with documented context"
- "No more 'why did we build it this way?' questions"

**For Founders:**
- "80% cheaper than Linear for small teams"
- "No infrastructure to manage (fully serverless)"
- "Free tier includes unlimited projects and AI features"

---

## Troubleshooting

**"I don't see the context panel"**
- Make sure you've deployed the latest version
- Try hard refresh (Cmd+Shift+R / Ctrl+Shift+R)

**"Wireframe generation failed"**
- Check AWS Bedrock quota (10 requests/min default)
- Component description should be detailed

**"Seed-bravo button doesn't exist"**
- Navigate directly to: https://tasktitan.live/api/seed-bravo (POST request)
- Or check console for errors

---

## Next Steps

**After Demo:**
1. Delete demo data: `/api/clear-all-data` (if needed)
2. Create your real team and projects
3. Invite team members via email
4. Connect GitHub integration
5. Start documenting decisions with context!

**Feature Roadmap:**
- Phase 2 UI: Natural language component creation, smart breakdowns, templates
- Phase 3: Workflow insights (cycle time, bottleneck detection)
- Phase 4: Enhanced wireframes (interactive prototypes)
