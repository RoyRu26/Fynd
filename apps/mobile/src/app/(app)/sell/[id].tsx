import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { IconButton, Screen, Text, type IconName } from '@/components/ui';
import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { useAuth } from '@/features/auth/auth-provider';
import { mapListingError } from '@/features/listings/errors';
import { useListing } from '@/features/listings/queries';

// Verified against the installed packages: 'chevron.left' exists in
// sf-symbols-typescript's types, and 'arrow_back' exists in expo-symbols'
// android/symbols.json.
const BACK_ICON: IconName = { ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' };

export default function SellEditor() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const listingQuery = useListing(id);
  const listing = listingQuery.data;

  // The listings SELECT policy makes active listings publicly visible, so a
  // row CAN resolve here without belonging to the caller (another seller's
  // active listing). This check is what stands between that and presenting
  // editable UI for it — the query resolving successfully is not enough.
  // A draft belonging to someone else is already invisible to this query
  // (RLS hides it entirely), so this same branch also covers "not found".
  const isOwner = listing !== undefined && listing.seller_id === session?.user.id;

  let body: ReactNode;
  if (listingQuery.isPending) {
    body = (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.textTertiary} />
      </View>
    );
  } else if (listingQuery.isError) {
    body = (
      <View style={styles.centered}>
        <Text variant="body" color="danger">
          {mapListingError(listingQuery.error).message}
        </Text>
      </View>
    );
  } else if (!isOwner || !listing) {
    body = (
      <View style={styles.centered}>
        <Text variant="body" color="danger">
          This listing isn&apos;t available to edit.
        </Text>
      </View>
    );
  } else {
    body = (
      <View style={styles.body}>
        <Text variant="title">{listing.title ?? 'Untitled draft'}</Text>
        <Text variant="body" color="textSecondary">
          Photo and detail editing are coming in a later step. This draft is saved, and can be
          deleted from Your listings.
        </Text>
      </View>
    );
  }

  return (
    <Screen contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <IconButton icon={BACK_ICON} accessibilityLabel="Back" onPress={() => router.back()} />
      </View>
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: space[6],
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
  body: {
    gap: space[3],
  },
});
