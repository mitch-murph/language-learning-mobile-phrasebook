import { registerRootComponent } from 'expo';
import TrackPlayer from 'react-native-track-player';

import App from './App';
import { playbackService } from './src/audio/trackPlayer';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

// Must be registered at the top level (outside any component) so RNTP can route
// media-button / lock-screen / Bluetooth events even before a screen mounts.
TrackPlayer.registerPlaybackService(() => playbackService);
