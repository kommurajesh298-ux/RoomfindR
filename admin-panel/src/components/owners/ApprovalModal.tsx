import React from 'react';
import ConfirmationModal from '../common/ConfirmationModal';

interface ApprovalModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    ownerName: string;
    loading?: boolean;
}

const ApprovalModal: React.FC<ApprovalModalProps> = ({ isOpen, onClose, onConfirm, ownerName, loading }) => {
    return (
        <ConfirmationModal
            isOpen={isOpen}
            onClose={onClose}
            onConfirm={onConfirm}
            title="Approve Owner"
            message={`Are you sure you want to approve "${ownerName}"? This will enable publishing for their properties and grant them owner privileges.`}
            confirmText="Approve Partner"
            variant="info"
            loading={loading}
        />
    );
};

export default ApprovalModal;
