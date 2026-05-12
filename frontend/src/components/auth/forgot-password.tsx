/**
 * Forgot Password modal — three-step flow shared by Graduate and Employer
 * roles. Step 1 collects the email and triggers the SMTP send. Step 2
 * collects the 12-digit code (XXX-XXX-XXX-XXX) and the new password,
 * shows a live code-expiry countdown plus a separate resend cooldown.
 * Step 3 confirms success.
 *
 * The dialog never reveals whether the email is registered.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Mail, Lock, AlertCircle, CheckCircle2, X, RefreshCw, KeyRound, ArrowLeft } from 'lucide-react';
import {
    forgotPasswordCheckCode,
    forgotPasswordRequest,
    forgotPasswordResend,
    forgotPasswordSetPassword,
    type ForgotRole,
} from '../../app/api-client';

type Step = 'request' | 'code' | 'password' | 'done';

interface ForgotPasswordModalProps {
    open: boolean;
    /**
     * Optional scope hint. Pass "employer" from the employer portal to
     * restrict the lookup. Leave undefined on the unified login page so
     * the backend auto-detects across graduate, employer, and admin.
     */
    role?: ForgotRole;
    initialEmail?: string;
    onClose: () => void;
}

const CODE_LENGTH = 12;

function formatCodeInput(raw: string): string {
    const digits = raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
    const parts: string[] = [];
    for (let i = 0; i < digits.length; i += 3) parts.push(digits.slice(i, i + 3));
    return parts.join('-');
}

