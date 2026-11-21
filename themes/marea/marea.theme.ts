// The marea theme. `astryx experimental theme editor` wrote this file once and never changes it again.
// The checked settings live in marea.settings.json and the generated marea.settings.ts;
// change them with `astryx experimental theme editor set marea ...`. Add your own changes below: they win over the settings.
import {defineTheme} from '@astryxdesign/core/theme';
import {mareaSettings} from './marea.settings';
import {palette} from './tokens/marea.palette';
import {legacyBridge} from '../shared/legacyBridge';

export const mareaTheme = defineTheme({
  extends: mareaSettings,
  name: 'marea',
  // Tailwind families and the old main.css names follow this palette (see ../shared/legacyBridge.ts).
  localTokens: legacyBridge(palette),
});
