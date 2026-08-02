"use client";

export default function TempSignupPage() {
  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* ---------- LEFT: form ---------- */}
      <div style={{
        width: '40%',
        minWidth: 400,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '2.5rem 6vw 4rem',
        height: '100vh',
        overflowY: 'auto',
        background: '#0a0a0a',
        color: '#fff',
      }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <div style={{
            fontSize: 26,
            lineHeight: 1,
            color: '#fff',
            marginBottom: '2.5rem',
          }}>
            &infin;
          </div>

          <h1 style={{
            fontSize: 30,
            fontWeight: 500,
            letterSpacing: '-0.02em',
            color: '#fff',
          }}>Sign up</h1>
          <p style={{
            color: '#9a9a95',
            fontSize: 15,
            marginTop: 8,
            marginBottom: '2.25rem',
          }}>Create your account</p>

          {/* GitHub OAuth */}
          <div style={{ position: 'relative', marginBottom: 14 }}>
            <span style={{
              position: 'absolute',
              top: -10,
              right: 12,
              background: '#d4f000',
              color: '#1a1a00',
              fontSize: 10.5,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 999,
            }}>Recommended</span>
            <button style={{
              width: '100%',
              height: 46,
              lineHeight: '46px',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 500,
              background: '#161613',
              border: '1px solid #2c2c28',
              color: '#f2f2ec',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              cursor: 'pointer',
              transition: 'border-color .15s ease, background .15s ease',
            }}
              onMouseEnter={e => { e.currentTarget.style.background = '#1c1c18'; e.currentTarget.style.borderColor = '#45453e'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#161613'; e.currentTarget.style.borderColor = '#2c2c28'; }}
            >
              <svg viewBox="0 0 24 24" fill="#f2f2ec" width={17} height={17}>
                <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.7-1.4-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.4-1.4-5.4-6a4.7 4.7 0 0 1 1.2-3.2 4.3 4.3 0 0 1 .1-3.2s1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.2a4.7 4.7 0 0 1 1.2 3.2c0 4.6-2.8 5.7-5.5 6 .5.4.9 1.1.9 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3Z" />
              </svg>
              Continue with GitHub
            </button>
          </div>

          {/* Google OAuth */}
          <button style={{
            width: '100%',
            height: 46,
            lineHeight: '46px',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 500,
            background: '#161613',
            border: '1px solid #2c2c28',
            color: '#f2f2ec',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            cursor: 'pointer',
            marginBottom: 14,
            transition: 'border-color .15s ease, background .15s ease',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = '#1c1c18'; e.currentTarget.style.borderColor = '#45453e'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#161613'; e.currentTarget.style.borderColor = '#2c2c28'; }}
          >
            <svg viewBox="0 0 24 24" width={17} height={17}>
              <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.4-1.7 4.2-5.5 4.2A6.3 6.3 0 0 1 12 5.6a5.7 5.7 0 0 1 4 1.6l2.7-2.6A9.9 9.9 0 0 0 12 2a10 10 0 1 0 0 20c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.7H12Z" />
            </svg>
            Continue with Google
          </button>

          {/* GitLab OAuth */}
          <button style={{
            width: '100%',
            height: 46,
            lineHeight: '46px',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 500,
            background: '#161613',
            border: '1px solid #2c2c28',
            color: '#f2f2ec',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            cursor: 'pointer',
            marginBottom: 0,
            transition: 'border-color .15s ease, background .15s ease',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = '#1c1c18'; e.currentTarget.style.borderColor = '#45453e'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#161613'; e.currentTarget.style.borderColor = '#2c2c28'; }}
          >
            <svg viewBox="0 0 24 24" fill="#FC6D26" width={17} height={17}>
              <path d="m12 21.3-3.6-11h7.2l-3.6 11ZM4.7 10.3 3 15.8a.7.7 0 0 0 .3.8l8.7 6.3-7.3-12.6Zm1.7-5.2L4.7 10.3h4.7L6.4 5.1Zm11.2 0-2.9 5.2h4.7l-1.8-5.2ZM19.3 10.3 21 15.8a.7.7 0 0 1-.3.8l-8.7 6.3 7.3-12.6Z" />
            </svg>
            Continue with GitLab
          </button>

          {/* Divider */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            color: '#6f6f68',
            fontSize: 13,
            margin: '20px 0',
          }}>
            <div style={{ flex: 1, height: 1, background: '#2a2a26' }} />
            or
            <div style={{ flex: 1, height: 1, background: '#2a2a26' }} />
          </div>

          {/* Email input */}
          <input
            type="text"
            placeholder="you@company.com"
            style={{
              width: '100%',
              height: 46,
              lineHeight: '46px',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 500,
              display: 'block',
              background: '#131311',
              border: '1px solid #2c2c28',
              color: '#f2f2ec',
              padding: '0 16px',
              outline: 'none',
              marginBottom: 14,
            }}
          />

          {/* Email button (disabled) */}
          <button style={{
            width: '100%',
            height: 46,
            lineHeight: '46px',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 500,
            background: '#1c1c18',
            border: '1px solid #2c2c28',
            color: '#757570',
            cursor: 'not-allowed',
          }}>Continue with Email</button>

          {/* Login line */}
          <p style={{
            textAlign: 'center',
            fontSize: 14,
            color: '#9a9a95',
            marginTop: '1.75rem',
          }}>
            Already have an account?{' '}
            <a href="/signin" style={{ color: '#f2f2ec', textDecoration: 'underline' }}>Log in</a>
          </p>

          {/* Legal */}
          <p style={{
            fontSize: 12,
            color: '#6f6f68',
            lineHeight: 1.6,
            marginTop: '3rem',
          }}>
            By signing up, you agree to our{' '}
            <a href="#" style={{ color: '#a8a8a1', textDecoration: 'underline' }}>Terms of Service</a>{' '}
            and <a href="#" style={{ color: '#a8a8a1', textDecoration: 'underline' }}>Privacy Policy</a>.
          </p>
        </div>
      </div>

      {/* ---------- RIGHT: dark panel with rings ---------- */}
      <div style={{
        flex: 1,
        position: 'relative',
        background: '#050505',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '4rem 5vw',
        height: '100vh',
      }}>
        {/* Rings */}
        <div style={{
          position: 'absolute',
          top: '50%',
          left: -400,
          width: 800,
          height: 800,
          transform: 'translateY(-50%)',
          opacity: 0.06,
          pointerEvents: 'none',
          zIndex: 0,
        }}>
          <svg viewBox="0 0 800 800" fill="none" style={{ width: '100%', height: '100%' }}>
            <g style={{ transformOrigin: '400px 400px', animation: 'spin-slow 140s linear infinite' }}>
              <circle cx="400" cy="400" r="380" stroke="white" strokeWidth="2" />
              <circle cx="400" cy="400" r="370" stroke="white" strokeWidth="0.5" />
            </g>
            <g style={{ transformOrigin: '400px 400px', animation: 'spin-slow-rev 95s linear infinite reverse' }}>
              <circle cx="400" cy="400" r="300" stroke="white" strokeWidth="1.5" />
              <circle cx="400" cy="400" r="290" stroke="white" strokeWidth="0.5" />
            </g>
            <g style={{ transformOrigin: '400px 400px', animation: 'spin-med 70s linear infinite' }}>
              <circle cx="400" cy="400" r="200" stroke="white" strokeWidth="1" />
              <circle cx="400" cy="400" r="195" stroke="white" strokeWidth="0.3" />
              <line x1="600" y1="400" x2="700" y2="400" stroke="white" strokeWidth="3" strokeLinecap="round" />
              <line x1="541" y1="541" x2="612" y2="612" stroke="white" strokeWidth="3" strokeLinecap="round" />
              <line x1="400" y1="600" x2="400" y2="700" stroke="white" strokeWidth="3" strokeLinecap="round" />
              <line x1="258" y1="541" x2="187" y2="612" stroke="white" strokeWidth="3" strokeLinecap="round" />
              <line x1="200" y1="400" x2="100" y2="400" stroke="white" strokeWidth="3" strokeLinecap="round" />
              <line x1="258" y1="258" x2="187" y2="187" stroke="white" strokeWidth="3" strokeLinecap="round" />
              <line x1="400" y1="200" x2="400" y2="100" stroke="white" strokeWidth="3" strokeLinecap="round" />
              <line x1="541" y1="258" x2="612" y2="187" stroke="white" strokeWidth="3" strokeLinecap="round" />
            </g>
            <g style={{ transformOrigin: '400px 400px', animation: 'spin-fast-rev 45s linear infinite reverse' }}>
              <circle cx="400" cy="400" r="100" stroke="white" strokeWidth="2" />
              <circle cx="400" cy="400" r="80" stroke="white" strokeWidth="0.5" />
              <circle cx="400" cy="400" r="15" fill="white" />
              <line x1="320" y1="400" x2="480" y2="400" stroke="white" strokeWidth="4" strokeLinecap="round" />
              <line x1="400" y1="320" x2="400" y2="480" stroke="white" strokeWidth="4" strokeLinecap="round" />
            </g>
          </svg>
        </div>

        {/* Content */}
        <div style={{
          position: 'relative',
          zIndex: 2,
          maxWidth: '36rem',
          marginLeft: '8vw',
        }}>
          <p style={{
            fontFamily: '"Courier New", monospace',
            fontSize: 12,
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
            color: '#d4f000',
            marginBottom: '1rem',
          }}>
            Trusted by 400,000+ developers
          </p>
          <h2 style={{
            fontSize: 30,
            fontWeight: 400,
            lineHeight: 1.25,
            letterSpacing: '-0.01em',
            color: '#fff',
          }}>
            <span style={{ display: 'block' }}>
              Security{' '}
              <span style={{
                background: '#d4f000',
                color: '#14140a',
                padding: '0 6px',
              }}>infrastructure</span>
            </span>
            <span style={{ display: 'block' }}>for developers and agents</span>
          </h2>
          <p style={{
            marginTop: '1rem',
            maxWidth: '32rem',
            fontSize: 14,
            fontWeight: 400,
            color: '#a8a8a1',
            lineHeight: 1.6,
          }}>
            One place to audit every credential your apps and agents use.
          </p>
        </div>

        <style>{`
          @keyframes spin-slow { to { transform: rotate(360deg); } }
          @keyframes spin-slow-rev { to { transform: rotate(360deg); } }
          @keyframes spin-med { to { transform: rotate(360deg); } }
          @keyframes spin-fast-rev { to { transform: rotate(360deg); } }
          @media (max-width: 900px) {
            body > div > div > div:first-child { width: 100% !important; padding: 3rem 6vw !important; }
            body > div > div > div:last-child { display: none !important; }
          }
        `}</style>
      </div>
    </div>
  );
}
