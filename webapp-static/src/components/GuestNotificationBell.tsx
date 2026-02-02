import { useState, useEffect, useRef } from 'react';
import {
  guestListNotifications,
  guestCountUnreadNotifications,
  guestMarkNotificationRead,
  guestMarkAllNotificationsRead,
  type GuestNotification,
} from '../api/appsync';
import { Bell, Loader2 } from 'lucide-react';

interface GuestNotificationBellProps {
  guestId: string;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHr < 24) return `${diffHr}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString();
}

export function GuestNotificationBell({ guestId }: GuestNotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<GuestNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadUnreadCount();
  }, [guestId]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadUnreadCount = async () => {
    try {
      const count = await guestCountUnreadNotifications(guestId);
      setUnreadCount(count);
      setLoadError(null);
    } catch {
      // Silently fail - notifications may not exist yet
    }
  };

  const loadNotifications = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await guestListNotifications(guestId, 20);
      setNotifications(data);
    } catch {
      setLoadError('Couldn\'t load notifications');
    } finally {
      setLoading(false);
    }
  };

  const handleBellClick = () => {
    if (!isOpen) {
      loadNotifications();
    }
    setIsOpen(!isOpen);
  };

  const handleMarkRead = async (notification: GuestNotification) => {
    if (notification.read) return;
    try {
      await guestMarkNotificationRead(guestId, notification.id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // Silently fail
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await guestMarkAllNotificationsRead(guestId);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // Silently fail
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleBellClick}
        className="relative p-2 text-slate-300 hover:text-white transition-colors"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-slate-800 border border-slate-700 rounded-lg shadow-lg z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
            <h3 className="font-medium text-white">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-cyan-400 hover:text-cyan-300"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loadError && (
              <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between gap-2 bg-red-900/20">
                <p className="text-sm text-red-400">{loadError}</p>
                <button
                  type="button"
                  onClick={() => loadNotifications()}
                  className="text-xs text-cyan-400 hover:text-cyan-300 whitespace-nowrap"
                >
                  Retry
                </button>
              </div>
            )}
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
              </div>
            ) : notifications.length === 0 && !loadError ? (
              <p className="p-4 text-sm text-slate-500 text-center">
                No notifications yet
              </p>
            ) : notifications.length === 0 ? null : (
              notifications.map((notification) => (
                <div
                  key={notification.id}
                  onClick={() => handleMarkRead(notification)}
                  className={`px-4 py-3 border-b border-slate-700/50 cursor-pointer hover:bg-slate-700/50 transition-colors ${
                    !notification.read ? 'bg-slate-700/30' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {!notification.read && (
                      <span className="flex-shrink-0 w-2 h-2 mt-1.5 bg-cyan-400 rounded-full" />
                    )}
                    <div className={`flex-1 min-w-0 ${notification.read ? 'ml-5' : ''}`}>
                      <p className="text-sm font-medium text-slate-200 truncate">
                        {notification.title}
                      </p>
                      <p className="text-xs text-slate-400 line-clamp-2">
                        {notification.message}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        {formatRelativeTime(notification.createdAt)}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
