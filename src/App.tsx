// src/App.tsx
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";

/**
 * ✅ Sovereign Gate Console (2-tab) setup:
 * - Nav: ONLY Verifier + KaiVoh
 * - Top bar: LIVE + green orb pulsing every 5.236s + Kai Pulse NOW
 * - KaiVoh opens as a modal via /voh route
 *
 * ✅ IMPORTANT CHANGE:
 * - /s and /s/:hash are FULL-PAGE routes (NOT wrapped by AppChrome)
 * - /stream, /feed, /p~:token, /p are FULL-PAGE routes (NOT wrapped by AppChrome)
 * - /explorer is FULL-PAGE (NOT wrapped by AppChrome)
 */

import VerifierStamper from "./components/VerifierStamper/VerifierStamper";
import KaiVohModal from "./components/KaiVoh/KaiVohModal";

// ✅ Kai Pulse NOW (canonical Kai-Klok utility)
import { momentFromUTC } from "./utils/kai_pulse";

// Full-page pages
import SigilExplorer from "./components/SigilExplorer";
import SigilFeedPage from "./pages/SigilFeedPage";
import SigilPage from "./pages/SigilPage/SigilPage";
import PShort from "./pages/PShort";

import "./App.css";

type NavItem = {
  to: string;
  label: string;
  desc: string;
  end?: boolean;
};

// Strict: allow CSS custom vars without `any`
type AppShellStyle = CSSProperties & {
  ["--breath-s"]?: string;
};

function KaiVohRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const [open, setOpen] = useState<boolean>(true);

  const handleClose = useCallback((): void => {
    setOpen(false);
    navigate("/", { replace: true });
  }, [navigate]);

  return (
    <>
      <KaiVohModal open={open} onClose={handleClose} />
      <div className="sr-only" aria-live="polite">
        KaiVoh portal open
      </div>
    </>
  );
}

function AppChrome(): React.JSX.Element {
  const location = useLocation();

  // φ-exact breath (seconds): 3 + √5
  const BREATH_S = useMemo(() => 3 + Math.sqrt(5), []);
  const BREATH_MS = useMemo(() => BREATH_S * 1000, [BREATH_S]);

  const shellStyle = useMemo<AppShellStyle>(
    () => ({
      "--breath-s": `${BREATH_S}s`,
    }),
    [BREATH_S],
  );

  // ✅ Kai Pulse NOW
  const kaiPulseNow = useCallback((): number => {
    return momentFromUTC(new Date()).pulse;
  }, []);

  const [pulseNow, setPulseNow] = useState<number>(() => kaiPulseNow());

  useEffect(() => {
    const id = window.setInterval(() => {
      setPulseNow(kaiPulseNow());
    }, 250);
    return () => window.clearInterval(id);
  }, [kaiPulseNow]);

  const pulseNowStr = useMemo(() => {
    if (!Number.isFinite(pulseNow)) return "—";
    if (pulseNow < 0) return String(pulseNow);
    if (pulseNow < 1_000_000) return String(pulseNow).padStart(6, "0");
    return pulseNow.toLocaleString("en-US");
  }, [pulseNow]);

  const navItems = useMemo<NavItem[]>(
    () => [
      { to: "/", label: "Verifier", desc: "Inhale + Exhale", end: true },
      { to: "/voh", label: "KaiVoh", desc: "Emission OS" },
    ],
    [],
  );

  const pageTitle = useMemo<string>(() => {
    const p = location.pathname;
    if (p === "/") return "Verifier";
    if (p.startsWith("/voh")) return "KaiVoh";
    return "Sovereign Gate";
  }, [location.pathname]);

  useEffect(() => {
    document.title = `ΦNet • ${pageTitle}`;
  }, [pageTitle]);

  // ✅ No-scroll + perfect centering inside the panel for Verifier/KaiVoh routes
  const lockPanel = useMemo(() => {
    const p = location.pathname;
    return p === "/" || p.startsWith("/voh");
  }, [location.pathname]);

  return (
    <div className="app-shell" data-ui="atlantean-banking" style={shellStyle}>
      {/* A11y */}
      <a className="skip-link" href="#app-content">
        Skip to content
      </a>

      {/* Atlantean background layers */}
      <div className="app-bg-orbit" aria-hidden="true" />
      <div className="app-bg-grid" aria-hidden="true" />
      <div className="app-bg-glow" aria-hidden="true" />

      {/* Top Bar */}
      <header
        className="app-topbar"
        role="banner"
        aria-label="ΦNet Sovereign Gate Header"
      >
        <div className="topbar-left">
          <div className="brand" aria-label="ΦNet Sovereign Gate">
            <div className="brand__mark" aria-hidden="true">
              <img src="/phi.svg" alt="" className="brand__mark-img" />
            </div>
            <div className="brand__text">
              <div className="brand__title">ΦNet Sovereign Gate</div>
              <div className="brand__subtitle">
                Custody of Breath-Minted Value · Kairos Identity Registry
              </div>
            </div>
          </div>
        </div>

        {/* LIVE — orb pulses every 5.236s, text shows Kai Pulse NOW */}
        <a
          className="topbar-live"
          href="https://kaiklok.com"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`LIVE. Kai Pulse now ${pulseNow}. Breath length ${BREATH_S.toFixed(
            3,
          )} seconds. Open KaiKlok.com.`}
          title={`LIVE • NOW PULSE ${pulseNowStr} • Breath ${BREATH_S.toFixed(
            6,
          )}s (${Math.round(BREATH_MS)}ms) • View full Kairos Time at KaiKlok.com`}
        >
          <span className="live-orb" aria-hidden="true" />
          <div className="live-text">
            <div className="live-title">☤KAI</div>
            <div className="live-meta">
              <span className="mono">{pulseNowStr}</span>
            </div>
          </div>
        </a>
      </header>

      {/* Stage */}
      <main
        className="app-stage"
        id="app-content"
        role="main"
        aria-label="Sovereign Value Workspace"
      >
        <div className="app-frame" role="region" aria-label="Secure frame">
          <div className="app-frame-inner">
            <div className="app-workspace">
              {/* Navigation */}
              <nav className="app-nav" aria-label="Primary navigation">
                <div className="nav-head">
                  <div className="nav-head__title">Atrium</div>
                  <div className="nav-head__sub">
                    Breath-Sealed Identity · Kairos-ZK Proof
                  </div>
                </div>

                <div className="nav-list" role="list">
                  {navItems.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        `nav-item ${isActive ? "nav-item--active" : ""}`
                      }
                      aria-label={`${item.label}: ${item.desc}`}
                    >
                      <div className="nav-item__label">{item.label}</div>
                      <div className="nav-item__desc">{item.desc}</div>
                    </NavLink>
                  ))}
                </div>

                <div className="nav-foot" aria-label="Sovereign declarations">
                  <div className="nav-foot__line">
                    <span className="mono">Φ</span> Kairos Notes are legal tender in Kairos —
