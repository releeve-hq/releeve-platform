"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { AddressLink, LedgerLink, TxHashLink } from "@/components/explorer/entity-links";
import {
  DEMO_ACCOUNTS,
  DEMO_LEDGERS,
  DEMO_NETWORK,
  DEMO_TRANSACTIONS,
  type ExplorerLedger,
  type ExplorerTransaction,
} from "@/lib/explorer-demo-data";

/* ─── types ─── */
type PageKey =
  | "home"
  | "simulator"
  | "virtualenv"
  | "activity"
  | "wallets"
  | "contracts"
  | "alerts"
  | "docs"
  | "settings"
  | "settings-profile"
  | "settings-notifications"
  | "settings-apikeys"
  | "settings-billing"
  | "settings-team";

/* ─── helper: svg icon wrapper ─── */
function Icon({ children, size = 17 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      stroke="currentColor"
      strokeWidth="1.8"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

function getNavIcon(key: string) {
  switch (key) {
    case "home":
      return (
        <>
          <path d="M4 11l8-7 8 7" />
          <path d="M6 10v9h5v-5h2v5h5v-9" />
        </>
      );
    case "simulator":
      return (
        <>
          <path d="M5 4v16M12 4v16M19 4v16" />
          <circle cx="5" cy="9" r="2" />
          <circle cx="12" cy="16" r="2" />
          <circle cx="19" cy="6" r="2" />
        </>
      );
    case "virtualenv":
      return (
        <>
          <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
          <path d="M12 3v18M4 7.5l8 4.5 8-4.5" />
        </>
      );
    case "activity":
      return <path d="M3 12h4l2 7 4-14 2 7h6" />;
    case "wallets":
      return (
        <>
          <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3" />
          <path d="M3 7v11a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1h-4a2 2 0 0 0 0 4h4" />
        </>
      );
    case "contracts":
      return (
        <>
          <path d="M6 3h9l3 3v15H6z" />
          <path d="M9 11l2 2 4-4M9 16h6" />
        </>
      );
    case "alerts":
      return (
        <>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </>
      );
    case "docs":
      return (
        <>
          <path d="M5 4h11a2 2 0 0 1 2 2v14l-3-2-3 2-3-2-3 2V6a2 2 0 0 1 2-2z" />
          <path d="M8 9h6M8 13h6" />
        </>
      );
    case "settings":
    default:
      return (
        <>
          <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" />
          <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
        </>
      );
  }
}

const NAV: Array<{ key: PageKey; label: string }> = [
  { key: "home", label: "Home" },
  { key: "simulator", label: "Simulator" },
  { key: "virtualenv", label: "Virtual Environment" },
  { key: "activity", label: "Activity" },
  { key: "wallets", label: "Wallets" },
  { key: "contracts", label: "Contracts" },
  { key: "alerts", label: "Alerts" },
  { key: "docs", label: "Documentation" },
  { key: "settings", label: "Settings" },
];

const CRUMBS: Record<PageKey, string> = {
  home: "Home",
  simulator: "Simulator",
  virtualenv: "Virtual Environment",
  activity: "Activity",
  wallets: "Wallets",
  contracts: "Contracts",
  alerts: "Alerts",
  docs: "Documentation",
  settings: "Settings",
  "settings-profile": "Settings / Profile",
  "settings-notifications": "Settings / Notifications",
  "settings-apikeys": "Settings / API keys",
  "settings-billing": "Settings / Billing",
  "settings-team": "Settings / Team members",
};

/* ─── Bar chart ─── */
const TX_H = [55, 92, 40, 68, 58, 30, 72, 50, 95, 62, 38, 80, 54, 90, 42, 65, 48, 72, 36, 58, 44, 78, 32, 60, 50, 84, 40, 66];
const GAS_H = [45, 60, 52, 70, 48, 65, 55, 40, 75, 50, 88, 42, 60, 35, 58, 48, 70, 30, 65, 45, 80, 38, 55, 62, 40, 72, 50, 45];

function BarChart({ heights, color }: { heights: number[]; color: "orange" | "green" }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; date: string; val: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const barColor = color === "orange" ? "#e8823c" : "#2fa84f";

  return (
    <div ref={containerRef} style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 3, height: 130 }}>
      {heights.map((h, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            minWidth: 2,
            borderRadius: "2px 2px 0 0",
            height: `${h}%`,
            background: barColor,
            cursor: "pointer",
            transition: "opacity .12s",
          }}
          onMouseEnter={(e) => {
            const bRect = (e.target as HTMLElement).getBoundingClientRect();
            if (containerRef.current) {
              const cRect = containerRef.current.getBoundingClientRect();
              const val = color === "orange"
                ? `${Math.round(h * 5.2)} txs`
                : `${((h / 100) * 0.062).toFixed(3)} Gwei`;
              setTooltip({
                x: bRect.left - cRect.left + bRect.width / 2,
                y: bRect.top - cRect.top,
                date: `May ${i + 1}, 2024`,
                val,
              });
            }
          }}
          onMouseLeave={() => setTooltip(null)}
        />
      ))}
      {tooltip && (
        <div
          style={{
            position: "absolute",
            left: tooltip.x,
            top: tooltip.y,
            transform: "translate(-50%, -100%)",
            marginTop: -10,
            background: "#0c0c0c",
            color: "#fff",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 11.5,
            whiteSpace: "nowrap",
            boxShadow: "0 10px 28px rgba(0,0,0,.45)",
            pointerEvents: "none",
            zIndex: 20,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>{tooltip.date}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: barColor, flexShrink: 0, display: "inline-block" }} />
            <span style={{ color: "#b7b7b7" }}>{color === "orange" ? "Transactions" : "Gas Price"}</span>
            <span style={{ fontWeight: 700, marginLeft: "auto" }}>{tooltip.val}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Notification panel ─── */
function NotifPanel({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  const notifs = [
    { unread: false, text: "Deployment failed for mustard-landing", when: "87d ago" },
    { unread: true, text: "Deployment failed for synodfrontend", when: "87d ago" },
    { unread: true, text: "Deployment failed for synodfrontend", when: "87d ago" },
  ];
  if (!open) return null;
  return (
    <div
      id={id}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: "calc(100% + 10px)",
        right: 0,
        width: 320,
        maxWidth: "85vw",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 20px 50px rgba(0,0,0,.5)",
        zIndex: 150,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 14px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>Notifications</span>
        <span style={{ fontSize: 11.5, color: "var(--blue)", cursor: "pointer" }} onClick={onClose}>
          Mark all as read
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
        <Icon size={14}>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </Icon>
        <input
          placeholder="Search notifications…"
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--text)", fontSize: 12.5, fontFamily: "inherit" }}
        />
      </div>
      <div style={{ maxHeight: 280, overflowY: "auto" }}>
        {notifs.map((n, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "12px 14px",
              borderBottom: i < notifs.length - 1 ? "1px solid var(--border)" : "none",
              cursor: "pointer",
              background: n.unread ? "rgba(47,111,237,0.12)" : "transparent",
            }}
          >
            <svg viewBox="0 0 24 24" fill="#e5484d" width={15} height={15} style={{ flexShrink: 0, marginTop: 1 }}>
              <path d="M12 2L1 21h22L12 2zm0 6a1 1 0 0 1 1 1v5a1 1 0 0 1-2 0V9a1 1 0 0 1 1-1zm0 9.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z" />
            </svg>
            <div>
              <span style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.4, fontWeight: n.unread ? 700 : 400 }}>{n.text}</span>
              <span style={{ fontSize: 10.5, color: "var(--text-faint)", display: "block", marginTop: 3 }}>{n.when}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Switch panel (workspace / project) ─── */
function WorkspaceSwitcher({ open, onClose, onNavigate }: { open: boolean; onClose: () => void; onNavigate: (k: PageKey) => void }) {
  if (!open) return null;
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        left: 0,
        width: 280,
        maxWidth: "80vw",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 20px 50px rgba(0,0,0,.5)",
        zIndex: 150,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
        <Icon size={14}>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </Icon>
        <input
          placeholder="Find team"
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--text)", fontSize: 12.5, fontFamily: "inherit" }}
        />
      </div>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-faint)", padding: "12px 14px 6px" }}>
        Personal Accounts
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 14px", margin: "0 6px 6px", borderRadius: 8, background: "var(--bg)", cursor: "pointer" }}>
        <div style={{ width: 22, height: 22, borderRadius: "50%", background: "linear-gradient(135deg,#4a4440,#28231f)", flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: 12.5, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Kingsley&apos;s Workspa...
        </span>
        <span style={{ background: "var(--free-badge-bg)", color: "var(--free-badge-text)", fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 999 }}>
          Free
        </span>
      </div>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-faint)", padding: "12px 14px 6px" }}>
        Teams
      </div>
      <div style={{ padding: "2px 14px 12px", color: "var(--text-faint)", fontSize: 12 }}>No teams found</div>
      <div style={{ borderTop: "1px solid var(--border)", margin: "2px 0" }} />
      <div
        onClick={() => {
          onNavigate("home");
          onClose();
        }}
        style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 14px", fontSize: 12.5, color: "var(--text-dim)", cursor: "pointer" }}
      >
        <Icon size={15}>{getNavIcon("home")}</Icon> Home
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 14px", fontSize: 12.5, color: "var(--text-dim)", cursor: "pointer" }}>
        <Icon size={15}>
          <path d="M12 5v14M5 12h14" />
        </Icon>{" "}
        New workspace
      </div>
    </div>
  );
}

function ProjectSwitcher({ open }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        left: 0,
        width: 280,
        maxWidth: "80vw",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 20px 50px rgba(0,0,0,.5)",
        zIndex: 150,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
        <Icon size={14}>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </Icon>
        <input
          placeholder="Find project"
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--text)", fontSize: 12.5, fontFamily: "inherit" }}
        />
      </div>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-faint)", padding: "12px 14px 6px" }}>
        Projects
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 14px", margin: "0 6px 6px", borderRadius: 8, background: "var(--bg)", cursor: "pointer" }}>
        <span style={{ fontWeight: 600, fontSize: 12.5, color: "var(--text)" }}>Kingsley&apos;s Project</span>
      </div>
      <div style={{ borderTop: "1px solid var(--border)", margin: "2px 0" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 14px", fontSize: 12.5, color: "var(--text-dim)", cursor: "pointer" }}>
        <Icon size={15}>
          <path d="M12 5v14M5 12h14" />
        </Icon>{" "}
        New project
      </div>
    </div>
  );
}

