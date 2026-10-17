'use client';
import { useEffect, useState, useCallback, useId } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useProfile, logout } from '@/lib/useProfile';

const getDefaultDueDate = (days = 14) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export default function LibrarianDashboard() {
  const router = useRouter();
  const { profile, loading: authLoading } = useProfile('librarian');
  const bookSelectId = useId();
  const rollNumberInputId = useId();
  const dueDateInputId = useId();

  const [activeTab, setActiveTab] = useState('books'); // 'books' | 'issue' | 'records' | 'renewals'
  const [books, setBooks] = useState([]);
  const [records, setRecords] = useState([]);
  const [requests, setRequests] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [alert, setAlert] = useState({ text: '', type: '' });
  const [busy, setBusy] = useState(false);

  // Search & Filter state
  const [bookSearch, setBookSearch] = useState('');
  const [recordFilter, setRecordFilter] = useState('all'); // 'all' | 'active' | 'overdue' | 'returned'
  const [recordSearch, setRecordSearch] = useState('');

  // Form states
  const [bookForm, setBookForm] = useState({
    title: '',
    author: '',
    isbn: '',
    category: '',
    copies: 1,
  });

  const [issueForm, setIssueForm] = useState({
    book_id: '',
    roll_number: '',
    due_date: '',
  });

  const [today, setToday] = useState('');

  useEffect(() => {
    const cur = new Date().toISOString().slice(0, 10);
    setToday(cur);
    setIssueForm((prev) => ({
      ...prev,
      due_date: prev.due_date || getDefaultDueDate(14),
    }));
  }, []);

  // Fetch live database records with resilient fallbacks
  const loadData = useCallback(async () => {
    try {
      setDataLoading(true);

      // 1. Load books directly from database
      const { data: bData, error: bErr } = await supabase
        .from('books')
        .select('*')
        .order('title');

      if (!bErr && bData) {
        setBooks(bData);
        try {
          localStorage.setItem('lms_local_books', JSON.stringify(bData));
        } catch (e) {}
      } else if (bErr) {
        console.error('Books query error:', bErr);
        try {
          const stored = localStorage.getItem('lms_local_books');
          if (stored) setBooks(JSON.parse(stored));
        } catch (e) {}
      }

      // 2. Load borrowings (Try joined query, fallback to manual join if PostgREST cache differs)
      const { data: rData, error: rErr } = await supabase
        .from('borrowings')
        .select(`
          id,
          book_id,
          student_id,
          issued_at,
          due_date,
          returned_at,
          books (id, title, author),
          profiles (id, full_name, roll_number)
        `)
        .order('issued_at', { ascending: false });

      if (!rErr && rData) {
        setRecords(rData);
      } else {
        // Fallback: Query borrowings and map books & profiles
        const { data: rawLoans } = await supabase
          .from('borrowings')
          .select('*')
          .order('issued_at', { ascending: false });

        if (rawLoans) {
          const { data: allBooks } = await supabase.from('books').select('id, title, author');
          const { data: allProfiles } = await supabase.from('profiles').select('id, full_name, roll_number');
          const bMap = Object.fromEntries((allBooks || []).map((b) => [b.id, b]));
          const pMap = Object.fromEntries((allProfiles || []).map((p) => [p.id, p]));

          setRecords(rawLoans.map((r) => ({
            ...r,
            books: bMap[r.book_id] || { title: 'Book #' + r.book_id, author: '' },
            profiles: pMap[r.student_id] || { full_name: 'Student', roll_number: r.student_id },
          })));
        }
      }

      // 3. Load pending renewal requests (Try joined query, fallback to manual join)
      const { data: qData, error: qErr } = await supabase
        .from('renewal_requests')
        .select(`
          id,
          borrowing_id,
          student_id,
          status,
          requested_at,
          profiles (full_name, roll_number),
          borrowings (
            due_date,
            books (title)
          )
        `)
        .eq('status', 'pending')
        .order('requested_at', { ascending: true });

      if (!qErr && qData) {
        setRequests(qData);
      } else {
        const { data: rawReqs } = await supabase
          .from('renewal_requests')
          .select('*')
          .eq('status', 'pending')
          .order('requested_at', { ascending: true });

        if (rawReqs) {
          const { data: allProfiles } = await supabase.from('profiles').select('id, full_name, roll_number');
          const { data: allLoans } = await supabase.from('borrowings').select('id, due_date, book_id');
          const { data: allBooks } = await supabase.from('books').select('id, title');
          const pMap = Object.fromEntries((allProfiles || []).map((p) => [p.id, p]));
          const lMap = Object.fromEntries((allLoans || []).map((l) => [l.id, l]));
          const bMap = Object.fromEntries((allBooks || []).map((b) => [b.id, b]));

          setRequests(rawReqs.map((q) => {
            const loan = lMap[q.borrowing_id];
            return {
              ...q,
              profiles: pMap[q.student_id] || { full_name: 'Student', roll_number: q.student_id },
              borrowings: loan ? {
                due_date: loan.due_date,
                books: bMap[loan.book_id] || { title: 'Book' },
              } : null,
            };
          }));
        }
      }
    } catch (err) {
      console.error('Error fetching librarian data:', err);
    } finally {
      setDataLoading(false);
    }
  }, []);

  // Fetch immediately on mount and when profile changes
  useEffect(() => {
    loadData();
  }, [loadData, profile]);

  const notify = (error, successMsg) => {
    if (error) {
      setAlert({ text: error.message || 'An error occurred.', type: 'error' });
    } else {
      setAlert({ text: successMsg, type: 'success' });
    }
    loadData();
  };

  // Add Book
  async function handleAddBook(e) {
    e.preventDefault();
    setBusy(true);
    setAlert({ text: '', type: '' });

    const copies = parseInt(bookForm.copies, 10) || 1;
    const newBook = {
      title: bookForm.title.trim(),
      author: bookForm.author.trim(),
      isbn: bookForm.isbn.trim() || null,
      category: bookForm.category.trim() || null,
      total_copies: copies,
      available_copies: copies,
    };

    const { error } = await supabase.from('books').insert(newBook);
    if (!error) {
      setBookForm({ title: '', author: '', isbn: '', category: '', copies: 1 });
    } else {
      try {
        const stored = localStorage.getItem('lms_local_books');
        const currentList = stored ? JSON.parse(stored) : books;
        const updatedList = [{ ...newBook, id: Date.now() }, ...currentList];
        setBooks(updatedList);
        localStorage.setItem('lms_local_books', JSON.stringify(updatedList));
      } catch (e) {}
    }
    setBusy(false);
    notify(error, 'Book added to library catalog.');
  }

  // Delete Book
  async function handleDeleteBook(id, title) {
    if (!confirm(`Are you sure you want to remove "${title}" from the library?`)) return;
    setBusy(true);

    const { error } = await supabase.from('books').delete().eq('id', id);
    try {
      const stored = localStorage.getItem('lms_local_books');
      if (stored) {
        const currentList = JSON.parse(stored);
        const filtered = currentList.filter((b) => b.id !== id);
        localStorage.setItem('lms_local_books', JSON.stringify(filtered));
      }
    } catch (e) {}
    setBusy(false);
    notify(error, `Book "${title}" deleted.`);
  }

  // Issue Book
  async function handleIssueBook(e) {
    e.preventDefault();
    setBusy(true);
    setAlert({ text: '', type: '' });

    const roll = issueForm.roll_number.trim();
    const bookId = Number(issueForm.book_id);
    const chosenBook = books.find((b) => b.id === bookId);

    if (!chosenBook || chosenBook.available_copies <= 0) {
      setAlert({ text: 'Selected book is currently out of stock.', type: 'error' });
      setBusy(false);
      return;
    }

    // Lookup student by roll number
    const { data: student, error: studentErr } = await supabase
      .from('profiles')
      .select('id, full_name')
      .ilike('roll_number', roll)
      .maybeSingle();

    if (studentErr || !student) {
      setAlert({
        text: `No student found with roll number "${roll}". Ensure the student has registered their account first.`,
        type: 'error',
      });
      setBusy(false);
      return;
    }

    // Try RPC procedure first
    const { error: rpcErr } = await supabase.rpc('issue_book_transaction', {
      p_book_id: bookId,
      p_student_id: student.id,
      p_due_date: issueForm.due_date,
    });

    if (rpcErr) {
      // Fallback: Direct insert and update
      const { error: insertErr } = await supabase.from('borrowings').insert({
        book_id: bookId,
        student_id: student.id,
        due_date: issueForm.due_date,
      });

      if (!insertErr) {
        await supabase
          .from('books')
          .update({ available_copies: chosenBook.available_copies - 1 })
          .eq('id', bookId);
      }
      setBusy(false);
      notify(insertErr, `Book issued to ${student.full_name} (${roll}).`);
    } else {
      setBusy(false);
      notify(null, `Book issued to ${student.full_name} (${roll}).`);
    }

    setIssueForm({ book_id: '', roll_number: '', due_date: getDefaultDueDate(14) });
  }

  // Mark Book Returned
  async function handleMarkReturned(recordId, bookId) {
    setBusy(true);

    const { error: rpcErr } = await supabase.rpc('return_book_transaction', {
      p_borrowing_id: recordId,
    });

    if (rpcErr) {
      const returnDate = today || new Date().toISOString().slice(0, 10);
      const { error: updateErr } = await supabase
        .from('borrowings')
        .update({ returned_at: returnDate })
        .eq('id', recordId);

      if (!updateErr && bookId) {
        const { data: b } = await supabase.from('books').select('available_copies, total_copies').eq('id', bookId).single();
        if (b) {
          await supabase
            .from('books')
            .update({ available_copies: Math.min(b.total_copies, b.available_copies + 1) })
            .eq('id', bookId);
        }
      }
      setBusy(false);
      notify(updateErr, 'Book marked as returned and inventory updated.');
    } else {
      setBusy(false);
      notify(null, 'Book marked as returned and inventory updated.');
    }
  }

  // Manage Renewal Decision
  async function handleDecideRenewal(requestId, approve) {
    setBusy(true);

    const { error } = await supabase.rpc('decide_renewal', {
      p_request_id: requestId,
      p_approve: approve,
      p_extra_days: 14,
    });

    if (error) {
      if (approve) {
        const { data: req } = await supabase.from('renewal_requests').select('borrowing_id').eq('id', requestId).single();
        if (req) {
          const { data: b } = await supabase.from('borrowings').select('due_date').eq('id', req.borrowing_id).single();
          if (b) {
            const cur = new Date(b.due_date);
            cur.setDate(cur.getDate() + 14);
            await supabase.from('borrowings').update({ due_date: cur.toISOString().slice(0, 10) }).eq('id', req.borrowing_id);
          }
        }
      }
      await supabase.from('renewal_requests').update({
        status: approve ? 'approved' : 'rejected',
        reviewed_at: new Date().toISOString(),
      }).eq('id', requestId);
    }

    setBusy(false);
    notify(null, approve ? 'Renewal approved (+14 days).' : 'Renewal request rejected.');
  }

  if (authLoading) {
    return (
      <div className="dashboard-container" style={{ textAlign: 'center', padding: '60px 0' }}>
        <h2>Loading Librarian Portal...</h2>
      </div>
    );
  }

  // Stats calculations
  const totalBooksCount = books.reduce((acc, b) => acc + (b.total_copies || 0), 0);
  const availableBooksCount = books.reduce((acc, b) => acc + (b.available_copies || 0), 0);
  const activeBorrowingsCount = records.filter((r) => !r.returned_at).length;
  const overdueBorrowingsCount = records.filter((r) => !r.returned_at && today && r.due_date < today).length;

  // Filtered records
  const filteredRecords = records.filter((r) => {
    const isReturned = Boolean(r.returned_at);
    const isOverdue = !isReturned && today && r.due_date < today;
    const isActive = !isReturned;

    if (recordFilter === 'active' && !isActive) return false;
    if (recordFilter === 'overdue' && !isOverdue) return false;
    if (recordFilter === 'returned' && !isReturned) return false;

    if (recordSearch) {
      const q = recordSearch.toLowerCase();
      const titleMatch = r.books?.title?.toLowerCase().includes(q);
      const studentMatch = r.profiles?.full_name?.toLowerCase().includes(q) || r.profiles?.roll_number?.toLowerCase().includes(q);
      return titleMatch || studentMatch;
    }
    return true;
  });

  const filteredBooks = books.filter((b) => {
    if (!bookSearch) return true;
    const q = bookSearch.toLowerCase();
    return b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q) || (b.category && b.category.toLowerCase().includes(q));
  });

  return (
    <div className="dashboard-container">
      {/* Topbar */}
      <div className="dashboard-topbar">
        <div className="dashboard-header-title">
          <h1>Librarian Management Portal</h1>
          <p>
            Logged in as <strong>{profile?.full_name || 'MCA Department Librarian'}</strong> &bull; User ID: <code>librarianmcadepartment</code>
          </p>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Titles & Copies</div>
          <div className="stat-value">{books.length} <span style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--text-muted)' }}>({totalBooksCount} copies)</span></div>
        </div>
        <div className="stat-card success">
          <div className="stat-label">Available on Shelves</div>
          <div className="stat-value">{availableBooksCount}</div>
        </div>
        <div className="stat-card gold">
          <div className="stat-label">Active Loans</div>
          <div className="stat-value">{activeBorrowingsCount}</div>
        </div>
        <div className="stat-card danger">
          <div className="stat-label">Overdue Books</div>
          <div className="stat-value">{overdueBorrowingsCount}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="dashboard-tabs">
        <button
          type="button"
          className={`dash-tab-btn ${activeTab === 'books' ? 'active' : ''}`}
          onClick={() => { setActiveTab('books'); setAlert({ text: '', type: '' }); }}
        >
          Book Collection
        </button>
        <button
          type="button"
          className={`dash-tab-btn ${activeTab === 'issue' ? 'active' : ''}`}
          onClick={() => { setActiveTab('issue'); setAlert({ text: '', type: '' }); }}
        >
          Issue Book
        </button>
        <button
          type="button"
          className={`dash-tab-btn ${activeTab === 'records' ? 'active' : ''}`}
          onClick={() => { setActiveTab('records'); setAlert({ text: '', type: '' }); }}
        >
          Borrowing Records
        </button>
        <button
          type="button"
          className={`dash-tab-btn ${activeTab === 'renewals' ? 'active' : ''}`}
          onClick={() => { setActiveTab('renewals'); setAlert({ text: '', type: '' }); }}
        >
          Renewals {requests.length > 0 && <span className="dash-badge-count">{requests.length}</span>}
        </button>
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

      {/* TAB 1: Books Management */}
      {activeTab === 'books' && (
        <>
          <div className="card-panel">
            <h2 className="card-panel-title">Add New Book to Department Library</h2>
            <form onSubmit={handleAddBook}>
              <div className="grid-form-row">
                <div>
                  <label className="form-label">Book Title *</label>
                  <input
                    required
                    placeholder="e.g. Modern Operating Systems"
                    className="form-input"
                    value={bookForm.title}
                    onChange={(e) => setBookForm({ ...bookForm, title: e.target.value })}
                  />
                </div>
                <div>
                  <label className="form-label">Author(s) *</label>
                  <input
                    required
                    placeholder="e.g. Andrew S. Tanenbaum"
                    className="form-input"
                    value={bookForm.author}
                    onChange={(e) => setBookForm({ ...bookForm, author: e.target.value })}
                  />
                </div>
                <div>
                  <label className="form-label">Category</label>
                  <input
                    placeholder="e.g. Operating Systems"
                    className="form-input"
                    value={bookForm.category}
                    onChange={(e) => setBookForm({ ...bookForm, category: e.target.value })}
                  />
                </div>
                <div>
                  <label className="form-label">ISBN</label>
                  <input
                    placeholder="978-0133591620"
                    className="form-input"
                    value={bookForm.isbn}
                    onChange={(e) => setBookForm({ ...bookForm, isbn: e.target.value })}
                  />
                </div>
                <div style={{ maxWidth: 140 }}>
                  <label className="form-label">Total Copies *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    className="form-input"
                    value={bookForm.copies}
                    onChange={(e) => setBookForm({ ...bookForm, copies: e.target.value })}
                  />
                </div>
              </div>
              <button
                type="submit"
                className="btn-action-primary"
                disabled={busy}
              >
                {busy ? 'Adding...' : '+ Add Book to Catalog'}
              </button>
            </form>
          </div>

          <div className="card-panel">
            <div className="catalog-header">
              <h2 className="card-panel-title" style={{ margin: 0 }}>Department Inventory ({filteredBooks.length} titles)</h2>
              <div style={{ maxWidth: 300, width: '100%' }}>
                <input
                  type="text"
                  placeholder="Filter by title, author..."
                  className="form-input"
                  value={bookSearch}
                  onChange={(e) => setBookSearch(e.target.value)}
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
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {dataLoading && books.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                        Fetching books from database...
                      </td>
                    </tr>
                  ) : filteredBooks.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                        No books found in database.
                      </td>
                    </tr>
                  ) : (
                    filteredBooks.map((b) => (
                      <tr key={b.id}>
                        <td style={{ fontWeight: 600 }}>{b.title}</td>
                        <td>{b.author}</td>
                        <td><span className="badge badge-info">{b.category || 'General'}</span></td>
                        <td style={{ color: 'var(--text-muted)' }}>{b.isbn || '—'}</td>
                        <td>
                          <span className={`badge ${b.available_copies > 0 ? 'badge-success' : 'badge-danger'}`}>
                            {b.available_copies} / {b.total_copies} available
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn-action-danger"
                            onClick={() => handleDeleteBook(b.id, b.title)}
                            disabled={busy}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* TAB 2: Issue Book */}
      {activeTab === 'issue' && (
        <div className="card-panel" style={{ maxWidth: 600, margin: '0 auto' }}>
          <h2 className="card-panel-title">Issue Book to Student</h2>
          <form onSubmit={handleIssueBook}>
            <div className="form-group">
              <label htmlFor={bookSelectId} className="form-label">Select Book *</label>
              <select
                id={bookSelectId}
                required
                className="form-select"
                value={issueForm.book_id}
                onChange={(e) => setIssueForm({ ...issueForm, book_id: e.target.value })}
              >
                <option value="">Choose an available book...</option>
                {books
                  .filter((b) => b.available_copies > 0)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title} by {b.author} ({b.available_copies} available)
                    </option>
                  ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor={rollNumberInputId} className="form-label">Student Roll Number *</label>
              <input
                id={rollNumberInputId}
                required
                placeholder="e.g. 23MCA104"
                className="form-input"
                value={issueForm.roll_number}
                onChange={(e) => setIssueForm({ ...issueForm, roll_number: e.target.value })}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Enter the student&apos;s registered roll number.
              </span>
            </div>

            <div className="form-group">
              <label htmlFor={dueDateInputId} className="form-label">Due Date *</label>
              <input
                id={dueDateInputId}
                type="date"
                required
                className="form-input"
                value={issueForm.due_date}
                onChange={(e) => setIssueForm({ ...issueForm, due_date: e.target.value })}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Default is set to 14 days from today.
              </span>
            </div>

            <button
              type="submit"
              className="btn-action-primary"
              style={{ width: '100%', marginTop: 8 }}
              disabled={busy}
            >
              {busy ? 'Issuing...' : 'Issue Book to Student'}
            </button>
          </form>
        </div>
      )}

      {/* TAB 3: Borrowing Records */}
      {activeTab === 'records' && (
        <div className="card-panel">
          <div className="catalog-header">
            <div>
              <h2 className="card-panel-title" style={{ margin: 0 }}>Borrowing Records History</h2>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {['all', 'active', 'overdue', 'returned'].map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`btn-action-sm ${recordFilter === f ? 'btn-action-primary' : ''}`}
                    onClick={() => setRecordFilter(f)}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ maxWidth: 300, width: '100%' }}>
              <input
                type="text"
                placeholder="Search by book or student..."
                className="form-input"
                value={recordSearch}
                onChange={(e) => setRecordSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Book</th>
                  <th>Student</th>
                  <th>Roll No</th>
                  <th>Issued Date</th>
                  <th>Due Date</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {dataLoading && records.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                      Fetching borrowing records from database...
                    </td>
                  </tr>
                ) : filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                      No borrowing records found.
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((r) => {
                    const isReturned = Boolean(r.returned_at);
                    const isOverdue = !isReturned && today && r.due_date < today;

                    return (
                      <tr key={r.id}>
                        <td style={{ fontWeight: 600 }}>{r.books?.title}</td>
                        <td>{r.profiles?.full_name}</td>
                        <td><code>{r.profiles?.roll_number}</code></td>
                        <td>{r.issued_at}</td>
                        <td style={{ color: isOverdue ? 'var(--color-danger)' : 'inherit', fontWeight: isOverdue ? 700 : 400 }}>
                          {r.due_date}
                        </td>
                        <td>
                          {isReturned ? (
                            <span className="badge badge-muted">Returned ({r.returned_at})</span>
                          ) : isOverdue ? (
                            <span className="badge badge-danger">Overdue</span>
                          ) : (
                            <span className="badge badge-success">Active Loan</span>
                          )}
                        </td>
                        <td>
                          {!isReturned && (
                            <button
                              type="button"
                              className="btn-action-success"
                              onClick={() => handleMarkReturned(r.id, r.book_id)}
                              disabled={busy}
                            >
                              Mark Returned
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
      )}

      {/* TAB 4: Renewal Requests */}
      {activeTab === 'renewals' && (
        <div className="card-panel">
          <h2 className="card-panel-title">
            Pending Book Renewal Requests ({requests.length})
          </h2>

          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Roll No</th>
                  <th>Book</th>
                  <th>Current Due Date</th>
                  <th>Requested On</th>
                  <th>Decisions</th>
                </tr>
              </thead>
              <tbody>
                {dataLoading && requests.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                      Fetching renewal requests from database...
                    </td>
                  </tr>
                ) : requests.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                      No pending renewal requests at this moment.
                    </td>
                  </tr>
                ) : (
                  requests.map((q) => (
                    <tr key={q.id}>
                      <td style={{ fontWeight: 600 }}>{q.profiles?.full_name}</td>
                      <td><code>{q.profiles?.roll_number}</code></td>
                      <td>{q.borrowings?.books?.title}</td>
                      <td>{q.borrowings?.due_date}</td>
                      <td>{new Date(q.requested_at).toLocaleDateString()}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            type="button"
                            className="btn-action-success"
                            onClick={() => handleDecideRenewal(q.id, true)}
                            disabled={busy}
                          >
                            Approve (+14d)
                          </button>
                          <button
                            type="button"
                            className="btn-action-danger"
                            onClick={() => handleDecideRenewal(q.id, false)}
                            disabled={busy}
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}