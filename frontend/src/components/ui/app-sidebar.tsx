"use client";

import type { CSSProperties, ReactNode } from "react";

export type AppSideItem = {
  key: string;
  label: string;
  icon: ReactNode;
};

/// The single collapsible rail shared by the dashboard and organization
/// shells: 64px icon rail expanding to 180px on hover, identical items,
/// highlight, type, and motion in both places. Shells only contribute
/// outer positioning (their own placement class) plus theme variables —
/// both shells define `--bg/--panel/--border/--text/--text-dim`.
export function AppSidebar({
  items,
  activeKey,
  onSelect,
  className = "",
  style,
}: {
  items: AppSideItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`app-side ${className}`} style={style}>
      <div className="app-side-inner">
        {items.map((item) => (
          <div
            key={item.key}
            role="button"
            tabIndex={0}
            title={item.label}
            className={`app-side-item${activeKey === item.key ? " active" : ""}`}
            onClick={() => onSelect(item.key)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(item.key);
              }
            }}
          >
            <span className="app-side-icon">{item.icon}</span>
            <span className="app-side-label">{item.label}</span>
          </div>
        ))}
      </div>
      <style>{`
        .app-side{background:var(--bg);transition:width .28s cubic-bezier(.4,0,.2,1)}
        .app-side-inner{padding:0 8px}
        .app-side-item{display:flex;align-items:center;justify-content:center;gap:0;margin:2px 6px;padding:9px 0;border:0;border-radius:4px;background:transparent;color:var(--text-dim);font-size:13px;font-weight:700;cursor:pointer;overflow:hidden;transition:background .15s ease,color .15s ease,justify-content .28s cubic-bezier(.4,0,.2,1),gap .28s cubic-bezier(.4,0,.2,1),padding .28s cubic-bezier(.4,0,.2,1)}
        .app-side:hover .app-side-item{justify-content:flex-start;gap:12px;padding:9px 12px}
        .app-side-item:hover{background:color-mix(in srgb,var(--panel) 55%,var(--text) 18%);color:var(--text)}
        .app-side-item.active{background:color-mix(in srgb,var(--panel) 55%,var(--text) 18%);color:var(--text)}
        .app-side-icon{display:flex;flex-shrink:0}
        .app-side-icon svg{display:block}
        .app-side-label{flex:0 0 0;width:0;overflow:hidden;white-space:nowrap;opacity:0;transition:width .28s cubic-bezier(.4,0,.2,1),opacity .18s ease}
        .app-side:hover .app-side-label{flex:0 1 auto;width:auto;opacity:1}
      `}</style>
    </div>
  );
}
