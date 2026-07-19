import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';

import { useAuth } from '@/auth/context';
import { Button } from '@/components/ui/button';

export function SettingsPage() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="mt-6 rounded-lg border bg-card p-6">
        <h2 className="font-medium">アカウント</h2>
        <p className="mt-1 text-sm text-muted-foreground">{session?.user.email}</p>
        <Button variant="outline" className="mt-4" onClick={handleSignOut}>
          <LogOut />
          ログアウト
        </Button>
      </div>
    </div>
  );
}
