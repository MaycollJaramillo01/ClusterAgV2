// The buganvilla theme. `astryx experimental theme editor` wrote this file once and never changes it again.
// The checked settings live in buganvilla.settings.json and the generated buganvilla.settings.ts;
// change them with `astryx experimental theme editor set buganvilla ...`. Add your own changes below: they win over the settings.
import {defineTheme} from '@astryxdesign/core/theme';
import {buganvillaSettings} from './buganvilla.settings';
import {palette} from './tokens/buganvilla.palette';
import {legacyBridge} from '../shared/legacyBridge';

export const buganvillaTheme = defineTheme({
  extends: buganvillaSettings,
  name: 'buganvilla',
  // Tailwind families and the old main.css names follow this palette (see ../shared/legacyBridge.ts).
  localTokens: legacyBridge(palette),
});
