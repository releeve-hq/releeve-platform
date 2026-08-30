import Link from "next/link";
import { getTokenTransfers } from "@/lib/explorer-api";
import { addressRoute, explorerRoutes, truncateEntity } from "@/lib/explorer-routes";

export default async function TokenExplorerPage({
  params,
}: {
  params: Promise<{ network: string; asset: string }>;
}) {
  const { network, asset } = await params;
  const decodedNetwork = decodeURIComponent(network);
  const decodedAsset = decodeURIComponent(asset).toUpperCase();
  const { data, error } = await getTokenTransfers(decodedNetwork, decodedAsset, 20);
  const transfers = data?.data ?? [];

  return (
    <main style={{ minHeight: 0, background: "transparent", color: "var(--text)", padding: "0 0 40px", fontFamily: "inherit" }}>
      <header style={{ padding: "0 0 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link href={`/explorer/${encodeURIComponent(decodedNetwork)}`} style={{ color: "var(--text)", fontWeight: 700, textDecoration: "none" }}>Back to Explorer</Link>
        <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{decodedNetwork}</span>
      </header>
      <section style={{ maxWidth: 920, padding: "34px 0 24px" }}>
        <p style={{ margin: "0 0 10px", color: "var(--orange)", fontSize: 12, fontWeight: 700, textTransform: "uppercase" }}>Token activity</p>
        <h1 style={{ margin: 0, fontSize: "clamp(30px,4vw,46px)", lineHeight: 1.1 }}>{decodedAsset}</h1>
        <p style={{ color: "var(--text-dim)", maxWidth: 620, lineHeight: 1.7 }}>Recent decoded fund-flow edges indexed for this asset over the last 30 days.</p>
      </section>
      {error && <div style={{ marginBottom: 16, color: "var(--red)", fontSize: 13 }}>{error}</div>}
      <section style={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", overflowX: "auto" }}>
        <div style={{ minWidth: 860 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr 1fr .7fr .8fr", gap: 12, padding: "12px 16px", color: "var(--text-faint)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", borderBottom: "1px solid var(--border)" }}>
            <span>Transaction</span><span>From</span><span>To</span><span>Amount</span><span>Time</span>
          </div>
          {transfers.length ? transfers.map((transfer) => (
            <div key={`${transfer.tx_hash}-${transfer.from_address}-${transfer.to_address}-${transfer.amount}`} style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr 1fr .7fr .8fr", gap: 12, padding: "14px 16px", borderBottom: "1px solid var(--border)", fontSize: 13, alignItems: "center" }}>
              <Link href={explorerRoutes.tx(decodedNetwork, transfer.tx_hash)} style={{ color: "var(--text)", textDecoration: "none", fontFamily: "var(--font-mono), monospace" }}>{truncateEntity(transfer.tx_hash, 9, 7)}</Link>
              <Link href={addressRoute(decodedNetwork, transfer.from_address)} style={{ color: "var(--text-dim)", textDecoration: "none", fontFamily: "var(--font-mono), monospace" }}>{truncateEntity(transfer.from_address, 8, 6)}</Link>
              <Link href={addressRoute(decodedNetwork, transfer.to_address)} style={{ color: "var(--text-dim)", textDecoration: "none", fontFamily: "var(--font-mono), monospace" }}>{truncateEntity(transfer.to_address, 8, 6)}</Link>
              <span>{transfer.amount}</span>
              <span style={{ color: "var(--text-faint)" }}>{new Date(transfer.timestamp).toLocaleString()}</span>
            </div>
          )) : <div style={{ padding: 24, color: "var(--text-faint)", fontSize: 13 }}>No transfers indexed for this asset yet.</div>}
        </div>
      </section>
    </main>
  );
}
