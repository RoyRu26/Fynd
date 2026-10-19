import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { IconButton, Text, type IconName } from '@/components/ui';
import type { ConversationMessage, PendingMessage } from '@/features/conversation/optimistic';
import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';

/**
 * DESIGN.md has no visual spec for the chat thread yet (see the new §14.7
 * note). This is a deliberate, minimal PLACEHOLDER: plain left/right-aligned
 * `Text` rows built only from existing semantic tokens and primitives — no
 * bubble shape, fill, or shadow is invented here. Replace this component's
 * styling, not its data contract, once a real design exists.
 */

// Verified against the installed packages, same discipline as
// inbox/index.tsx's own EMPTY_ICON/ERROR_ICON: 'arrow.clockwise' exists in
// sf-symbols-typescript's dist/index.d.ts, and 'refresh' exists in
// expo-symbols' android/symbols.json.
const RETRY_ICON: IconName = { ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' };

export type MessageBubbleProps = {
  message: ConversationMessage;
  /** Whether the signed-in viewer sent this message — determines alignment. */
  isOwn: boolean;
  /** The other participant's display name, for the accessibility label. */
  otherPartyName: string;
  /** Required when `message` can be a failed `PendingMessage`; ignored otherwise. */
  onRetry?: (message: PendingMessage) => void;
};

export function MessageBubble({ message, isOwn, otherPartyName, onRetry }: MessageBubbleProps) {
  const { colors } = useAppTheme();

  const isPending = message.kind === 'pending';
  const isSending = isPending && message.status === 'sending';
  const isFailed = isPending && message.status === 'failed';

  // DESIGN.md §12.4 — never color/position-only status: the sender is
  // stated explicitly in the label, alignment is a sighted-only cue, and
  // the 'sending' state is appended as text rather than relying on the
  // spinner's presence alone.
  const senderLabel = isOwn ? 'You' : otherPartyName;
  const accessibilityLabel = `${senderLabel}: ${message.body}${isSending ? ', sending' : ''}`;

  return (
    <View style={[styles.row, { alignSelf: isOwn ? 'flex-end' : 'flex-start' }]}>
      <View style={styles.contentRow}>
        {isFailed ? (
          <IconButton
            icon={RETRY_ICON}
            color="danger"
            accessibilityLabel="Message failed to send. Double tap to retry."
            onPress={() => onRetry?.(message as PendingMessage)}
          />
        ) : null}
        <Text
          variant="body"
          color={isFailed ? 'danger' : 'text'}
          style={{ textAlign: isOwn ? 'right' : 'left' }}
          accessibilityLabel={accessibilityLabel}>
          {message.body}
        </Text>
        {isSending ? <ActivityIndicator size="small" color={colors.textTertiary} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    maxWidth: '85%',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
});
