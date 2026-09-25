import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {evidencePath} from './evidence';
import {driveBudgetGameSeconds} from './driveBudget';

test.describe.configure({timeout:600_000});

// Capture the finish-card background after a complete drive, without moving the car or camera.
test('fishermans-wharf actual finish background', async ({page}) => {
 const out=evidencePath('endpoints/after');mkdirSync(out,{recursive:true});
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/?track=fishermans-wharf&bot=1&dev=1&speed=6');
 await page.waitForFunction(()=>window.game?.report().phase==='racing');
 const first=await page.evaluate(()=>window.game.report());
 const budget=driveBudgetGameSeconds(first.length,first.laps);
 await page.waitForFunction(budget=>{
  const r=window.game.report();return r.phase==='results'||r.time>budget;
 },budget,{timeout:540_000});
 const report=await page.evaluate(()=>window.game.report());
 writeFileSync(resolve(out,'fishermans-wharf-drive.json'),JSON.stringify(report,null,2));
 expect(report.state).toBe('finished');expect(report.resets).toBe(0);expect(report.tiles?.failed).toBe(0);
 expect(errors).toEqual([]);
 await expect(page.locator('[data-screen=results]')).toBeVisible();
 await page.screenshot({path:resolve(out,'fishermans-wharf-results.png')});
});
