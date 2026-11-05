import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { IconButton, Text, type IconName } from '@/components/ui';
import { radius, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { formatInboxTimestamp } from '@/features/inbox/inbox';
import type { ConversationMessage, PendingMessage } from '@/features/conversation/optimistic';

/**
 * SCREENS.md Task 8 / the 5a handoff, replacing Task 6's 2d-spec styling:
 * theirs is `bgElevated` + a 1.5px `text` outline, mine stays
 * `bgInverse`/`textInverse` — each with one sharp "tail" corner (bottom-left
 * for theirs, bottom-right for mine) via a bespoke 18pt radius on the other
 * three and `radius.xs` on that one. 18pt doesn't land on the shared radius
 * scale (nearest is `xl` at 16), so — same precedent `POLAROID_BORDER_WIDTH`
 * and the chat tab's own `TAB_LABEL_FONT_SIZE` follow elsewhere in this
 * handoff — it's a local, bespoke constant rather than a silent snap to a
 * token that doesn't actually match.
 *
 * `showTime` is owned by the caller (`buildChatListItems`'s own grouping),
 * not derived here: this component renders one bubble, it does not know
 * about its neighbors.
 *
 * TODO(SCREENS.md Task 8 "Needs backend" — skipped, no data to restyle):
 *   - Offer message (accent card bubble, "OFFER" label, struck original
 *     price, Accept/Counter pills). `messages` has no offer columns at all
 *     (amount, status, original price) — only `body`/`client_nonce`/ids/
 *     timestamps (20260929090000_chat_conversations_and_messages.sql).
 *   - Heart reaction on long-press. No reactions table/column exists.
 *   - Image message (150x190 rotated tile). `body` is the only content
 *     field; there is no attachment/image column or storage bucket for
 *     message images.
 * Revisit once any of these has a real column/table/RPC behind it.
 */

// Verified against the installed packages, same discipline as
// inbox/index.tsx's own EMPTY_ICON/ERROR_ICON: 'arrow.clockwise' exists in
// sf-symbols-typescript's dist/index.d.ts, and 'refresh' exists in
// expo-symbols' android/symbols.json.
const RETRY_ICON: IconName = { ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' };

const BUBBLE_MAX_WIDTH = '76%';
const BUBBLE_PADDING_VERTICAL = 10;
const BUBBLE_PADDING_HORIZONTAL = 14;
const BUBBLE_RADIUS = 18;
const BUBBLE_TEXT_FONT_SIZE = 15;
const BUBBLE_TEXT_LINE_HEIGHT = 20;
const BUBBLE_BORDER_WIDTH = 1.5;

export type MessageBubbleProps = {
  message: ConversationMessage;
  /** Whether the signed-in viewer sent this message — determines alignment and tone. */
  isOwn: boolean;
  /** The other participant's display name, for the accessibility label. */
  otherPartyName: string;
  /** Whether this is the newest message of its consecutive-same-sender, same-day run — see `buildChatListItems`. */
  showTime: boolean;
  /** Required when `message` can be a failed `PendingMessage`; ignored otherwise. */
  onRetry?: (message: PendingMessage) => void;
};

export function MessageBubble({ message, isOwn, otherPartyName, showTime, onRetry }: MessageBubbleProps) {
  const { colors } = useAppTheme();

  const isPending = message.kind === 'pending';
  const isSending = isPending && message.status === 'sending';
  const isFailed = isPending && message.status === 'failed';
  const time = showTime ? formatInboxTimestamp(message.createdAt) : '';

  // DESIGN.md §12.4 — never color/position-only status: the sender is
  // stated explicitly in the label, alignment is a sighted-only cue, and
  // the 'sending' state is appended as text rather than relying on the
  // spinner's presence alone.
  const senderLabel = isOwn ? 'You' : otherPartyName;
  const accessibilityLabel = `${senderLabel}: ${message.body}${isSending ? ', sending' : ''}`;

  return (
    <View
      style={[
        styles.row,
        { alignSelf: isOwn ? 'flex-end' : 'flex-start', alignItems: isOwn ? 'flex-end' : 'flex-start' },
      ]}>
      <View style={styles.contentRow}>
        {isFailed ? (
          <IconButton
            icon={RETRY_ICON}
            color="danger"
            accessibilityLabel="Message failed to send. Double tap to retry."
            onPress={() => onRetry?.(message as PendingMessage)}
          />
        ) : null}
        <View
          style={[
            styles.bubble,
            isOwn
              ? {
                  backgroundColor: isFailed ? colors.dangerBg : colors.bgInverse,
                  borderBottomRightRadius: radius.xs,
                }
              : {
                  backgroundColor: colors.bgElevated,
                  borderWidth: BUBBLE_BORDER_WIDTH,
                  borderColor: colors.text,
                  borderBottomLeftRadius: radius.xs,
                },
          ]}>
          <Text
            variant="body"
            color={isFailed ? 'danger' : isOwn ? 'textInverse' : 'text'}
            style={styles.bubbleText}
            accessibilityLabel={accessibilityLabel}>
            {message.body}
          </Text>
        </View>
        {isSending ? <ActivityIndicator size="small" color={colors.textTertiary} /> : null}
      </View>
      {time ? (
        <Text variant="micro" color="textTertiary" importantForAccessibility="no" style={styles.time}>
          {time}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    maxWidth: BUBBLE_MAX_WIDTH,
    gap: space[1] / 2,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space[2],
  },
  bubble: {
    borderRadius: BUBBLE_RADIUS,
    paddingHorizontal: BUBBLE_PADDING_HORIZONTAL,
    paddingVertical: BUBBLE_PADDING_VERTICAL,
  },
  bubbleText: {
    fontSize: BUBBLE_TEXT_FONT_SIZE,
    lineHeight: BUBBLE_TEXT_LINE_HEIGHT,
  },
  time: {
    paddingHorizontal: space[1],
  },
});
