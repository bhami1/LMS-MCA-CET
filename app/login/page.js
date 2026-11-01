'use client';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [form, setForm] = useState({
    identifier: '', // email or user id
    password: '',
    full_name: '',
    roll_number: '',
  });
  const [msg, setMsg] = useState({ text: '', type: '' });
  const [busy, setBusy] = useState(false);

  // If already logged in, redirect to dashboard immediately
  useEffect(() => {
    async function checkExistingSession() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', session.user.id)
            .maybeSingle();
          const role = profile?.role || session.user.user_metadata?.role || 'student';
          router.replace(role === 'librarian' ? '/librarian' : '/student');
          return;
        }
      } catch (e) {}

      try {
        const stored = typeof window !== 'undefined' ? localStorage.getItem('lms_local_profile') : null;
        if (stored) {
          const localProfile = JSON.parse(stored);
          if (localProfile?.role) {
            router.replace(localProfile.role === 'librarian' ? '/librarian' : '/student');
          }
        }
      } catch (e) {}
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

    // Safety timeout: ensures button never remains stuck longer than 8 seconds
    const safetyTimer = setTimeout(() => {
      setBusy(false);
    }, 8000);

    try {
      const rawId = form.identifier.trim();
      const isLibrarianCreds =
        (rawId.toLowerCase() === 'librarianmcadepartment' ||
          rawId.toLowerCase() === 'librarianmcadepartment@cet.ac.in') &&
        form.password === '2628MCALIB';

      // 1. Handling for Designated Librarian Credentials
      if (isLibrarianCreds) {
        const email = 'librarianmcadepartment@cet.ac.in';
        let librarianProfile = {
          id: 'librarian-mca-dept',
          full_name: 'MCA Department Librarian',
          roll_number: 'LIB-MCA-01',
          role: 'librarian',
          email,
        };

        // Authenticate with Supabase with timeout protection
        try {
          let { data: authData, error: signInErr } = await withTimeout(
            supabase.auth.signInWithPassword({
              email,
              password: form.password,
            }),
            5000
          );

          if (signInErr) {
            // Attempt signup if user not created yet
            const { data: signUpData, error: signUpErr } = await withTimeout(
              supabase.auth.signUp({
                email,
                password: form.password,
                options: {
                  data: {
                    full_name: 'MCA Department Librarian',
                    roll_number: 'LIB-MCA-01',
                    role: 'librarian',
                  },
                },
              }),
              5000
            );

            if (!signUpErr && signUpData?.user) {
              authData = signUpData;
            }
          }

          if (authData?.user) {
            librarianProfile.id = authData.user.id;
            // Ensure profile role is librarian
            await withTimeout(
              supabase.from('profiles').upsert({
                id: authData.user.id,
                full_name: 'MCA Department Librarian',
                roll_number: 'LIB-MCA-01',
                role: 'librarian',
              }),
              4000
            );
          }
        } catch (supaErr) {
          console.warn('Supabase librarian authentication note:', supaErr);
        }

        // Save session
        if (typeof window !== 'undefined') {
          localStorage.setItem('lms_local_profile', JSON.stringify(librarianProfile));
        }

        setMsg({ text: 'Librarian access granted! Redirecting...', type: 'success' });
        router.replace('/librarian');
        return;
      }

      // 2. Standard Student or Staff Authentication via Supabase
      const emailToUse = rawId.includes('@') ? rawId : `${rawId}@cet.ac.in`;

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
      } else {
        // Sign In
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
          setMsg({ text: 'Unable to authenticate. Please check your credentials.', type: 'error' });
          return;
        }

        // Check user role from profiles table
        let role = data.user.user_metadata?.role || 'student';
        try {
          const { data: profile } = await withTimeout(
            supabase
              .from('profiles')
              .select('role')
              .eq('id', data.user.id)
              .maybeSingle(),
            4000
          );
          if (profile?.role) role = profile.role;
        } catch (pe) {
          console.warn('Profile role fetch note:', pe);
        }

        router.replace(role === 'librarian' ? '/librarian' : '/student');
      }
    } catch (err) {
      console.error('Authentication error:', err);
      setMsg({
        text: err?.message || 'Authentication error occurred. Please verify your credentials.',
        type: 'error',
      });
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
            <h2>{mode === 'login' ? 'Portal Login' : 'Student Registration'}</h2>
            <p>
              {mode === 'login'
                ? 'Sign in to access student borrowings or librarian management'
                : 'Create a student library account using your institutional credentials'}
            </p>
          </div>

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

          {msg.text && (
            <div className={`alert-box alert-${msg.type}`}>
              <span>{msg.text}</span>
            </div>
          )}

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
              <label className="form-label">Password</label>
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

          <div className="auth-switch-link">
            {mode === 'login' ? (
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
            ) : (
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
