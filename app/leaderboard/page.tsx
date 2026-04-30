import { redirect } from 'next/navigation';

// Booth refactor: the landing page IS the leaderboard now. Anyone who hits
// the old /leaderboard URL gets bounced to / so they see the same content.
export default function LeaderboardPage(): never {
  redirect('/');
}
