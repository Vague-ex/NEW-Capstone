import { useState } from 'react';
import { PortalLayout } from '../shared/portal-layout';
import { VALID_ALUMNI } from '../../data/app-data';
import { updateAlumniEmployment } from '../../app/api-client';
import {
    User, BookOpen, Phone, Mail, MapPin, Save, CheckCircle2, AlertTriangle,
} from 'lucide-react';

function RadioOption({ label, value, current, onSelect }: {
    label: string; value: string; current: string; onSelect: (v: string) => void;
}) {
    const active = current === value;
    return (
        <label className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-sm cursor-pointer transition select-none ${active ? 'border-[#166534] bg-[#166534]/5 text-[#166534]' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
            }`}>
            <div className={`size-4 rounded-full border-2 flex items-center justify-center shrink-0 ${active ? 'border-[#166534]' : 'border-gray-300'}`}>
                {active && <div className="size-2 rounded-full bg-[#166534]" />}
            </div>
            <input type="radio" className="hidden" value={value} checked={active} onChange={() => onSelect(value)} />
            {label}
        </label>
    );
}

function CheckOption({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
    return (
        <label className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-xs cursor-pointer transition select-none ${checked ? 'border-[#166534] bg-[#166534]/5 text-[#166534]' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
            }`}>
            <div className={`size-4 rounded border-2 flex items-center justify-center shrink-0 ${checked ? 'border-[#166534] bg-[#166534]' : 'border-gray-300'}`}>
                {checked && (
                    <svg className="size-2.5 text-white" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                )}
            </div>
            <input type="checkbox" className="hidden" checked={checked} onChange={onChange} />
            {label}
        </label>
    );
}

const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white';

