import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Icon, PillButton, TextField, type IconName } from '@/components/ui';
import { isValidMessageBody } from '@/features/conversation/conversation';
import { border, minTouchTarget, radius, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';

/**
 * The thread's sticky composer (SCREENS.md Task 8 / the 5a handoff,
 * replacing Task 6's 2d-spec styling): a pill `TextField` (DESIGN.md §7's
 * carve-out — `shape="pill"`, unchanged from Explore's own search field)
 * plus a circular `buttonPrimary` send button, optionally preceded by a quick-reply
 * row for a brand-new thread.
 *
 * No camera/photo button: the handoff marks it "NEW — hide if image
 * messages aren't supported," and they aren't — `messages` has no
 * attachment/image column at all (`20260929090000_chat_conversations_and_
 * messages.sql`). Hidden outright rather than shown disabled, per the
 * handoff's own instruction.
 *
 * TODO(SCREENS.md Task 8 "Needs backend" — skipped): the 44px outline
 * camera/photo button. Add it back once image messages have a real
 * column/table/storage bucket behind them.
 *
 * No blur: the handoff's "bg 94% + blur" backdrop would need `expo-blur`
 * (not a dependency anywhere in this app) and a hex-with-alpha utility
 * (none exists either, and DESIGN.md §15 rule 1 bars a raw hex/rgba literal
 * in a screen regardless). A solid `bg` fill is the documented
 * simplification — visually close, adds neither.
 */

// Verified against sf-symbols-typescript's dist/index.d.ts ('arrow.up') and
// expo-symbols' android/symbols.json ('arrow_upward'), same discipline as
// every other IconName constant in this codebase. A plain arrow, not a
// pre-circled glyph like 'arrow.up.circle.fill' — the circle would clash
// with the button's own circular backdrop below.
const SEND_ICON: IconName = { ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' };

/**
 * NEW (SCREENS.md Task 8) — a static list, not derived from anything: the
 * handoff names exactly these three. Shown only on a brand-new thread
 * (`messageCount < 3`); tapping one fills the input, it never sends on its
 * own.
 */
const QUICK_REPLIES = ['Is it still available?', 'Can you send measurements?', 'Can we meet?'] as const;
const QUICK_REPLY_THRESHOLD = 3;

const SEND_BUTTON_SIZE = minTouchTarget;
/** Bespoke, not `border.thick` (2) — the handoff's own hard-shadow offset, same precedent `PinnedListingStrip`'s own `CARD_SHADOW_OFFSET` follows. */
const SEND_SHADOW_OFFSET = 2;
const DISABLED_OPACITY = 0.4;

export type ComposerProps = {
  onSend: (body: string) => void;
  isSending?: boolean;
  /** The thread's current message count — drives whether the quick-reply row shows at all. */
  messageCount: number;
};

const MAX_BODY_LENGTH = 2000;

export function Composer({ onSend, isSending = false, messageCount }: ComposerProps) {
  const { colors } = useAppTheme();
  const [body, setBody] = useState('');

  const canSend = isValidMessageBody(body) && !isSending;
  const showQuickReplies = messageCount < QUICK_REPLY_THRESHOLD;

  function handleSend() {
    if (!canSend) {
      return;
    }
    onSend(body.trim());
    setBody('');
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, borderTopColor: colors.border }]}>
      {showQuickReplies ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickReplies}
          keyboardShouldPersistTaps="handled">
          {QUICK_REPLIES.map((reply) => (
            <PillButton key={reply} variant="outline" onPress={() => setBody(reply)}>
              {reply}
            </PillButton>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.row}>
        <TextField
          value={body}
          onChangeText={setBody}
          placeholder="Message…"
          shape="pill"
          multiline
          maxLength={MAX_BODY_LENGTH}
          containerStyle={styles.field}
          accessibilityLabel="Message"
        />
        {isSending ? (
          <View
            style={[styles.sendButton, { backgroundColor: colors.buttonPrimary }]}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: true, busy: true }}>
            <ActivityIndicator size="small" color={colors.onButtonPrimary} />
          </View>
        ) : (
          <View style={styles.sendButtonWrap}>
            {/* The hard shadow: a real offset backing View, not a platform
                shadow — same technique PinnedListingStrip already uses. */}
            <View
              style={[styles.sendButtonShadow, { backgroundColor: colors.text }]}
              pointerEvents="none"
            />
            <Pressable
              onPress={handleSend}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              accessibilityState={{ disabled: !canSend }}
              style={({ pressed }) => [
                styles.sendButton,
                {
                  backgroundColor: colors.buttonPrimary,
                  opacity: !canSend ? DISABLED_OPACITY : pressed ? 0.8 : 1,
                },
              ]}>
              <Icon name={SEND_ICON} size="md" color={colors.onButtonPrimary} />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space[2],
    paddingTop: space[2],
    borderTopWidth: border.hairline,
  },
  quickReplies: {
    flexDirection: 'row',
    gap: space[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space[2],
  },
  field: {
    flex: 1,
  },
  sendButtonWrap: {
    width: SEND_BUTTON_SIZE,
    height: SEND_BUTTON_SIZE,
  },
  sendButtonShadow: {
    position: 'absolute',
    top: SEND_SHADOW_OFFSET,
    left: 0,
    right: 0,
    bottom: -SEND_SHADOW_OFFSET,
    borderRadius: radius.full,
  },
  sendButton: {
    width: SEND_BUTTON_SIZE,
    height: SEND_BUTTON_SIZE,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
