import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import {
  addressRoute,
  explorerRoutes,
  isContractAddress,
  truncateEntity,
  type ExplorerNetwork,
} from "@/lib/explorer-routes";

type EntityLinkProps = {
  network: ExplorerNetwork;
  className?: string;
  title?: string;
  children?: ReactNode;
};

const baseStyle: CSSProperties = {
  color: "inherit",
  fontFamily: "var(--font-mono), monospace",
  textDecoration: "underline",
  textDecorationColor: "rgba(255,255,255,0.24)",
  textUnderlineOffset: 3,
};

function EntityLink({
  href,
  title,
  className,
  children,
}: EntityLinkProps & { href: string }) {
  return (
    <Link href={href} title={title} className={className} style={baseStyle}>
      {children}
    </Link>
  );
}

export function TxHashLink({
  hash,
  network,
  className,
  title,
}: EntityLinkProps & { hash: string }) {
  return (
    <EntityLink href={explorerRoutes.tx(network, hash)} network={network} title={title ?? hash} className={className}>
      {truncateEntity(hash)}
    </EntityLink>
  );
}

export function LedgerLink({
  sequence,
  network,
  className,
  title,
}: EntityLinkProps & { sequence: string | number }) {
  const value = String(sequence);
  return (
    <EntityLink href={explorerRoutes.ledger(network, value)} network={network} title={title ?? value} className={className}>
      {value}
    </EntityLink>
  );
}

export function AccountLink({
  address,
  network,
  className,
  title,
}: EntityLinkProps & { address: string }) {
  return (
    <EntityLink href={explorerRoutes.account(network, address)} network={network} title={title ?? address} className={className}>
      {truncateEntity(address, 6, 5)}
    </EntityLink>
  );
}

export function ContractLink({
  address,
  network,
  className,
  title,
}: EntityLinkProps & { address: string }) {
  return (
    <EntityLink href={explorerRoutes.contract(network, address)} network={network} title={title ?? address} className={className}>
      {truncateEntity(address, 6, 5)}
    </EntityLink>
  );
}

export function AddressLink({
  address,
  network,
  className,
  title,
}: EntityLinkProps & { address: string }) {
  return isContractAddress(address) ? (
    <ContractLink address={address} network={network} className={className} title={title} />
  ) : (
    <AccountLink address={address} network={network} className={className} title={title} />
  );
}

export { addressRoute, explorerRoutes, isContractAddress, truncateEntity };
