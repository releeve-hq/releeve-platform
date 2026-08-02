'use client';

import React, { useState } from 'react';
import { User, Github, Bell, Palette, FolderKanban, AlertCircle, Wallet } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { cx, CURRENT_USER } from '@/lib/data';
import { Avatar } from '@/components/ui/avatar';
import { PrimaryButton, SecondaryButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';

/* ============================================================================
   PERSONAL SETTINGS CONTENT
============================================================================ */
function PersonalSettingsContent() {
  const [tab, setTab] = useState('account');
  const [notifs, setNotifs] = useState<Record<string, boolean>>({
    'Bounty matches': true, 'Contribution updates': true, 'New messages': true, 'Job invitations': false,
  });
  const tabs = [
    { key: 'account', label: 'Account', icon: User }, { key: 'github', label: 'GitHub', icon: Github },
    { key: 'notifications', label: 'Notifications', icon: Bell },
    { key: 'appearance', label: 'Appearance', icon: Palette },
  ];
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1000px] mx-auto seidar-animate-in">
      <SectionHeader title="Settings" subtitle="Manage your account, integrations, and preferences." />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <Card className="p-2 h-fit">
          {tabs.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.key} onClick={() => setTab(t.key)} className={cx('w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left', tab === t.key ? 'bg-violet-600/20 text-violet-400' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300')}>
                <Icon size={15} className={tab === t.key ? 'text-violet-400' : 'text-zinc-500'} />{t.label}
              </button>
            );
          })}
        </Card>
        <Card className="md:col-span-3 p-6">
          {tab === 'account' && (
            <div>
              <div className="flex items-center gap-4 mb-6"><Avatar name={CURRENT_USER.name} color={CURRENT_USER.color} size={16} /><div><div className="text-sm font-semibold text-zinc-100">{CURRENT_USER.name}</div><div className="text-xs text-zinc-500">@{CURRENT_USER.username}</div></div></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="text-xs font-medium text-zinc-500 mb-1.5 block">Display name</label><input defaultValue={CURRENT_USER.name} className="w-full px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 placeholder:text-zinc-600" /></div>
                <div><label className="text-xs font-medium text-zinc-500 mb-1.5 block">Username</label><input defaultValue={CURRENT_USER.username} className="w-full px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 placeholder:text-zinc-600" /></div>
              </div>
              <div className="mt-5"><PrimaryButton>Save changes</PrimaryButton></div>
            </div>
          )}
          {tab === 'github' && (
            <div>
              <div className="flex items-center justify-between p-4 rounded-xl border border-white/10 mb-4">
                <div className="flex items-center gap-3"><Github size={20} className="text-zinc-400" /><div><div className="text-sm font-medium text-zinc-100">Connected as @justiceu</div><div className="text-xs text-zinc-500">Last synced 2 hours ago</div></div></div>
                <span className="text-[11px] font-medium px-2 py-1 rounded-md bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Connected</span>
              </div>
              <SecondaryButton>Reconnect account</SecondaryButton>
            </div>
          )}
          {tab === 'notifications' && (
            <div className="flex flex-col gap-4">
              {['Bounty matches', 'Contribution updates', 'New messages', 'Job invitations'].map(n => (
                <div key={n} className="flex items-center justify-between"><span className="text-sm text-zinc-300">{n}</span><div onClick={() => setNotifs(prev => ({ ...prev, [n]: !prev[n] }))} className={`w-10 h-6 rounded-full relative cursor-pointer transition-colors duration-200 ${notifs[n] ? 'bg-violet-600' : 'bg-zinc-700'}`}><div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all duration-200 ${notifs[n] ? 'right-1' : 'left-1'}`} /></div></div>
              ))}
            </div>
          )}
          {tab === 'appearance' && (
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-2 block">Theme</label>
              <div className="flex gap-3">{['Light', 'Dark', 'System'].map((t, i) => <button key={t} className={cx('px-4 py-2 rounded-xl text-sm border', i === 1 ? 'border-violet-500/50 bg-violet-600/20 text-violet-400' : 'border-white/10 text-zinc-400 hover:bg-white/5')}>{t}</button>)}</div>
            </div>
          )}

        </Card>
      </div>
    </div>
  );
}

/* ============================================================================
   PROJECT SETTINGS CONTENT
============================================================================ */
function ProjectSettingsContent({ project }: { project: any }) {
  const [tab, setTab] = useState('general');
  const [notifs, setNotifs] = useState<Record<string, boolean>>({
    'New submissions': true, 'New applicants': true, 'Low treasury balance': false, 'Bounty deadlines': true,
  });
  const tabs = [
    { key: 'general', label: 'General', icon: FolderKanban }, { key: 'repo', label: 'Repository', icon: Github },
    { key: 'payouts', label: 'Payouts', icon: Wallet }, { key: 'notifications', label: 'Notifications', icon: Bell },
    { key: 'danger', label: 'Danger zone', icon: AlertCircle },
  ];
  if (!project) return null;
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1000px] mx-auto seidar-animate-in">
      <SectionHeader title="Project settings" subtitle={`Manage ${project.name}’s profile and integrations`} />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <Card className="p-2 h-fit">
          {tabs.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.key} onClick={() => setTab(t.key)} className={cx('w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left', tab === t.key ? 'bg-violet-600/20 text-violet-400' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300')}>
                <Icon size={15} className={tab === t.key ? 'text-violet-400' : 'text-zinc-500'} />{t.label}
              </button>
            );
          })}
        </Card>
        <Card className="md:col-span-3 p-6">
          {tab === 'general' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className="text-xs font-medium text-zinc-500 mb-1.5 block">Project name</label><input defaultValue={project.name} className="w-full px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 placeholder:text-zinc-600" /></div>
              <div><label className="text-xs font-medium text-zinc-500 mb-1.5 block">Category</label><input defaultValue={project.category} className="w-full px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 placeholder:text-zinc-600" /></div>
              <div className="sm:col-span-2"><label className="text-xs font-medium text-zinc-500 mb-1.5 block">Tagline</label><input defaultValue={project.tagline} className="w-full px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 placeholder:text-zinc-600" /></div>
              <div className="sm:col-span-2"><PrimaryButton>Save changes</PrimaryButton></div>
            </div>
          )}
          {tab === 'repo' && (
            <div className="flex items-center justify-between p-4 rounded-xl border border-white/10">
              <div className="flex items-center gap-3"><Github size={20} className="text-zinc-400" /><div><div className="text-sm font-medium text-zinc-100">{project.repo}</div><div className="text-xs text-zinc-500">Connected · webhook active</div></div></div>
              <SecondaryButton>Reconnect</SecondaryButton>
            </div>
          )}
          {tab === 'payouts' && (
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Treasury payout address</label>
              <input defaultValue="GTREA…SURY4" className="w-full px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 seidar-mono mb-4 placeholder:text-zinc-600" />
              <PrimaryButton>Save changes</PrimaryButton>
            </div>
          )}
          {tab === 'notifications' && (
            <div className="flex flex-col gap-4">
              {['New submissions', 'New applicants', 'Low treasury balance', 'Bounty deadlines'].map(n => (
                <div key={n} className="flex items-center justify-between"><span className="text-sm text-zinc-300">{n}</span><div onClick={() => setNotifs(prev => ({ ...prev, [n]: !prev[n] }))} className={`w-10 h-6 rounded-full relative cursor-pointer transition-colors duration-200 ${notifs[n] ? 'bg-violet-600' : 'bg-zinc-700'}`}><div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all duration-200 ${notifs[n] ? 'right-1' : 'left-1'}`} /></div></div>
              ))}
            </div>
          )}
          {tab === 'danger' && (
            <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10">
              <div className="text-sm font-medium text-rose-300 mb-1">Archive this project page</div>
              <p className="text-xs text-rose-400 mb-3">This hides {project.name} from the marketplace. Existing bounties and payouts are unaffected.</p>
              <SecondaryButton className="!text-rose-400 !border-rose-500/30">Archive page</SecondaryButton>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ============================================================================
   SETTINGS PAGE ROOT
============================================================================ */
export default function SettingsPage() {
  const { activeContext, allProjects } = useApp();
  if (activeContext.type === 'project') {
    return <ProjectSettingsContent project={allProjects.find((p: any) => p.id === activeContext.id)} />;
  }
  return <PersonalSettingsContent />;
}
