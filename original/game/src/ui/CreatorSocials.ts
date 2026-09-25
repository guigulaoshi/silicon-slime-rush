import { creatorProfileUrl, PLANNED_GAME_URL } from '../app/Publication';
import type { Manifest } from '../world/Billboards';
declare const __BILLBOARD_MANIFEST__: Manifest;

export interface CreatorSocial { id: string; url: string }

/**
 * The creator's accounts the About page lists: every address on his itch.io profile on
 *Where a roadside billboard already leads to the profile, the billboard manifest owns
 * that address and it is read from there; the Douyin and Xiaohongshu boards lead to a video and a
 * short link instead, so those two profile pages are written here. The itch.io profile is the renamed
 * one waits on, derived from the planned game page. An account whose
 * address is missing is left off rather than linked to nowhere.
 */
export function creatorSocials(manifest: Manifest = __BILLBOARD_MANIFEST__): CreatorSocial[] {
  const board = (platform: string) =>
    manifest.faces.find(face => face.kind === 'social' && face.en.platform === platform)?.en.target ?? '';
  return [
    {id: 'itch', url: creatorProfileUrl(PLANNED_GAME_URL)!},
    {id: 'youtube', url: board('youtube')},
    {id: 'x', url: board('x')},
    {id: 'tiktok', url: board('tiktok')},
    {id: 'github', url: 'https://github.com/guigulaoshi'},
    {id: 'douyin', url: 'https://www.douyin.com/user/MS4wLjABAAAAmWbEAlX8SvUu3RUFu48ArUSOqK9-2cTOC78Byiqe0GY'},
    {id: 'bilibili', url: board('bilibili')},
    {id: 'xiaohongshu', url: 'https://www.xiaohongshu.com/user/profile/6090be480000000001005d88'},
  ].filter(social => social.url.startsWith('https://'));
}
