
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
      <p>We collect information you provide directly to us, such as when you list a property, manage bookings, or communicate with customers.</p>
      <h2>2. How We Use Your Information</h2>
      <p>We use your information to facilitate the property rental process, manage your listings, and provide support.</p>
      <h2>3. Data Protection</h2>
      <p>We implement security measures to protect your professional data and listing information from unauthorized access.</p>
      <h2>4. Your Rights</h2>
      <p>You have the right to manage your listings and update your professional profile at any time.</p>
    `}
    />
);

export const TermsOfService = () => (
    <LegalPage
        title="Terms of Service"
        content={`
      <h2>1. Owner Responsibilities</h2>
      <p>As a property owner on RoomFindR, you are responsible for maintaining accurate listings and property conditions.</p>
      <h2>2. Fair Housing</h2>
      <p>Owners must comply with all local housing laws and avoid any discriminatory practices.</p>
      <h2>3. Communication</h2>
      <p>Professional conduct is required when communicating with potential and current tenants.</p>
      <h2>4. Dispute Resolution</h2>
      <p>RoomFindR provides tools for communication but is not responsible for mediating rental disputes.</p>
    `}
    />
);
