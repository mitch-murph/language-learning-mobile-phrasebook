import { Pressable } from 'react-native';
import { tap, tapStrong } from './haptics';

// Pressable that fires a haptic buzz on every press, so controls can be
// confirmed by feel without looking. Drop-in for react-native's Pressable;
// pass `strong` for the heavier buzz on primary actions.
export function Btn({ onPress, strong = false, ...props }) {
  return (
    <Pressable
      {...props}
      onPress={(e) => {
        (strong ? tapStrong : tap)();
        onPress?.(e);
      }}
    />
  );
}
