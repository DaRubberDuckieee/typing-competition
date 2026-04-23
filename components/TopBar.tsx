'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Primary nav the public sees. Staff-only pages (Admin, Lane 1/2, Final) are
// reachable by URL but not advertised in the header.
const LINKS: [string, string][] = [
  ['Play', '/play'],
  ['Head to Head', '/head-to-head'],
  ['Leaderboard', '/leaderboard'],
];
const STAFF_LINKS: [string, string][] = [
  ['Admin', '/admin'],
];

export default function TopBar() {
  const path = usePathname();
  return (
    <div className="topbar">
      <Link href="/" className="brand" aria-label="Typing Competition home">
        Typing Competition
      </Link>
      <div className="spacer" />
      {LINKS.map(([label, href]) => (
        <Link key={href} href={href} className={path === href ? 'active' : ''}>
          {label}
        </Link>
      ))}
      {STAFF_LINKS.map(([label, href]) => (
        <Link
          key={href}
          href={href}
          className={path === href ? 'active' : ''}
          style={{ opacity: 0.55 }}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
