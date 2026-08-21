import { ConfigContext, ExpoConfig } from 'expo/config';

// app.json stays the base layer. This file overrides only what varies per app
// variant, so `development`, `preview`, and `production` builds install side by
// side. The variant comes from APP_VARIANT, stored in the EAS environments and
// pulled locally into .env.local by `eas env:pull`.
// `com.schroedernathan.clarity` is permanently unregistrable on this Apple team
// (reserved by a deleted ASC record / foreign team) — hence the `app` suffix.
const BUNDLE_ID = 'com.schroedernathan.clarityapp';

function getBundleId() {
  switch (process.env.APP_VARIANT) {
    case 'production':
      return BUNDLE_ID;
    case 'preview':
      return `${BUNDLE_ID}.preview`;
    default:
      return `${BUNDLE_ID}.dev`;
  }
}

function getName(base: string) {
  switch (process.env.APP_VARIANT) {
    case 'production':
      return base;
    case 'preview':
      return `${base} (Preview)`;
    default:
      return `${base} (Dev)`;
  }
}

function getScheme(base: string) {
  switch (process.env.APP_VARIANT) {
    case 'production':
      return base;
    case 'preview':
      return `${base}.preview`;
    default:
      return `${base}.dev`;
  }
}

// Icon Composer bundles, not flat images. Production returns undefined so the
// app.json icon flows through untouched.
function getIosIcon() {
  switch (process.env.APP_VARIANT) {
    case 'production':
      return undefined;
    case 'preview':
      return './assets/app.preview.icon';
    default:
      return './assets/app.dev.icon';
  }
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const iosIcon = getIosIcon();
  const baseScheme = typeof config.scheme === 'string' ? config.scheme : 'clarity';

  return {
    ...config,
    slug: config.slug ?? 'clarity',
    name: getName(config.name ?? 'Clarity'),
    scheme: getScheme(baseScheme),
    runtimeVersion: {
      policy: 'appVersion',
    },
    updates: {
      ...config.updates,
      url: 'https://u.expo.dev/654f9e52-e892-44e4-a4b8-9aa700fef15b',
    },
    ios: {
      ...config.ios,
      bundleIdentifier: getBundleId(),
      icon: iosIcon ?? config.ios?.icon,
    },
    android: {
      ...config.android,
      package: getBundleId(),
    },
    plugins: [
      ...(config.plugins ?? []),
      ['expo-dev-client', { addGeneratedScheme: process.env.APP_VARIANT === 'development' }],
    ],
  };
};
