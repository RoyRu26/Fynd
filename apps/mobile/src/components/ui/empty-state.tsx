import { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import {
  getEmptyStateAccessibilityLiveRegion,
  getEmptyStateIconColor,
  type EmptyStateVariant,
} from '@/components/ui/empty-state-state';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';

export type { EmptyStateVariant };

export type EmptyStateProps = {
  variant?: EmptyStateVariant;
  icon: IconName;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
};

// Centered-column layout: alignItems center, gap space[3], paddingVertical
// space[10] — the exact pattern already duplicated across (tabs)/index.tsx,
// sell/index.tsx, and seller/[id].tsx's own `centered` style, reused here
// rather than reinvented.
export function EmptyState({ variant = 'empty', icon, title, body, actionLabel, onAction }: EmptyStateProps) {
  const { colors } = useAppTheme();
  const isError = variant === 'error';
  const iconColor = colors[getEmptyStateIconColor(variant)];
  const liveRegion = getEmptyStateAccessibilityLiveRegion(variant);

  // accessibilityLiveRegion only announces on Android. This is the iOS
  // equivalent for the error variant — fires once on mount, not on every
  // re-render, and intentionally excludes `title` from the deps so a later
  // title change alone doesn't re-announce.
  useEffect(() => {
    if (isError) {
      AccessibilityInfo.announceForAccessibility(title);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isError]);

  return (
    <View
      style={styles.container}
      accessibilityLiveRegion={liveRegion}
      accessibilityRole={isError ? 'alert' : undefined}>
      <Icon name={icon} size="xl" color={iconColor} />
      <Text variant="heading" style={styles.centeredText}>
        {title}
      </Text>
      {body ? (
        <Text variant="body" color="textSecondary" style={styles.centeredText}>
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button variant="secondary" size="md" onPress={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[10],
  },
  centeredText: {
    textAlign: 'center',
  },
});
