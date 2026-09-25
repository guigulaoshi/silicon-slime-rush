import { evidencePath } from './evidence';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect,test} from '@playwright/test';
const catalogue = JSON.parse(readFileSync(
  new URL('../src/vehicles/catalogue.json', import.meta.url), 'utf8')) as { vehicles: unknown[] };
test.describe.configure({timeout:180_000});
const out=evidencePath('performance');
for(const lang of ['en','zh'])test(`captures ${lang} speed units`,async({page})=>{
 await page.addInitScript(language=>localStorage.setItem('silicon-rush.save.v1',JSON.stringify({version:2,language,quality:'high',volume:0,muted:true,slimeDensity:'none',best:{}})),lang);
 await page.goto('/'); await page.locator('.home-go').click();await expect(page.locator('.sm-go')).toBeEnabled();
 await page.locator('.sm-go').click();await page.locator('.sm-go').click();
 await page.waitForFunction(()=>{const p=document.querySelectorAll('.sm-pane')[2] as HTMLElement,v=document.querySelector('.sm-viewport') as HTMLElement;return p&&v&&Math.abs(p.getBoundingClientRect().left-v.getBoundingClientRect().left)<1;});
 const unit=lang==='en'?'mph':'km/h';
 expect(await page.locator('.sm-cardesc').allTextContents()).toHaveLength(catalogue.vehicles.length);
 for(const value of await page.locator('.sm-cardesc').allTextContents())expect(value).toContain(unit);
 await expect(page.locator('.sm-barval').first()).toContainText(unit);
 mkdirSync(out,{recursive:true});await page.screenshot({path:resolve(out,`${lang}-garage.png`)});
 await page.goto('/?track=goldengate&bot=1&time=day&vehicle=micro-hatch');
 await page.waitForFunction(()=>window.game?.report().phase==='racing'&&window.game.report().speedKmh>150);
 await expect(page.locator('.hud-speed')).toContainText(unit);
 const sample=await page.evaluate(language=>({speedKmh:window.game.report().speedKmh,display:document.querySelector('.hud-speed')!.textContent, expected:Math.round(window.game.report().speedKmh/(language==='en'?1.609344:1))}),lang);
 expect(Number(sample.display!.match(/[\d.]+/)![0])).toBe(sample.expected);
 await page.screenshot({path:resolve(out,`${lang}-driving.png`)});
 writeFileSync(resolve(out,`${lang}.json`),JSON.stringify(sample,null,2));
});
