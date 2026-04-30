// Removed legacy firebase imports

export interface Customer {
    id: string;
    uid: string;
    displayName: string;
    email: string;
    phone?: string;
    photoURL?: string;
    role: 'customer';
    createdAt: string;
    lastLogin?: string;
    status: 'active' | 'blocked';
}
