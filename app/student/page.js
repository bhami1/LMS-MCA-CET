'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useProfile, logout } from '@/lib/useProfile';

export default function StudentDashboard() {
  const router = useRouter();
  const { profile, loading: authLoading } = useProfile('student');
  const [loans, setLoans] = useState([]);
  const [renewals, setRenewals] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [alert, setAlert] = useState({ text: '', type: '' });
  const [busyId, setBusyId] = useState(null);
  const [today, setToday] = useState('');

  useEffect(() => {
    setToday(new Date().toISOString().slice(0, 10));
  }, []);

  const loadData = useCallback(async () => {
    if (!profile?.id) return;

    try {
      setDataLoading(true);

      // 1. Fetch borrowings for this student (try joined query, fallback to manual join)
      const { data: loanData, error: loanErr } = await supabase
        .from('borrowings')
        .select(`
          id,
          book_id,
          student_id,
          issued_at,
          due_date,
          returned_at,
          books (
            id,
            title,
            author,
            category
          )
        `)
        .eq('student_id', profile.id)
        .order('issued_at', { ascending: false });

      if (!loanErr && loanData) {
        setLoans(loanData);
      } else {
        // Fallback: Query borrowings directly and map books
        const { data: rawLoans } = await supabase
          .from('borrowings')
          .select('*')
          .eq('student_id', profile.id)
          .order('issued_at', { ascending: false });

        if (rawLoans) {
          const { data: allBooks } = await supabase.from('books').select('id, title, author, category');
          const bMap = Object.fromEntries((allBooks || []).map((b) => [b.id, b]));
          setLoans(rawLoans.map((r) => ({
            ...r,
            books: bMap[r.book_id] || { title: 'Book #' + r.book_id, author: '', category: '' },
          })));
        }
      }

      // 2. Fetch renewal requests for this student
      const { data: renewalData, error: renewalErr } = await supabase
        .from('renewal_requests')
        .select('*')
        .eq('student_id', profile.id)
        .order('requested_at', { ascending: false });

      if (!renewalErr && renewalData) {
        setRenewals(renewalData);
      }
    } catch (err) {
      console.error('Failed to load student borrowing records:', err);
    } finally {
      setDataLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    if (profile?.id) {
      loadData();
    }
  }, [profile, loadData]);

  // Request Renewal
  async function handleRequestRenewal(borrowingId) {
    setBusyId(borrowingId);
    setAlert({ text: '', type: '' });

    try {
      const { error } = await supabase.from('renewal_requests').insert({
        borrowing_id: borrowingId,
        student_id: profile.id,
      });

      if (error) {
        if (error.code === '23505' || error.message?.includes('unique_pending_renewal')) {
          setAlert({
            text: 'You already have a pending renewal request for this book awaiting librarian approval.',
            type: 'info',
          });
        } else {
          setAlert({ text: error.message, type: 'error' });
        }
      } else {
        setAlert({
          text: 'Renewal request submitted successfully! The librarian will review it shortly.',
          type: 'success',
        });
        loadData();
      }
    } catch (err) {
      console.error('Error submitting renewal request:', err);
      setAlert({ text: 'Failed to request renewal. Please try again.', type: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  const getLatestRenewal = (borrowingId) => {
    return renewals.find((r) => r.borrowing_id === borrowingId);
  };

  if (authLoading) {
    return (
      <div className="dashboard-container" style={{ textAlign: 'center', padding: '60px 0' }}>
        <h2>Loading Student Portal...</h2>
      </div>
    );
  }

  const activeLoans = loans.filter((b) => !b.returned_at);
  const overdueCount = activeLoans.filter((b) => today && b.due_date < today).length;
  const returnedCount = loans.filter((b) => b.returned_at).length;

  return (
    <div className="dashboard-container">
      {/* Topbar */}
      <div className="dashboard-topbar">
        <div className="dashboard-header-title">
          <h1>Student Library Portal</h1>
          <p>
            Welcome, <strong>{profile?.full_name}</strong> &bull; Roll Number: <code>{profile?.roll_number || 'N/A'}</code>
          </p>
        </div>
      </div>

      {/* Metrics */}
      <div className="stats-grid">
        <div className="stat-card gold">
          <div className="stat-label">Currently Borrowed</div>
          <div className="stat-value">{activeLoans.length}</div>
        </div>
        <div className="stat-card danger">
          <div className="stat-label">Overdue Books</div>
          <div className="stat-value">{overdueCount}</div>
        </div>
        <div className="stat-card success">
          <div className="stat-label">Total Returned</div>
          <div className="stat-value">{returnedCount}</div>
        </div>
      </div>

      {/* Alerts */}
      {alert.text && (
        <div className={`alert-box alert-${alert.type}`}>
          <span>{alert.text}</span>
          <button
            type="button"
            className="setup-dismiss-btn"
            onClick={() => setAlert({ text: '', type: '' })}
            aria-label="Dismiss alert"
          >
            ✕
          </button>
        </div>
      )}

      {/* Borrowing History Table */}
      <div className="card-panel">
        <div className="catalog-header">
          <h2 className="card-panel-title" style={{ margin: 0 }}>
            My Borrowing History & Renewal Requests
          </h2>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
              </span>
        </div>

        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>Book Title</th>
                <th>Author</th>
                <th>Category</th>
                <th>Issue Date</th>
                <th>Due Date</th>
                <th>Status</th>
                <th>Renewal</th>
              </tr>
            </thead>
            <tbody>
              {dataLoading && loans.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
                    Loading your borrowing records...
                  </td>
                </tr>
              ) : loans.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
                    <div>
                      <p style={{ fontWeight: 600, marginBottom: 6 }}>No book borrowings on record.</p>
                      <p style={{ fontSize: '0.875rem' }}>
                        Visit the department library to get books issued using your roll number (<code>{profile?.roll_number}</code>).
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                loans.map((b) => {
                  const req = getLatestRenewal(b.id);
                  const isReturned = Boolean(b.returned_at);
                  const isOverdue = !isReturned && today && b.due_date < today;

                  return (
                    <tr key={b.id}>
                      <td style={{ fontWeight: 600 }}>{b.books?.title}</td>
                      <td>{b.books?.author}</td>
                      <td>
                        <span className="badge badge-info">{b.books?.category || 'General'}</span>
                      </td>
                      <td>{b.issued_at}</td>
                      <td style={{ color: isOverdue ? 'var(--color-danger)' : 'inherit', fontWeight: isOverdue ? 700 : 400 }}>
                        {b.due_date} {isOverdue && '(Overdue)'}
                      </td>
                      <td>
                        {isReturned ? (
                          <span className="badge badge-muted">Returned on {b.returned_at}</span>
                        ) : isOverdue ? (
                          <span className="badge badge-danger">Overdue</span>
                        ) : (
                          <span className="badge badge-success">Active Loan</span>
                        )}
                      </td>
                      <td>
                        {isReturned ? (
                          <span style={{ color: 'var(--text-light)', fontSize: '0.8125rem' }}>—</span>
                        ) : req?.status === 'pending' ? (
                          <span className="badge badge-warning">Renewal Pending Review</span>
                        ) : (
                          <button
                            type="button"
                            className="btn-action-primary"
                            style={{ fontSize: '0.75rem', padding: '5px 10px' }}
                            onClick={() => handleRequestRenewal(b.id)}
                            disabled={busyId === b.id}
                          >
                            {busyId === b.id
                              ? 'Requesting...'
                              : req?.status === 'rejected'
                              ? 'Request Renewal (Last: Rejected)'
                              : 'Request Renewal (+14d)'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
