import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
const app = read("src/app/main.jsx");
const boot = read("src/app/boot.js");
const css = read("src/styles/main.css");
const html = read("index.html");
const tailwind = read("tailwind.config.cjs");
const astryxThemes = read("src/astryx-themes.js");
const bridge = read("themes/shared/legacyBridge.ts");
const collectionRoutes = read("server/routes/collections.js");
const packageJson = JSON.parse(read("package.json"));

// The five palette themes (themes/<slug>/), each valid in light and dark.
const palettes = ["cluster", "marea", "musgo", "buganvilla", "grafito"];

const checks = [
  // Design system: Astryx themes, components and tokens.
  ["Astryx core installed", Boolean(packageJson.dependencies?.["@astryxdesign/core"])],
  ["Astryx styles imported", app.includes('import "@astryxdesign/core/reset.css"') && app.includes('import "@astryxdesign/core/astryx.css"')],
  ["cascade layers declared", html.includes("@layer reset, tw-preflight, legacy-base, astryx-base, astryx-theme;")],
  ["root Theme wraps the app", app.includes("<Theme") && app.includes("themes[themePalette]")],
  ["five palette themes registered", palettes.every((slug) => astryxThemes.includes(`./themes/${slug}/${slug}.js`) && exists(`themes/${slug}/${slug}.theme.ts`))],
  ["Trama is the default palette", astryxThemes.includes('defaultThemeSlug = "cluster"')],
  ["every palette carries the legacy bridge", palettes.every((slug) => read(`themes/${slug}/${slug}.theme.ts`).includes("legacyBridge(palette)"))],
  ["five user palettes in the profile", palettes.every((slug) => app.includes(`id: "${slug}"`))],
  ["palette preference starts before render", html.includes("/src/app/boot.js") && boot.includes("cluster_palette") && boot.includes("dataset.astryxTheme")],
  ["old palette preferences migrate", boot.includes("clay: 'marea'") && app.includes('clay: "marea"')],
  ["profile preference is persisted", collectionRoutes.includes("'themePalette'") && collectionRoutes.includes("'themeMode'")],
  ["semantic surfaces alias Astryx tokens", bridge.includes("'--surface-raised'") && bridge.includes("'--border-strong'") && bridge.includes("'--primary-soft'")],
  ["semantic status colors alias Astryx tokens", ["red", "blue", "green", "yellow"].every((hue) => bridge.includes(`--status-${hue}-bg`))],
  ["Tailwind uses semantic color families", tailwind.includes("slate: neutral") && tailwind.includes("purple: accent") && tailwind.includes("blue: info") && tailwind.includes("red: danger") && tailwind.includes("--cl-")],
  ["type comes from the theme", tailwind.includes("var(--font-family-body)") && css.includes("var(--font-family-body)") && !/Newsreader|SF Mono|Geist Mono|Consolas/.test(css) && !html.includes("fonts.googleapis")],
  ["AppShell and SideNav frame", app.includes("<AppShell") && app.includes("<SideNav") && app.includes("<SideNavItem")],
  ["shared primitives use Astryx", ["<AstryxButton", "<SegmentedControl", "<AstryxEmptyState", "<TextInput", "<AlertDialog", "<Skeleton", "<Breadcrumbs", "useToast()"].every((token) => app.includes(token))],
  ["dashboard shares site palette", css.includes("--pd-accent: var(--primary)") && css.includes("--pd-raised: var(--surface-raised)") && css.includes("--pd-result: var(--accent)")],
  ["chat shares site palette", css.includes("--chat-accent: var(--primary)") && css.includes("--chat-canvas: var(--canvas)")],
  ["no legacy arbitrary UI colors", !/(?:bg|text|border|ring|fill|stroke)-\[#(?:[0-9a-f]{3}){1,2}\]/i.test(app)],
  ["flat surfaces", css.includes(".surface") && css.includes("box-shadow: none")],
  ["motion tokens", css.includes("--duration-fast: 250ms") && css.includes("--ease-smooth-out: cubic-bezier(0.22, 1, 0.36, 1)")],
  ["overlays use Astryx Dialog and Drawer", app.includes("<Dialog") && app.includes("<Drawer") && !app.includes("modal-scrim") && !app.includes("useDialogA11y")],
  ["view actions use Astryx buttons", !/<button\b/.test(app)],
  ["theme switch repaints in one step", app.includes('classList.add("theme-switching")') && css.includes(".theme-switching *")],
  ["company mark asset", exists("src/app/assets/cluster-mark.png") && css.includes("cluster-mark.png") && app.includes("agency-mark")],
  ["Phosphor icons", app.includes("@phosphor-icons/react") && Boolean(packageJson.dependencies?.["@phosphor-icons/react"])],
  ["no gradient source styles", !/\b(?:linear|radial)-gradient\b|\bbg-gradient-/i.test(`${app}\n${css}`)],
  ["no Lucide dependency", !`${app}\n${html}`.includes("lucide-react")],

  // Navigation and views.
  ["consolidated team navigation", /label[=:]\s*"Equipo"/.test(app)],
  ["consolidated calendar navigation", /label[=:]\s*"Calendario"/.test(app)],
  ["phone tab bar keeps five shortcuts", app.includes('aria-label="Accesos rápidos"') && app.includes(".slice(0, 5)")],
  ["personal KPI rail", app.includes("KPI personales") && app.includes("Cumplimiento") && app.includes("Vencidas")],
  ["personal dashboard task scope", app.includes("personalTasks") && app.includes("isTaskAssignedToProfile") && app.includes("monthlyPersonalTasks")],
  ["dashboard period is visible", app.includes("dashboardPeriod.label") && app.includes("Progreso personal")],
  ["dashboard charts use comparison bars", !app.includes("buildRingSegments") && app.includes("pd-week-total") && app.includes("pd-week-completed")],
  ["dashboard shows KPI by user", app.includes("KPI por usuario") && app.includes("visibleUserKpis") && app.includes("pd-user-kpi-row") && app.includes('onNavigate("performance")')],
  ["weekly chart exposes real values", app.includes("weeklySummary.rate") && app.includes("pd-week-value") && app.includes("completadas de")],
  ["personal tasks open details", app.includes("onOpenTask(task, task._taskType)") && app.includes('_taskType: "managementTask"')],
  ["weekly performance is company-wide", app.includes("buildCompanyTaskList") && app.includes("const dayTasks = companyTasks.filter") && app.includes("Rendimiento semanal de la empresa")],
  ["individual KPI is explicit", app.includes("<p>KPI individual</p>") && app.includes("const individualKpi") && app.includes("onTimePercent")],
  ["profile performance dashboard", app.includes("profile-dashboard") && app.includes('aria-label="Rendimiento personal"') && app.includes("buildPersonalTaskList")],
  ["focused team performance", app.includes("performance-dashboard") && app.includes("Rendimiento del equipo") && app.includes("performance-person-row") && css.includes(".performance-overview")],
  ["performance removes duplicate controls", !app.includes("selectedPersonKey") && !app.includes('setViewMode("simplified")') && app.includes('label="Filtrar por función"')],
  ["profile appearance studio", app.includes("<SelectableCard") && app.includes("Guardar perfil y preferencias") && css.includes(".profile-theme-studio")],
  ["task rooms stay viewport sized", css.includes("height: calc(100vh - 7rem)") && app.includes("task-room min-h-0")],
  ["kanban columns scroll independently", app.includes("overflow-y-auto overscroll-contain") && app.includes("lg:h-full lg:min-h-0")],
  ["task cards are keyboard accessible", app.includes('aria-label={`Abrir tarea ${title}`}') && app.includes('event.key === "Enter"')],
  ["task detail scrolls continuously on mobile", app.includes("task-detail-body custom-scroll") && css.includes("touch-action: pan-y") && app.includes("lg:overflow-hidden")],
  ["task cards expose status selector", app.includes("statusControl = null") && app.includes('aria-label={`Cambiar estado de ${title}`}') && app.includes('className="mb-2.5 block"')],
  ["task rooms default to current month", app.includes("Este mes") && app.includes("isDateWithinPeriod(task.date, currentMonthPeriod)")],
  ["history is explicit", app.includes('value="history"') && app.includes("Histórico completo")],

  // Login.
  ["animated vector login", app.includes("LoginVectorArtwork") && app.includes("login-vector-orbit") && css.includes("@keyframes loginNodeFloat")],
  ["login respects reduced motion", css.includes("prefers-reduced-motion") && css.includes("animation-duration: 0.01ms")],
  ["login prioritizes form on mobile", /login-form-panel[^"]*\border-1\b/.test(app) && /login-art-panel[^"]*\border-2\b/.test(app)],
  ["theme choice survives reloads", app.includes('localStorage.setItem("cluster_theme", isDark ? "dark" : "light")') && boot.includes("2026-07-performance-focus")],

  // Team directory.
  ["team directory includes role users", app.includes("const managerTeam = buildTeamDirectory(") && app.includes("const editorTeam = buildTeamDirectory(") && app.includes("team={managerTeam}") && app.includes("team={editorTeam}") && !/team=\{(?:managers|editors)\}/.test(app)],
  ["user-only members are read-only in the directory", app.includes("{!person.isOrganizationMember && (")],
  ["adding a team member creates the login", app.includes("const ensureTeamMemberAccount = async") && app.includes('ensureTeamMemberAccount(fd, "manager")') && app.includes('ensureTeamMemberAccount(fd, "editor")')],
];

const failed = checks.filter(([, passed]) => !passed);
for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
}

if (failed.length) process.exit(1);
