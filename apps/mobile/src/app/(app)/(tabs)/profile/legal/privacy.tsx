import { StyleSheet } from 'react-native';

import { Screen, Text } from '@/components/ui';
import { space } from '@/design/tokens';

/**
 * Privacy policy — ROADMAP 6.1a. Deliberate functional placeholder, same
 * "ship the real data contract/navigation now, replace the copy later"
 * precedent as DESIGN.md §14.7's conversation-thread placeholder: the real
 * legal copy doesn't exist yet, but the Settings row needs somewhere real
 * to navigate to.
 */
export default function PrivacyPolicy() {
  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <Text variant="title">Privacy policy</Text>
      <Text variant="body" color="textSecondary">
        Fynd&apos;s full privacy policy will be published here before launch.
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
