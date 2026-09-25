import { directedTrack, raceKey, type RaceDirection } from '../track/Direction';
import { VideoClip } from './VideoClip';
import { MIN_REPLAY_SECONDS, PauseLoop } from './PauseLoop';
import { PhotoMode } from '../ui/PhotoMode';
import { raceRating } from '../track/Rating';
import { AI_PACE, aiReferenceSeconds } from '../track/aiPace';
import { GhostRecorder, type GhostData } from './Ghost';
import { GhostReplay } from '../world/GhostReplay';
import { HomeShortcut } from '../ui/HomeShortcut';
import { textCard } from '../ui/TextCard';
import { ShareDialog, copyShareText } from '../ui/ShareDialog';
import { PlayerHelp } from '../ui/PlayerHelp';
import { pauseScreen, type PauseScreen } from '../ui/PauseScreen';
import type { ResultsScreen } from '../ui/ResultsScreen';
import { creatorLinkUrl } from './Publication';
import { cleanPlayerName } from './playerName';
import { challengeUrl, decodeChallenge, encodeChallenge, type Challenge } from './Challenge';
import { ReplicaDialog } from '../ui/Replica';
import { GraphicsLossNotice } from '../ui/GraphicsLoss';
import { routeName } from '../ui/routeName';
import * as THREE from 'three';
import { compileEverything, compileEverythingNow } from '../world/compileEverything';
import { isMobileDevice } from './device';
import { GameAudio } from '../audio/Audio';
import { FINISH_ROLLOUT_DISTANCE, PARKING_FIRST_ROW_DISTANCE, Racer, racerSpawns, type ParkingState, type ResetRecord } from './Racer';
import { MOBILE_AI_RIVALS, raceRoster, type DriverRole } from './roster';
import { aiDifficulty, applyCatchUp, type AiDifficulty } from '../bot/difficulty';
import { Input } from '../input/Input';
import type { Commands } from '../input/types';
import { Car } from '../physics/Car';
import { Trailer } from '../physics/Trailer';
import { fallbackVehicle, resolveVehicle, vehicleFor, VEHICLES, vehicleTuning, type VehicleDefinition } from '../vehicles/catalogue';
import { VehicleModel } from '../vehicles/VehicleModel';
import { devHint, staleAssetsKey } from './dataHealth';
import { PhysicsWorld, initPhysics } from '../physics/PhysicsWorld';
import { Race, drivableGateCount, formatTime, gatesPassed, type RaceState } from '../track/Race';
import { loadTrack } from '../track/schema';
import { loadStreetMap, type StreetMapData } from '../ui/StreetMap';
import type { CarKind, TimeOfDay, TrackData } from '../track/types';
import { I18n, LANGUAGES, detectLanguage } from '../ui/i18n';
import { MenuList, Screens, applyAction, type MenuItem, type ScreenName } from '../ui/Ui';
import { startScreen, type StartChoice, type StartScreen } from '../ui/StartScreen';
import { parseMenuMap } from '../ui/menuMap';
import * as screens from '../ui/screens';
import { CAMERA_MODES, ChaseCamera, type CameraFeedback, type CameraMode } from '../world/ChaseCamera';
import { checkpointLabelTexture, Gates } from '../world/Gates';
import { Sparks } from '../world/Sparks';
import { SlimeLayer, type SlimeKind, type SlimeStats } from '../world/Slimes';
import type { StreamerStats } from '../world/TileStreamer';
import { World, timeOfDayFor, type Quality } from '../world/World';
import { type AutoQualitySampler, autoQualitySamplerFor, autoQualityStart, startingQuality, type QualityLimits } from '../world/quality';
import { recordKey, Save } from './Save';
import { SHOWCASE_SPIN, SHOWCASE_START_ANGLE } from './showcase';
import { LandscapeGuard } from '../ui/LandscapeGuard';
import { RenderPose } from './RenderPose';
import type { Autopilot } from '../bot/Autopilot';
import { CATALOGUE, SYNTHETIC, playable } from './tracks';
import { holdCompletedLoading } from '../ui/loadingTiming';
import { WEATHER_GRIP, type Weather, type SkyStats } from '../world/Sky';
import { standingSnapshot } from './Standings';

const QUALITIES: (Quality | 'auto')[] = ['auto', 'high', 'medium', 'low'];
const COUNTDOWN_SECONDS = 3;
const DESTROYED_SLIME_KINDS: readonly SlimeKind[] = ['popper', 'burst', 'boost'];
type ResetReason = ResetRecord['reason'];

export type Phase = 'boot' | 'menu' | 'intro' | 'countdown' | 'racing' | 'paused' | 'results' | 'settings' | 'about';
/** The menu and development callers share one player race entry. Omission keeps the saved/track default. */
export type RaceChoice = StartChoice;

/** The screen a phase is drawn on. Driving and counting down share one; pausing has its own. */
const SCREEN_FOR: Record<Phase, ScreenName> = {
  boot: 'boot', menu: 'menu', intro: 'intro', countdown: 'hud', racing: 'hud',
  paused: 'pause', results: 'results', settings: 'settings', about: 'about',
};

/* */
export interface GameReport {
  // The real unions, not `string`: a spec comparing `phase` against a value that is not a phase is
  // a 60-second silent timeout when it is a string, and a compile error when it is this.
  ghost: { visible: boolean; samples: number; storedBytes: number };
  phase: Phase;
  track: string | null;
  direction: RaceDirection;
  state: RaceState | null;
  time: number;
  score: number;
  slimeHits: number;
  progress: number;
  length: number;
  lap: number;
  laps: number;
  checkpoints: number;
  totalCheckpoints: number;
  speedKmh: number;
  input: Commands['car'] & { device: Commands['device'] };
  stuck: boolean;
  headingX: number;
  headingZ: number;
  scraping: boolean;
  posX: number;
  posZ: number;
  posY: number;
  tiles: StreamerStats | null;
  /** Materials wearing a texture. Null before a track is up; see e2e/world.ts for why it is here. */
  textures: number | null;
  /** What the player chose on the opening screen, or null when nobody picked (bot runs). */
  choice: Omit<RaceChoice, 'trackId'> | null;
  vehicle: string | null;
  trailer: { hitchGap: number; upright: number } | null;
  resets: number;
  resetLog: readonly ResetRecord[];
  airbornePct: number;
  frames: number;
  collisionFeedback: { vehicleImpacts: number; barrierImpacts: number; lightImpacts: number;
    heavyImpacts: number; cameraKicks: number; impactSounds: number; sparkBursts: number;
    activeSparks: number };
  /** The quality the renderer is actually using; unlike the saved setting this is never `auto`. */
  renderQuality: Quality | null;
  qualityLimits: Readonly<QualityLimits> | null;
  sky: SkyStats | null;
  thunderSounds: number;
  weatherSound: Weather;
  weatherGrip: number;
  tireMarks: { snow: number; skid: number; capacity: number; bytes: number; chunks: number } | null;
  vehicleLights: { configured: number; pools: number }[];
  slimes: SlimeStats | null;
  surface: string;
  players: { id: string; role: DriverRole; input: Commands['car']; autopilot: boolean; waitingForRoad: boolean; x: number; z: number; speedKmh: number; state: RaceState; time: number; checkpoints: number; score: number; resets: readonly ResetRecord[]; trafficWaiting: boolean; trafficFollowing: boolean; parking: ParkingState | null; cameraMode: CameraMode; cameraFeedback: CameraFeedback }[];
}

export interface Session {
  racers: Racer[];
  readonly humans: readonly Racer[];
  track: TrackData;
  direction: RaceDirection;
  bot: Autopilot;
  world: World;
  physics: PhysicsWorld;
  car: Car;
  race: Race;
  mesh: THREE.Group;
  model: VehicleModel;
  vehicle: VehicleDefinition;
  trailer: Trailer | null;
  trailerModel: VehicleModel | null;
  trailerPose: RenderPose | null;
  chase: ChaseCamera;
  renderPose: RenderPose;
  gates: Gates;
  sparks: Sparks;
  slimes: SlimeLayer | null;
}

/**
 * The whole game: which screen is up, which track is loaded, and the one loop that drives both.
 *
 * Only one session exists at a time and leaving a track tears it down completely, because a loaded
 * track holds tens of megabytes of geometry and physics bodies that nothing else will free.
 */
export class Game {
  readonly i18n: I18n;
  readonly save: Save;
  private readonly input = new Input();
  private ghostReplay: GhostReplay | null = null;
  private ghostRecorder: GhostRecorder | null = null;
  /** whichever device was last used, kept from the loop so no screen has to poll the input */
  private device: Commands['device'] = 'keyboard';
  private lastCar: Commands['car'] = { throttle: 0, brake: 0, steer: 0 };
  private headingX = 0;
  private headingZ = -1;
  private route: screens.MiniMapRoute | null = null;
  /** the real streets around the current route; see ui/StreetMap */
  private streets: StreetMapData | null = null;
  private readonly audio = new GameAudio();
  /**
   * Browsers only let a page make sound after the player has touched it, and the unlock used
   * to wait for a button click. The home page's first button is "hit the road", which leaves the page,
   * so the Golden Gate page never had its music. Any tap, click or key on the page now unlocks it.
   */
  private readonly onGesture = (): void => { void this.audio.unlock(); };
  /* */
  private readonly onVisibility = (): void => {
    if (document.hidden && (this.phase === 'racing' || this.phase === 'countdown')) this.show('paused');
  };
  private readonly onUiClick = (event: Event): void => {
    if (!(event.target instanceof Element) || !event.target.closest('button')
      || event.target.closest('[data-touch-control]') || this.landscape?.blocked) return;
    void this.audio.unlock().then(() => this.audio.ui('confirm'));
  };
  /** the automated driver takes over when ?bot=1 is set, so a run can be checked without a player */
  private nextAutopilot = false;
  get autopilot(): boolean { return this.session?.racers[0]?.autopilot ?? this.nextAutopilot; }
  set autopilot(enabled: boolean) {
    this.nextAutopilot = enabled;
    if (this.session) this.session.racers[0]!.autopilot = enabled;
  }

  /* */
  setAutopilot(player: number, enabled: boolean, tier?: AiDifficulty): void {
    const racer = this.session?.humans[player];
    if (!racer) return;
    racer.autopilot = enabled;
    if (tier) racer.driveAs(tier);
    racer.bot.reset();
  }
  /** every reason the car was put back, for the automated report */
  readonly telemetry = {
    resets: 0, resetLog: [] as ResetRecord[], airborneFrames: 0, frames: 0, startedAt: 0, finishedAt: 0,
    vehicleImpacts: 0, barrierImpacts: 0, lightImpacts: 0, heavyImpacts: 0,
  };
  private readonly screens: Screens;
  private readonly landscape: LandscapeGuard;
  private start!: StartScreen;
  private pause!: PauseScreen;
  private results!: ResultsScreen;
  private readonly replicaDialog: ReplicaDialog;
  private readonly graphicsLoss: GraphicsLossNotice;
  private readonly views: Record<string, screens.Screen> = {};
  private boot!: screens.BootScreen;
  private readonly pauseList = new MenuList([]);
  private readonly resultList = new MenuList([]);
  private readonly playerHelp: PlayerHelp;
  private readonly homeShortcut: HomeShortcut;
  private readonly shareDialog: ShareDialog;
  /** First usable screen. The HTML startup shell waits for this before it steps aside. */
  readonly ready: Promise<void>;
  private captureNextFrame: ((image: HTMLCanvasElement) => void) | null = null;
  private recordCue: number | null = null;
  private readonly video: VideoClip;
  /** An unmarked, smaller recording of the same drive, looped behind the pause menu. */
  private readonly loopVideo: VideoClip;
  private pauseLoop: PauseLoop | null = null;
  /**
   * The home page's live scene -- the real Golden Gate, orbited slowly. The static picture
   * is still what appears first (it is there in under a second); the scene fades in behind it when the
   * tiles have arrived, and never on a phone, a low-quality machine or with reduced motion.
   */
  private showcase: { angle: number; centre: THREE.Vector3; fade: number; drawn: boolean } | null = null;
  /** Where the orbit was when its last frame was kept on the home page; it picks up there again. */
  private showcaseStillAngle: number | null = null;
  private showcaseLoading = false;
  /** This load is the opening one, so it gets the loading screen and the whole route. */
  private showcaseOpening = false;
  private showcaseToken = 0;
  private readonly settingsList = new MenuList([]);

