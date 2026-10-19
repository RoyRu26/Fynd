import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { IconButton, TextField, type IconName } from '@/components/ui';
import { isValidMessageBody } from '@/features/conversation/conversation';
import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';

/**
 * The thread's message input. Built only from existing primitives
 * (`TextField` + `IconButton`) per Roy's placeholder decision for this
 * screen — see the new DESIGN.md §14.7 note.
 */

// Verified against sf-symbols-typescript's dist/index.d.ts ('arrow.up.circle.fill')
// and expo-symbols' android/symbols.json ('send'), same discipline as every
// other IconName constant in this codebase.
const SEND_ICON: IconName = { ios: 'arrow.up.circle.fill', android: 'send', web: 'send' };

export type ComposerProps = {
  onSend: (body: string) => void;
  isSending?: boolean;
};

const MAX_BODY_LENGTH = 2000;

export function Composer({ onSend, isSending = false }: ComposerProps) {
  const { colors } = useAppTheme();
  const [body, setBody] = useState('');

  const canSend = isValidMessageBody(body) && !isSending;

  function handleSend() {
    if (!canSend) {
      return;
    }
    onSend(body.trim());
    setBody('');
  }

  return (
    <View style={styles.row}>
      <TextField
        value={body}
        onChangeText={setBody}
        placeholder="Message"
        multiline
        maxLength={MAX_BODY_LENGTH}
        containerStyle={styles.field}
        accessibilityLabel="Message"
      />
      {isSending ? (
        <View
          style={styles.sendSlot}
          accessible
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: true, busy: true }}>
          <ActivityIndicator size="small" color={colors.textTertiary} />
        </View>
      ) : (
        <IconButton
          icon={SEND_ICON}
          accessibilityLabel="Send message"
          disabled={!canSend}
          onPress={handleSend}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space[2],
  },
  field: {
    flex: 1,
  },
  sendSlot: {
    width: space[10],
    height: space[10],
    alignItems: 'center',
    justifyContent: 'center',
  },
});
