export interface UserData {
    uid: string;
    role: 'customer' | 'owner' | 'admin';
    name: string;
    email: string;
    phone: string;
    phoneVerified: boolean;
    emailVerified: boolean;
    createdAt: string;
    verified?: boolean; // Admin verification status
    profilePhotoUrl?: string;
}
