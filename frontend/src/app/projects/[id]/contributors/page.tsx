'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Users } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { EmptyState } from '@/components/ui/empty-state';

export default function ProjectContributorsPage() {
  const params = useParams();
  const projectId = params.id as string;
  const { activeContext, allProjects, ensureProject } = useApp();

  const project = allProjects.find((p: any) => p.id === projectId) || allProjects.find((p: any) => p.id === activeContext.id);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!project && projectId && !fetching) {
      setFetching(true);
      ensureProject(projectId).finally(() => setFetching(false));
    }
  }, [project, projectId]);

  if (!project) {
    if (fetching) return <div className="p-8 text-center text-sm text-zinc-500">Loading...</div>;
    return null;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1000px] mx-auto seidar-animate-in">
      <SectionHeader title="Contributors" subtitle={`Developers who've contributed to ${project.name}`} />
      <Card><EmptyState icon={Users} title="No contributors yet" message="Once developers start contributing, they'll show up here." /></Card>
    </div>
  );
}