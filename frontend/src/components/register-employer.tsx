import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Building2, ArrowLeft, CheckCircle2, AlertCircle,
  Globe, Mail, Phone, User, Briefcase, Lock,
} from 'lucide-react';
import {
  ApiClientError,
  EMPLOYER_ACCESS_TOKEN_KEY,
  registerEmployer,
} from '../app/api-client';
import { useReferenceData } from '../hooks/useReferenceData';

export function RegisterEmployer() {
  const navigate = useNavigate();
  const { data: referenceData, loading: loadingReferenceData } = useReferenceData();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    companyName: '', industry: '', website: '',
    contactName: '', position: '', email: '', phone: '',
    password: '', confirmPassword: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.companyName || !form.contactName || !form.email || !form.industry) {
      setError('Please fill in all required fields.'); return;
    }
    if (form.password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (form.password !== form.confirmPassword) { setError('Passwords do not match.'); return; }

    setIsLoading(true);

    try {
      const response = await registerEmployer({
        company_name: form.companyName,
        industry: form.industry,
        website: form.website,
        contact_name: form.contactName,
        position: form.position,
        credential_email: form.email,
        phone: form.phone,
        password: form.password,
        confirm_password: form.confirmPassword,
      });

      const payload = (response.employer ?? {}) as Record<string, unknown>;
      if (response.accessToken) {
        sessionStorage.setItem(EMPLOYER_ACCESS_TOKEN_KEY, response.accessToken);
      } else {
        sessionStorage.removeItem(EMPLOYER_ACCESS_TOKEN_KEY);
      }

      const employerForSession = {
        id: String(payload.id ?? `new-${Date.now()}`),
        company: String(payload.company ?? form.companyName),
        industry: String(payload.industry ?? form.industry),
        contact: String(payload.contact ?? form.contactName),
        email: String(payload.email ?? form.email),
        status: String(payload.status ?? 'pending'),
        date: String(payload.date ?? new Date().toISOString().split('T')[0]),
      };

      sessionStorage.setItem('employer_user', JSON.stringify(employerForSession));
      navigate('/employer/dashboard');
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Unable to submit employer registration right now. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const inputClass = 'w-full rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white';
  const iconInputClass = 'w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-4 py-2.5 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white';
  const industryOptions = referenceData.industries.map(ind => ind.name);

  const Field = ({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) => (
    <div>
      <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top Bar */}
      <div className="bg-white border-b border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate('/')} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
          <ArrowLeft className="size-4 text-gray-600" />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-[#166534]">
            <Building2 className="size-4 text-white" />
          </div>
          <div>
            <p className="text-gray-800 text-sm" style={{ fontWeight: 700 }}>Employer Registration</p>
            <p className="text-gray-400 text-xs">CHMSU Talisay · Graduate Tracer System</p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row gap-6 max-w-5xl mx-auto w-full px-4 py-8">
        {/* Info sidebar */}
        <div className="lg:w-72 shrink-0">
          <div className="bg-gradient-to-b from-[#166534] to-[#052e16] rounded-2xl p-6 text-white">
            <Building2 className="size-8 mb-4 text-green-300" />
            <h3 className="text-white mb-2" style={{ fontWeight: 700, fontSize: '1.1rem' }}>Employer Access</h3>
            <p className="text-green-200 text-sm leading-relaxed mb-5">
              Register to access CHMSU BSIS graduate data for legitimate recruitment and verification purposes.
            </p>
            <div className="space-y-3">
              {[
                { icon: CheckCircle2, text: 'Verify graduate employment status' },
                { icon: CheckCircle2, text: 'View anonymized skill trends' },
                { icon: CheckCircle2, text: 'Access aggregate BSIS talent data' },
                { icon: CheckCircle2, text: 'Post campus recruitment updates' },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <item.icon className="size-4 text-green-300 mt-0.5 shrink-0" />
                  <p className="text-green-100 text-xs">{item.text}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-lg bg-white/10 p-3 text-xs text-green-200">
              <span style={{ fontWeight: 600 }}>Note:</span> All access requests are reviewed and approved by the CHMSU BSIS BSIS Admin before activation.
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="flex-1">
          {error && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-lg p-3.5 mb-5">
              <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Company Info */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
                <Building2 className="size-4 text-[#166534]" /> Company Information
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Company Name" required>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                    <input name="companyName" value={form.companyName} onChange={handleChange}
                      placeholder="e.g. Accenture Philippines" className={iconInputClass} />
                  </div>
                </Field>
                <Field label="Industry" required>
                  <select name="industry" value={form.industry} onChange={handleChange} className={inputClass}>
                    <option value="">
                      {loadingReferenceData ? 'Loading industries...' : 'Select industry...'}
                    </option>
                    {industryOptions.map(ind => <option key={ind} value={ind}>{ind}</option>)}
                  </select>
                </Field>
                <Field label="Company Website">
                  <div className="relative">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                    <input name="website" value={form.website} onChange={handleChange}
                      placeholder="https://company.com" className={iconInputClass} />
                  </div>
                </Field>
              </div>
            </div>

            {/* Contact Info */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
                <User className="size-4 text-[#166534]" /> Contact Representative
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Contact Person Name" required>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                    <input name="contactName" value={form.contactName} onChange={handleChange}
                      placeholder="Full name" className={iconInputClass} />
                  </div>
                </Field>
                <Field label="Position / Title">
                  <div className="relative">
                    <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                    <input name="position" value={form.position} onChange={handleChange}
                      placeholder="e.g. HR Manager" className={iconInputClass} />
                  </div>
                </Field>
                <Field label="Account Credential Email" required>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                    <input name="email" type="email" value={form.email} onChange={handleChange}
                      placeholder="you@company.com" className={iconInputClass} />
                  </div>
                </Field>
                <Field label="Phone Number">
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                    <input name="phone" type="tel" value={form.phone} onChange={handleChange}
                      placeholder="09XXXXXXXXX" className={iconInputClass} />
                  </div>
                </Field>
              </div>
            </div>

            {/* Account Credentials */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h3 className="text-gray-800 mb-1 flex items-center gap-2" style={{ fontWeight: 700 }}>
                <Lock className="size-4 text-[#166534]" /> Account Credentials
              </h3>
              <p className="text-gray-500 text-xs mb-4">Set a password to log in once your account is approved by the BSIS Admin.</p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Password">
                  <input name="password" type="password" value={form.password} onChange={handleChange}
                    placeholder="Min. 8 characters" className={inputClass} />
                </Field>
                <Field label="Confirm Password">
                  <input name="confirmPassword" type="password" value={form.confirmPassword} onChange={handleChange}
                    placeholder="Repeat password" className={inputClass} />
                </Field>
              </div>
            </div>

            <button type="submit" disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white py-3 rounded-xl text-sm transition disabled:opacity-70"
              style={{ fontWeight: 600 }}>
              {isLoading
                ? <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Submitting Application…</>
                : 'Submit Registration Application →'
              }
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
