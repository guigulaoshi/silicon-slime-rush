import type { I18n } from './i18n';
import type { RaceDirection } from '../track/Direction';

export function routeName(t: I18n, id: string, direction?: RaceDirection): string {
  const name = t.t('track.' + id + '.name');
  return direction === 'reverse' ? name + ' · ' + t.t('direction.reverse') : name;
}
