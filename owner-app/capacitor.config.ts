import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.roomfindr.owner',
    appName: 'RoomFindR Owner',
    webDir: 'dist',
    server: {
        androidScheme: 'https'
    },
    plugins: {
        PushNotifications: {
            presentationOptions: ['badge', 'sound', 'alert']
        }
    }
};

export default config;
