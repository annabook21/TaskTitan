// Demo mode - main exports and initialization
// This module provides browser-based demo functionality without cloud storage

export * from './constants';
export * from './types';
export * from './demo-mode';
export { demoStore } from './demo-store';
export { generateDemoSeedData } from './demo-seed';

import { setDemoModeCookie, hasDemoData } from './demo-mode';
import { demoStore } from './demo-store';

/**
 * Initialize demo mode - sets cookie and ensures localStorage has seed data
 * Call this when user clicks "Try Demo" button
 * Returns the redirect URL (/)
 */
export function initializeDemoMode(): string {
  // Set the demo mode cookie
  setDemoModeCookie();

  // Initialize demo data in localStorage if not already present
  if (!hasDemoData()) {
    demoStore.resetStore();
  }

  // Return the redirect URL
  return '/';
}

/**
 * Check if we're in demo mode and the data is valid
 * Used by components to determine rendering strategy
 */
export function isDemoModeActive(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  // Check both cookie and localStorage
  const hasCookie = document.cookie.includes('tasktitan_demo_mode=');
  const hasData = hasDemoData();

  return hasCookie && hasData;
}
