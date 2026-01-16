// Demo mode detection and management utilities
// Client-side utilities for checking and managing demo mode state

import { DEMO_COOKIE_NAME, DEMO_STORAGE_KEY, DEMO_USER } from './constants';

/**
 * Check if the app is currently in demo mode (client-side)
 * Safe to call during SSR - returns false on server
 */
export function isDemoMode(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return document.cookie.includes(`${DEMO_COOKIE_NAME}=`);
}

/**
 * Get the demo user ID from the cookie (client-side)
 * Returns null if not in demo mode or on server
 */
export function getDemoUserId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === DEMO_COOKIE_NAME) {
      return value;
    }
  }
  return null;
}

/**
 * Set the demo mode cookie (client-side)
 * Cookie is set with path=/ and SameSite=Lax for security
 */
export function setDemoModeCookie(): void {
  if (typeof window === 'undefined') {
    return;
  }

  // Set cookie that expires in 7 days
  const expires = new Date();
  expires.setDate(expires.getDate() + 7);

  document.cookie = `${DEMO_COOKIE_NAME}=${DEMO_USER.id}; path=/; expires=${expires.toUTCString()}; SameSite=Lax`;
}

/**
 * Clear the demo mode cookie (client-side)
 */
export function clearDemoModeCookie(): void {
  if (typeof window === 'undefined') {
    return;
  }

  // Set cookie with past expiration to delete it
  document.cookie = `${DEMO_COOKIE_NAME}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
}

/**
 * Clear all demo data from localStorage (client-side)
 */
export function clearDemoStorage(): void {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.removeItem(DEMO_STORAGE_KEY);
}

/**
 * Clear demo mode completely - removes cookie and localStorage data
 * Use this when user wants to exit demo mode
 */
export function clearDemoMode(): void {
  clearDemoModeCookie();
  clearDemoStorage();
}

/**
 * Check if demo data exists in localStorage (client-side)
 */
export function hasDemoData(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return localStorage.getItem(DEMO_STORAGE_KEY) !== null;
}

/**
 * Get the demo user object
 */
export function getDemoUser() {
  return { ...DEMO_USER };
}
