'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { PrimaryButton, SecondaryButton } from '@/components/ui/button';

export default function ProjectTeamPage() {
  const params = useParams();
  const projectId = params.id as string;
  const { activeContext, allProjects, memberships, updateMemberships, ensureProject } = useApp();

  const project = allProjects.find((p: any) => p.id === projectId) || allProjects.find((p: any) => p.id === activeContext.id);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!project && projectId && !fetching) {
      setFetching(true);
      ensureProject(projectId).finally(() => setFetching(false));
    }
  }, [project, projectId]);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');

  if (!project) {
    if (fetching) return <div className="p-8 text-center text-sm text-zinc-500">Loading...</div>;
    return null;
  }

  const members = memberships[project.id] || [];
  const ownerCount = members.filter((m: any) => m.role === 'owner').length;

  function addMember() {
    if (!inviteName.trim()) return;
    const palette = ['bg-blue-600', 'bg-emerald-600', 'bg-amber-500', 'bg-rose-500', 'bg-teal-600'];
    updateMemberships(project.id, [...members, { name: inviteName.trim(), username: inviteName.trim().toLowerCase().replace(/\s+/g, ''), role: 'admin', color: palette[members.length % palette.length], isMe: false }]);
    setInviteName('');
    setInviteOpen(false);
  }
  function removeMember(idx: number) {
    const m = members[idx];
    if (m.role === 'owner' && ownerCount <= 1) return;
    updateMemberships(project.id, members.filter((_: any, i: number) => i !== idx));
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[800px] mx-auto seidar-animate-in">
      <SectionHeader title="Team" subtitle={`People who can manage ${project.name}`} action={<PrimaryButton icon={Plus} onClick={() => setInviteOpen(!inviteOpen)}>Invite</PrimaryButton>} />
      {inviteOpen && (
        <Card className="p-4 mb-4 flex items-center gap-2">
          <input value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="Name or username to invite as admin" className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-violet-300" />
          <PrimaryButton onClick={addMember}>Send invite</PrimaryButton>
        </Card>
      )}
      <div className="flex flex-col gap-3">
        {members.map((m: any, i: number) => (
          <Card key={i} className="p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar name={m.name} color={m.color} size={9} />
              <div className="min-w-0"><div className="text-sm font-medium text-gray-900 truncate">{m.name}{m.isMe && <span className="text-gray-400 font-normal"> (you)</span>}</div><div className="text-xs text-gray-400 truncate">@{m.username}</div></div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md border capitalize ${m.role === 'owner' ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>{m.role}</span>
              {!(m.role === 'owner' && ownerCount <= 1) && <button onClick={() => removeMember(i)} className="text-xs text-gray-400 hover:text-rose-600 transition-colors">Remove</button>}
            </div>
          </Card>
        ))}
      </div>
      <p className="text-xs text-gray-400 mt-4">Every page needs at least one owner — you can't remove the last one.</p>
    </div>
  );
}
