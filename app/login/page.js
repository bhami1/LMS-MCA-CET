'use client';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'forgot'
  const [forgotStep, setForgotStep] = useState(1); // 1: send otp, 2: verify otp, 3: set new password
  const [resetEmail, setResetEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [form, setForm] = useState({
    identifier: '', // email or user id
    password: '',
    full_name: '',
    roll_number: '',
  });
  const [msg, setMsg] = useState({ text: '', type: '' });
  const [busy, setBusy] = useState(false);

  // If already logged in, redirect to dashboard immediately
// If already logged in, verify the role using the profiles table
  useEffect(() => {
    async function checkExistingSession() {
      try {
        const { data: { session }, error: sessionError } =
          await supabase.auth.getSession();

        if (sessionError || !session?.user) return;

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', session.user.id)
          .maybeSingle();

        if (error || !profile?.role) return;

        router.replace(
          profile.role === 'librarian' ? '/librarian' : '/student'
        );
      } catch (error) {
        console.error('Session verification failed:', error);
      }
    }

    checkExistingSession();
  }, [router]);

// Safe async wrapper with timeout to prevent stuck promises
function withTimeout(promise, ms = 7000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Connection timed out. Please check your network or try again.')), ms)
    ),
  ]);
}

  const updateField = (key) => (e) => {
    if (busy) setBusy(false);
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg({ text: '', type: '' });

    const safetyTimer = setTimeout(() => {
      setBusy(false);
    }, 8000);

    try {
      const rawId = form.identifier.trim();
      const emailToUse = rawId.includes('@')
        ? rawId
        : `${rawId}@cet.ac.in`;

      // Student registration — unchanged
      if (mode === 'signup') {
        const { data, error } = await withTimeout(
          supabase.auth.signUp({
            email: emailToUse,
            password: form.password,
            options: {
              data: {
                full_name: form.full_name.trim(),
                roll_number: form.roll_number.trim(),
                role: 'student',
              },
            },
          }),
          7000
        );

        if (error) {
          setMsg({ text: error.message, type: 'error' });
          return;
        }

        if (!data?.session) {
          setMsg({
            text: 'Account created! Please check your email inbox if verification is enabled, or sign in.',
            type: 'info',
          });
          return;
        }

        router.replace('/student');
        return;
      }

      // Student and librarian login — both use Supabase Auth
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({
          email: emailToUse,
          password: form.password,
        }),
        7000
      );

      if (error) {
        setMsg({ text: error.message, type: 'error' });
        return;
      }

      if (!data?.user) {
        setMsg({
          text: 'Unable to authenticate. Please check your credentials.',
          type: 'error',
        });
        return;
      }

      // Verify role using the database, not user metadata
      const { data: profile, error: profileError } = await withTimeout(
        supabase
          .from('profiles')
          .select('role')
          .eq('id', data.user.id)
          .maybeSingle(),
        4000
      );

      if (profileError || !profile?.role) {
        await supabase.auth.signOut();

        setMsg({
          text: 'Unable to verify your account role. Please contact the librarian.',
          type: 'error',
        });
        return;
      }

      router.replace(
        profile.role === 'librarian' ? '/librarian' : '/student'
      );

    } catch (err) {
      console.error('Authentication error:', err);

      setMsg({
        text: err?.message || 'Authentication error occurred. Please try again.',
        type: 'error',
      });
    } finally {
      clearTimeout(safetyTimer);
      setBusy(false);
    }
  }

  // Listen for Supabase password recovery events (e.g. from email links)
  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setMode('forgot');
        setForgotStep(3);
        setMsg({
          text: 'Recovery link verified! Please enter your new password below.',
          type: 'info',
        });
      }
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  // 1. Send Reset OTP to Email
  async function handleSendOtp(e) {
    if (e && e.preventDefault) e.preventDefault();
    setBusy(true);
    setMsg({ text: '', type: '' });

    const safetyTimer = setTimeout(() => {
      setBusy(false);
    }, 8000);

    const rawId = resetEmail.trim();
    if (!rawId) {
      setMsg({ text: 'Please enter your registered institutional email or user ID.', type: 'error' });
      setBusy(false);
      clearTimeout(safetyTimer);
      return;
    }

    const emailToUse = rawId.includes('@') ? rawId : `${rawId}@cet.ac.in`;

    try {
      if (isSupabaseConfigured) {
        const redirectTo = typeof window !== 'undefined'
          ? `${window.location.origin}/reset-password`
          : undefined;

        const { data, error } = await withTimeout(
          supabase.auth.resetPasswordForEmail(emailToUse, {
            redirectTo,
          }),
          7000
        );

        if (error) {
          setMsg({ text: error.message, type: 'error' });
          return;
        }
      }

      setForgotStep(2);
      setMsg({
        text: `A password reset code has been sent to ${emailToUse}. Please check your email inbox and enter the OTP below.`,
        type: 'info',
      });
    } catch (err) {
      console.error('Send reset OTP error:', err);
      if (!isSupabaseConfigured) {
        setForgotStep(2);
        setMsg({
          text: `Demo Mode: A simulated OTP was dispatched to ${emailToUse}. Enter any 6-digit code (e.g. 123456) to proceed.`,
          type: 'info',
        });
      } else {
        setMsg({
          text: err?.message || 'Failed to send password reset email. Please try again.',
          type: 'error',
        });
      }
    } finally {
      clearTimeout(safetyTimer);
      setBusy(false);
    }
  }

  // 2. Verify OTP code
  async function handleVerifyOtp(e) {
    if (e && e.preventDefault) e.preventDefault();
    setBusy(true);
    setMsg({ text: '', type: '' });

    const safetyTimer = setTimeout(() => {
      setBusy(false);
    }, 8000);

    const rawToken = otpCode.trim();
    if (!rawToken) {
      setMsg({ text: 'Please enter the verification code / OTP sent to your email.', type: 'error' });
      setBusy(false);
      clearTimeout(safetyTimer);
      return;
    }

    const rawId = resetEmail.trim();
    const emailToUse = rawId.includes('@') ? rawId : `${rawId}@cet.ac.in`;

    try {
      if (isSupabaseConfigured) {
        const { data, error } = await withTimeout(
          supabase.auth.verifyOtp({
            email: emailToUse,
            token: rawToken,
            type: 'recovery',
          }),
          7000
        );

        if (error) {
          setMsg({
            text: error.message || 'Invalid or expired OTP code. Please check and try again.',
            type: 'error',
          });
          return;
        }
      }

      setForgotStep(3);
      setMsg({
        text: 'OTP verified successfully! Please enter your new password below.',
        type: 'success',
      });
    } catch (err) {
      console.error('Verify OTP error:', err);
      if (!isSupabaseConfigured) {
        setForgotStep(3);
        setMsg({
          text: 'Demo Mode: OTP verified! You can now set your new password.',
          type: 'success',
        });
      } else {
        setMsg({
          text: err?.message || 'OTP verification failed. Please check the code and try again.',
          type: 'error',
        });
      }
    } finally {
      clearTimeout(safetyTimer);
      setBusy(false);
    }
  }

  // 3. Reset and update password
  async function handleResetPassword(e) {
    if (e && e.preventDefault) e.preventDefault();
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
        const { data, error } = await withTimeout(
          supabase.auth.updateUser({
            password: newPassword,
          }),
          7000
        );

        if (error) {
          setMsg({ text: error.message, type: 'error' });
          return;
        }

        // Cleanly sign out after password reset so user can log in fresh
        await supabase.auth.signOut();
      }

      setMode('login');
      setForgotStep(1);
      setOtpCode('');
      setNewPassword('');
      setConfirmPassword('');
      setForm((prev) => ({
        ...prev,
        identifier: resetEmail.trim(),
        password: '',
      }));
      setMsg({
        text: 'Password has been successfully reset! Please sign in with your new password.',
        type: 'success',
      });
    } catch (err) {
      console.error('Reset password error:', err);
      if (!isSupabaseConfigured) {
        setMode('login');
        setForgotStep(1);
        setOtpCode('');
        setNewPassword('');
        setConfirmPassword('');
        setForm((prev) => ({
          ...prev,
          identifier: resetEmail.trim(),
          password: '',
        }));
        setMsg({
          text: 'Demo Mode: Password reset successfully! Please sign in with your new password.',
          type: 'success',
        });
      } else {
        setMsg({
          text: err?.message || 'Failed to update password. Please try again.',
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

      {/* Right/Side Space: Dedicated Login & Registration Panel */}
      <div className="login-panel-side">
        <div className="auth-card-panel">
          <div className="auth-header">
            <h2>
              {mode === 'login'
                ? 'Portal Login'
                : mode === 'signup'
                ? 'Student Registration'
                : forgotStep === 1
                ? 'Forgot Password'
                : forgotStep === 2
                ? 'Verify Reset OTP'
                : 'Set New Password'}
            </h2>
            <p>
              {mode === 'login'
                ? 'Sign in to access student borrowings or librarian management'
                : mode === 'signup'
                ? 'Create a student library account using your institutional credentials'
                : forgotStep === 1
                ? 'Enter your institutional email or user ID to receive a password reset OTP'
                : forgotStep === 2
                ? `Enter the 6-digit OTP verification code sent to ${resetEmail || 'your email'}`
                : 'Choose a strong new password for your department library account'}
            </p>
          </div>

          {mode !== 'forgot' ? (
            <div className="auth-tabs">
              <button
                type="button"
                className={`auth-tab-btn ${mode === 'login' ? 'active' : ''}`}
                onClick={() => { setMode('login'); setMsg({ text: '', type: '' }); }}
              >
                Sign In
              </button>
              <button
                type="button"
                className={`auth-tab-btn ${mode === 'signup' ? 'active' : ''}`}
                onClick={() => { setMode('signup'); setMsg({ text: '', type: '' }); }}
              >
                Student Sign Up
              </button>
            </div>
          ) : (
            <div style={{ marginBottom: 20 }}>
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setForgotStep(1);
                  setMsg({ text: '', type: '' });
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--primary-maroon)',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: 0,
                }}
              >
                &larr; Back to Sign In
              </button>
            </div>
          )}

          {msg.text && (
            <div className={`alert-box alert-${msg.type}`}>
              <span>{msg.text}</span>
            </div>
          )}

          {mode === 'forgot' ? (
            <>
              {forgotStep === 1 && (
                <form onSubmit={handleSendOtp}>
                  <div className="form-group">
                    <label className="form-label">User ID or Email Address</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 26MCA24 or student@cet.ac.in"
                      className="form-input"
                      value={resetEmail}
                      onChange={(e) => {
                        if (busy) setBusy(false);
                        setResetEmail(e.target.value);
                      }}
                    />
                  </div>

                  <button
                    type="submit"
                    className="btn-auth-submit"
                    disabled={busy}
                  >
                    {busy ? 'Sending OTP...' : 'Send Reset OTP to Email'}
                  </button>
                </form>
              )}

              {forgotStep === 2 && (
                <form onSubmit={handleVerifyOtp}>
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <label className="form-label" style={{ marginBottom: 0 }}>
                        OTP Verification Code
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setForgotStep(1);
                          setOtpCode('');
                          setMsg({ text: '', type: '' });
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-muted)',
                          fontSize: '0.8125rem',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                          padding: 0,
                        }}
                      >
                        Change Email
                      </button>
                    </div>
                    <input
                      type="text"
                      required
                      maxLength={10}
                      placeholder="Enter 6-digit OTP"
                      className="form-input"
                      style={{ textAlign: 'center', letterSpacing: '0.2em', fontSize: '1.125rem', fontWeight: 600 }}
                      value={otpCode}
                      onChange={(e) => {
                        if (busy) setBusy(false);
                        setOtpCode(e.target.value.trim());
                      }}
                    />
                  </div>

                  <button
                    type="submit"
                    className="btn-auth-submit"
                    disabled={busy}
                  >
                    {busy ? 'Verifying OTP...' : 'Verify OTP & Continue'}
                  </button>

                  <div style={{ marginTop: 14, textAlign: 'center', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                    Didn't receive the OTP?{' '}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleSendOtp}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--primary-maroon)',
                        fontWeight: 600,
                        cursor: 'pointer',
                        padding: 0,
                        textDecoration: 'underline',
                      }}
                    >
                      Resend Code
                    </button>
                  </div>
                </form>
              )}

              {forgotStep === 3 && (
                <form onSubmit={handleResetPassword}>
                  <div className="form-group">
                    <label className="form-label">New Password</label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      placeholder="At least 6 characters"
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
                    {busy ? 'Resetting Password...' : 'Reset & Save Password'}
                  </button>
                </form>
              )}
            </>
          ) : (
            <form onSubmit={handleSubmit}>
              {mode === 'signup' && (
                <>
                  <div className="form-group">
                    <label className="form-label">Full Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Kanimangalam Jagannathan Thampuran"
                      className="form-input"
                      value={form.full_name}
                      onChange={updateField('full_name')}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label"> Roll Number / UserID</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 26MCA24"
                      className="form-input"
                      value={form.roll_number}
                      onChange={updateField('roll_number')}
                    />
                  </div>
                </>
              )}

              <div className="form-group">
                <label className="form-label">
                  {mode === 'login' ? 'User ID or Email Address' : 'Email Address'}
                </label>
                <input
                  type="text"
                  required
                  placeholder={mode === 'login' ? 'student email' : 'jagannathan@yahoo.com'}
                  className="form-input"
                  value={form.identifier}
                  onChange={updateField('identifier')}
                />
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label className="form-label" style={{ marginBottom: 0 }}>Password</label>
                  {mode === 'login' && (
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setBusy(false);
                        setMsg({ text: '', type: '' });
                        const rawId = form.identifier.trim();
                        setResetEmail(rawId ? (rawId.includes('@') ? rawId : `${rawId}@cet.ac.in`) : '');
                        setForgotStep(1);
                        setMode('forgot');
                      }}
                      style={{
                        fontSize: '0.8125rem',
                        color: 'var(--primary-maroon)',
                        fontWeight: 600,
                        textDecoration: 'none',
                      }}
                    >
                      Forgot Password?
                    </a>
                  )}
                </div>
                <input
                  type="password"
                  required
                  minLength={6}
                  className="form-input"
                  value={form.password}
                  onChange={updateField('password')}
                />
              </div>

              <button
                type="submit"
                className="btn-auth-submit"
                disabled={busy}
              >
                {busy
                  ? 'Processing...'
                  : mode === 'login'
                  ? 'Sign In to Account'
                  : 'Create Student Account'}
              </button>
            </form>
          )}

          <div className="auth-switch-link">
            {mode === 'login' ? (
              <>
                <p>
                  New student without an account?{' '}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setBusy(false);
                      setMsg({ text: '', type: '' });
                      setMode('signup');
                    }}
                  >
                    Register here
                  </a>
                </p>
                <p style={{ marginTop: 8 }}>
                  Trouble signing in?{' '}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setBusy(false);
                      setMsg({ text: '', type: '' });
                      const rawId = form.identifier.trim();
                      setResetEmail(rawId ? (rawId.includes('@') ? rawId : `${rawId}@cet.ac.in`) : '');
                      setForgotStep(1);
                      setMode('forgot');
                    }}
                  >
                    Forgot password
                  </a>
                </p>
              </>
            ) : mode === 'signup' ? (
              <p>
                Already have an account?{' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setBusy(false);
                    setMsg({ text: '', type: '' });
                    setMode('login');
                  }}
                >
                  Sign in here
                </a>
              </p>
            ) : (
              <p>
                Remember your password?{' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setBusy(false);
                    setMsg({ text: '', type: '' });
                    setMode('login');
                    setForgotStep(1);
                  }}
                >
                  Return to sign in
                </a>
              </p>
            )}
          </div>

          <div style={{ marginTop: 24, textAlign: 'center' }}>
            <Link href="/" style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
              &larr; Return to Library Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
