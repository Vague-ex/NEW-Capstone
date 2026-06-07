import { useNavigate } from 'react-router';
import { Clock, GraduationCap, CheckCircle2, Mail, ArrowLeft } from 'lucide-react';

export function GraduatePending() {
  const navigate = useNavigate();
  const rawUser = sessionStorage.getItem('alumni_user');
  const graduate = rawUser ? JSON.parse(rawUser) : { name: 'Graduate', email: 'your@email.com' };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-green-100 flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-3xl shadow-xl overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-br from-[#166534] to-[#052e16] p-8 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-white/20 mx-auto mb-4">
              <Clock className="size-8 text-white" />
            </div>
            <h2 className="text-white" style={{ fontWeight: 700, fontSize: '1.3rem' }}>Registration Under Review</h2>
            <p className="text-green-200 text-sm mt-1">Your graduate account is being verified</p>
          </div>

          {/* Body */}
          <div className="p-8 space-y-4">
            {/* Graduate badge */}
            <div className="flex items-center gap-3 bg-green-50 border border-green-100 rounded-2xl p-4">
              <div className="flex size-10 items-center justify-center rounded-xl bg-green-100 shrink-0">
                <GraduationCap className="size-5 text-[#166534]" />
              </div>
              <div className="min-w-0">
                <p className="text-green-900 text-sm truncate" style={{ fontWeight: 700 }}>{graduate.name ?? 'Graduate'}</p>
                <p className="text-[#166534] text-xs truncate">{graduate.email ?? 'BSIS Graduate'}</p>
              </div>
              <div className="ml-auto flex items-center gap-1.5 bg-amber-100 text-amber-700 text-xs px-3 py-1 rounded-full" style={{ fontWeight: 600 }}>
                <span className="size-2 rounded-full bg-amber-400 animate-pulse" />
                Pending
              </div>
            </div>

            {/* Status steps */}
            <div className="space-y-3">
              {[
                { label: 'Registration submitted', done: true, desc: 'Your details and biometrics were received' },
                { label: 'Under BSIS Admin review', done: false, desc: 'The program chair is verifying your identity', active: true },
                { label: 'Account verified', done: false, desc: 'You will receive an email confirmation' },
              ].map((step, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`flex size-7 items-center justify-center rounded-full shrink-0 ${step.done ? 'bg-emerald-500' : step.active ? 'bg-[#166534]' : 'bg-gray-200'
                      }`}>
                      {step.done
                        ? <CheckCircle2 className="size-4 text-white" />
                        : <span className={`size-2 rounded-full ${step.active ? 'bg-white animate-pulse' : 'bg-gray-400'}`} />}
                    </div>
                    {i < 2 && <div className={`w-0.5 h-6 mt-1 ${step.done ? 'bg-emerald-300' : 'bg-gray-200'}`} />}
                  </div>
                  <div className="pb-4">
                    <p className={`text-sm ${step.active ? 'text-[#166534]' : step.done ? 'text-gray-700' : 'text-gray-400'}`}
                      style={{ fontWeight: step.done || step.active ? 600 : 400 }}>
                      {step.label}
                    </p>
                    <p className="text-gray-400 text-xs mt-0.5">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-green-50 border border-green-100 rounded-xl p-4">
              <div className="flex items-start gap-2">
                <Mail className="size-4 text-[#166534] shrink-0 mt-0.5" />
                <div>
                  <p className="text-green-800 text-sm" style={{ fontWeight: 600 }}>What happens next?</p>
                  <p className="text-green-700 text-xs mt-0.5 leading-relaxed">
                    The BSIS Admin will review your registration shortly. Once verified, you can log in to
                    view and update your employment record. You will be notified by email.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="px-8 pb-8">
            <button onClick={() => { sessionStorage.removeItem('alumni_user'); navigate('/'); }}
              className="w-full flex items-center justify-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-600 py-3 rounded-xl text-sm transition"
              style={{ fontWeight: 500 }}>
              <ArrowLeft className="size-4" /> Return to Login
            </button>
          </div>
        </div>

        <p className="text-center text-gray-500 text-xs mt-4">Carlos Hilado Memorial State University · BSIS Graduate Tracer System</p>
      </div>
    </div>
  );
}
