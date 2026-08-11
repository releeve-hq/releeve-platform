"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Box, CircleDollarSign } from "lucide-react";
import type { ExplorerTxDetail, TxFundFlowEdge } from "@/lib/explorer-api";
import {
  addressRoute,
  isContractAddress,
  truncateEntity,
} from "@/lib/explorer-routes";
import Link from "next/link";

type Decimal = { value: bigint; scale: number };

function decimal(value: string): Decimal {
  const match = value.trim().match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return { value: BigInt(0), scale: 0 };
  const fraction = match[3] ?? "";
  const amount =
    BigInt(`${match[2]}${fraction}` || "0") *
    (match[1] ? BigInt(-1) : BigInt(1));
  return { value: amount, scale: fraction.length };
}

function add(left: Decimal, right: Decimal): Decimal {
  const scale = Math.max(left.scale, right.scale);
  return {
    scale,
    value:
      left.value * BigInt(10) ** BigInt(scale - left.scale) +
      right.value * BigInt(10) ** BigInt(scale - right.scale),
  };
}

function print(value: Decimal) {
  const negative = value.value < BigInt(0);
  const raw = (negative ? -value.value : value.value)
    .toString()
    .padStart(value.scale + 1, "0");
  const whole = value.scale ? raw.slice(0, -value.scale) : raw;
  const fraction = value.scale
    ? raw.slice(-value.scale).replace(/0+$/, "")
    : "";
  return `${negative ? "-" : "+"}${whole}${fraction ? `.${fraction}` : ""}`;
}

function usd(value: string | null | undefined) {
  if (!value) return "Not available";
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString(undefined, { style: "currency", currency: "USD" })
    : value;
}

function role(address: string, tx: ExplorerTxDetail) {
  if (address === "Mint" || address === "Burn" || address === "Network fee")
    return address;
  if (address === tx.source_account) return "Source";
  if (isContractAddress(address)) return "Contract";
  return "Account";
}

function Identity({
  address,
  network,
  tx,
}: {
  address: string;
  network: string;
  tx: ExplorerTxDetail;
}) {
  const system = ["Mint", "Burn", "Network fee"].includes(address);
  return (
    <span className="transfer-identity">
      <span
        className="transfer-avatar"
        data-contract={isContractAddress(address)}
      >
        <Box />
      </span>
      {system ? (
        <span className="mono">{address}</span>
      ) : (
        <Link
          className="mono"
          href={addressRoute(network, address)}
          title={address}
        >
          {truncateEntity(address, 8, 6)}
        </Link>
      )}
      <span className="transfer-role">{role(address, tx)}</span>
    </span>
  );
}

