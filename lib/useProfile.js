
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, isSupabaseConfigured } from './supabase';

export function useProfile(requiredRole = null) {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function checkAuth() {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError || !session?.user) {
          if (mounted) {
            setProfile(null);
            setLoading(false);
            if (requiredRole) router.replace('/login');
          }
          return;
        }

        const { data: profileData, error: profileError } =
          await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .maybeSingle();

        if (!mounted) return;

        // Do not trust missing profiles or database errors.
        if (profileError || !profileData ||
            !['librarian', 'student'].includes(profileData.role)) {
          setProfile(null);
          setLoading(false);
          await supabase.auth.signOut();
          router.replace('/login');
          return;
        }

        // Check whether the authenticated user has the required role.
        if (requiredRole && profileData.role !== requiredRole) {
          setProfile(null);
          setLoading(false);

          router.replace(
            profileData.role === 'librarian'
              ? '/librarian'
              : '/student'
          );
          return;
        }

        setProfile(profileData);
        setLoading(false);

      } catch (err) {
        console.error('Authentication check failed:', err);

        if (mounted) {
          setProfile(null);
          setLoading(false);
          if (requiredRole) router.replace('/login');
        }
      }
    }

    checkAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        if (mounted) {
          setProfile(null);
          setLoading(false);
          if (requiredRole) router.replace('/login');
        }
      } else {
        checkAuth();
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [requiredRole, router]);

  return {
    profile,
    loading,
    isConfigured: isSupabaseConfigured,
  };
}

export async function logout(router) {
  try {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('lms_local_profile');
      localStorage.removeItem('lms_local_records');
      localStorage.removeItem('lms_local_requests');
    }

    await supabase.auth.signOut();

  } catch (err) {
    console.error('Error signing out:', err);
  }

  if (router) {
    router.replace('/login');
  } else if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}
