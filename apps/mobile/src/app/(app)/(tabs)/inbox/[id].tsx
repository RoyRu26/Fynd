import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Avatar, Button, IconButton, Screen, Text, type IconName } from '@/components/ui';
import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { mapInboxError } from '@/features/inbox/errors';
import { resolveOtherPartyName } from '@/features/inbox/inbox';
import { useConversationDetail, useMarkConversationRead } from '@/features/inbox/queries';

/**
 * Conversation thread — deliberate minimal stub. Shows who the thread is
 * with and which listing it's about, marks it read on open, and stops
 * there. ROADMAP 1.3 replaces the body below with the actual message list
 * and composer; nothing here should be mistaken for that.
 */

const BACK_ICON: IconName = { ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' };

export default function ConversationScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { id, lastMessageAt } = useLocalSearchParams<{ id: string; lastMessageAt?: string }>();

  const detailQuery = useConversationDetail(id);

  const markRead = useMarkConversationRead();

  // Fires once per conversation id — marks read as far as the inbox row the
  // user actually tapped from (lastMessageAt), falling back to the server's
  // own now()-clamped default when navigated to without that param.
  useEffect(() => {
    markRead.mutate({ conversationId: id, upTo: lastMessageAt });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const backRow = (
    <View style={styles.header}>
      <IconButton icon={BACK_ICON} accessibilityLabel="Back" onPress={() => router.back()} />
    </View>
  );

  let body: ReactNode;
  if (detailQuery.isPending) {
    body = (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.textTertiary} />
      </View>
    );
  } else if (detailQuery.isError) {
    body = (
      <View style={styles.centered}>
        <Text variant="body" color="danger">
          {mapInboxError(detailQuery.error).message}
        </Text>
        <Button variant="secondary" size="sm" onPress={() => detailQuery.refetch()}>
          Try again
        </Button>
      </View>
    );
  } else if (detailQuery.data === null) {
    // Defensive fallback only: under the current RPC contract,
    // conversation_detail never actually returns an empty result set for
    // "no such conversation"/"not yours" — it raises P0002 instead, which
    // surfaces through the isError branch above with mapInboxError's
    // message. This branch exists in case a future RPC change starts
    // returning zero rows instead of throwing; it is not the real
    // not-found UX today.
    body = (
      <View style={styles.centered}>
        <Text variant="body" color="textSecondary" style={styles.centeredText}>
          This conversation isn&apos;t available.
        </Text>
        <Button variant="secondary" size="sm" onPress={() => router.back()}>
          Go back
        </Button>
      </View>
    );
  } else {
    const header = detailQuery.data;
    const name = resolveOtherPartyName(header);

    body = (
      <View style={styles.body}>
        <View style={styles.identity}>
          {/* source is always omitted: otherAvatarPath has no bucket to
              resolve against yet — same precedent as seller/[id].tsx and
              listing/[id].tsx. */}
          <Avatar size="md" name={name} />
          <View>
            <Text variant="bodyStrong">{name}</Text>
            {header.listingTitle ? (
              <Text variant="caption" color="textSecondary">
                {header.listingTitle}
              </Text>
            ) : null}
          </View>
        </View>

        <Text variant="body" color="textSecondary">
          Messages coming soon.
        </Text>
      </View>
    );
  }

  return (
    <Screen contentContainerStyle={styles.content}>
      {backRow}
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: space[5],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    paddingHorizontal: space[6],
  },
  centeredText: {
    textAlign: 'center',
  },
  body: {
    gap: space[5],
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
});
