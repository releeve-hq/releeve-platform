'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/app-context';
import { api } from '@/lib/api';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';

const PAGE_SIZE = 20;

function SkeletonCard() {
  return (
    <Card className="p-6 animate-pulse">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-gray-200" />
          <div className="space-y-2">
            <div className="h-4 w-28 bg-gray-200 rounded" />
            <div className="h-3 w-20 bg-gray-100 rounded" />
          </div>
        </div>
        <div className="h-3 w-12 bg-gray-100 rounded" />
      </div>
      <div className="space-y-2 mb-5">
        <div className="h-3 w-full bg-gray-100 rounded" />
        <div className="h-3 w-3/4 bg-gray-100 rounded" />
      </div>
      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
        <div className="h-3 w-24 bg-gray-100 rounded" />
        <div className="h-3 w-20 bg-gray-100 rounded" />
        <div className="h-3 w-16 bg-gray-100 rounded" />
      </div>
    </Card>
  );
}

const PALETTE = ['bg-violet-600', 'bg-blue-600', 'bg-emerald-600', 'bg-amber-500', 'bg-rose-500', 'bg-indigo-600', 'bg-teal-600', 'bg-fuchsia-600'];

export default function ProjectsPage() {
  const { navigate } = useApp();
  const [orgs, setOrgs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(true);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get(`/api/v1/orgs?offset=0&limit=${PAGE_SIZE}`);
        if (cancelled) return;
        const items = data.orgs || [];
        setOrgs(items);
        offsetRef.current = items.length;
        hasMoreRef.current = items.length === PAGE_SIZE;
      } catch {
        if (!cancelled) setOrgs([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
          loadingRef.current = false;
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        if (!hasMoreRef.current || loadingRef.current || loadingMoreRef.current) return;
        loadingMoreRef.current = true;
        setLoadingMore(true);
        const currentOffset = offsetRef.current;
        (async () => {
          try {
            const data = await api.get(`/api/v1/orgs?offset=${currentOffset}&limit=${PAGE_SIZE}`);
            const items = data.orgs || [];
            setOrgs(prev => [...prev, ...items]);
            offsetRef.current = currentOffset + items.length;
            hasMoreRef.current = items.length === PAGE_SIZE;
          } catch {
            // fallback
          } finally {
            loadingMoreRef.current = false;
            setLoadingMore(false);
          }
        })();
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1200px] mx-auto seidar-animate-in">
      <SectionHeader
        title="Projects"
        subtitle={`${orgs.length} projects building on Releeve`}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
          : orgs.map((org: any) => (
              <Card key={org.id} hoverable className="p-6" onClick={() => navigate('project', { id: org.id })}>
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <Avatar name={org.name} color={PALETTE[orgs.indexOf(org) % PALETTE.length]} size={12} />
                    <div>
                      <div className="text-[15px] font-semibold text-gray-900 flex items-center gap-2 flex-wrap">{org.name}</div>
                      <div className="text-xs text-gray-400">Organization</div>
                    </div>
                  </div>
                </div>
                <p className="text-sm text-gray-500 mb-5 leading-relaxed">
                  {org.description || 'No description yet.'}
                </p>
                <div className="flex items-center justify-between pt-4 border-t border-gray-100 text-xs">
                  <span className="text-gray-400">Created {new Date(org.created_at).toLocaleDateString()}</span>
                </div>
              </Card>
            ))}
      </div>

      {loadingMore && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          {Array.from({ length: 2 }).map((_, i) => <SkeletonCard key={`more-${i}`} />)}
        </div>
      )}

      <div ref={sentinelRef} className="h-4" />

      {!loading && orgs.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg font-medium">No projects yet</p>
          <p className="text-sm mt-1">Be the first to create a project on Releeve.</p>
        </div>
      )}
    </div>
  );
}