/* ─── Search modal ─── */
function SearchModal({ open, onClose, onNavigate }: { open: boolean; onClose: () => void; onNavigate: (k: PageKey) => void }) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const results = NAV.filter((n) => n.label.toLowerCase().includes(q.toLowerCase()));

  useEffect(() => {
    if (open) {
      setQ("");
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        background: "rgba(0,0,0,.55)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          width: "90%",
          maxWidth: 460,
          maxHeight: "56vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,.5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <Icon size={16}>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </Icon>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search workspace or use cmd + k"
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--text)", fontSize: 14, fontFamily: "inherit" }}
          />
        </div>
        <div style={{ overflowY: "auto", padding: 6 }}>
          {results.length === 0 ? (
            <div style={{ padding: 22, textAlign: "center", color: "var(--text-faint)", fontSize: 12.5 }}>No results found</div>
          ) : (
            results.map((n) => (
              <div
                key={n.key}
                onClick={() => {
                  onNavigate(n.key);
                  onClose();
                }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 10px", borderRadius: 8, cursor: "pointer", color: "var(--text-dim)", fontSize: 13 }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "var(--panel)";
                  (e.currentTarget as HTMLElement).style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "";
                  (e.currentTarget as HTMLElement).style.color = "var(--text-dim)";
                }}
              >
                <Icon size={16}>{getNavIcon(n.key)}</Icon>
                <span>{n.label}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Page content components ─── */
function StatusRow({ dot, name, sub, value, valueColor }: { dot: string; name: string; sub: React.ReactNode; value: string; valueColor?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 8px", borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0, display: "inline-block" }} />
        <div style={{ minWidth: 0 }}>
          <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 12.5, display: "block" }}>{name}</span>
          <span style={{ color: "var(--text-faint)", fontSize: 11, display: "block", marginTop: 1 }}>{sub}</span>
        </div>
      </div>
      <span style={{ color: valueColor || "var(--text-dim)", fontSize: 11.5, textAlign: "right", flexShrink: 0, whiteSpace: "nowrap", fontWeight: valueColor ? 700 : 400 }}>
        {value}
      </span>
    </div>
  );
}

function Card({ header, children }: { header?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, marginBottom: 8 }}>
      {header && (
        <div style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 500, display: "flex", alignItems: "center", gap: 5, padding: "9px 12px", background: "var(--panel)", borderBottom: "1px solid var(--border)" }}>
          {header}
        </div>
      )}
      {children}
    </div>
  );
}

