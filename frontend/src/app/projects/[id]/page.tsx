'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Shield, Github, Star } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { cx } from '@/lib/data';
import { Avatar } from '@/components/ui/avatar';
import { PrimaryButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { DifficultyBadge, StatusPill, Tag } from '@/components/ui/badge';

export default function PublicProjectPage() {
  const params = useParams();
  const projectId = params.id as string;
  const { allProjects, memberships, navigate, switchTo, activeContext, ensureProject } = useApp();

  const project = allProjects.find((p: any) => p.id === projectId);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!project && projectId && !fetching) {
      setFetching(true);
      ensureProject(projectId).finally(() => setFetching(false));
    }
  }, [project, projectId]);

  const [tab, setTab] = useState('overview');

  if (!project) {
    if (fetching) return <div className="p-8 text-center text-sm text-zinc-500">Loading...</div>;
    return null;
  }

  const members = memberships[project.id] || [];
  const myMembership = members.find((m: any) => m.isMe);
  const isCurrentlyActive = activeContext.type === 'project' && activeContext.id === project.id;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1000px] mx-auto seidar-animate-in">
      <button onClick={() => navigate('projects')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-5 transition-colors"><ArrowLeft size={15} /> Back to projects</button>

      {myMembership && !isCurrentlyActive && (
        <Card className="p-4 mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-violet-50 !border-violet-200">
          <div className="flex items-center gap-2 text-sm text-violet-800"><Shield size={15} className="shrink-0" />You manage this page as {myMembership.role === 'owner' ? 'an owner' : 'an admin'}.</div>
          <PrimaryButton onClick={() => switchTo('project', project.id)} className="shrink-0">Switch to manage</PrimaryButton>
        </Card>
      )}

      <Card className="p-4 sm:p-7 mb-5">
        <div className="flex items-center gap-4">
          <Avatar name={project.name} color={project.color} size={16} />
          <div className="min-w-0">
            <div className="text-xl font-semibold text-gray-900 tracking-tight">{project.name}</div>
            <div className="text-sm text-gray-500 mt-0.5">{project.tagline}</div>
            <div className="flex items-center gap-3 mt-2 text-xs text-gray-400 flex-wrap"><span className="flex items-center gap-1"><Github size={12} />{project.repo}</span><span className="flex items-center gap-1"><Star size={12} />{project.stars}</span><Tag>{project.category}</Tag></div>
          </div>
        </div>
        {members.length > 0 && (
          <div className="flex items-center gap-2 mt-5 pt-5 border-t border-gray-100">
            <span className="text-xs text-gray-400 mr-1">Built by</span>
            <div className="flex -space-x-2">{members.map((m: any, i: number) => <div key={i} title={m.name}><Avatar name={m.name} color={m.color} size={7} /></div>)}</div>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
        <Card className="p-5"><div className="text-xs font-medium text-gray-500 mb-2">Contributors</div><div className="text-xl font-semibold text-gray-900 seidar-mono">{project.contributors}</div></Card>
        <Card className="p-5"><div className="text-xs font-medium text-gray-500 mb-2">Total paid out</div><div className="text-xl font-semibold text-gray-900 seidar-mono">${project.totalPaid.toLocaleString()}</div></Card>
      </div>

      <div className="flex items-center gap-1 mb-5 border-b border-gray-200">
        {['overview', 'contributors'].map(t => <button key={t} onClick={() => setTab(t)} className={cx('px-4 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors', tab === t ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-500 hover:text-gray-800')}>{t}</button>)}
      </div>

      {tab === 'overview' && <Card className="p-6"><div className="text-sm font-semibold text-gray-900 mb-2">About</div><p className="text-sm text-gray-600 leading-relaxed">{project.description}</p></Card>}

      {tab === 'contributors' && (
        <Card className="p-6 text-center text-gray-500">
          <p className="text-sm">Contributor information coming soon.</p>
        </Card>
      )}
    </div>
  );
}
