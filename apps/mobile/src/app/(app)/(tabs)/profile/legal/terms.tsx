import { StyleSheet } from 'react-native';

import { Screen, Text } from '@/components/ui';
import { space } from '@/design/tokens';

/**
 * Terms of service — ROADMAP 6.1a. Deliberate functional placeholder, same
 * reasoning as this folder's privacy.tsx.
 */
export default function TermsOfService() {
  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <Text variant="title">Terms of service</Text>
      <Text variant="body" color="textSecondary">
        Fynd&apos;s full terms of service will be published here before launch.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: space[4],
    paddingTop: space[6],
  },
});
