// Demo mode constants

export const DEMO_COOKIE_NAME = 'tasktitan_demo_mode';
export const DEMO_STORAGE_KEY = 'tasktitan_demo_data';
export const DEMO_STORAGE_VERSION = 1;

export const DEMO_USER = {
  id: 'demo-user-001',
  email: 'demo@tasktitan.live',
  name: 'Demo User',
} as const;

export const DEMO_TEAM = {
  id: 'demo-team-001',
  name: 'Demo Team',
  description: 'Explore TaskTitan features with this sample team',
} as const;

export const DEMO_PROJECT = {
  id: 'demo-project-001',
  name: 'E-Commerce Platform',
  description:
    'A modern e-commerce platform with product catalog, shopping cart, user authentication, and payment processing. Built with a microservices architecture for scalability.',
} as const;

export const DEMO_SPRINT = {
  id: 'demo-sprint-001',
  name: 'Sprint 1',
  goal: 'Complete user authentication foundation and begin product catalog',
} as const;
