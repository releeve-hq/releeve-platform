"use client";

import { useState, useEffect, useRef } from "react";
import { Menu, X, Moon, Sun, ChevronDown, Cpu, BarChart3, Layers, Globe, Zap, CreditCard, Wallet, Shield, Building2, BookText, Code, FileText } from "lucide-react";

interface DropdownItem {
  name: string;
  href: string;
  icon: typeof Cpu;
  desc: string;
}

interface DropdownNavItem {
  label: string;
  dropdown: DropdownItem[];
}

interface LinkNavItem {
  label: string;
  href: string;
}

type NavItem = DropdownNavItem | LinkNavItem;

const navItems: NavItem[] = [
  {
    label: "Platform",
    dropdown: [
      { name: "Simulator", href: "/simulator", icon: Cpu, desc: "Test and simulate blockchain interactions" },
      { name: "Explorer", href: "/explorer", icon: BarChart3, desc: "Explore transactions and ledgers in real-time" },
      { name: "Monitor", href: "/monitor", icon: Layers, desc: "Real-time system monitoring and alerts" },
      { name: "Virtual Envs", href: "/virtual-environments", icon: Globe, desc: "Isolated testing and sandbox environments" },
    ],
  },
  {
    label: "Solutions",
    dropdown: [
      { name: "DeFi", href: "/solutions/defi", icon: Zap, desc: "Decentralized finance infrastructure" },
      { name: "Payments", href: "/solutions/payments", icon: CreditCard, desc: "Payment processing and APIs" },
      { name: "Wallets", href: "/solutions/wallets", icon: Wallet, desc: "Digital wallet solutions" },
      { name: "Infrastructure", href: "/solutions/infrastructure", icon: Shield, desc: "Robust backend infrastructure" },
      { name: "Enterprises", href: "/solutions/enterprises", icon: Building2, desc: "Enterprise-grade solutions" },
    ],
  },
  {
    label: "Resources",
    dropdown: [
      { name: "Documentation", href: "/docs", icon: BookText, desc: "Comprehensive guides and references" },
      { name: "API Reference", href: "/api-reference", icon: Code, desc: "Complete API documentation" },
      { name: "Blog", href: "/blog", icon: FileText, desc: "Latest news and updates" },
    ],
  },
  { label: "Pricing", href: "/pricing" },
];

function isDropdownItem(item: NavItem): item is DropdownNavItem {
  return 'dropdown' in item;
}