export function AssetTransfers({
  tx,
  network,
}: {
  tx: ExplorerTxDetail;
  network: string;
}) {
  const [mode, setMode] = useState<"address" | "execution">("address");
  const grouped = useMemo(() => {
    const balances = new Map<
      string,
      {
        address: string;
        asset: string;
        amount: Decimal;
        usd: string | null;
        type: string;
      }
    >();
    const apply = (edge: TxFundFlowEdge, address: string, sign: 1 | -1) => {
      const key = `${address}\u0000${edge.asset}`;
      const current = balances.get(key) ?? {
        address,
        asset: edge.asset,
        amount: { value: BigInt(0), scale: 0 },
        usd: edge.usd_value ?? null,
        type: edge.asset_type,
      };
      const amount = decimal(edge.amount);
      current.amount = add(current.amount, {
        ...amount,
        value: amount.value * BigInt(sign),
      });
      balances.set(key, current);
    };
    tx.fund_flow.forEach((edge) => {
      apply(edge, edge.from, -1);
      apply(edge, edge.to, 1);
    });
    return Array.from(balances.values()).filter(
      (item) => item.amount.value !== BigInt(0),
    );
  }, [tx.fund_flow]);

  return (
    <section className="transfer-card" aria-labelledby="asset-transfer-title">
      <header>
        <div>
          <h2 id="asset-transfer-title">Asset transfers</h2>
          <span>
            {tx.fund_flow.length} transfer{tx.fund_flow.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="transfer-mode" aria-label="Transfer grouping">
          <span>Group by</span>
          <button
            type="button"
            className={mode === "address" ? "active" : ""}
            onClick={() => setMode("address")}
          >
            Address
          </button>
          <button
            type="button"
            className={mode === "execution" ? "active" : ""}
            onClick={() => setMode("execution")}
          >
            Execution order
          </button>
        </div>
      </header>
      <div className="transfer-scroll">
        {tx.fund_flow.length === 0 ? (
          <div className="transfer-empty">
            No asset moved in this transaction.
          </div>
        ) : mode === "address" ? (
          <table>
            <thead>
              <tr>
                <th>Address</th>
                <th>Token</th>
                <th>Net balance change</th>
                <th>Type</th>
                <th>USD value</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((item) => (
                <tr key={`${item.address}-${item.asset}`}>
                  <td>
                    <Identity
                      address={item.address}
                      network={network}
                      tx={tx}
                    />
                  </td>
                  <td>
                    <span className="token-icon">
                      <CircleDollarSign />
                    </span>
                    {item.asset}
                  </td>
                  <td
                    className={
                      item.amount.value < BigInt(0)
                        ? "negative mono"
                        : "positive mono"
                    }
                  >
                    {print(item.amount)}
                  </td>
                  <td>{item.type.replaceAll("_", " ")}</td>
                  <td>{usd(item.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>From</th>
                <th></th>
                <th>To</th>
                <th>Token</th>
                <th>Asset type</th>
                <th>Amount</th>
                <th>USD value</th>
              </tr>
            </thead>
            <tbody>
              {tx.fund_flow.map((edge, index) => (
                <tr key={edge.id}>
                  <td className="mono">{index + 1}</td>
                  <td>
                    <Identity address={edge.from} network={network} tx={tx} />
                  </td>
                  <td>
                    <ArrowRight className="transfer-arrow" />
                  </td>
                  <td>
                    <Identity address={edge.to} network={network} tx={tx} />
                  </td>
                  <td>{edge.asset}</td>
                  <td>{edge.asset_type.replaceAll("_", " ")}</td>
                  <td className="mono">{edge.amount}</td>
                  <td>{usd(edge.usd_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <style jsx>{`
        .transfer-card {
          margin: 24px 28px 0;
          border: 1px solid var(--border);
          border-radius: 7px;
          overflow: hidden;
        }
        .transfer-card header {
          min-height: 50px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 14px;
          padding: 10px 15px;
          background: var(--panel);
          border-bottom: 1px solid var(--border);
        }
        .transfer-card header > div:first-child {
          display: flex;
          align-items: baseline;
          gap: 8px;
        }
        .transfer-card h2 {
          font-size: 13px;
          margin: 0;
        }
        .transfer-card header span {
          color: var(--text-faint);
          font-size: 11px;
        }
        .transfer-mode {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .transfer-mode button {
          height: 28px;
          border: 1px solid var(--border);
          border-radius: 5px;
          background: transparent;
          color: var(--text-dim);
          font: inherit;
          font-size: 11px;
          padding: 0 9px;
          cursor: pointer;
        }
        .transfer-mode button.active {
          background: var(--bg);
          color: var(--text);
          border-color: var(--text-faint);
        }
        .transfer-scroll {
          max-height: 370px;
          overflow: auto;
        }
        .transfer-scroll table {
          width: 100%;
          min-width: 780px;
          border-collapse: collapse;
        }
        .transfer-scroll th,
        .transfer-scroll td {
          text-align: left;
          padding: 11px 14px;
          border-bottom: 1px solid var(--border);
          font-size: 11.5px;
        }
        .transfer-scroll th {
          position: sticky;
          top: 0;
          background: var(--bg);
          z-index: 1;
          color: var(--text-faint);
          font-size: 10px;
        }
        .transfer-scroll tr:last-child td {
          border-bottom: 0;
        }
        .transfer-scroll td {
          color: var(--text-dim);
        }
        .transfer-scroll :global(.transfer-identity) {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          white-space: nowrap;
        }
        .transfer-scroll :global(.transfer-identity a) {
          text-decoration: underline;
          text-decoration-color: var(--border);
          text-underline-offset: 3px;
        }
        .transfer-scroll :global(.transfer-avatar) {
          display: inline-grid;
          place-items: center;
          width: 22px;
          height: 22px;
          border: 1px solid #5b4d45;
          border-radius: 4px;
          background: #352d29;
          color: #e8823c;
        }
        .transfer-scroll :global(.transfer-avatar[data-contract="true"]) {
          background: #29342c;
          color: #a3ff5f;
        }
        .transfer-scroll :global(.transfer-avatar svg),
        .token-icon :global(svg) {
          width: 12px;
          height: 12px;
        }
        .transfer-scroll :global(.transfer-role) {
          padding: 2px 5px;
          border-radius: 999px;
          background: #302a27;
          color: var(--text-faint);
          font-size: 9px;
        }
        .token-icon {
          display: inline-grid;
          place-items: center;
          width: 19px;
          height: 19px;
          border: 1px solid var(--border);
          border-radius: 4px;
          margin-right: 7px;
          color: #8ba7ff;
        }
        .positive {
          color: var(--green) !important;
        }
        .negative {
          color: var(--red) !important;
        }
        .transfer-scroll :global(.transfer-arrow) {
          width: 14px;
          height: 14px;
          color: var(--text-faint);
        }
        .transfer-empty {
          padding: 28px 16px;
          color: var(--text-faint);
          font-size: 12px;
        }
        @media (max-width: 700px) {
          .transfer-card {
            margin-left: 14px;
            margin-right: 14px;
          }
          .transfer-card header {
            align-items: flex-start;
            flex-direction: column;
          }
          .transfer-mode {
            width: 100%;
            overflow: auto;
          }
        }
      `}</style>
    </section>
  );
}