sealed by Proof of Breath™, pulsed by Kai-Signature™, and openly auditable offline (Σ → SHA-256(Σ) → Φ).
                  </div>

                  <div className="nav-foot__line">
                 Sigil-Glyphs are zero-knowledge–proven origin ΦKey seals that
summon, mint, and mature value.
Derivative glyphs are exhaled notes of that origin —
lineage-true outflow, transferable, and redeemable by re-inhale.
                  </div>
                </div>
              </nav>

              {/* Content */}
              <section className="app-panel" aria-label="Sovereign Gate panel">
                <div className="panel-head">
                  <div className="panel-head__title">{pageTitle}</div>
                  <div className="panel-head__meta">
                    <span className="meta-chip">Proof of Breath™</span>
                    <span className="meta-chip">Kai-Signature™</span>
                  </div>
                </div>

                {/* ✅ LOCKED + CENTERED: VerifierStamper is centered, no scroll */}
                <div
                  className={`panel-body ${lockPanel ? "panel-body--locked" : ""}`}
                >
                  <div className="panel-center">
                    <Outlet />
                  </div>
                </div>

                <footer className="panel-foot" aria-label="Footer">
                  <div className="panel-foot__left">
                    <span className="mono">ΦNet</span> • Sovereign Gate
                  </div>
                  <div className="panel-foot__right">
                    <span className="mono">V</span>{" "}
                    <span className="mono">24.3</span>
                  </div>
                </footer>
              </section>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function NotFound(): React.JSX.Element {
  return (
    <div className="notfound" role="region" aria-label="Not found">
      <div className="notfound__code">404</div>
      <div className="notfound__title">Route not found</div>
      <div className="notfound__hint">
        Use the Sovereign Gate navigation to return to Verifier or KaiVoh.
      </div>
      <div className="notfound__actions">
        <NavLink className="notfound__cta" to="/">
          Go to Verifier
        </NavLink>
      </div>
    </div>
  );
}

export default function App(): React.JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        {/* ✅ FULL-PAGE Sigil routes (NO AppChrome wrapper) */}
        <Route path="s" element={<SigilPage />} />
        <Route path="s/:hash" element={<SigilPage />} />

        {/* ✅ FULL-PAGE Stream routes (NO AppChrome wrapper) */}
        <Route path="stream" element={<SigilFeedPage />} />
        <Route path="stream/p/:token" element={<SigilFeedPage />} />
        <Route path="feed" element={<SigilFeedPage />} />
        <Route path="feed/p/:token" element={<SigilFeedPage />} />
        <Route path="p~:token" element={<SigilFeedPage />} />
        <Route path="p" element={<PShort />} />

        {/* ✅ FULL-PAGE Explorer route (NO AppChrome wrapper) */}
        <Route path="explorer" element={<SigilExplorer />} />

        {/* Everything else stays inside the Sovereign Gate chrome */}
        <Route element={<AppChrome />}>
          {/* Root → VerifierStamper */}
          <Route index element={<VerifierStamper />} />

          {/* KaiVoh Portal (modal route) */}
          <Route path="voh" element={<KaiVohRoute />} />

          {/* Fallback */}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
