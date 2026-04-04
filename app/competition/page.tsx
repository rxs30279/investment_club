import Navigation from '@/components/Navigation';

export default function CompetitionPage() {
  return (
    <>
      <Navigation />
      <iframe
        src="https://leaderboard-4q22.vercel.app"
        style={{ width: '100%', height: 'calc(100vh - 3.5rem)', border: 'none', display: 'block' }}
      />
    </>
  );
}
