"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AddressLink, LedgerLink, TxHashLink } from "@/components/explorer/entity-links";
import { truncateEntity } from "@/lib/explorer-routes";
import { api } from "@/lib/api";
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
  | "transactions"
  | "wallets"
  | "contracts"
  | "ledgers"
  | "simulator"
  | "virtualenv"
  | "activity"
  | "alerts"
  | "docs"
  | "settings"
  | "settings-profile"
  | "settings-notifications"
  | "settings-apikeys"
  | "settings-billing"
  | "settings-team";

type WorkspaceOrganization = {
  id: string;
  slug: string;
  name: string | null;
  is_personal: boolean;
};

type WorkspaceProject = {
  id: string;
  slug: string;
  name: string;
  network: "mainnet" | "testnet" | "futurenet";
};

type Paged<T> = { data: T[] };

type StoredWorkspace = {
  organization: string;
  project: string;
  network: WorkspaceProject["network"];
};

const ACTIVE_WORKSPACE_KEY = "releeve-active-workspace";

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
    case "transactions":
      return (
        <>
          <path d="M7 10l-3 4 3 4" />
          <path d="M4 14h8" />
          <path d="M17 14l3-4-3-4" />
          <path d="M20 10h-8" />
        </>
      );
    case "ledgers":
      return (
        <>
          <path d="M12 3l8 4-8 4-8-4 8-4z" />
          <path d="M4 11l8 4 8-4" />
          <path d="M4 15l8 4 8-4" />
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
  { key: "alerts", label: "Alerts" },
  { key: "docs", label: "Documentation" },
  { key: "settings", label: "Settings" },
];

const EXPLORER_NAV: Array<{ key: PageKey; label: string }> = [
  { key: "transactions", label: "Transactions" },
  { key: "wallets", label: "Wallets" },
  { key: "contracts", label: "Contracts" },
  { key: "ledgers", label: "Ledgers" },
];

const ALL_NAV = [...EXPLORER_NAV, ...NAV];

