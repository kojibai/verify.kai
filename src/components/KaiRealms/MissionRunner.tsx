// src/components/KaiRealms/MissionRunner.tsx

import React, { useEffect, useState } from 'react';
import { useKaiPulse } from './KaiPulseEngine';
import { getLiveKaiPulse } from '../../utils/kai_pulse';

type Mission = {
  id: string;
  pulseIndex: number;
  active: boolean;
};

type Props = {
  onSuccess: (missionId: string) => void;
  onFail: (missionId: string) => void;
};

/**
 * Displays rhythmic challenge gates based on Kai pulses.
 * Challenges appear every 11 pulses and must be “hit” on exact pulse.
 */
const MissionRunner: React.FC<Props> = ({ onSuccess, onFail }) => {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [lastHit, setLastHit] = useState<string | null>(null);

  // Spawn a new mission every 11 pulses
  useKaiPulse({
    onPulse: (pulseIndex) => {
      if (pulseIndex % 11 === 0) {
        const id = `mission-${pulseIndex}`;
        const newMission: Mission = {
          id,
          pulseIndex,
          active: true,
        };
        setMissions((prev) => [...prev.slice(-4), newMission]); // Keep last 5
      }
    },
  });

  // Handle spacebar press as "attempt"
  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        const current = missions[missions.length - 1];
        if (!current || !current.active || current.id === lastHit) return;

        // Simulate precision timing success (within 1 pulse window)
        const nowPulse = getLiveKaiPulse();
        const diff = Math.abs(current.pulseIndex - nowPulse);

        if (diff <= 1) {
          onSuccess(current.id);
        } else {
          onFail(current.id);
        }

        setLastHit(current.id);
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [missions, lastHit, onSuccess, onFail]);

  return (
    <div style={{ marginTop: '1rem', color: '#66ffcc', textAlign: 'center' }}>
      {missions.length > 0 && missions[missions.length - 1].active && (
        <>
          <p>⏳ Harmonic Challenge Active!</p>
          <p style={{ fontSize: '1.2rem' }}>Hit [Space] on time to sync with the breath!</p>
        </>
      )}
    </div>
  );
};

export default MissionRunner;
