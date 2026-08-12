import type { CSSProperties } from "react";
import {
  identiconBytes,
  identiconCells,
  identiconPalette,
  type IdenticonKind,
} from "@/lib/identicon";

type EntityIdenticonProps = {
  value: string;
  kind?: IdenticonKind;
  size?: number;
  className?: string;
  title?: string;
  color?: string | null;
};

function kindLabel(kind: IdenticonKind) {
  return kind === "system" ? "system entity" : `${kind} identicon`;
}

export function EntityIdenticon({
  value,
  kind = "account",
  size = 24,
  className,
  title,
  color,
}: EntityIdenticonProps) {
  const normalized = value.trim() || "unknown";
  const bytes = identiconBytes(normalized, kind);
  const [primary, secondary, background] = identiconPalette(bytes);
  const cells = identiconCells(bytes, kind);
  const radius = kind === "transaction" ? 2 : kind === "contract" ? 3 : 5;
  const style = {
    "--identicon-size": `${size}px`,
    "--identicon-bg": background,
    "--identicon-primary": color || primary,
    "--identicon-secondary": color ? "rgba(255,255,255,0.72)" : secondary,
  } as CSSProperties;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 56 56"
      role={title ? "img" : undefined}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
      style={style}
      data-identicon-kind={kind}
    >
      {title ? <title>{title}</title> : null}
      <rect width="56" height="56" rx={radius} fill="var(--identicon-bg)" />
      <rect x="0.5" y="0.5" width="55" height="55" rx={radius} fill="none" stroke="rgba(255,255,255,0.18)" />
      {cells.map((cell, index) => (
        <rect
          key={`${cell.x}-${cell.y}-${index}`}
          x={cell.x * 8}
          y={cell.y * 8}
          width="8"
          height="8"
          fill={cell.tone ? "var(--identicon-secondary)" : "var(--identicon-primary)"}
        />
      ))}
      {kind === "transaction" ? (
        <path d="M10 28h36M36 18l10 10-10 10" fill="none" stroke="rgba(255,255,255,0.72)" strokeWidth="4" strokeLinecap="square" strokeLinejoin="miter" />
      ) : null}
      {kind === "system" ? (
        <path d="M18 18h20v20H18zM24 12v8M32 12v8M24 36v8M32 36v8M12 24h8M12 32h8M36 24h8M36 32h8" fill="none" stroke="rgba(255,255,255,0.72)" strokeWidth="3" strokeLinecap="square" />
      ) : null}
    </svg>
  );
}

export function EntityIdenticonLabel({
  value,
  kind = "account",
  size = 22,
  className,
}: Omit<EntityIdenticonProps, "title">) {
  return (
    <EntityIdenticon
      value={value}
      kind={kind}
      size={size}
      className={className}
      title={`${kindLabel(kind)} for ${value}`}
    />
  );
}
