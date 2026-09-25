import type { I18n } from './i18n';
import { el } from './Ui';
import { actionIcon, fitReplica, replicaButton } from './Replica';
import { steersWithButtons } from '../app/device';

/** Persistent language access and optional instructions; never advances a race. */
export class PlayerHelp {
  readonly node = el('nav', 'player-tools');
  readonly tip = el('aside', 'first-drive-tip');
  private readonly language = el('button') as HTMLButtonElement;
  private readonly help = el('button') as HTMLButtonElement;
  private readonly dialog = document.createElement('dialog');
  private readonly title = el('h2');
  private readonly instructions = el('dl','control-list');
  private readonly intro = el('div','help-intro');
  private readonly extra = document.createElement('details');
  private readonly close = replicaButton('×',undefined,'modal-close');
  private readonly back = replicaButton('','back','modal-secondary settings-help');
  private readonly tipText = el('span');
  private readonly dismiss = el('button') as HTMLButtonElement;
  private readonly unfit: () => void;

  constructor(private readonly i18n: I18n, onLanguage: () => void, onDismiss: () => void,
    onSettings: () => void = () => {}) {
    this.language.onclick = onLanguage; this.help.onclick = () => this.showHelp();
    this.close.onclick = () => this.closeHelp(); this.back.onclick = () => {this.closeHelp();onSettings();};
    this.dialog.className = 'driving-help replica replica-dialog';
    this.dialog.setAttribute('aria-labelledby', 'driving-help-title'); this.title.id = 'driving-help-title';
    const frame=el('div','replica-frame'),overlay=el('div','extra-modal'),shell=el('section','modal-shell'),header=el('div','modal-header');
    overlay.dataset.menu='help';header.append(this.title,this.close);this.extra.className='help-more';
    shell.append(header,this.intro,this.instructions,this.extra,this.back);overlay.append(shell);frame.append(overlay);this.dialog.append(frame);
    document.body.append(this.dialog);this.unfit=fitReplica(this.dialog,frame);
    this.node.append(this.language, this.help);
    this.dismiss.onclick = onDismiss;this.tip.append(this.tipText, this.dismiss);
    for (const node of [this.node, this.tip,this.dialog]) node.addEventListener('keydown', e => {
      if (e.code !== 'Tab') e.stopPropagation();
    });
  }

  render(phase: string, dual: boolean, touch: boolean, dismissed: boolean): void {
    const t = this.i18n;
    /* */
    const driving = phase === 'racing' || phase === 'countdown';
    this.node.hidden = driving;
    this.language.textContent = t.lang === 'zh' ? 'English' : '中文';
    this.language.setAttribute('aria-label', t.t('settings.language'));
    this.help.textContent = t.t('help.title');
    this.help.hidden = driving || phase === 'boot';
    this.title.textContent = t.t('replica.controls');this.close.setAttribute('aria-label',t.t('share.close'));
    this.intro.replaceChildren(actionIcon(touch?'phone':'keyboard'),document.createTextNode(t.t(touch?'replica.touchIntro':'replica.keyboardIntro')));
    const holdSteer=touch&&steersWithButtons();   // IPhone and iPad steer with two hold buttons
    const touchKeys=holdSteer?'controls.touchButtons':'controls.touch';
    const rows=touch ? [['replica.steer',holdSteer?'replica.touchSteerButtons':'replica.touchSteer'],['replica.brake','replica.touchBrake'],['replica.rescue','replica.touchRescue'],['replica.pause','replica.touchPause']]
      : [['replica.playerOne','W A S D · R '+t.t('replica.rescueKey')],['replica.playerTwo','↑ ↓ ← → · / '+t.t('replica.rescueKey')],['replica.brake','S / ↓'],['replica.pause','Esc']];
    this.instructions.replaceChildren(...rows.map(([label,text])=>{const row=el('div');row.append(el('dt','',t.t(label!)),el('dd','',touch?t.t(text!):text));return row;}));
    const summary=el('summary','',t.t('replica.moreControls'));
    this.extra.replaceChildren(summary,...(touch?[touchKeys]:['controls.keyboard','controls.gamepad','controls.player2']).map(key=>el('p','',t.t(key))),el('p','',t.t('help.restart')));
    this.back.querySelector('span')!.textContent=t.t('replica.backSettings');
    const keys = touch ? [touchKeys] : dual ? ['controls.player1', 'controls.player2'] : ['controls.keyboard', 'controls.gamepad'];
    // Phones are taught by the always-drawn stick and the countdown hint instead.
    this.tip.hidden = phase !== 'intro' || dismissed || touch;
    this.tipText.textContent = keys.map(key => t.t(key)).join(' · ');
    this.dismiss.textContent = t.t('help.dismiss');
  }
  closeHelp(): void { this.dialog.close(); }
  showHelp(): void { if (!this.dialog.open) this.dialog.showModal();this.close.focus(); }
  get open(): boolean { return this.dialog.open; }
  dispose(): void { this.dialog.close();this.unfit();this.dialog.remove();this.node.remove();this.tip.remove(); }
}
