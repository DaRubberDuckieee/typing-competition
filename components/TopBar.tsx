'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Booth-mode chrome:
//  - The landing page (/) IS the leaderboard, so we don't need a leaderboard
//    link. The retired /head-to-head + /play flows are kept reachable by URL
//    for fallback testing but no longer advertised.
//  - On /booth/* the bar is hidden entirely so the full-viewport result
//    flash + countdown can take over the screen without a sticky header
//    fighting their z-index.
//  - The admin route is retired — the conference flow is fully self-serve.
export default function TopBar() {
  const path = usePathname();
  if (path?.startsWith('/booth')) return null;
  return (
    <div className="topbar">
      <Link href="/" className="brand" aria-label="Braintrust Typing Competition home">
        Braintrust · Typing Competition
      </Link>
    </div>
  );
}
