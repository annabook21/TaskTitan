/**
 * Wireframe Generation Prompts
 *
 * User prompt for AI-powered wireframe generation.
 */

import type { GenerateWireframeInput } from '../types';

/**
 * Generates prompt for wireframe generation
 */
export function buildWireframePrompt(input: GenerateWireframeInput): string {
  return `Generate a lightweight HTML wireframe for this component:

Component: ${input.componentName}
Type: ${input.type}
Description: ${input.description}
${input.dependencies?.length ? `Dependencies: ${input.dependencies.join(', ')}` : ''}

Requirements:
- Single HTML file with inline CSS (Tailwind CDN is acceptable)
- Use semantic HTML5 elements
- Include placeholder content and labels
- Show all major UI sections and interactions
- Keep it simple - this is a wireframe, not production code
- Use neutral colors (grays, whites, blacks)
- Responsive layout (mobile-first)
- Add placeholder data where relevant
- Include basic interactivity hints (buttons, forms, etc.)

Return ONLY the complete HTML document, no explanation or markdown formatting.`;
}