  private phase: Phase = 'boot';
  private returnTo: Phase = 'menu';
  private session: Session | null = null;
  private loadAbort: AbortController | null = null;
  /**
   * What the player picked on the opening screen. Null means "whatever the route says", which is
   * what `autoRun` and every automated run still mean -- a bot has no opening screen to answer.
   */
  private choice: Omit<RaceChoice, 'trackId'> | null = null;
  /**
   * A time of day asked for by URL, overriding the track's own default and nothing else.
   *
   * Separate from `choice` on purpose: `choice` is the answer to three questions, and building a
   * whole one of those to carry a time also picked the car -- `?time=day` quietly turned Golden
   * Gate's convertible into a sedan, so a picture taken with it was a different drive from one
   * taken without.
   */
  private forcedTime: TimeOfDay | null = null;
  private forcedWeather: Weather | null = null;
  private countdown = 0;
  private resumePhase: 'intro' | 'countdown' | 'racing' = 'racing';
  private photo!: PhotoMode;
  private notice = '';
  private noticeUntil = 0;
  /** The run a friend's link dared this player to beat; kept until dismissed. */
  private challenge: Challenge | null = null;
  private lastResult: screens.ResultFacts = { trackId: '', time: 0, best: null, isBest: false, score: 0, slimeHits: 0 };
  private last = performance.now();
  private raf = 0;
  private autoQuality: AutoQualitySampler | null = null;

  constructor(
    private readonly canvasHost: HTMLElement,
    private readonly uiHost: HTMLElement,
    readonly dev: boolean,
    /**
     * How much game time passes per second of wall time. One for players, always.
     *
     * The automated run drives eleven whole routes end to end, and at real speed that is half an
     * hour of a machine sitting there watching a car. The simulation is fixed-step, so running it
     * faster is the same simulation, not a rougher one -- what it does risk is outrunning the tile
     * loader, which is exactly why the run that has to be realistic still uses one.
     */
    readonly timeScale = 1,
  ) {
    this.save = new Save();
    // Replays arrive from disk after the menu first draws; its "beat your ghost" hint reads them.
    void this.save.ghostsReady.then(() => this.start?.render());
    this.i18n = new I18n(window.startup?.language ?? this.save.all.language ?? detectLanguage());
    this.screens = new Screens(uiHost, this.i18n);
    this.replicaDialog = new ReplicaDialog(this.i18n);
    this.graphicsLoss = new GraphicsLossNotice(this.i18n);
    document.body.append(this.graphicsLoss.node);
    this.buildScreens();
    document.documentElement.dataset.reducedMotion = String(this.save.all.reducedMotion);
    this.playerHelp = new PlayerHelp(this.i18n, () => this.pickSetting({ id: 'language', label: '' }), () => {
      this.save.update({ helpDismissed: true }); this.renderPlayerHelp();
    }, () => {
      this.photo?.close();
      if (this.phase !== 'settings') this.returnTo = this.phase === 'paused' ? 'paused' : 'menu';
      this.show('settings');
    });
    this.homeShortcut = new HomeShortcut(this.i18n, () => this.pickSetting({ id: 'language', label: '' }));
    this.video = new VideoClip(this.i18n, { sound: () => this.audio.recordingTrack() });
    this.loopVideo = new VideoClip(this.i18n, { width: 960, height: 540, watermark: false, bitrate: 1_500_000 });
    this.photo = new PhotoMode(this.i18n, player => { void this.sharePhoto(player); }, () => this.playerHelp.showHelp());
    this.shareDialog = new ShareDialog(this.i18n, () => this.pickSetting({ id: 'language', label: '' }),
      (result, index, name) => this.renameResult(result, index, name));
    uiHost.append(this.playerHelp.node);
    this.views.intro!.node.querySelector('.panel')!.append(this.playerHelp.tip);
    uiHost.addEventListener('click', this.onUiClick);
    for (const type of ['pointerdown', 'keydown', 'touchend'] as const) window.addEventListener(type, this.onGesture, true);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.input.attach();
    this.input.attachTouch();
    this.landscape = new LandscapeGuard(this.i18n, uiHost, blocked => {
      this.input.clearHeld();
      if (blocked && this.phase === 'racing') this.show('paused');
    }, undefined, () => this.pickSetting({ id: 'language', label: '' }));
    this.audio.setVolume(this.save.all.volume);
    this.audio.setMix(this.save.all.musicVolume, this.save.all.effectsVolume);
    this.audio.setMuted(this.save.all.muted);
    // Start the home page's music on load whenever the browser allows it. Only Firefox answers
    // getAutoplayPolicy, so asking first kept Chrome silent until the first click even on a site it
    // lets play (its own engagement rules decide that, visit by visit -- hence "sometimes late").
    // A refused context simply stays suspended and the first gesture above resumes it. After the
    // saved mix, so a muted player does not hear a blip before the mute lands.
    if ((navigator as Navigator & { getAutoplayPolicy?(type: string): string }).getAutoplayPolicy?.('audiocontext') !== 'disallowed') {
      void this.audio.unlock();
    }
    // Straight into the choice, no title card. It was only ever
    // there to collect the click that browsers demand before audio may play -- so the unlock moved
    // to the first click that means something (starting a race, or any control the player uses).
    this.ready = this.openMenu(true);
    this.raf = requestAnimationFrame(this.tick);
  }

  private buildScreens(): void {
    // The same screen, kept for one job: saying which track is loading. It is never the first
    // thing a player sees any more; its return action cancels the pending load.
    this.boot = screens.bootScreen(this.i18n, () => this.quit());
    this.views.boot = this.boot;
    this.start = startScreen(this.i18n, {
      showHome: true,
      renderQuality: () => startingQuality(this.save.all.quality, isMobileDevice()),
      onLanguage: () => this.pickSetting({ id: 'language', label: '' }),
      onShare: () => { void this.share(true); },
      onShortcut: () => this.homeShortcut.show(),
      // The catalogue, not the map: the map is a picture of these, and a screen that can only
      // offer what a downloaded file happens to contain has no way in when the file is missing.
      // In dev the three synthetic tracks come too -- they are fixtures rather than places, so the
      // pipeline keeps them out of the map, and they would otherwise vanish from the menu.
      catalogue: () => [
        ...CATALOGUE.map((t) => ({ id: t.id })),
        ...(this.dev ? SYNTHETIC.map((id) => ({ id })) : []),
      ],
      playable: (id) => playable(id, this.dev),
      // Records are the selected car's own.
      bestLabel: (id, direction, vehicleId) => {
        const best = this.save.best(recordKey(raceKey(id, direction), vehicleId));
        return best === null ? null : formatTime(best);
      },
      // With the ghost switched off there is nothing to promise, so the menu's "beat your ghost next time" hint stays hidden.
      ghostAvailable: (id, direction, vehicleId) => !this.save.all.showGhost
        || !!this.save.ghost(recordKey(raceKey(id, direction), vehicleId)),
      initialSlimeDensity: this.save.all.slimeDensity,
      initialAiDifficulty: this.save.all.aiDifficulty,
      initialWeather: this.save.all.weather,
      initialChoice: () => this.save.all.lastRace,
      challenge: () => this.challenge,
      onChallengeDismiss: () => { this.challenge = null; },
      defaults: async id => {
        const track = await loadTrack(id, './tracks');
        // The menu offers the Sedan, not the route's authored car, until the player picks one for this route:
        // the three steps and the home page's one press must show the same car. Deep links and the bot keep the authored car.
        return { vehicleId: (vehicleFor(this.save.all.vehicles[id]) ?? fallbackVehicle()).id,
          // A first visit starts in daylight. The routes keep their authored night -- a deep
          // link, the automated run and the night-lighting baseline all still get it -- but the
          // menu, and the one-press race that reads the menu, open the day.
          timeOfDay: timeOfDayFor(track, { timeOfDay: this.save.all.timeOfDay ?? 'day' }) };
      },
      onStart: (choice) => { if (this.phase === 'menu') void this.startRace(choice, true); },
      onHome: () => this.scheduleShowcase(),
      onSettings: () => { this.returnTo = 'menu'; this.show('settings'); },
      onAbout: () => { this.returnTo = 'menu'; this.show('about'); },
    });
    this.views.menu = this.start;
    void this.loadMenuMap();
    this.views.intro = screens.introScreen(this.i18n, () => this.introFacts(), () => this.beginCountdown(), () => this.quit(), () => this.handleAction('pause'));
    this.views.hud = screens.playerHudScreen(this.i18n,
      () => Array.from({ length: this.session?.world.cameras.length ?? 1 }, (_, index) => this.hudState(index)),
      () => this.handleAction('pause'));
    this.pause = pauseScreen(this.i18n, this.pauseList, {
      pick: item => this.pickPause(item),
      location: () => {
        const s = this.session;
        return s ? `${s.track.name.en.toUpperCase()} · ${this.i18n.lang === 'zh' ? `${routeName(this.i18n, s.track.id, s.direction)} / ` : ''}${this.i18n.t('replica.paused')}` : '';
      },
      language: () => this.pickSetting({ id: 'language', label: '' }),
      clipSeconds: () => this.clipSeconds,
    });
    this.views.pause = this.pause;
    // The views are built before the recorders exist, so the loop reads the recorder when it is used.
    this.pauseLoop = new PauseLoop({
      available: () => this.loopVideo.recording && this.loopVideo.seconds >= MIN_REPLAY_SECONDS,
      still: () => this.loopVideo.canvas,
      peek: () => this.loopVideo.peek(),
    }, this.pause);
    this.results = screens.resultsScreen(this.i18n, () => this.lastResult, this.resultList,
      item => this.pickResult(item), () => this.audio.ui('star'), {
        language: () => this.pickSetting({ id: 'language', label: '' }),
        still: () => { const w = this.session!.world; w.render(); return w.renderer.domElement.toDataURL('image/webp'); },
      });
    this.views.results = this.results;
    this.views.settings = screens.settingsScreen(this.i18n, () => this.settingsState(), this.settingsList,
      (item, value) => this.pickSetting(item, value));
    this.views.about = screens.aboutScreen(this.i18n, () => this.show(this.returnTo), () => { void this.share(true); });
    for (const [name, view] of Object.entries(this.views)) {
      this.screens.register(name as ScreenName, view.node);
    }
  }

  private show(phase: Phase): void {
    const previous = this.phase;
    const enteringResults = phase === 'results' && this.phase !== 'results';
    if (phase === 'racing' && this.landscape?.blocked) phase = 'paused';
    if ((this.phase === 'racing' && phase !== 'racing') || (this.phase === 'paused' && phase === 'racing')) {
      this.input.clearHeld();
      this.lastCar = { ...IDLE };
      for (const racer of this.session?.racers ?? []) racer.input = { ...IDLE };
    }
    if (this.session && (this.phase === 'countdown' || phase === 'countdown')) {
      // Keep the starting grid on a slope while suspension settles; the reverse pedal cannot hold it.
      const free = phase !== 'countdown';
      for (const racer of this.session.racers) for (const car of [racer.car, racer.trailer?.car]) {
        car?.body.setEnabledTranslations(free && !racer.waitingForRoad, !racer.waitingForRoad,
          free && !racer.waitingForRoad, true);
      }
    }
    if (phase === 'paused' && this.phase !== 'paused') {
      if (this.phase === 'intro' || this.phase === 'countdown' || this.phase === 'racing') {
        this.resumePhase = this.phase;
        if (this.videoWanted()) void this.pauseLoop?.open();
      }
      this.pauseList.select('resume');
    }
    // Settings opened from the pause menu come back to it, so the loop only ends when the pause does.
    if (phase !== 'paused' && phase !== 'settings') this.pauseLoop?.close();
    this.phase = phase;
    this.audio.setScene(phase);
    const screen = SCREEN_FOR[phase];
    this.views[screen]?.render();
    this.screens.show(screen, screen === 'settings' ? (this.returnTo === 'paused' ? 'pause' : 'menu') : undefined);
    // Leaving the menu at all -- settings, about, a race -- gives the showcase's world back.
    if (phase !== 'menu' && (this.showcase || this.showcaseLoading)) this.stopShowcase();
    //...and coming back to it from settings or about starts the scene again.
    if (phase === 'menu' && previous !== 'menu') this.scheduleShowcase();
    if (enteringResults) this.results.refreshMedia();
    // The record fanfare lands after the stars have popped, and only on the way in.
    // Only leaving the results cancels it; a second render of the same screen must not eat the fanfare.
    if (this.recordCue !== null && phase !== 'results') { clearTimeout(this.recordCue); this.recordCue = null; }
    if (enteringResults && screens.resultRecord(this.lastResult)) {
      this.recordCue = window.setTimeout(() => {
        this.recordCue = null;
        if (this.phase === 'results') this.audio.ui('record');
      }, 1100);
    }
    this.start.setActive(screen === 'menu');
    this.renderPlayerHelp();
  }

  /** The one sentence that says the map data is behind, or nothing at all. See `dataHealth.ts`. */
  private staleNotice(): string {
    const world = this.session?.world;
    if (!world) return '';
    const key = staleAssetsKey({
      tilesFailed: world.streamer.stats.failed,
      tilesLoaded: world.streamer.stats.loaded,
      texturesApplied: world.texturesApplied,
    });
    return key ? devHint(this.i18n.t(key), 'assets') : '';
  }