function ChevRow({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 8px", borderTop: "1px solid var(--border)", fontSize: 12.5, color: "var(--text)", cursor: "pointer" }}
    >
      {children}
      <Icon size={14}>
        <path d="M9 6l6 6-6 6" />
      </Icon>
    </div>
  );
}

function ToggleRow({ label, on }: { label: string; on: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 8px", borderTop: "1px solid var(--border)", fontSize: 12.5, color: "var(--text)" }}>
      {label}
      <span style={{ width: 32, height: 18, borderRadius: 999, background: on ? "var(--green)" : "var(--border)", position: "relative", flexShrink: 0, display: "inline-block" }}>
        <span style={{ position: "absolute", top: 2, [on ? "right" : "left"]: 2, width: 14, height: 14, borderRadius: "50%", background: "#fff", display: "block" }} />
      </span>
    </div>
  );
}

function BlockRow({ sequence, txs, gas, pct, gwei, time }: ExplorerLedger) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 8px", gap: 8, borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, width: 112 }}>
        <Icon size={16}>
          <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
          <path d="M12 3v18M4 7.5l8 4.5 8-4.5" />
        </Icon>
        <div>
          <span style={{ fontWeight: 700, fontSize: 12.5, color: "var(--text)", display: "block" }}>
            <LedgerLink sequence={sequence} network={DEMO_NETWORK} />
          </span>
          <span style={{ fontSize: 10.5, color: "var(--text-faint)", display: "block", marginTop: 1 }}>{txs}</span>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 112, textAlign: "center" }}>
        <span style={{ fontSize: 12, color: "var(--text-dim)", whiteSpace: "nowrap" }}>
          {gas} <span style={{ color: "var(--text-faint)" }}>({pct})</span>
        </span>
        <span style={{ fontSize: 10.5, color: "var(--text-faint)", display: "block", marginTop: 1 }}>{gwei} Gwei</span>
      </div>
      <span style={{ fontSize: 10.5, color: "var(--text-faint)", textAlign: "right", flexShrink: 0, whiteSpace: "nowrap" }}>{time}</span>
    </div>
  );
}

const TOKEN_GRADIENTS = [
  "linear-gradient(135deg,#e5484d,#f5d90a)",
  "linear-gradient(135deg,#6e56cf,#12a594)",
  "linear-gradient(135deg,#12a594,#e5484d)",
  "linear-gradient(135deg,#2f6fed,#e5484d)",
  "linear-gradient(135deg,#f5a623,#6e56cf)",
  "linear-gradient(135deg,#6e56cf,#2f6fed)",
  "linear-gradient(135deg,#6e56cf,#f5d90a)",
  "linear-gradient(135deg,#2f6fed,#12a594)",
  "linear-gradient(135deg,#f5d90a,#12a594)",
  "linear-gradient(135deg,#f2efec,#6e56cf)",
  "linear-gradient(135deg,#f5a623,#6e56cf)",
];

