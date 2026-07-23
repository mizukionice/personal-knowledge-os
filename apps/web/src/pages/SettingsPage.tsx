import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, LogOut, ShieldCheck } from 'lucide-react';
import type { AdminUserRow, UserPermissionFlag } from '@pkos/shared';

import { useAuth } from '@/auth/context';
import { adminApi, profileApi } from '@/lib/api';
import { Button } from '@/components/ui/button';

const FLAG_LABELS: Record<UserPermissionFlag, string> = {
  can_upload: 'アップロード',
  can_process: '処理',
  can_chat: 'チャット',
};

export function SettingsPage() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();

  const [isAdmin, setIsAdmin] = useState(false);
  const [signupEnabled, setSignupEnabled] = useState<boolean | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [savingSignup, setSavingSignup] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const profile = await profileApi.getOwn().catch(() => null);
      if (!active || profile?.role !== 'admin') return;
      setIsAdmin(true);
      try {
        const [settingsRes, usersRes] = await Promise.all([
          adminApi.getSettings(),
          adminApi.listUsers(),
        ]);
        if (!active) return;
        setSignupEnabled(settingsRes.settings.signup_enabled);
        setUsers(usersRes.users);
      } catch (e) {
        if (active) setAdminError(e instanceof Error ? e.message : '管理情報の取得に失敗しました');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const toggleSignup = async () => {
    if (signupEnabled === null) return;
    setSavingSignup(true);
    setAdminError(null);
    try {
      const res = await adminApi.updateSettings(!signupEnabled);
      setSignupEnabled(res.settings.signup_enabled);
    } catch (e) {
      setAdminError(e instanceof Error ? e.message : '設定の更新に失敗しました');
    } finally {
      setSavingSignup(false);
    }
  };

  const toggleFlag = async (user: AdminUserRow, flag: UserPermissionFlag) => {
    setAdminError(null);
    try {
      const res = await adminApi.updateUser(user.user_id, { [flag]: !user[flag] });
      setUsers((prev) =>
        prev.map((u) => (u.user_id === user.user_id ? { ...u, ...res.profile } : u)),
      );
    } catch (e) {
      setAdminError(e instanceof Error ? e.message : '権限の更新に失敗しました');
    }
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

      {isAdmin && (
        <div className="mt-6 rounded-lg border bg-card p-6">
          <h2 className="flex items-center gap-2 font-medium">
            <ShieldCheck className="size-4" />
            管理者
          </h2>

          {adminError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {adminError}
            </p>
          )}

          <div className="mt-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">新規アカウント登録</p>
              <p className="text-sm text-muted-foreground">
                {signupEnabled === null
                  ? '読み込み中…'
                  : signupEnabled
                    ? '公開中（誰でも登録できます）'
                    : '停止中（新規登録をブロックしています）'}
              </p>
            </div>
            <Button
              variant={signupEnabled ? 'destructive' : 'default'}
              onClick={toggleSignup}
              disabled={savingSignup || signupEnabled === null}
            >
              {savingSignup && <Loader2 className="animate-spin" />}
              {signupEnabled ? '登録を停止する' : '登録を公開する'}
            </Button>
          </div>

          <h3 className="mt-6 text-sm font-medium">ユーザー権限</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            チェックを外した機能はそのユーザーのAPIで拒否されます（VLM処理・チャットのAPI費用を遮断）。
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">メール</th>
                  <th className="py-2 pr-4 font-medium">ロール</th>
                  {(Object.keys(FLAG_LABELS) as UserPermissionFlag[]).map((flag) => (
                    <th key={flag} className="py-2 pr-4 font-medium">
                      {FLAG_LABELS[flag]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.user_id} className="border-b last:border-0">
                    <td className="py-2 pr-4">{user.email}</td>
                    <td className="py-2 pr-4">{user.role === 'admin' ? '管理者' : '一般'}</td>
                    {(Object.keys(FLAG_LABELS) as UserPermissionFlag[]).map((flag) => (
                      <td key={flag} className="py-2 pr-4">
                        <input
                          type="checkbox"
                          aria-label={`${user.email}の${FLAG_LABELS[flag]}`}
                          checked={user[flag]}
                          onChange={() => void toggleFlag(user, flag)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
