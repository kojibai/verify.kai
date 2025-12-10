// KaiKlockHomeFace.tsx — Home page face, perfectly in sync with Eternal
import React, { useEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import KaiKlock from "./KaiKlock";
import EternalKlock from "./EternalKlock";
import useSovereignSolarClock from "../utils/useSovereignSolarClock";

const chakraColor = (ark: string) => {
  switch (ark) {
    case "Ignition Ark":      return "#ff0033";
    case "Integration Ark":   return "#ff6600";
    case "Harmonization Ark": return "#ffcc00";
    case "Reflektion Ark":    return "#00cc66";
    case "Purifikation Ark":  return "#00ccff";
    case "Dream Ark":         return "#cc00cc";
    default:                  return "#00ffff";
  }
};

const HARMONIC_DAY_PULSES = 17491.270421 as const;

const KaiKlockHomeFace: React.FC = () => {
  const d = useSovereignSolarClock();

  const [showEternal, setShowEternal] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // ✅ No state + no effect: derive portal root directly (SSR-safe)
  const portalTarget: HTMLElement | null =
    typeof document !== "undefined" ? document.body : null;

  useEffect(() => {
    if (!showEternal) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowEternal(false);
    };

    document.addEventListener("keydown", onKey);
    document.body.classList.add("eternal-overlay-open");
    overlayRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("eternal-overlay-open");
    };
  }, [showEternal]);

  const rotationOverride = useMemo(() => {
    if (typeof d?.rotationOverride === "number" && isFinite(d.rotationOverride)) {
      return d.rotationOverride;
    }
    const beatPulseCount = HARMONIC_DAY_PULSES / 36;
    const currentBeat = Math.floor(
      ((d?.kaiPulseToday ?? 0) % HARMONIC_DAY_PULSES) / beatPulseCount
    );
    return ((currentBeat + 0.5) / 36) * 360;
  }, [d?.rotationOverride, d?.kaiPulseToday]);

  return (
    <>
      <div
        className="home-face-wrap"
        role="button"
        aria-label="Open Eternal Klock"
        title="Open Eternal Klock"
        onClick={() => setShowEternal(true)}
      >
        <div className="home-face-dial">
          <KaiKlock
            hue={chakraColor(d.solarArcName)}
            kaiPulseEternal={d.kaiPulseEternal}
            pulse={d.kaiPulseToday}
            harmonicDayPercent={d.dayPercent}
            microCyclePercent={d.solarStep.percentIntoStep}
            dayLabel={d.dayLabel}
            monthLabel={d.monthLabel}
            monthDay={d.monthDay1}
            rotationOverride={rotationOverride}
            solarSpiralStepString={d.solarStepString}
            solarSpiralStep={d.solarStep}
            eternalBeatIndex={d.etBeatIndex}
            eternalStepIndex={d.etStepIndex}
          />
        </div>
      </div>

      {showEternal && portalTarget
        ? createPortal(
            <div
              className="eternal-overlay"
              role="dialog"
              aria-modal="true"
              aria-label="Eternal Klock"
              ref={overlayRef}
              tabIndex={-1}
              onClick={(e) => {
                if (e.target === overlayRef.current) setShowEternal(false);
              }}
            >
              <button
                type="button"
                className="eternal-close"
                aria-label="Close"
                title="Close"
                onClick={() => setShowEternal(false)}
              >
                <span className="eternal-close-x" aria-hidden="true">
                  ×
                </span>
              </button>

              <div
                className="eternal-modal-card"
                onClick={(e) => e.stopPropagation()}
              >
                <EternalKlock />
              </div>
            </div>,
            portalTarget
          )
        : null}
    </>
  );
};

export default KaiKlockHomeFace;
