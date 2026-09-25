import { el, type MenuItem, type MenuList } from './Ui';
import { actionIcon, fitReplica, replicaButton } from './Replica';
import type { I18n } from './i18n';
import { MAX_PLAYER_NAME } from '../app/playerName';
import { isMobileDevice } from '../app/device';
import type { Screen, SettingsState } from './screens';

export interface SettingsScreen extends Screen { dispose(): void }
export function settingsScreen(t: I18n, state: () => SettingsState, list: MenuList,
  onPick: (item: MenuItem, value?: string | number) => void): SettingsScreen {
  const node=el('div','replica settings-replica'),frame=el('div','replica-frame'),overlay=el('div','extra-modal');
  overlay.dataset.menu='settings';
  const shell=el('section','modal-shell'),header=el('div','modal-header'),title=el('h2');
  const close=replicaButton('×',undefined,'modal-close');
  header.append(title,close);
  const preferences=el('div','preferences'),controls=new Map<string,HTMLInputElement|HTMLSelectElement>();
  const labels=new Map<string,HTMLElement>(),rows=new Map<string,HTMLElement>();
  const choose=(id:string,value?:string|number) => {list.select(id);onPick({id,label:labels.get(id)?.textContent??''},value);};
  function row(id:string,icon:string,range=false,freeText=false) {
    const row=el('label','pref-row'),label=el('span'),text=el('span');label.append(actionIcon(icon),text);row.append(label);
    const control=document.createElement(range||freeText?'input':'select');control.dataset.setting=id;
    if(control instanceof HTMLInputElement&&freeText){
      // An optional nickname, stored cleaned when the field is left or Enter is pressed.
      control.type='text';control.maxLength=MAX_PLAYER_NAME*2;control.autocomplete='off';control.spellcheck=false;control.className='pref-name';
      row.append(control);control.onchange=()=>choose(id,control.value);
    } else if(control instanceof HTMLInputElement){control.type='range';control.min='0';control.max='100';control.step='1';
      row.append(control,el('output'));control.oninput=()=>choose(id,Number(control.value)/100);
    } else {row.append(control);control.onchange=()=>choose(id,control.value);}
    control.addEventListener('keydown',e=>{const key=e as KeyboardEvent;if(key.code!=='Escape'&&key.code!=='Tab')key.stopPropagation();});
    controls.set(id,control);labels.set(id,text);rows.set(id,row);preferences.append(row);
  }
  row('musicVolume','music',true);row('effectsVolume','volume',true);row('quality','monitor');row('language','languages');row('reducedMotion','sparkles');row('showGhost','ghost');
  row('volume','volume',true);row('camera','camera');row('camera2','camera');
  row('name','user',false,true);row('name2','user',false,true);
  const shortcut=replicaButton('','external','modal-secondary settings-shortcut');shortcut.dataset.setting='shortcut';shortcut.onclick=()=>choose('shortcut');preferences.append(shortcut);
  const help=replicaButton('','help','modal-secondary settings-help');help.dataset.setting='help';help.onclick=()=>choose('help');
  const footer=el('div','settings-bottom'),saved=el('span'),done=replicaButton('','check','extra-primary');done.dataset.setting='back';
  // The share card lives on the pause screen now.
  done.onclick=close.onclick=()=>choose('back');footer.append(saved,done);
  shell.append(header,preferences,help,footer);overlay.append(shell);frame.append(overlay);node.append(frame);
  for(const control of node.querySelectorAll<HTMLElement>('[data-setting]'))control.onfocus=()=>list.select(control.dataset.setting!);
  close.onfocus=()=>list.select('back');
  const unfit=fitReplica(node,frame);
  let selectedId: string | undefined;
  function options(id:string,values:readonly string[],label:(value:string)=>string,value:string) {
    const select=controls.get(id) as HTMLSelectElement;
    if(select.options.length!==values.length)select.replaceChildren(...values.map(v=>new Option('',v)));
    for(const option of select.options)option.textContent=label(option.value);
    select.value=value;
  }
  function render(){const s=state();title.textContent=t.t('replica.settingsTitle');close.setAttribute('aria-label',t.t('share.close'));
    for(const [id,label] of labels)label.textContent=t.t(id==='camera'&&s.playerCount>1?'settings.camera1':`settings.${id}`);
    labels.get('musicVolume')!.textContent=t.t('replica.music');labels.get('effectsVolume')!.textContent=t.t('replica.effects');
    labels.get('quality')!.textContent=t.t('replica.graphics');
    options('quality',['auto','high','medium','low'],v=>t.t(`settings.quality.${v}`),s.quality);
    options('language',['zh','en'],v=>v==='zh'?'中文':'English',s.language);
    options('reducedMotion',['system','on'],v=>t.t(v==='on'?'settings.on':'replica.followDevice'),s.reducedMotion?'on':'system');
    options('showGhost',['on','off'],v=>t.t(`settings.${v}`),s.showGhost===false?'off':'on');
    for(const [index,id] of ['camera','camera2'].entries())options(id,['chase','close','hood'],v=>t.t(`camera.${v}`),s.cameraModes[index]??'chase');
    rows.get('camera2')!.hidden=s.playerCount<2;
    // Two nicknames on a desktop, where two can share the keyboard; a phone only ever has one driver.
    rows.get('name2')!.hidden=isMobileDevice();
    labels.get('name')!.textContent=t.t(isMobileDevice()?'settings.nameSolo':'settings.name');
    for(const [index,id] of ['name','name2'].entries()){const input=controls.get(id) as HTMLInputElement;
      input.placeholder=t.t('settings.namePlaceholder');if(document.activeElement!==input)input.value=s.names?.[index]??'';}
    for(const id of ['musicVolume','effectsVolume','volume'] as const){const control=controls.get(id)!;control.value=String(Math.round(s[id]*100));
      rows.get(id)!.querySelector('output')!.textContent=id==='volume'&&s.muted?t.t('settings.muted'):`${control.value}%`;}
    for(const [button,key] of [[help,'replica.controls'],[shortcut,'shortcut.title'],[done,'replica.done']] as const)button.querySelector('span')!.textContent=t.t(key);
    saved.textContent=t.t('replica.settingsSaved');
    const ids=[...controls.keys()].filter(id=>!rows.get(id)!.hidden).concat('shortcut','help','back');
    list.setItems(ids.map(id=>({id,label:labels.get(id)?.textContent??t.t(id==='back'?'replica.done':`${id}.title`)})));
    for(const control of node.querySelectorAll<HTMLElement>('[data-setting]'))control.setAttribute('aria-selected',String(control.dataset.setting===list.current?.id));
    if(selectedId!==list.current?.id && node.contains(document.activeElement))node.querySelector<HTMLElement>(`[data-setting="${list.current?.id}"]`)?.focus();
    selectedId=list.current?.id;
  }
  return {node,render,dispose(){unfit();node.remove();}};
}
