import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, Loader2 } from 'lucide-react';

import { useAuth } from '@/auth/context';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Mode = 'login' | 'signup';

export function LoginPage() {
  const { session, loading, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState<Mode>('login');
  // app_settings.signup_enabled は全員selectできる。取得失敗時はtrue扱い（サーバー側で最終拒否される）
  const [signupEnabled, setSignupEnabled] = useState(true);

  useEffect(() => {
    let active = true;
    void supabase
      .from('app_settings')
      .select('signup_enabled')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data) setSignupEnabled(Boolean(data.signup_enabled));
      });
    return () => {
      active = false;
    };
  }, []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';

  if (!loading && session) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        const result = await signIn(email, password);
        if (result.error) {
          setError(result.error);
          return;
        }
        navigate(from, { replace: true });
      } else {
        const result = await signUp(email, password);
        if (result.error) {
          setError(result.error);
          return;
        }
        if (result.needsEmailConfirmation) {
          setNotice('確認メールを送信しました。メール内のリンクを開いてからログインしてください。');
          setMode('login');
          return;
        }
        navigate(from, { replace: true });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-8 shadow-sm">
        <div className="flex items-center gap-2 font-semibold">
          <BookOpen className="size-5" />
          <span>Personal Knowledge OS</span>
        </div>
        <h1 className="mt-6 text-lg font-semibold">
          {mode === 'login' ? 'ログイン' : 'アカウント作成'}
        </h1>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">メールアドレス</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">パスワード</Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-sm text-muted-foreground">
              {notice}
            </p>
          )}
          {mode === 'signup' && !signupEnabled && (
            <p role="status" className="text-sm text-muted-foreground">
              現在、新規アカウント登録は停止されています。
            </p>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={submitting || (mode === 'signup' && !signupEnabled)}
          >
            {submitting && <Loader2 className="animate-spin" />}
            {mode === 'login' ? 'ログイン' : 'アカウント作成'}
          </Button>
        </form>

        <button
          type="button"
          className="mt-4 text-sm text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => {
            setMode(mode === 'login' ? 'signup' : 'login');
            setError(null);
            setNotice(null);
          }}
        >
          {mode === 'login' ? 'アカウントを作成する' : 'ログインに戻る'}
        </button>
      </div>
    </div>
  );
}
