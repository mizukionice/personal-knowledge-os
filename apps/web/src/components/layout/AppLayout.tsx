import { NavLink, Outlet } from 'react-router-dom';
import { BookOpen, Library, Settings, Upload } from 'lucide-react';

import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', label: 'Library', icon: Library, end: true },
  { to: '/upload', label: 'Upload', icon: Upload, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
];

export function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4">
          <NavLink to="/" className="flex items-center gap-2 font-semibold">
            <BookOpen className="size-5" />
            <span>Personal Knowledge OS</span>
          </NavLink>
          <nav className="flex items-center gap-1">
            {navItems.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                    isActive && 'bg-accent text-accent-foreground',
                  )
                }
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
