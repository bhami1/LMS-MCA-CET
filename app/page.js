'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
 
export default function WelcomePage() {
  const router = useRouter();
 
  // Non-blocking session check: redirect logged-in users away from the home page
  useEffect(() => {
    let mounted = true;
 
    async function checkSession() {
      // 1. Check Supabase session
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user && mounted) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', session.user.id)
            .maybeSingle();
          const role = profile?.role || session.user.user_metadata?.role || 'student';
          router.replace(role === 'librarian' ? '/librarian' : '/student');
          return;
        }
      } catch (e) {
        // Silently continue for unauthenticated visitors
      }
 
      // 2. Check local profile fallback
      try {
        const stored = typeof window !== 'undefined' ? localStorage.getItem('lms_local_profile') : null;
        if (stored) {
          const localProfile = JSON.parse(stored);
          if (localProfile?.role && mounted) {
            router.replace(localProfile.role === 'librarian' ? '/librarian' : '/student');
            return;
          }
        }
      } catch (e) {}
    }
 
    checkSession();
    return () => { mounted = false; };
  }, [router]);
 
  return (
    <div>
      {/* Front Page Hero with College Emblem and Campus Background Photo */}
      <section 
        className="hero-section"
        style={{ backgroundImage: `url('/images/login-page-background.png')` }}
      >
        <div className="hero-overlay" />
        <div className="hero-content">
          <div className="hero-emblem-badge">
            <Image
              src="/images/emblem.webp"
              alt="CET Emblem"
              width={88}
              height={88}
              className="hero-emblem-img"
              priority
            />
          </div>
 
          <h1 className="hero-title">College of Engineering Trivandrum</h1>
          <h2 className="hero-subtitle">Department Library Management System</h2>
 
          <div className="hero-quote-box">
            <p className="hero-quote-text">
              &ldquo;A room without books is like a body without a soul.&rdquo;
            </p>
            <span className="hero-quote-author">&mdash; Marcus Tullius Cicero</span>
          </div>
 
          <div className="hero-actions">
            <Link href="/login" className="btn-primary-action">
              Member Login / Sign Up &rarr;
            </Link>
          </div>
        </div>
      </section>
 
      {/* Feature Highlights & Library Info */}
      <div className="welcome-container">
        <div className="feature-cards-grid">
          <div className="feature-card">
            <span className="feature-card-number">01</span>
            <h3 className="feature-card-title">Comprehensive Catalog</h3>
            <p className="feature-card-desc">
              Browse textbooks, research literature, references, and journals curated for MCA and engineering excellence.
            </p>
          </div>
 
          <div className="feature-card">
            <span className="feature-card-number">02</span>
            <h3 className="feature-card-title">Easy Online Renewals</h3>
            <p className="feature-card-desc">
              Students can view due dates, track borrowing history, and submit book renewal requests directly from their portal.
            </p>
          </div>
 
          <div className="feature-card">
            <span className="feature-card-number">03</span>
            <h3 className="feature-card-title">Privacy & Security</h3>
            <p className="feature-card-desc">
              Row Level Security ensures students can only view their own borrowing records, with centralized oversight by the librarian.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}