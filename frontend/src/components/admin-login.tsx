import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertCircle, GraduationCap, Lock, User, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
const schoolLogo = '/favicon.ico';

export function AdminLogin() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password.');
      return;
    }

    setIsLoading(true);
    await new Promise((r) => setTimeout(r, 1000));

    if (username === 'admin' && password === 'chmsu2024') {
      sessionStorage.setItem('admin_authenticated', 'true');
      navigate('/admin/dashboard');
    } else {
      setError('Invalid credentials. Please try again.');
    }

    setIsLoading(false);
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Panel */}
      <div className="hidden lg:flex lg:w-1/2 relative flex-col justify-between overflow-hidden">
        <ImageWithFallback
          src="https://images.unsplash.com/photo-1565688527174-775059ac429c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxhbHVtbmklMjBwcm9mZXNzaW9uYWwlMjBjYXJlZXIlMjBuZXR3b3JraW5nJTIwb2ZmaWNlfGVufDF8fHx8MTc3MjYzNjQ4NXww&ixlib=rb-4.1.0&q=80&w=1080"
          alt="Admin dashboard"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-[#052e16]/90 via-[#166534]/85 to-[#052e16]/75" />

        <div className="relative z-10 p-10">
          <div className="flex items-center gap-3">
            <img src={schoolLogo} alt="CHMSU Logo" className="size-11 rounded-full object-cover bg-white/20 p-0.5" />
            <div>
              <p className="text-white/90 text-sm tracking-widest uppercase">Admin Portal</p>
              <p className="text-white/60 text-xs">CHMSU Talisay – BSIS Program</p>
            </div>
          </div>
        </div>

        <div className="relative z-10 p-10">
          <h1 className="text-4xl text-white mb-3" style={{ fontWeight: 700 }}>
            Program Chair<br />Dashboard
          </h1>
          <p className="text-white/70 text-base leading-relaxed max-w-sm">
            Access employment analytics, manage alumni records, and generate
            reports for accreditation compliance.
          </p>
          <div className="mt-6 flex items-center gap-3 rounded-xl bg-white/10 backdrop-blur-sm p-4">
            <Lock className="size-5 text-yellow-300 shrink-0" />
            <p className="text-white/80 text-sm">
              This portal is restricted to authorized Program Chair and administrative personnel only.
            </p>
          </div>
        </div>
      </div>

      {/* Right Panel */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center bg-gray-50 px-6 py-12">
        {/* Mobile header */}
        <div className="lg:hidden flex items-center gap-3 mb-8">
          <img src={schoolLogo} alt="CHMSU Logo" className="size-10 rounded-full object-cover" />
          <div>
            <p className="text-[#166534] text-sm" style={{ fontWeight: 600 }}>CHMSU Talisay</p>
            <p className="text-gray-500 text-xs">Admin Portal</p>
          </div>
        </div>

        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
            <div className="mb-8">
              <div className="flex size-12 items-center justify-center rounded-xl bg-[#166534]/10 mb-4">
                <ShieldCheck className="size-6 text-[#166534]" />
              </div>
              <h2 className="text-gray-900" style={{ fontWeight: 700, fontSize: '1.5rem' }}>
                Administrator Login
              </h2>
              <p className="text-gray-500 text-sm mt-1">
                Restricted access for Program Chair and authorized staff.
              </p>
            </div>

            {error && (
              <div className="mb-5 flex items-start gap-3 rounded-lg bg-red-50 border border-red-200 p-3.5">
                <AlertCircle className="size-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="block text-gray-700 text-sm mb-1.5" htmlFor="username">
                  Username
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                  <input
                    id="username"
                    type="text"
                    placeholder="Enter username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 pl-10 pr-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-gray-700 text-sm mb-1.5" htmlFor="password">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                  <input
                    id="password"
                    type={showPass ? 'text' : 'password'}
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 pl-10 pr-10 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full rounded-lg bg-[#166534] py-2.5 text-white text-sm transition hover:bg-[#14532d] active:scale-[0.99] disabled:opacity-70 disabled:cursor-not-allowed"
                style={{ fontWeight: 600 }}
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Authenticating…
                  </span>
                ) : (
                  'Sign In to Dashboard'
                )}
              </button>
            </form>
          </div>

          <p className="text-center text-gray-400 text-xs mt-5">
            Not an admin?{' '}
            <button
              type="button"
              onClick={() => navigate('/')}
              className="text-[#166534] hover:underline"
              style={{ fontWeight: 500 }}
            >
              ← Return to Home
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}