export function AlumniPersonalEducation() {
    const rawUser = sessionStorage.getItem('alumni_user');
    const alumni = rawUser ? JSON.parse(rawUser) : VALID_ALUMNI[0];
    const alumniId = String(alumni?.id ?? '');

    const surveyData =
        typeof alumni?.surveyData === 'object' && alumni.surveyData !== null
            ? (alumni.surveyData as Record<string, unknown>)
            : {};

    const [form, setForm] = useState({
        familyName: String(surveyData.familyName ?? ''),
        firstName: String(surveyData.firstName ?? ''),
        middleName: String(surveyData.middleName ?? ''),
        gender: String(surveyData.gender ?? ''),
        birthDate: String(surveyData.birthDate ?? ''),
        civilStatus: String(surveyData.civilStatus ?? ''),
        mobile: String(surveyData.mobile ?? alumni.phone ?? alumni.mobile ?? ''),
        facebook: String(surveyData.facebook ?? ''),
        city: String(surveyData.city ?? ''),
        province: String(surveyData.province ?? ''),
        graduationDate: String(surveyData.graduationDate ?? ''),
        scholarship: String(surveyData.scholarship ?? ''),
        highestAttainment: String(surveyData.highestAttainment ?? ''),
        graduateSchool: String(surveyData.graduateSchool ?? ''),
        profEligibility: Array.isArray(surveyData.profEligibility)
            ? surveyData.profEligibility.filter((item): item is string => typeof item === 'string')
            : [],
        profEligibilityOther: String(surveyData.profEligibilityOther ?? ''),
    });

    const [isSaving, setIsSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [saveError, setSaveError] = useState('');

    const setF = (field: string, value: string) => {
        setSaved(false);
        setSaveError('');
        setForm((prev) => ({ ...prev, [field]: value }));
    };

    const toggleEligibility = (value: string) => {
        setSaved(false);
        setSaveError('');
        setForm((prev) => {
            const next = prev.profEligibility.includes(value)
                ? prev.profEligibility.filter((item) => item !== value)
                : [...prev.profEligibility, value];
            return {
                ...prev,
                profEligibility: next,
                profEligibilityOther: next.includes('Others') ? prev.profEligibilityOther : '',
            };
        });
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaveError('');

        if (!form.familyName.trim()) {
            setSaveError('Family name is required.');
            return;
        }
        if (!form.firstName.trim()) {
            setSaveError('First name is required.');
            return;
        }
        if (!form.graduationDate.trim()) {
            setSaveError('Date of graduation is required.');
            return;
        }

        setIsSaving(true);
        const mergedSurveyData = {
            ...surveyData,
            ...form,
            profEligibilityOther: form.profEligibility.includes('Others') ? form.profEligibilityOther : '',
        };

        try {
            let serverAlumni: Record<string, unknown> = {};
            if (alumniId) {
                const response = await updateAlumniEmployment(alumniId, {
                    survey_data: mergedSurveyData,
                });
                if (response.alumni && typeof response.alumni === 'object') {
                    serverAlumni = response.alumni as Record<string, unknown>;
                }
            }

            const updated = {
                ...alumni,
                ...serverAlumni,
                phone: form.mobile,
                mobile: form.mobile,
                surveyData: mergedSurveyData,
                dateUpdated: new Date().toISOString().split('T')[0],
            };

            sessionStorage.setItem('alumni_user', JSON.stringify(updated));
            setSaved(true);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unable to save changes right now.';
            setSaveError(message);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <PortalLayout role="alumni" pageTitle="Personal and Education" pageSubtitle="Update your personal and educational information from your registration form">
            <div className="max-w-3xl mx-auto space-y-5">
                <form onSubmit={handleSave} className="space-y-5">

                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                        <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
                            <User className="size-4 text-[#166534]" /> Personal Information
                        </h3>

                        {saveError && (
                            <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 mb-5">
                                <AlertTriangle className="size-4 text-red-500 shrink-0 mt-0.5" />
                                <p className="text-red-700 text-sm">{saveError}</p>
                            </div>
                        )}

                        <div className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Family Name *</label>
                                    <input type="text" value={form.familyName} onChange={(e) => setF('familyName', e.target.value)} className={inputCls} />
                                </div>
                                <div>
                                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>First Name *</label>
                                    <input type="text" value={form.firstName} onChange={(e) => setF('firstName', e.target.value)} className={inputCls} />
                                </div>
                                <div>
                                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Middle Name</label>
                                    <input type="text" value={form.middleName} onChange={(e) => setF('middleName', e.target.value)} className={inputCls} />
                                </div>
                            </div>

                            <div>
                                <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Gender</label>
                                <div className="flex gap-2">
                                    {['Male', 'Female'].map((option) => (
                                        <RadioOption key={option} label={option} value={option} current={form.gender} onSelect={(v) => setF('gender', v)} />
                                    ))}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Birth Date</label>
                                    <input type="date" value={form.birthDate} onChange={(e) => setF('birthDate', e.target.value)} className={inputCls} />
                                </div>
                                <div>
                                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Civil Status</label>
                                    <select value={form.civilStatus} onChange={(e) => setF('civilStatus', e.target.value)} className={inputCls}>
                                        <option value="">Select...</option>
                                        <option>Single</option>
                                        <option>Married</option>
                                        <option>Widowed</option>
                                        <option>Separated</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Mobile Number</label>
                                    <div className="relative">
                                        <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                                        <input type="tel" value={form.mobile} onChange={(e) => setF('mobile', e.target.value)} className={`${inputCls} pl-10`} />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Facebook</label>
                                    <input type="text" value={form.facebook} onChange={(e) => setF('facebook', e.target.value)} className={inputCls} />
                                </div>
                            </div>

                            <div>
                                <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Permanent Address</label>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-gray-500 text-xs mb-1.5">City/Municipality</label>
                                        <div className="relative">
                                            <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                                            <input type="text" value={form.city} onChange={(e) => setF('city', e.target.value)} className={`${inputCls} pl-10`} />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-gray-500 text-xs mb-1.5">State/Province</label>
                                        <input type="text" value={form.province} onChange={(e) => setF('province', e.target.value)} className={inputCls} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                        <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
                            <BookOpen className="size-4 text-[#166534]" /> Education
                        </h3>

                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Degree Program</label>
                                    <input type="text" value="Bachelor of Science in Information Systems (BSIS)" readOnly className={`${inputCls} bg-gray-100 text-gray-500 cursor-not-allowed text-xs`} />
                                </div>
                                <div>
                                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Campus</label>
                                    <input type="text" value="Talisay" readOnly className={`${inputCls} bg-gray-100 text-gray-500 cursor-not-allowed`} />
                                </div>
                            </div>

                            <div>
                                <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Date of Graduation *</label>
                                <input type="date" value={form.graduationDate} onChange={(e) => setF('graduationDate', e.target.value)} className={inputCls} />
                            </div>

                            <div>
                                <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Scholarship Availed During College (if any)</label>
                                <input type="text" value={form.scholarship} onChange={(e) => setF('scholarship', e.target.value)} className={inputCls} />
                            </div>

                            <div>
                                <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Highest Educational Attainment (Post-Graduate)</label>
                                <div className="space-y-2">
                                    {[
                                        { value: 'Masters', label: "Master's Degree" },
                                        { value: 'Doctorate', label: 'Doctorate Degree' },
                                        { value: 'NA', label: 'N/A (Not pursuing further studies)' },
                                    ].map((option) => (
                                        <RadioOption
                                            key={option.value}
                                            value={option.value}
                                            label={option.label}
                                            current={form.highestAttainment}
                                            onSelect={(v) => setF('highestAttainment', v)}
                                        />
                                    ))}
                                </div>
                            </div>

                            {(form.highestAttainment === 'Masters' || form.highestAttainment === 'Doctorate') && (
                                <div>
                                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Name of Graduate School</label>
                                    <input type="text" value={form.graduateSchool} onChange={(e) => setF('graduateSchool', e.target.value)} className={inputCls} />
                                </div>
                            )}

                            <div>
                                <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Professional Eligibility / Certification (IT Related)</label>
                                <div className="space-y-2">
                                    {['Civil Service', 'TESDA', 'Others'].map((option) => (
                                        <CheckOption
                                            key={option}
                                            label={option}
                                            checked={form.profEligibility.includes(option)}
                                            onChange={() => toggleEligibility(option)}
                                        />
                                    ))}
                                    {form.profEligibility.includes('Others') && (
                                        <input
                                            type="text"
                                            placeholder="Please specify certification..."
                                            value={form.profEligibilityOther}
                                            onChange={(e) => setF('profEligibilityOther', e.target.value)}
                                            className={`${inputCls} mt-1`}
                                        />
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            type="submit"
                            disabled={isSaving}
                            className="flex-1 flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white py-3 rounded-xl text-sm transition disabled:opacity-70"
                            style={{ fontWeight: 600 }}
                        >
                            {isSaving
                                ? <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving...</>
                                : <><Save className="size-4" /> Save Personal and Education</>
                            }
                        </button>
                        {saved && (
                            <span className="flex items-center gap-1.5 text-emerald-600 text-sm shrink-0" style={{ fontWeight: 600 }}>
                                <CheckCircle2 className="size-5" /> Saved!
                            </span>
                        )}
                    </div>
                </form>

                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-start gap-3">
                    <Mail className="size-5 text-blue-500 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-blue-800 text-sm" style={{ fontWeight: 600 }}>Tip</p>
                        <p className="text-blue-700 text-xs mt-0.5 leading-relaxed">
                            Keep these fields up to date so the graduate tracer records and batch reporting remain accurate.
                        </p>
                    </div>
                </div>
            </div>
        </PortalLayout>
    );
}
