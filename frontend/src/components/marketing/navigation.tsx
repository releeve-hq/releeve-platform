"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BellRing,
  Blocks,
  BookOpen,
  Braces,
  ChevronDown,
  ExternalLink,
  Menu,
  Play,
  Radar,
  Rocket,
  ScanSearch,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ReleeveLogo } from "@/components/ui/releeve-logo";

type MenuKey = "platform" | "developers";

const platformLinks = [
  { href: "/#simulation", label: "Simulator", detail: "Replay Soroban calls on forked state", icon: Play },
  { href: "/#environments", label: "Virtual environments", detail: "Persist snapshots and controlled overrides", icon: Blocks },
  { href: "/#monitoring", label: "Monitoring", detail: "Watch calls, events, balances, and state", icon: BellRing },
  { href: "/explorer/testnet", label: "Explorer", detail: "Inspect decoded Stellar activity", icon: ScanSearch },
];

const developerLinks = [
  { href: "/docs", label: "Documentation", detail: "Guides for the complete platform", icon: BookOpen },
  { href: "/docs/quickstart", label: "Quickstart", detail: "Run your first simulation", icon: Rocket },
  { href: "/docs/api-reference", label: "API reference", detail: "Routes, payloads, and OpenAPI", icon: Braces },
  { href: "/explorer/testnet", label: "Public explorer", detail: "Search testnet without an account", icon: Radar },
];

export function MarketingNavigation() {
  const pathname = usePathname();
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSection, setMobileSection] = useState<MenuKey | null>(null);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setOpenMenu(null);
    setMobileOpen(false);
    setMobileSection(null);
  }, [pathname]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
        setMobileOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <header ref={headerRef} className="marketing-header">
      <Link className="marketing-announcement" href="/#simulation">
        <span>Fork real Stellar state. Test the scenario before mainnet does.</span>
        <ExternalLink aria-hidden="true" size={13} />
      </Link>

      <div className="marketing-nav-frame">
        <nav className="marketing-nav" aria-label="Primary navigation">
          <Link className="marketing-brand" href="/" aria-label="Releeve home">
            <span className="marketing-logo-mark"><ReleeveLogo size={23} tone="auto" /></span>
            <span>Releeve</span>
          </Link>

          <div className="marketing-nav-links">
            <NavDropdown
              label="Platform"
              menuKey="platform"
              links={platformLinks}
              openMenu={openMenu}
              setOpenMenu={setOpenMenu}
            />
            <NavDropdown
              label="Resources"
              menuKey="developers"
              links={developerLinks}
              openMenu={openMenu}
              setOpenMenu={setOpenMenu}
            />
            <Link className="marketing-nav-link" href="/pricing">Pricing</Link>
            <Link className="marketing-nav-link" href="/about">About</Link>
          </div>

          <div className="marketing-nav-actions">
            <Link className="marketing-signin" href="/signin">Sign in</Link>
            <Link className="marketing-button marketing-button-primary marketing-nav-cta" href="/signup">
              Create account
            </Link>
          </div>

          <button
            type="button"
            className="marketing-mobile-trigger"
            onClick={() => setMobileOpen((value) => !value)}
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </nav>
      </div>

      {mobileOpen && (
        <div className="marketing-mobile-menu">
          <MobileGroup
            label="Platform"
            menuKey="platform"
            links={platformLinks}
            active={mobileSection}
            setActive={setMobileSection}
          />
          <MobileGroup
            label="Resources"
            menuKey="developers"
            links={developerLinks}
            active={mobileSection}
            setActive={setMobileSection}
          />
          <Link className="marketing-mobile-link" href="/pricing">Pricing</Link>
          <Link className="marketing-mobile-link" href="/about">About</Link>
          <div className="marketing-mobile-actions">
            <Link className="marketing-button marketing-button-secondary" href="/signin">Sign in</Link>
            <Link className="marketing-button marketing-button-primary" href="/signup">Create account</Link>
          </div>
        </div>
      )}
    </header>
  );
}

function NavDropdown({
  label,
  menuKey,
  links,
  openMenu,
  setOpenMenu,
}: {
  label: string;
  menuKey: MenuKey;
  links: typeof platformLinks;
  openMenu: MenuKey | null;
  setOpenMenu: (key: MenuKey | null) => void;
}) {
  const isOpen = openMenu === menuKey;
  return (
    <div className="marketing-nav-dropdown" onMouseEnter={() => setOpenMenu(menuKey)} onMouseLeave={() => setOpenMenu(null)}>
      <button
        type="button"
        className="marketing-nav-link"
        aria-expanded={isOpen}
        aria-controls={`${menuKey}-menu`}
        onClick={() => setOpenMenu(menuKey)}
      >
        {label}<ChevronDown size={14} aria-hidden="true" />
      </button>
      <div id={`${menuKey}-menu`} className="marketing-dropdown-panel" data-open={isOpen}>
        {links.map((item) => {
          const Icon = item.icon;
          return (
            <Link className="marketing-dropdown-item" href={item.href} key={item.label}>
              <span className="marketing-dropdown-icon"><Icon size={17} /></span>
              <span><strong>{item.label}</strong><small>{item.detail}</small></span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function MobileGroup({
  label,
  menuKey,
  links,
  active,
  setActive,
}: {
  label: string;
  menuKey: MenuKey;
  links: typeof platformLinks;
  active: MenuKey | null;
  setActive: (key: MenuKey | null) => void;
}) {
  const isOpen = active === menuKey;
  return (
    <div className="marketing-mobile-group">
      <button type="button" onClick={() => setActive(isOpen ? null : menuKey)} aria-expanded={isOpen}>
        {label}<ChevronDown size={17} />
      </button>
      {isOpen && (
        <div className="marketing-mobile-submenu">
          {links.map((item) => {
            const Icon = item.icon;
            return <Link href={item.href} key={item.label}><Icon size={16} />{item.label}</Link>;
          })}
        </div>
      )}
    </div>
  );
}
