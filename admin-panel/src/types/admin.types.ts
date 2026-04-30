export interface AdminUser {
    uid: string;
    email: string;
    role: 'admin';
    permissions: string[];
    createdAt: string;
    displayName?: string;
    photoURL?: string;
}
