import { NativeTabs } from 'expo-router/native-tabs';

import { getColors } from '@/design/theme';

// Bar background stays pinned dark (see git history for the rationale).
//
// Labels and icons are coloured by the native tint only, with no
// `labelStyle`/`iconColor`. Those two become per-item title text attributes
// in the bar's UITabBarAppearance, and on iOS 26's glass tab bar that made
// unselected labels lay out too narrow ("Expl…", "Prof…") until a tap
// re-laid them out, and left the selected label near-black on the dark glass.
// With the tint alone, UIKit sizes and colours the labels itself: selected
// item in accent, the rest in the system's adaptive secondary colour.
const colors = getColors('dark');

// Icon system (DESIGN.md §4): every tab uses an SF Symbol / Material Symbol
// pair so all five render at the same native tab-icon size and weight.
// Outline when idle, filled when selected. The only custom asset is the Fynd
// mark on Home, shipped at 25pt @1x/@2x/@3x so it matches symbol size.
// All names verified to exist in sf-symbols-typescript and expo-symbols'
// android/symbols.json.
export default function AppTabs() {
  return (
    <NativeTabs
      backgroundColor={colors.bg}
      indicatorColor={colors.bgElevated}
      tintColor={colors.accent}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/fynd-mark.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="explore">
        <NativeTabs.Trigger.Label>Explore</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="sell">
        <NativeTabs.Trigger.Label>Sell</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'plus.square', selected: 'plus.square.fill' }} md="add_box" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="inbox">
        <NativeTabs.Trigger.Label>Inbox</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left', selected: 'bubble.left.fill' }} md="chat_bubble" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }}
          md="account_circle"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
