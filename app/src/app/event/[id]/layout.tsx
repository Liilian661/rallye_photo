'use client';

import { useParams, usePathname, useRouter } from 'next/navigation';
import { IconCamera, IconTrophy, IconSparkles } from '@/lib/icons';

export default function EventLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const eventId = params.id as string;

  const basePath = `/event/${eventId}`;

  const tabs = [
    { href: basePath, icon: IconCamera, label: 'Defis' },
    { href: `${basePath}/leaderboard`, icon: IconTrophy, label: 'Classement' },
    { href: `${basePath}/results`, icon: IconSparkles, label: 'Resultats' },
  ];

  return (
    <div>
      {children}
      <nav className="bottom-nav">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <button
              key={tab.href}
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => router.push(tab.href)}
            >
              <tab.icon size={20} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}