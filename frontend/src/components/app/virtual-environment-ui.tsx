"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  GitFork,
  RefreshCw,
  Settings2,
  X,
} from "lucide-react";

export type CreateEnvironmentInput = {
  name: string;
  network: "mainnet" | "testnet";
  mode: "frozen" | "follow_latest";
  source: "latest" | "simulation";
  simulation_id?: string;
  public_explorer_enabled: boolean;
  rpc_slug?: string;
};

const veStyles = `
  .ve-overlay { --bg: #121212; --panel: #181818; --panel-2: #1e1e1e; --border: #383c39; --text: #ffffff; --text-dim: #a1a1a1; --text-faint: #707070; --green: #a3ff5f; position: fixed; inset: 0; background: rgba(0,0,0,.7); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 10000; padding: 1rem; isolation: isolate; overscroll-behavior: contain; animation: veFade .2s ease; }
  body:has(.db-light) .ve-overlay { --bg: #f7f8f5; --panel: #ffffff; --panel-2: #eef1ec; --border: #c5cbc4; --text: #101310; --text-dim: #5e655e; --text-faint: #7e857e; --green: #70df35; }
  @keyframes veFade { from { opacity: 0; } to { opacity: 1; } }
  .ve-modal { background: var(--panel); border: 1px solid var(--border); border-radius: 4px; width: 100%; max-width: 570px; max-height: 86vh; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,.6); overflow: hidden; animation: veScale .2s ease; }
  @keyframes veScale { from { transform: scale(.96) translateY(8px); } to { transform: scale(1) translateY(0); } }
  .ve-header { padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .ve-title { font-size: 1rem; font-weight: 500; color: var(--text); display: flex; align-items: center; gap: .625rem; }
  .ve-title svg { width: 18px; height: 18px; color: var(--green); }
  .ve-close { background: transparent; border: none; color: var(--text-faint); cursor: pointer; padding: .375rem; display: flex; align-items: center; justify-content: center; border-radius: 6px; transition: all .15s ease; }
  .ve-close:hover { background: var(--panel); color: var(--text); }
  .ve-body { overflow-y: auto; flex: 1; }
  .ve-body::-webkit-scrollbar { width: 8px; }
  .ve-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
  .ve-section { border-top: 1px solid var(--border); }
  .ve-sechead { padding: .875rem 1.25rem; display: flex; align-items: center; justify-content: space-between; background: var(--panel); cursor: pointer; user-select: none; transition: background .15s ease; }
  .ve-sechead:hover { background: var(--panel-2); }
  .ve-sectitle { font-size: .875rem; font-weight: 600; color: var(--text); display: flex; align-items: center; gap: .5rem; }
  .ve-sectitle svg { width: 14px; height: 14px; color: var(--text-dim); }
  .ve-chevron { width: 16px; height: 16px; color: var(--text-dim); transition: transform .25s ease; }
  .ve-section.expanded .ve-chevron { transform: rotate(180deg); }
  .ve-collapse { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .25s ease; }
  .ve-section.expanded .ve-collapse { grid-template-rows: 1fr; }
  .ve-collapse-inner { overflow: hidden; }
  .ve-row { padding: .875rem 1.25rem; border-bottom: 1px solid var(--border); }
  .ve-row:last-child { border-bottom: none; }
  .ve-label { font-size: .8125rem; font-weight: 500; color: var(--text); margin-bottom: .125rem; }
  .ve-desc { font-size: .75rem; color: var(--text-dim); margin-bottom: .75rem; line-height: 1.4; }
  .ve-desc.inline { margin-bottom: 0; margin-top: .125rem; }
  .ve-input { width: 100%; min-height: 36px; padding: 0 .6875rem; background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: .8125rem; font-family: inherit; transition: border-color .15s ease, box-shadow .15s ease; }
  .ve-input:focus, .ve-input:focus-visible { outline: none; border-color: var(--text-faint); box-shadow: 0 0 0 3px color-mix(in srgb, var(--text) 10%, transparent); }
  .ve-input::placeholder { color: var(--text-faint); }
  .ve-dropdown { position: relative; width: 100%; }
  .ve-dropdown.small { width: 160px; flex-shrink: 0; }
  .ve-dropdown-trigger { display: flex; width: 100%; min-height: 36px; align-items: center; justify-content: space-between; gap: .75rem; padding: 0 .6875rem; background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: .8125rem; cursor: pointer; font-family: inherit; text-align: left; transition: border-color .15s ease, box-shadow .15s ease, background .15s ease; }
  .ve-dropdown.small .ve-dropdown-trigger { padding: .375rem .625rem; }
  .ve-dropdown-trigger:hover, .ve-dropdown-trigger[aria-expanded="true"] { border-color: var(--text-faint); background: var(--panel); }
  .ve-dropdown-trigger:focus-visible { outline: none; border-color: var(--text-faint); box-shadow: 0 0 0 3px color-mix(in srgb, var(--text) 10%, transparent); }
  .ve-dropdown-chevron { width: 14px; height: 14px; color: var(--text-faint); flex-shrink: 0; transition: transform .18s ease, color .15s ease; }
  .ve-dropdown-chevron.open { transform: rotate(180deg); color: var(--green); }
  .ve-dropdown-menu { --panel: #181818; --panel-2: #1e1e1e; --border: #383c39; --text: #ffffff; --text-dim: #a1a1a1; --text-faint: #707070; --green: #a3ff5f; padding: .25rem; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 16px 36px rgba(0,0,0,.48); }
  body:has(.db-light) .ve-dropdown-menu { --panel: #ffffff; --panel-2: #eef1ec; --border: #c5cbc4; --text: #101310; --text-dim: #5e655e; --text-faint: #7e857e; --green: #70df35; }
  .ve-dropdown-option { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: .625rem; padding: .5rem .625rem; border: 0; border-radius: 5px; background: transparent; color: var(--text-dim); font: inherit; font-size: .8125rem; cursor: pointer; text-align: left; transition: background .15s ease, color .15s ease; }
  .ve-dropdown-option:hover, .ve-dropdown-option.selected:hover { background: var(--panel-2); color: var(--text); }
  .ve-dropdown-option.selected { color: var(--text); }
  .ve-dropdown-option-check { width: 15px; height: 15px; padding: 3px; border-radius: 50%; background: var(--green); color: #101310; flex-shrink: 0; }
  .ve-modes { display: flex; flex-direction: column; gap: .5rem; }
  .ve-mode { display: flex; align-items: flex-start; gap: .75rem; padding: .875rem; background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; transition: all .15s ease; text-align: left; width: 100%; color: inherit; font-family: inherit; }
  .ve-mode:hover { border-color: var(--text-faint); background: var(--panel); }
  .ve-mode.selected { border-color: var(--green); background: color-mix(in srgb, var(--green) 8%, transparent); }
  .ve-mode-icon { width: 14px; height: 14px; color: var(--text-dim); flex-shrink: 0; margin-top: 2px; }
  .ve-mode.selected .ve-mode-icon { color: var(--green); }
  .ve-mode-content { flex: 1; min-width: 0; }
  .ve-mode-name { font-size: .8125rem; font-weight: 500; color: var(--text); margin-bottom: .125rem; display: flex; align-items: center; gap: .5rem; }
  .ve-mode-desc { font-size: .6875rem; color: var(--text-dim); line-height: 1.4; }
  .ve-checkrow { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
  .ve-checkrow-info { flex: 1; min-width: 0; }
  .ve-check { appearance: none; width: 18px; height: 18px; border: 1.5px solid var(--text-faint); border-radius: 4px; background: transparent; cursor: pointer; position: relative; transition: all .15s ease; flex-shrink: 0; margin-top: 2px; }
  .ve-check:checked { background: var(--green); border-color: var(--green); }
  .ve-check:checked::after { content: ''; position: absolute; top: 50%; left: 50%; transform: translate(-50%,-60%) rotate(45deg); width: 4px; height: 8px; border: solid white; border-width: 0 2px 2px 0; }
  .ve-blockref { margin-top: 0; padding: 0 .875rem; background: var(--panel-2); border: 1px solid transparent; border-radius: 6px; display: grid; grid-template-rows: 0fr; overflow: hidden; opacity: 0; transition: grid-template-rows .25s ease, margin-top .25s ease, padding .25s ease, opacity .25s ease, border-color .25s ease; }
  .ve-blockref.visible { grid-template-rows: 1fr; opacity: 1; margin-top: .875rem; padding: .875rem; border-color: var(--border); }
  .ve-blockref-inner { overflow: hidden; }
  .ve-blockref-controls { display: flex; gap: .625rem; align-items: stretch; }
  .ve-blockref-field { flex: 1; display: flex; flex-direction: column; gap: .25rem; }
  .ve-blockref-input { width: 100%; min-height: 36px; padding: 0 .6875rem; background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: .8125rem; font-family: 'Courier New', monospace; transition: border-color .15s ease, box-shadow .15s ease; }
  .ve-blockref-input:focus, .ve-blockref-input:focus-visible { outline: none; border-color: var(--text-faint); box-shadow: 0 0 0 3px color-mix(in srgb, var(--text) 10%, transparent); }
  .ve-hint { font-size: .6875rem; color: var(--text-faint); font-family: 'Courier New', monospace; }
  .ve-togglerow { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
  .ve-togglerow-info { flex: 1; min-width: 0; }
  .ve-toggle { position: relative; width: 36px; height: 20px; background: var(--text-faint); border-radius: 10px; cursor: pointer; transition: background .2s; flex-shrink: 0; border: none; padding: 0; }
  .ve-toggle.active { background: var(--green); }
  .ve-toggle-slider { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background: white; border-radius: 50%; transition: transform .2s; box-shadow: 0 1px 3px rgba(0,0,0,.3); }
  .ve-toggle.active .ve-toggle-slider { transform: translateX(16px); }
  .ve-footer { padding: .875rem 1.25rem; border-top: 1px solid var(--border); background: var(--panel); display: flex; justify-content: flex-end; gap: .625rem; flex-shrink: 0; }
  .ve-btn-primary { padding: .625rem 1.125rem; border-radius: 6px; font-size: .8125rem; font-weight: 500; cursor: pointer; transition: all .15s ease; border: 1px solid transparent; font-family: inherit; display: inline-flex; align-items: center; gap: .5rem; background: var(--green); color: #101310; }
  .ve-btn-primary:hover { filter: brightness(1.12); }
  .ve-btn-primary svg { width: 14px; height: 14px; }
  .ve-kbd { display: inline-flex; align-items: center; justify-content: center; padding: .125rem .375rem; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.15); border-radius: 4px; font-size: .625rem; color: rgba(255,255,255,.7); font-family: 'Courier New', monospace; margin-left: .25rem; }
  .ve-tabs { display: flex; min-width: 0; align-items: center; border-bottom: 1px solid var(--border); overflow-x: auto; scrollbar-width: thin; -ms-overflow-style: none; }
  .ve-tab-list { position: relative; display: flex; width: 100%; min-width: max-content; align-items: center; justify-content: space-between; gap: .125rem; }
  .ve-tabs::-webkit-scrollbar { display: none; }
  .ve-tab { display: flex; flex: 0 0 auto; align-items: center; gap: .5rem; padding: 0 .625rem; height: 3.5rem; font-size: .875rem; color: var(--text-dim); background: none; border: none; border-bottom: 1px solid transparent; transition: all .2s; white-space: nowrap; cursor: pointer; font-family: inherit; }
  .ve-tab:hover:not(.disabled) { color: var(--text); }
  .ve-tab.active { color: var(--text); border-bottom-color: transparent; }
  .ve-tab.disabled { opacity: .5; cursor: not-allowed; }
  .ve-tab svg { width: 1rem; height: 1rem; }
  .ve-tab-indicator { position: absolute; left: 0; bottom: 0; height: 1px; background: var(--green); pointer-events: none; transition: transform .25s cubic-bezier(.22,1,.36,1), width .2s ease; }
  .ve-tab-actions { display: flex; flex: 0 0 auto; align-items: center; gap: .25rem; margin-left: auto; }
  .ve-actionbar { display: flex; align-items: center; justify-content: flex-end; min-height: 2.5rem; border-bottom: 1px solid var(--border); }
  .ve-action { display: inline-flex; flex: 0 0 auto; align-items: center; gap: .375rem; padding: .375rem .625rem; font-size: .875rem; color: var(--text-dim); background: none; border: none; cursor: pointer; transition: all .2s; border-radius: 4px; font-family: inherit; white-space: nowrap; }
  .ve-action:hover { color: var(--text); background: var(--panel); }
  .ve-action.danger { color: var(--red); }
  .ve-action svg { width: 1rem; height: 1rem; }
  .ve-group { display: flex; flex: 0 0 auto; align-items: center; gap: .5rem; margin-left: .25rem; padding-left: .75rem; border-left: 1px solid var(--border); }
  .ve-envhead { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .5rem 0 .75rem; }
  .ve-envhead h1 { margin: 0; font-size: 1.25rem; font-weight: 600; color: var(--text); }
  .ve-backlink { align-self: flex-start; margin: .5rem 0 -1rem -.625rem; }
  .ve-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1.5rem 0 2.5rem; }
  @media (max-width: 768px) { .ve-grid { grid-template-columns: 1fr; } .ve-modal { max-width: 100%; max-height: 95vh; } .ve-row { padding: 1rem; } .ve-header, .ve-footer { padding: 1rem; } .ve-blockref-controls { flex-direction: column; } .ve-select-small { width: 100%; } }
  .ve-card { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--bg); }
  .ve-card-head { display: flex; justify-content: space-between; align-items: center; padding: .75rem .875rem; border-bottom: 1px solid var(--border); background: var(--panel); font-size: .875rem; color: var(--text); }
  .ve-detail-row { display: flex; justify-content: space-between; align-items: center; padding: .875rem; border-bottom: 1px solid var(--border); font-size: .875rem; }
  .ve-detail-row:last-child { border-bottom: none; }
  .ve-dlabel { display: flex; align-items: center; gap: .5rem; color: var(--text-dim); }
  .ve-dlabel svg { width: 1rem; height: 1rem; }
  .ve-dvalue { color: var(--text); font-family: 'Courier New', monospace; font-size: .75rem; text-transform: capitalize; }
  .ve-empty { padding: .875rem; color: var(--text-dim); font-size: .875rem; }
`;