function TxRow({ method, hash, from, to, time }: ExplorerTransaction) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "10px 8px", gap: 7, borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 7, flexShrink: 0, width: 132 }}>
        <svg viewBox="0 0 24 24" stroke="#2fa84f" strokeWidth="2.5" fill="none" width={14} height={14} style={{ flexShrink: 0, marginTop: 2 }}>
          <path d="M5 13l4 4L19 7" />
        </svg>
        <div>
          <span style={{ fontSize: 10, color: "var(--text-faint)", display: "block" }}>{method || "-"}</span>
          <span style={{ fontSize: 10.5, color: "var(--text-dim)", display: "block", marginTop: 2 }}>
            <TxHashLink hash={hash} network={DEMO_NETWORK} />
          </span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, flex: 1, minWidth: 116, textAlign: "center" }}>
        {[
          [TOKEN_GRADIENTS[0], from],
          [TOKEN_GRADIENTS[1], to],
        ].map(([grad, address], i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, minWidth: 0, width: "100%" }}>
            <span style={{ width: 13, height: 13, borderRadius: 3, background: grad, flexShrink: 0, display: "inline-block" }} />
            <span
              style={{
                fontSize: 10.5,
                color: "var(--text)",
                fontFamily: "monospace",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              <AddressLink address={address} network={DEMO_NETWORK} />
            </span>
          </div>
        ))}
      </div>
      <span style={{ fontSize: 10.5, color: "var(--text-faint)", textAlign: "right", flexShrink: 0, whiteSpace: "nowrap" }}>{time}</span>
    </div>
  );
}

