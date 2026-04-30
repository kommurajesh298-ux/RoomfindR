
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { sanitizeHtml } from '../../../shared/dompurify';

interface LegalProps {
    title: string;
    content: string;
}

const LegalPage: React.FC<LegalProps> = ({ title, content }) => {
    const navigate = useNavigate();
    const sanitizedContent = sanitizeHtml(content);
    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <div className="bg-white border-b px-4 py-4 sticky top-0 z-10">
                <div className="flex items-center gap-4 max-w-4xl mx-auto">
                    <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-full">
                        <ArrowLeft size={24} />
                    </button>
                    <h1 className="text-xl font-bold">{title}</h1>
                </div>
            </div>

            <div className="flex-1 max-w-4xl mx-auto px-6 py-8">
                <div className="bg-white p-8 rounded-2xl shadow-sm border prose max-w-none">
                    <div dangerouslySetInnerHTML={{ __html: sanitizedContent }} />
                </div>
            </div>
        </div>
    );
};

export const PrivacyPolicy = () => (
    <LegalPage
        title="Privacy Policy"
        content={`
      <h2>1. Information We Collect</h2>
      <p>We collect information you provide directly to us, such as when you create an account, book a property, or contact support.</p>
      <h2>2. How We Use Your Information</h2>
      <p>We use your information to facilitate bookings, improve our services, and communicate with you.</p>
      <h2>3. Data Protection</h2>
      <p>We implement security measures to protect your personal data from unauthorized access.</p>
      <h2>4. Your Rights</h2>
      <p>You have the right to access, correct, or delete your personal information at any time.</p>
    `}
    />
);

export const TermsOfService = () => (
    <LegalPage
        title="Terms of Service"
        content={`
      <h2>1. Acceptance of Terms</h2>
      <p>By using RoomFindR, you agree to these terms and conditions.</p>
      <h2>2. Booking Policy</h2>
      <p>All bookings are subject to availability and confirmation by the property owner.</p>
      <h2>3. User Conduct</h2>
      <p>Users must provide accurate information and respect the properties they visit.</p>
      <h2>4. Liability</h2>
      <p>RoomFindR is a platform connecting users and owners. We are not liable for property conditions or user conduct.</p>
    `}
    />
);
