// The cluster theme. `astryx experimental theme editor` wrote this file once and never changes it again.
// The checked settings live in cluster.settings.json and the generated cluster.settings.ts;
// change them with `astryx experimental theme editor set cluster ...`. Add your own changes below: they win over the settings.
import {defineTheme} from '@astryxdesign/core/theme';
import {clusterSettings} from './cluster.settings';
import {palette} from './tokens/cluster.palette';
import {legacyBridge} from '../shared/legacyBridge';

export const clusterTheme = defineTheme({
  extends: clusterSettings,
  name: 'cluster',
  // Tailwind families and the old main.css names follow this palette (see ../shared/legacyBridge.ts).
  localTokens: legacyBridge(palette),
});
