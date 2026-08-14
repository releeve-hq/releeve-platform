'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, ApiError, clearTokenPair } from './api';

export interface User {
  id: string;
  email: string;
  name: string;
  username?: string;
  avatar_url?: string;
  color?: string;
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
    const userData = await api.get<any>('/api/v1/me');
    const normalized: User = {
      id: userData.id,
      email: userData.email,
      name: userData.name || userData.email?.split('@')[0] || 'User',
      username: userData.username,
      avatar_url: userData.avatar_url,
      color: 'bg-violet-600',
    };
    setUser(normalized);
    return normalized;
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        await loadUser();
        setAccessToken('cookie');
      } catch (err: any) {
        if (err instanceof ApiError && err.status === 401) {
          clearTokenPair();
          setAccessToken(null);
          setUser(null);
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
      await api.post(
        '/api/v1/auth/login',
        { email, password },
        { skipAuth: true }
      );
      setAccessToken('cookie');
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
    clearTokenPair();
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
