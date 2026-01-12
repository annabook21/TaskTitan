import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import type { ComponentType, ComponentStatus } from '@prisma/client';

// Team Bravo - Larger development team (12 members)
const bravoUsers = [
  // Engineering Leadership
  { id: 'bravo-lisa-martinez-001', email: 'lisa.martinez@bravo.tasktitan.dev', name: 'Lisa Martinez', role: 'OWNER' as const, title: 'Engineering Manager' },
  { id: 'bravo-david-kim-002', email: 'david.kim@bravo.tasktitan.dev', name: 'David Kim', role: 'ADMIN' as const, title: 'Tech Lead' },

  // Senior Engineers
  { id: 'bravo-rachel-patel-003', email: 'rachel.patel@bravo.tasktitan.dev', name: 'Rachel Patel', role: 'MEMBER' as const, title: 'Senior Backend Engineer' },
  { id: 'bravo-tom-anderson-004', email: 'tom.anderson@bravo.tasktitan.dev', name: 'Tom Anderson', role: 'MEMBER' as const, title: 'Senior Frontend Engineer' },

  // Mid-Level Engineers
  { id: 'bravo-sofia-cruz-005', email: 'sofia.cruz@bravo.tasktitan.dev', name: 'Sofia Cruz', role: 'MEMBER' as const, title: 'Full Stack Engineer' },
  { id: 'bravo-mike-johnson-006', email: 'mike.johnson@bravo.tasktitan.dev', name: 'Mike Johnson', role: 'MEMBER' as const, title: 'DevOps Engineer' },
  { id: 'bravo-nina-wong-007', email: 'nina.wong@bravo.tasktitan.dev', name: 'Nina Wong', role: 'MEMBER' as const, title: 'Frontend Engineer' },

  // Junior Engineers
  { id: 'bravo-chris-brown-008', email: 'chris.brown@bravo.tasktitan.dev', name: 'Chris Brown', role: 'MEMBER' as const, title: 'Junior Backend Engineer' },
  { id: 'bravo-maya-singh-009', email: 'maya.singh@bravo.tasktitan.dev', name: 'Maya Singh', role: 'MEMBER' as const, title: 'Junior Frontend Engineer' },

  // QA & Design
  { id: 'bravo-alex-rodriguez-010', email: 'alex.rodriguez@bravo.tasktitan.dev', name: 'Alex Rodriguez', role: 'MEMBER' as const, title: 'QA Engineer' },
  { id: 'bravo-emma-taylor-011', email: 'emma.taylor@bravo.tasktitan.dev', name: 'Emma Taylor', role: 'MEMBER' as const, title: 'UX/UI Designer' },

  // Product
  { id: 'bravo-jordan-lee-012', email: 'jordan.lee@bravo.tasktitan.dev', name: 'Jordan Lee', role: 'VIEWER' as const, title: 'Product Manager' },
];

interface ComponentData {
  name: string;
  description: string;
  type: ComponentType;
  status: ComponentStatus;
  priority: number;
  estimatedHours: number;
  assignees: string[]; // User IDs
  children?: ComponentData[];
  contextDecision?: string;
  contextRationale?: string;
  contextAlternatives?: string;
  contextLinks?: string[];
}

interface ProjectData {
  name: string;
  description: string;
  components: ComponentData[];
}

