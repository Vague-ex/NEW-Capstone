import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Building2, ArrowLeft, CheckCircle2, AlertCircle,
  Globe, Mail, Phone, User, Briefcase, Lock, Sparkles, Heart,
} from 'lucide-react';
import {
  ApiClientError,
  EMPLOYER_ACCESS_TOKEN_KEY,
  registerEmployer,
} from '../app/api-client';
import { useReferenceData, type SkillItem } from '../hooks/useReferenceData';

const SOFT_SKILL_PATTERN = /soft|communication|interpersonal|behaviou?ral|attitude/i;

type FieldProps = {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
};

// Defined at module scope (not inside the component) so the inputs are not
// remounted on every keystroke, which would otherwise drop focus.
function Field({ label, required = false, className = '', children }: FieldProps) {
  return (
    <div className={className}>
      <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

// SectionCard mirrors the alumni edit-employment page: a white rounded card
// with a green icon header and vertically spaced content.
function SectionCard({ icon: Icon, title, subtitle, children }: {
  icon: React.ElementType; title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <h3 className={`text-gray-800 flex items-center gap-2 ${subtitle ? 'mb-1' : 'mb-4'}`} style={{ fontWeight: 700 }}>
        <Icon className="size-4 text-[#166534]" /> {title}
      </h3>
      {subtitle && <p className="text-gray-500 text-xs mb-4">{subtitle}</p>}
      {children}
    </div>
  );
}

export function RegisterEmployer({ onBack }: { onBack?: () => void } = {}) {
  const navigate = useNavigate();
  const { data: referenceData, loading: loadingReferenceData } = useReferenceData();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    companyName: '', industry: '', website: '',
    contactName: '', position: '', email: '', phone: '', phoneCountryCode: '+63',
    password: '', confirmPassword: '',
  });
  const [desiredTechSkillIds, setDesiredTechSkillIds] = useState<string[]>([]);
  const [desiredSoftSkillIds, setDesiredSoftSkillIds] = useState<string[]>([]);
  const [activeTechCategory, setActiveTechCategory] = useState<string | null>(null);

  // Split the live skill list into soft vs technical groups based on the
  // category name. Falls back to "everything is technical" when categories
  // aren't seeded yet.
  const { softSkills, technicalSkillsByCategory, technicalCount } = useMemo(() => {
    const soft: SkillItem[] = [];
    const techGroups: Record<string, SkillItem[]> = {};
    let total = 0;
    for (const skill of referenceData.skills) {
      if (!skill.is_active) continue;
      const cat = skill.category_name ?? '';
      if (SOFT_SKILL_PATTERN.test(cat) || SOFT_SKILL_PATTERN.test(skill.name)) {
        soft.push(skill);
      } else {
        const groupKey = cat || 'Other';
        if (!techGroups[groupKey]) techGroups[groupKey] = [];
        techGroups[groupKey].push(skill);
        total += 1;
      }
    }
    return { softSkills: soft, technicalSkillsByCategory: techGroups, technicalCount: total };
  }, [referenceData.skills]);

  const toggleSkill = (id: string, group: 'tech' | 'soft') => {
    const setter = group === 'tech' ? setDesiredTechSkillIds : setDesiredSoftSkillIds;
    setter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

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
    // Phone is optional, but if filled it must follow the same shape as the
    // alumni form: PH = 9XXXXXXXXX (10) or 09XXXXXXXXX (11); else 6–15 digits.
    if (form.phone.trim()) {
      const phoneDigits = form.phone.replace(/\D/g, '');
      if (form.phoneCountryCode === '+63') {
        const normalized = phoneDigits.startsWith('0') ? phoneDigits.slice(1) : phoneDigits;
        if (normalized.length !== 10 || !normalized.startsWith('9')) {
          setError('Philippine phone numbers must start with 9 or 09 (e.g. 9171234567 or 09171234567).');
          return;
        }
      } else if (phoneDigits.length < 6 || phoneDigits.length > 15) {
        setError('Please enter a valid phone number (6–15 digits).');
        return;
      }
    }
    if (form.password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (form.password !== form.confirmPassword) { setError('Passwords do not match.'); return; }

    setIsLoading(true);

    try {
      const desiredSkillIds = [...desiredTechSkillIds, ...desiredSoftSkillIds];
      const fullPhone = form.phone.trim() ? `${form.phoneCountryCode}${form.phone}` : '';
      const response = await registerEmployer({
        company_name: form.companyName,
        industry: form.industry,
        website: form.website,
        contact_name: form.contactName,
        position: form.position,
        credential_email: form.email,
        phone: fullPhone,
        phone_country_code: form.phoneCountryCode,
        password: form.password,
        confirm_password: form.confirmPassword,
        desired_skill_ids: JSON.stringify(desiredSkillIds),
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

  const inputClass = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white';
  const iconInputClass = 'w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-4 py-3 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white';
  const industryOptions = referenceData.industries.map(ind => ind.name);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top Bar */}
      <div className="bg-white border-b border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3">
        <button onClick={onBack ?? (() => navigate('/'))} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
          <ArrowLeft className="size-4 text-gray-600" />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-[#166534]">
            <Building2 className="size-4 text-white" />
          </div>
          <div>
            <p className="text-gray-800 text-sm" style={{ fontWeight: 700 }}>Employer Registration</p>
            <p className="text-gray-400 text-xs">Carlos Hilado Memorial State University · Graduate Tracer System</p>
          </div>
        </div>
      </div>

      <div className="flex-1 w-full max-w-3xl lg:max-w-5xl mx-auto px-4 py-6 sm:py-8 pb-28">

        {/* Intro banner — full width, replaces the stretched side panel */}
        <div className="rounded-2xl bg-gradient-to-r from-[#166534] to-[#052e16] p-5 sm:p-6 text-white mb-5">
          <div className="flex items-start gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white/15">
              <Building2 className="size-6 text-green-200" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-white" style={{ fontWeight: 700, fontSize: '1.1rem' }}>Employer Access</h3>
              <p className="text-green-200 text-sm leading-relaxed mt-1">
                Register to access CHMSU BSIS graduate data for legitimate recruitment and verification purposes.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2 mt-3">
                {[
                  'Verify graduate employment status',
                  'View anonymized skill trends',
                  'Access aggregate BSIS talent data',
                  'Post campus recruitment updates',
                ].map((text) => (
                  <div key={text} className="flex items-start gap-2">
                    <CheckCircle2 className="size-4 text-green-300 mt-0.5 shrink-0" />
                    <p className="text-green-100 text-xs">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-lg bg-white/10 p-3 text-xs text-green-100">
            <span style={{ fontWeight: 600 }}>Note:</span> All access requests are reviewed and approved by the CHMSU BSIS Admin before activation.
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 mb-5">
            <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Company + Contact — side by side on desktop, stacked on mobile */}
          <div className="lg:grid lg:grid-cols-2 lg:gap-5 space-y-5 lg:space-y-0">

            <SectionCard icon={Building2} title="Company Information">
              <div className="space-y-4">
                <Field label="Company Name" required>
                  <div className="relative">
                    <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
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
                    <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                    <input name="website" value={form.website} onChange={handleChange}
                      placeholder="https://company.com" className={iconInputClass} />
                  </div>
                </Field>
              </div>
            </SectionCard>

            <SectionCard icon={User} title="Contact Representative">
              <div className="space-y-4">
                <Field label="Contact Person Name" required>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                    <input name="contactName" value={form.contactName} onChange={handleChange}
                      placeholder="Full name" className={iconInputClass} />
                  </div>
                </Field>
                <Field label="Position / Title">
                  <div className="relative">
                    <Briefcase className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                    <input name="position" value={form.position} onChange={handleChange}
                      placeholder="e.g. HR Manager" className={iconInputClass} />
                  </div>
                </Field>
                <Field label="Phone Number">
                  <div className="flex gap-2">
                    <select
                      name="phoneCountryCode"
                      value={form.phoneCountryCode}
                      onChange={handleChange}
                      className="px-2 py-3 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:bg-white focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 outline-none transition"
                    >
                      <option value="+63">+63 Philippines</option>
                      <option value="+1">+1 United States</option>
                      <option value="+44">+44 United Kingdom</option>
                      <option value="+61">+61 Australia</option>
                      <option value="+65">+65 Singapore</option>
                      <option value="+60">+60 Malaysia</option>
                      <option value="+81">+81 Japan</option>
                      <option value="+82">+82 Korea</option>
                      <option value="+86">+86 China</option>
                      <option value="+971">+971 UAE</option>
                    </select>
                    <div className="relative flex-1">
                      <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                      <input
                        name="phone"
                        type="tel"
                        value={form.phone}
                        maxLength={form.phoneCountryCode === '+63' ? 11 : 15}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, '') }))
                        }
                        placeholder={form.phoneCountryCode === '+63' ? '9XXXXXXXXX or 09XXXXXXXXX' : 'Phone number'}
                        className={iconInputClass}
                      />
                    </div>
                  </div>
                </Field>
              </div>
            </SectionCard>

          </div>{/* end Company + Contact grid */}

          {/* Skills the employer is hiring for */}
          <SectionCard
            icon={Sparkles}
            title="Skills You're Hiring For"
            subtitle="Pick the skills you want from CHMSU BSIS graduates. Optional — leave blank to see all candidates. Updated automatically when admins add new skills."
          >
            {/* Technical skills */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-gray-700 text-xs" style={{ fontWeight: 600 }}>
                  Technical skills <span className="text-gray-400" style={{ fontWeight: 400 }}>(optional if your industry isn't IT-related)</span>
                </p>
                {desiredTechSkillIds.length > 0 && (
                  <span className="text-[11px] text-[#166534]" style={{ fontWeight: 600 }}>{desiredTechSkillIds.length} selected</span>
                )}
              </div>
              {loadingReferenceData ? (
                <p className="text-gray-400 text-xs">Loading skills…</p>
              ) : technicalCount === 0 ? (
                <p className="text-gray-400 text-xs italic">No technical skills in the reference list yet.</p>
              ) : (
                <div>
                  {/* Category tabs */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {Object.keys(technicalSkillsByCategory).sort().map((categoryName) => {
                      const selectedInCategory = technicalSkillsByCategory[categoryName].filter(
                        (s) => desiredTechSkillIds.includes(s.id),
                      ).length;
                      const isActive = activeTechCategory === categoryName;
                      return (
                        <button
                          key={categoryName}
                          type="button"
                          onClick={() => setActiveTechCategory(isActive ? null : categoryName)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition ${
                            isActive
                              ? 'bg-[#166534] border-[#166534] text-white'
                              : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                          }`}
                          style={{ fontWeight: isActive ? 600 : 400 }}>
                          {categoryName}
                          {selectedInCategory > 0 && (
                            <span className={`text-[10px] px-1.5 rounded-full ${isActive ? 'bg-white/20' : 'bg-[#166534]/10 text-[#166534]'}`} style={{ fontWeight: 600 }}>
                              {selectedInCategory}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Skills for the active category */}
                  {activeTechCategory && technicalSkillsByCategory[activeTechCategory] ? (
                    <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                      <p className="text-[11px] text-gray-500 uppercase tracking-wide mb-2" style={{ fontWeight: 600 }}>
                        {activeTechCategory}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {technicalSkillsByCategory[activeTechCategory].map((skill) => {
                          const selected = desiredTechSkillIds.includes(skill.id);
                          return (
                            <button
                              key={skill.id}
                              type="button"
                              onClick={() => toggleSkill(skill.id, 'tech')}
                              className={`px-3 py-1.5 rounded-full text-xs border transition ${
                                selected
                                  ? 'border-[#166534] bg-[#166534] text-white'
                                  : 'border-gray-200 bg-white text-gray-700 hover:border-[#166534] hover:text-[#166534]'
                              }`}
                              style={{ fontWeight: 500 }}>
                              {skill.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-400 text-xs text-center py-3">Click a category above to browse skills</p>
                  )}
                </div>
              )}
            </div>

            {/* Soft skills */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-gray-700 text-xs flex items-center gap-1.5" style={{ fontWeight: 600 }}>
                  <Heart className="size-3.5 text-[#166534]" />
                  Soft skills
                </p>
                {desiredSoftSkillIds.length > 0 && (
                  <span className="text-[11px] text-[#166534]" style={{ fontWeight: 600 }}>{desiredSoftSkillIds.length} selected</span>
                )}
              </div>
              {loadingReferenceData ? (
                <p className="text-gray-400 text-xs">Loading skills…</p>
              ) : softSkills.length === 0 ? (
                <p className="text-gray-400 text-xs italic">No soft skills in the reference list yet.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {softSkills.map((skill) => {
                    const selected = desiredSoftSkillIds.includes(skill.id);
                    return (
                      <button
                        key={skill.id}
                        type="button"
                        onClick={() => toggleSkill(skill.id, 'soft')}
                        className={`px-3 py-1.5 rounded-full text-xs border transition ${
                          selected
                            ? 'border-[#166534] bg-[#166534] text-white'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-[#166534] hover:text-[#166534]'
                        }`}
                        style={{ fontWeight: 500 }}>
                        {skill.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </SectionCard>

          {/* Account Credentials */}
          <SectionCard
            icon={Lock}
            title="Account Credentials"
            subtitle="Set a login email and password — used once your account is approved by the BSIS Admin."
          >
            <div className="space-y-4">
              <Field label="Account Credential Email" required>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                  <input name="email" type="email" value={form.email} onChange={handleChange}
                    placeholder="you@company.com" className={iconInputClass} />
                </div>
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          </SectionCard>

        </form>

        {/* Sticky save bar (mirrors the alumni edit-employment page) */}
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur border-t border-gray-200 px-4 py-3">
          <div className="max-w-3xl lg:max-w-5xl mx-auto flex items-center gap-3">
            <p className="flex-1 min-w-0 text-xs text-gray-500">
              Your application is reviewed by the BSIS Admin before your account is activated.
            </p>
            <button
              type="button"
              onClick={(e) => handleSubmit(e as unknown as React.FormEvent)}
              disabled={isLoading}
              className="inline-flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white px-5 py-2.5 rounded-xl text-sm transition disabled:opacity-70"
              style={{ fontWeight: 600 }}>
              {isLoading
                ? <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Submitting Application…</>
                : <>Submit Registration Application →</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
