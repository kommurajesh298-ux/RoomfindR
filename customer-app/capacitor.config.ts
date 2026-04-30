import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.roomfinder.app',
    appName: 'RoomFindR',
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
