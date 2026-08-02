'use client';

import React, { useState, useEffect } from 'react';
import {
  Wallet as WalletIcon, CheckCircle2, Target, GitPullRequest, Users,
  Briefcase, Clock, MessageSquare, XCircle, AlertCircle
} from 'lucide-react';
import { api } from '@/lib/api';
import { cx } from '@/lib/data';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { SecondaryButton } from '@/components/ui/button';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
}

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifs = () => {
    api.get<any[]>('/api/v1/users/notifications')
      .then(data => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchNotifs(); }, []);

  const iconMap: Record<string, { icon: any, tone: string }> = {
    reward: { icon: WalletIcon, tone: 'text-emerald-600 bg-emerald-50' },
    accepted: { icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50' },
    merged: { icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50' },
    bounty: { icon: Target, tone: 'text-violet-600 bg-violet-50' },
    submission: { icon: GitPullRequest, tone: 'text-violet-600 bg-violet-50' },
    applicant: { icon: Users, tone: 'text-blue-600 bg-blue-50' },
    interview: { icon: Briefcase, tone: 'text-blue-600 bg-blue-50' },
    job: { icon: Briefcase, tone: 'text-violet-600 bg-violet-50' },
    deadline: { icon: Clock, tone: 'text-amber-600 bg-amber-50' },
    message: { icon: MessageSquare, tone: 'text-blue-600 bg-blue-50' },
    treasury: { icon: WalletIcon, tone: 'text-emerald-600 bg-emerald-50' },
    rejected: { icon: XCircle, tone: 'text-rose-600 bg-rose-50' },
    system: { icon: AlertCircle, tone: 'text-gray-500 bg-gray-100' },
  };

  function markAllRead() {
    api.post('/api/v1/users/notifications/read-all', {}).then(() => {
      setItems(prev => prev.map(i => ({ ...i, read: true })));
    }).catch(() => {});
  }

  function markRead(id: string) {
    api.post(`/api/v1/users/notifications/${id}/read`, {}).then(() => {
      setItems(prev => prev.map(i => i.id === id ? { ...i, read: true } : i));
    }).catch(() => {});
  }

  const unreadCount = items.filter(i => !i.read).length;

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-[800px] mx-auto seidar-animate-in">
        <SectionHeader title="Notifications" subtitle="Loading..." />
        <div className="text-center text-zinc-500 py-12">Loading notifications...</div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[800px] mx-auto seidar-animate-in">
      <SectionHeader title="Notifications" subtitle={`${unreadCount} unread`} action={unreadCount > 0 ? <SecondaryButton onClick={markAllRead}>Mark all as read</SecondaryButton> : undefined} />
      <div className="flex flex-col gap-2">
        {items.map(n => {
          const cfg = iconMap[n.type] || iconMap.system;
          const Icon = cfg.icon;
          return (
            <Card key={n.id} className={cx('p-4 flex items-start gap-3 cursor-pointer transition-colors', !n.read && 'bg-violet-500/10')} onClick={() => { if (!n.read) markRead(n.id); }}>
              <div className={cx('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', cfg.tone)}><Icon size={16} /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-100">{n.title}</span>
                  <span className="text-[11px] text-zinc-500 shrink-0 ml-2">{n.time}</span>
                </div>
                <div className="text-xs text-zinc-400 mt-0.5">{n.message}</div>
              </div>
              {!n.read && <div className="w-2 h-2 rounded-full bg-violet-600 mt-1.5 shrink-0" />}
            </Card>
          );
        })}
        {items.length === 0 && <div className="text-center text-zinc-500 py-12">No notifications</div>}
      </div>
    </div>
  );
}
