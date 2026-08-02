'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { GitBranch, Github, Plus, ExternalLink, ChevronDown, ChevronRight, AlertCircle, Loader2, X, ArrowUpRight } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { PrimaryButton, SecondaryButton } from '@/components/ui/button';
import { Tag } from '@/components/ui/badge';

interface Repo {
  id: string;
  github_repo_id: number;
  github_repo_name: string;
  github_full_name: string;
  private: boolean;
}

interface Issue {
  id: number;
  number: number;
  title: string;
  state: string;
  body?: string;
  html_url: string;
  repo_full_name: string;
  github_issue_id: number;
}

/* ============================================================================
   GITHUB INSTALL MODAL (almost fullscreen)
============================================================================ */
function GithubInstallModal({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const [installing, setInstalling] = useState(false);

  async function handleInstall() {
    setInstalling(true);
    try {
      const data = await api.get<{ url: string }>(`/api/v1/orgs/github/install/begin?org_id=${projectId}`);
      if (data.url) window.location.href = data.url;
    } catch {}
    setInstalling(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8" style={{ backgroundColor: 'rgba(21,20,26,0.6)' }} onClick={onClose}>
      <div
        className="w-full h-full bg-[#111113] rounded-2xl border border-white/10 shadow-2xl seidar-animate-in overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 'calc(100vw - 64px)', maxHeight: 'calc(100vh - 64px)' }}
      >
        <div className="flex items-center justify-between px-6 sm:px-10 py-5 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-600/20 flex items-center justify-center">
              <Github size={22} className="text-violet-400" />
            </div>
            <div>
              <div className="text-sm font-semibold text-zinc-100">Connect GitHub repositories</div>
              <div className="text-xs text-zinc-500">Install the Releeve GitHub App to sync repos and issues</div>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-500 hover:bg-white/5 hover:text-zinc-200 transition-colors"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto seidar-scrollbar p-6 sm:p-10">
          <div className="max-w-3xl mx-auto flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-violet-600/15 flex items-center justify-center mb-6">
              <Github size={40} className="text-violet-400" />
            </div>
            <h2 className="text-xl font-semibold text-zinc-100 mb-3">Sync your GitHub repositories</h2>
            <p className="text-sm text-zinc-500 max-w-lg mb-8 leading-relaxed">
              Bounties on Releeve are placed directly on GitHub issues. Installing the Releeve GitHub App lets you
              select any open issue from your repositories and attach a bounty to it.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full mb-10 text-left">
              <Card className="p-5 text-center">
                <div className="w-10 h-10 rounded-xl bg-violet-600/15 flex items-center justify-center mx-auto mb-3"><Github size={20} className="text-violet-400" /></div>
                <div className="text-sm font-semibold text-zinc-100 mb-1">1. Install the app</div>
                <div className="text-xs text-zinc-500 leading-relaxed">Authorize Releeve to access your organization's repositories on GitHub.</div>
              </Card>
              <Card className="p-5 text-center">
                <div className="w-10 h-10 rounded-xl bg-violet-600/15 flex items-center justify-center mx-auto mb-3"><GitBranch size={20} className="text-violet-400" /></div>
                <div className="text-sm font-semibold text-zinc-100 mb-1">2. Repos sync</div>
                <div className="text-xs text-zinc-500 leading-relaxed">All repositories from the installation are synced automatically to Releeve.</div>
              </Card>
              <Card className="p-5 text-center">
                <div className="w-10 h-10 rounded-xl bg-violet-600/15 flex items-center justify-center mx-auto mb-3"><ExternalLink size={20} className="text-violet-400" /></div>
                <div className="text-sm font-semibold text-zinc-100 mb-1">3. Create bounties</div>
                <div className="text-xs text-zinc-500 leading-relaxed">Pick any open issue from your synced repos and attach a USDC bounty.</div>
              </Card>
            </div>

            <PrimaryButton icon={Github} onClick={handleInstall} disabled={installing} className="text-base px-8 py-3">
              {installing ? 'Redirecting to GitHub...' : 'Install Releeve GitHub App'}
            </PrimaryButton>
            <p className="text-xs text-zinc-600 mt-4 flex items-center gap-1">
              You'll be redirected to GitHub <ArrowUpRight size={12} /> to authorize the installation
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end px-6 sm:px-10 py-4 border-t border-white/10 shrink-0">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   PROJECT REPOS PAGE
============================================================================ */
export default function ProjectReposPage() {
  const params = useParams();
  const projectId = params.id as string;
  const { activeContext } = useApp();

  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [fetchingIssues, setFetchingIssues] = useState<string | null>(null);
  const [issuesMap, setIssuesMap] = useState<Record<string, Issue[]>>({});
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);

  async function fetchRepos() {
    try {
      const data = await api.get<{ repos: Repo[] }>(`/api/v1/orgs/${projectId}/repos`);
      setRepos(data.repos || []);
    } catch { /* not connected yet */ }
    setLoading(false);
  }

  useEffect(() => {
    if (projectId) fetchRepos();
  }, [projectId]);

  async function toggleRepo(repoId: string, repo: Repo) {
    if (expandedRepo === repoId) {
      setExpandedRepo(null);
      return;
    }
    setExpandedRepo(repoId);
    if (!issuesMap[repoId]) {
      setFetchingIssues(repoId);
      try {
        const data = await api.get<{ issues: Issue[] }>(`/api/v1/orgs/${projectId}/repos/${repo.github_repo_id}/issues`);
        setIssuesMap(prev => ({ ...prev, [repoId]: data.issues || [] }));
      } catch {
        setIssuesMap(prev => ({ ...prev, [repoId]: [] }));
      }
      setFetchingIssues(null);
    }
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-[1000px] mx-auto seidar-animate-in">
        <div className="flex items-center justify-center py-20 text-zinc-500"><Loader2 size={20} className="animate-spin mr-2" /> Loading repositories...</div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1000px] mx-auto seidar-animate-in">
      <SectionHeader
        title="Repositories"
        subtitle={repos.length > 0 ? `${repos.length} connected ${repos.length === 1 ? 'repository' : 'repositories'}` : 'No repositories connected'}
        action={
          <PrimaryButton icon={Github} onClick={() => setInstallModalOpen(true)}>
            {repos.length === 0 ? 'Connect GitHub' : 'Add repositories'}
          </PrimaryButton>
        }
      />

      {repos.length === 0 ? (
        <Card className="p-10 text-center">
          <div className="w-14 h-14 rounded-full bg-violet-600/20 flex items-center justify-center mx-auto mb-4">
            <Github size={28} className="text-violet-400" />
          </div>
          <h3 className="text-base font-semibold text-zinc-100 mb-2">Connect your GitHub repositories</h3>
          <p className="text-sm text-zinc-500 max-w-md mx-auto mb-6">
            Install the Releeve GitHub App to sync your repositories and issues. You'll be able to create bounties directly on GitHub issues.
          </p>
          <PrimaryButton icon={Github} onClick={() => setInstallModalOpen(true)} className="mx-auto">
            Connect GitHub
          </PrimaryButton>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {repos.map(repo => {
            const isOpen = expandedRepo === repo.id;
            const issues = issuesMap[repo.id];
            const fetching = fetchingIssues === repo.id;
            return (
              <Card key={repo.id} className="overflow-hidden">
                <button
                  onClick={() => toggleRepo(repo.id, repo)}
                  className="w-full flex items-center justify-between p-5 hover:bg-white/5 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-violet-600/15 flex items-center justify-center shrink-0">
                      <GitBranch size={16} className="text-violet-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                        {repo.github_full_name}
                        {repo.private && <Tag>Private</Tag>}
                      </div>
                      <div className="text-xs text-zinc-500">{repo.github_repo_name}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <a
                      href={`https://github.com/${repo.github_full_name}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      <ExternalLink size={15} />
                    </a>
                    {fetching ? (
                      <Loader2 size={15} className="animate-spin text-zinc-500" />
                    ) : isOpen ? (
                      <ChevronDown size={16} className="text-zinc-500" />
                    ) : (
                      <ChevronRight size={16} className="text-zinc-500" />
                    )}
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-white/10 px-5 py-3">
                    {fetching ? (
                      <div className="flex items-center gap-2 text-sm text-zinc-500 py-2">
                        <Loader2 size={14} className="animate-spin" /> Loading issues...
                      </div>
                    ) : issues && issues.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {issues.map(issue => (
                          <a
                            key={issue.github_issue_id}
                            href={issue.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between p-2.5 rounded-lg hover:bg-white/5 transition-colors group"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className="text-xs font-medium text-zinc-500 seidar-mono shrink-0">#{issue.number}</span>
                              <span className="text-sm text-zinc-300 group-hover:text-zinc-100 truncate">{issue.title}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Tag>{issue.state}</Tag>
                              <ExternalLink size={12} className="text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                            </div>
                          </a>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-zinc-500 py-2">
                        <AlertCircle size={14} /> No open issues found
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <GithubInstallModal open={installModalOpen} onClose={() => setInstallModalOpen(false)} projectId={projectId} />
    </div>
  );
}
