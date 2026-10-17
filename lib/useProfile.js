'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, isSupabaseConfigured } from './supabase';

/**
 * Hook to manage authentication and profile loading for protected routes.
 * @param {('librarian' | 'student' | null)} requiredRole - Optional role requirement.
 * @returns {{ profile: object | null, loading: boolean, isConfigured: boolean }}
 */
export function useProfile(requiredRole = null) {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function checkAuth() {
      // 1. Check live Supabase session first
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (session?.user && !sessionError) {
          const { data: profileData } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .maybeSingle();

          if (!mounted) return;

          const activeProfile = profileData || {
            id: session.user.id,
            email: session.user.email,
            full_name: session.user.user_metadata?.full_name || 'User',
            roll_number: session.user.user_metadata?.roll_number || '',
            role: session.user.user_metadata?.role || 'student',
          };

          if (requiredRole && activeProfile.role !== requiredRole) {
            router.replace(activeProfile.role === 'librarian' ? '/librarian' : '/student');
            return;
          }

          setProfile(activeProfile);
          setLoading(false);
          return;
        }
      } catch (err) {
        console.error('Supabase session check error:', err);
      }

      // 2. Check local fallback session
      try {
        const stored = typeof window !== 'undefined' ? localStorage.getItem('lms_local_profile') : null;
        if (stored) {
          const localProfile = JSON.parse(stored);
          if (localProfile?.role) {
            if (requiredRole && localProfile.role !== requiredRole) {
              router.replace(localProfile.role === 'librarian' ? '/librarian' : '/student');
              return;
            }
            if (mounted) {
              setProfile(localProfile);
              setLoading(false);
            }
            return;
          }
        }
      } catch (e) {
        console.error('Local session read error:', e);
      }

      // 3. Not authenticated
      if (mounted) {
        setProfile(null);
        setLoading(false);
        if (requiredRole) {
          router.replace('/login');
        }
      }
    }

    checkAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session && !localStorage.getItem('lms_local_profile')) {
        if (mounted) {
          setProfile(null);
          if (requiredRole) router.replace('/login');
        }
      } else {
        checkAuth();
      }
    });

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, [requiredRole, router]);

  return { profile, loading, isConfigured: isSupabaseConfigured };
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
  } else {
    window.location.href = '/login';
  }
}
