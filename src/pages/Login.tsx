import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.');
      return;
    }
    setLoading(true);
    try {
      await login(email.trim(), password);
      nav('/', { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed. Check credentials.';
      if (msg.includes('configuration-not-found') || msg.includes('operation-not-allowed')) {
        setError('Authentication not configured. Please contact support.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-bg-orb login-bg-orb--1" />
      <div className="login-bg-orb login-bg-orb--2" />
      <div className="login-bg-orb login-bg-orb--3" />

      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo-wrap">
            <div className="login-logo">🍽️</div>
          </div>
          <h1>FOOD MELA</h1>
          <p>Operations Center</p>
        </div>

        <div className="login-header">
          <h2>Welcome back</h2>
          <p>Sign in to your admin workspace</p>
        </div>

        <form onSubmit={handleLogin} className="login-form">
          <label>
            <span className="login-label-row">
              <span className="login-label-icon">✉</span> Email Address
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@foodmela.com"
              autoComplete="email"
            />
          </label>

          <label>
            <span className="login-label-row">
              <span className="login-label-icon">◈</span> Password
            </span>
            <div className="pass-wrap">
              <input
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
              />
              <button type="button" className="show-pass" onClick={() => setShowPass(!showPass)}>
                {showPass ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
            {loading ? (
              <span className="login-btn-loading">
                <span className="login-btn-spinner" /> Signing in...
              </span>
            ) : (
              'Sign In →'
            )}
          </button>
        </form>

        <p className="login-foot">
          <span className="login-foot-dot" /> Secure access — all actions are audited
        </p>
      </div>
    </div>
  );
}