type VeDropdownOption = { value: string; label: string };

function VeDropdown({
  value,
  options,
  onChange,
  ariaLabel,
  small = false,
}: {
  value: string;
  options: VeDropdownOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  small?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuHeight = Math.min(220, options.length * 38 + 8);
      const below = rect.bottom + 6;
      const top = below + menuHeight > window.innerHeight && rect.top - menuHeight - 6 > 8
        ? rect.top - menuHeight - 6
        : below;
      setMenuPosition({ top, left: rect.left, width: rect.width });
    };
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (triggerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    updatePosition();
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, options.length]);

  const menu = open && menuPosition && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={menuRef}
          className="ve-dropdown-menu"
          role="listbox"
          aria-label={ariaLabel}
          style={{ position: "fixed", top: menuPosition.top, left: menuPosition.left, width: menuPosition.width, maxHeight: 220, overflowY: "auto", zIndex: 10020 }}
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`ve-dropdown-option${isSelected ? " selected" : ""}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
                {isSelected && <Check className="ve-dropdown-option-check" aria-hidden="true" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )
    : null;

  return (
    <div className={`ve-dropdown${small ? " small" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="ve-dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected?.label}</span>
        <ChevronDown className={`ve-dropdown-chevron${open ? " open" : ""}`} aria-hidden="true" />
      </button>
      {menu}
    </div>
  );
}

