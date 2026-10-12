import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { getColors } from '@/design/theme';

// The tab bar is pinned to the dark appearance app-wide, independent of the
// system scheme and independent of any individual screen's own theme —
// Sell and Profile still render their own content following the system
// scheme; only Home additionally forces its own content dark on top (via
// AppThemeProvider). This keeps the chrome around Home's always-dark
// full-viewport photography from ever showing a light bar underneath it.
//
// A plain module-scope constant, not a hook: `getColors('dark')` never
// changes at runtime, so there is nothing to react to. DESIGN.md §14.1's
// "single gradient serving both the overlay and the bottom bar" stays
// deferred to the custom bottom bar (§16); this is the smallest change that
// stops the bar from clashing with Home in the meantime.
const colors = getColors('dark');

// Measured on device: the native bar's actual rendered material stays light
// regardless of the `backgroundColor`/`indicatorColor` pin above — those
// tint the bar but do not flip its underlying (light) text-legibility
// material. `colors.text` (near-white, meant for a dark surface) is nearly
// invisible there, which is the exact "selected Sell label is nearly
// invisible" symptom. The selected label needs a color chosen for that
// actual light material, so it borrows the light scheme's own `text`
// (near-black) rather than extending the dark-bar assumption further.
const selectedLabelColor = getColors('light').text;

export default function AppTabs() {
  return (
    <NativeTabs
      backgroundColor={colors.bg}
      indicatorColor={colors.bgElevated}
      // Unselected stays on the dark-scheme pin (unaffected — it already read
      // fine on the actual bar); only the selected label needed the
      // light-scheme color above.
      labelStyle={{ default: { color: colors.textSecondary }, selected: { color: selectedLabelColor } }}
      iconColor={{ default: colors.textSecondary, selected: colors.accent }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      {/* Temporary icon: reuses the home PNG rather than sourcing new art,
          per the approved plan (DESIGN.md §4/§12.7's custom bottom bar with
          a gradient center action is a later phase). */}
      <NativeTabs.Trigger name="sell">
        <NativeTabs.Trigger.Label>Sell</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      {/* Verified against the installed packages, not guessed:
          'bubble.left.and.bubble.right' exists in sf-symbols-typescript's
          dist/index.d.ts, and 'chat_bubble_outline' exists in expo-symbols'
          android/symbols.json. A real icon pair, unlike the two PNG
          placeholders above. */}
      <NativeTabs.Trigger name="inbox">
        <NativeTabs.Trigger.Label>Inbox</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="bubble.left.and.bubble.right" md="chat_bubble_outline" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/explore.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
