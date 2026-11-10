import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import { getMe } from '../../services/api.js';
import { AuthCard } from './AuthCard.jsx';

// Who is signed in (FR-1). Every page except sign-in and "Not invited" sits
// inside RequireAuth, which asks the API once and sends a signed-out visitor
// to /signin. The cookie itself is httpOnly, so JavaScript never sees it.

const AuthContext = createContext(null);

/** @returns {{ user: { login: string, avatarUrl: string|null, installUrl: string, installations: { id: string, accountLogin: string }[] }, reload: () => Promise<void> }} */
export const useAuth = () => useContext(AuthContext);

export function RequireAuth({ children }) {
  const [state, setState] = useState({ loading: true, user: null, error: null });

  const reload = useCallback(async () => {
    try {
      setState({ loading: false, user: await getMe(), error: null });
    } catch (error) {
      setState({ loading: false, user: null, error });
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (state.loading) return <AuthCard>
      <p className="text-center text-body-md text-on-surface-variant">Loading…</p>
    </AuthCard>;
  if (!state.user) {
    if (state.error?.status === 401) return <Navigate to="/signin" replace />;
    return (
      <AuthCard>
        <p role="alert" className="text-center text-body-md text-error">
          {state.error?.message ?? 'Something went wrong'}
        </p>
      </AuthCard>
    );
  }
  return <AuthContext.Provider value={{ user: state.user, reload }}>{children}</AuthContext.Provider>;
}
