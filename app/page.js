'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function WelcomePage() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [books, setBooks] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Redirect logged-in users away from the home page
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
        console.error('Session check error on welcome page:', e);
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

      if (mounted) setCheckingAuth(false);
    }

    checkSession();
    return () => { mounted = false; };
  }, [router]);

  // Fetch catalog books directly from database
  useEffect(() => {
    async function fetchBooks() {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('books')
          .select('*')
          .order('title');

        if (!error && data) {
          setBooks(data);
        } else {
          // Fallback to local storage if available
          try {
            const stored = localStorage.getItem('lms_local_books');
            if (stored) setBooks(JSON.parse(stored));
          } catch (e) {}
        }
      } catch (err) {
        console.error('Failed to load books catalog preview:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchBooks();
  }, []);

  if (checkingAuth) {
    return (
      <div className="dashboard-container" style={{ textAlign: 'center', padding: '100px 20px' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9375rem' }}>Loading...</p>
      </div>
    );
  }

  const filteredBooks = books.filter((b) => 
    b.title.toLowerCase().includes(search.toLowerCase()) ||
    b.author.toLowerCase().includes(search.toLowerCase()) ||
    (b.category && b.category.toLowerCase().includes(search.toLowerCase()))
  );

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
            <Link href="#catalog" className="btn-secondary-action">
              Explore Catalog &darr;
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

        {/* Catalog Preview Section */}
        <section id="catalog" className="catalog-preview-card">
          <div className="catalog-header">
            <div>
              <h3>Department Book Catalog</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                Search books available in the department collection
              </p>
            </div>
            <div style={{ maxWidth: 300, width: '100%' }}>
              <input
                type="text"
                placeholder="Search by title, author, category..."
                className="form-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Author</th>
                  <th>Category</th>
                  <th>ISBN</th>
                  <th>Availability</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '24px' }}>
                      Loading catalog...
                    </td>
                  </tr>
                ) : filteredBooks.length > 0 ? (
                  filteredBooks.map((book) => (
                    <tr key={book.id}>
                      <td style={{ fontWeight: 600 }}>{book.title}</td>
                      <td>{book.author}</td>
                      <td>
                        <span className="badge badge-info">
                          {book.category || 'General'}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                        {book.isbn || '—'}
                      </td>
                      <td>
                        {book.available_copies > 0 ? (
                          <span className="badge badge-success">
                            {book.available_copies} of {book.total_copies} available
                          </span>
                        ) : (
                          <span className="badge badge-danger">All copies issued</span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                      No books found in the department catalog.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 20, textAlign: 'right' }}>
            <Link href="/login" className="btn-action-primary" style={{ display: 'inline-block' }}>
              Sign In to Borrow Books &rarr;
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
