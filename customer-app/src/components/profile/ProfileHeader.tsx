import React from 'react';
import type { UserData } from '../../services/user.service';
import { FaCamera, FaUser } from 'react-icons/fa';

interface ProfileHeaderProps {
    user: UserData;
    avatarUrl?: string;
    onPhotoChange: (file: File) => void;
    isEditing: boolean;
}

const ProfileHeader: React.FC<ProfileHeaderProps> = ({ user, avatarUrl, onPhotoChange }) => {
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            onPhotoChange(file);
        }
    };

    const resolvedAvatarUrl = String(avatarUrl || user.profilePhotoUrl || '').trim();

    return (
        <div className="bg-white rounded-[18px] border border-gray-100 shadow-sm p-5">
            <div className="flex flex-col items-center space-y-4">
                <div className="relative mx-auto">
                    <div className="w-[100px] h-[100px] rounded-full overflow-hidden bg-white flex items-center justify-center ring-4 ring-gray-50 shadow-sm relative">
                        {resolvedAvatarUrl ? (
                            <img
                                src={resolvedAvatarUrl}
                                alt={user.name}
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gray-100">
                                <FaUser className="w-10 h-10 text-gray-300" />
                            </div>
                        )}
                    </div>

                    <label className="absolute bottom-0 right-0 w-[36px] h-[36px] bg-[#2563eb] text-white rounded-full flex items-center justify-center shadow-lg active:scale-90 z-10 border-2 border-white">
                        <FaCamera size={14} />
                        <input
                            type="file"
                            name="profilePhoto"
                            accept="image/*"
                            className="hidden"
                            onChange={handleFileChange}
                        />
                    </label>
                </div>

                <div className="text-center">
                    <h2 className="text-[20px] font-semibold text-[#111827] leading-tight">{user.name}</h2>
                    <p className="text-[14px] text-[#6B7280] mt-0.5">{user.email}</p>
                    <div className="mt-4 flex justify-center gap-2">
                        <span className="px-3 py-1 bg-blue-50 text-[#2563eb] text-[11px] font-black rounded-full uppercase tracking-widest border border-blue-100">
                            {user.role}
                        </span>
                        <span className="px-3 py-1 bg-gray-50 text-[#6B7280] text-[11px] font-bold rounded-full uppercase tracking-widest border border-gray-100">
                            ID Verified
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProfileHeader;
