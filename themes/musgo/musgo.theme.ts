// The musgo theme. `astryx experimental theme editor` wrote this file once and never changes it again.
// The checked settings live in musgo.settings.json and the generated musgo.settings.ts;
// change them with `astryx experimental theme editor set musgo ...`. Add your own changes below: they win over the settings.
import {defineTheme} from '@astryxdesign/core/theme';
import {musgoSettings} from './musgo.settings';
import {palette} from './tokens/musgo.palette';
import {legacyBridge} from '../shared/legacyBridge';

export const musgoTheme = defineTheme({
  extends: musgoSettings,
  name: 'musgo',
  // Tailwind families and the old main.css names follow this palette (see ../shared/legacyBridge.ts).
  localTokens: legacyBridge(palette),
});