  private say(text: string, seconds = 2): void {
    this.notice = text;
    this.noticeUntil = performance.now() + seconds * 1000;
  }

  // ---------------------------------------------------------------- menus

  /**
   * A challenge code from a link. A good one puts the
   * menu on that route with the banner up; anything else is refused and the game carries on as if
   * the link had no challenge.
   */
  acceptChallenge(code: string): boolean {
    const dare = decodeChallenge(code, {
      tracks: [...CATALOGUE.map(track => track.id), ...(this.dev ? SYNTHETIC : [])],
      vehicles: VEHICLES.map(vehicle => vehicle.id),
    });
    if (!dare) return false;
    this.challenge = dare;
    if (this.phase === 'menu') { this.start.reset(false); this.start.render(); }
    return true;
  }

  /**
   * True when this machine should run the home page's live scene at all.
   *
   * Moved the "is the home page up" half out to the callers: the opening now loads the
   * scene *before* the home page exists, so asking for phase `menu` here would refuse it.
   */
  private showcaseWanted(): boolean {
    return !this.session && !this.showcaseLoading
      && this.motionWanted && !isMobileDevice() && this.save.all.quality !== 'low';
  }

  /** The same question for the delayed path, which really does run with the home page already up. */
  private showcaseWantedAtHome(): boolean {
    return this.showcaseWanted() && this.phase === 'menu' && this.start.atHome;
  }

  /**
   * Loads the Golden Gate and starts the orbit.
   *
   * `opening` is the path: the very first time, this runs in front of the home page with the
   * loading screen's own progress bar, and the home page then opens with the bay already turning.
   *
   * Coming back from a race keeps the old quiet path: the player has seen the game, and a progress
   * bar on the way home would be a step backwards, not forwards.
   */
  private async startShowcase(opening = false): Promise<'live' | 'failed' | 'superseded'> {
    if (!this.showcaseWanted()) return 'failed';
    this.showcaseLoading = true;
    const token = ++this.showcaseToken;
    // Day, clear: the postcard look. Both are cleared again below, so a later retry reads the player's own choice.
    this.forcedTime = 'day';
    this.forcedWeather = 'clear';
    this.showcaseOpening = opening;
    const loaded = await this.load(SHOWCASE_TRACK).catch(() => false);
    // A race asked for while the tiles arrived owns the screen now: its own load reset these already.
    if (token !== this.showcaseToken) return 'superseded';
    this.showcaseLoading = false;
    this.showcaseOpening = false;
    this.forcedTime = null;
    this.forcedWeather = null;
    const s = this.session;
    // The player may have started a race or walked into the menu's steps while the tiles arrived.
    if (!loaded || !s) return 'failed';
    // The player moved on while the tiles arrived: hand the world straight back.
    if (!opening && (this.phase !== 'menu' || !this.start.atHome)) { this.stopShowcase(); return 'failed'; }
    // A fifth of the way along the route is the first bridge tower; the car starts back in the Presidio.
    const spline = s.world.spline;
    const at = spline.indexAt(spline.length * SHOWCASE_AT);
    const point = spline.point(at);
    // The opening has nothing to fade from, so it starts full: the picture it would cross-fade out
    // of is never shown at all. Coming back, the orbit resumes at the frame the page is showing, so
    // that frame stays up until the first live one is drawn over the same view.
    const angle = opening ? SHOWCASE_START_ANGLE : this.showcaseStillAngle ?? SHOWCASE_START_ANGLE;
    this.showcase = { angle, centre: new THREE.Vector3(point[0], point[1], point[2]), fade: opening ? 1 : 0, drawn: false };
    if (opening) this.uiHost.dataset.showcase = 'live';
    else if (this.uiHost.dataset.showcase !== 'still') this.uiHost.dataset.showcase = 'loading';
    return 'live';
  }

  /** Drops the scene and goes back to the picture: leaving the home page, or starting a race. */
  /** Drops the scene and frees the world; the home page goes back to its picture. */
  private stopShowcase(): void {
    this.abandonShowcase();
    if (!this.session) return;
    this.teardown();
  }

  /** Forgets the scene without touching the world: the caller is about to load its own. */
  private abandonShowcase(): void {
    if (this.showcase?.drawn && this.session) this.keepShowcaseFrame(this.session, this.showcase.angle);
    this.showcaseToken++;
    this.showcaseLoading = false;
    this.showcaseOpening = false;
    this.showcase = null;
    delete this.uiHost.dataset.showcase;
  }

  /* */
  private keepShowcaseFrame(s: Session, angle: number): void {
    const source = s.world.renderer.domElement;
    if (!source.width || !source.height || s.world.renderer.getContext().isContextLost()) return;
    this.drawViews(s);
    const still = this.start.homeStill;
    const scale = Math.min(1, SHOWCASE_STILL_WIDTH / source.width);
    still.width = Math.round(source.width * scale);
    still.height = Math.round(source.height * scale);
    still.getContext('2d')!.drawImage(source, 0, 0, still.width, still.height);
    this.showcaseStillAngle = angle;
  }

  private async openMenu(initial = false): Promise<void> {
    // Clear the in-flight race snapshot; saved player preferences remain available to the menu.
    this.choice = null;
    this.start.reset(initial);
    this.start.render();
    // On the way in, the scene is loaded first, behind the loading screen's progress bar,
    // and the home page then opens straight into the orbit. A machine that never runs the scene --
    // a phone, a low-quality setting, reduced motion -- opens the home page at once, as before, and
    // a failed load falls back to exactly that.
    if (initial && this.showcaseWanted()) {
      this.boot.setProgress(0);
      this.show('boot');
      // A race asked for while the bay loads owns the screen from then on -- the menu must not
      // snatch it back when the abandoned load finally returns.
      if (await this.startShowcase(true) !== 'superseded') {
        // A challenge link arrives while the opening loads, before there is a menu to put on its route
        // (acceptChallenge only moves a menu that is already up): land on the dared route, not the home page.
        if (this.challenge && this.start.atHome) { this.start.reset(false); this.start.render(); }
        this.show('menu');
      }
      return;
    }
    this.show('menu');
  }

  /* */
  private scheduleShowcase(): void {
    if (!this.showcaseWantedAtHome()) return;
    // The kept frame, not the shipped picture, is what the page shows while the scene comes back.
    if (this.showcaseStillAngle !== null) this.uiHost.dataset.showcase = 'still';
    window.setTimeout(() => { if (this.showcaseWantedAtHome() && !this.showcase) void this.startShowcase(); }, 1200);
  }

