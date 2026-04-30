import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    FiAlertCircle,
    FiArrowRight,
    FiCheck,
    FiEye,
    FiEyeOff,
    FiLock,
    FiMail
} from 'react-icons/fi';
import { toast } from 'react-hot-toast';
import LoadingOverlay from '../components/common/LoadingOverlay';
import { authService } from '../services/auth.service';
import { validateEmail } from '../utils/validation';

const Login: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState<string | null>((location.state as { error?: string } | null)?.error ?? null);

    const from = location.state?.from?.pathname || '/dashboard';

    const passwordHint = useMemo(() => {
        if (!password) return 'Use your verified admin password to enter the control panel.';
        if (password.length < 8) return 'Password must be at least 8 characters.';
        return 'Password format looks valid.';
    }, [password]);

    const handleSignIn = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);

        if (!validateEmail(email)) {
            setError('Please enter a valid admin email');
            return;
        }

        if (password.trim().length < 8) {
            setError('Please enter your password');
            return;
        }

        setLoading(true);
        try {
            const { user } = await authService.signInWithEmail(email, password);
            if (!user) {
                throw new Error('Authentication failed');
            }

            toast.success('Welcome back, Admin');
            navigate(from, { replace: true });
        } catch (err: unknown) {
            const message = (err as Error).message?.toLowerCase() ?? '';
            if (message.includes('unauthorized')) {
                setError('Unauthorized. Admin access only.');
            } else if (message.includes('invalid login credentials')) {
                setError('Invalid email or password.');
            } else {
                setError('Failed to sign in. Check your email and password.');
            }
            toast.error('Admin sign-in failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative min-h-screen overflow-hidden bg-[linear-gradient(145deg,#ff8c2f_0%,#f97316_44%,#ea580c_100%)] text-slate-950">
            {loading && <LoadingOverlay message="Authenticating admin session..." />}

            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute -left-24 bottom-[-8rem] h-[24rem] w-[24rem] rounded-full bg-white/18" />
                <div className="absolute right-[-6rem] top-[-5rem] h-[20rem] w-[20rem] rounded-full bg-white/12" />
                <div className="absolute right-[12%] top-[24%] h-40 w-40 rounded-full bg-[#2563EB]/14 blur-3xl" />
            </div>

            <div className="relative mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4 py-6 sm:px-5 lg:px-8">
                <div className="grid w-full max-w-5xl overflow-hidden rounded-[38px] bg-white/94 shadow-[0_40px_100px_rgba(120,46,0,0.24)] lg:grid-cols-[0.92fr_1.08fr]">
                    <section className="relative flex items-center justify-center overflow-hidden bg-[linear-gradient(180deg,#ff962f_0%,#f97316_56%,#ea580c_100%)] px-6 py-10 text-white sm:px-8 lg:px-10">
                        <div className="absolute -bottom-16 -left-12 h-48 w-48 rounded-full bg-white/12" />
                        <div className="absolute -right-12 top-10 h-36 w-36 rounded-full bg-white/12" />

                        <div className="relative z-10 grid w-full max-w-md justify-items-center gap-6 text-center">
                            <div className="inline-flex items-center gap-3">
                                <span className="inline-flex h-16 w-16 items-center justify-center overflow-hidden rounded-[18px] bg-transparent shadow-[0_12px_24px_rgba(15,23,42,0.16)]">
                                    <img
                                        src="/assets/images/logos/logo.png"
                                        alt="RoomFindR"
                                        className="h-full w-full scale-[1.08] rounded-[inherit] object-cover no-logo-badge"
                                    />
                                </span>
                                <span className="text-sm font-black uppercase tracking-[0.28em] text-white/90">RoomFindR</span>
                            </div>

                            <span className="inline-flex h-20 w-20 items-center justify-center rounded-full border-[3px] border-white/85 text-4xl font-black shadow-[0_18px_36px_rgba(126,47,0,0.22)]">
                                <FiCheck />
                            </span>

                            <div className="space-y-3">
                                <p className="text-[0.76rem] font-extrabold uppercase tracking-[0.34em] text-white/78">Control Center</p>
                                <h1 className="text-[clamp(2rem,3vw,2.9rem)] font-black uppercase leading-[0.94] tracking-[0.02em]">
                                    Admin Login
                                </h1>
                                <p className="mx-auto max-w-sm text-sm leading-7 text-white/82">
                                    Review approvals, refunds, rent collections, owner verification, and live platform actions from one secure desk.
                                </p>
                            </div>

                            <div className="grid w-full gap-3 rounded-[28px] bg-white/10 p-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] backdrop-blur-sm">
                                <div className="rounded-[22px] bg-white/10 px-4 py-3">
                                    <p className="text-[0.66rem] font-bold uppercase tracking-[0.26em] text-white/70">Role Guard</p>
                                    <p className="mt-2 text-sm leading-6 text-white/90">Only verified admin accounts can enter this console.</p>
                                </div>
                                <div className="rounded-[22px] bg-white/10 px-4 py-3">
                                    <p className="text-[0.66rem] font-bold uppercase tracking-[0.26em] text-white/70">Live Scope</p>
                                    <p className="mt-2 text-sm leading-6 text-white/90">Bookings, payments, owner approvals, refunds, and realtime operational status.</p>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="bg-white px-5 py-6 sm:px-7 sm:py-8 lg:px-10 lg:py-10">
                        <div className="mx-auto flex h-full max-w-xl flex-col justify-center gap-6">
                            <div className="space-y-3">
                                <span className="inline-flex items-center gap-2 rounded-full bg-[#fff2e8] px-3 py-1 text-[0.7rem] font-extrabold uppercase tracking-[0.24em] text-[#f97316]">
                                    Verified Admin Sign-In
                                </span>
                                <div className="space-y-2">
                                    <h2 className="text-[clamp(2rem,2.3vw,2.5rem)] font-black uppercase leading-[0.96] text-[#18243f]">
                                        Sign in
                                    </h2>
                                    <p className="max-w-md text-sm leading-7 text-slate-500">
                                        Use your admin email and password to enter the RoomFindR operations dashboard.
                                    </p>
                                </div>
                            </div>

                            {error ? (
                                <div className="flex items-start gap-3 rounded-[24px] border border-[#f3c2b7] bg-[#fff2ed] px-4 py-3 text-sm text-[#b5492d]">
                                    <FiAlertCircle className="mt-0.5 shrink-0" size={16} />
                                    <span>{error}</span>
                                </div>
                            ) : null}

                            <form onSubmit={handleSignIn} className="space-y-4">
                                <div className="space-y-2">
                                    <label htmlFor="admin-login-email" className="block text-[0.72rem] font-extrabold uppercase tracking-[0.22em] text-slate-600">
                                        Admin Email
                                    </label>
                                    <div className="group relative rounded-[24px] border border-[#dbe7fb] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] px-4 py-4 shadow-[0_12px_28px_rgba(37,99,235,0.06)] transition-all focus-within:border-[#f97316] focus-within:shadow-[0_0_0_4px_rgba(249,115,22,0.12)]">
                                        <FiMail className="absolute left-4 top-1/2 -translate-y-1/2 text-[#2563EB]" />
                                        <input
                                            id="admin-login-email"
                                            name="email"
                                            type="email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value.toLowerCase())}
                                            className="w-full bg-transparent pl-8 pr-2 text-[0.96rem] font-semibold text-slate-900 outline-none placeholder:text-slate-400"
                                            placeholder="admin@roomfindr.com"
                                            autoComplete="email"
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label htmlFor="admin-login-password" className="block text-[0.72rem] font-extrabold uppercase tracking-[0.22em] text-slate-600">
                                        Password
                                    </label>
                                    <div className="group relative rounded-[24px] border border-[#dbe7fb] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] px-4 py-4 shadow-[0_12px_28px_rgba(37,99,235,0.06)] transition-all focus-within:border-[#f97316] focus-within:shadow-[0_0_0_4px_rgba(249,115,22,0.12)]">
                                        <FiLock className="absolute left-4 top-1/2 -translate-y-1/2 text-[#2563EB]" />
                                        <input
                                            id="admin-login-password"
                                            name="password"
                                            type={showPassword ? 'text' : 'password'}
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            className="w-full bg-transparent pl-8 pr-10 text-[0.96rem] font-semibold text-slate-900 outline-none placeholder:text-slate-400"
                                            placeholder="Enter your password"
                                            autoComplete="current-password"
                                            required
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword((prev) => !prev)}
                                            className="absolute right-4 top-1/2 -translate-y-1/2 text-[#2563EB] transition-colors hover:text-[#f97316]"
                                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                                        >
                                            {showPassword ? <FiEyeOff size={18} /> : <FiEye size={18} />}
                                        </button>
                                    </div>
                                    <p className="px-1 text-xs text-slate-500">{passwordHint}</p>
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="group inline-flex w-full items-center justify-center gap-3 rounded-full bg-[linear-gradient(135deg,#ff912f_0%,#f97316_56%,#ea580c_100%)] px-6 py-4 text-[0.95rem] font-black uppercase tracking-[0.18em] text-white shadow-[0_18px_34px_rgba(249,115,22,0.24)] transition-all duration-200 hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <span>Enter Admin Console</span>
                                    <FiArrowRight className="transition-transform duration-200 group-hover:translate-x-1" size={18} />
                                </button>
                            </form>

                            <div className="rounded-[28px] border border-[#dbe7fb] bg-[#f9fbff] p-4">
                                <p className="text-[0.68rem] font-black uppercase tracking-[0.26em] text-[#2563EB]">Security Notice</p>
                                <p className="mt-2 text-sm leading-7 text-slate-600">
                                    Administrative access is logged and restricted to authorized personnel only.
                                </p>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
};

export default Login;
