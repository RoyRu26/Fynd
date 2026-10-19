import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  clampSheetDragTranslation,
  shouldDismissSheetOnRelease,
} from '@/components/ui/sheet-state';
import { Text } from '@/components/ui/text';
import { border, duration, radius, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';

export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  /** Falls back to `title` when omitted. */
  accessibilityLabel?: string;
};

// 36×4 literal drag-handle size — a decorative affordance local to this one
// component, not a scale value (per the second-caller rule, no shared token
// exists for it and none should be invented for a single consumer).
const HANDLE_SIZE = { width: 36, height: 4 };

/**
 * Single content-sized detent only (DESIGN.md §13) — multiple detents are
 * out of scope per the second-caller rule; every known use case so far is a
 * short row list.
 *
 * DESIGN.md §16 item 4 marks the `overlay` elevation level [OPEN] — no
 * shadow is invented for it here. Depth instead comes from the scrim, the
 * bgElevated-vs-bg contrast, and a hairline top border.
 */
export function Sheet({ visible, onClose, children, title, accessibilityLabel }: SheetProps) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const windowHeight = useWindowDimensions().height;

  // Two-phase close: `onClose` fires immediately (backdrop tap / drag
  // dismiss / Android back), but the Modal itself only unmounts once the
  // exit animation's completion callback flips this back to false — kept
  // separate from the `visible` prop, which the parent may flip instantly.
  const [modalVisible, setModalVisible] = useState(visible);
  // The opening half of that sync is done here, during render (React's
  // documented "adjust state when a prop changes" pattern), not inside the
  // effect below — calling setState directly in an effect body trips
  // `react-hooks/set-state-in-effect`. The closing half stays in the
  // effect's animation-completion callback, which that rule treats as the
  // sanctioned place for it (see the comment on FeedCardGestures for the
  // same split applied to a shared-value write instead of React state).
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) setModalVisible(true);
  }

  // Base open/close offset — mutated ONLY inside the effect below, never
  // from the drag gesture. `react-hooks/immutability` forbids mutating a
  // shared value from outside an effect that also uses it, so the live
  // drag offset below is a deliberately separate shared value rather than
  // this same one — same boundary FeedCardGestures draws between an
  // effect-owned shared value and a gesture-owned one.
  const baseTranslateY = useSharedValue(windowHeight);
  // Live drag offset, layered on top of baseTranslateY — mutated ONLY from
  // the pan gesture's own callbacks below, never referenced by any effect.
  const dragTranslateY = useSharedValue(0);
  // Measured sheet height for the drag-dismiss distance ratio — mutated
  // only from onLayout (not an effect) and read only from the gesture.
  const sheetHeight = useSharedValue(0);

  useEffect(() => {
    const animDuration = reducedMotion ? 0 : duration.normal;
    if (visible) {
      baseTranslateY.value = withTiming(0, { duration: animDuration, easing: Easing.out(Easing.ease) });
    } else {
      baseTranslateY.value = withTiming(
        windowHeight,
        { duration: animDuration, easing: Easing.in(Easing.ease) },
        (finished) => {
          if (finished) runOnJS(setModalVisible)(false);
        },
      );
    }
  }, [visible, reducedMotion, baseTranslateY, windowHeight]);

  const pan = Gesture.Pan()
    .onUpdate((event) => {
      dragTranslateY.value = clampSheetDragTranslation(event.translationY);
    })
    .onEnd((event) => {
      const dismiss = shouldDismissSheetOnRelease({
        translationY: event.translationY,
        velocityY: event.velocityY,
        sheetHeight: sheetHeight.value,
      });
      if (dismiss) {
        dragTranslateY.value = 0;
        runOnJS(onClose)();
      } else {
        dragTranslateY.value = withTiming(0, {
          duration: reducedMotion ? 0 : duration.fast,
          easing: Easing.out(Easing.ease),
        });
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: baseTranslateY.value + dragTranslateY.value }],
  }));

  return (
    <Modal transparent visible={modalVisible} animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {/* RN Modal content is a separate native surface the app-root
          GestureHandlerRootView (src/app/_layout.tsx) doesn't cover — this
          nested one is RNGH's own documented fix for gestures inside a Modal. */}
      <GestureHandlerRootView style={styles.fill}>
        <View style={styles.fill}>
          <Pressable
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlayScrim }]}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            onPress={onClose}
          />
          <GestureDetector gesture={pan}>
            <Animated.View
              onLayout={(event) => {
                sheetHeight.value = event.nativeEvent.layout.height;
              }}
              accessibilityViewIsModal
              accessibilityLabel={accessibilityLabel ?? title}
              style={[
                styles.sheet,
                {
                  backgroundColor: colors.bgElevated,
                  borderTopColor: colors.border,
                  paddingBottom: insets.bottom + space[5],
                },
                animatedStyle,
              ]}>
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[styles.handle, { backgroundColor: colors.borderStrong }]}
              />
              {/* Mirrors screen.tsx's keyboardAvoiding pattern (same behavior/
                  offset convention) scoped to the title+content region only —
                  the backdrop and drag handle stay outside it. */}
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                {title ? (
                  <Text variant="heading" style={styles.title}>
                    {title}
                  </Text>
                ) : null}
                <ScrollView contentContainerStyle={styles.scrollContent}>{children}</ScrollView>
              </KeyboardAvoidingView>
            </Animated.View>
          </GestureDetector>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: border.hairline,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  handle: {
    width: HANDLE_SIZE.width,
    height: HANDLE_SIZE.height,
    borderRadius: HANDLE_SIZE.height / 2,
    alignSelf: 'center',
    marginTop: space[3],
    marginBottom: space[2],
  },
  title: {
    paddingHorizontal: space[5],
    paddingBottom: space[2],
  },
  scrollContent: {
    paddingHorizontal: space[5],
  },
});
