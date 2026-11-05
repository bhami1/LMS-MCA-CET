-- ==============================================================================
-- College of Engineering Trivandrum (CET) - Department Library Management System
-- Supabase Database Schema, Row Level Security (RLS), Triggers, and Functions
-- ==============================================================================

-- 1. PROFILES TABLE (Stores role, student roll number, and full name)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  roll_number TEXT UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('student', 'librarian')) DEFAULT 'student',
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. BOOKS TABLE
CREATE TABLE IF NOT EXISTS public.books (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  isbn TEXT,
  category TEXT,
  total_copies INTEGER NOT NULL DEFAULT 1 CHECK (total_copies >= 0),
  available_copies INTEGER NOT NULL DEFAULT 1 CHECK (available_copies >= 0 AND available_copies <= total_copies),
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. BORROWINGS TABLE
CREATE TABLE IF NOT EXISTS public.borrowings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  book_id BIGINT NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  issued_at DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL,
  returned_at DATE,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. RENEWAL REQUESTS TABLE
CREATE TABLE IF NOT EXISTS public.renewal_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  borrowing_id BIGINT NOT NULL REFERENCES public.borrowings(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  requested_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  reviewed_at TIMESTAMPTZ
);

-- Index to avoid duplicate pending renewal requests for the same borrowing
CREATE UNIQUE INDEX IF NOT EXISTS unique_pending_renewal_idx
  ON public.renewal_requests (borrowing_id)
  WHERE status = 'pending';

-- ==============================================================================
-- 5. AUTOMATIC PROFILE CREATION TRIGGER ON AUTH SIGNUP
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, roll_number, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Student User'),
    NEW.raw_user_meta_data->>'roll_number',
    COALESCE(NEW.raw_user_meta_data->>'role', 'student')
  )
  ON CONFLICT (id) DO UPDATE
  SET
    full_name = EXCLUDED.full_name,
    roll_number = EXCLUDED.roll_number;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ==============================================================================
-- 6. HELPER FUNCTION TO CHECK IF CURRENT AUTH USER IS LIBRARIAN
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.is_librarian()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'librarian'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ==============================================================================
-- 7. ROW LEVEL SECURITY (RLS) POLICIES
-- Ensures students CANNOT view other students' borrowing histories or renewal requests!
-- ==============================================================================

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.borrowings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.renewal_requests ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
CREATE POLICY "Public profiles can be read by own user or librarian"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id OR public.is_librarian());

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Books Policies (Readable by anyone; modifications only by librarian)
CREATE POLICY "Books are viewable by everyone"
  ON public.books FOR SELECT
  USING (true);

CREATE POLICY "Librarians can insert books"
  ON public.books FOR INSERT
  WITH CHECK (public.is_librarian());

CREATE POLICY "Librarians can update books"
  ON public.books FOR UPDATE
  USING (public.is_librarian());

CREATE POLICY "Librarians can delete books"
  ON public.books FOR DELETE
  USING (public.is_librarian());

-- Borrowings Policies (Strictly student self or librarian)
CREATE POLICY "Students see only own borrowings; librarians see all"
  ON public.borrowings FOR SELECT
  USING (student_id = auth.uid() OR public.is_librarian());

CREATE POLICY "Librarians can insert borrowings"
  ON public.borrowings FOR INSERT
  WITH CHECK (public.is_librarian());

CREATE POLICY "Librarians can update borrowings"
  ON public.borrowings FOR UPDATE
  USING (public.is_librarian());

CREATE POLICY "Librarians can delete borrowings"
  ON public.borrowings FOR DELETE
  USING (public.is_librarian());

-- Renewal Requests Policies
CREATE POLICY "Students see own renewal requests; librarians see all"
  ON public.renewal_requests FOR SELECT
  USING (student_id = auth.uid() OR public.is_librarian());

CREATE POLICY "Students can submit renewal requests for own borrowings"
  ON public.renewal_requests FOR INSERT
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "Librarians can update renewal requests"
  ON public.renewal_requests FOR UPDATE
  USING (public.is_librarian());

-- ==============================================================================
-- 8. DATABASE FUNCTIONS (RPC) FOR ATOMIC OPERATIONS
-- ==============================================================================

