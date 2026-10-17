'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { logout } from '@/lib/useProfile';

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function getNavUser() {
      // 1. Check Supabase session first
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user && mounted) {
          const { data } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .maybeSingle();

          setProfile(data || {
            id: session.user.id,
            role: session.user.user_metadata?.role || 'student',
            full_name: session.user.user_metadata?.full_name || 'User',
          });
          return;
        }
      } catch (err) {
        console.error('Navbar Supabase session error:', err);
      }

      // 2. Check local session fallback
      try {
        const stored = typeof window !== 'undefined' ? localStorage.getItem('lms_local_profile') : null;
        if (stored) {
          const localData = JSON.parse(stored);
          if (localData?.role && mounted) {
            setProfile(localData);
            return;
          }
        }
      } catch (e) {
        console.error('Navbar local session read error:', e);
      }

      if (mounted) setProfile(null);
    }

    getNavUser();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session && !localStorage.getItem('lms_local_profile')) {
        if (mounted) setProfile(null);
      } else {
        getNavUser();
      }
    });

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, [pathname]);

  const dashboardRoute = profile?.role === 'librarian' ? '/librarian' : '/student';

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href={profile ? dashboardRoute : "/"} className="brand-group">
          <div className="emblem-container">
            <Image
              src="/images/emblem.webp"
              alt="College of Engineering Trivandrum Emblem"
              width={52}
              height={52}
              className="college-emblem"
              priority
            />
          </div>
          <div className="brand-text">
            <span className="college-title">College of Engineering Trivandrum</span>
            <span className="dept-title">Department Library</span>
          </div>
        </Link>

        <nav className="nav-links">
          {!profile && (
            <Link href="/" className={`nav-link ${pathname === '/' ? 'active' : ''}`}>
              Home
            </Link>
          )}

          {profile?.role === 'librarian' ? (
            <Link
              href="/librarian"
              className={`nav-link ${pathname === '/librarian' ? 'active' : ''}`}
            >
              Librarian Dashboard
            </Link>
          ) : profile?.role === 'student' ? (
            <Link
              href="/student"
              className={`nav-link ${pathname === '/student' ? 'active' : ''}`}
            >
              Student Portal
            </Link>
          ) : null}

          {profile ? (
            <div className="user-badge-group">
              <span className="user-role-badge">
                {profile.role === 'librarian' ? 'Librarian' : 'Student'}
              </span>
              <button
                type="button"
                className="btn-logout"
                onClick={() => logout(router)}
              >
                Logout
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className={`nav-cta-btn ${pathname === '/login' ? 'active' : ''}`}
            >
              Sign In / Register
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
