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
          <h2 className="hero-subtitle">MCA Department Library Management System</h2>
 
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
            <h3 className="feature-card-title">Vision</h3>
            <p className="feature-card-desc">
              The Department Library at CET is dedicated to providing students with a comprehensive collection of academic resources, fostering a culture of learning, and supporting research and innovation in the field of computer applications.
            </p>
          </div>
 
          <div className="feature-card">
            <span className="feature-card-number">02</span>
            <h3 className="feature-card-title">Mission</h3>
            <p className="feature-card-desc">
              Our mission is to empower students with access to a diverse range of books, journals, and digital resources, while promoting responsible borrowing practices and ensuring the library remains a welcoming space for academic growth and collaboration.
            </p>
          </div>
 
          <div className="feature-card">
            <span className="feature-card-number">03</span>
            <h3 className="feature-card-title">Working Hours</h3>
            <p className="feature-card-desc">
              Library is open everyday from 12-1pm and 4-5pm. It is also open during every free hours. We are ready to open the library other than the working hours if you request us. Please contact the librarian for any special requests or assistance.Thankyou. 
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}