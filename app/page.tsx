'use client';
import { LeaderboardView } from '@/components/LeaderboardView';

// The landing page IS the leaderboard. This is what the booth laptops show
// between races (and what the HDMI-mirrored screens above the booth display
// in idle moments). Big leaderboard, two prominent Play now buttons (one
// per lane), nothing else.
export default function Home() {
  return (
    <section className="booth-landing">
      <LeaderboardView showModePicker />
      <style jsx>{`
        .booth-landing {
          padding: clamp(32px, 6vw, 96px) 0 96px;
          max-width: 1100px;
          margin: 0 auto;
        }
      `}</style>
    </section>
  );
}
