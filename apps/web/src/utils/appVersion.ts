declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
export const APP_BUILD: string = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';

/** Fill a localised "Version {version} (build {build})" template. */
export function formatVersionLine(template: string, version: string = APP_VERSION, build: string = APP_BUILD): string {
  return template.replace('{version}', version).replace('{build}', build);
}
