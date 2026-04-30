import React from 'react';
import ConfirmationModal from '../common/ConfirmationModal';

interface VerifyPropertyModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    loading?: boolean;
}

const VerifyPropertyModal: React.FC<VerifyPropertyModalProps> = ({ isOpen, onClose, onConfirm, title, loading }) => {
    return (
        <ConfirmationModal
            isOpen={isOpen}
            onClose={onClose}
            onConfirm={onConfirm}
            title="Verify Property"
            message={`Verify "${title}"? This listing will become visible in customer search results immediately.`}
            confirmText="Verify Listing"
            variant="info"
            loading={loading}
        />
    );
};

export default VerifyPropertyModal;
