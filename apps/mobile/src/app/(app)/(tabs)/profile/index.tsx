import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Icon, ListRow, Screen, Text, type IconName } from '@/components/ui';
import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { signOut } from '@/features/auth/api';
import { useAuth } from '@/features/auth/auth-provider';

// Verified against the installed packages: 'chevron.right'/'chevron_right'
// exists in sf-symbols-typescript's types and expo-symbols' android/symbols.json
// (already used the same way for sell/[id].tsx's MOVE_LATER_ICON).
const CHEVRON_ICON: IconName = { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' };

export default function ProfileIndex() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const email = session?.user.email ?? session?.user.id;

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text variant="title">Profile</Text>
        <Text variant="body" color="textSecondary">
          {email}
        </Text>
      </View>

      <View style={styles.rows}>
        <ListRow
          title="Edit profile"
          onPress={() => router.push('/(app)/(tabs)/profile/edit')}
          trailing={<Icon name={CHEVRON_ICON} size="sm" color={colors.textTertiary} />}
        />
        <ListRow
          title="My listings"
          onPress={() => router.push('/(app)/(tabs)/profile/my-listings')}
          trailing={<Icon name={CHEVRON_ICON} size="sm" color={colors.textTertiary} />}
        />
      </View>

      <Button variant="secondary" size="sm" onPress={() => signOut()}>
        Sign out
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: space[6],
    paddingTop: space[6],
  },
  header: {
    gap: space[1],
  },
  rows: {
    gap: space[2],
  },
});
