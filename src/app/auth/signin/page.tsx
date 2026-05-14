'use client';

import { useState, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

const REMEMBERED_EMAIL_KEY = 'b0t_remembered_email';

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load remembered email on component mount
  useEffect(() => {
    const rememberedEmail = localStorage.getItem(REMEMBERED_EMAIL_KEY);
    if (rememberedEmail) {
      setEmail(rememberedEmail);
      setRememberMe(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await signIn('credentials', {
        email,
        password,
        rememberMe: rememberMe.toString(),
        redirect: false,
      });

      if (result?.error) {
        setError('Invalid email or password');
      } else {
        // Save or remove email from localStorage based on remember me preference
        if (rememberMe) {
          localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
        } else {
          localStorage.removeItem(REMEMBERED_EMAIL_KEY);
        }
        router.push('/dashboard');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-sm border-border bg-surface shadow-lg">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-xl font-black tracking-tight">Sign In</CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Enter your credentials to continue
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs text-foreground">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-9 bg-background border-input text-sm"
                autoComplete="email"
                required
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs text-foreground">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-9 bg-background border-input text-sm"
                autoComplete="current-password"
                required
              />
            </div>

            {/* Remember Me */}
            <div className="flex items-center gap-2">
              <input
                id="remember-me"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setRememberMe(checked);
                  // If unchecking, immediately remove saved email
                  if (!checked) {
                    localStorage.removeItem(REMEMBERED_EMAIL_KEY);
                  }
                }}
                className="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-primary focus:ring-offset-2"
              />
              <Label htmlFor="remember-me" className="text-xs text-muted-foreground cursor-pointer">
                Remember me for 30 days
              </Label>
            </div>

            {/* Error Message */}
            {error && <div className="text-xs text-destructive text-center">{error}</div>}

            {/* Submit Button */}
            <Button type="submit" disabled={loading} className="w-full h-9 text-xs">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </Button>

            <p className="text-center text-[10px] text-muted-foreground mt-4">
              Single user application
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