// Realistic multi-project structure (3 projects instead of 1 monolithic)
const projects: ProjectData[] = [
  {
    name: 'Customer Portal',
    description: 'Public-facing customer experience: authentication, product browsing, and search. Target: Q1 2026 launch.',
    components: [
  {
    name: 'User Authentication & Authorization',
    description: 'Complete authentication system with role-based access control, social login, and security features',
    type: 'EPIC',
    status: 'IN_PROGRESS',
    priority: 10,
    estimatedHours: 160,
    assignees: ['bravo-david-kim-002', 'bravo-rachel-patel-003'],
    contextDecision: 'Implement JWT-based authentication with refresh tokens stored in httpOnly cookies. Use NextAuth.js v5 for social providers and custom credentials.',
    contextRationale: 'JWT tokens provide stateless authentication suitable for our serverless architecture. NextAuth.js offers battle-tested OAuth integrations and handles security best practices. HttpOnly cookies prevent XSS attacks while refresh tokens enable long-lived sessions without compromising security.',
    contextAlternatives: 'Considered session-based auth (requires Redis/database overhead), Cognito (vendor lock-in), Auth0 (costly at scale), and Clerk (new, less proven). Passport.js was too low-level for our timeline.',
    contextLinks: ['https://next-auth.js.org/v5/getting-started', 'https://owasp.org/www-project-top-ten/'],
    children: [
      {
        name: 'OAuth Integration (Google, GitHub)',
        description: 'Implement social login with Google and GitHub using NextAuth.js providers',
        type: 'FEATURE',
        status: 'IN_PROGRESS',
        priority: 9,
        estimatedHours: 40,
        assignees: ['bravo-rachel-patel-003'],
        children: [
          {
            name: 'Configure NextAuth.js providers',
            description: 'Set up Google and GitHub OAuth providers with proper scopes and callbacks',
            type: 'STORY',
            status: 'COMPLETED',
            priority: 9,
            estimatedHours: 8,
            assignees: ['bravo-rachel-patel-003'],
          },
          {
            name: 'Implement account linking',
            description: 'Allow users to link multiple OAuth providers to single account',
            type: 'STORY',
            status: 'IN_PROGRESS',
            priority: 8,
            estimatedHours: 16,
            assignees: ['bravo-rachel-patel-003'],
          },
          {
            name: 'Add OAuth error handling',
            description: 'Handle OAuth failures, expired tokens, and revoked permissions gracefully',
            type: 'TASK',
            status: 'PLANNING',
            priority: 7,
            estimatedHours: 8,
            assignees: ['bravo-chris-brown-008'],
          },
        ],
      },
      {
        name: 'Role-Based Access Control (RBAC)',
        description: 'Implement fine-grained permissions system with role inheritance',
        type: 'FEATURE',
        status: 'PLANNING',
        priority: 8,
        estimatedHours: 50,
        assignees: ['bravo-david-kim-002'],
        contextDecision: 'Use CASL (isomorphic-authorization) for attribute-based access control with predefined roles (Admin, Manager, Developer, Viewer) and custom permissions per resource.',
        contextRationale: 'CASL provides type-safe, declarative permissions that work on both frontend and backend. It supports complex rules like "managers can edit projects they own" without hard-coding logic. The library is lightweight (3KB gzipped) and has excellent TypeScript support.',
        contextAlternatives: 'Considered casbin (too enterprise/complex), custom implementation (reinventing wheel, security risks), and OSO (new, small community). AWS IAM policies were too rigid for our multi-tenant needs.',
        children: [
          {
            name: 'Define permission schema',
            description: 'Create CASL rules for all resources (projects, components, teams)',
            type: 'STORY',
            status: 'PLANNING',
            priority: 8,
            estimatedHours: 12,
            assignees: ['bravo-david-kim-002'],
          },
          {
            name: 'Implement server-side middleware',
            description: 'Add permission checks to all API routes and server actions',
            type: 'STORY',
            status: 'PLANNING',
            priority: 9,
            estimatedHours: 20,
            assignees: ['bravo-rachel-patel-003'],
          },
          {
            name: 'Build admin role management UI',
            description: 'Interface for assigning roles and viewing permissions matrix',
            type: 'STORY',
            status: 'PLANNING',
            priority: 7,
            estimatedHours: 18,
            assignees: ['bravo-nina-wong-007'],
          },
        ],
      },
    ],
  },
  {
    name: 'Product Catalog & Inventory Management',
    description: 'Comprehensive product management system with categories, variants, and real-time inventory tracking',
    type: 'EPIC',
    status: 'PLANNING',
    priority: 9,
    estimatedHours: 200,
    assignees: ['bravo-tom-anderson-004', 'bravo-sofia-cruz-005'],
    contextDecision: 'Build a flexible product variant system using PostgreSQL JSON columns for attributes (size, color, etc.) with separate SKU tracking. Implement optimistic inventory locking with Redis.',
    contextRationale: 'JSON columns allow unlimited custom attributes without schema migrations for each product type. This is critical for an e-commerce platform with diverse products. Redis provides fast distributed locking to prevent overselling during high traffic (Black Friday scenarios). PostgreSQL handles transactional integrity.',
    contextAlternatives: 'Considered EAV model (too many joins, slow queries), separate tables per product type (rigid, hard to query across types), MongoDB (loses ACID guarantees for inventory), and Elasticsearch primary storage (not designed for writes).',
    contextLinks: ['https://www.postgresql.org/docs/current/datatype-json.html', 'https://redis.io/docs/manual/patterns/distributed-locks/'],
    children: [
      {
        name: 'Product Variant System',
        description: 'Support products with multiple variants (sizes, colors, materials) with independent pricing/inventory',
        type: 'FEATURE',
        status: 'PLANNING',
        priority: 9,
        estimatedHours: 60,
        assignees: ['bravo-sofia-cruz-005'],
        children: [
          {
            name: 'Design variant database schema',
            description: 'Prisma schema for Product, Variant, AttributeType, AttributeValue with proper relations',
            type: 'STORY',
            status: 'PLANNING',
            priority: 10,
            estimatedHours: 12,
            assignees: ['bravo-sofia-cruz-005'],
          },
          {
            name: 'Build variant selection UI',
            description: 'Dynamic form that generates variant picker based on attribute types (dropdowns, swatches)',
            type: 'STORY',
            status: 'PLANNING',
            priority: 8,
            estimatedHours: 24,
            assignees: ['bravo-nina-wong-007', 'bravo-emma-taylor-011'],
          },
          {
            name: 'Implement variant pricing rules',
            description: 'Support base price + variant-specific adjustments with bulk discount rules',
            type: 'TASK',
            status: 'PLANNING',
            priority: 7,
            estimatedHours: 16,
            assignees: ['bravo-chris-brown-008'],
          },
        ],
      },
      {
        name: 'Real-Time Inventory Tracking',
        description: 'Distributed inventory management with overselling prevention and low-stock alerts',
        type: 'FEATURE',
        status: 'PLANNING',
        priority: 10,
        estimatedHours: 70,
        assignees: ['bravo-rachel-patel-003', 'bravo-mike-johnson-006'],
        children: [
          {
            name: 'Implement Redis inventory locks',
            description: 'Distributed locking mechanism to reserve inventory during checkout process',
            type: 'STORY',
            status: 'PLANNING',
            priority: 10,
            estimatedHours: 20,
            assignees: ['bravo-rachel-patel-003'],
          },
          {
            name: 'Build inventory adjustment API',
            description: 'Endpoints for restocking, returns, and manual adjustments with audit trail',
            type: 'STORY',
            status: 'PLANNING',
            priority: 9,
            estimatedHours: 18,
            assignees: ['bravo-chris-brown-008'],
          },
          {
            name: 'Create low-stock alert system',
            description: 'Background job that triggers alerts when inventory falls below threshold',
            type: 'STORY',
            status: 'PLANNING',
            priority: 7,
            estimatedHours: 16,
            assignees: ['bravo-mike-johnson-006'],
          },
          {
            name: 'Add inventory sync dashboard',
            description: 'Real-time view of stock levels across all warehouses with CSV export',
            type: 'TASK',
            status: 'PLANNING',
            priority: 6,
            estimatedHours: 16,
            assignees: ['bravo-maya-singh-009'],
          },
        ],
      },
      {
        name: 'Advanced Product Search',
        description: 'Full-text search with filters, facets, and autocomplete using Elasticsearch',
        type: 'FEATURE',
        status: 'PLANNING',
        priority: 8,
        estimatedHours: 50,
        assignees: ['bravo-sofia-cruz-005'],
        contextDecision: 'Use Elasticsearch for product search instead of PostgreSQL full-text search. Sync data from Postgres using Debezium CDC (change data capture) to maintain single source of truth.',
        contextRationale: 'Elasticsearch provides sub-50ms search with typo tolerance, faceted navigation (filter by brand, price, category), and relevance ranking. Debezium ensures eventual consistency without dual-writes. PostgreSQL full-text search lacks advanced features like fuzzy matching and aggregations at scale.',
        contextAlternatives: 'Considered Algolia (expensive, $500+/month), Meilisearch (newer, smaller community, limited faceting), PostgreSQL tsvector (slow for large catalogs, limited features), and Typesense (good but less mature tooling).',
      },
    ],
  },
    ],
  },
  {
    name: 'Checkout & Orders',
    description: 'Shopping cart, payment processing, and order management. Depends on Customer Portal for auth. Target: Q2 2026.',
    components: [
      {
        name: 'Shopping Cart & Checkout',
        description: 'Multi-step checkout flow with cart persistence, promo codes, and payment processing',
        type: 'EPIC',
        status: 'PLANNING',
        priority: 10,
        estimatedHours: 180,
        assignees: ['bravo-tom-anderson-004'],
        children: [
          {
            name: 'Stripe Payment Integration',
            description: 'Integrate Stripe Elements for card payments with 3D Secure and Apple/Google Pay',
            type: 'FEATURE',
            status: 'PLANNING',
            priority: 10,
            estimatedHours: 60,
            assignees: ['bravo-tom-anderson-004'],
            contextDecision: 'Use Stripe Payment Intents API with client-side Elements for PCI compliance. Enable automatic payment method collection (cards, wallets, BNPL) via Payment Element.',
            contextRationale: 'Stripe Payment Intents handle 3D Secure authentication flows automatically and support Strong Customer Authentication (SCA) required in EU. Payment Element adapts UI based on customer location and shows relevant payment methods. We avoid storing card data and Stripe handles PCI compliance (Level 1 certified).',
            contextAlternatives: 'Considered PayPal (lower conversion rates, higher fees), Square (limited international), Braintree (more complex API, PayPal-owned), and Adyen (enterprise pricing, overkill for MVP).',
            contextLinks: ['https://stripe.com/docs/payments/payment-intents', 'https://stripe.com/docs/security/guide'],
          },
          {
            name: 'Guest Checkout Flow',
            description: 'Allow purchases without account creation, with optional account creation post-purchase',
            type: 'FEATURE',
            status: 'PLANNING',
            priority: 9,
            estimatedHours: 40,
            assignees: ['bravo-nina-wong-007'],
          },
          {
            name: 'Abandoned Cart Recovery',
            description: 'Email automation for cart abandonment with personalized discount codes',
            type: 'FEATURE',
            status: 'PLANNING',
            priority: 7,
            estimatedHours: 35,
            assignees: ['bravo-mike-johnson-006'],
          },
        ],
      },
      {
        name: 'Order Management & Fulfillment',
        description: 'End-to-end order processing from placement to delivery with shipment tracking',
        type: 'EPIC',
        status: 'PLANNING',
        priority: 9,
        estimatedHours: 150,
        assignees: ['bravo-sofia-cruz-005', 'bravo-mike-johnson-006'],
        children: [
          {
            name: 'Order Processing Pipeline',
            description: 'State machine for order lifecycle: pending → confirmed → shipped → delivered',
            type: 'FEATURE',
            status: 'PLANNING',
            priority: 9,
            estimatedHours: 50,
            assignees: ['bravo-sofia-cruz-005'],
          },
          {
            name: 'Shipment Tracking Integration',
            description: 'Integrate with ShipStation/EasyPost for label generation and tracking updates',
            type: 'FEATURE',
            status: 'PLANNING',
            priority: 8,
            estimatedHours: 45,
            assignees: ['bravo-mike-johnson-006'],
          },
          {
            name: 'Returns & Refunds Portal',
            description: 'Customer-facing return request system with automated refund processing',
            type: 'FEATURE',
            status: 'PLANNING',
            priority: 7,
            estimatedHours: 55,
            assignees: ['bravo-chris-brown-008'],
          },
        ],
      },
    ],
  },
  {
    name: 'Admin Dashboard',
    description: 'Internal tools for operations team: analytics, customer support, and inventory management. Target: Q2 2026.',
    components: [
      {
        name: 'Admin Dashboard & Analytics',
        description: 'Comprehensive admin interface with sales analytics, user management, and reporting',
        type: 'EPIC',
        status: 'PLANNING',
        priority: 6,
        estimatedHours: 120,
        assignees: ['bravo-maya-singh-009', 'bravo-emma-taylor-011'],
        children: [
          {
            name: 'Sales Analytics Dashboard',
            description: 'Real-time charts for revenue, orders, conversion rates with date range filters',
            type: 'FEATURE',
            status: 'PLANNING',
            priority: 7,
            estimatedHours: 50,
            assignees: ['bravo-maya-singh-009'],
          },
          {
            name: 'Customer Insights',
            description: 'Segmentation, lifetime value calculations, and behavior analytics',
            type: 'FEATURE',
            status: 'PLANNING',
            priority: 6,
            estimatedHours: 40,
            assignees: ['bravo-tom-anderson-004'],
          },
          {
            name: 'Inventory Reports',
            description: 'Stock movement reports, low inventory alerts, and reorder suggestions',
            type: 'FEATURE',
            status: 'PLANNING',
            priority: 6,
            estimatedHours: 30,
            assignees: ['bravo-nina-wong-007'],
          },
        ],
      },
    ],
  },
];