-- Issue Book: Decrements available copies and creates borrowing record
CREATE OR REPLACE FUNCTION public.issue_book_transaction(
  p_book_id BIGINT,
  p_student_id UUID,
  p_due_date DATE
)
RETURNS BIGINT AS $$
DECLARE
  v_available INTEGER;
  v_borrowing_id BIGINT;
BEGIN
  -- Check availability
  SELECT available_copies INTO v_available
  FROM public.books
  WHERE id = p_book_id
  FOR UPDATE;

  IF v_available IS NULL THEN
    RAISE EXCEPTION 'Book does not exist.';
  END IF;

  IF v_available <= 0 THEN
    RAISE EXCEPTION 'No available copies left for this book.';
  END IF;

  -- Decrement copy
  UPDATE public.books
  SET available_copies = available_copies - 1
  WHERE id = p_book_id;

  -- Create borrowing record
  INSERT INTO public.borrowings (book_id, student_id, due_date)
  VALUES (p_book_id, p_student_id, p_due_date)
  RETURNING id INTO v_borrowing_id;

  RETURN v_borrowing_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Return Book: Marks borrowing as returned and increments available copies
CREATE OR REPLACE FUNCTION public.return_book_transaction(
  p_borrowing_id BIGINT
)
RETURNS VOID AS $$
DECLARE
  v_book_id BIGINT;
  v_returned DATE;
BEGIN
  SELECT book_id, returned_at INTO v_book_id, v_returned
  FROM public.borrowings
  WHERE id = p_borrowing_id
  FOR UPDATE;

  IF v_book_id IS NULL THEN
    RAISE EXCEPTION 'Borrowing record does not exist.';
  END IF;

  IF v_returned IS NOT NULL THEN
    RAISE EXCEPTION 'Book has already been marked as returned.';
  END IF;

  -- Mark as returned
  UPDATE public.borrowings
  SET returned_at = CURRENT_DATE
  WHERE id = p_borrowing_id;

  -- Increment available copies
  UPDATE public.books
  SET available_copies = LEAST(total_copies, available_copies + 1)
  WHERE id = v_book_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Decide Renewal: Approves or rejects request
CREATE OR REPLACE FUNCTION public.decide_renewal(
  p_request_id BIGINT,
  p_approve BOOLEAN,
  p_extra_days INTEGER DEFAULT 14
)
RETURNS VOID AS $$
DECLARE
  v_borrowing_id BIGINT;
BEGIN
  SELECT borrowing_id INTO v_borrowing_id
  FROM public.renewal_requests
  WHERE id = p_request_id AND status = 'pending'
  FOR UPDATE;

  IF v_borrowing_id IS NULL THEN
    RAISE EXCEPTION 'Pending renewal request not found.';
  END IF;

  IF p_approve THEN
    -- Extend due date
    UPDATE public.borrowings
    SET due_date = due_date + (p_extra_days || ' days')::INTERVAL
    WHERE id = v_borrowing_id;

    UPDATE public.renewal_requests
    SET status = 'approved', reviewed_at = timezone('utc'::text, now())
    WHERE id = p_request_id;
  ELSE
    UPDATE public.renewal_requests
    SET status = 'rejected', reviewed_at = timezone('utc'::text, now())
    WHERE id = p_request_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


--
-- Sample Starter Books:
INSERT INTO public.books (title, author, isbn, category, total_copies, available_copies)
VALUES
  ('Introduction to Algorithms', 'Thomas H. Cormen, Charles E. Leiserson', '978-0262033848', 'Computer Science', 5, 5),
  ('Operating System Concepts', 'Abraham Silberschatz, Peter B. Galvin', '978-1118063330', 'Computer Science', 4, 4),
  ('Artificial Intelligence: A Modern Approach', 'Stuart Russell, Peter Norvig', '978-0136042594', 'Artificial Intelligence', 3, 3),
  ('Database System Concepts', 'Abraham Silberschatz, Henry F. Korth', '978-0073523323', 'Databases', 4, 4),
  ('Clean Code: A Handbook of Agile Software Craftsmanship', 'Robert C. Martin', '978-0132350884', 'Software Engineering', 3, 3)
ON CONFLICT DO NOTHING;
