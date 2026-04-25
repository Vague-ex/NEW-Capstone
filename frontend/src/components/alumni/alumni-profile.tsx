import { useState } from 'react';
import { useNavigate } from 'react-router';
import { PortalLayout } from '../shared/portal-layout';
import { VALID_ALUMNI } from '../../data/app-data';
import { updateAlumniEmployment } from '../../app/api-client';
import {
  Mail, Phone, Linkedin, Github, Globe, Save, CheckCircle2,
  Camera, AlertTriangle, UserCircle, Hash, Calendar, ShieldCheck, BookOpen,
} from 'lucide-react';

export function AlumniProfile() {
  const navigate = useNavigate();
  const rawUser = sessionStorage.getItem('alumni_user');
  const alumni = rawUser ? JSON.parse(rawUser) : VALID_ALUMNI[0];
  const isVerified = (alumni.verificationStatus ?? 'pending') === 'verified';

  const surveyData =
    typeof alumni.surveyData === 'object' && alumni.surveyData !== null
      ? (alumni.surveyData as Record<string, unknown>)
      : {};
  const registeredPhone = typeof surveyData.mobile === 'string' ? surveyData.mobile : '';
  const initialPhone =
    (typeof alumni.phone === 'string' && alumni.phone.trim())
    || (typeof alumni.mobile === 'string' && alumni.mobile.trim())
    || registeredPhone.trim()
    || '';

  const [form, setForm] = useState({
    email: alumni.email ?? '',
    phone: initialPhone,
    linkedin: alumni.linkedin ?? '',
    github: alumni.github ?? '',
    otherSocial: alumni.otherSocial ?? '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (key: string, value: string) => {
    setSaved(false);
    setError('');
    setForm(f => ({ ...f, [key]: value }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.email.trim()) { setError('Email address is required.'); return; }
    if (!form.email.includes('@')) { setError('Please enter a valid email address.'); return; }
    setIsSaving(true);

    const mergedSurveyData = {
      ...surveyData,
      mobile: form.phone,
      facebook_url: form.otherSocial,
    };

    let serverAlumni: Record<string, unknown> = {};
    try {
      const alumniId = String(alumni?.id ?? '');
      if (alumniId) {
        const response = await updateAlumniEmployment(alumniId, {
          survey_data: mergedSurveyData,
        });
        if (response.alumni && typeof response.alumni === 'object') {
          serverAlumni = response.alumni as Record<string, unknown>;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save profile right now.');
      setIsSaving(false);
      return;
    }

    const updated = {
      ...alumni,
      ...form,
      ...serverAlumni,
      surveyData: mergedSurveyData,
      dateUpdated: new Date().toISOString().split('T')[0],
    };
    sessionStorage.setItem('alumni_user', JSON.stringify(updated));
    setSaved(true);
    setIsSaving(false);
  };

  const initials = alumni.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2) ?? 'AL';

  const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white';
  const iconInputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-4 py-3 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white';

  return (
    <PortalLayout role="alumni" pageTitle="Edit Profile" pageSubtitle="Manage your contact and social media information">
      <div className="max-w-2xl mx-auto space-y-5">

        {/* Profile Card */}
        <div className="bg-gradient-to-r from-[#166534] to-[#15803d] rounded-2xl p-6 text-white relative overflow-hidden">
          <div className="absolute right-0 top-0 bottom-0 w-40 opacity-10"
            style={{ background: 'radial-gradient(circle at 100% 50%, white 0%, transparent 70%)' }} />
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="relative shrink-0">
              <div className="flex size-16 items-center justify-center rounded-2xl bg-white/20 text-white"
                style={{ fontWeight: 700, fontSize: '1.4rem' }}>
                {initials}
              </div>
              {/* No upload — camera capture only per spec */}
              <div className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full bg-white/20 border border-white/30">
                <Camera className="size-3 text-white/70" />
              </div>
            </div>
            <div>
              <h2 className="text-white" style={{ fontWeight: 700, fontSize: '1.1rem' }}>{alumni.name}</h2>
              <p className="text-white/60 text-sm flex items-center gap-1.5 mt-0.5">
                <Hash className="size-3.5" /> {alumni.schoolId}
                <span className="text-white/30">·</span>
                <Calendar className="size-3.5" /> BSIS Batch {alumni.graduationYear}
              </p>
              <div className="flex items-center gap-2 mt-2">
                {isVerified ? (
                  <span className="inline-flex items-center gap-1.5 bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-xs px-2.5 py-0.5 rounded-full" style={{ fontWeight: 600 }}>
                    <ShieldCheck className="size-3" /> Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 bg-amber-400/20 border border-amber-400/40 text-amber-200 text-xs px-2.5 py-0.5 rounded-full" style={{ fontWeight: 600 }}>
                    <AlertTriangle className="size-3" /> Pending Verification
                  </span>
                )}
              </div>
            </div>
          </div>
          <p className="mt-4 text-white/40 text-xs flex items-center gap-1.5">
            <Camera className="size-3.5" />
            Profile photo is captured via camera only. Contact admin to update biometric.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-gray-800 text-sm" style={{ fontWeight: 700 }}>Need to update Personal Information or Education?</p>
              <p className="text-gray-500 text-xs mt-0.5">Open the registration-form details editor to update your personal and educational records.</p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/alumni/profile/personal-education')}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#166534] px-4 py-2.5 text-xs text-white transition hover:bg-[#14532d]"
              style={{ fontWeight: 600 }}
            >
              <BookOpen className="size-3.5" />
              Edit Personal and Education
            </button>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="space-y-5">

          {/* Contact Information */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="text-gray-800 mb-5 flex items-center gap-2" style={{ fontWeight: 700 }}>
              <UserCircle className="size-4 text-[#166534]" /> Contact Information
            </h3>

            {error && (
              <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 mb-5">
                <AlertTriangle className="size-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                  Email Address <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                  <input
                    type="email"
                    placeholder="your.email@gmail.com"
                    value={form.email}
                    onChange={e => handleChange('email', e.target.value)}
                    className={iconInputCls}
                  />
                </div>
                <p className="text-gray-400 text-xs mt-1">Used for login and communication purposes.</p>
              </div>

              <div>
                <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                  Phone Number
                </label>
                <div className="relative">
                  <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                  <input
                    type="tel"
                    placeholder="09XXXXXXXXX"
                    value={form.phone}
                    onChange={e => handleChange('phone', e.target.value)}
                    className={iconInputCls}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Social Media & Portfolio */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="text-gray-800 mb-1 flex items-center gap-2" style={{ fontWeight: 700 }}>
              <Globe className="size-4 text-[#166534]" /> Social Media & Portfolio
            </h3>
            <p className="text-gray-500 text-xs mb-5">All fields are optional. Share your professional presence.</p>

            <div className="space-y-4">
              {/* LinkedIn */}
              <div>
                <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                  LinkedIn Profile
                </label>
                <div className="relative">
                  <Linkedin className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-blue-600" />
                  <input
                    type="url"
                    placeholder="https://linkedin.com/in/your-name"
                    value={form.linkedin}
                    onChange={e => handleChange('linkedin', e.target.value)}
                    className={iconInputCls}
                  />
                </div>
              </div>

              {/* GitHub */}
              <div>
                <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                  GitHub Profile
                </label>
                <div className="relative">
                  <Github className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-700" />
                  <input
                    type="url"
                    placeholder="https://github.com/your-username"
                    value={form.github}
                    onChange={e => handleChange('github', e.target.value)}
                    className={iconInputCls}
                  />
                </div>
              </div>

              {/* Other */}
              <div>
                <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                  Other Social / Portfolio
                </label>
                <div className="relative">
                  <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                  <input
                    type="url"
                    placeholder="https://your-portfolio.com or social link"
                    value={form.otherSocial}
                    onChange={e => handleChange('otherSocial', e.target.value)}
                    className={iconInputCls}
                  />
                </div>
                <p className="text-gray-400 text-xs mt-1">Portfolio site, Behance, Facebook, Twitter/X, etc.</p>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white py-3 rounded-xl text-sm transition disabled:opacity-70"
              style={{ fontWeight: 600 }}>
              {isSaving
                ? <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</>
                : <><Save className="size-4" /> Save Profile</>
              }
            </button>
            {saved && (
              <span className="flex items-center gap-1.5 text-emerald-600 text-sm shrink-0" style={{ fontWeight: 600 }}>
                <CheckCircle2 className="size-5" /> Saved!
              </span>
            )}
          </div>
        </form>

        {/* Profile photo note */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
          <Camera className="size-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-amber-800 text-sm" style={{ fontWeight: 600 }}>Profile photo is camera-capture only</p>
            <p className="text-amber-700 text-xs mt-0.5 leading-relaxed">
              Per CHMSU data policy, profile photos and biometrics are captured via live camera during registration only.
              File uploads are not supported. To update your biometric, contact the BSIS Admin.
            </p>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}