  /**
   * The Bay map behind the opening screen. Fire and forget, like the billboards and the street
   * maps: a menu that cannot draw its map still lists every route, and a map is not a reason to
   * make a player wait at a black screen.
   */
  private async loadMenuMap(): Promise<void> {
    try {
      const res = await fetch('./menu-map.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.start.setMap(parseMenuMap(await res.json()));
    } catch (err) {
      console.warn('menu map: falling back to the route list', err);
      this.start.setMap(null);
    }
  }

  private pickPause(item: MenuItem): void {
    if (this.phase !== 'paused') return;
    switch (item.id) {
      case 'resume': this.show(this.resumePhase); break;
      case 'photo': {
        const s = this.session!;
        this.photo.show(s.world.cameras, s.humans.map(racer => ({position: racer.mesh.position, height: racer.vehicle.size[1]!})), s.physics);
        break;
      }
      case 'homepage': case 'coffee': this.openCreatorLink(item.id); break;
      case 'clip': void this.saveClip(null); break;
      case 'share': void this.share(true); break;
      case 'restart': this.replicaDialog.show('restart', () => this.restart()); break;
      case 'settings': this.returnTo = 'paused'; this.show('settings'); break;
      case 'quit': this.replicaDialog.show('menu', () => this.quit()); break;
    }
  }

  /**
   * One press goes straight to itch.io -- the author's profile, or the game's
   * /purchase tip page for the coffee -- with no dialog in between. A build without a verified page still says where it will go.
   */
  private openCreatorLink(kind: 'homepage' | 'coffee'): void {
    const url = creatorLinkUrl(kind);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    else this.replicaDialog.show('destination');
  }

  private pickResult(item: MenuItem): void {
    if (this.phase !== 'results') return;
    switch (item.id) {
      case 'homepage': case 'coffee': this.openCreatorLink(item.id); break;
      case 'retry': this.restart(); break;
      case 'share': void this.share(); break;
      case 'text': void this.copyTextCard(); break;
      case 'clip': void this.saveClip(this.lastResult); break;
      case 'quit': this.quit(); break;
    }
  }

  private pickSetting(item: MenuItem, value?: string | number): void {
    const s = this.save.all;
    switch (item.id) {
      case 'language': {
        const next = value === undefined ? LANGUAGES[(LANGUAGES.indexOf(this.i18n.lang) + 1) % LANGUAGES.length]! : value as typeof LANGUAGES[number];
        this.i18n.set(next);
        this.landscape.render();
        this.save.update({ language: next });
        document.documentElement.lang = next;
        // the hoardings by the road change language too, not just the menu
        this.session?.world.billboards.setLanguage(next);
        this.session?.gates.setLabelTextures((index, total) =>
          checkpointLabelTexture(this.i18n.t('gate.checkpoint'), index, total));
        this.start.render();
        if (this.phase === 'settings' && this.returnTo === 'paused') this.views.pause?.render();
        break;
      }
      case 'reducedMotion': {
        this.save.update({ reducedMotion: value === undefined ? !s.reducedMotion : value === 'on' });
        document.documentElement.dataset.reducedMotion = String(this.save.all.reducedMotion);
        break;
      }
      case 'showGhost': {
        this.save.update({ showGhost: value === undefined ? !s.showGhost : value === 'on' });
        // Takes effect at once, in a race already under way too; the recorder keeps recording either way.
        const session = this.session;
        if (session) void this.ghostReplay?.set(this.ghostData(session));
        this.start.render();
        break;
      }
      case 'name': case 'name2': {
        // A confirm press on the row carries no text: it opens the field for typing and changes nothing.
        if (value === undefined) {
          document.querySelector<HTMLInputElement>(`input[data-setting="${item.id}"]`)?.focus();
          return;
        }
        const names: [string, string] = [...s.names];
        names[item.id === 'name' ? 0 : 1] = cleanPlayerName(value);
        this.save.update({ names });
        break;
      }
      case 'help': this.playerHelp.showHelp(); return;
      case 'shortcut': this.homeShortcut.show(); return;
      case 'quality': {
        const next = value === undefined ? QUALITIES[(QUALITIES.indexOf(s.quality) + 1) % QUALITIES.length]! : value as typeof QUALITIES[number];
        this.save.update({ quality: next });
        if (this.session) {
          if (next === 'auto') {
            this.setSessionQuality(autoQualityStart(isMobileDevice()));
            this.autoQuality = autoQualitySamplerFor(isMobileDevice());
          } else {
            this.autoQuality = null;
            this.setSessionQuality(next);
          }
        }
        break;
      }
      case 'camera':
      case 'camera2': {
        const player = item.id === 'camera2' ? 1 : 0;
        const current = s.cameraModes[player] ?? 'chase';
        this.setCamera(player,
          value === undefined ? CAMERA_MODES[(CAMERA_MODES.indexOf(current) + 1) % CAMERA_MODES.length]! : value as CameraMode);
        break;
      }
      case 'volume': {
        const next = value === undefined ? Math.round((s.volume + 0.25) * 100) / 100 : Number(value);
        if (next > 1.001 || next === 0) this.save.update({ volume: 0, muted: true });
        else this.save.update({ volume: next, muted: false });
        this.audio.setVolume(this.save.all.volume);
        this.audio.setMuted(this.save.all.muted);
        break;
      }
      case 'musicVolume':
      case 'effectsVolume': {
        const key = item.id;
        this.save.update({ [key]: value === undefined ? (s[key] >= 1 ? 0 : Math.min(1, s[key] + 0.25)) : Number(value) });
        this.audio.setMix(this.save.all.musicVolume, this.save.all.effectsVolume);
        break;
      }
      case 'back': this.show(this.returnTo); return;
    }
    this.views[this.screens.current as ScreenName]?.render();
    this.renderPlayerHelp();
    this.photo?.render();
  }

  private renderPlayerHelp(): void {
    this.playerHelp?.render(this.phase, (this.session?.humans.length ?? this.start.playerCount) === 2,
      this.device === 'touch' || isMobileDevice(), this.save.all.helpDismissed);
  }

  private settingsState(): screens.SettingsState {
    const s = this.save.all;
    return { language: this.i18n.lang, quality: s.quality, volume: s.volume, muted: s.muted,
      musicVolume: s.musicVolume, effectsVolume: s.effectsVolume, reducedMotion: s.reducedMotion, showGhost: s.showGhost,
      cameraModes: s.cameraModes, names: s.names,
      playerCount: this.session?.humans.length ?? this.start.playerCount };
  }

  private setCamera(player: number, mode: CameraMode): void {
    const cameraModes: [CameraMode, CameraMode] = [...this.save.all.cameraModes];
    cameraModes[player] = mode;
    this.save.update({ cameraModes });
    this.session?.humans[player]?.chase.setMode(mode);
    this.views.hud?.render();
  }

  private cycleCamera(player: number): void {
    if (!this.session || (this.phase !== 'racing' && this.phase !== 'countdown')) return;
    const racer = this.session.humans[player];
    if (!racer) return;
    this.setCamera(player, racer.chase.cycleMode());
    void this.audio.unlock().then(() => this.audio.ui('confirm'));
  }

  private async share(home = false): Promise<void> {
    await this.shareDialog.show(home ? null : this.lastResult, async () => {
      if (home) { const image = new Image(); image.src = './home/goldengate.webp'; await image.decode(); return image; }
      return new Promise<HTMLCanvasElement>(resolve => { this.captureNextFrame = resolve; });
    });
  }

  private async copyTextCard(): Promise<void> {
    const result = this.lastResult;
    const text = textCard(this.i18n, result);
    if (!text) return;
    const copied = await copyShareText(text);
    if (this.phase !== 'results' || this.lastResult !== result) return;
    this.lastResult = {...result, textCopied: copied};
    this.views.results?.render();
  }

  /**
   * A nickname typed in the share dialog: remembered like the settings field, and put on
   * the result being shared -- its card, its text and the challenge code it passes on.
   */
  private renameResult(result: screens.ResultFacts, index: number, raw: string): screens.ResultFacts {
    const name = cleanPlayerName(raw);
    const names: [string, string] = [...this.save.all.names];
    names[index] = name;
    this.save.update({ names });
    const named = <T extends { name?: string }>(item: T): T => { const { name: _old, ...rest } = item; return (name ? { ...rest, name } : rest) as T; };
    let next: screens.ResultFacts = result.players
      ? { ...result, players: result.players.map((player, i) => i === index ? named(player) : player) }
      : named(result);
    if (!result.players && result.challengeCode) {
      const run = decodeChallenge(result.challengeCode, { tracks: [...CATALOGUE.map(track => track.id), ...SYNTHETIC], vehicles: VEHICLES.map(vehicle => vehicle.id) });
      if (run) {
        const code = encodeChallenge(named(run));
        next = { ...next, challengeCode: code, challengeUrl: challengeUrl() };
      }
    }
    if (this.lastResult === result) { this.lastResult = next; this.views.results?.render(); }
    return next;
  }

  /**
   * The rolling video of the drive. Reduced motion opts out.
   *
   * `!isMobileDevice()` is a **performance** decision, not a capability one: phones can record
   *We choose not to ask them to,
   * because their frame budget is already tight. To turn it on for phones some day, delete that one condition; nothing in the
   * browsers is in the way.
   */
  private videoWanted(): boolean {
    return this.video.supported && this.motionWanted && !isMobileDevice();
  }

  /** Seconds of drive on offer: nothing at all when this machine or this setting does not record. */
  private get clipSeconds(): number {
    return this.videoWanted() && this.video.available ? this.video.seconds : 0;
  }

  /** Hands the last dozen seconds to the share dialog as a file. */
  private async saveClip(result: screens.ResultFacts | null): Promise<void> {
    const s = this.session, route = s ? { trackId: s.track.id, direction: s.direction } : result;
    await this.shareDialog.showClip(result, async () => {
      const clip = await this.video.save();
      // Saving restarts the saved recording's longer lane; restart the replay's too, or the next pause
      // replays 13 s while the button offers 6.
      if (clip && this.loopVideo.recording) void this.loopVideo.finishLongest();
      return clip;
    }, route);
  }

  /** Whether this player wants moving pictures at all: the saved setting and the OS setting. */
  private get motionWanted(): boolean {
    return !this.save.all.reducedMotion
      && !(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  }

  private async sharePhoto(player: number): Promise<void> {
    const s = this.session; if (!s || !this.photo.open) return;
    const racer = s.humans[player]!;
    const facts: screens.ResultFacts = {
      trackId: s.track.id, direction: s.direction, time: racer.race.time,
      score: racer.race.score, slimeHits: racer.race.slimeHits, best: null, isBest: false,
      capturedAt: new Date().toLocaleDateString(this.i18n.lang === 'zh' ? 'zh-CN' : 'en-US'),
    };
    await this.shareDialog.show(facts, async () => {
      const image = await new Promise<HTMLCanvasElement>(resolve => { this.captureNextFrame = resolve; });
      const output = document.createElement('canvas');
      const left = Math.floor(image.width * player / s.humans.length);
      output.width = Math.floor(image.width * (player + 1) / s.humans.length) - left;
      output.height = image.height;
      output.getContext('2d')!.drawImage(image, left, 0, output.width, output.height, 0, 0, output.width, output.height);
      return output;
    });
  }

  // ---------------------------------------------------------------- a race

  private async load(trackId: string, vehicleId?: string, playerVehicles?: readonly string[], ai = false, difficulty: AiDifficulty = 'rush', direction: RaceDirection = this.choice?.direction ?? 'forward'): Promise<boolean> {
    this.loadAbort?.abort();
    const request = new AbortController();
    this.loadAbort = request;
    const choice = this.choice;
    const time = this.forcedTime ?? choice?.timeOfDay;
    const weather = this.forcedWeather ?? choice?.weather ?? 'clear';
    let model: VehicleModel | null = null;
    let trailerModel: VehicleModel | null = null;
    const racers: Racer[] = [];
    let physics: PhysicsWorld | null = null;
    let world: World | null = null;
    let gates: Gates | null = null;
    let sparks: Sparks | null = null;
    let slimes: SlimeLayer | null = null;
    let ghost: GhostReplay | null = null;
    this.boot.setTrack(trackId, null);
    this.boot.setFailure(null);
    // On the way into the game this screen is not a departure. The route card and the
    // "estimated 4-8 min" line describe a drive the player has not asked for yet.
    const opening = this.showcaseOpening;
    this.boot.setOpening(opening);
    // Clear the previous load's 100% before the screen appears, not after.
    this.boot.setProgress(0);
    if (!this.showcaseLoading) this.show('boot');
    this.boot.setStatus(opening ? this.i18n.t('boot.prepare')
      : this.i18n.t('boot.loading', { track: this.i18n.t(`track.${trackId}.name`) }));
    // Real milestones, weighted roughly by how long each one takes on a cold cache. The surrounding
    // tiles are the long part, so they get the widest span and report one tile at a time.
    const progress = (fraction: number) => {
      if (request.signal.aborted) return;
      this.boot.setProgress(fraction); window.startup?.progress(fraction);
    };
    const loadModel = (body: Parameters<typeof VehicleModel.load>[0]) => VehicleModel.load(body, request.signal,
      stage => {
        if (request.signal.aborted) return;
        const key = `boot.vehicle.${stage}`;
        this.boot.setStage(key);
        window.startup?.stage(key);
      });
    try {
      const [source, api] = await Promise.all([loadTrack(trackId, './tracks'), initPhysics()]);
      if (request.signal.aborted) return false;
      progress(0.12);
      const track = directedTrack(source, direction);
      if (!opening) this.boot.setTrack(trackId, track);
      const vehicle = resolveVehicle(vehicleId ?? choice?.vehicleId, { car: choice?.car ?? track.car });
      model = await loadModel(vehicle);
      if (request.signal.aborted) { model.dispose(); return false; }
      if (vehicle.trailer) trailerModel = await loadModel(vehicle.trailer);
      if (request.signal.aborted) { model.dispose(); trailerModel?.dispose(); return false; }
      progress(0.22);
      this.teardown();
      this.audio.setVehicle(vehicle.id);
      this.audio.setWeather(weather);
      const tuning = vehicleTuning(vehicle, vehicle.tuning as CarKind);
      physics = new PhysicsWorld(api, tuning.gravity);
      const quality = this.save.all.quality;
      const slimeDensity = choice?.slimeDensity ?? this.save.all.slimeDensity;
      this.autoQuality = quality === 'auto' ? autoQualitySamplerFor(isMobileDevice()) : null;
      this.boot.setStage('boot.scene');
      window.startup?.stage('boot.scene');
      world = new World(this.canvasHost, track, `./tracks/${trackId}`, {
        colliders: physics, quality: startingQuality(quality, isMobileDevice()),
        slimeDensity,
        weather,
        ...(time ? { timeOfDay: time } : {}),
        // The home page's opening keeps the whole route loaded. Its camera hangs ninety
        // metres up and looks kilometres along the bridge, and outside the driving window there is
        // no ground -- the backdrop leaves the corridor to the tiles on purpose -- so the player was
        // looking at the sky through the world. Goldengate's seventy tiles are 6.5 MB in total.
        ...(this.showcaseOpening ? { streamWindow: WHOLE_ROUTE } : {}),
      });
      world.weatherEffects.setGroundQuery((x, z, top, bottom) => physics!.surfaceAt(x, z, top, bottom));
      const billboardsReady = world.billboards.load('./', this.i18n.lang);
      // likewise: the maps in the corner draw the route alone until the streets arrive, and a
      // street map that fails to load must not be the reason a race does not start
      this.streets = null;
      if (track.map) {
        const hiddenNames = CATALOGUE.find(entry => entry.id === trackId)?.hiddenStreetNames;
        void loadStreetMap(`./tracks/${trackId}/${track.map.file}`, hiddenNames).then((m) => {
          if (!request.signal.aborted) { this.streets = m; this.route = null; }
        });
      }
      await world.streamer.prepareSpawn(track.start.pos[0], track.start.pos[2]);
      request.signal.throwIfAborted();
      progress(0.32);
      const humans = playerVehicles?.length
        ? [vehicle, ...playerVehicles.slice(1, isMobileDevice() ? 1 : 2).map(id => resolveVehicle(id, track))] : [vehicle];
      const pace = AI_PACE[raceKey(trackId, direction)];
      const roster = raceRoster(humans, ai, isMobileDevice() ? MOBILE_AI_RIVALS : Infinity, vehicle => pace?.[vehicle.id]);
      const vehicles = roster.map(entry => entry.vehicle);
      const spawns = racerSpawns(track, world.spline, vehicles, roster.map(entry => entry.role), vehicle => pace?.[vehicle.id]);
      for (const [index, selected] of vehicles.entries()) {
        let bodyModel = index === 0 ? model : null;
        let towModel = index === 0 ? trailerModel : null;
        try {
          bodyModel ??= await loadModel(selected);
          if (selected.trailer && !towModel) towModel = await loadModel(selected.trailer);
          const spawn = spawns[index]!;
          this.boot.setStage('boot.scene');
          window.startup?.stage('boot.scene');
          await world.streamer.prepareSpawn(spawn.pos[0], spawn.pos[2]);
          request.signal.throwIfAborted();
          const racer = new Racer(roster[index]!.id, selected, bodyModel, towModel,
            physics, world.scene, track, world.spline, spawn, roster[index]!.role, difficulty,
            world.headlights.on);
          racer.car.setWeatherGrip(WEATHER_GRIP[weather]);
          racer.trailer?.car.setWeatherGrip(WEATHER_GRIP[weather]);
          for (const body of [racer.car, ...(racer.trailer ? [racer.trailer.car] : [])]) {
            body.setWeatherQuery(point => world!.weatherEffects.surface.sample(point.x, point.y, point.z,
              racer.race.progress.value.index));
          }
          racers.push(racer);
          progress(0.32 + 0.1 * racers.length / vehicles.length);
          if (vehicles.length > 1) physics.setVehicleContacts(racer.car.collider, true);
        } catch (error) {
          bodyModel?.dispose(); towModel?.dispose(); throw error;
        }
      }
      racers.filter(racer => racer.role === 'human').forEach((racer, index) =>
        racer.chase.setMode(this.save.all.cameraModes[index] ?? 'chase'));
      world.setRacerHeadlights(racers.map(racer => ({ body: racer.vehicle, human: racer.role === 'human' })));
      world.setViewCount(humans.length);
      gates = new Gates(track.checkpoints, track.mode === 'loop', (index, total) =>
        checkpointLabelTexture(this.i18n.t('gate.checkpoint'), index, total));
      world.scene.add(gates.group);
      sparks = new Sparks();
      world.scene.add(sparks.mesh);
      // Placement comes from the same streamed tiles as the road. In clear-road mode the owner is
      // not constructed at all: no hidden mesh, collider, ground-effect zone or per-frame update.
      slimes = slimeDensity !== 'none' ? this.createSlimes(world, physics, racers) : null;
      this.graphicsLoss.watch(world.renderer.domElement);
      world.onRendererChange = (previous, next) => { slimes?.transferRenderer(previous, next); this.graphicsLoss.watch(next.domElement); };
      const primary = racers[0]!;
      primary.autopilot = this.nextAutopilot;
      const session: Session = {
        track, direction, world, physics, gates, sparks, slimes, racers,
        get humans() { return racers.filter(racer => racer.role === 'human'); },
        get car() { return primary.car; },
        get mesh() { return primary.mesh; },
        get model() { return primary.model; },
        get vehicle() { return primary.vehicle; },
        get trailer() { return primary.trailer; },
        get trailerModel() { return primary.trailerModel; },
        get trailerPose() { return primary.trailerPose; },
        get race() { return primary.race; },
        set race(value) { primary.race = value; },
        get chase() { return primary.chase; },
        get renderPose() { return primary.renderPose; },
        get bot() { return primary.bot; },
      };
      // Keep first-use downloads and GPU preparation behind the loading screen. Use the same
      // window and landmark selection as driving, rather than eagerly loading the whole track.
      const positions = this.streamingPositions(session);
      let tiles = 0; let extras = 0;
      const windowProgress = () => progress(0.42 + 0.4 * tiles + 0.1 * extras / 3);
      const extra = <T>(promise: Promise<T>) => promise.then((value) => { extras++; windowProgress(); return value; });
      await Promise.all([extra(world.sceneryReady), extra(billboardsReady),
        world.streamer.prepareWindow(positions, (done, total) => { tiles = total ? done / total : 1; windowProgress(); }),
        extra(world.landmarks.prepare(positions))]);
      request.signal.throwIfAborted();
      for (const [index, camera] of world.cameras.entries()) {
        const racer = session.humans[index]!;
        racer.chase.update(camera, racer.car.position, racer.car.quaternion,
          new THREE.Vector3(), 1 / 60, { grounded: racer.car.grounded });
      }
      // Everything that can first appear during the race compiles here, not on first use,
      // including the personal-best ghost, which appears on the first racing frame.
      ghost = new GhostReplay(world.scene);
      await this.save.ghostsReady;
      await ghost.set(this.ghostData(session));
      request.signal.throwIfAborted();
      slimes?.prepareGpu(world.renderer);
      await compileEverything(world.renderer, world.scene, world.camera);
      request.signal.throwIfAborted();
      progress(0.96);
      world.sky.follow(primary.car.position.x, primary.car.position.y, primary.car.position.z);
      world.weatherEffects.render(world.renderer, world.camera);
      slimes?.renderEffects(world.renderer);
      const daylight = world.sky.daylight;
      world.render((index, camera) => {
        session.gates.setCleared(session.humans[index]!.race.checkpointsCleared);
        session.sparks.faceCamera(camera);
        slimes?.prepareView(session.humans[index]!.car, daylight);
      });
      // Complete buffer uploads and the first shadow pass before exposing the countdown.
      world.renderer.getContext().finish();
      this.session = session;
      this.ghostReplay = ghost;
      this.prepareGhost();
      progress(1);
      if (opening) window.startup?.complete();
      await holdCompletedLoading();
      request.signal.throwIfAborted();
      this.boot.setStatus(null);
      if (!this.showcaseLoading) this.show('intro');
      return true;
    } catch (err) {
      ghost?.dispose();
      gates?.dispose();
      sparks?.dispose();
      world?.streamer.setSlimeSink(null);
      slimes?.dispose();
      model?.dispose();
      trailerModel?.dispose();
      for (const racer of racers) racer.dispose();
      this.graphicsLoss.watch(null);   // disposing the world forces its own context loss; that is not a failure
      world?.dispose();
      physics?.dispose();
      if (request.signal.aborted) return false;
      console.error(err);
      this.boot.setStatus(null);
      this.boot.setFailure(() => { void this.load(trackId, vehicleId, playerVehicles, ai, difficulty, direction); });
      return false;
    }
  }

  private beginCountdown(): void {
    if (!this.session || !['intro', 'paused', 'results'].includes(this.phase)) return;
    this.input.clearHeld();
    this.countdown = COUNTDOWN_SECONDS;
    this.show('countdown');
  }

  private createSlimes(world: World, physics: PhysicsWorld, racers: readonly Racer[]): SlimeLayer {
    const slimes = new SlimeLayer(world.scene, physics, world.spline, this.canvasHost,
      world.qualityLimits, [], (kind, strength, phase) => this.audio.slime(kind, strength, phase),
      racers[0]!.model, world.sky.timeOfDay);
    racers.forEach((racer, index) => slimes.registerDriver(racer.car,
      world.viewHosts[index] ?? document.createElement('div'), racer.model,
      racer.role === 'human' && world.cameras.length === 1));
    slimes.onHit = (key, scale, car, kind) => {
      const racer = racers.find(racer => racer.car === car);
      const destroyed = () => DESTROYED_SLIME_KINDS.reduce(
        (sum, id) => sum + (racer?.race.impactKinds[id] ?? 0), 0);
      const before = destroyed();
      racer?.race.hitSlime(key, scale, kind);
      const after = destroyed();
      if (racer?.role === 'human' && after > before) {
        const earned = this.save.recordSlimeHit(after);
        if (earned[0]) this.say(this.i18n.t('achievement.unlocked', {
          name: this.i18n.t(`achievement.${earned[0]}.name`),
        }), 3);
      }
    };
    world.streamer.setSlimeSink(slimes);
    return slimes;
  }

  private restart(): void {
    if (!this.session || !['paused', 'results'].includes(this.phase)) return;
    for (const racer of this.session.racers) racer.reset();
    this.session.world.tireMarks.clear();
    if (this.session.slimes) {
      this.session.world.streamer.setSlimeSink(null);
      this.session.slimes.dispose();
      this.session.slimes = this.createSlimes(this.session.world, this.session.physics, this.session.racers);
    }
    this.prepareGhost();
    // The old slime layer released its programs; there is no loading screen to hide their rebuild.
    this.warmNow(this.session);
    this.video.stop(); this.loopVideo.stop();
    this.beginCountdown();
  }

  private ghostData(s: Session): GhostData | null {
    return s.humans.length === 1 && this.save.all.showGhost ? this.save.ghost(recordKey(raceKey(s.track.id, s.direction), s.vehicle.id)) : null;
  }

  private prepareGhost(): void {
    const s = this.session!;
    this.ghostRecorder = s.humans.length === 1 ? new GhostRecorder(s.vehicle.id, !!s.trailer) : null;
    this.loadGhostReplay(s);
  }

  /** A first ghost loads while the results are up, so a retry does not meet its models for the first time. */
  private loadGhostReplay(s: Session): void {
    void this.ghostReplay?.set(this.ghostData(s), () => { if (this.session === s && this.phase !== 'racing') this.warmNow(s); });
  }

  /** Synchronous preparation for moments without a loading screen: restart, a renderer swap, a ghost that just arrived. */
  private warmNow(s: Session): void {
    s.slimes?.prepareGpu(s.world.renderer);
    compileEverythingNow(s.world.renderer, s.world.scene, s.world.camera);
  }

  private sampleGhost(force = false): void {
    const s = this.session; if (!s || !this.ghostRecorder) return;
    this.ghostRecorder.sample(s.race.time, s.car, s.car.poseRevision, s.trailer?.car, force);
  }

  private quit(): void {
    this.loadAbort?.abort();
    this.teardown();
    void this.openMenu();
  }

  private teardown(): void {
    if (!this.session) return;
    this.route = null; this.streets = null;
    this.photo?.close();
    this.video?.stop(); this.loopVideo?.stop(); this.pauseLoop?.close();
    this.ghostReplay?.dispose(); this.ghostReplay = null; this.ghostRecorder = null;
    this.session.gates.dispose();
    this.session.sparks.dispose();
    this.session.world.streamer.setSlimeSink(null);
    this.session.slimes?.dispose();
    for (const racer of this.session.racers) racer.dispose();
    this.graphicsLoss.watch(null);   // disposing the world forces its own context loss; that is not a failure
    this.session.world.dispose();
    this.session.physics.dispose();
    this.session = null;
    this.audio.setWeather('clear');
    this.autoQuality = null;
  }

  private introFacts(): screens.IntroFacts {
    const t = this.session!.track;
    return {
      track: t, direction: this.session!.direction,
      best: t ? this.save.best(recordKey(raceKey(t.id, this.session!.direction), this.session!.vehicle.id)) : null,
      device: isMobileDevice() && this.device === 'keyboard' ? 'touch' : this.device,
    };
  }

  /* */
  private gateCount(): number {
    return drivableGateCount(this.session?.track.checkpoints.length ?? 0);
  }

  /** Phone races the drag-to-steer hint plays for, in the countdown. */
  static readonly TOUCH_GUIDE_RACES = 3;
  /** No thumb on the stick this long, with the car near the edge, brings the hint back once. */
  static readonly TOUCH_REMINDER_IDLE_MS = 5000;
  static readonly TOUCH_REMINDER_EDGE_M = 1.2;
  static readonly TOUCH_REMINDER_SHOW_MS = 2500;
  static readonly TOUCH_REMINDER_GAP_MS = 20000;
  private lastTouchSteerAt = 0;
  private touchReminderAt = -Infinity;

  private touchDriving(): boolean {
    return (this.session?.humans.length ?? 1) === 1 && (this.device === 'touch' || isMobileDevice());
  }

  private watchTouchSteering(now: number): void {
    if (this.input.touch.steeringHeld) { this.lastTouchSteerAt = now; return; }
    const racer = this.session?.humans[0];
    if (this.phase !== 'racing' || !racer || !this.touchDriving() || racer.race.state !== 'racing') return;
    if (now - this.lastTouchSteerAt < Game.TOUCH_REMINDER_IDLE_MS || now - this.touchReminderAt < Game.TOUCH_REMINDER_GAP_MS) return;
    const at = racer.race.progress.value;
    const halfWidth = racer.race.spline.halfWidth[at.index] ?? 4;
    if (Math.abs(at.lateral) > halfWidth - Game.TOUCH_REMINDER_EDGE_M && racer.car.speed > 2) this.touchReminderAt = now;
  }

  private hudTouchGuide(index: number): screens.HudState['touchGuide'] {
    if (index !== 0 || !this.touchDriving()) return null;
    if (this.phase === 'countdown') return this.save.all.touchGuideRaces < Game.TOUCH_GUIDE_RACES ? 'countdown' : null;
    if (this.phase === 'racing' && performance.now() - this.touchReminderAt < Game.TOUCH_REMINDER_SHOW_MS) return 'reminder';
    return null;
  }

  private hudState(index = 0): screens.HudState {
    const s = this.session;
    const racer = s?.humans[index];
    const race = racer?.race;
    const standings = s && s.racers.length > 1 ? standingSnapshot(s.racers, s.humans) : [];
    const rank = standings.findIndex(entry => entry.id === racer?.id) + 1;
    const rivals = s && racer ? standings.flatMap((entry, place) => {
      const other = s.racers.find(candidate => candidate.id === entry.id)!;
      if (other === racer) return [];
      return [{ id: entry.id, rank: place + 1, player: entry.player,
        x: other.car.position.x, z: other.car.position.z }];
    }) : [];
    return {
      standing: rank > 0 ? { rank, total: standings.length } : undefined,
      rivals,
      playerCount: s?.world.cameras.length ?? 1,
      playerIndex: index,
      time: race?.time ?? 0,
      score: race?.score ?? 0,
      slimeHits: race?.slimeHits ?? 0,
      scoreAwards: race?.scoreAwards ?? [],
      finished: race?.state === 'finished',
      reducedMotion: !this.motionWanted,
      speedKmh: (racer?.car.speed ?? 0) * 3.6,
      rpm: racer?.car.rpm ?? 900,
      rpmFraction: racer?.car.rpmFraction ?? 0,
      gear: racer?.car.gear ?? 1,
      drive: racer?.car.tuning.drive ?? 'awd',
      checkpoint: race ? gatesPassed(race.state, race.checkpointsCleared, this.gateCount()) : 0,
      checkpoints: this.gateCount(),
      lap: race?.lap ?? 1,
      laps: race?.totalLaps ?? 1,
      wrongWay: race?.state !== 'finished' && (race?.wrongWay ?? false),
      rescueWarning: race?.state !== 'finished' && (race?.rescueWarning ?? false),
      notice: race?.rescueWarning ? this.i18n.t('hud.rescueWarning')
        : race?.state === 'finished' ? this.i18n.t('hud.finishedWaiting')
        : racer && performance.now() < racer.noticeUntil ? racer.notice
        : s && racer?.waitingForRoad ? this.i18n.t(s.world.streamer.stats.failed ? 'hud.retryingRoad' : 'hud.loadingRoad')
        : index === 0 && performance.now() < this.noticeUntil ? this.notice : '',
      alert: this.staleNotice(),
      countdown: this.phase === 'countdown'
        ? (this.countdown > 0 ? String(Math.ceil(this.countdown)) : this.i18n.t('countdown.go'))
        : '',
      device: isMobileDevice() && this.device === 'keyboard' ? 'touch' : this.device,
      touchStick: index === 0 ? this.input.touch.stick : null,
      touchGuide: this.hudTouchGuide(index),
      cameraMode: racer?.chase.cameraMode ?? this.save.all.cameraModes[index] ?? 'chase',
      cameraFeedback: racer?.chase.feedback ?? {
        mode: this.save.all.cameraModes[index] ?? 'chase', speed: 0, boost: 0, shake: 0,
      },
      route: s ? this.mapRoute(s.track) : null,
      view: {
        x: racer?.car.position.x ?? 0, z: racer?.car.position.z ?? 0,
        headingX: racer?.car.forward.x ?? this.headingX, headingZ: racer?.car.forward.z ?? this.headingZ,
        s: race?.progress.value.s ?? 0,
      },
    };
  }

  /** The route as the map wants it, built once per track rather than once per frame. */
  private mapRoute(track: Session['track']): screens.MiniMapRoute {
    const id = raceKey(track.id, this.session?.direction);
    if (this.route?.id !== id || this.route.streets !== this.streets) {
      this.route = {
        id,
        streets: this.streets,
        points: track.spline.points,
        s: track.spline.s,
        checkpoints: track.checkpoints.map((c) => c.s),
        length: track.spline.length,
        closed: track.spline.closed,
      };
    }
    return this.route!;
  }

  // ---------------------------------------------------------------- the loop

  private readonly tick = (now: number): void => {
    this.raf = requestAnimationFrame(this.tick);
    const wallDt = Math.min((now - this.last) / 1000, 0.25);
    const dt = wallDt * this.timeScale;
    this.last = now;
    if (this.landscape.blocked || this.playerHelp.open || this.shareDialog.open || this.replicaDialog.open
      || this.homeShortcut.open) this.input.clearHeld();
    const playerCommands = this.input.readPlayers(dt, this.phase === 'menu' ? this.start.playerCount : this.session?.humans.length ?? 1);
    const commands = playerCommands[0]!;
    this.lastCar = commands.car;
    this.watchTouchSteering(now);
    if (commands.device !== this.device) {
      // Prompts name the buttons of whatever the player is holding, and they are only written when
      // a screen is shown. Picking a track with a finger changes the device after the next screen
      // has already been drawn, so it would still be telling a phone to press Enter.
      this.device = commands.device;
      this.renderPlayerHelp();
      this.views[this.screens.current as ScreenName]?.render();
    }

    if (commands.actions.length) void this.audio.unlock();
    const helpOpen = this.playerHelp.open;
    const shareOpen = this.shareDialog.open;
    const shortcutOpen = this.homeShortcut.open;
    const photoOpen = this.photo.open;
    const replicaOpen = this.replicaDialog.open;
    for (const { action, player } of playerCommands.flatMap((command, player) => command.actions.map(action => ({ action, player })))) {
      if (replicaOpen) {
        if (action === 'back' || action === 'pause') this.replicaDialog.close();
        continue;
      }
      if (shortcutOpen) {
        if (action === 'back' || action === 'pause') this.homeShortcut.close();
        continue;
      }
      if (shareOpen) {
        if (action === 'back' || action === 'pause') this.shareDialog.close();
        continue;
      }
      if (helpOpen) {
        if (action === 'back' || action === 'pause') this.playerHelp.closeHelp();
        continue;
      }
      if (photoOpen) { this.photo.action(action, player); continue; }
      const before = this.phase;
      const menuStep = this.start.node.dataset.step, menuPlayers = this.start.playerCount;
      this.handleAction(action, player);
      if (this.photo.open || this.homeShortcut.open || this.shareDialog.open || this.replicaDialog.open
        || this.playerHelp.open || before !== this.phase || (before === 'menu'
          && (menuStep !== this.start.node.dataset.step || menuPlayers !== this.start.playerCount))) {
        for (const command of playerCommands) { command.car = { ...IDLE }; command.reset = false; }
        break;
      }
    }
    if (!this.photo.open && !this.playerHelp.open && !this.shareDialog.open && !this.replicaDialog.open
      && !this.homeShortcut.open) {
      playerCommands.forEach((command, player) => { if (command.camera) this.cycleCamera(player); });
    }

    const s = this.session;
    const driving = this.phase === 'racing';
    const rolling = !!s && !this.landscape.blocked && (driving || this.phase === 'countdown');
    // Silence behind the pause menu, the results and the map. The engine is only a sound the car
    // makes while the car is a thing that exists -- and outside a race there is no car, which is
    // why this is decided *before* the early return rather than after it. Left inside it, the graph
    // kept idling at menu volume from the first unlock onwards.
    this.audio.setEngineRunning(rolling);
    // The kept home frame belongs to the landing page only; walking on before the scene is back ends it.
    if (this.uiHost.dataset.showcase === 'still' && (this.phase !== 'menu' || !this.start.atHome)) {
      delete this.uiHost.dataset.showcase;
    }
    if (!s) return;
    const measuredQuality = driving || this.showcase ? this.autoQuality?.sample(wallDt) : null;
    if (measuredQuality) {
      this.setSessionQuality(measuredQuality);
      this.autoQuality = null;
    }
    if (rolling) {
      s.world.streamer.updateMany(this.streamingPositions(s));
      const car = s.car;
      let frameImpact = 0;
      let frameScrape = 0;
      const resetPressed = playerCommands.map(player => player.reset);
      // The driver steers inside the fixed step, not once per rendered frame. Per frame it steers
      // as often as the machine happens to draw, so the same route took 118 s on an idle machine
      // and 188 s on a busy one -- the automated driver was measuring the computer, not the track.
      const { steps, alpha } = s.physics.step(dt, (h) => {
        const racingStep = this.phase === 'racing';
        const traffic = racingStep && s.racers.length > 1 && s.racers.some(racer => racer.role === 'ai' || racer.autopilot)
          ? s.racers.flatMap(racer => racer.trafficBodies()) : null;
        applyCatchUp(s.racers, racingStep);
        for (const [index, racer] of s.racers.entries()) {
          const car = racer.car;
          const ready = [car, ...(racer.trailer ? [racer.trailer.car] : [])].every(body => {
            const p = body.position, half = body.tuning.chassisHalf;
            return s.world.streamer.collisionReady(p.x, p.z, Math.hypot(half[0], half[2]) + body.speed * h + 2);
          });
          racer.setRoadReady(ready, racingStep);
          if (!ready) { racer.input = { ...IDLE }; continue; }
          let control = playerCommands[index]?.car ?? IDLE;
          if (racingStep && racer.race.state === 'finished') {
            const parkingTraffic = traffic && racer.parkingPath !== s.world.spline
              ? s.racers.flatMap(other => other.trafficBodies(racer.parkingPath)) : traffic;
            control = racer.parkingInput(parkingTraffic
              ? { own: parkingTraffic.filter(body => body.driver === racer.id), bodies: parkingTraffic } : undefined, h);
            const berth = racer.parkingRescue(s.racers);
            if (berth) {
              s.slimes?.resetCar(car, racer.trailer?.car);
              car.reset(berth.pos, berth.yaw);
              racer.trailer?.syncReset();
              racer.chase.reset();   // a player's parked car is on screen too
              racer.settleInBerth();
              control = racer.parkingInput(undefined, h);   // now holds the berth
            }
          } else if (racingStep && racer.race.state !== 'finished' && (racer.role === 'ai' || racer.autopilot)) {
            const p = car.position, q = car.quaternion;
            const hx = 2 * (q.x * q.z + q.w * q.y);
            const hz = 1 - 2 * (q.x * q.x + q.y * q.y);
            const delivery = racer.race.distanceToStop();
            const finish = racer.race.distanceToFinish();
            const stopAhead = finish === null ? delivery : Math.min(delivery ?? Infinity,
              finish + (racer.role === 'ai' ? PARKING_FIRST_ROW_DISTANCE : FINISH_ROLLOUT_DISTANCE));
            control = racer.bot.drive(h, {
              raceTime: racer.race.time, lap: racer.race.lap,
              x: p.x, z: p.z, speed: car.speed, forwardSpeed: car.forwardSpeed, gripping: car.gripping, weatherGrip: car.weatherGripScale,
              slimeAhead: s.slimes?.distanceToHazard(car, racer.bot.settings.maxScan, racer.trailer?.car),
              headingX: -hx, headingZ: -hz,
              steeringTransitionSpeed: (from, to, distance) => car.steeringTransitionSpeed(from, to, distance),
              steeringInputForCurvature: curvature => car.steeringInputForCurvature(curvature),
              steeringSpeedLimit: (curvature, distance) => car.steeringSpeedLimit(curvature, distance),
            }, racer.race.progress.value, stopAhead, traffic
              ? { own: traffic.filter(body => body.driver === racer.id), bodies: traffic,
                  slimes: racer.role === 'ai' ? s.slimes?.navigationTargets(car) : undefined } : undefined);
          }
          racer.input = racingStep ? { ...control } : { ...IDLE };
          s.slimes?.prepareCar(car, racer.trailer?.car);
          car.update(h, racer.input);
          racer.trailer?.update(h);
          s.slimes?.handleCar(car, racer.input, racer.trailer?.car);
          for (const body of [car, ...(racer.trailer ? [racer.trailer.car] : [])]) {
            const rub = body.scrape;
            if (rub) {
              s.sparks.emit(rub.x, rub.y, rub.z, rub.intensity, body.forward);
              if (racer.role === 'human') frameScrape = Math.max(frameScrape, rub.intensity);
            }
            const hit = body.impactFeedback;
            if (!hit) continue;
            const normal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
            s.sparks.impact(hit.point.x, hit.point.y, hit.point.z, hit.strength, normal, body.forward);
            if (hit.kind === 'vehicle') this.telemetry.vehicleImpacts++;
            else this.telemetry.barrierImpacts++;
            if (hit.strength >= 0.55) this.telemetry.heavyImpacts++; else this.telemetry.lightImpacts++;
            if (racer.role === 'human') {
              frameImpact = Math.max(frameImpact, hit.strength);
              if (this.motionWanted) racer.chase.hit(hit.strength);
            }
          }
        }
        s.world.weatherEffects.step(h, s.racers.flatMap(racer =>
          [racer.car, ...(racer.trailer ? [racer.trailer.car] : [])]));
        s.world.tireMarks.step(h, s.racers.flatMap(racer =>
          [racer.car, ...(racer.trailer ? [racer.trailer.car] : [])]));
      }, 5 * this.timeScale, (h) => {
        // Turbo means more *complete* game steps per rendered frame. Race owns route projection,
        // checkpoints, off-track clocks and reset targets, so it must see every one of those steps
        // after Rapier has produced the step's new position. Updating it before Rapier leaves the
        // bot one whole step behind; updating it once per frame makes all turbo substeps stale.
        s.slimes?.finishPhysicsStep();
        if (this.phase === 'racing') {
          for (const [index, racer] of s.racers.entries()) {
            if (!racer.waitingForRoad || resetPressed[index]) this.advanceRace(racer.waitingForRoad ? 0 : h,
              resetPressed[index] ?? false, racer.car.position, racer.car.quaternion, racer);
            resetPressed[index] = false;
          }
        }
        s.slimes?.update(h);
        for (const racer of s.racers) racer.advancePose();
      });
      // An input edge must not disappear on a display frame too short to produce a physics step.
      if (steps === 0 && driving) for (const [index, racer] of s.racers.entries()) {
        if (resetPressed[index]) this.advanceRace(0, true, racer.car.position, racer.car.quaternion, racer);
      }
      // RenderPose sees Car.poseRevision and collapses both ends around every reset, including a
      // direct QA teleport on a zero-step frame. Otherwise even zero-step frames interpolate.
      const { position: pos } = s.renderPose.sample(car, alpha);
      for (const racer of s.racers) racer.render(alpha, dt);
      for (const [index, lights] of s.world.racerHeadlights.entries()) {
        const racer = s.racers[index]!;
        lights.follow(racer.mesh.position, racer.mesh.quaternion);
      }
      s.world.syncLampCones();
      s.sparks.faceCamera(s.world.camera);
      s.sparks.update(dt);

      this.telemetry.frames++;
      if (!car.grounded) this.telemetry.airborneFrames++;
      if (this.phase === 'countdown') {
        const before = Math.ceil(this.countdown);
        this.countdown -= dt;
        if (Math.ceil(this.countdown) !== before) this.audio.ui(this.countdown > 0 ? 'countdown' : 'go');
        if (this.countdown <= -0.6) {
          if (this.hudTouchGuide(0) === 'countdown') this.save.update({ touchGuideRaces: this.save.all.touchGuideRaces + 1 });
          this.lastTouchSteerAt = performance.now();
          s.racers.forEach(racer => racer.race.start()); this.sampleGhost(true); this.show('racing');
        }
      }
      this.audio.update(dt, {
        speed: s.car.speed, throttle: driving ? s.racers[0]!.input.throttle : 0,
        rpmFraction: s.car.rpmFraction,
        brake: driving ? s.car.braking : 0,
        slip: Math.abs(s.car.slipAngle), grounded: s.car.grounded, impact: frameImpact,
        scrape: frameScrape,
        surface: s.slimes?.surfaceKind,
      });
      if (s.world.sky.update(dt)) this.audio.thunder();
      for (const [index, camera] of s.world.cameras.entries()) {
        const racer = s.humans[index]!;
        const pose = racer.renderPose.sample(racer.car, alpha);
        const velocity = racer.car.body.linvel();
        racer.chase.update(camera, pose.position, pose.quaternion,
          new THREE.Vector3(velocity.x, velocity.y, velocity.z), Math.max(dt, 1 / 240), {
            grounded: racer.car.grounded,
            boost: s.slimes?.driverStats(racer.car).boostActive ?? false,
            reducedMotion: !this.motionWanted,
          });
        s.slimes?.updateCamera(dt, camera, racer.car);
      }
      s.world.follow(s.race.progress.value.s, pos.x, pos.y, pos.z, this.streamingPositions(s));
    }
    // The home page's orbit. No physics runs here -- the world is a set, not a race.
    const show = this.showcase;
    // Stepping into the route pages ends it: the menu's own pages are what the player came for.
    if (show && (this.phase !== 'menu' || !this.start.atHome)) { this.stopShowcase(); return; }
    if (show && this.phase === 'menu') {
      show.angle += dt * SHOWCASE_SPIN;
      const radius = 215, height = 96;
      const camera = s.world.cameras[0]!;
      const eye = new THREE.Vector3(show.centre.x + Math.cos(show.angle) * radius,
        show.centre.y + height, show.centre.z + Math.sin(show.angle) * radius);
      camera.position.copy(eye);
      camera.lookAt(show.centre.x, show.centre.y + 26, show.centre.z);
      camera.updateMatrixWorld();
      show.drawn = true;
      s.world.streamer.updateMany([{ s: s.race.progress.value.s, x: eye.x, z: eye.z }]);
      s.world.follow(s.race.progress.value.s, eye.x, eye.y, eye.z, [{ s: s.race.progress.value.s, x: eye.x, z: eye.z }]);
      s.world.sky.follow(eye.x, eye.y, eye.z);
      s.world.sky.update(dt);
      s.slimes?.update(dt);
      s.slimes?.updateCamera(dt, camera, s.car);
      s.world.syncLampCones();
      // The brief's low-end fallback: a machine that cannot hold the scene goes back to the picture
      // rather than showing a stuttering home page (the phone and reduced-motion cases never start).
      if (measuredQuality === 'low') { this.stopShowcase(); return; }
      if (show.fade < 1) {
        show.fade = Math.min(1, show.fade + dt / .9);
        // One class change, not a style write per frame: the picture's own transition does the blending.
        if (this.uiHost.dataset.showcase !== 'live') this.uiHost.dataset.showcase = 'live';
      }
    }
    this.ghostReplay?.update(this.phase === 'intro' || this.phase === 'countdown' ? -1 : s.race.time);
    this.photo.update();
    // Reduced motion switched on mid-race drops whatever has been recorded so far.
    if (!this.videoWanted() && this.video.recording) this.video.stop();
    if (!this.videoWanted() && this.loopVideo.recording) this.loopVideo.stop();
    // Reduced motion switched on from the pause menu's settings takes the moving backdrop down too.
    if (!this.videoWanted() && this.pauseLoop?.playing) this.pauseLoop.close();
    if (!this.photo.open) s.gates.update(now / 1000);
    // Behind an open share card the world is not redrawn (the canvas keeps its last frame)
    // except for the one frame the card captures. Chrome encodes `toBlob` in the main thread's idle
    // time; a phone redrawing a full field of cars had none, and the card took 4 s to become usable.
    if (!this.shareDialog.open || this.captureNextFrame) this.drawViews(s);
    // The rolling video of the drive itself, watermarked as it is composited.
    if ((driving || this.phase === 'countdown') && this.videoWanted()) {
      if (!this.video.recording) this.video.start();
      this.video.frame(s.world.renderer.domElement, wallDt);
      if (!this.loopVideo.recording) this.loopVideo.start();
      this.loopVideo.frame(s.world.renderer.domElement, wallDt);
    } else {
      this.video.hold(); this.loopVideo.hold();
    }
    if (this.captureNextFrame) {
      const copy = document.createElement('canvas');
      copy.width = s.world.renderer.domElement.width; copy.height = s.world.renderer.domElement.height;
      copy.getContext('2d')!.drawImage(s.world.renderer.domElement, 0, 0);
      const resolve = this.captureNextFrame; this.captureNextFrame = null; resolve(copy);
    }
    if (this.screens.current === 'hud') this.views.hud?.render();
  };

  /** Draws every player's view of the world as it stands: the loop's frame, and the kept home frame. */
  private drawViews(s: Session): void {
    s.world.weatherEffects.render(s.world.renderer, s.world.camera);
    s.slimes?.renderEffects(s.world.renderer);
    s.world.render((index, camera) => {
      const racer = s.humans[index]!;
      const pos = racer.mesh.position;
      s.world.sky.follow(pos.x, pos.y, pos.z);
      s.gates.setCleared(racer.race.checkpointsCleared);
      s.sparks.faceCamera(camera);
      s.slimes?.prepareView(racer.car, s.world.sky.daylight);
      s.world.sky.setGiants(s.slimes?.nearestColossi(camera.position) ?? []);
      return racer.car.speed;
    });
  }

  private streamingPositions(session: Session) {
    return session.racers.flatMap(racer => [racer.car, ...(racer.trailer ? [racer.trailer.car] : [])]
      .map(car => ({ s: racer.race.progress.value.s, x: car.position.x, z: car.position.z })));
  }

  private advanceRace(dt: number, resetPressed: boolean, pos: THREE.Vector3, quat: THREE.Quaternion, s: Racer): boolean {
    if (s.race.state === 'finished') return false;
    const primary = s === this.session!.racers[0];
    const say = (message: string, seconds = 1.5) => {
      s.notice = message; s.noticeUntil = performance.now() + seconds * 1000;
    };
    const heading = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    if (primary) { this.headingX = heading.x; this.headingZ = heading.z; }
    let resetReason: ResetReason = 'unknown';
    let resetDetail: Pick<ResetRecord, 'lateral' | 'halfWidth' | 'speedKmh'> = {};
    const events = s.race.update(dt, {
      x: pos.x, z: pos.z, speed: s.car.speed, waitingForTraffic: (s.role === 'ai' || s.autopilot) && s.bot.waitingForTraffic, headingX: heading.x, headingZ: heading.z,
      tryingToMove: s.role === 'ai' || s.autopilot || s.input.throttle > 0 || (s.input.brake > 0 && !s.input.parkingBrake),
      hardCollision: [s.car, s.trailer?.car].filter(Boolean).some(car => car!.hardContact),
    });
    if (primary) this.sampleGhost(events.some(event => event.type === 'finish'));
    for (const e of events) {
      if (e.type === 'checkpoint') {
        // numbered among the gates the player drives through, so the toast agrees with the HUD:
        // checkpoint 0 is the start, which has no gantry and is cleared before the clock starts
        say(this.i18n.t('hud.checkpoint',
          { index: e.index === 0 ? this.gateCount() : e.index!, total: this.gateCount() }), 1.2);
        if (primary) this.audio.ui('confirm');
        this.session!.gates.setCleared(s.race.checkpointsCleared);
      }
      if (e.type === 'lap') this.session!.gates.setCleared(0);   // a new lap lights them all up again
      if (e.type === 'lap') say(this.i18n.t('hud.lap', { lap: e.lap ?? s.race.lap, total: s.race.totalLaps }));
      if (e.type === 'clean-corner') {
        say(this.i18n.t('hud.cleanCorner', { points: e.points ?? 0 }), 1.8);
        if (s.role === 'human') this.audio.ui('clean-corner');
      }
      if (e.type === 'stop-required') say(this.i18n.t('hud.stopHere'), 1.5);
      if (e.type === 'reset') {
        resetReason = e.resetReason ?? 'unknown';
        resetDetail = {
          lateral: e.lateral, halfWidth: e.halfWidth,
          speedKmh: e.speed === undefined ? undefined : e.speed * 3.6,
        };
      }
      if (primary && e.type === 'checkpoint') this.audio.ui('move');
      if (e.type === 'finish') {
        const humans = this.session!.humans;
        const ending = this.phase === 'racing' && humans.every(racer => racer.race.state === 'finished');
        /* */
        if (!ending) {
          const racers = this.session!.racers;
          const claimed = racers.filter(racer => racer.parkingState !== null).length;
          s.beginParking(Math.max(0, racers.length - 1 - claimed - 1));
        }
        this.audio.ui('finish');
        if (ending) this.finish(humans[0]!.race.time);
        return false;
      }
    }
    // `takeReset()` returns the last safe checkpoint. Snapshot the failure location before taking
    // it, otherwise the diagnostic claims every incident happened at that checkpoint.
    const resetProgress = s.race.progress.value.s;
    if (resetPressed) {
      resetReason = 'manual';
      resetDetail = {};
      s.race.requestReset();
    } else if (s.car.stuckUpsideDown || s.trailer?.car.stuckUpsideDown) {
      resetReason = 'upside-down';
      resetDetail = {};
      s.race.requestReset();
    }
    const requested = s.race.takeReset();
    if (requested?.resetReason) {
      resetReason = requested.resetReason;
      resetDetail = {
        lateral: requested.lateral, halfWidth: requested.halfWidth,
        speedKmh: requested.speed === undefined ? undefined : requested.speed * 3.6,
      };
    }
    const put = requested ? s.clearResetSpot(requested, this.session!.racers) : null;
    if (requested && !put) s.race.requestReset(requested);
    if (put) {
      this.session!.slimes?.resetCar(s.car, s.trailer?.car);
      s.car.reset(put.pos, put.yaw);
      s.trailer?.syncReset();
      s.race.reacquire(put.pos[0], put.pos[2]);
      s.chase.reset();
      s.bot.reset();
      if (resetReason === 'off-track' || resetReason === 'wedged') say(this.i18n.t('hud.reset'), 1.5);
      s.resetLog.push({ reason: resetReason, progress: resetProgress, time: s.race.time, ...resetDetail });
      if (primary) {
        this.telemetry.resets++;
        this.telemetry.resetLog.push({ reason: resetReason, progress: resetProgress, time: s.race.time, ...resetDetail });
      }
    }
    return put !== null;
  }

  private setSessionQuality(quality: Quality): void {
    if (!this.session) return;
    const renderer = this.session.world.renderer;
    this.session.world.setQuality(quality);
    this.session.slimes?.setLimits(this.session.world.qualityLimits);
    // A new renderer starts with no programs; prepare them in this frame rather than one effect at a time later.
    if (this.session.world.renderer !== renderer) this.warmNow(this.session);
  }

  private finish(time: number): void {
    const s = this.session!;
    // Every track is timed and rated since we retired the scenic/campus split.
    const humans = s.humans;
    const single = humans.length === 1;
    const key = raceKey(s.track.id, s.direction);
    // Best time, stars and ghost belong to the route in this car; the AI pace stays the route's.
    const record = recordKey(key, humans[0]!.vehicle.id);
    const previous = single ? this.save.best(record) : null;
    const hadGhost = single && !!this.save.ghost(record);
    const isBest = single ? this.save.record(record, time, this.ghostRecorder?.finish(time) ?? null) : false;
    if (isBest) this.loadGhostReplay(s);
    const ghostNext = single && this.save.all.showGhost && !hadGhost && !!this.save.ghost(record);
    const ratings = humans.map(racer => {
      const rating = raceRating(racer.race.spline.length * racer.race.totalLaps, racer.race.time, racer.race.ratingScore,
        aiReferenceSeconds(key, racer.vehicle, racer.race.spline, racer.race.track));
      return { rating, impactKinds: {...racer.race.impactKinds}, sections: racer.race.sections.map(section => ({...section})),
        cleanCorners: racer.race.cleanCorners, maxCombo: racer.race.maxCombo,
        bestRating: this.save.recordRating(recordKey(key, racer.vehicle.id), rating) };
    });
    // Two drivers in the same car share one record; each card shows it after both have been filed.
    ratings.forEach((rating, index) => { rating.bestRating = this.save.all.ratings[recordKey(key, humans[index]!.vehicle.id)]!; });
    const standings = standingSnapshot(s.racers, humans);
    // A solo run is both an answer to the challenge it came in on, if it was this route, and a new one.
    const dare = single && this.challenge?.trackId === s.track.id && this.challenge.direction === s.direction ? this.challenge : null;
    const code = single ? encodeChallenge({ trackId: s.track.id, direction: s.direction, time,
      rating: ratings[0]!.rating, score: s.race.score, vehicleId: humans[0]!.vehicle.id,
      ...(this.save.all.names[0] ? { name: this.save.all.names[0] } : {}) }) : null;
    const newAchievements = this.save.recordFinish(humans.some(racer => (racer.resetLog?.length ?? 0) === 0));
    this.lastResult = { ...ratings[0], trackId: s.track.id, direction: s.direction, time, best: previous, isBest,
      reducedMotion: !this.motionWanted,
      score: s.race.score, slimeHits: s.race.slimeHits,
      achievements: [...this.save.all.achievements], newAchievements,
      standings, ghostNext,
      ...(this.clipSeconds ? { clipSeconds: this.clipSeconds } : {}),
      ...(single && this.save.all.names[0] ? { name: this.save.all.names[0] } : {}),
      ...(dare ? { challenge: { time: dare.time, rating: dare.rating, score: dare.score, ...(dare.name ? { name: dare.name } : {}),
        ...(dare.vehicleId ? { vehicleId: dare.vehicleId } : {}) } } : {}),
      ...(code ? { challengeCode: code, challengeUrl: challengeUrl(), challengeVehicleId: humans[0]!.vehicle.id } : {}),
      ...(single ? {} : { players: humans.map((racer, index) => ({ ...ratings[index], time: racer.race.time,
        score: racer.race.score, slimeHits: racer.race.slimeHits,
        ...(this.save.all.names[index] ? { name: this.save.all.names[index] } : {}) })) }) };
    this.resultList.setItems([
      { id: 'retry', label: this.i18n.t('results.retry') },
      { id: 'share', label: this.i18n.t('results.share') },
      { id: 'text', label: this.i18n.t('results.text') },
      ...(this.clipSeconds ? [{ id: 'clip', label: this.i18n.t('clip.save', { seconds: Math.floor(this.clipSeconds) }) }] : []),
      { id: 'quit', label: this.i18n.t('results.quit') },
    ]);
    this.start.render();
    this.show('results');
  }

  private handleAction(action: string, player = 0): void {
    if (this.landscape.blocked) return;
    // Escape and Start both mean "get me out of here": pause in a race, back out of anything else.
    if (action === 'pause' && (this.phase === 'intro' || this.phase === 'countdown')) {
      this.show('paused'); return;
    }
    if (action === 'pause' && this.phase !== 'racing' && this.phase !== 'paused') action = 'back';
    switch (this.phase) {
      case 'boot':
        // Not on the way into the game: there is nothing behind the opening, and quitting it
        // skipped the scene and dropped the player on the still home page -- somewhere, but not back.
        if (action === 'back' && !this.showcaseOpening) this.quit();
        return;
      case 'menu': {
        // The opening screen owns three steps and a map, so it answers actions itself rather than
        // through `applyAction`: "right" means the next step there, not the next item.
        if (this.start.handle(action as never, player)) {
          this.audio.ui(action === 'confirm' ? 'confirm' : action === 'back' ? 'back' : 'move');
        }
        return;
      }
      case 'intro':
        if (action === 'confirm') this.beginCountdown();
        if (action === 'back') this.quit();
        return;
      case 'racing':
        if (action === 'pause') { this.views.pause?.render(); this.show('paused'); }
        return;
      case 'paused': {
        if (action === 'pause') { this.show(this.resumePhase); return; }
        const outcome = applyAction(this.pauseList, action as never);
        if (outcome === 'confirm' && this.pauseList.current) this.pickPause(this.pauseList.current);
        else if (outcome === 'back') this.show(this.resumePhase);
        if (outcome) this.views.pause?.render();
        return;
      }
      case 'results': {
        const outcome = applyAction(this.resultList, action as never);
        if (outcome === 'confirm' && this.resultList.current) this.pickResult(this.resultList.current);
        if (outcome) this.views.results?.render();
        return;
      }
      case 'settings': {
        const outcome = applyAction(this.settingsList, action as never);
        if (outcome === 'confirm' && this.settingsList.current) this.pickSetting(this.settingsList.current);
        else if (outcome === 'back') this.show(this.returnTo);
        if (outcome) this.views.settings?.render();
        return;
      }
      case 'about':
        if (action === 'confirm' || action === 'back') this.show(this.returnTo);
        return;
      default:
        return;
    }
  }

  /** Everything an automated run needs to judge itself. Read from the page by the browser test. */
  report(): GameReport {
    const s = this.session;
    return {
      ghost: { visible: this.ghostReplay?.visible ?? false, samples: this.ghostRecorder?.frames.length ?? 0, storedBytes: JSON.stringify(this.save.all.ghosts).length },
      phase: this.phase,
      track: s?.track.id ?? null,
      direction: s?.direction ?? 'forward',
      state: s?.race.state ?? null,
      time: s?.race.time ?? 0,
      score: s?.race.score ?? 0,
      slimeHits: s?.race.slimeHits ?? 0,
      progress: s?.race.progress.value.s ?? 0,
      length: s?.track.spline.length ?? 0,
      lap: s?.race.lap ?? 0,
      laps: s?.race.totalLaps ?? 0,
      checkpoints: s?.race.checkpointsCleared ?? 0,
      totalCheckpoints: s?.track.checkpoints.length ?? 0,
      speedKmh: (s?.car.speed ?? 0) * 3.6,
      // the last thing the player asked for, so an automated run can tell "the control did nothing"
      // apart from "the car ignored it"
      input: { ...this.lastCar, device: this.device },
      stuck: s?.bot.stuck ?? false,
      // heading and rail contact, so a test can ask "did the wall turn the car" directly
      headingX: this.headingX, headingZ: this.headingZ,
      scraping: !!s?.car.scrape,
      posX: s?.car.position.x ?? 0, posZ: s?.car.position.z ?? 0, posY: s?.car.position.y ?? 0,
      tiles: s?.world.streamer.stats ?? null,
      textures: s ? s.world.materials.texturedCount : null,
      choice: this.choice,
      vehicle: s?.vehicle.id ?? null,
      trailer: s?.trailer ? { hitchGap: s.trailer.hitchGap, upright: s.trailer.car.upright } : null,
      resets: this.telemetry.resets,
      resetLog: this.telemetry.resetLog,
      airbornePct: this.telemetry.frames ? (this.telemetry.airborneFrames / this.telemetry.frames) * 100 : 0,
      frames: this.telemetry.frames,
      collisionFeedback: { vehicleImpacts: this.telemetry.vehicleImpacts,
        barrierImpacts: this.telemetry.barrierImpacts,
        lightImpacts: this.telemetry.lightImpacts, heavyImpacts: this.telemetry.heavyImpacts,
        cameraKicks: s?.humans.reduce((sum, racer) => sum + racer.chase.hits, 0) ?? 0,
        impactSounds: this.audio.impactSoundCount, sparkBursts: s?.sparks.impacts ?? 0,
        activeSparks: s?.sparks.live ?? 0 },
      renderQuality: s?.world.currentQuality ?? null,
      qualityLimits: s?.world.qualityLimits ?? null,
      sky: s?.world.sky.stats ?? null,
      thunderSounds: this.audio.thunderSoundCount,
      weatherSound: this.audio.weatherSound,
      weatherGrip: s?.car.weatherGripScale ?? 1,
      tireMarks: s?.world.tireMarks.stats() ?? null,
      vehicleLights: s?.world.racerHeadlights.map(lights => ({ configured: lights.configuredCount,
        pools: lights.poolCount })) ?? [],
      slimes: s?.slimes?.stats ?? null,
      surface: s?.slimes?.surfaceKind ?? 'dry',
      players: s?.racers.map(racer => ({ id: racer.id, role: racer.role, input: racer.input, autopilot: racer.autopilot, waitingForRoad: racer.waitingForRoad, state: racer.race.state, time: racer.race.time,
        checkpoints: racer.race.checkpointsCleared, score: racer.race.score, resets: racer.resetLog,
        trafficWaiting: racer.bot.waitingForTraffic, trafficFollowing: racer.bot.trafficFollowing,
        parking: racer.parkingState,
        cameraMode: racer.chase.cameraMode, cameraFeedback: racer.chase.feedback,
        x: racer.car.position.x, z: racer.car.position.z, speedKmh: racer.car.speed * 3.6 })) ?? [],
    };
  }

  /**
   * Drive a track without a player: the automated run, and the way every screenshot is taken.
   *
   * `timeOfDay` is here because the player picks it now and the track's own value is only
   * a default. Appearance work is judged in daylight and the two night routes would otherwise only
   * ever be judged in the dark; `?track=goldengate&bot=1&time=day` is how a picture of them gets
   * taken. It changes the time and nothing else -- the car stays the track's own.
   */
  async autoRun(trackId: string, timeOfDay?: TimeOfDay, vehicleId?: string,
    direction: RaceDirection = 'forward', weather: Weather = 'clear'): Promise<void> {
    // Like startRace: the opening's scene may still be loading, and it must not keep this race's
    // boot screen in its "preparing the game" mode or put the menu back if this load fails.
    this.abandonShowcase();
    this.autopilot = true;
    this.choice = null;
    this.forcedTime = timeOfDay ?? null;
    this.forcedWeather = weather;
    if (await this.load(trackId, vehicleId, undefined, false, 'rush', direction)) this.beginCountdown();
  }

  /** A shared link straight to a route: the opening gives way, as it does to a race started from the menu. */
  async openLinkedTrack(trackId: string): Promise<boolean> {
    this.abandonShowcase();
    this.forcedTime = null;
    this.forcedWeather = null;
    return this.load(trackId);
  }

  /** Explicit player choices persist; bot/URL overrides never enter the save. */
  async startRace(choice: RaceChoice, departImmediately = false): Promise<boolean> {
    // Also cancels a showcase still loading: without this its quiet flag would rob this race of its
    // boot screen, its progress and its retry button (the old bug: pressing go did nothing visible).
    this.abandonShowcase();
    void this.audio.unlock();
    this.autopilot = false;
    this.forcedTime = null;
    this.forcedWeather = null;
    const difficulty = aiDifficulty(choice.aiDifficulty ?? this.save.all.aiDifficulty);
    const weather = choice.weather ?? this.save.all.weather;
    const vehicles = choice.playerVehicles?.length ? [...choice.playerVehicles]
      : choice.vehicleId ? [choice.vehicleId] : [];
    this.save.update({ slimeDensity: choice.slimeDensity, aiDifficulty: difficulty,
      weather,
      ...(choice.timeOfDay ? { timeOfDay: choice.timeOfDay } : {}) });
    if (choice.vehicleId) this.save.rememberVehicle(choice.trackId, choice.vehicleId);
    const timeOfDay = choice.timeOfDay ?? this.save.all.timeOfDay ?? undefined;
    if (timeOfDay && vehicles.length) this.save.rememberRace({ trackId: choice.trackId,
      direction: choice.direction ?? 'forward', playerVehicles: vehicles,
      playerCount: vehicles.length > 1 ? 2 : 1, timeOfDay, weather,
      slimeDensity: choice.slimeDensity,
      ai: choice.ai ?? false, aiDifficulty: difficulty });
    this.choice = { direction: choice.direction ?? 'forward', car: choice.car, vehicleId: choice.vehicleId,
      slimeDensity: choice.slimeDensity, timeOfDay, weather,
      ai: choice.ai ?? false, aiDifficulty: difficulty,
      playerVehicles: choice.playerVehicles };
    const loaded = await this.load(choice.trackId, choice.playerVehicles?.[0], choice.playerVehicles,
      choice.ai ?? false, difficulty);
    if (loaded && departImmediately) this.beginCountdown();
    return loaded;
  }

  dispose(): void {
    this.views.settings?.dispose?.();
    this.pause.dispose();
    this.results.dispose();
    this.replicaDialog.dispose();
    this.photo.dispose();
    this.homeShortcut.dispose();
    this.shareDialog.dispose();
    this.playerHelp.dispose();
    this.start.dispose();
    this.loadAbort?.abort();
    cancelAnimationFrame(this.raf);
    this.input.detach();
    this.uiHost.removeEventListener('click', this.onUiClick);
    for (const type of ['pointerdown', 'keydown', 'touchend'] as const) window.removeEventListener(type, this.onGesture, true);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.landscape.dispose();
    this.audio.dispose();
    this.teardown();
  }
}

/** The route the home page orbits: the default track, whose tiles are wanted anyway. */
const SHOWCASE_TRACK = 'goldengate';
/** Every tile, whatever the camera is near or the car has driven past. */
const WHOLE_ROUTE = { behind: Infinity, ahead: Infinity, radius: Infinity, hysteresis: Infinity } as const;
/** Where along that route the camera circles: the tower end of the span, not the woods at the start. */
const SHOWCASE_AT = .22;
/** The kept home frame is shown for a second or two; a 4K canvas's worth of pixels would buy nothing. */
const SHOWCASE_STILL_WIDTH = 1920;
const IDLE = { throttle: 0, brake: 0, steer: 0 };
