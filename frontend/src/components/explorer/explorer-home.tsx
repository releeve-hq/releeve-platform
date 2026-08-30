'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { GlobalExplorerSearch } from '@/components/explorer/global-explorer-search';
import {
  getRecentLedgers,
  getRecentTransactions,
  type ExplorerFeedLedger,
  type ExplorerFeedTransaction,
  type ExplorerPage,
} from '@/lib/explorer-api';
import { explorerRoutes, truncateEntity } from '@/lib/explorer-routes';

const PAGE_SIZES = [10, 20, 50, 100];

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString();
}

function PageControls({ page, canBack, onBack, onNext, disabled }: { page: ExplorerPage<unknown> | null; canBack: boolean; onBack: () => void; onNext: () => void; disabled: boolean }) {
  return <div className="explorer-page-controls">
    <button disabled={!canBack || disabled} onClick={onBack}>Back</button>
    <button disabled={!page?.next_cursor || disabled} onClick={onNext}>Next</button>
  </div>;
}

export function ExplorerHome({ network }: { network: string }) {
  const [pageSize, setPageSize] = useState(10);
  const [transactions, setTransactions] = useState<ExplorerPage<ExplorerFeedTransaction> | null>(null);
  const [ledgers, setLedgers] = useState<ExplorerPage<ExplorerFeedLedger> | null>(null);
  const [transactionCursor, setTransactionCursor] = useState<string | undefined>();
  const [ledgerCursor, setLedgerCursor] = useState<string | undefined>();
  const [transactionHistory, setTransactionHistory] = useState<string[]>([]);
  const [ledgerHistory, setLedgerHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextTransactionCursor = transactionCursor, nextLedgerCursor = ledgerCursor) => {
    setLoading(true);
    setError(null);
    const [transactionResult, ledgerResult] = await Promise.all([
      getRecentTransactions(network, pageSize, nextTransactionCursor),
      getRecentLedgers(network, pageSize, nextLedgerCursor),
    ]);
    setTransactions(transactionResult.data);
    setLedgers(ledgerResult.data);
    setError(transactionResult.error || ledgerResult.error);
    setLoading(false);
  }, [ledgerCursor, network, pageSize, transactionCursor]);

  useEffect(() => { void load(); }, [load]);

  const nextTransactions = () => {
    const nextCursor = transactions?.next_cursor;
    if (!nextCursor) return;
    setTransactionHistory((items) => [...items, transactionCursor ?? ""]);
    setTransactionCursor(nextCursor);
  };
  const backTransactions = () => {
    setTransactionHistory((items) => {
      const previous = items.at(-1) ?? "";
      setTransactionCursor(previous || undefined);
      return items.slice(0, -1);
    });
  };
  const nextLedgers = () => {
    const nextCursor = ledgers?.next_cursor;
    if (!nextCursor) return;
    setLedgerHistory((items) => [...items, ledgerCursor ?? ""]);
    setLedgerCursor(nextCursor);
  };
  const backLedgers = () => {
    setLedgerHistory((items) => {
      const previous = items.at(-1) ?? "";
      setLedgerCursor(previous || undefined);
      return items.slice(0, -1);
    });
  };

  const latestLedger = ledgers?.data[0];
  return <main className="explorer-home">
    <header className="explorer-header">
      <div><span className="explorer-brand">Explorer</span><span className="explorer-slash">/</span><span>Network index</span></div>
      <nav aria-label="Network"><Link className={network === 'mainnet' ? 'active' : ''} href="/explorer/mainnet">Mainnet</Link><Link className={network === 'testnet' ? 'active' : ''} href="/explorer/testnet">Testnet</Link><Link className={network === 'futurenet' ? 'active' : ''} href="/explorer/futurenet">Futurenet</Link></nav>
    </header>
    <section className="explorer-hero">
      <p className="explorer-eyebrow">{network} network</p>
      <h1>Explore Stellar without leaving your workspace.</h1>
      <div id="search" className="explorer-search"><GlobalExplorerSearch network={network} /></div>
    </section>

    <section className="explorer-metrics" aria-label="Network summary">
      <div><span>Latest ledger</span><strong>{latestLedger?.sequence?.toLocaleString() ?? '—'}</strong></div>
      <div><span>Latest ledger transactions</span><strong>{latestLedger?.transaction_count ?? '—'}</strong></div>
      <div><span>Loaded transactions</span><strong>{transactions?.data.length ?? '—'}</strong></div>
      <div><span>Network</span><strong>{network}</strong></div>
    </section>

    {error && <div className="explorer-error" role="alert">{error}<button onClick={() => void load()}>Retry</button></div>}

    <section className="explorer-grid">
      <div id="ledgers" className="explorer-section">
        <div className="explorer-section-head"><div><h2>Latest ledgers</h2><p>Recent closed ledgers from Platform’s index.</p></div><PageControls page={ledgers} canBack={ledgerHistory.length > 0} onBack={backLedgers} onNext={nextLedgers} disabled={loading} /></div>
        <div className="explorer-table" aria-busy={loading}>
          <div className="explorer-row explorer-table-label"><span>Ledger</span><span>Transactions</span><span>Closed</span></div>
          {loading && !ledgers ? <div className="explorer-empty">Loading ledgers...</div> : ledgers?.data.length ? ledgers.data.map((ledger) => <Link className="explorer-row" key={ledger.sequence} href={explorerRoutes.ledger(network, ledger.sequence)}><span className="explorer-mono">{ledger.sequence.toLocaleString()}</span><span>{ledger.transaction_count ?? '—'}</span><span>{formatTime(ledger.timestamp)}</span></Link>) : <div className="explorer-empty">No indexed ledgers are available yet.</div>}
        </div>
      </div>
      <div id="transactions" className="explorer-section">
        <div className="explorer-section-head"><div><h2>Latest transactions</h2><p>Newest indexed operations, newest first.</p></div><div className="explorer-controls"><select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} aria-label="Transactions per page">{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} rows</option>)}</select><PageControls page={transactions} canBack={transactionHistory.length > 0} onBack={backTransactions} onNext={nextTransactions} disabled={loading} /></div></div>
        <div className="explorer-table" aria-busy={loading}>
          <div className="explorer-row explorer-table-label explorer-transaction-row"><span>Transaction</span><span>From</span><span>Ledger</span><span>Status</span></div>
          {loading && !transactions ? <div className="explorer-empty">Loading transactions...</div> : transactions?.data.length ? transactions.data.map((transaction) => <Link className="explorer-row explorer-transaction-row" key={transaction.hash} href={explorerRoutes.tx(network, transaction.hash)}><span><strong className="explorer-mono">{truncateEntity(transaction.hash)}</strong><small>{transaction.operation_type}</small></span><span className="explorer-mono">{truncateEntity(transaction.source_account, 6, 5)}</span><span>{transaction.ledger_sequence?.toLocaleString() ?? '—'}</span><span className={transaction.status === 'success' ? 'status-success' : 'status-failed'}>{transaction.status}</span></Link>) : <div className="explorer-empty">No indexed transactions are available yet.</div>}
        </div>
      </div>
    </section>
    <style>{`
      .explorer-home{min-height:100dvh;background:#121212;color:#f5f5f5;padding:0 clamp(20px,4vw,64px) 56px;font-family:var(--font-inter),system-ui,sans-serif}.explorer-header{height:72px;border-bottom:1px solid #2b2b2b;display:flex;align-items:center;justify-content:space-between;gap:20px;font-size:14px}.explorer-brand{color:#f5f5f5;font-weight:700;text-decoration:none}.explorer-slash{margin:0 9px;color:#707070}.explorer-header nav{display:flex;gap:6px}.explorer-header nav a{padding:7px 10px;border-radius:6px;color:#a1a1a1;text-decoration:none;font-size:12px}.explorer-header nav a.active,.explorer-header nav a:hover{background:#1e1e1e;color:#f5f5f5}.explorer-hero{max-width:840px;padding:72px 0 34px}.explorer-eyebrow{margin:0 0 10px;color:#a3ff5f;font-size:12px;font-weight:700;text-transform:uppercase}.explorer-hero h1{margin:0;max-width:690px;font-size:clamp(30px,4vw,48px);line-height:1.1;letter-spacing:0}.explorer-search{margin-top:28px}.explorer-error{margin:10px 0 0;color:#f3a2a2;font-size:13px;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px;border:1px solid #5a2b2b;border-radius:8px;background:#241719}.explorer-error button{height:30px;background:transparent;border:1px solid #7b4a4a;border-radius:6px;color:#f5f5f5}.explorer-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 24px}.explorer-metrics>div{padding:14px;border:1px solid #2b2b2b;border-radius:8px;background:#181818}.explorer-metrics span,.explorer-section p{display:block;color:#a1a1a1;font-size:12px}.explorer-metrics strong{display:block;margin-top:8px;color:#f5f5f5;font-size:19px}.explorer-grid{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.3fr);gap:18px}.explorer-section{min-width:0;border:1px solid #2b2b2b;border-radius:8px;background:#181818;overflow:hidden}.explorer-section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px}.explorer-section h2{margin:0;color:#f5f5f5;font-size:15px}.explorer-section p{margin:5px 0 0}.explorer-controls,.explorer-page-controls{display:flex;align-items:center;gap:7px}.explorer-controls select{height:30px;border:1px solid #2b2b2b;border-radius:6px;background:#1e1e1e;color:#a1a1a1;padding:0 7px;font:inherit;font-size:12px}.explorer-page-controls button{height:30px;border:1px solid #2b2b2b;border-radius:6px;background:transparent;color:#a1a1a1;padding:0 9px;font:inherit;font-size:12px;cursor:pointer}.explorer-page-controls button:disabled{opacity:.4;cursor:not-allowed}.explorer-row{display:grid;grid-template-columns:1.1fr .7fr 1fr;align-items:center;gap:10px;min-height:52px;padding:0 16px;border-top:1px solid #2b2b2b;color:#f5f5f5;text-decoration:none;font-size:13px}.explorer-row:not(.explorer-table-label):hover{background:#1e1e1e}.explorer-transaction-row{grid-template-columns:1.2fr 1fr .65fr .55fr}.explorer-table-label{min-height:36px;color:#707070;font-size:11px;font-weight:700;text-transform:uppercase}.explorer-row strong,.explorer-row small{display:block}.explorer-row small{margin-top:4px;color:#707070;font-size:11px}.explorer-mono{font-family:var(--font-mono),monospace}.status-success{color:#a3ff5f;font-weight:700}.status-failed{color:#f48686;font-weight:700}.explorer-empty{padding:28px 16px;color:#707070;font-size:13px}@media(max-width:900px){.explorer-metrics,.explorer-grid{grid-template-columns:1fr 1fr}.explorer-grid{gap:14px}.explorer-section{grid-column:1/-1}}@media(max-width:620px){.explorer-home{padding:0 16px 40px}.explorer-header{height:auto;min-height:68px;align-items:flex-start;padding:17px 0;flex-direction:column}.explorer-hero{padding-top:44px}.explorer-metrics{grid-template-columns:1fr 1fr}.explorer-section-head{flex-direction:column}.explorer-row{grid-template-columns:1fr .65fr .8fr}.explorer-transaction-row{grid-template-columns:1.25fr .8fr .55fr}.explorer-transaction-row>span:nth-child(2),.explorer-transaction-row>span:nth-child(4){display:none}.explorer-table-label.explorer-transaction-row>span:nth-child(2),.explorer-table-label.explorer-transaction-row>span:nth-child(4){display:none}}
    `}</style>
  </main>;
}