/* ─── Pages ─── */
function HomePage() {
  return (
    <div>
      <h1 style={{ fontSize: 21, fontWeight: 700, lineHeight: 1.28, margin: "2px 3px 14px", letterSpacing: -0.2 }}>
        Find any address, token, or transaction — decoded
      </h1>
      <div style={{ display: "flex", alignItems: "center", gap: 9, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "11px 12px", margin: "0 3px 16px" }}>
        <Icon size={15}>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </Icon>
        <span style={{ color: "var(--text-faint)", fontSize: 12.5, flex: 1 }}>Search by hash, address, block…</span>
        <span style={{ color: "var(--text-faint)", fontSize: 10.5, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 5, padding: "2px 6px" }}>⌃ K</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", columnGap: 14, margin: "0 3px 16px" }}>
        {[
          { label: "Last closed ledger", value: DEMO_LEDGERS[0].sequence, ul: true },
          { label: "Processed Operations", value: "284" },
          { label: "Average ledger closing time", value: "12.02s" },
          { label: "TPS", value: "18.22" },
        ].map((s) => (
          <div key={s.label} style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
            <span style={{ color: "var(--text-dim)", fontSize: 10.5, lineHeight: 1.3 }}>{s.label}</span>
            <span
              style={{
                color: "var(--text)",
                fontSize: 14,
                fontWeight: 700,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                textDecoration: s.ul ? "underline" : "none",
                textUnderlineOffset: 3,
                textDecorationColor: "var(--text-faint)",
              }}
            >
              {s.ul ? <LedgerLink sequence={s.value} network={DEMO_NETWORK} /> : s.value}
            </span>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", padding: "12px 10px 0" }}>Transaction history</div>
            <div style={{ padding: "10px 10px 14px" }}>
              <BarChart heights={TX_H} color="orange" />
            </div>
          </Card>

          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 700, color: "var(--text)", margin: "22px 3px 8px" }}>
            Latest blocks{" "}
            <Icon size={13}>
              <path d="M7 17L17 7M8 7h9v9" />
            </Icon>
          </div>
          <Card>
            <div style={{ padding: "0 8px" }}>
              {DEMO_LEDGERS.map((b, i) => (
                <div key={i} style={i === 0 ? { borderTop: "none" } : {}}>
                  <BlockRow {...b} />
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div style={{ flex: 1, minWidth: 240 }}>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", padding: "12px 10px 0" }}>Average Gas Price</div>
            <div style={{ padding: "10px 10px 14px" }}>
              <BarChart heights={GAS_H} color="green" />
            </div>
          </Card>

          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 700, color: "var(--text)", margin: "22px 3px 8px" }}>
            Latest transactions{" "}
            <Icon size={13}>
              <path d="M7 17L17 7M8 7h9v9" />
            </Icon>
          </div>
          <Card>
            <div style={{ padding: "0 8px" }}>
              {DEMO_TRANSACTIONS.map((tx, i) => (
                <div key={i} style={i === 0 ? { borderTop: "none" } : {}}>
                  <TxRow {...tx} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SimulatorPage() {
  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 5px" }}>Simulator</h1>
      <p style={{ color: "var(--text-dim)", fontSize: 12.5, lineHeight: 1.5, margin: "0 0 16px" }}>Run scenarios against live market conditions before you commit real funds.</p>
      <Card header="Recent runs">
        <div>
          <StatusRow dot="#2fa84f" name="Bull run · v1.2" sub="42s runtime" value="+12.4%" valueColor="#2fa84f" />
          <StatusRow dot="#e5484d" name="Flash crash · v1.0" sub="28s runtime" value="−8.1%" valueColor="#e5484d" />
          <StatusRow dot="#2fa84f" name="Sideways market · v1.1" sub="35s runtime" value="+0.3%" valueColor="#2fa84f" />
        </div>
      </Card>
      <button style={{ margin: "0 3px", background: "transparent", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, fontWeight: 600, padding: "7px 12px", borderRadius: 5, fontFamily: "inherit", cursor: "pointer" }}>
        Run new simulation
      </button>
    </div>
  );
}

function VirtualEnvPage() {
  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 5px" }}>Virtual Environment</h1>
      <p style={{ color: "var(--text-dim)", fontSize: 12.5, lineHeight: 1.5, margin: "0 0 16px" }}>Isolated sandboxes that mirror production without touching real assets.</p>
      <Card header="Environments">
        <div>
          <StatusRow dot="#2fa84f" name="mainnet-fork" sub={<>Block height <LedgerLink sequence="19204113" network={DEMO_NETWORK} /></>} value="Synced 5m ago" />
          <StatusRow dot="#2fa84f" name="testnet-goerli" sub={<>Block height <LedgerLink sequence="10882004" network={DEMO_NETWORK} /></>} value="Synced 1h ago" />
          <StatusRow dot="#6f6a67" name="local-devnet" sub="Booting chain state" value="Starting…" />
        </div>
      </Card>
    </div>
  );
}

function ActivityPage() {
  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 5px" }}>Activity</h1>
      <p style={{ color: "var(--text-dim)", fontSize: 12.5, lineHeight: 1.5, margin: "0 0 16px" }}>A live feed of transactions, deployments, and account events.</p>
      <Card header="Recent activity">
        <div style={{ padding: "12px 8px" }}>
          {[
            { text: <>Signed transaction <TxHashLink hash={DEMO_TRANSACTIONS[0].hash} network={DEMO_NETWORK} /> for 0.25 ETH</>, when: "2 minutes ago" },
            { text: "Contract MyToken deployed to testnet", when: "1 hour ago" },
            { text: "Wallet metamask-1 connected", when: "3 hours ago" },
            { text: 'Simulation "Bull run · v1.2" completed', when: "Yesterday" },
          ].map((item, i) => (
            <div key={i} style={{ padding: "9px 0", borderTop: i === 0 ? "none" : "1px solid var(--border)", fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
              {item.text}
              <span style={{ color: "var(--text-faint)", fontSize: 10.5, display: "block", marginTop: 2 }}>{item.when}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function WalletsPage() {
  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 5px" }}>Wallets</h1>
      <p style={{ color: "var(--text-dim)", fontSize: 12.5, lineHeight: 1.5, margin: "0 0 16px" }}>Manage connected wallets and track balances across networks.</p>
      <Card header="Connected wallets">
        <div>
          <StatusRow dot="#2fa84f" name="MetaMask" sub={<AddressLink address={DEMO_ACCOUNTS.alpha} network={DEMO_NETWORK} />} value="4.82 ETH" />
          <StatusRow dot="#2fa84f" name="Coinbase Wallet" sub={<AddressLink address={DEMO_ACCOUNTS.beta} network={DEMO_NETWORK} />} value="1,204 USDC" />
          <StatusRow dot="#6f6a67" name="Ledger" sub={<AddressLink address={DEMO_ACCOUNTS.gamma} network={DEMO_NETWORK} />} value="Not synced" />
        </div>
      </Card>
    </div>
  );
}

function ContractsPage() {
  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 5px" }}>Contracts</h1>
      <p style={{ color: "var(--text-dim)", fontSize: 12.5, lineHeight: 1.5, margin: "0 0 16px" }}>Deploy, verify, and monitor your smart contracts.</p>
      <Card header="Deployed contracts">
        <div>
          <StatusRow dot="#2fa84f" name="MyToken.sol" sub="ERC-20" value="Verified" />
          <StatusRow dot="#e8823c" name="Staking.sol" sub="Deploying…" value="In progress" />
          <StatusRow dot="#e5484d" name="Auction.sol" sub="Gas estimation failed" value="Failed" />
        </div>
      </Card>
    </div>
  );
}

function AlertsPage() {
  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 5px" }}>Alerts</h1>
      <p style={{ color: "var(--text-dim)", fontSize: 12.5, lineHeight: 1.5, margin: "0 0 16px" }}>Get notified about price moves, failed transactions, and contract events.</p>
      <Card header="Active alerts">
        <div style={{ padding: "0 8px" }}>
          <div style={{ borderTop: "none" }}>
            <ToggleRow label="ETH drops below $2,000" on={true} />
          </div>
          <ToggleRow label="Gas fees above 80 gwei" on={true} />
          <ToggleRow label="Failed transaction" on={true} />
          <ToggleRow label="New contract event" on={false} />
        </div>
      </Card>
    </div>
  );
}

function DocsPage() {
  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 5px" }}>Documentation</h1>
      <p style={{ color: "var(--text-dim)", fontSize: 12.5, lineHeight: 1.5, margin: "0 0 16px" }}>Guides and references to help you ship faster.</p>
      <Card>
        <div style={{ padding: "0 8px" }}>
          <div style={{ borderTop: "none" }}>
            <ChevRow>Getting started</ChevRow>
          </div>
          <ChevRow>CLI reference</ChevRow>
          <ChevRow>API reference</ChevRow>
          <ChevRow>Smart contract guides</ChevRow>
          <ChevRow>Billing &amp; plans</ChevRow>
        </div>
      </Card>
    </div>
  );
}

function SettingsPage({ navigate }: { navigate: (k: PageKey) => void }) {
  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 5px" }}>Settings</h1>
      <p style={{ color: "var(--text-dim)", fontSize: 12.5, lineHeight: 1.5, margin: "0 0 16px" }}>Manage your account, team, and preferences.</p>
      <Card header="Account">
        <div style={{ padding: "0 8px" }}>
          <div style={{ borderTop: "none" }}>
            <ChevRow onClick={() => navigate("settings-profile")}>Profile</ChevRow>
          </div>
          <ChevRow onClick={() => navigate("settings-notifications")}>Notifications</ChevRow>
          <ChevRow onClick={() => navigate("settings-apikeys")}>API keys</ChevRow>
          <ChevRow onClick={() => navigate("settings-billing")}>Billing</ChevRow>
          <ChevRow onClick={() => navigate("settings-team")}>Team members</ChevRow>
        </div>
      </Card>
    </div>
  );
}

function DeployRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 8px", borderTop: "1px solid var(--border)", fontSize: 12 }}>
      <span style={{ color: "var(--text-dim)" }}>{label}</span>
      <span style={{ color: "var(--text)", fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function BackRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--text-dim)", fontSize: 12.5, fontWeight: 600, margin: "2px 3px 12px", cursor: "pointer", width: "fit-content" }}>
      <Icon size={15}>
        <path d="M15 6l-6 6 6 6" />
      </Icon>{" "}
      {label}
    </div>
  );
}

function SettingsProfilePage({ navigate }: { navigate: (k: PageKey) => void }) {
  return (
    <div>
      <BackRow label="Settings" onClick={() => navigate("settings")} />
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 5px" }}>Profile</h1>
      <p style={{ color: "var(--text-dim)", fontSize: 12.5, lineHeight: 1.5, margin: "0 0 16px" }}>Update your personal information and how it appears across Releeve.</p>
      <Card header="Personal info">
        <div style={{ padding: "0 8px" }}>
          <div style={{ borderTop: "none" }}>
            <DeployRow label="Name" value="Kingsley" />
          </div>
          <DeployRow label="Username" value="@kingsley" />
          <DeployRow label="Email" value="kingsley@••••.dev" />
          <DeployRow label="Plan" value="Free" />
        </div>
      </Card>
      <button style={{ margin: "0 3px", background: "transparent", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, fontWeight: 600, padding: "7px 12px", borderRadius: 5, fontFamily: "inherit", cursor: "pointer" }}>Edit profile</button>
    </div>
  );
}

function SettingsNotificationsPage({ navigate }: { navigate: (k: PageKey) => void }) {
  return (
    <div>
      <BackRow label="Settings" onClick={() => navigate("settings")} />
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 5px" }}>Notifications</h1>
      <p style={{ color: "var(--text-dim)", fontSize: 12.5, lineHeight: 1.5, margin: "0 0 16px" }}>Choose what you want to be notified about.</p>
      <Card header="Email notifications">
        <div style={{ padding: "0 8px" }}>
          <div style={{ borderTop: "none" }}>
            <ToggleRow label="Product updates" on={true} />
          </div>
          <ToggleRow label="Deployment failures" on={true} />
          <ToggleRow label="Weekly summary" on={false} />
          <ToggleRow label="Security alerts" on={true} />
        </div>
      </Card>
    </div>
  );
}

function SettingsApiKeysPage({ navigate }: { navigate: (k: PageKey) => void }) {
  return (
    <div>
      <BackRow label="Settings" onClick={() => navigate("settings")} />
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 5px" }}>API keys</h1>
      <p style={{ color: "var(--text-dim)", fontSize: 12.5, lineHeight: 1.5, margin: "0 0 16px" }}>Manage keys used to access the Releeve API.</p>
      <Card header="Your keys">
        <div>
          <StatusRow dot="#2fa84f" name="Production key" sub="rlv_live_••••3a1f" value="Jan 2026" />
          <StatusRow dot="#2fa84f" name="CI/CD key" sub="rlv_live_••••9c02" value="Mar 2026" />
        </div>
      </Card>
      <button style={{ margin: "0 3px", background: "transparent", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, fontWeight: 600, padding: "7px 12px", borderRadius: 5, fontFamily: "inherit", cursor: "pointer" }}>Generate new key</button>
    </div>
  );
}

function SettingsBillingPage({ navigate }: { navigate: (k: PageKey) => void }) {
  return (
    <div>
      <BackRow label="Settings" onClick={() => navigate("settings")} />
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 5px" }}>Billing</h1>
      <p style={{ color: "var(--text-dim)", fontSize: 12.5, lineHeight: 1.5, margin: "0 0 16px" }}>View your plan, usage, and payment details.</p>
      <Card header="Current plan">
        <div style={{ padding: "0 8px" }}>
          <div style={{ borderTop: "none" }}>
            <DeployRow label="Plan" value="Free" />
          </div>
          <DeployRow label="Renews" value="—" />
        </div>
      </Card>
      <Card>
        <div style={{ padding: "0 8px" }}>
          <div style={{ borderTop: "none" }}>
            <ChevRow>Payment methods</ChevRow>
          </div>
          <ChevRow>Invoices</ChevRow>
          <ChevRow>Upgrade plan</ChevRow>
        </div>
      </Card>
    </div>
  );
}

function SettingsTeamPage({ navigate }: { navigate: (k: PageKey) => void }) {
  return (
    <div>
      <BackRow label="Settings" onClick={() => navigate("settings")} />
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 5px" }}>Team members</h1>
      <p style={{ color: "var(--text-dim)", fontSize: 12.5, lineHeight: 1.5, margin: "0 0 16px" }}>Manage who has access to this workspace.</p>
      <Card header="Members (1)">
        <div>
          <StatusRow dot="#2fa84f" name="Kingsley (You)" sub="kingsley@••••.dev" value="Owner" />
        </div>
      </Card>
      <button style={{ margin: "0 3px", background: "transparent", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, fontWeight: 600, padding: "7px 12px", borderRadius: 5, fontFamily: "inherit", cursor: "pointer" }}>Invite member</button>
    </div>
  );
}

/* ─── Main dashboard ─── */
export default function DashboardPage() {
  const [page, setPage] = useState<PageKey>("home");
  const [light, setLight] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState<"mobile" | "desktop" | null>(null);
  const [wsOpen, setWsOpen] = useState(false);
  const [projOpen, setProjOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const navigate = useCallback((k: PageKey) => {
    setPage(k);
    setNavOpen(false);
    setWsOpen(false);
    setProjOpen(false);
    setNotifOpen(null);
  }, []);

  /* close all dropdowns on outside click */
  useEffect(() => {
    const handler = () => {
      setWsOpen(false);
      setProjOpen(false);
      setNotifOpen(null);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  /* keyboard shortcuts */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSearchOpen(false);
        setNotifOpen(null);
        setWsOpen(false);
        setProjOpen(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const topNavKey = page.startsWith("settings") ? "settings" : page;

  const css = `
    :root {
      --bg: #1D1918; --panel: #262221; --border: #4a423c;
      --text: #f2efec; --text-dim: #9b9490; --text-faint: #6f6a67;
      --blue: #2f6fed; --green: #2fa84f; --orange: #e8823c; --red: #e5484d;
      --free-badge-bg: #3a2f1e; --free-badge-text: #d9a44a; --icon-muted: #9c8a6b;
    }
    .db-light {
      --bg: #f4f1ec; --panel: #e8e2d7; --border: #d2c8b8;
      --text: #221d19; --text-dim: #6b6157; --text-faint: #8c8172;
      --free-badge-bg: #fbe3b5; --free-badge-text: #8a5a12; --icon-muted: #7d6a49;
    }
    .db-root * { box-sizing: border-box; }
    .db-root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; font-size: 12.5px; background: var(--bg); color: var(--text); min-height: 100vh; }
    .db-nav-item:hover { background: var(--panel) !important; color: var(--text) !important; font-weight: 700 !important; }
    .db-nav-item:hover svg { stroke: var(--text) !important; }
    .db-content {
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .db-content::-webkit-scrollbar { display: none; }
    @media (min-width: 900px) {
      .db-mobile-only { display: none !important; }
      .db-desktop-layout {
        display: grid !important;
        grid-template-columns: ${collapsed ? "64px" : "195px"} 1fr;
        grid-template-rows: auto auto 1fr;
        grid-template-areas: "topbar topbar" "crumb crumb" "nav main";
        height: 100vh;
        overflow: hidden;
      }
      .db-topbar { grid-area: topbar; }
      .db-crumbbar { grid-area: crumb; }
      .db-sidebar {
        grid-area: nav;
        display: block !important;
        border-right: 1px solid var(--border);
        padding-top: 10px;
        width: ${collapsed ? "64px" : "195px"};
        transition: width 0.2s ease;
        overflow-y: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      .db-sidebar::-webkit-scrollbar { display: none; }
      .db-content {
        grid-area: main;
        width: 100%;
        max-width: 100% !important;
        padding: 36px 36px 48px 36px !important;
        overflow-y: auto;
        height: 100%;
      }
      .db-desktop-search { display: flex !important; }
      .db-desktop-right { display: flex !important; }
      .db-desktop-collapse-btn { display: flex !important; }
    }
    @media (max-width: 899px) {
      .db-desktop-only { display: none !important; }
      .db-desktop-collapse-btn { display: none !important; }
      .db-sidebar { display: ${navOpen ? "block" : "none"} !important; }
    }
  `;

  return (
    <>
      <style>{css}</style>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} onNavigate={navigate} />

      <div className={`db-root db-desktop-layout${light ? " db-light" : ""}`}>
        {/* ── Top toolbar ── */}
        <div
          className="db-topbar"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "11px 16px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg)",
            position: "relative",
            zIndex: 2,
          }}
        >
          {/* Mobile left */}
          <div className="db-mobile-only" style={{ display: "flex", gap: 10, alignItems: "center", color: "var(--text-dim)" }}>
            <span onClick={() => setNavOpen((v) => !v)} style={{ cursor: "pointer", display: "flex" }}>
              <Icon size={16}>{navOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 6h16M4 12h16M4 18h16" />}</Icon>
            </span>
            <span onClick={() => setSearchOpen(true)} style={{ cursor: "pointer", display: "flex" }}>
              <Icon size={16}>
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </Icon>
            </span>
          </div>

          {/* Desktop left collapse button + search */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, maxWidth: 460 }}>
            <button
              className="db-desktop-collapse-btn"
              onClick={() => setCollapsed((v) => !v)}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              style={{
                display: "none",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: 6,
                color: "var(--text-dim)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <Icon size={16}>
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18" />
              </Icon>
            </button>

            {/* Desktop search bar */}
            <div
              className="db-desktop-search"
              onClick={() => setSearchOpen(true)}
              style={{
                display: "none",
                alignItems: "center",
                gap: 9,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "9px 12px",
                flex: 1,
                cursor: "pointer",
              }}
            >
              <Icon size={15}>
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </Icon>
              <span style={{ color: "var(--text-faint)", fontSize: 12.5, flex: 1 }}>Search workspace or use cmd + k</span>
              <span style={{ color: "var(--text-faint)", fontSize: 10.5, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 5, padding: "2px 6px" }}>⌘K</span>
            </div>
          </div>

          {/* Right controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--text-dim)" }}>
            {/* Notifications */}
            <div style={{ position: "relative" }}>
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setNotifOpen((v) => (v ? null : "desktop"));
                  setWsOpen(false);
                  setProjOpen(false);
                }}
                style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}
              >
                <div style={{ position: "relative", display: "flex" }}>
                  <Icon size={16}>
                    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
                  </Icon>
                  <span
                    style={{
                      position: "absolute",
                      top: -4,
                      right: -5,
                      background: "#e5484d",
                      color: "#fff",
                      fontSize: 8,
                      fontWeight: 700,
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    2
                  </span>
                </div>
                <span className="db-desktop-only">Notifications</span>
              </div>
              <NotifPanel id="notifPanel" open={notifOpen !== null} onClose={() => setNotifOpen(null)} />
            </div>

            {/* Theme toggle */}
            <span onClick={() => setLight((v) => !v)} style={{ cursor: "pointer", display: "flex" }}>
              <Icon size={16}>
                {light ? (
                  <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />
                ) : (
                  <>
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                  </>
                )}
              </Icon>
            </span>
          </div>
        </div>

        {/* ── Crumb / account bar ── */}
        <div className="db-crumbbar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 16px", borderBottom: "1px solid var(--border)", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, flex: 1, overflow: "hidden" }}>
            {/* Workspace switcher */}
            <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => {
                  setWsOpen((v) => !v);
                  setProjOpen(false);
                  setNotifOpen(null);
                }}
                style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", background: "none", border: "none", padding: 0, fontFamily: "inherit", color: "inherit" }}
              >
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: "linear-gradient(135deg,#4a4440,#28231f)", flexShrink: 0 }} />
                <span style={{ fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120 }}>
                  Kingsley&apos;s Organization
                </span>
                <span style={{ background: "var(--free-badge-bg)", color: "var(--free-badge-text)", fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 999, flexShrink: 0 }}>
                  Free
                </span>
                <span style={{ color: "var(--text-faint)", display: "flex" }}>
                  <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" width={11} height={11}>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
              </button>
              <WorkspaceSwitcher open={wsOpen} onClose={() => setWsOpen(false)} onNavigate={navigate} />
            </div>

            <span style={{ color: "var(--text-faint)", fontSize: 12.5, flexShrink: 0 }}>/</span>

            {/* Project switcher */}
            <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => {
                  setProjOpen((v) => !v);
                  setWsOpen(false);
                  setNotifOpen(null);
                }}
                style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", background: "none", border: "none", padding: 0, fontFamily: "inherit", color: "inherit" }}
              >
                <span style={{ color: "var(--text-dim)", fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 90 }}>
                  Kingsley&apos;s Project
                </span>
                <span style={{ color: "var(--text-faint)", display: "flex" }}>
                  <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" width={11} height={11}>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
              </button>
              <ProjectSwitcher open={projOpen} onClose={() => setProjOpen(false)} />
            </div>

            <span style={{ color: "var(--text-faint)", fontSize: 12.5, flexShrink: 0 }}>/</span>
            <span style={{ color: "var(--text-dim)", fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120 }}>{CRUMBS[page]}</span>
          </div>

          {/* Right: Production btn + Create */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <button
              className="db-desktop-only"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--text)",
                fontSize: 12.5,
                fontWeight: 600,
                padding: "8px 12px",
                borderRadius: 7,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              Production{" "}
              <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" width={12} height={12}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            <div style={{ display: "flex", alignItems: "stretch", background: "var(--green)", borderRadius: 5, overflow: "hidden", flexShrink: 0 }}>
              <button style={{ background: "transparent", color: "#fff", border: "none", display: "flex", alignItems: "center", justifyContent: "center", padding: "6px 9px", cursor: "pointer" }}>
                <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" width={14} height={14}>
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span className="db-desktop-only" style={{ fontSize: 12.5, fontWeight: 600, marginLeft: 4 }}>
                  Create
                </span>
              </button>
              <button
                style={{
                  background: "transparent",
                  color: "#fff",
                  border: "none",
                  borderLeft: "1px solid rgba(255,255,255,0.3)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "6px 7px",
                  cursor: "pointer",
                }}
              >
                <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" width={11} height={11}>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* ── Sidebar nav ── */}
        <div className="db-sidebar" style={{ display: "none", background: "var(--bg)" }}>
          <div style={{ padding: "0 8px" }}>
            {NAV.map((n) => (
              <div
                key={n.key}
                className="db-nav-item"
                onClick={() => navigate(n.key)}
                title={collapsed ? n.label : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: collapsed ? "center" : "flex-start",
                  gap: collapsed ? 0 : 12,
                  padding: collapsed ? "10px 0" : "10px 12px",
                  borderRadius: 8,
                  margin: "1px 0",
                  color: topNavKey === n.key ? "var(--text)" : "var(--text-dim)",
                  background: topNavKey === n.key ? "var(--panel)" : "transparent",
                  fontWeight: topNavKey === n.key ? 700 : 400,
                  fontSize: 13,
                  cursor: "pointer",
                  transition: "background .15s ease, color .15s ease",
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  width={17}
                  height={17}
                  stroke={topNavKey === n.key ? "var(--text)" : "var(--icon-muted)"}
                  strokeWidth="1.6"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ flexShrink: 0 }}
                >
                  {getNavIcon(n.key)}
                </svg>
                {!collapsed && <span>{n.label}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* ── Main content ── */}
        <div className="db-content" style={{ padding: "8px 3px 0", overflowY: "auto", scrollbarWidth: "none" }}>
          {page === "home" && <HomePage />}
          {page === "simulator" && <SimulatorPage />}
          {page === "virtualenv" && <VirtualEnvPage />}
          {page === "activity" && <ActivityPage />}
          {page === "wallets" && <WalletsPage />}
          {page === "contracts" && <ContractsPage />}
          {page === "alerts" && <AlertsPage />}
          {page === "docs" && <DocsPage />}
          {page === "settings" && <SettingsPage navigate={navigate} />}
          {page === "settings-profile" && <SettingsProfilePage navigate={navigate} />}
          {page === "settings-notifications" && <SettingsNotificationsPage navigate={navigate} />}
          {page === "settings-apikeys" && <SettingsApiKeysPage navigate={navigate} />}
          {page === "settings-billing" && <SettingsBillingPage navigate={navigate} />}
          {page === "settings-team" && <SettingsTeamPage navigate={navigate} />}
        </div>
      </div>
    </>
  );
}
