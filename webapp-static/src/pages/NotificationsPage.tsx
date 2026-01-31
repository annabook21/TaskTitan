/**
 * Notifications page - displays all user notifications with mark-as-read functionality.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Check, CheckCheck, Loader2, ArrowLeft } from 'lucide-react';
import {
  listNotificationsForUser,
  markNotificationRead,
  markAllNotificationsRead,
  Notification,
} from '../api/appsync';

export function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    loadNotifications();
  }, []);

  async function loadNotifications() {
    try {
      setIsLoading(true);
      const data = await listNotificationsForUser(100);
      setNotifications(data);
    } catch (err) {
      console.error('Failed to load notifications:', err);
      setError('Failed to load notifications');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleMarkRead(notificationId: string) {
    try {
      await markNotificationRead(notificationId);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  }

  async function handleMarkAllRead() {
    try {
      setMarkingAll(true);
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (err) {
      console.error('Failed to mark all as read:', err);
    } finally {
      setMarkingAll(false);
    }
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link
            to="/home"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <Bell className="w-6 h-6 text-cyan-400" />
              Notifications
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up!'}
            </p>
          </div>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            disabled={markingAll}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50"
          >
            {markingAll ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCheck className="w-4 h-4" />
            )}
            Mark all as read
          </button>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {notifications.length === 0 && !error && (
        <div className="text-center py-16">
          <Bell className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">No notifications</h2>
          <p className="text-slate-400">
            You'll see updates about your tasks and projects here.
          </p>
        </div>
      )}

      {/* Notifications list */}
      {notifications.length > 0 && (
        <div className="space-y-2">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className={`p-4 rounded-xl border transition-colors ${
                notification.read
                  ? 'bg-slate-900/30 border-slate-800/50'
                  : 'bg-slate-800/50 border-slate-700/50'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {!notification.read && (
                      <span className="w-2 h-2 rounded-full bg-cyan-400" />
                    )}
                    <h3 className={`font-medium ${notification.read ? 'text-slate-300' : 'text-white'}`}>
                      {notification.title}
                    </h3>
                  </div>
                  <p className="text-slate-400 text-sm">{notification.message}</p>
                  <p className="text-slate-500 text-xs mt-2">
                    {new Date(notification.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                {!notification.read && (
                  <button
                    onClick={() => handleMarkRead(notification.id)}
                    className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                    title="Mark as read"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                )}
              </div>
              {notification.projectId && (
                <Link
                  to={`/project/${notification.projectId}`}
                  className="inline-block mt-3 text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  View project →
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
