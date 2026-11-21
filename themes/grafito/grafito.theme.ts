// The grafito theme. `astryx experimental theme editor` wrote this file once and never changes it again.
// The checked settings live in grafito.settings.json and the generated grafito.settings.ts;
// change them with `astryx experimental theme editor set grafito ...`. Add your own changes below: they win over the settings.
import {defineTheme} from '@astryxdesign/core/theme';
import {grafitoSettings} from './grafito.settings';
import {palette} from './tokens/grafito.palette';
import {legacyBridge} from '../shared/legacyBridge';

export const grafitoTheme = defineTheme({
  extends: grafitoSettings,
  name: 'grafito',
  // Tailwind families and the old main.css names follow this palette (see ../shared/legacyBridge.ts).
  localTokens: legacyBridge(palette),
});
