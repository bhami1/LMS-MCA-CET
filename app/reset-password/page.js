'use client';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

// Safe async wrapper with timeout
function withTimeout(promise, ms = 7000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Connection timed out. Please try again.')), ms)
    ),
  ]);
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [msg, setMsg] = useState({ text: '', type: '' });
  const [busy, setBusy] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function checkRecoverySession() {
      try {
        // 1. Check if user already has an active session from the recovery redirect
        const { data: { session } } = await supabase.auth.getSession();
        if (session && mounted) {
          setSessionReady(true);
        }
      } catch (err) {
        console.warn('Session check error on reset password page:', err);
      }

      // If Supabase is unconfigured / in demo mode, always allow testing
      if (!isSupabaseConfigured && mounted) {
        setSessionReady(true);
      }
    }

    checkRecoverySession();

    // 2. Listen for PASSWORD_RECOVERY event from Supabase Auth URL hash / token
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (mounted) {
        if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
          setSessionReady(true);
          setMsg({
            text: 'Recovery session active. Please enter your new password below.',
            type: 'info',
          });
        }
      }
    });

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  async function handleResetPassword(e) {
    e.preventDefault();
    setBusy(true);
    setMsg({ text: '', type: '' });

    const safetyTimer = setTimeout(() => {
      setBusy(false);
    }, 8000);

    if (newPassword.length < 6) {
      setMsg({ text: 'Password must be at least 6 characters long.', type: 'error' });
      setBusy(false);
      clearTimeout(safetyTimer);
      return;
    }

    if (newPassword !== confirmPassword) {
      setMsg({ text: 'Passwords do not match. Please re-enter matching passwords.', type: 'error' });
      setBusy(false);
      clearTimeout(safetyTimer);
      return;
    }

    try {
      if (isSupabaseConfigured) {
        const { error } = await withTimeout(
          supabase.auth.updateUser({
            password: newPassword,
          }),
          7000
        );

        if (error) {
          setMsg({ text: error.message, type: 'error' });
          return;
        }

        // Cleanly sign out of temporary recovery session so user can log in fresh
        await supabase.auth.signOut();
      }

      setIsSuccess(true);
      setMsg({
        text: 'Your password has been successfully reset! Redirecting to login...',
        type: 'success',
      });

      setTimeout(() => {
        router.push('/login');
      }, 2200);
    } catch (err) {
      console.error('Password reset update error:', err);
      if (!isSupabaseConfigured) {
        setIsSuccess(true);
        setMsg({
          text: 'Demo Mode: Password reset successful! Redirecting to login...',
          type: 'success',
        });
        setTimeout(() => {
          router.push('/login');
        }, 2200);
      } else {
        setMsg({
          text: err?.message || 'Failed to update password. Your reset link may have expired.',
          type: 'error',
        });
      }
    } finally {
      clearTimeout(safetyTimer);
      setBusy(false);
    }
  }

  return (
    <div className="login-split-page">
      {/* Left/Main Side: College Photo & Emblem */}
      <div 
        className="login-image-side"
        style={{ backgroundImage: `url('/images/login-page-background.png')` }}
      >
        <div className="login-image-overlay" />
        <div className="login-image-content">
          <div className="hero-emblem-badge" style={{ margin: '0 auto 20px' }}>
            <Image
              src="/images/emblem.webp"
              alt="CET Emblem"
              width={80}
              height={80}
              className="hero-emblem-img"
              priority
            />
          </div>
          <h2 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: 8 }}>
            College of Engineering Trivandrum
          </h2>
          <p style={{ color: 'var(--accent-gold)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 24 }}>
            Department Library
          </p>
          <div className="hero-quote-box" style={{ margin: '0 auto' }}>
            <p className="hero-quote-text" style={{ fontSize: '1rem' }}>
              &ldquo;A room without books is like a body without a soul.&rdquo;
            </p>
            <span className="hero-quote-author">&mdash; Cicero</span>
          </div>
        </div>
      </div>

      {/* Right/Side Panel: Dedicated Password Reset Form */}
      <div className="login-panel-side">
        <div className="auth-card-panel">
          <div className="auth-header">
            <h2>Reset Password</h2>
            <p>Create and confirm a new password for your department library account</p>
          </div>

          {msg.text && (
            <div className={`alert-box alert-${msg.type}`}>
              <span>{msg.text}</span>
            </div>
          )}

          {isSuccess ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>✓</div>
              <h3 style={{ color: 'var(--primary-maroon)', marginBottom: 8, fontWeight: 700 }}>
                Password Updated!
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9375rem', marginBottom: 24 }}>
                Your account password has been updated. You can now sign in with your new credentials.
              </p>
              <Link href="/login" className="btn-auth-submit" style={{ display: 'inline-block', textDecoration: 'none' }}>
                Go to Sign In &rarr;
              </Link>
            </div>
          ) : (
            <form onSubmit={handleResetPassword}>
              <div className="form-group">
                <label className="form-label">New Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="Enter new password (min. 6 characters)"
                  className="form-input"
                  value={newPassword}
                  onChange={(e) => {
                    if (busy) setBusy(false);
                    setNewPassword(e.target.value);
                  }}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Confirm New Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="Re-enter new password"
                  className="form-input"
                  value={confirmPassword}
                  onChange={(e) => {
                    if (busy) setBusy(false);
                    setConfirmPassword(e.target.value);
                  }}
                />
              </div>

              <button
                type="submit"
                className="btn-auth-submit"
                disabled={busy}
              >
                {busy ? 'Updating Password...' : 'Reset & Save Password'}
              </button>

              <div className="auth-switch-link" style={{ marginTop: 24 }}>
                <p>
                  Remember your password?{' '}
                  <Link href="/login" style={{ color: 'var(--primary-maroon)', fontWeight: 600 }}>
                    Return to sign in
                  </Link>
                </p>
              </div>

              <div style={{ marginTop: 20, textAlign: 'center' }}>
                <Link href="/" style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                  &larr; Return to Library Home
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