export async function POST() {
  try {
    const { userId } = await getSession();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const results: string[] = [];

    // Create Team Bravo
    let team = await prisma.team.findFirst({
      where: { name: { contains: 'Bravo', mode: 'insensitive' } },
    });

    if (!team) {
      team = await prisma.team.create({
        data: {
          name: 'Team Bravo',
          description: 'E-commerce platform development team - 12 members',
        },
      });
      results.push(`✓ Created Team Bravo`);
    } else {
      results.push(`✓ Team Bravo already exists`);
    }

    // Create users and memberships
    const userMap = new Map<string, string>(); // email -> userId mapping

    for (const userData of bravoUsers) {
      let user = await prisma.user.findUnique({
        where: { email: userData.email },
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            id: userData.id,
            email: userData.email,
            name: userData.name,
          },
        });
        results.push(`  ✓ Created ${userData.name} (${userData.title})`);
      }

      userMap.set(userData.id, user.id);

      const existingMembership = await prisma.membership.findUnique({
        where: { userId_teamId: { userId: user.id, teamId: team.id } },
      });

      if (!existingMembership) {
        await prisma.membership.create({
          data: {
            userId: user.id,
            teamId: team.id,
            role: userData.role,
          },
        });
      }
    }

    // Create sprints (optional - workflow freedom!)
    let sprint1 = await prisma.sprint.findFirst({
      where: {
        teamId: team.id,
        name: 'Sprint 1: Authentication & Product Foundation',
      },
    });

    if (!sprint1) {
      sprint1 = await prisma.sprint.create({
        data: {
          name: 'Sprint 1: Authentication & Product Foundation',
          goal: 'Complete user authentication and begin product catalog work',
          teamId: team.id,
          startDate: new Date('2026-02-03'),
          endDate: new Date('2026-02-14'),
          status: 'ACTIVE',
          capacity: 320, // 12 members * ~27 hours per week
        },
      });
      results.push(`✓ Created Sprint 1 (ACTIVE)`);
    } else {
      results.push(`✓ Sprint 1 already exists`);
    }

    let sprint2 = await prisma.sprint.findFirst({
      where: {
        teamId: team.id,
        name: 'Sprint 2: Checkout Integration',
      },
    });

    if (!sprint2) {
      sprint2 = await prisma.sprint.create({
        data: {
          name: 'Sprint 2: Checkout Integration',
          goal: 'Integrate Stripe payment processing and begin order management',
          teamId: team.id,
          startDate: new Date('2026-02-17'),
          endDate: new Date('2026-02-28'),
          status: 'PLANNING',
        },
      });
      results.push(`✓ Created Sprint 2 (PLANNING)`);
    } else {
      results.push(`✓ Sprint 2 already exists`);
    }

    // Recursive function to create components
    async function createComponents(
      components: ComponentData[],
      projectId: string,
      parentId: string | null = null,
      depth: number = 0,
    ): Promise<void> {
      for (const comp of components) {
        const component = await prisma.component.create({
          data: {
            name: comp.name,
            description: comp.description,
            type: comp.type,
            status: comp.status,
            priority: comp.priority,
            estimatedHours: comp.estimatedHours,
            projectId,
            parentId,
            sprintId: comp.status === 'IN_PROGRESS' && sprint1 ? sprint1.id : null, // Only active work in sprint
            contextDecision: comp.contextDecision,
            contextRationale: comp.contextRationale,
            contextAlternatives: comp.contextAlternatives,
            contextLinks: comp.contextLinks || [],
            Assignment: {
              create: comp.assignees.map((userId) => ({
                userId: userMap.get(userId) || userId,
              })),
            },
          },
        });

        results.push(`${'  '.repeat(depth + 1)}✓ ${comp.type}: ${comp.name}`);

        if (comp.children && comp.children.length > 0) {
          await createComponents(comp.children, projectId, component.id, depth + 1);
        }
      }
    }

    // Create all 3 projects with their components
    const createdProjectIds: string[] = [];
    let totalComponents = 0;

    for (const projectData of projects) {
      let project = await prisma.project.findFirst({
        where: {
          teamId: team.id,
          name: projectData.name,
        },
      });

      if (!project) {
        project = await prisma.project.create({
          data: {
            name: projectData.name,
            description: projectData.description,
            teamId: team.id,
            ownerId: userId,
          },
        });
        results.push(`\n✓ Created project: ${project.name}`);
      } else {
        results.push(`\n✓ Project already exists: ${project.name}`);
      }

      createdProjectIds.push(project.id);

      // Create components for this project
      await createComponents(projectData.components, project.id);
      totalComponents += projectData.components.length;
    }

    results.push(`\n✅ Demo seed completed successfully!`);
    results.push(`\n📊 Summary:`);
    results.push(`   • Team: ${team.name} (${bravoUsers.length} members)`);
    results.push(`   • Projects: ${projects.length} (Customer Portal, Checkout & Orders, Admin Dashboard)`);
    results.push(`   • Epics: ${totalComponents} across all projects with full hierarchy`);
    results.push(`   • Sprints: 2 (1 active, 1 planning)`);
    results.push(`   • Context: 5 decisions documented with AI-ready content`);
    results.push(`   • Multi-project workflow demonstrates real-world structure`);

    return NextResponse.json({
      success: true,
      results,
      teamId: team.id,
      projectIds: createdProjectIds,
    });
  } catch (error) {
    console.error('Bravo seed error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Seed failed', stack: error instanceof Error ? error.stack : undefined },
      { status: 500 },
    );
  }
}
