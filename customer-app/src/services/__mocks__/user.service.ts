export const userService = {
    createUserDocument: jest.fn().mockResolvedValue(undefined),
    getUserDocument: jest.fn().mockResolvedValue(null),
    updateUserProfile: jest.fn().mockResolvedValue(undefined),
    uploadProfilePhoto: jest.fn().mockResolvedValue('https://example.com/avatar.png'),
    updatePassword: jest.fn().mockResolvedValue(undefined),
    getFavorites: jest.fn().mockResolvedValue([]),
    toggleFavorite: jest.fn().mockResolvedValue(true),
    updateAuthEmail: jest.fn().mockResolvedValue(undefined),
    updateNotificationPreferences: jest.fn().mockResolvedValue(undefined),
    updateLanguage: jest.fn().mockResolvedValue(undefined),
    subscribeToUserDocument: jest.fn(() => jest.fn()),
};
