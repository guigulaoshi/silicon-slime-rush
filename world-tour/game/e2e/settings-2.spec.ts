import {expect,test} from '@playwright/test';

test('settings apply every saved control, preserve pause, and restore after reload',async({page})=>{
  await page.goto('/?dev=1');await page.waitForFunction(()=>window.game);
  await page.evaluate(()=>window.game.startRace({trackId:'synth-loop',car:'sedan',playerVehicles:['micro-hatch','city-pod'],slimeDensity:'none',ai:false}));
  await page.locator('[data-screen=intro] .departure-go').click();await page.waitForFunction(()=>window.game.report().phase==='racing');
  await page.keyboard.press('Escape');await page.locator('[data-screen=pause] [data-action=settings]').click();
  const screen=page.locator('[data-screen=settings]');
  await page.setViewportSize({width:844,height:390});
  await expect(screen).toHaveAttribute('data-device','mobile');
  const done=await screen.locator('[data-setting=back]').boundingBox();
  expect(done!.y+done!.height).toBeLessThanOrEqual(390);
  await screen.locator('[data-setting=back]').click({trial:true});
  const slider=async(id:string,value:number)=>screen.locator(`[data-setting=${id}]`).evaluate((el,value)=>{(el as HTMLInputElement).value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);
  await slider('musicVolume',37);await slider('effectsVolume',62);await slider('volume',0);
  expect(await page.evaluate(()=>(window.game as any).audio.muted)).toBe(true);
  await slider('volume',81);
  expect(await page.evaluate(()=>{const a=(window.game as any).audio;return[a.musicLevel,a.effectsLevel,a.volume,a.muted];})).toEqual([.37,.62,.81,false]);
  for(const quality of ['low','medium','high','auto']){
    await screen.locator('[data-setting=quality]').selectOption(quality);
    expect(await page.evaluate(()=>(window.game as any).session.world.quality)).toBe(quality==='auto'?'high':quality);
  }
  await screen.locator('[data-setting=camera]').selectOption('hood');await screen.locator('[data-setting=camera2]').selectOption('close');
  expect(await page.evaluate(()=>window.game.report().players.map(p=>p.cameraMode))).toEqual(['hood','close']);
  await screen.locator('[data-setting=reducedMotion]').selectOption('on');await expect(page.locator('html')).toHaveAttribute('data-reduced-motion','true');
  await screen.locator('[data-setting=language]').selectOption('zh');await expect(page.locator('html')).toHaveAttribute('lang','zh');
  await screen.locator('[data-setting=help]').click();await expect(page.locator('.driving-help')).toBeVisible();
  await page.locator('.driving-help .settings-help').click();expect(await page.evaluate(()=>window.game.report().phase)).toBe('settings');
  await screen.locator('[data-setting=shortcut]').click();await expect(page.locator('.shortcut-dialog')).toBeVisible();
  await page.locator('.shortcut-dialog button').last().click();expect(await page.evaluate(()=>window.game.report().phase)).toBe('settings');
  await screen.locator('[data-setting=back]').click();expect(await page.evaluate(()=>window.game.report().phase)).toBe('paused');
  await page.keyboard.press('Escape');await expect.poll(()=>page.evaluate(()=>window.game.report().phase)).toBe('racing');
  await page.reload();await page.waitForFunction(()=>window.game);
  expect(await page.evaluate(()=>(window.game as any).save.all)).toMatchObject({musicVolume:.37,effectsVolume:.62,volume:.81,muted:false,quality:'auto',cameraModes:['hood','close'],reducedMotion:true,language:'zh'});
  await page.locator('.home-go').click();await page.locator('.sm-link').first().click();
  await screen.locator('.modal-header button').click({trial:true});
  await expect(screen.locator('[data-setting=musicVolume]')).toHaveValue('37');await expect(screen.locator('[data-setting=effectsVolume]')).toHaveValue('62');
  await screen.locator('[data-setting=help]').click();await page.locator('.driving-help .modal-header button').click();
  await screen.locator('[data-setting=back]').click();expect(await page.evaluate(()=>window.game.report().phase)).toBe('menu');
});