function fmt(seconds: number): string {
    if (seconds <= 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function ForgotPasswordModal({
    open, role, initialEmail = '', onClose,
}: ForgotPasswordModalProps) {
    const [step, setStep] = useState<Step>('request');
    const [email, setEmail] = useState(initialEmail);
    const [code, setCode] = useState('');
    const [resetTicket, setResetTicket] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');
    const [codeRemaining, setCodeRemaining] = useState(0);
    const [resendRemaining, setResendRemaining] = useState(0);
    const [ticketRemaining, setTicketRemaining] = useState(0);
    const [showPassword, setShowPassword] = useState(false);
    /** Role resolved by the backend (used for resend after auto-detect). */
    const [resolvedRole, setResolvedRole] = useState<ForgotRole | undefined>(role);
    const tickRef = useRef<number | null>(null);

    // Reset state every time the modal opens.
    useEffect(() => {
        if (!open) return;
        setStep('request');
        setEmail(initialEmail);
        setCode('');
        setResetTicket('');
        setPassword('');
        setConfirm('');
        setError('');
        setInfo('');
        setCodeRemaining(0);
        setResendRemaining(0);
        setTicketRemaining(0);
        setResolvedRole(role);
    }, [open, initialEmail, role]);

    // Countdown tick.
    useEffect(() => {
        if (!open) return;
        if (codeRemaining <= 0 && resendRemaining <= 0 && ticketRemaining <= 0) {
            if (tickRef.current) window.clearInterval(tickRef.current);
            tickRef.current = null;
            return;
        }
        tickRef.current = window.setInterval(() => {
            setCodeRemaining(prev => Math.max(0, prev - 1));
            setResendRemaining(prev => Math.max(0, prev - 1));
            setTicketRemaining(prev => Math.max(0, prev - 1));
        }, 1000);
        return () => {
            if (tickRef.current) window.clearInterval(tickRef.current);
            tickRef.current = null;
        };
    }, [open, codeRemaining, resendRemaining, ticketRemaining]);

    const inputCls = 'w-full px-3.5 py-2.5 border border-gray-200 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500';
    const passOk = password.length >= 8;
    const passwordsMatch = password === confirm && passOk;
    const codeDigits = code.replace(/\D/g, '');
    const canSubmitCode = codeDigits.length === CODE_LENGTH && !busy;
    const canSubmitPassword = passOk && passwordsMatch && !busy && resetTicket.length > 0;

    async function handleRequest() {
        if (!email || !email.includes('@')) {
            setError('Please enter a valid email.');
            return;
        }
        setBusy(true); setError(''); setInfo('');
        try {
            const res = await forgotPasswordRequest(email.trim().toLowerCase(), role);
            setCodeRemaining(res.code_expires_in_seconds);
            setResendRemaining(res.resend_available_in_seconds);
            if (res.role) setResolvedRole(res.role);
            setInfo(res.message);
            setStep('code');
        } catch (err) {
            const e = err as Error & { status?: number };
            if (e.status === 404) {
                setError('No account is registered with that email.');
            } else {
                setError(e.message || 'Could not send the code. Try again.');
            }
        } finally {
            setBusy(false);
        }
    }

    async function handleResend() {
        if (resendRemaining > 0 || busy) return;
        setBusy(true); setError(''); setInfo('');
        try {
            const res = await forgotPasswordResend(email.trim().toLowerCase(), resolvedRole ?? role);
            setCodeRemaining(res.code_expires_in_seconds);
            setResendRemaining(res.resend_available_in_seconds);
            if (res.role) setResolvedRole(res.role);
            setInfo('A new code is on the way.');
            setCode('');
        } catch (err) {
            setError((err as Error).message || 'Could not resend. Try again.');
        } finally {
            setBusy(false);
        }
    }

    async function handleCheckCode() {
        if (!canSubmitCode) return;
        setBusy(true); setError(''); setInfo('');
        try {
            const res = await forgotPasswordCheckCode(
                email.trim().toLowerCase(),
                resolvedRole ?? role,
                codeDigits,
            );
            setResetTicket(res.reset_ticket);
            setTicketRemaining(res.ticket_expires_in_seconds);
            if (res.role) setResolvedRole(res.role);
            setInfo('Code accepted. Set your new password below.');
            setStep('password');
        } catch (err) {
            const e = err as Error & { payload?: Record<string, unknown> };
            const lockoutSeconds = e.payload?.lockout_seconds as number | undefined;
            const remaining = e.payload?.remaining_attempts as number | undefined;
            if (lockoutSeconds && lockoutSeconds > 0) {
                setError(`Too many failed attempts. Try again in ${fmt(lockoutSeconds)}.`);
            } else if (typeof remaining === 'number') {
                setError(`${e.message} (${remaining} attempt${remaining === 1 ? '' : 's'} left)`);
            } else {
                setError(e.message || 'Verification failed.');
            }
        } finally {
            setBusy(false);
        }
    }

    async function handleSetPassword() {
        if (!canSubmitPassword) return;
        setBusy(true); setError(''); setInfo('');
        try {
            await forgotPasswordSetPassword(resetTicket, password);
            setStep('done');
        } catch (err) {
            const e = err as Error & { payload?: Record<string, unknown> };
            const detail = (e.payload?.detail as string) || e.message;
            // If the ticket expired, send the user back to the code step.
            if (/ticket|expired|no longer valid/i.test(detail || '')) {
                setError('The ticket expired. Please verify the code again.');
                setResetTicket('');
                setStep('code');
                return;
            }
            setError(detail || 'Could not update password.');
        } finally {
            setBusy(false);
        }
    }

    const titleByStep = useMemo(() => ({
        request:  'Reset your password',
        code:     'Enter the code we sent',
        password: 'Set a new password',
        done:     'Password updated',
    }), []);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
            role="dialog"
            aria-modal="true"
        >
            <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
                {/* Header */}
                <div className="bg-emerald-700 text-white px-5 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <KeyRound className="size-4" />
                        <h2 className="text-sm font-semibold tracking-wide">{titleByStep[step]}</h2>
                    </div>
                    <button
                        type="button"
                        aria-label="Close"
                        onClick={onClose}
                        className="text-white/80 hover:text-white"
                    >
                        <X className="size-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-5 space-y-4">
                    {error && (
                        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                            <AlertCircle className="size-4 shrink-0 mt-0.5" />
                            <span>{error}</span>
                        </div>
                    )}
                    {info && !error && (
                        <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-800">
                            <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
                            <span>{info}</span>
                        </div>
                    )}

                    {step === 'request' && (
                        <div className="space-y-3">
                            <p className="text-sm text-gray-700 leading-snug">
                                {`Type your registered ${role ?? 'account'} email. We'll send a 12-digit code that expires in 15 minutes.`}
                            </p>
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                    Email
                                </label>
                                <div className="relative">
                                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={e => setEmail(e.target.value)}
                                        placeholder="you@example.com"
                                        className={`${inputCls} pl-10`}
                                        autoFocus
                                    />
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={handleRequest}
                                disabled={busy || !email}
                                className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-sm font-semibold rounded-lg py-2.5 transition"
                            >
                                {busy ? 'Sending…' : 'Send code'}
                            </button>
                        </div>
                    )}

                    {step === 'code' && (
                        <div className="space-y-3">
                            <p className="text-sm text-gray-700 leading-snug">
                                Code sent to <strong>{email}</strong>. Type the 12-digit code
                                below. You will set your new password after the code is verified.
                            </p>

                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                    Reset code
                                </label>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    value={code}
                                    onChange={e => setCode(formatCodeInput(e.target.value))}
                                    placeholder="XXX-XXX-XXX-XXX"
                                    className={`${inputCls} font-mono tracking-widest text-center text-base`}
                                    maxLength={15}
                                    autoFocus
                                />
                                <div className="mt-1 flex items-center justify-between text-[11px] text-gray-500">
                                    <span>
                                        {codeRemaining > 0
                                            ? `Code expires in ${fmt(codeRemaining)}`
                                            : 'Code expired. Resend a new one.'}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={handleResend}
                                        disabled={resendRemaining > 0 || busy}
                                        className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-800 disabled:text-gray-400"
                                    >
                                        <RefreshCw className="size-3" />
                                        {resendRemaining > 0
                                            ? `Resend in ${fmt(resendRemaining)}`
                                            : 'Resend code'}
                                    </button>
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={handleCheckCode}
                                disabled={!canSubmitCode}
                                className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-sm font-semibold rounded-lg py-2.5 transition"
                            >
                                {busy ? 'Verifying…' : 'Verify code'}
                            </button>
                        </div>
                    )}

                    {step === 'password' && (
                        <div className="space-y-3">
                            <p className="text-sm text-gray-700 leading-snug">
                                Code verified. Set a new password for <strong>{email}</strong>.
                                {ticketRemaining > 0 && (
                                    <span className="block text-[11px] text-gray-500 mt-1">
                                        Finish within {fmt(ticketRemaining)} or you will need to
                                        verify the code again.
                                    </span>
                                )}
                            </p>

                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                    New password (8+ characters)
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        className={`${inputCls} pl-10`}
                                        autoFocus
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                    Confirm new password
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        value={confirm}
                                        onChange={e => setConfirm(e.target.value)}
                                        className={`${inputCls} pl-10`}
                                    />
                                </div>
                                <div className="mt-1 flex items-center justify-between text-[11px]">
                                    <label className="inline-flex items-center gap-1.5 text-gray-500">
                                        <input
                                            type="checkbox"
                                            checked={showPassword}
                                            onChange={() => setShowPassword(v => !v)}
                                        />
                                        Show password
                                    </label>
                                    {confirm.length > 0 && !passwordsMatch && (
                                        <span className="text-red-600">Passwords do not match</span>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-2 pt-1">
                                <button
                                    type="button"
                                    onClick={() => { setResetTicket(''); setStep('code'); setError(''); setInfo(''); }}
                                    className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                                >
                                    <ArrowLeft className="size-3" /> Back to code
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSetPassword}
                                    disabled={!canSubmitPassword}
                                    className="ml-auto bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-sm font-semibold rounded-lg px-5 py-2.5 transition"
                                >
                                    {busy ? 'Updating…' : 'Set new password'}
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 'done' && (
                        <div className="space-y-4 text-center py-4">
                            <CheckCircle2 className="size-12 text-emerald-600 mx-auto" />
                            <p className="text-sm text-gray-700">
                                Your password was updated. You can now log in with the new
                                password.
                            </p>
                            <button
                                type="button"
                                onClick={onClose}
                                className="w-full bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-lg py-2.5 transition"
                            >
                                Done
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
