/**
 * User display name utilities - AWS Best Practice: never show internal IDs.
 * Fallback chain: name -> email username -> title -> formatted userId
 */
import type { Membership, User } from '../api/appsync';

/** Format raw userId as last resort (truncate Cognito IDs) */
function formatUserIdForDisplay(userId: string): string {
  // Cognito user IDs have format: <region>_<unique-id>
  const parts = userId.split('_');
  if (parts.length === 2 && parts[1]) {
    const uniquePart = parts[1];
    return uniquePart.length > 8 ? `${uniquePart.slice(0, 8)}...` : uniquePart;
  }
  // Not a Cognito ID, truncate if too long
  return userId.length > 12 ? `${userId.slice(0, 12)}...` : userId;
}

/** Get display name for a User object */
export function getUserDisplayName(user: User | null | undefined): string {
  if (!user) return 'Unknown User';
  if (user.name) return user.name;
  // Extract username from email (part before @)
  if (user.email) return user.email.split('@')[0] || user.email;
  return 'Unknown User';
}

/** Get display name for a Membership (team member) */
export function getMemberDisplayName(member: Membership): string {
  // Handle guest members
  if (member.isGuest || member.role === 'GUEST') {
    return member.guestName || member.displayName || 'Guest User';
  }
  // Try user object fields
  if (member.user?.name) return member.user.name;
  // Try email (extract username part)
  if (member.user?.email) return member.user.email.split('@')[0] || member.user.email;
  // Try membership title
  if (member.title) return member.title;
  // Last resort: format the userId to be less ugly
  return formatUserIdForDisplay(member.userId);
}

/** Resolve owner ID to display name using team members list */
export function resolveOwnerDisplayName(
  ownerId: string | null | undefined,
  teamMembers: Membership[] | undefined
): string | null {
  if (!ownerId) return null;
  if (!teamMembers?.length) return formatUserIdForDisplay(ownerId);
  const member = teamMembers.find((m) => m.userId === ownerId);
  return member ? getMemberDisplayName(member) : formatUserIdForDisplay(ownerId);
}

/** Get initials for avatar display */
export function getMemberInitials(member: Membership): string {
  const name = getMemberDisplayName(member);
  // Split by space and get first letter of each word
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  // Single word - return first 1-2 characters
  return name.slice(0, 2).toUpperCase();
}
