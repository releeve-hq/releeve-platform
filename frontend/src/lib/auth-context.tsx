'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, ApiError } from './api';

export interface User {
  id: string;
  email: string;
  name: string;
  username?: string;
  avatar_url?: string;
  color?: string;
  availableBounties?: number;
  earnings?: number;
  activeContrib?: number;
  completedContrib?: number;
  pendingReviews?: number;
}

interface AuthContextType {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isVerificationSent: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<User>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isVerificationSent, setIsVerificationSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const loadUser = useCallback(async () => {
    const userData = await api.get<any>('/api/v1/users/me');
    const normalized: User = {
      id: userData.id,
      email: userData.email,
      name: userData.name || userData.email?.split('@')[0] || 'User',
      username: userData.username,
      avatar_url: userData.avatar_url,
      color: 'bg-violet-600',
      availableBounties: userData.available_bounties ?? 0,
      earnings: parseFloat(userData.total_earned_usdc) || 0,
      activeContrib: userData.active_contributions ?? 0,
      completedContrib: userData.bounties_completed || 0,
      pendingReviews: userData.pending_reviews ?? 0,
    };
    setUser(normalized);
    return normalized;
  }, []);

  useEffect(() => {
    const init = async () => {
      const token = localStorage.getItem('access_token');
      if (!token) {
        setIsLoading(false);
        return;
      }
      setAccessToken(token);
      try {
        await loadUser();
      } catch (err: any) {
        if (err instanceof ApiError && err.status === 401) {
          localStorage.removeItem('access_token');
          setAccessToken(null);
        }
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, [loadUser]);

  const login = async (email: string, password: string) => {
    setError(null);
    try {
      const data = await api.post<{ access_token: string; user_id: string }>(
        '/api/v1/auth/login',
        { email, password },
        { skipAuth: true }
      );
      localStorage.setItem('access_token', data.access_token);
      setAccessToken(data.access_token);
      await loadUser();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Login failed. Please try again.';
      setError(message);
      throw err;
    }
  };

  const signup = async (email: string, password: string) => {
    setError(null);
    setIsVerificationSent(false);
    try {
      await api.post<{ status: string }>(
        '/api/v1/auth/signup',
        { email, password },
        { skipAuth: true }
      );
      setIsVerificationSent(true);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Signup failed. Please try again.';
      setError(message);
      throw err;
    }
  };

  const logout = async () => {
    try {
      await api.post('/api/v1/auth/logout', undefined, { skipAuth: true });
    } catch {
      // Ignore errors on logout
    }
    localStorage.removeItem('access_token');
    setAccessToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{
      user,
      accessToken,
      isAuthenticated: !!user,
      isLoading,
      isVerificationSent,
      error,
      login,
      signup,
      logout,
      loadUser,
      clearError,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
