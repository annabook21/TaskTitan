/**
 * Template Application Prompts
 *
 * System and user prompts for applying component templates.
 * Also exports template metadata for UI display.
 */

import { ComponentTemplate, type ComponentTemplateMetadata, type ApplyTemplateInput } from '../types';

/**
 * Template metadata for UI display
 */
export const COMPONENT_TEMPLATES: ComponentTemplateMetadata[] = [
  {
    id: ComponentTemplate.CRUD_FEATURE,
    name: 'CRUD Feature',
    description: 'Complete create, read, update, delete functionality for an entity',
    category: 'Full Stack',
    estimatedHours: 40,
    commonUseCase: 'User management, product catalog, blog posts',
  },
  {
    id: ComponentTemplate.REST_API,
    name: 'REST API Endpoints',
    description: 'Set of RESTful API endpoints with authentication and validation',
    category: 'Backend',
    estimatedHours: 24,
    commonUseCase: 'Mobile app backend, third-party integrations',
  },
  {
    id: ComponentTemplate.USER_AUTH,
    name: 'User Authentication',
    description: 'Complete auth flow: signup, login, password reset, session management',
    category: 'Full Stack',
    estimatedHours: 48,
    commonUseCase: 'Any application requiring user accounts',
  },
  {
    id: ComponentTemplate.FORM_WITH_VALIDATION,
    name: 'Form with Validation',
    description: 'Multi-step form with client and server validation',
    category: 'Frontend',
    estimatedHours: 16,
    commonUseCase: 'Registration forms, checkout flows, surveys',
  },
  {
    id: ComponentTemplate.DATA_DASHBOARD,
    name: 'Analytics Dashboard',
    description: 'Dashboard with charts, filters, and data visualization',
    category: 'Frontend',
    estimatedHours: 32,
    commonUseCase: 'Admin dashboards, reporting tools, metrics display',
  },
  {
    id: ComponentTemplate.FILE_UPLOAD,
    name: 'File Upload System',
    description: 'File upload with progress, validation, and cloud storage',
    category: 'Full Stack',
    estimatedHours: 24,
    commonUseCase: 'Document management, image galleries, attachments',
  },
  {
    id: ComponentTemplate.SEARCH_FILTER,
    name: 'Search & Filter',
    description: 'Advanced search with filters, sorting, and pagination',
    category: 'Full Stack',
    estimatedHours: 20,
    commonUseCase: 'Product catalogs, content libraries, user directories',
  },
  {
    id: ComponentTemplate.NOTIFICATION_SYSTEM,
    name: 'Notification System',
    description: 'Real-time notifications (email, in-app, push)',
    category: 'Full Stack',
    estimatedHours: 32,
    commonUseCase: 'Alerts, messaging, activity feeds',
  },
  {
    id: ComponentTemplate.PAYMENT_INTEGRATION,
    name: 'Payment Integration',
    description: 'Payment processing with Stripe/PayPal (checkout, webhooks, receipts)',
    category: 'Integration',
    estimatedHours: 40,
    commonUseCase: 'E-commerce, subscriptions, donations',
  },
  {
    id: ComponentTemplate.ADMIN_PANEL,
    name: 'Admin Panel',
    description: 'Admin interface for managing users, content, and settings',
    category: 'Full Stack',
    estimatedHours: 48,
    commonUseCase: 'Content management, user moderation, system configuration',
  },
];

/**
 * System prompt for template application
 */
export const TEMPLATE_APPLICATION_SYSTEM_PROMPT = `You are an expert software architect creating component breakdowns from templates.
Your job is to take a standard template pattern and adapt it to the user's specific needs.

Create a complete, production-ready breakdown with:
1. Proper hierarchy (Epic → Features → Stories → Tasks)
2. Realistic estimates
3. Correct dependencies
4. Implementation guidance

Be specific and practical. Include:
- Database schema considerations
- API endpoint specifications
- UI component structure
- Testing requirements
- Security considerations

Respond with ONLY valid JSON, no other text.`;

/**
 * Generates user prompt for template application
 */
export function buildTemplateApplicationPrompt(
  input: ApplyTemplateInput,
  templateInfo: ComponentTemplateMetadata,
): string {
  const techStackInfo = input.projectContext?.techStack
    ? `Tech Stack: ${input.projectContext.techStack}`
    : 'Tech Stack: Not specified (use modern best practices)';

  const existingInfo = input.projectContext?.existingComponents?.length
    ? `
Existing Components (consider integration):
${input.projectContext.existingComponents.map((c) => `- ${c.name} (${c.type})`).join('\n')}`
    : '';

  return `Template: ${templateInfo.name}
Template Description: ${templateInfo.description}
Entity/Focus: ${input.customization.entityName}
Project: ${input.customization.projectName}
${input.customization.additionalRequirements ? `Additional Requirements: ${input.customization.additionalRequirements}` : ''}
${techStackInfo}${existingInfo}

Generate a complete component breakdown for this ${templateInfo.name} focused on "${input.customization.entityName}".

Return your response between <<<JSON and JSON>>> markers. Between these markers, provide ONLY valid JSON with:
- "components": Array of components with { name, description, type, estimatedHours, priority, suggestedDependencies }
  * Include proper hierarchy: 1 EPIC → 2-4 FEATURES → 3-6 STORIES/TASKS per feature
  * Each component should have detailed description with acceptance criteria
  * Use the entity name in component names (e.g., "Product List API", "${input.customization.entityName} Form Validation")
- "implementationNotes": Detailed implementation guidance (3-5 paragraphs covering database, API, UI, security, testing)
- "techStackRecommendations": Specific libraries/tools to use (optional, 2-3 sentences)

Example format:
<<<JSON
{
  "components": [...],
  "implementationNotes": "...",
  "techStackRecommendations": "..."
}
JSON>>>`;
}
