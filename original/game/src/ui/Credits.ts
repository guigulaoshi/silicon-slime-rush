declare const __BUILD_CREDITS__: {
  version: string;
  dirty: boolean;
  sourceLinks: {name: string; url: string}[];
  libraries: {name: string; version: string; license: string}[];
};
export const CREDITS = __BUILD_CREDITS__;
