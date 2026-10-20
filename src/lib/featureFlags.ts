/**
 * New UI features stay OFF until explicitly enabled here.
 * Prevents half-shipped chrome (green stages, empty modals) from appearing in prod.
 */
export const FEATURES = {
  /** Watermelon-style edit profile modal on Settings */
  editProfileModal: true,
  /** Post-welcome feature tour */
  welcomeFeatureTour: true,
  /** Top-bar notification popover */
  topbarNotifications: true,
  /** SwitchMode sun/moon in user menu */
  themeSwitchMode: true,
} as const;

export type FeatureFlag = keyof typeof FEATURES;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FEATURES[flag] === true;
}