const MODES = [
  { id: "frozen", label: "Frozen", description: "Pins the latest ledger at creation and never reads newer network state." },
  { id: "follow_latest", label: "Network sync", description: "Refreshes the verified network base whenever this environment is used." },
];

const MODE_ICONS = { frozen: GitFork, follow_latest: RefreshCw } as const;

export function CreateEnvironmentModal({
  open,
  onClose,
  onCreate,
  simulations = [],
  initialSimulationId,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: CreateEnvironmentInput) => Promise<void> | void;
  simulations?: Array<{ id: string; label: string; network?: string }>;
  initialSimulationId?: string;
}) {
  const [name, setName] = useState("");
  const [network, setNetwork] = useState("mainnet");
  const [mode, setMode] = useState<"frozen" | "follow_latest">("frozen");
  const [source, setSource] = useState<"latest" | "simulation">(initialSimulationId ? "simulation" : "latest");
  const [simulationId, setSimulationId] = useState(initialSimulationId ?? "");
  const [publicExplorer, setPublicExplorer] = useState(false);
  const [namedRpc, setNamedRpc] = useState(false);
  const [rpcSlug, setRpcSlug] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Enter" && event.shiftKey) {
        event.preventDefault();
        submit();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  });

  async function submit() {
    if (!name.trim()) {
      setError("Enter an environment name.");
      return;
    }
    if (source === "simulation" && !simulationId) {
      setError("Select a successful simulation.");
      return;
    }
    if (namedRpc && !rpcSlug.trim()) {
      setError("Enter a named RPC endpoint.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({
        name: name.trim(),
        network: network as "mainnet" | "testnet",
        mode,
        source,
        simulation_id: source === "simulation" ? simulationId : undefined,
        public_explorer_enabled: publicExplorer,
        rpc_slug: namedRpc ? rpcSlug.trim() : undefined,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the environment.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const modal = (
    <div className="ve-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <style>{veStyles}</style>
      <div className="ve-modal">
        <div className="ve-header">
          <div className="ve-title">Create Virtual Network</div>
          <button className="ve-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="ve-body">
          <div className="ve-row">
            <div className="ve-label">Name</div>
            <input type="text" className="ve-input" autoFocus placeholder="Fiction Mention" maxLength={250} value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="ve-row">
            <div className="ve-label">Networks</div>
            <VeDropdown
              value={network}
              onChange={setNetwork}
              ariaLabel="Network"
              options={[
                { value: "mainnet", label: "Stellar Mainnet" },
                { value: "testnet", label: "Stellar Testnet" },
              ]}
            />
          </div>

          <div className="ve-row">
            <div className="ve-label">Network mode</div>
            <div className="ve-modes">
              {MODES.map((m) => {
                const Icon = MODE_ICONS[m.id as keyof typeof MODE_ICONS];
                return (
                  <button key={m.id} type="button" className={`ve-mode${mode === m.id ? " selected" : ""}`} onClick={() => setMode(m.id as "frozen" | "follow_latest")}>
                    <Icon className="ve-mode-icon" />
                    <div className="ve-mode-content">
                      <div className="ve-mode-name">
                        {m.label}
                      </div>
                      <div className="ve-mode-desc">{m.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="ve-row">
            <div className="ve-label">Starting point</div>
            <VeDropdown value={source} onChange={(value) => setSource(value as "latest" | "simulation")} ariaLabel="Starting point" options={[
              { value: "latest", label: "Latest network ledger" },
              { value: "simulation", label: "Successful simulation" },
            ]} />
            {source === "simulation" && (
              <div style={{ marginTop: 8 }}>
                <VeDropdown value={simulationId} onChange={setSimulationId} ariaLabel="Simulation" options={[
                  { value: "", label: "Select a simulation" },
                  ...simulations.map((simulation) => ({ value: simulation.id, label: simulation.label })),
                ]} />
              </div>
            )}
          </div>

          <div className={`ve-section${advancedOpen ? " expanded" : ""}`}>
            <div className="ve-sechead" onClick={() => setAdvancedOpen((v) => !v)}>
              <div className="ve-sectitle"><Settings2 />Advanced</div>
              <ChevronDown className="ve-chevron" />
            </div>
            <div className="ve-collapse">
              <div className="ve-collapse-inner">
                <div className="ve-row">
                  <div className="ve-togglerow">
                    <div className="ve-togglerow-info">
                      <div className="ve-label">Public Explorer</div>
                      <div className="ve-desc">Enable public access to all virtual transactions and contracts</div>
                    </div>
                    <button type="button" className={`ve-toggle${publicExplorer ? " active" : ""}`} onClick={() => setPublicExplorer((v) => !v)}><span className="ve-toggle-slider" /></button>
                  </div>
                </div>
                <div className="ve-row">
                  <div className="ve-togglerow">
                    <div className="ve-togglerow-info">
                      <div className="ve-label">Named RPC URL</div>
                      <div className="ve-desc">Optional endpoint name for this Virtual Network.</div>
                    </div>
                    <button type="button" className={`ve-toggle${namedRpc ? " active" : ""}`} onClick={() => setNamedRpc((v) => !v)}><span className="ve-toggle-slider" /></button>
                  </div>
                  {namedRpc && <input className="ve-input" value={rpcSlug} onChange={(event) => setRpcSlug(event.target.value.toLowerCase())} placeholder="incident-investigation" maxLength={63} />}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="ve-footer">
          {error && <span style={{ marginRight: "auto", color: "#ff7b72", fontSize: 12 }}>{error}</span>}
          <button className="ve-btn-primary" onClick={() => void submit()} disabled={submitting}>
            {submitting ? "Preparing environment" : "Create environment"}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document === "undefined" ? null : createPortal(modal, document.body);
}
