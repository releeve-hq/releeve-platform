"use client";

import {
  Activity,
  Clock3,
  Cpu,
  Database,
  HardDriveDownload,
  MemoryStick,
  TriangleAlert,
  Upload,
} from "lucide-react";
import type { ResourceUsage } from "@/lib/explorer-api";

const metrics = [
  {
    key: "cpu_instructions",
    limit: "cpu_instruction_limit",
    label: "CPU instructions",
    unit: "instructions",
    Icon: Cpu,
  },
  {
    key: "disk_read_bytes",
    limit: "disk_read_bytes_limit",
    label: "Disk read",
    unit: "bytes",
    Icon: HardDriveDownload,
  },
  {
    key: "write_bytes",
    limit: "write_bytes_limit",
    label: "Ledger write",
    unit: "bytes",
    Icon: Upload,
  },
  { key: "memory_bytes", label: "Memory", unit: "bytes", Icon: MemoryStick },
  { key: "invoke_time_nsecs", label: "Invoke time", unit: "ns", Icon: Clock3 },
  {
    key: "max_rw_key_byte",
    label: "Largest read/write key",
    unit: "bytes",
    Icon: Database,
  },
  {
    key: "max_rw_data_byte",
    label: "Largest read/write value",
    unit: "bytes",
    Icon: Activity,
  },
] as const;

function metricValue(usage: ResourceUsage, key: keyof ResourceUsage) {
  const value = usage[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function ResourceUsagePanel({ usage }: { usage: ResourceUsage }) {
  return (
    <div className="resource-panel">
      <div className="resource-summary">
        <div>
          <span>Declared resource fee</span>
          <strong>
            {usage.resource_fee
              ? `${usage.resource_fee} stroops`
              : "Not declared"}
          </strong>
        </div>
        <div>
          <span>Measured metrics</span>
          <strong>
            {
              metrics.filter((item) => metricValue(usage, item.key) !== null)
                .length
            }{" "}
            / {metrics.length}
          </strong>
        </div>
        <div>
          <span>Declared limits</span>
          <strong>
            {
              metrics.filter(
                (item) =>
                  "limit" in item &&
                  item.limit &&
                  metricValue(usage, item.limit) !== null,
              ).length
            }
          </strong>
        </div>
      </div>
      <div className="resource-metrics">
        {metrics.map(({ key, label, unit, Icon, ...metric }) => {
          const used = metricValue(usage, key);
          const limitKey = "limit" in metric ? metric.limit : undefined;
          const limit = limitKey ? metricValue(usage, limitKey) : null;
          const percent =
            used !== null && limit !== null && limit > 0
              ? Math.min(100, (used / limit) * 100)
              : null;
          const warning = percent !== null && percent >= 80;
          const danger = percent !== null && percent >= 95;
          return (
            <div className="resource-metric" key={key}>
              <div
                className={`resource-icon ${danger ? "danger" : warning ? "warning" : ""}`}
              >
                <Icon />
              </div>
              <div className="resource-content">
                <div className="resource-line">
                  <div>
                    <strong>{label}</strong>
                    {warning ? (
                      <span className={danger ? "danger" : "warning"}>
                        <TriangleAlert />
                        {danger ? "At limit" : "Near limit"}
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <b>
                      {used === null ? "Not indexed" : used.toLocaleString()}
                    </b>
                    <span>
                      {limit !== null
                        ? ` / ${limit.toLocaleString()} ${unit}`
                        : used !== null
                          ? ` ${unit}`
                          : ""}
                    </span>
                  </div>
                </div>
                {percent !== null ? (
                  <>
                    <div className="resource-track">
                      <i
                        className={danger ? "danger" : warning ? "warning" : ""}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <div className="resource-percent">
                      {percent.toFixed(1)}% used
                    </div>
                  </>
                ) : (
                  <div className="resource-no-limit">
                    No protocol limit is declared for this metric.
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <style jsx>{`
        .resource-panel {
          padding: 16px;
        }
        .resource-summary {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          border: 1px solid var(--border);
          border-radius: 6px;
          margin-bottom: 14px;
        }
        .resource-summary > div {
          padding: 12px 14px;
          border-right: 1px solid var(--border);
        }
        .resource-summary > div:last-child {
          border-right: 0;
        }
        .resource-summary span,
        .resource-summary strong {
          display: block;
        }
        .resource-summary span {
          color: var(--text-faint);
          font-size: 9.5px;
          text-transform: uppercase;
        }
        .resource-summary strong {
          margin-top: 5px;
          font-size: 13px;
        }
        .resource-metrics {
          border: 1px solid var(--border);
          border-radius: 6px;
          overflow: hidden;
        }
        .resource-metric {
          display: flex;
          gap: 12px;
          padding: 14px;
          border-bottom: 1px solid var(--border);
        }
        .resource-metric:last-child {
          border-bottom: 0;
        }
        .resource-icon {
          display: grid;
          place-items: center;
          width: 32px;
          height: 32px;
          border: 1px solid #48643d;
          border-radius: 5px;
          color: #a3ff5f;
          background: #20291e;
          flex: 0 0 auto;
        }
        .resource-icon.warning {
          color: #f4b95f;
          border-color: #765d32;
          background: #2d261a;
        }
        .resource-icon.danger {
          color: #ff827a;
          border-color: #75413d;
          background: #2e1e1c;
        }
        .resource-icon :global(svg) {
          width: 15px;
          height: 15px;
        }
        .resource-content {
          min-width: 0;
          flex: 1;
        }
        .resource-line {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .resource-line > div {
          display: flex;
          align-items: center;
          gap: 7px;
        }
        .resource-line strong {
          font-size: 11.5px;
        }
        .resource-line b {
          font:
            600 11.5px ui-monospace,
            monospace;
        }
        .resource-line span {
          color: var(--text-faint);
          font-size: 9.5px;
        }
        .resource-line span.warning,
        .resource-line span.danger {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          color: #f4b95f;
        }
        .resource-line span.danger {
          color: #ff827a;
        }
        .resource-line span :global(svg) {
          width: 11px;
          height: 11px;
        }
        .resource-track {
          height: 6px;
          margin-top: 9px;
          border-radius: 3px;
          background: #302a27;
          overflow: hidden;
        }
        .resource-track i {
          display: block;
          height: 100%;
          border-radius: 3px;
          background: #a3ff5f;
        }
        .resource-track i.warning {
          background: #f4b95f;
        }
        .resource-track i.danger {
          background: #ff665e;
        }
        .resource-percent,
        .resource-no-limit {
          margin-top: 5px;
          color: var(--text-faint);
          font-size: 9px;
        }
        .resource-no-limit {
          padding-top: 3px;
          border-top: 1px dashed #39322e;
        }
        @media (max-width: 650px) {
          .resource-summary {
            grid-template-columns: 1fr;
          }
          .resource-summary > div {
            border-right: 0;
            border-bottom: 1px solid var(--border);
          }
          .resource-summary > div:last-child {
            border-bottom: 0;
          }
          .resource-line {
            align-items: flex-start;
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
}
