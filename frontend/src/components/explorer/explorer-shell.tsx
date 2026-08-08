'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function ExplorerShell({ network, children }: { network: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const root = `/explorer/${encodeURIComponent(network)}`;
  const navigation = [
    { label: 'Overview', href: root },
    { label: 'Transactions', href: `${root}#transactions` },
    { label: 'Ledgers', href: `${root}#ledgers` },
    { label: 'Accounts', href: `${root}#search` },
    { label: 'Contracts', href: `${root}#search` },
  ];

  return (
    <div className="explorer-shell">
      <aside className="explorer-sidebar">
        <Link href="/dashboard" className="explorer-sidebar-brand">Releeve</Link>
        <p>Explorer</p>
        <nav aria-label="Explorer navigation">
          {navigation.map((item) => <Link key={item.label} href={item.href} className={pathname === root && item.label === 'Overview' ? 'active' : ''}>{item.label}</Link>)}
        </nav>
        <div className="explorer-sidebar-footer"><Link href="/dashboard">Workspace</Link></div>
      </aside>
      <div className="explorer-shell-content">{children}</div>
      <style>{`
        .explorer-shell{display:grid;grid-template-columns:196px minmax(0,1fr);min-height:100dvh;background:#171312}.explorer-sidebar{position:sticky;top:0;display:flex;flex-direction:column;min-height:100dvh;padding:20px 10px;border-right:1px solid #3e3530;background:#1d1816;color:#a69a92;font-family:var(--font-inter),system-ui,sans-serif}.explorer-sidebar-brand{padding:0 10px;color:#f2efec;font-size:15px;font-weight:700;text-decoration:none}.explorer-sidebar p{margin:32px 10px 8px;color:#786d65;font-size:10px;font-weight:700;text-transform:uppercase}.explorer-sidebar nav{display:grid;gap:2px}.explorer-sidebar nav a,.explorer-sidebar-footer a{padding:9px 10px;border-radius:6px;color:#b6aaa2;font-size:13px;text-decoration:none}.explorer-sidebar nav a:hover,.explorer-sidebar nav a.active,.explorer-sidebar-footer a:hover{background:#2a2421;color:#f2efec}.explorer-sidebar-footer{margin-top:auto;padding:10px 0;border-top:1px solid #342c28}.explorer-shell-content{min-width:0}@media(max-width:760px){.explorer-shell{display:block}.explorer-sidebar{position:static;min-height:0;padding:12px 16px;border-right:0;border-bottom:1px solid #3e3530}.explorer-sidebar p,.explorer-sidebar-footer{display:none}.explorer-sidebar nav{display:flex;overflow-x:auto;margin-top:12px}.explorer-sidebar nav a{white-space:nowrap}.explorer-sidebar-brand{padding:0}}
      `}</style>
    </div>
  );
}
