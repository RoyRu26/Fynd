import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { getInitials } from '@/components/ui/avatar-state';
import { Text, type TextVariant } from '@/components/ui/text';
import { useAppTheme } from '@/design/theme-provider';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export type AvatarProps = {
  size?: AvatarSize;
  /** Image URI. Uses expo-image directly rather than a shared blurhash/recycling wrapper — see DESIGN.md §11 note in the plan; no real avatar images exist yet and avatars aren't a list-recycling concern the way listing photos are. */
  source?: string;
  name?: string;
  accessibilityLabel?: string;
};

// DESIGN.md doesn't specify exact avatar sizes, and there's exactly one
// consumer (this file) — per the second-caller rule these stay local rather
// than being promoted to a shared token.
// `xl` (84) is the onboarding avatar picker's size. It exists as a real step
// rather than being faked with a `style` override because the picker's empty
// state is a separate 84px dashed circle: if the two diverged, the control
// would visibly resize the instant a photo was chosen.
const DIAMETER: Record<AvatarSize, number> = { xs: 24, sm: 32, md: 40, lg: 56, xl: 84 };
const INITIALS_VARIANT: Record<AvatarSize, TextVariant> = {
  xs: 'micro',
  sm: 'caption',
  md: 'label',
  lg: 'heading',
  xl: 'title',
};

export function Avatar({ size = 'md', source, name, accessibilityLabel }: AvatarProps) {
  const { colors } = useAppTheme();
  const diameter = DIAMETER[size];
  const label = accessibilityLabel ?? (name ? `${name}'s avatar` : undefined);

  return (
    <View
      style={[
        styles.circle,
        { width: diameter, height: diameter, borderRadius: diameter / 2, backgroundColor: colors.bgSunken },
      ]}
      accessible={Boolean(label)}
      accessibilityLabel={label}>
      {source ? (
        <Image source={{ uri: source }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <Text variant={INITIALS_VARIANT[size]} color="textSecondary">
          {getInitials(name ?? '')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
