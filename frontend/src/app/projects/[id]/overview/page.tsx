'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import {
  Plus, Github, GitBranch
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip
} from 'recharts';
import { useApp } from '@/lib/app-context';
import { api } from '@/lib/api';
import { BRAND, ACTIVITY_FEED } from '@/lib/data';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { PrimaryButton } from '@/components/ui/button';

export default function ProjectOverviewPage() {
  const params = useParams();
  const projectId = params.id as string;
  const { activeContext, allProjects, memberships, navigate, ensureProject } = useApp();

  const project = allProjects.find((p: any) => p.id === projectId) || allProjects.find((p: any) => p.id === activeContext.id);
  const [fetchedOrg, setFetchedOrg] = useState<any | null>(null);
  const [fetchingOrg, setFetchingOrg] = useState(false);

  useEffect(() => {
    if (!project && projectId && !fetchingOrg && !fetchedOrg) {
      setFetchingOrg(true);
      ensureProject(projectId).then((data: any) => {
        setFetchedOrg(data);
      }).finally(() => setFetchingOrg(false));
    }
  }, [project, projectId]);

  const displayProject = project || fetchedOrg;
  if (!displayProject) {
    if (fetchingOrg) {
      return (
        <div className="p-4 sm:p-6 lg:p-8 max-w-[1150px] mx-auto seidar-animate-in">
          <div className="flex items-center justify-center py-20 text-zinc-500">Loading...</div>
        </div>
      );
    }
    return null;
  }

  const activeProject = displayProject;
  const contributors = activeProject.contributors ?? 0;
  const walletBalance = activeProject.walletBalance ?? 0;
  const totalPaid = activeProject.totalPaid ?? 0;
  const activity = activeProject.activity ?? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  const [hasRepos, setHasRepos] = useState<boolean | null>(null);

  useEffect(() => {
    async function checkRepos() {
      try {
        const data = await api.get<{ repos: any[] }>(`/api/v1/orgs/${projectId}/repos`);
        setHasRepos((data.repos || []).length > 0);
      } catch {
        setHasRepos(false);
      }
    }
    if (projectId) checkRepos();
  }, [projectId]);

  const chartData = activity.map((v: number, i: number) => ({ week: `W${i + 1}`, commits: v }));

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1150px] mx-auto seidar-animate-in">
      <SectionHeader title={activeProject.name} subtitle={"Project overview"} />

      {hasRepos === false && (
        <Card className="p-5 mb-6 flex items-center justify-between gap-4 bg-gradient-to-r from-violet-600/10 to-transparent border-violet-500/20">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-violet-600/20 flex items-center justify-center shrink-0">
              <Github size={20} className="text-violet-400" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-100">Connect your GitHub repositories</div>
              <div className="text-xs text-zinc-500 mt-0.5">Install the Releeve GitHub App to start placing bounties on issues</div>
            </div>
          </div>
          <PrimaryButton icon={GitBranch} onClick={() => navigate('project-repos')} className="shrink-0">
            Set up
          </PrimaryButton>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <Card className="p-5"><div className="text-xs font-medium text-gray-500 mb-2">Treasury balance</div><div className="text-2xl font-semibold text-gray-900 seidar-mono">${walletBalance.toLocaleString()}</div></Card>
        <Card className="p-5"><div className="text-xs font-medium text-gray-500 mb-2">Contributors</div><div className="text-2xl font-semibold text-gray-900 seidar-mono">{contributors}</div></Card>
        <Card className="p-5"><div className="text-xs font-medium text-gray-500 mb-2">Total paid out</div><div className="text-2xl font-semibold text-gray-900 seidar-mono">${totalPaid.toLocaleString()}</div></Card>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="sm:col-span-2 p-6">
          <div className="text-sm font-semibold text-gray-900 mb-1">Development activity</div>
          <div className="text-xs text-gray-400 mb-4">Weekly commit volume</div>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                <defs><linearGradient id="ov-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={BRAND.blue} stopOpacity={0.25} /><stop offset="100%" stopColor={BRAND.blue} stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F0EEF6" />
                <XAxis dataKey="week" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #E5E7EB', fontSize: 12 }} />
                <Area type="monotone" dataKey="commits" stroke={BRAND.blue} strokeWidth={2} fill="url(#ov-fill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-6">
          <div className="text-sm font-semibold text-gray-900 mb-4">Activity feed</div>
          <div className="flex flex-col gap-4">
            {ACTIVITY_FEED.slice(0, 5).map(a => (
              <div key={a.id} className="flex gap-3"><div className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-1.5 shrink-0" /><div><div className="text-xs text-gray-700 leading-snug">{a.text}</div><div className="text-[11px] text-gray-400 mt-0.5">{a.time}</div></div></div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
        <Card className="sm:col-span-2 p-6">
          <div className="text-sm font-semibold text-gray-900 mb-4">Team</div>
          <div className="flex flex-col gap-3">
            {(memberships[activeProject.id] || []).map((m: any, i: number) => (
              <div key={i} className="flex items-center gap-2.5"><Avatar name={m.name} color={m.color} size={8} /><div className="min-w-0"><div className="text-sm text-gray-800 truncate">{m.name}</div><div className="text-[11px] text-gray-400 capitalize">{m.role}</div></div></div>
            ))}
          </div>
          <button onClick={() => navigate('project-team')} className="text-xs font-medium text-violet-600 hover:text-violet-700 mt-3">Manage team →</button>
        </Card>
      </div>
    </div>
  );
}