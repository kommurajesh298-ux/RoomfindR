export interface Owner {
    ownerId: string;
    userRef: string;
    name: string;
    email: string;
    phone: string;
    profilePhotoUrl?: string;
    rating?: number;
    verified: boolean;
    propertiesCount: number;
    createdAt: string;
}