export function Navigation() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('landing-theme');
    if (saved === 'dark') {
      setIsDark(true);
      document.documentElement.classList.add('dark');
    }
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('landing-theme', next ? 'dark' : 'light');
  };

  const handleTriggerEnter = (label: string) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setActiveDropdown(label);
  };

  const handleTriggerLeave = (e: React.MouseEvent) => {
    const popup = popupRef.current;
    if (popup && popup.contains(e.relatedTarget as Node)) return;
    hoverTimeoutRef.current = setTimeout(() => {
      setActiveDropdown(null);
    }, 80);
  };

  const handlePopupEnter = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
  };

  const handlePopupLeave = (e: React.MouseEvent) => {
    const related = e.relatedTarget as Node | null;
    if (related && navRef.current?.contains(related)) {
      return;
    }
    setActiveDropdown(null);
  };

  const activeItem = navItems.find(n => n.label === activeDropdown) as DropdownNavItem | undefined;

  return (
    <header
      className={`fixed z-50 transition-all duration-500 ${
        isScrolled
          ? "top-4 left-4 right-4"
          : "top-0 left-0 right-0"
      }`}
    >
      <nav
        ref={navRef}
        className={`mx-auto transition-all duration-500 ${
          isScrolled
            ? "bg-background/80 backdrop-blur-xl border border-foreground/10 rounded-2xl shadow-lg max-w-[1200px]"
            : "bg-background/40 backdrop-blur-sm max-w-[1400px]"
        }`}
      >
        <div
          className={`flex items-center justify-between transition-all duration-500 px-6 lg:px-8 ${
            isScrolled ? "h-14" : "h-20"
          }`}
        >
          {/* Logo */}
          <a href="/" className="flex items-center gap-2 group">
            <span className={`font-display tracking-tight transition-all duration-500 ${isScrolled ? "text-xl" : "text-2xl"}`}>Releeve</span>
          </a>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              if (isDropdownItem(item)) {
                const isOpen = activeDropdown === item.label;
                return (
                  <button
                    key={item.label}
                    data-dropdown-trigger
                    onMouseEnter={() => handleTriggerEnter(item.label)}
                    onMouseLeave={handleTriggerLeave}
                    className={`flex items-center gap-1 px-3 py-2 text-sm transition-colors duration-300 rounded-lg ${
                      isOpen
                        ? "text-foreground bg-foreground/5"
                        : "text-foreground/70 hover:text-foreground hover:bg-foreground/5"
                    }`}
                  >
                    {item.label}
                    <ChevronDown size={14} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                );
              }
              return (
                <a
                  key={item.label}
                  href={item.href}
                  className="px-3 py-2 text-sm text-foreground/70 hover:text-foreground transition-colors duration-300 rounded-lg hover:bg-foreground/5"
                >
                  {item.label}
                </a>
              );
            })}
          </div>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-4">
            <button
              onClick={toggleTheme}
              className="text-foreground/70 hover:text-foreground transition-colors duration-300 p-2"
              aria-label="Toggle theme"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <a href="/signin" className={`text-foreground/70 hover:text-foreground transition-all duration-500 ${isScrolled ? "text-xs" : "text-sm"}`}>
              Sign In
            </a>
            <a
              href="/signup"
              className={`inline-flex items-center justify-center bg-foreground hover:bg-foreground/90 text-background rounded-full font-medium transition-all duration-500 ${isScrolled ? "px-4 h-8 text-xs" : "px-6 h-10 text-sm"}`}
            >
              Get Started
            </a>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden p-2"
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? (
              <X className="w-6 h-6" />
            ) : (
              <Menu className="w-6 h-6" />
            )}
          </button>
        </div>
      </nav>

      {/* Desktop Dropdown Popup */}
      <div
        ref={popupRef}
        onMouseEnter={handlePopupEnter}
        onMouseLeave={handlePopupLeave}
        className={`hidden md:block absolute left-1/2 -translate-x-1/2 w-full max-w-[600px] pt-2 transition-all duration-300 ease-out origin-top ${
          activeDropdown
            ? "opacity-100 scale-100 pointer-events-auto"
            : "opacity-0 scale-90 pointer-events-none"
        }`}
      >
        <div className="rounded-2xl bg-background/90 backdrop-blur-xl shadow-[0_24px_40px_-20px_rgba(0,0,0,0.30),0_10px_24px_0_rgba(0,0,0,0.06),0_1px_1px_0_rgba(0,0,0,0.16),0_0_0_1px_rgba(0,0,0,0.05),0_8px_14px_-10px_rgba(0,0,0,0.40)] border border-foreground/10 overflow-hidden">
          <div className="p-1">
            {activeItem && (
              <div className="grid grid-cols-2 gap-0.5 bg-foreground/5 rounded-xl p-0.5">
                {activeItem.dropdown.map((link) => {
                  const Icon = link.icon;
                  return (
                    <a
                      key={link.name}
                      href={link.href}
                      className="group/link relative block bg-background rounded-[10px] p-4 hover:bg-foreground/5 transition-colors duration-200"
                    >
                      <div className="flex items-start gap-3">
                        <div className="size-9 rounded-lg bg-foreground/5 flex items-center justify-center shrink-0 group-hover/link:bg-foreground/10 transition-colors duration-200">
                          <Icon className="size-4 text-foreground/60" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground">
                            {link.name}
                          </div>
                          <div className="mt-0.5 text-xs text-foreground/50 leading-relaxed">
                            {link.desc}
                          </div>
                        </div>
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Menu - Full Screen Overlay */}
      <div
        className={`md:hidden fixed inset-0 bg-background z-40 transition-all duration-500 ${
          isMobileMenuOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        style={{ top: 0 }}
      >
        <div className="flex flex-col h-full px-8 pt-28 pb-8 overflow-y-auto">
          <div className="flex-1 flex flex-col justify-center gap-6">
            {navItems.map((item, i) => {
              if (isDropdownItem(item)) {
                return (
                  <div key={item.label}>
                    <div
                      className={`text-3xl font-display text-foreground/50 mb-3 transition-all duration-500 ${
                        isMobileMenuOpen
                          ? "opacity-100 translate-y-0"
                          : "opacity-0 translate-y-4"
                      }`}
                      style={{ transitionDelay: isMobileMenuOpen ? `${i * 75}ms` : "0ms" }}
                    >
                      {item.label}
                    </div>
                    <div className="flex flex-col gap-2 pl-4 border-l border-foreground/10">
                      {item.dropdown?.map((link, j) => {
                        const Icon = link.icon;
                        return (
                          <a
                            key={link.name}
                            href={link.href}
                            onClick={() => setIsMobileMenuOpen(false)}
                            className={`flex items-center gap-3 text-lg text-foreground/60 hover:text-foreground transition-all duration-500 ${
                              isMobileMenuOpen
                                ? "opacity-100 translate-y-0"
                                : "opacity-0 translate-y-4"
                            }`}
                            style={{ transitionDelay: isMobileMenuOpen ? `${(i + j) * 50 + 100}ms` : "0ms" }}
                          >
                            <Icon className="size-4 shrink-0" />
                            {link.name}
                          </a>
                        );
                      })}
                    </div>
                  </div>
                );
              }
              return (
                <a
                  key={item.label}
                  href={item.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`text-3xl font-display text-foreground hover:text-muted-foreground transition-all duration-500 ${
                    isMobileMenuOpen
                      ? "opacity-100 translate-y-0"
                      : "opacity-0 translate-y-4"
                  }`}
                  style={{ transitionDelay: isMobileMenuOpen ? `${i * 75}ms` : "0ms" }}
                >
                  {item.label}
                </a>
              );
            })}
          </div>

          {/* Bottom CTAs */}
          <div className={`flex gap-4 pt-8 border-t border-foreground/10 transition-all duration-500 ${
            isMobileMenuOpen
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-4"
          }`}
          style={{ transitionDelay: isMobileMenuOpen ? "400ms" : "0ms" }}
          >
            <button
              onClick={toggleTheme}
              className="flex items-center justify-center w-14 h-14 border border-foreground/20 rounded-full text-foreground/70 hover:text-foreground transition-colors"
              aria-label="Toggle theme"
            >
              {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <a
              href="/signin"
              className="flex-1 inline-flex items-center justify-center rounded-full h-14 text-base border border-foreground/20 text-foreground/70 hover:text-foreground hover:bg-foreground/5 transition-colors"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Sign In
            </a>
            <a
              href="/signup"
              className="flex-1 inline-flex items-center justify-center bg-foreground text-background rounded-full h-14 text-base font-medium"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Get Started
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}
