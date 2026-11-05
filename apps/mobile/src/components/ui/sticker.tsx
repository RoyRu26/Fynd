import { StyleSheet, View } from 'react-native';

import {
  getStickerColors,
  getStickerLetterSpacing,
  STICKER_FONT_SIZE,
  STICKER_SHADOW_OFFSET,
  type StickerTone,
} from '@/components/ui/sticker-state';
import { Text } from '@/components/ui/text';
import { fontFamily, radius, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';

export type { StickerTone };

export type StickerProps = {
  label: string;
  tone?: StickerTone;
  /** Rotation in degrees. The whole point of the component — a sticker sits askew. */
  rotate?: number;
  /** Overrides the accessible name; falls back to `label`. */
  accessibilityLabel?: string;
};

/**
 * A small rotated label stuck onto media — "just dropped", a vibe tag
 * (DESIGN.md §13; §14.2 still describes the previous Explore and is rewritten
 * when that screen is rebuilt).
 *
 * The drop shadow is a real offset View behind the sticker, not a platform
 * shadow. A HARD shadow is the look, and the platform APIs cannot give one on
 * both: iOS could manage it with `shadowRadius: 0`, but Android's `elevation`
 * is always blurred and offers no offset control at all. One backing view
 * renders identically everywhere and costs a single extra node.
 */
export function Sticker({ label, tone = 'accent', rotate = 0, accessibilityLabel }: StickerProps) {
  const { colors } = useAppTheme();
  const { background, label: labelColor } = getStickerColors(tone);

  const letterSpacing = getStickerLetterSpacing(STICKER_FONT_SIZE);

  return (
    <View style={[styles.container, { transform: [{ rotate: `${rotate}deg` }] }]}>
      {/*
        Purely decorative: it duplicates the sticker's silhouette in the text
        colour and must never be announced or hit-tested.
      */}
      <View
        style={[styles.shadow, { backgroundColor: colors.text }]}
        pointerEvents="none"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      />
      <View style={[styles.plate, { backgroundColor: colors[background] }]}>
        {/*
          The face, size and weight are set HERE, not carried by a variant.
          `micro` resolves to the system face (textVariantFace.micro ===
          'system'), so relying on the variant alone would silently render
          this in SF Pro / Roboto. `style` lands last in Text's style array,
          so these win.

          The handoff asks for Archivo 800; only the 900 Black cut is bundled
          (see use-app-fonts.ts), and a second ~200KB face for one 11px label
          is not a trade worth making — the difference is not legible at this
          size. `fontWeight: '900'` matches the one registered face rather
          than asking Android for a weight it does not declare.
        */}
        <Text
          variant="micro"
          color={labelColor}
          numberOfLines={1}
          accessibilityLabel={accessibilityLabel}
          style={[
            styles.label,
            {
              fontFamily: fontFamily.displayExpanded,
              fontSize: STICKER_FONT_SIZE,
              fontWeight: '900',
              letterSpacing,
            },
          ]}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
  },
  plate: {
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    borderRadius: radius.xs,
  },
  shadow: {
    // Plate-sized and shifted straight down: pinning left/right to 0 while
    // offsetting top and bottom by the same amount keeps the height identical
    // to the plate rather than stretching it.
    position: 'absolute',
    left: 0,
    right: 0,
    top: STICKER_SHADOW_OFFSET,
    bottom: -STICKER_SHADOW_OFFSET,
    borderRadius: radius.xs,
  },
  label: {
    textTransform: 'uppercase',
  },
});