const CRUMBS: Record<PageKey, string> = {
  home: "Home",
  transactions: "Explore / Transactions",
  wallets: "Explore / Wallets",
  contracts: "Explore / Contracts",
  ledgers: "Explore / Ledgers",
  simulator: "Simulator",
  virtualenv: "Virtual Environment",
  activity: "Activity",
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
    <div ref={containerRef} style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 3, height: 200 }}>
      {heights.map((h, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            alignSelf: "stretch",
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-end",
          }}
        >
          <div
            style={{
              width: "50%",
              minWidth: 2,
              borderRadius: 0,
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
        </div>
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
function WorkspaceSwitcher({
  open,
  onClose,
  organizations,
  activeOrganization,
  onSelect,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  organizations: WorkspaceOrganization[];
  activeOrganization: string | null;
  onSelect: (organization: WorkspaceOrganization) => void;
  onCreate: () => void;
}) {
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
        Workspaces
      </div>
      {organizations.length === 0 && <div style={{ padding: "2px 14px 12px", color: "var(--text-faint)", fontSize: 12 }}>No workspace is available yet.</div>}
      {organizations.map((organization) => (
        <button
          key={organization.id}
          type="button"
          onClick={() => { onSelect(organization); onClose(); }}
          style={{ display: "flex", width: "calc(100% - 12px)", alignItems: "center", gap: 9, padding: "9px 8px", margin: "0 6px 6px", border: 0, borderRadius: 8, background: organization.slug === activeOrganization ? "var(--bg)" : "transparent", color: "var(--text)", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
        >
          <div style={{ width: 22, height: 22, borderRadius: "50%", background: "linear-gradient(135deg,#4a4440,#28231f)", flexShrink: 0 }} />
          <span style={{ fontWeight: 600, fontSize: 12.5, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{organization.name || organization.slug}</span>
          {organization.is_personal && <span style={{ background: "var(--free-badge-bg)", color: "var(--free-badge-text)", fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 999 }}>Personal</span>}
        </button>
      ))}
      <div style={{ borderTop: "1px solid var(--border)", margin: "2px 0" }} />
      <button type="button" onClick={onCreate} style={{ display: "flex", width: "100%", alignItems: "center", gap: 9, padding: "11px 14px", border: 0, background: "transparent", fontFamily: "inherit", fontSize: 12.5, color: "var(--text-dim)", cursor: "pointer", textAlign: "left" }}>
        <Icon size={15}>
          <path d="M12 5v14M5 12h14" />
        </Icon>{" "}
        New workspace
      </button>
    </div>
  );
}

function ProjectSwitcher({
  open,
  projects,
  activeProject,
  onSelect,
  onCreate,
}: {
  open: boolean;
  projects: WorkspaceProject[];
  activeProject: string | null;
  onSelect: (project: WorkspaceProject) => void;
  onCreate: () => void;
}) {
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
      {projects.length === 0 && <div style={{ padding: "2px 14px 12px", color: "var(--text-faint)", fontSize: 12 }}>No project is available yet.</div>}
      {projects.map((project) => (
        <button key={project.id} type="button" onClick={() => onSelect(project)} style={{ display: "flex", width: "calc(100% - 12px)", alignItems: "center", gap: 9, padding: "9px 8px", margin: "0 6px 6px", border: 0, borderRadius: 8, background: project.slug === activeProject ? "var(--bg)" : "transparent", color: "var(--text)", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
          <span style={{ fontWeight: 600, fontSize: 12.5, flex: 1 }}>{project.name}</span>
          <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{project.network}</span>
        </button>
      ))}
      <div style={{ borderTop: "1px solid var(--border)", margin: "2px 0" }} />
      <button type="button" onClick={onCreate} style={{ display: "flex", width: "100%", alignItems: "center", gap: 9, padding: "11px 14px", border: 0, background: "transparent", fontFamily: "inherit", fontSize: 12.5, color: "var(--text-dim)", cursor: "pointer", textAlign: "left" }}>
        <Icon size={15}>
          <path d="M12 5v14M5 12h14" />
        </Icon>{" "}
        New project
      </button>
    </div>
  );
}

/* ─── Stellar logo + network switcher ─── */
function StellarLogo({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" style={{ display: "block", flexShrink: 0 }}>
      <path d="M12 2c.9 2.2 2.5 4.8 5 6-2.5 1.2-4.1 3.8-5 6-.9-2.2-2.5-4.8-5-6 2.5-1.2 4.1-3.8 5-6z" />
      <path d="M22 12c-2.2-.9-4.8-2.5-6-5-1.2 2.5-3.8 4.1-6 5 2.2.9 4.8 2.5 6 5 1.2-2.5 3.8-4.1 6-5z" />
      <path d="M12 22c.9-2.2 2.5-4.8 5-6-2.5-1.2-4.1-3.8-5-6-.9 2.2-2.5 4.8-5 6 2.5 1.2 4.1 3.8 5 6z" />
      <path d="M2 12c2.2.9 4.8 2.5 6 5 1.2-2.5 3.8-4.1 6-5-2.2-.9-4.8-2.5-6-5-1.2 2.5-3.8 4.1-6 5z" />
    </svg>
  );
}

function NetworkMenu({
  id,
  open,
  network,
  onSelect,
}: {
  id: string;
  open: boolean;
  network: "mainnet" | "testnet" | "futurenet";
  onSelect: (n: "mainnet" | "testnet" | "futurenet") => void;
}) {
  if (!open) return null;
  const networks: Array<{ key: "mainnet" | "testnet" | "futurenet"; label: string }> = [
    { key: "mainnet", label: "Mainnet" },
    { key: "testnet", label: "Testnet" },
    { key: "futurenet", label: "Futurenet" },
  ];
  return (
    <div
      id={id}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        right: 0,
        width: 200,
        maxWidth: "80vw",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 20px 50px rgba(0,0,0,.5)",
        zIndex: 160,
        overflow: "hidden",
      }}
    >
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-faint)", padding: "12px 14px 6px" }}>
        Network
      </div>
      {networks.map((n) => (
        <div
          key={n.key}
          onClick={() => onSelect(n.key)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 14px",
            cursor: "pointer",
            fontWeight: network === n.key ? 700 : 400,
            color: network === n.key ? "var(--text)" : "var(--text-dim)",
            fontSize: 13,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: network === n.key ? "var(--green)" : "var(--text-faint)", flexShrink: 0, display: "inline-block" }} />
          {n.label}
          {network === n.key && (
            <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" fill="none" width={12} height={12} style={{ marginLeft: "auto" }}>
              <path d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── Search modal ─── */
function SearchModal({ open, onClose, onNavigate }: { open: boolean; onClose: () => void; onNavigate: (k: PageKey) => void }) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const results = ALL_NAV.filter((n) => n.label.toLowerCase().includes(q.toLowerCase()));

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
  const [tab2, setTab2] = useState("transactions");
  const [filter, setFilter] = useState("all");
  const address = DEMO_ACCOUNTS.alpha;
  const rows = [
    { hash: "0x46fc3388…133c", from: "0x4838b1…5f97", to: "0xc5cf86…cbf4", value: "0.008 ETH" },
    { hash: "0xfcda611d…69e0", from: "0x6a5ac5…81f7", to: "0xbdb3ba…47b6", value: "0 ETH" },
    { hash: "0x2c7c9a7f…c4de", from: "0xc83b29…917c", to: "0x51c728…2a7f", value: "-" },
    { hash: "0x6aa83224…ee2c", from: "0x4c1aed…d308", to: "0x51c728…2a7f", value: "-" },
    { hash: "0xed269eeb…bd2a", from: "0x4e0fb9…8dd1", to: "0x51c728…2a7f", value: "-" },
    { hash: "0xf531a4f1…c932", from: "0xd6f456…667c", to: "0x51c728…2a7f", value: "-" },
    { hash: "0xc09641e0…6172", from: "0xfc9928…e535", to: "0xe25362…bdd9", value: "-" },
    { hash: "0x977bdc8f…7f9f", from: "0x4838b1…5f97", to: "0xf5cefd…22bd", value: "0.017 ETH" },
    { hash: "0x78758e03…c646", from: "0x6745e1…9395", to: "0xe60fae…347e", value: "-" },
    { hash: "0x454f8f3b…f99b", from: "0xc0ffee…235e", to: "0x8c990e…e46a", value: "0 ETH" },
    { hash: "0x1803406f…2bc9", from: "0x214500…5928", to: "0x214500…5928", value: "-" },
    { hash: "0xb2af9318…c354", from: "0x4838b1…5f97", to: "0x264a70…e914", value: "0 ETH" },
    { hash: "0xef7946de…d42c", from: "0xec4f29…b3aa", to: "0x264a70…e914", value: "-" },
    { hash: "0x2179b8c4…d730", from: "0x8a29f8…9425", to: "0x3361a2…3794", value: "0 ETH" },
    { hash: "0xfe8a43aa…988e", from: "0x255b8a…b322", to: "0xa5e58e…958e", value: "0 ETH" },
    { hash: "0xab1fd36a…8082", from: "0x82c74a…3c9a", to: "0x93c30e…dd17", value: "-" },
    { hash: "0x62d8bfbb…8671", from: "0xd5a809…e285", to: "0x51c728…2a7f", value: "-" },
    { hash: "0xf34dee25…7868", from: "0x242428…9e55", to: "0x93c30e…dd17", value: "-" },
    { hash: "0x80689aa9…8acc", from: "0x33dbbc…e72e", to: "0x149d33…b38e", value: "-" },
    { hash: "0xd5f1a855…1e2f", from: "0xe11ef2…d2fa", to: "0x149d33…b38e", value: "-" },
  ];
  const gradients = [
    "linear-gradient(135deg,#e5484d,#f5d90a)",
    "linear-gradient(135deg,#6e56cf,#12a594)",
    "linear-gradient(135deg,#f5a623,#6e56cf)",
    "linear-gradient(135deg,#2f6fed,#e5484d)",
    "linear-gradient(135deg,#f5d90a,#12a594)",
    "linear-gradient(135deg,#6e56cf,#2f6fed)",
  ];
  const filtered = rows.filter((r) => {
    if (filter === "outgoing") return r.from.startsWith("0x4838b1");
    if (filter === "incoming") return r.to.startsWith("0x4838b1");
    return true;
  });

  return (
    <div className="ex-toolbar">
      <div className="ex-subheader">
        <div className="ex-subheader-left">
          <span className="ex-icon-btn-round">
            <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none">
              <circle cx="5" cy="12" r="1.3" />
              <circle cx="12" cy="12" r="1.3" />
              <circle cx="19" cy="12" r="1.3" />
            </svg>
          </span>
          <span className="ex-crumb">Wallet</span>
          <span className="ex-crumb-sep">/</span>
          <span className="ex-crumb-light ex-monospace">{truncateEntity(address, 10, 6)}</span>
          <span className="ex-icon-btn">
            <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none">
              <rect x="9" y="9" width="11" height="11" rx="1.5" />
              <path d="M5 15V6a1 1 0 0 1 1-1h9" />
            </svg>
          </span>
        </div>
        <div className="ex-subheader-right">
          <button className="btn-ex btn-ex-outline">
            <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none">
              <circle cx="6" cy="12" r="2.5" />
              <circle cx="18" cy="6" r="2.5" />
              <circle cx="18" cy="18" r="2.5" />
              <path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4" />
            </svg>{" "}
            Share
          </button>
          <button className="btn-ex btn-ex-outline">
            <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.7 21a2 2 0 0 1-3.4 0" />
            </svg>{" "}
            Create Alert
          </button>
          <button className="btn-ex btn-ex-outline">
            <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none">
              <path d="M12 5v14M5 12h14" />
              <rect x="3" y="3" width="7" height="7" rx="1" />
            </svg>{" "}
            Add to Project
          </button>
          <button className="btn-ex btn-ex-outline">
            <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none">
              <path d="M4 8V6a2 2 0 0 1 2-2h2M20 8V6a2 2 0 0 0-2-2h-2M4 16v2a2 2 0 0 0 2 2h2M20 16v2a2 2 0 0 1-2 2h-2" />
              <circle cx="12" cy="12" r="3" />
            </svg>{" "}
            Impersonate
          </button>
          <button className="btn-ex btn-ex-purple">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>{" "}
            Simulate
          </button>
        </div>
      </div>

      <div className="ex-stat-row">
        {[
          { label: "Network", value: <><span className="ex-sw-net-dot" />Mainnet</> },
          { label: "ETH balance", value: <>8.871 ETH</> },
          { label: "ETH dollar value", value: <>$16,523.99</> },
          { label: "Token holdings", value: <>$12,222.73 <span className="sub">835 tokens</span> <span className="sub">›</span></> },
          { label: "XLM balance", value: <>1,204.50 <span className="sub">XLM</span></> },
        ].map((s) => (
          <div key={s.label} className="ex-sw-item">
            <span className="ex-sw-label">{s.label}</span>
            <span className="ex-sw-value">{s.value}</span>
          </div>
        ))}
      </div>

      <div className="ex-tabs-row2">
        {[
          { key: "transactions", label: "Transactions" },
          { key: "simulations", label: "Simulations" },
        ].map((t) => (
          <div key={t.key} className={`ex-tab2${tab2 === t.key ? " active" : ""}`} onClick={() => setTab2(t.key)}>
            {t.label}
          </div>
        ))}
      </div>

      {tab2 === "transactions" && (
        <>
          <div className="ex-filter-row">
            {[
              { key: "all", label: "All" },
              { key: "outgoing", label: "Outgoing" },
              { key: "incoming", label: "Incoming" },
              { key: "token", label: "Token asset transfers" },
              { key: "contract", label: "Contract invocations" },
            ].map((f) => (
              <div key={f.key} className={`ex-filter-chip${filter === f.key ? " active" : ""}`} onClick={() => setFilter(f.key)}>
                {f.label}
              </div>
            ))}
          </div>

          <div className="ex-table-wrap">
            <table className="ex-wtable">
              <thead>
                <tr>
                  <th>Tx Hash</th>
                  <th>Status</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Function</th>
                  <th>ETH Value</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <div className="ex-tx-hash">{r.hash}</div>
                    </td>
                    <td>
                      <span className="status-ok" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--green)" }}>
                        <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" fill="none"><path d="M5 13l4 4L19 7" /></svg>Success
                      </span>
                    </td>
                    <td>
                      <span className="ex-gradient-icon" style={{ background: gradients[i % gradients.length] }} />
                      <span className="addr-link" style={{ color: "var(--text)", textDecoration: "underline", textDecorationColor: "var(--border)", textUnderlineOffset: 2 }}>{r.from}</span>
                    </td>
                    <td>
                      <span className="ex-gradient-icon" style={{ background: gradients[(i + 3) % gradients.length] }} />
                      <span className="addr-link" style={{ color: "var(--text)", textDecoration: "underline", textDecorationColor: "var(--border)", textUnderlineOffset: 2 }}>{r.to}</span>
                    </td>
                    <td style={{ color: "var(--text-faint)", fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace" }}>-</td>
                    <td style={{ color: r.value === "-" || r.value === "0 ETH" ? "var(--text-dim)" : "var(--text)", fontWeight: 600 }}>{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ex-pagination-row">
            <div className="ex-per-page">
              <select>
                <option>20</option>
              </select>{" "}
              per page
            </div>
            <div className="ex-page-nav">
              <span className="ex-page-num">1</span>
              <button className="ex-page-btn" disabled>
                <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none"><path d="M15 6l-6 6 6 6" /></svg> Back
              </button>
              <button className="ex-page-btn">
                Next <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none"><path d="M9 6l6 6-6 6" /></svg>
              </button>
            </div>
          </div>
        </>
      )}

      {tab2 === "simulations" && (
        <div style={{ paddingTop: 18 }}>
          <p style={{ color: "var(--text-dim)", fontSize: 13 }}>No simulations run for this account yet.</p>
        </div>
      )}
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

function TransactionsPage() {
  const [tab, setTab] = useState("summary");
  const [dev, setDev] = useState(true);
  const tx = DEMO_TRANSACTIONS[0];
  const [traceFilter, setTraceFilter] = useState("All");

  return (
    <div className="ex-toolbar">
      <div className="ex-subheader">
        <div className="ex-subheader-left">
          <span className="ex-crumb-light">Transaction</span>
          <span className="ex-share-item">
            <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none">
              <circle cx="6" cy="12" r="2.5" />
              <circle cx="18" cy="6" r="2.5" />
              <circle cx="18" cy="18" r="2.5" />
              <path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4" />
            </svg>{" "}
            Share
          </span>
          <span className="ex-icon-btn">
            <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none">
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
            </svg>
          </span>
        </div>
        <div className="ex-subheader-right">
          <div className="ex-dev-toggle" style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 6 }}>
            <span
              onClick={() => setDev((v) => !v)}
              style={{ width: 34, height: 19, borderRadius: 999, background: dev ? "var(--green)" : "var(--border)", position: "relative", display: "inline-block", cursor: "pointer", flexShrink: 0 }}
            >
              <span style={{ position: "absolute", top: 2, left: dev ? 17 : 2, width: 15, height: 15, borderRadius: "50%", background: "#fff", display: "block", transition: "left .2s" }} />
            </span>
            <span className="ex-dev-label" style={{ fontSize: 12.5, color: "var(--text-dim)" }}>Dev mode</span>
          </div>
          <button className="btn-ex btn-ex-outline">
            <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none">
              <path d="M6 3v4M6 7a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v3M14 21v-4M18 21l-4-4-4 4" />
            </svg>{" "}
            Run on Environment
          </button>
          <button className="btn-ex btn-ex-outline">
            <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>{" "}
            Re-Simulate
          </button>
          <button className="btn-ex btn-ex-green">
            <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 1.7-2.4 3.4" />
              <path d="M12 17h.01" />
            </svg>{" "}
            Debug
          </button>
        </div>
      </div>

      {dev && (
        <>
          <div className="ex-detail-grid">
            <div className="ex-detail-col">
              <div className="ex-detail-row"><span className="ex-dl">Hash</span><span className="ex-dv ex-monospace">{truncateEntity(tx.hash, 16, 12)}</span></div>
              <div className="ex-detail-row"><span className="ex-dl">Network</span><span className="ex-dv"><span className="ex-net-dot" />Mainnet</span></div>
              <div className="ex-detail-row">
                <span className="ex-dl">Status</span>
                <span className="ex-dv success">
                  <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" fill="none"><path d="M5 13l4 4L19 7" /></svg> Success
                </span>
              </div>
              <div className="ex-detail-row"><span className="ex-dl">Ledger</span><span className="ex-dv link"><LedgerLink sequence={tx.ledger} network={DEMO_NETWORK} /></span></div>
              <div className="ex-detail-row"><span className="ex-dl">Timestamp</span><span className="ex-dv">a few seconds ago (08/08/2026)</span></div>
              <div className="ex-detail-row"><span className="ex-dl">Source account</span><span className="ex-dv link ex-monospace"><AddressLink address={tx.from} network={DEMO_NETWORK} /></span></div>
              <div className="ex-detail-row"><span className="ex-dl">Destination account</span><span className="ex-dv link ex-monospace"><AddressLink address={tx.to} network={DEMO_NETWORK} /></span></div>
            </div>
            <div className="ex-detail-col">
              <div className="ex-detail-row"><span className="ex-dl">Amount</span><span className="ex-dv">{tx.amount}</span></div>
              <div className="ex-detail-row"><span className="ex-dl">Fee charged</span><span className="ex-dv">{tx.fee}</span></div>
              <div className="ex-detail-row"><span className="ex-dl">Operation Type</span><span className="ex-dv">{tx.method === "transfer" ? "payment" : "invoke_host_function"}</span></div>
              <div className="ex-detail-row"><span className="ex-dl">Resource usage</span><span className="ex-dv">0.385 Gwei <span className="dim">(0.00000000039 XLM)</span></span></div>
              <div className="ex-detail-row"><span className="ex-dl">Gas Used</span><span className="ex-dv">21,000 / 21,000 (100%)</span></div>
              <div className="ex-detail-row"><span className="ex-dl">Index</span><span className="ex-dv">283</span></div>
              <div className="ex-detail-row"><span className="ex-dl">Sequence Number</span><span className="ex-dv">5570928</span></div>
            </div>
          </div>

          <div className="ex-tabs-row">
            {[
              { key: "summary", label: "Summary" },
              { key: "contracts", label: "Contracts" },
              { key: "events", label: "Events" },
              { key: "state", label: "State" },
              { key: "fundflow", label: "Fund Flow" },
              { key: "gas", label: "Gas Profiler" },
            ].map((t) => (
              <div
                key={t.key}
                className={`ex-tab${tab === t.key ? " active" : ""}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </div>
            ))}
          </div>

          {tab === "summary" && (
            <>
              <div className="ex-card">
                <div className="ex-card-header-row">
                  <span>Native coin transfers <span className="dim">(1)</span></span>
                  <div className="ex-group-by">
                    <span className="ex-gb-label">Group by:</span>
                    <button className="ex-gb-btn active">Address</button>
                    <button className="ex-gb-btn">Chronologically</button>
                  </div>
                </div>
                <table className="ex-table">
                  <thead>
                    <tr><th>Address</th><th>Token</th><th>Balance change</th><th>Dollar value</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
<span className="ex-addr-icon" style={{ background: "linear-gradient(135deg,#2f6fed,#e5484d)" }} />
                        <span className="ex-addr-link"><AddressLink address={tx.from} network={DEMO_NETWORK} /></span>
                        <span className="ex-tag sender">[Sender]</span>
                      </td>
                      <td><span className="ex-token-ic" />XLM</td>
                      <td className="neg">-0.027 XLM</td>
                      <td className="neg">US$0.27</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="ex-addr-icon" style={{ background: "linear-gradient(135deg,#e8823c,#6e56cf)" }} />
                        <span className="ex-addr-link"><AddressLink address={tx.to} network={DEMO_NETWORK} /></span>
                        <span className="ex-tag receiver">[Receiver]</span>
                      </td>
                      <td><span className="ex-token-ic" />XLM</td>
                      <td className="pos">+0.027 XLM</td>
                      <td className="pos">US$0.27</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="ex-trace-bar">
                <div className="ex-trace-search">
                  <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
                  <input type="text" placeholder="Search" />
                  <select className="ex-trace-select" value={traceFilter} onChange={(e) => setTraceFilter(e.target.value)} style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 11.5, padding: "5px 8px", borderRadius: 6 }}>
                    {["All", "From", "To", "Function", "Contract"].map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="ex-trace-toggles">
                  {["Gas", "Full Trace", "Storage", "Events"].map((l) => (
                    <label key={l}><input type="checkbox" defaultChecked /> {l}</label>
                  ))}
                  <span className="ex-trace-ic-btn"><svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none"><path d="M12 5v14M5 12h14" /></svg></span>
                  <span className="ex-trace-ic-btn"><svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none"><path d="M5 12h14" /></svg></span>
                </div>
              </div>

              <div className="ex-trace-row">
                <span className="ex-call-pill">CALL</span>
                <span className="ex-call-idx">0</span>
                <span className="ex-call-line">
                  (<span className="sender-tag">[Sender]</span>{" "}
                  <span className="addr">{truncateEntity(tx.from, 10, 6)}</span>
                  &nbsp;⇒&nbsp;
                  <span className="receiver-tag">[Receiver]</span>{" "}
                  <span className="addr">{truncateEntity(tx.to, 10, 6)}</span>
                  ).<span className="hex">0x</span>(0x)
                </span>
              </div>
            </>
          )}

          {tab === "contracts" && (
            <div className="ex-card">
              <div className="ex-card-header-row"><span>Contracts involved <span className="dim">(2)</span></span></div>
              <div className="ex-contract-grid">
                {[
                  { name: "Stellar DEX Router", addr: "GATOM…SVVHV", grad: "linear-gradient(135deg,#2f6fed,#6e56cf)", meta: [["Type", "Soroban"], ["Trx count", "1,204"], ["Balance", "25.4 XLM"]] },
                  { name: "Liquidity Pool", addr: "CAKX76…2A7F", grad: "linear-gradient(135deg,#e8823c,#e5484d)", meta: [["Pool", "AMM v2"], ["Trx count", "86"], ["Liquidity", "9.2k"]] },
                ].map((c) => (
                  <div key={c.name} className="ex-contract-card">
                    <div className="ex-cc-head">
                      <span className="ex-cc-icon" style={{ background: c.grad }} />
                      <div>
                        <div className="ex-cc-name">{c.name}</div>
                        <div className="ex-cc-type ex-monospace">{c.addr}</div>
                      </div>
                    </div>
                    <div className="ex-cc-meta">
                      {c.meta.map(([k, v]) => (
                        <div key={k}>{k}<b>{v}</b></div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "events" && (
            <div className="ex-card">
              <div className="ex-card-header-row"><span>Operation events <span className="dim">(6)</span></span></div>
              {[
                { name: "payment", sub: "txn set · success", data: `from ${truncateEntity(tx.from, 8, 4)} · to ${truncateEntity(tx.to, 8, 4)} · amount ${tx.amount}` },
                { name: "account_created", sub: "new account", data: "account GCH…IQ · starting balance 0.001 XLM · seq 5570929" },
                { name: "trustline_added", sub: "USDC issuer", data: "asset USDC:G…FIZ · limit 100,000.00" },
              ].map((ev, i) => (
                <div key={i} className="ex-event-item">
                  <span className="ex-event-idx">{i}</span>
                  <div className="ex-event-body">
                    <div className="ex-event-name">{ev.name} <span className="sub-name">{ev.sub}</span></div>
                    <div className="ex-event-data ex-monospace">{ev.data}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "state" && (
            <div className="ex-card">
              <div className="ex-card-header-row"><span>Post-transaction state <span className="dim">(3)</span></span></div>
              <table className="ex-table">
                <thead><tr><th>Key</th><th>Value</th><th>Type</th></tr></thead>
                <tbody>
                  {[
                    ["seq_num", "5570928 → 5570929", "Uint64", false],
                    ["balance", "8.871 → 8.844 XLM", "Int64 (stroops)", true],
                    ["flags", "0x00000002", "Uint32", false],
                  ].map(([k, v, ty, neg], i) => (
                    <tr key={i}>
                      <td className="ex-monospace">{k}</td>
                      <td className={`ex-monospace${neg ? " neg" : ""}`}>{v}</td>
                      <td>{ty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "fundflow" && (
            <div className="ex-card">
              <div className="ex-card-header-row"><span>Fund flow <span className="dim">(1 hop)</span></span></div>
              <div className="ex-flow-wrap">
                <div className="ex-flow-node src">
                  <span className="ex-flow-tag">Source account</span>
                  <div className="addr ex-monospace">{truncateEntity(tx.from, 10, 6)}</div>
                  <div className="bal">−0.027 XLM</div>
                </div>
                <div className="ex-flow-edge">
                  <span className="ex-flow-amount">{tx.amount} · payment</span>
                  <div className="ex-flow-line"></div>
                </div>
                <div className="ex-flow-node dst">
                  <span className="ex-flow-tag">Destination account</span>
                  <div className="addr ex-monospace">{truncateEntity(tx.to, 10, 6)}</div>
                  <div className="bal">+0.027 XLM</div>
                </div>
              </div>
            </div>
          )}

          {tab === "gas" && (
            <div className="ex-card">
              <div className="ex-card-header-row"><span>Fee / resource usage <span className="dim">(100%)</span></span></div>
              <div className="ex-gas-list">
                {[
                  ["Inclusion fee", "· base 0.001 XLM", "0.001 XLM", "20%", "var(--green)"],
                  ["Operations", "· 1 op", "1", "35%", "var(--orange)"],
                  ["Ledger entries touched", "· accounts", "4", "55%", "var(--purple)"],
                ].map(([label, sub, val, w, color], i) => (
                  <div key={i} className="ex-gas-item">
                    <div className="ex-gas-top"><span>{label} <b>{sub}</b></span><span className="ex-monospace">{val}</span></div>
                    <div className="ex-gas-track"><div className="ex-gas-fill" style={{ width: w as string, background: color as string }} /></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LedgersPage() {
  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 5px" }}>Ledgers</h1>
      <p style={{ color: "var(--text-dim)", fontSize: 12.5, lineHeight: 1.5, margin: "0 0 16px" }}>
        Closed ledgers and their aggregate resource usage.
      </p>
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
  );
}

function AlertsPage() {
  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 5px" }}>Alerts</h1>
      <p style={{ color: "var(--text-dim)", fontSize: 12.5, lineHeight: 1.5, margin: "0 0 16px" }}>Get notified about failed transactions and contract events.</p>
      <Card header="Active alerts">
        <div style={{ padding: "0 8px" }}>
          <div style={{ borderTop: "none" }}>
            <ToggleRow label="Failed transaction" on={true} />
          </div>
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
  const router = useRouter();
  const [page, setPage] = useState<PageKey>("home");
  const [light, setLight] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState<"mobile" | "desktop" | null>(null);
  const [wsOpen, setWsOpen] = useState(false);
  const [projOpen, setProjOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [network, setNetwork] = useState<"mainnet" | "testnet" | "futurenet">("mainnet");
  const [netOpen, setNetOpen] = useState<"production" | "create" | null>(null);
  const [organizations, setOrganizations] = useState<WorkspaceOrganization[]>([]);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [activeOrganization, setActiveOrganization] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<string | null>(null);

  const saveWorkspace = useCallback((workspace: StoredWorkspace) => {
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, JSON.stringify(workspace));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const stored = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
    let remembered: StoredWorkspace | null = null;
    try { remembered = stored ? JSON.parse(stored) as StoredWorkspace : null; } catch { /* ignore corrupt local state */ }

    api.get<WorkspaceOrganization[]>("/api/v1/me/organizations")
      .then((items) => {
        if (cancelled) return;
        setOrganizations(items);
        const selected = items.find((item) => item.slug === remembered?.organization) ?? items[0] ?? null;
        setActiveOrganization(selected?.slug ?? null);
        if (remembered?.network) setNetwork(remembered.network);
      })
      .catch(() => {
        if (!cancelled) {
          setOrganizations([]);
          setActiveOrganization(null);
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!activeOrganization) {
      setProjects([]);
      setActiveProject(null);
      return;
    }
    let cancelled = false;
    const stored = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
    let remembered: StoredWorkspace | null = null;
    try { remembered = stored ? JSON.parse(stored) as StoredWorkspace : null; } catch { /* ignore corrupt local state */ }

    api.get<Paged<WorkspaceProject>>(`/api/v1/${encodeURIComponent(activeOrganization)}/projects?limit=100`)
      .then((response) => {
        if (cancelled) return;
        const items = response.data ?? [];
        setProjects(items);
        const selected = items.find((item) => item.slug === remembered?.project) ?? items[0] ?? null;
        setActiveProject(selected?.slug ?? null);
        if (selected) {
          setNetwork(selected.network);
          saveWorkspace({ organization: activeOrganization, project: selected.slug, network: selected.network });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjects([]);
          setActiveProject(null);
        }
      });
    return () => { cancelled = true; };
  }, [activeOrganization, saveWorkspace]);

  const selectOrganization = useCallback((organization: WorkspaceOrganization) => {
    setActiveOrganization(organization.slug);
    setActiveProject(null);
  }, []);

  const selectProject = useCallback((project: WorkspaceProject) => {
    if (!activeOrganization) return;
    setActiveProject(project.slug);
    setNetwork(project.network);
    saveWorkspace({ organization: activeOrganization, project: project.slug, network: project.network });
    setProjOpen(false);
  }, [activeOrganization, saveWorkspace]);

  const selectNetwork = useCallback((selected: "mainnet" | "testnet" | "futurenet") => {
    setNetwork(selected);
    if (activeOrganization && activeProject) {
      saveWorkspace({ organization: activeOrganization, project: activeProject, network: selected });
    }
  }, [activeOrganization, activeProject, saveWorkspace]);

  const navigate = useCallback((k: PageKey) => {
    const explorerAnchors: Partial<Record<PageKey, string>> = {
      transactions: '#transactions',
      ledgers: '#ledgers',
      wallets: '#search',
      contracts: '#search',
    };
    if (explorerAnchors[k]) {
      router.push(`/explorer/${network}${explorerAnchors[k]}`);
      setNavOpen(false);
      setWsOpen(false);
      setProjOpen(false);
      setNotifOpen(null);
      setNetOpen(null);
      return;
    }
    setPage(k);
    setNavOpen(false);
    setWsOpen(false);
    setProjOpen(false);
    setNotifOpen(null);
    setNetOpen(null);
  }, [network, router]);

  /* close all dropdowns on outside click */
  useEffect(() => {
    const handler = () => {
      setWsOpen(false);
      setProjOpen(false);
      setNotifOpen(null);
      setNetOpen(null);
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
        setNetOpen(null);
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
      --blue: #2f6fed; --green: #2fa84f; --orange: #e8823c; --red: #e5484d; --purple: #6e56cf; --purple-hover: #7c63d8;
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

    /* ── Explorer shared (transaction + account detail) ── */
    .ex-toolbar { position: relative; }
    .ex-subheader { display: flex; align-items: center; justify-content: space-between; padding: 12px 0 14px; border-bottom: 1px solid var(--border); flex-wrap: wrap; gap: 14px; }
    .ex-subheader-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .ex-subheader-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .ex-crumb { font-size: 15px; font-weight: 700; color: var(--text); white-space: nowrap; }
    .ex-crumb-light { font-size: 15px; color: var(--text-dim); white-space: nowrap; }
    .ex-crumb-sep { color: var(--text-faint); }
    .ex-share-item { display: flex; align-items: center; gap: 6px; color: var(--text-dim); font-size: 12.5px; cursor: pointer; flex-shrink: 0; }
    .ex-share-item svg { width: 14px; height: 14px; }
    .ex-share-item:hover { color: var(--text); }
    .ex-icon-btn { display: flex; color: var(--text-dim); cursor: pointer; flex-shrink: 0; }
    .ex-icon-btn svg { width: 16px; height: 16px; }
    .ex-icon-btn:hover { color: var(--text); }
    .ex-icon-btn-round { width: 32px; height: 32px; border-radius: 7px; border: 1px solid var(--border); background: var(--panel); color: var(--text-dim); display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
    .ex-icon-btn-round:hover { color: var(--text); }
    .ex-icon-btn-round svg { width: 15px; height: 15px; }
    .btn-ex { display: inline-flex; align-items: center; gap: 7px; font-family: inherit; font-size: 12.5px; font-weight: 600; padding: 9px 14px; border-radius: 7px; cursor: pointer; white-space: nowrap; }
    .btn-ex svg { width: 14px; height: 14px; }
    .btn-ex-outline { background: var(--panel); border: 1px solid var(--border); color: var(--text); }
    .btn-ex-outline:hover { background: #2e2926; }
    .btn-ex-green { background: var(--green); border: 1px solid var(--green); color: #fff; }
    .btn-ex-green:hover { background: #2fb85a; }
    .btn-ex-purple { background: var(--purple); border: 1px solid var(--purple); color: #fff; }
    .btn-ex-purple:hover { background: var(--purple-hover); }

    .ex-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 60px; padding: 24px 2px 10px; }
    .ex-detail-col { display: flex; flex-direction: column; }
    .ex-detail-row { display: flex; align-items: baseline; gap: 20px; padding: 7px 0; font-size: 13px; }
    .ex-dl { width: 110px; flex-shrink: 0; color: var(--text-faint); }
    .ex-dv { color: var(--text); min-width: 0; }
    .ex-dv.link { color: var(--text); text-decoration: underline; text-decoration-color: var(--border); text-underline-offset: 3px; cursor: pointer; }
    .ex-dv .dim { color: var(--text-faint); }
    .ex-dv.success { color: var(--green); display: flex; align-items: center; gap: 6px; }
    .ex-dv.success svg { width: 13px; height: 13px; }
    .ex-net-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--blue); margin-right: 7px; }

    .ex-tabs-row { position: relative; display: flex; gap: 6px; padding: 20px 2px 0; border-bottom: 1px solid var(--border); }
    .ex-tab { padding: 10px 16px; font-size: 12.5px; color: var(--text-dim); cursor: pointer; border-radius: 7px 7px 0 0; margin-bottom: -1px; position: relative; z-index: 1; transition: color 0.2s ease; }
    .ex-tab.active { color: var(--text); font-weight: 700; border: 1px solid var(--border); border-bottom: 1px solid var(--bg); background: var(--bg); }
    .ex-tab:not(.active):hover { color: var(--text); }

    .ex-card { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; margin: 16px 2px 0; overflow: hidden; }
    .ex-card-header-row { display: flex; align-items: center; justify-content: space-between; padding: 13px 16px; background: var(--panel); border-bottom: 1px solid var(--border); font-size: 13px; font-weight: 700; gap: 10px; }
    .ex-card-header-row .dim { color: var(--text-faint); font-weight: 500; }
    .ex-group-by { display: flex; align-items: center; gap: 8px; font-weight: 500; }
    .ex-gb-label { color: var(--text-faint); font-size: 11.5px; }
    .ex-gb-btn { background: transparent; border: 1px solid var(--border); color: var(--text-dim); font-size: 11.5px; font-family: inherit; padding: 5px 10px; border-radius: 6px; cursor: pointer; }
    .ex-gb-btn.active { background: var(--panel); color: var(--text); border-color: var(--text-faint); }

    .ex-table { width: 100%; border-collapse: collapse; }
    .ex-table th { text-align: left; font-size: 11px; color: var(--text-faint); font-weight: 600; padding: 11px 16px; border-bottom: 1px solid var(--border); background: var(--bg); }
    .ex-table td { padding: 13px 16px; font-size: 12.5px; border-bottom: 1px solid var(--border); color: var(--text-dim); }
    .ex-table tr:last-child td { border-bottom: none; }
    .ex-table td.neg { color: var(--red); }
    .ex-table td.pos { color: var(--green); }
    .ex-addr-icon { display: inline-block; width: 16px; height: 16px; border-radius: 4px; vertical-align: middle; margin-right: 8px; }
    .ex-addr-link { color: var(--text); text-decoration: underline; text-decoration-color: var(--border); text-underline-offset: 2px; }
    .ex-tag { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 5px; margin-left: 8px; }
    .ex-tag.sender { background: rgba(229,72,77,0.15); color: var(--red); }
    .ex-tag.receiver { background: rgba(47,168,79,0.15); color: var(--green); }
    .ex-token-ic { display: inline-flex; width: 14px; height: 14px; border-radius: 4px; background: linear-gradient(135deg,#6b8aff,#2f6fed); vertical-align: middle; margin-right: 6px; }

    .ex-monospace { font-family: ui-monospace,SFMono-Regular,Menlo,monospace; }

    /* trace */
    .ex-trace-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 14px 2px 0; padding: 10px 14px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; flex-wrap: wrap; }
    .ex-trace-search { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 160px; }
    .ex-trace-search svg { width: 14px; height: 14px; color: var(--text-faint); }
    .ex-trace-search input { background: transparent; border: none; outline: none; color: var(--text); font-size: 12.5px; font-family: inherit; flex: 1; }
    .ex-trace-search input::placeholder { color: var(--text-faint); }
    .ex-trace-toggles { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .ex-trace-toggles label { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--text-dim); cursor: pointer; }
    .ex-trace-toggles input[type=checkbox] { accent-color: var(--purple); width: 13px; height: 13px; }
    .ex-trace-ic-btn { width: 22px; height: 22px; border-radius: 5px; border: 1px solid var(--border); background: var(--bg); color: var(--text-dim); display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .ex-trace-row { display: flex; align-items: center; gap: 12px; margin: 10px 2px 0; padding: 12px 14px; border: 1px solid var(--border); border-radius: 8px; font-size: 12px; overflow-x: auto; white-space: nowrap; }
    .ex-call-pill { background: var(--panel); border: 1px solid var(--border); color: var(--text-dim); font-weight: 700; font-size: 11px; padding: 4px 10px; border-radius: 6px; flex-shrink: 0; }
    .ex-call-idx { color: var(--text-faint); flex-shrink: 0; }
    .ex-call-line { font-family: "SFMono-Regular",ui-monospace,Menlo,monospace; color: var(--text-dim); }
    .ex-call-line .sender-tag { color: var(--red); }
    .ex-call-line .receiver-tag { color: var(--green); }
    .ex-call-line .addr { color: var(--text); }
    .ex-call-line .hex { color: var(--orange); text-decoration: underline; text-decoration-style: dotted; }

    /* contracts */
    .ex-contract-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 16px; }
    .ex-contract-card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; }
    .ex-cc-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
    .ex-cc-icon { width: 30px; height: 30px; border-radius: 7px; flex-shrink: 0; }
    .ex-cc-name { font-weight: 700; font-size: 12.5px; color: var(--text); }
    .ex-cc-type { font-size: 11px; color: var(--text-faint); margin-top: 3px; }
    .ex-cc-meta { display: flex; gap: 20px; border-top: 1px solid var(--border); padding-top: 10px; }
    .ex-cc-meta > div { display: flex; flex-direction: column; gap: 3px; font-size: 10.5px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.04em; }
    .ex-cc-meta b { font-size: 12.5px; color: var(--text); text-transform: none; letter-spacing: 0; font-weight: 600; }

    /* events */
    .ex-event-item { display: flex; align-items: flex-start; gap: 14px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
    .ex-event-item:last-child { border-bottom: none; }
    .ex-event-idx { font-size: 10px; color: var(--text-faint); margin-top: 2px; min-width: 12px; }
    .ex-event-body { flex: 1; min-width: 0; }
    .ex-event-name { font-weight: 700; font-size: 12.5px; color: var(--text); }
    .ex-event-name .sub-name { color: var(--text-faint); font-weight: 500; margin-left: 6px; }
    .ex-event-data { font-size: 11.5px; color: var(--text-faint); margin-top: 5px; word-break: break-all; }

    /* fund flow */
    .ex-flow-wrap { display: flex; align-items: center; gap: 18px; padding: 26px 24px 30px; }
    .ex-flow-node { flex: 1; text-align: center; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px 12px; }
    .ex-flow-tag { display: block; font-size: 10.5px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 7px; }
    .ex-flow-node .addr { font-size: 12.5px; color: var(--text); }
    .ex-flow-node.src .addr { color: var(--orange); }
    .ex-flow-node.dst .addr { color: var(--green); }
    .ex-flow-node .bal { margin-top: 7px; font-size: 11.5px; color: var(--text-dim); }
    .ex-flow-edge { flex: 1.3; display: flex; flex-direction: column; align-items: center; gap: 10px; }
    .ex-flow-amount { font-size: 12px; font-weight: 700; color: var(--text); background: rgba(47,168,79,0.12); border: 1px solid var(--border); border-radius: 999px; padding: 5px 14px; white-space: nowrap; }
    .ex-flow-line { position: relative; width: 100%; height: 2px; background: var(--border); border-radius: 2px; }
    .ex-flow-line::after { content: ""; position: absolute; right: -2px; top: -4px; border: 5px solid transparent; border-left: 7px solid var(--green); }

    /* resource profiler */
    .ex-gas-list { display: flex; flex-direction: column; gap: 16px; padding: 18px 20px 20px; }
    .ex-gas-top { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--text-dim); margin-bottom: 7px; }
    .ex-gas-top b { color: var(--text); font-weight: 600; }
    .ex-gas-track { height: 7px; border-radius: 999px; background: var(--panel); overflow: hidden; }
    .ex-gas-fill { height: 100%; border-radius: 999px; }

    /* wallet / account page */
    .ex-gradient-icon { display: inline-block; width: 16px; height: 16px; border-radius: 4px; vertical-align: middle; margin-right: 8px; }
    .ex-stat-row { display: flex; gap: 48px; flex-wrap: wrap; padding: 24px 0 16px; }
    .ex-sw-item { display: flex; flex-direction: column; gap: 8px; }
    .ex-sw-label { font-size: 11.5px; color: var(--text-faint); }
    .ex-sw-value { font-size: 16px; font-weight: 700; color: var(--text); display: flex; align-items: center; gap: 8px; }
    .ex-sw-value .sub { font-weight: 500; color: var(--text-dim); font-size: 13px; }
    .ex-sw-net-dot { width: 16px; height: 16px; border-radius: 5px; background: linear-gradient(135deg,#6b8aff,#2f6fed); flex-shrink: 0; }

    .ex-tabs-row2 { display: flex; gap: 22px; padding: 6px 0 14px; border-bottom: 1px solid var(--border); }
    .ex-tab2 { font-size: 13px; color: var(--text-dim); cursor: pointer; padding-bottom: 10px; margin-bottom: -1px; }
    .ex-tab2.active { color: var(--text); font-weight: 700; border-bottom: 2px solid var(--text); }

    .ex-filter-row { display: flex; gap: 8px; padding: 16px 0; flex-wrap: wrap; }
    .ex-filter-chip { font-size: 12px; color: var(--text-dim); padding: 7px 13px; border-radius: 7px; cursor: pointer; border: 1px solid transparent; }
    .ex-filter-chip.active { background: var(--panel); border-color: var(--border); color: var(--text); font-weight: 600; }
    .ex-filter-chip:not(.active):hover { color: var(--text); }

    .ex-table-wrap { border: 1px solid var(--border); border-radius: 8px; overflow-x: auto; }
    table.ex-wtable { width: 100%; border-collapse: collapse; min-width: 900px; }
    .ex-wtable th { text-align: left; font-size: 11px; color: var(--text-faint); font-weight: 600; padding: 11px 12px; border-bottom: 1px solid var(--border); background: var(--panel); white-space: nowrap; }
    .ex-wtable td { padding: 12px 12px; font-size: 12.5px; border-bottom: 1px solid var(--border); color: var(--text-dim); white-space: nowrap; }
    .ex-wtable tr:last-child td { border-bottom: none; }
    .ex-tx-hash { display: flex; align-items: center; gap: 8px; font-family: "SFMono-Regular",ui-monospace,Menlo,monospace; color: var(--text-dim); }

    .ex-pagination-row { display: flex; align-items: center; justify-content: space-between; padding: 16px 2px 0; }
    .ex-per-page { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-dim); }
    .ex-per-page select { background: var(--panel); border: 1px solid var(--border); color: var(--text); font-size: 12.5px; padding: 6px 10px; border-radius: 6px; font-family: inherit; }
    .ex-page-nav { display: flex; align-items: center; gap: 8px; }
    .ex-page-num { width: 28px; height: 28px; border-radius: 6px; background: var(--panel); border: 1px solid var(--border); color: var(--text); display: flex; align-items: center; justify-content: center; font-size: 12.5px; font-weight: 600; }
    .ex-page-btn { display: flex; align-items: center; gap: 6px; background: transparent; border: 1px solid var(--border); color: var(--text); font-size: 12.5px; font-weight: 600; padding: 7px 12px; border-radius: 6px; cursor: pointer; font-family: inherit; }
    .ex-page-btn svg { width: 13px; height: 13px; }
    .ex-page-btn[disabled] { opacity: 0.4; cursor: default; }

    @media (max-width: 900px) {
      .ex-detail-grid { grid-template-columns: 1fr; gap: 0; }
      .ex-contract-grid { grid-template-columns: 1fr; }
      .ex-stat-row { gap: 28px; }
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
                  {organizations.find((organization) => organization.slug === activeOrganization)?.name || activeOrganization || "Workspace"}
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
              <WorkspaceSwitcher
                open={wsOpen}
                onClose={() => setWsOpen(false)}
                organizations={organizations}
                activeOrganization={activeOrganization}
                onSelect={selectOrganization}
                onCreate={() => router.push("/onboarding")}
              />
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
                  {projects.find((project) => project.slug === activeProject)?.name || activeProject || "Project"}
                </span>
                <span style={{ color: "var(--text-faint)", display: "flex" }}>
                  <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" width={11} height={11}>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
              </button>
              <ProjectSwitcher
                open={projOpen}
                projects={projects}
                activeProject={activeProject}
                onSelect={selectProject}
                onCreate={() => router.push("/onboarding")}
              />
            </div>

            <span style={{ color: "var(--text-faint)", fontSize: 12.5, flexShrink: 0 }}>/</span>
            <span style={{ color: "var(--text-dim)", fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120 }}>{CRUMBS[page]}</span>
          </div>

          {/* Right: network buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <div style={{ position: "relative" }}>
              <button
                className="db-desktop-only"
                onClick={(e) => {
                  e.stopPropagation();
                  setNetOpen((v) => (v === "production" ? null : "production"));
                  setWsOpen(false);
                  setProjOpen(false);
                  setNotifOpen(null);
                }}
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
                <StellarLogo size={13} />
                {network[0].toUpperCase() + network.slice(1)}{" "}
                <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" width={12} height={12}>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              <NetworkMenu
                id="netMenu"
                open={netOpen === "production"}
                network={network}
                onSelect={(n) => {
                  selectNetwork(n);
                  setNetOpen(null);
                }}
              />
            </div>
            <div style={{ position: "relative" }}>
              <div style={{ display: "flex", alignItems: "stretch", background: "var(--green)", borderRadius: 5, overflow: "hidden", flexShrink: 0 }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setNetOpen((v) => (v === "create" ? null : "create"));
                    setWsOpen(false);
                    setProjOpen(false);
                    setNotifOpen(null);
                  }}
                  style={{ background: "transparent", color: "#fff", border: "none", display: "flex", alignItems: "center", justifyContent: "center", padding: "6px 9px", cursor: "pointer" }}
                >
                  <StellarLogo size={14} />
                  <span className="db-desktop-only" style={{ fontSize: 12.5, fontWeight: 600, marginLeft: 7 }}>
                    {network[0].toUpperCase() + network.slice(1)}
                  </span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setNetOpen((v) => (v === "create" ? null : "create"));
                    setWsOpen(false);
                    setProjOpen(false);
                    setNotifOpen(null);
                  }}
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
              <NetworkMenu
                id="createMenu"
                open={netOpen === "create"}
                network={network}
                onSelect={(n) => {
                  selectNetwork(n);
                  setNetOpen(null);
                }}
              />
            </div>
          </div>
        </div>

        <div className="db-sidebar" style={{ display: "none", background: "var(--bg)" }}>
          <div style={{ padding: "0 8px" }}>
            {!collapsed && (
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-faint)", padding: "14px 14px 6px" }}>
                Explorer
              </div>
            )}
            {EXPLORER_NAV.map((n) => (
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
            <div style={{ borderTop: "1px solid var(--border)", margin: "8px 6px" }} />
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
          {page === "transactions" && <TransactionsPage />}
          {page === "wallets" && <WalletsPage />}
          {page === "contracts" && <ContractsPage />}
          {page === "ledgers" && <LedgersPage />}
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
